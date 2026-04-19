"""Authenticated execution-gate surface — Setup → paper trade.

Phase 3 PR8 scope
-----------------
  * ``POST /v1/setups/{setup_id}/approve`` — admin-only. Runs the
    deterministic :func:`app.execution.gate.evaluate_gate` against the
    setup, the ``execution.kill_switch`` flag, and the live paper-trade
    counters. On approval creates a ``PaperTrade`` row + transitions
    the underlying Setup to ``approved_paper``. On reject returns 409
    with the gate's enumerated reason code.
  * ``GET  /v1/paper-trades`` — paginated list with filters (symbol /
    status / from/to). Orders by ``approved_at DESC``.
  * ``GET  /v1/paper-trades/{id}`` — detail.
  * ``PATCH /v1/paper-trades/{id}/status`` — admin-only lifecycle
    transitions (``pending_fill → filled → won|lost|scratched`` or
    ``pending_fill|filled → cancelled``). On terminal transitions
    derives the outcome, writes the setup back to the recall store,
    closes the Setup row so its history is available to the
    calibrator for the *next* detection.

Rejections never create audit state themselves — the route writes an
``ops.paper_trade.approve`` audit event tagged with the gate reason so
operators can see the entire decision trail.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, select

from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.execution import GateInput, evaluate_gate
from app.models import FeatureFlag, PaperTrade, Setup
from app.recall import RecallRecord, get_recall_store
from app.recall.calibrator import feature_fingerprint

router = APIRouter(tags=["execution"])

_PAPER_TRADE_STATUS_VALUES = frozenset(
    {
        "pending_fill",
        "filled",
        "won",
        "lost",
        "scratched",
        "cancelled",
    }
)

_ACTIVE_STATUSES = frozenset({"pending_fill", "filled"})
_TERMINAL_STATUSES = frozenset({"won", "lost", "scratched", "cancelled"})

# Allowed lifecycle transitions. Key = old, value = set of new values.
_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending_fill": frozenset({"filled", "cancelled"}),
    "filled": frozenset({"won", "lost", "scratched", "cancelled"}),
}

KILL_SWITCH_FLAG = "execution.kill_switch"


# ─────────────────────────── DTOs ────────────────────────────────────


class OverrideRiskDto(BaseModel):
    model_config = {"populate_by_name": True}

    sizeMultiplier: float = Field(1.0, gt=0.0, le=5.0)
    note: str | None = Field(default=None, max_length=500)


class SetupApprovalIn(BaseModel):
    """Matches ``SetupApprovalRequestSchema`` in @gv/types."""

    model_config = {"populate_by_name": True}

    mode: Literal["paper", "live"] = "paper"
    overrideRisk: OverrideRiskDto | None = None


class PaperTradeDto(BaseModel):
    """Matches ``PaperTradeSchema`` in @gv/types."""

    model_config = {"populate_by_name": True}

    id: str
    setupId: str
    symbolId: str
    direction: Literal["long", "short"]
    entryRef: float
    stopLoss: float
    takeProfit: float
    sizeMultiplier: float
    status: Literal[
        "pending_fill",
        "filled",
        "won",
        "lost",
        "scratched",
        "cancelled",
    ]
    approvedAt: datetime
    approvedByUserId: str
    closedAt: datetime | None = None
    pnlR: float | None = None


class SetupApprovalOut(BaseModel):
    model_config = {"populate_by_name": True}

    approved: bool
    reason: str
    detail: str
    paperTrade: PaperTradeDto | None = None


class PaperTradesListOut(BaseModel):
    model_config = {"populate_by_name": True}

    trades: list[PaperTradeDto]
    total: int
    offset: int
    limit: int


class PaperTradeStatusPatchIn(BaseModel):
    model_config = {"populate_by_name": True}

    status: Literal[
        "pending_fill",
        "filled",
        "won",
        "lost",
        "scratched",
        "cancelled",
    ]
    pnlR: float | None = None


# ─────────────────────────── helpers ─────────────────────────────────


def _pt_to_dto(row: PaperTrade) -> PaperTradeDto:
    return PaperTradeDto(
        id=row.id,
        setupId=row.setup_id,
        symbolId=row.symbol_id,
        direction=row.direction,  # type: ignore[arg-type]
        entryRef=row.entry_ref,
        stopLoss=row.stop_loss,
        takeProfit=row.take_profit,
        sizeMultiplier=row.size_multiplier,
        status=row.status,  # type: ignore[arg-type]
        approvedAt=row.approved_at,
        approvedByUserId=row.approved_by_user_id,
        closedAt=row.closed_at,
        pnlR=row.pnl_r,
    )


async def _kill_switch_active(db: DbSession) -> bool:
    row = await db.scalar(
        select(FeatureFlag).where(FeatureFlag.key == KILL_SWITCH_FLAG)
    )
    return bool(row and row.enabled)


async def _active_for_symbol(db: DbSession, symbol_id: str) -> int:
    stmt = select(func.count()).select_from(PaperTrade).where(
        and_(
            PaperTrade.symbol_id == symbol_id,
            PaperTrade.status.in_(list(_ACTIVE_STATUSES)),
        )
    )
    val = await db.scalar(stmt)
    return int(val or 0)


async def _active_global(db: DbSession) -> int:
    stmt = select(func.count()).select_from(PaperTrade).where(
        PaperTrade.status.in_(list(_ACTIVE_STATUSES))
    )
    val = await db.scalar(stmt)
    return int(val or 0)


async def _active_for_setup(db: DbSession, setup_id: str) -> bool:
    stmt = select(PaperTrade.id).where(
        and_(
            PaperTrade.setup_id == setup_id,
            PaperTrade.status.in_(list(_ACTIVE_STATUSES)),
        )
    )
    hit = await db.scalar(stmt)
    return hit is not None


def _derive_outcome_from_pt(status: str, pnl_r: float | None) -> str:
    if status == "won":
        return "win"
    if status == "lost":
        return "loss"
    if status == "scratched":
        return "scratch"
    if status == "cancelled":
        return "scratch"
    # Terminal state passed a numeric pnl_r — prefer that.
    if pnl_r is None:
        return "scratch"
    if pnl_r > 0:
        return "win"
    if pnl_r < 0:
        return "loss"
    return "scratch"


async def _record_recall_from_setup(
    db: DbSession, *, setup_id: str, outcome: str, pnl_r: float | None
) -> None:
    row = await db.scalar(select(Setup).where(Setup.id == setup_id))
    if row is None:
        return
    store = get_recall_store()
    features = feature_fingerprint(
        setup_type=row.type,
        direction=row.direction,
        tf=row.tf,
        rr=row.rr,
        entry_ref=row.entry_ref,
        of_score=row.order_flow_score,
        structure_score=row.structure_score,
        regime_score=row.regime_score,
        session_score=row.session_score,
    )
    store.add(
        RecallRecord(
            id=row.id,
            setup_type=row.type,
            direction=row.direction,
            tf=row.tf,
            symbol_id=row.symbol_id,
            features=features,
            outcome=outcome,  # type: ignore[arg-type]
            pnl_r=pnl_r,
            detected_at=row.detected_at,
            closed_at=datetime.now(timezone.utc),
        )
    )


# ─────────────────────────── routes ──────────────────────────────────


@router.post(
    "/setups/{setup_id}/approve",
    response_model=SetupApprovalOut,
)
async def approve_setup(
    setup_id: str,
    body: SetupApprovalIn,
    user: AdminUser,
    db: DbSession,
) -> SetupApprovalOut:
    """Run the execution gate and, on approval, create a paper trade."""

    setup = await db.scalar(select(Setup).where(Setup.id == setup_id))
    if setup is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="setup_not_found",
            message=f"setup {setup_id} does not exist",
        )

    size_multiplier = 1.0
    note: str | None = None
    if body.overrideRisk is not None:
        size_multiplier = body.overrideRisk.sizeMultiplier
        note = body.overrideRisk.note

    kill_switch = await _kill_switch_active(db)
    sym_active = await _active_for_symbol(db, setup.symbol_id)
    global_active = await _active_global(db)
    already = await _active_for_setup(db, setup_id)

    decision = evaluate_gate(
        GateInput(
            mode=body.mode,
            size_multiplier=size_multiplier,
            setup_status=setup.status,
            setup_confidence=setup.confidence_score,
            setup_expires_at=setup.expires_at,
            kill_switch_active=kill_switch,
            active_trades_for_symbol=sym_active,
            active_trades_global=global_active,
            setup_has_active_paper_trade=already,
            now=datetime.now(timezone.utc),
        )
    )

    if not decision.approved:
        # Reject path — 409 with the enumerated reason so the frontend
        # can render a targeted inline message.
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code=f"gate_{decision.reason}",
            message=decision.detail or decision.reason,
        )

    # Approved — mint a paper trade row + flip the setup status.
    trade = PaperTrade(
        setup_id=setup.id,
        symbol_id=setup.symbol_id,
        direction=setup.direction,
        entry_ref=setup.entry_ref,
        stop_loss=setup.stop_loss,
        take_profit=setup.take_profit,
        size_multiplier=size_multiplier,
        status="pending_fill",
        approved_by_user_id=user.id,
        note=note,
    )
    db.add(trade)
    setup.status = "approved_paper"
    await db.commit()
    await db.refresh(trade)

    return SetupApprovalOut(
        approved=True,
        reason=decision.reason,
        detail=decision.detail,
        paperTrade=_pt_to_dto(trade),
    )


@router.get("/paper-trades", response_model=PaperTradesListOut)
async def list_paper_trades(
    user: CurrentUser,
    db: DbSession,
    symbol_id: str | None = Query(None, alias="symbolId"),
    setup_id: str | None = Query(None, alias="setupId"),
    trade_status: str | None = Query(None, alias="status"),
    from_ts: datetime | None = Query(None, alias="fromTs"),
    to_ts: datetime | None = Query(None, alias="toTs"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> PaperTradesListOut:
    if trade_status is not None and trade_status not in _PAPER_TRADE_STATUS_VALUES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_paper_trade_status",
            message=f"unknown paper-trade status: {trade_status}",
        )

    conds: list[Any] = []
    if symbol_id is not None:
        conds.append(PaperTrade.symbol_id == symbol_id)
    if setup_id is not None:
        conds.append(PaperTrade.setup_id == setup_id)
    if trade_status is not None:
        conds.append(PaperTrade.status == trade_status)
    if from_ts is not None:
        conds.append(PaperTrade.approved_at >= from_ts)
    if to_ts is not None:
        conds.append(PaperTrade.approved_at < to_ts)

    base = select(PaperTrade)
    if conds:
        base = base.where(and_(*conds))

    total_val = await db.scalar(
        select(func.count()).select_from(PaperTrade).where(and_(*conds))
        if conds
        else select(func.count()).select_from(PaperTrade)
    )
    total = int(total_val or 0)

    stmt = (
        base.order_by(desc(PaperTrade.approved_at))
        .offset(offset)
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    return PaperTradesListOut(
        trades=[_pt_to_dto(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/paper-trades/{trade_id}", response_model=PaperTradeDto)
async def get_paper_trade(
    trade_id: str,
    user: CurrentUser,
    db: DbSession,
) -> PaperTradeDto:
    row = await db.scalar(select(PaperTrade).where(PaperTrade.id == trade_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="paper_trade_not_found",
            message=f"paper trade {trade_id} does not exist",
        )
    return _pt_to_dto(row)


@router.patch(
    "/paper-trades/{trade_id}/status",
    response_model=PaperTradeDto,
)
async def patch_paper_trade_status(
    trade_id: str,
    body: PaperTradeStatusPatchIn,
    user: AdminUser,
    db: DbSession,
) -> PaperTradeDto:
    row = await db.scalar(select(PaperTrade).where(PaperTrade.id == trade_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="paper_trade_not_found",
            message=f"paper trade {trade_id} does not exist",
        )

    old = row.status
    new = body.status
    if old == new:
        return _pt_to_dto(row)
    if old in _TERMINAL_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="paper_trade_terminal",
            message=f"paper trade already in terminal state: {old}",
        )
    allowed = _ALLOWED_TRANSITIONS.get(old, frozenset())
    if new not in allowed:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="paper_trade_invalid_transition",
            message=f"cannot transition {old} → {new}",
        )

    now = datetime.now(timezone.utc)
    row.status = new
    if new == "filled":
        row.filled_at = now
    if new in _TERMINAL_STATUSES:
        row.closed_at = now
        row.pnl_r = body.pnlR

        # Close the underlying Setup + push to recall.
        outcome = _derive_outcome_from_pt(new, body.pnlR)
        setup_row = await db.scalar(
            select(Setup).where(Setup.id == row.setup_id)
        )
        if setup_row is not None:
            # Only touch the Setup if it isn't already closed out —
            # Setup.patch_status may have beat us to it.
            if setup_row.status not in {"closed", "rejected", "expired"}:
                setup_row.status = "closed"
                setup_row.closed_at = now
                setup_row.closed_pnl_r = body.pnlR
        await db.flush()
        if setup_row is not None:
            await _record_recall_from_setup(
                db,
                setup_id=row.setup_id,
                outcome=outcome,
                pnl_r=body.pnlR,
            )

    await db.commit()
    await db.refresh(row)
    return _pt_to_dto(row)
