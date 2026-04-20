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

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, select

from app.audit import log_event
from app.broker import BrokerProtocol, BrokerUnavailable
from app.broker.base import BrokerSubmitRequest, broker_registry
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.execution import (
    GateInput,
    LiveGateInput,
    LiveSizingPreview,
    evaluate_gate,
    evaluate_live_gate,
    preview_live_sizing,
)
from app.models import (
    AccountEquitySnapshot,
    BrokerAccount,
    FeatureFlag,
    LiveTrade,
    PaperTrade,
    Position,
    RiskBudget as RiskBudgetRow,
    Setup,
    Symbol,
)
from app.recall import RecallRecord, get_recall_store
from app.recall.calibrator import feature_fingerprint
from app.risk import (
    EquitySnapshot,
    RiskBudget,
    size_for_trade,
)

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

_LIVE_ACTIVE_STATUSES = frozenset(
    {"pending_submit", "submitted", "partially_filled", "filled"}
)
_LIVE_TERMINAL_STATUSES = frozenset(
    {"won", "lost", "scratched", "cancelled", "rejected"}
)

LIVE_ENABLED_FLAG = "execution.live_enabled"

#: Asset-class buckets with known intra-class correlation. Everything
#: else falls back to the symbol's ``asset_class`` value verbatim — the
#: live gate's correlation cap only matters when positions share a
#: bucket, so this conservative mapping keeps the risk floor tight.
_ASSET_TO_CORRELATION: dict[str, str] = {
    "equity": "us_equity",
    "futures": "futures",
    "forex": "forex_major",
    "crypto": "crypto",
    "option": "us_equity",
}

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


# ── live gate DTOs ─────────────────────────────────────────────────


class LivePreviewIn(BaseModel):
    """Request body for POST /v1/execution/live/preview.

    Matches the admin-facing *preview* envelope — no side effects, just
    a dry-run of the live gate + sizing math so operators see exactly
    what a subsequent approve-live would do.
    """

    model_config = {"populate_by_name": True}

    setupId: str = Field(..., min_length=1)
    accountId: str = Field(..., min_length=1)
    mode: Literal["paper", "live"] = "live"
    overrideRisk: OverrideRiskDto | None = None


class LiveSizingDto(BaseModel):
    model_config = {"populate_by_name": True}

    qty: float
    notional: float
    dollarRisk: float
    rRisk: float


class LiveRiskProjectionDto(BaseModel):
    model_config = {"populate_by_name": True}

    projectedGross: float
    projectedCorrelated: float
    drawdownR: float


class LivePreviewOut(BaseModel):
    """Matches the ``LiveApprovalPreviewSchema`` contract in @gv/types."""

    model_config = {"populate_by_name": True}

    approved: bool
    reason: str
    detail: str
    sizing: LiveSizingDto | None = None
    risk: LiveRiskProjectionDto | None = None


class LiveTradeDto(BaseModel):
    """Mirrors ``LiveTradeSchema`` in ``packages/types/src/execution.ts``."""

    model_config = {"populate_by_name": True}

    id: str
    setupId: str
    symbolId: str
    accountId: str
    direction: Literal["long", "short"]
    entryRef: float
    stopLoss: float
    takeProfit: float
    sizeMultiplier: float
    qty: float
    status: Literal[
        "pending_submit",
        "submitted",
        "partially_filled",
        "filled",
        "won",
        "lost",
        "scratched",
        "cancelled",
        "rejected",
    ]
    clientOrderId: str
    brokerOrderId: str | None = None
    approvedAt: datetime
    approvedByUserId: str
    submittedAt: datetime | None = None
    filledAt: datetime | None = None
    closedAt: datetime | None = None
    avgFillPrice: float | None = None
    filledQty: float = 0.0
    commission: float = 0.0
    realizedPnLDollars: float | None = None
    pnlR: float | None = None
    note: str | None = None


class LiveApprovalOut(BaseModel):
    model_config = {"populate_by_name": True}

    approved: bool
    reason: str
    detail: str
    liveTrade: LiveTradeDto | None = None


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


# ────────────────────── live gate helpers ───────────────────────────


async def _live_enabled(db: DbSession) -> bool:
    """``execution.live_enabled`` flag — defaults to True when absent."""
    row = await db.scalar(
        select(FeatureFlag).where(FeatureFlag.key == LIVE_ENABLED_FLAG)
    )
    if row is None:
        return True
    return bool(row.enabled)


async def _active_live_for_symbol(db: DbSession, symbol_id: str) -> int:
    stmt = select(func.count()).select_from(LiveTrade).where(
        and_(
            LiveTrade.symbol_id == symbol_id,
            LiveTrade.status.in_(list(_LIVE_ACTIVE_STATUSES)),
        )
    )
    val = await db.scalar(stmt)
    return int(val or 0)


async def _active_live_global(db: DbSession) -> int:
    stmt = select(func.count()).select_from(LiveTrade).where(
        LiveTrade.status.in_(list(_LIVE_ACTIVE_STATUSES))
    )
    val = await db.scalar(stmt)
    return int(val or 0)


async def _active_live_for_setup(db: DbSession, setup_id: str) -> bool:
    stmt = select(LiveTrade.id).where(
        and_(
            LiveTrade.setup_id == setup_id,
            LiveTrade.status.in_(list(_LIVE_ACTIVE_STATUSES)),
        )
    )
    hit = await db.scalar(stmt)
    return hit is not None


async def _latest_equity_snapshot(
    db: DbSession, account_id: str
) -> AccountEquitySnapshot | None:
    stmt = (
        select(AccountEquitySnapshot)
        .where(AccountEquitySnapshot.account_id == account_id)
        .order_by(desc(AccountEquitySnapshot.observed_at))
        .limit(1)
    )
    return await db.scalar(stmt)


async def _account_positions(
    db: DbSession, account_id: str
) -> list[Position]:
    stmt = select(Position).where(
        and_(Position.account_id == account_id, Position.status == "open")
    )
    return list((await db.scalars(stmt)).all())


def _correlation_class_for_symbol(sym: Symbol | None) -> str:
    """Map a symbol's ``asset_class`` to the risk engine's correlation bucket."""
    if sym is None:
        return "unknown"
    return _ASSET_TO_CORRELATION.get(sym.asset_class, sym.asset_class)


def _snapshot_to_equity(
    row: AccountEquitySnapshot | None,
) -> EquitySnapshot | None:
    if row is None:
        return None
    return EquitySnapshot(
        total_equity=row.total_equity,
        start_of_day_equity=row.start_of_day_equity,
        realized_pnl=row.realized_pnl,
        unrealized_pnl=row.unrealized_pnl,
        buying_power=row.buying_power,
        observed_at=row.observed_at,
    )


def _row_to_budget(row: RiskBudgetRow | None) -> RiskBudget | None:
    if row is None:
        return None
    return RiskBudget(
        max_risk_per_trade_r=row.max_risk_per_trade_r,
        max_daily_drawdown_r=row.max_daily_drawdown_r,
        max_open_positions=row.max_open_positions,
        max_correlated_exposure=row.max_correlated_exposure,
        max_gross_exposure=row.max_gross_exposure,
    )


def _live_trade_to_dto(row: LiveTrade) -> LiveTradeDto:
    return LiveTradeDto(
        id=row.id,
        setupId=row.setup_id,
        symbolId=row.symbol_id,
        accountId=row.account_id,
        direction=row.direction,  # type: ignore[arg-type]
        entryRef=row.entry_ref,
        stopLoss=row.stop_loss,
        takeProfit=row.take_profit,
        sizeMultiplier=row.size_multiplier,
        qty=row.qty,
        status=row.status,  # type: ignore[arg-type]
        clientOrderId=row.client_order_id,
        brokerOrderId=row.broker_order_id,
        approvedAt=row.approved_at,
        approvedByUserId=row.approved_by_user_id,
        submittedAt=row.submitted_at,
        filledAt=row.filled_at,
        closedAt=row.closed_at,
        avgFillPrice=row.avg_fill_price,
        filledQty=row.filled_qty,
        commission=row.commission,
        realizedPnLDollars=row.realized_pnl_dollars,
        pnlR=row.pnl_r,
        note=row.note,
    )


async def _assemble_live_gate_context(
    *,
    db: DbSession,
    setup: Setup,
    account_id: str,
    size_multiplier: float,
    mode: Literal["paper", "live"],
    now: datetime,
) -> tuple[
    LiveGateInput,
    LiveSizingPreview | None,
    BrokerAccount,
    Symbol | None,
    RiskBudget | None,
    EquitySnapshot | None,
]:
    """Build the :class:`LiveGateInput` + sizing preview from DB state.

    Returns a 6-tuple so the caller can emit both the gate verdict and
    the sizing preview in the /preview envelope, plus reuse the loaded
    rows for the /approve-live path.
    """

    account = await db.scalar(
        select(BrokerAccount).where(BrokerAccount.id == account_id)
    )
    if account is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="broker_account_not_found",
            message=f"broker account {account_id} does not exist",
        )

    symbol = await db.scalar(
        select(Symbol).where(Symbol.id == setup.symbol_id)
    )
    budget_row = await db.scalar(
        select(RiskBudgetRow).where(RiskBudgetRow.account_id == account_id)
    )
    equity_row = await _latest_equity_snapshot(db, account_id)
    positions = await _account_positions(db, account_id)

    kill_switch = await _kill_switch_active(db)
    live_enabled = await _live_enabled(db)
    broker_available = broker_registry.get_or_none(account_id) is not None
    sym_active = await _active_live_for_symbol(db, setup.symbol_id)
    global_active = await _active_live_global(db)
    already = await _active_live_for_setup(db, setup.id)

    correlation = _correlation_class_for_symbol(symbol)
    gross = 0.0
    correlated = 0.0
    for pos in positions:
        pos_symbol = await db.scalar(
            select(Symbol).where(Symbol.id == pos.symbol_id)
        )
        notional = abs(pos.qty) * max(pos.mark_price, 0.0)
        gross += notional
        if _correlation_class_for_symbol(pos_symbol) == correlation:
            correlated += notional

    budget = _row_to_budget(budget_row)
    equity = _snapshot_to_equity(equity_row)

    equity_age_s: float | None = None
    if equity_row is not None:
        observed = equity_row.observed_at
        if observed.tzinfo is None:
            observed = observed.replace(tzinfo=timezone.utc)
        equity_age_s = (now - observed).total_seconds()

    preview: LiveSizingPreview | None = None
    planned_dollar_risk = 0.0
    planned_notional = 0.0
    if budget is not None and equity is not None:
        try:
            preview = preview_live_sizing(
                budget=budget,
                equity=equity,
                entry_price=setup.entry_ref,
                stop_loss=setup.stop_loss,
                size_multiplier=size_multiplier,
                current_gross_exposure=gross,
                correlated_gross_exposure=correlated,
                lot_size=symbol.lot_size if symbol is not None else 1.0,
            )
            planned_dollar_risk = preview.dollar_risk
            planned_notional = preview.notional
        except Exception:  # pragma: no cover - defensive
            preview = None

    gate_input = LiveGateInput(
        mode=mode,
        size_multiplier=size_multiplier,
        setup_status=setup.status,
        setup_confidence=setup.confidence_score,
        setup_expires_at=setup.expires_at,
        setup_has_active_live_trade=already,
        kill_switch_active=kill_switch,
        active_trades_for_symbol=sym_active,
        active_trades_global=global_active,
        live_enabled=live_enabled,
        broker_available=broker_available,
        equity=equity,
        risk=budget,
        planned_trade_risk_dollars=planned_dollar_risk,
        planned_trade_notional=planned_notional,
        current_gross_exposure=gross,
        correlated_gross_exposure=correlated,
        open_positions_count=len(positions),
        equity_age_seconds=equity_age_s,
        correlation_class=correlation,
        now=now,
    )
    return gate_input, preview, account, symbol, budget, equity


# ─────────────────────── live gate routes ───────────────────────────


@router.post("/execution/live/preview", response_model=LivePreviewOut)
async def live_execution_preview(
    body: LivePreviewIn,
    user: AdminUser,
    db: DbSession,
) -> LivePreviewOut:
    """Dry-run the live gate without side effects.

    Loads the setup + budget + equity + positions + counters, runs the
    live gate, and returns the verdict plus the sizing projection so
    the operator sees the R-risk, notional, projected gross, and
    projected correlated exposure *before* clicking approve-live.
    """

    setup = await db.scalar(select(Setup).where(Setup.id == body.setupId))
    if setup is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="setup_not_found",
            message=f"setup {body.setupId} does not exist",
        )

    size_multiplier = 1.0
    if body.overrideRisk is not None:
        size_multiplier = body.overrideRisk.sizeMultiplier

    now = datetime.now(timezone.utc)
    gate_input, preview, _, _, _, _ = await _assemble_live_gate_context(
        db=db,
        setup=setup,
        account_id=body.accountId,
        size_multiplier=size_multiplier,
        mode=body.mode,
        now=now,
    )
    decision = evaluate_live_gate(gate_input)

    sizing: LiveSizingDto | None = None
    risk_proj: LiveRiskProjectionDto | None = None
    if preview is not None:
        sizing = LiveSizingDto(
            qty=preview.qty,
            notional=preview.notional,
            dollarRisk=preview.dollar_risk,
            rRisk=preview.r_risk,
        )
        risk_proj = LiveRiskProjectionDto(
            projectedGross=preview.projected_gross,
            projectedCorrelated=preview.projected_correlated,
            drawdownR=preview.drawdown_r,
        )

    return LivePreviewOut(
        approved=decision.approved,
        reason=decision.reason,
        detail=decision.detail,
        sizing=sizing,
        risk=risk_proj,
    )


@router.post(
    "/setups/{setup_id}/approve-live",
    response_model=LiveApprovalOut,
)
async def approve_setup_live(
    setup_id: str,
    body: LivePreviewIn,
    user: AdminUser,
    db: DbSession,
    request: Request,
) -> LiveApprovalOut:
    """Run the live gate and, on approval, submit the order to the broker.

    * Loads the full live-gate context + runs the deterministic gate.
    * On reject — returns 409 with the gate's enumerated ``reason`` code
      and writes a ``setup.live_rejected`` audit event.
    * On approve — sizes via :func:`app.risk.size_for_trade`, mints a
      :class:`LiveTrade` row at ``pending_submit`` with a unique
      ``client_order_id``, calls :meth:`BrokerProtocol.submit_order`,
      then flips the row to ``submitted`` (or ``rejected`` if the broker
      ack says so). Transitions the Setup to ``approved_live`` and
      writes a ``setup.live_approved`` audit event.
    """

    # Ignore the setup id in the body — the path segment is authoritative.
    body_setup_id = body.setupId
    if body_setup_id and body_setup_id != setup_id:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="setup_id_mismatch",
            message=(
                f"body.setupId ({body_setup_id}) does not match the path "
                f"({setup_id})"
            ),
        )

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

    # Live approval only makes sense in live mode — but the preview DTO
    # shares the body. Accept "paper" as an explicit signal the caller
    # wanted a dry-run.
    mode: Literal["paper", "live"] = body.mode or "live"

    now = datetime.now(timezone.utc)
    gate_input, preview, account, symbol, budget, equity = (
        await _assemble_live_gate_context(
            db=db,
            setup=setup,
            account_id=body.accountId,
            size_multiplier=size_multiplier,
            mode=mode,
            now=now,
        )
    )
    decision = evaluate_live_gate(gate_input)

    if not decision.approved:
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="setup.live_rejected",
            resource_type="setup",
            resource_id=setup_id,
            outcome="denied",
            details={
                "reason": decision.reason,
                "detail": decision.detail,
                "accountId": body.accountId,
                "sizeMultiplier": size_multiplier,
            },
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code=f"gate_{decision.reason}",
            message=decision.detail or decision.reason,
        )

    # Approved — size + mint the LiveTrade row at pending_submit.
    assert budget is not None and equity is not None  # gate guarantees these
    lot_size = symbol.lot_size if symbol is not None else 1.0
    qty = size_for_trade(
        equity=equity.total_equity,
        risk_per_trade_r=budget.max_risk_per_trade_r * size_multiplier,
        entry_price=setup.entry_ref,
        stop_loss=setup.stop_loss,
        lot_size=lot_size,
    )
    if qty <= 0:
        # A zero sized trade is effectively a reject — surface it so the
        # operator knows the risk budget is too small for the stop.
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="gate_risk_per_trade_breached",
            message=(
                f"sized qty is zero — risk budget too small for stop distance "
                f"(equity={equity.total_equity:.2f}, "
                f"stop_dist={abs(setup.entry_ref - setup.stop_loss):.4f})"
            ),
        )

    client_order_id = f"gv_{setup_id}_{int(now.timestamp() * 1000)}"
    trade = LiveTrade(
        setup_id=setup.id,
        symbol_id=setup.symbol_id,
        account_id=account.id,
        direction=setup.direction,
        entry_ref=setup.entry_ref,
        stop_loss=setup.stop_loss,
        take_profit=setup.take_profit,
        size_multiplier=size_multiplier,
        qty=qty,
        status="pending_submit",
        client_order_id=client_order_id,
        approved_by_user_id=user.id,
        note=note,
    )
    db.add(trade)
    setup.status = "approved_live"
    await db.flush()
    await db.refresh(trade)

    # Submit to the broker adapter. On outage, we roll the row to
    # ``rejected`` so the audit trail + operator UI both see the
    # failed attempt — the row never mysteriously disappears.
    adapter = broker_registry.get_or_none(account.id)
    if adapter is None:
        trade.status = "rejected"
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=f"no broker adapter registered for account {account.id}",
        )

    submit = BrokerSubmitRequest(
        client_order_id=client_order_id,
        symbol=symbol.ticker if symbol is not None else setup.symbol_id,
        direction=setup.direction,  # type: ignore[arg-type]
        qty=qty,
        order_type="bracket",
        take_profit=setup.take_profit,
        stop_loss=setup.stop_loss,
        note=note,
    )
    try:
        result = await adapter.submit_order(submit)
    except BrokerUnavailable as exc:
        trade.status = "rejected"
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="setup.live_broker_unavailable",
            resource_type="setup",
            resource_id=setup_id,
            outcome="failure",
            details={
                "provider": exc.provider,
                "reason": exc.reason,
                "clientOrderId": client_order_id,
            },
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=exc.reason,
        ) from exc

    trade.broker_order_id = result.broker_order_id
    trade.submitted_at = result.submitted_at
    # Map the broker-side status onto the live trade enum. Brokers ack
    # with ``accepted`` / ``submitted`` / ``rejected`` / fill states.
    if result.status == "rejected":
        trade.status = "rejected"
    elif result.status in {"partially_filled", "filled"}:
        trade.status = result.status
        trade.filled_at = result.submitted_at
    else:
        trade.status = "submitted"

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="setup.live_approved",
        resource_type="setup",
        resource_id=setup_id,
        outcome="success",
        details={
            "accountId": account.id,
            "clientOrderId": client_order_id,
            "brokerOrderId": result.broker_order_id,
            "qty": qty,
            "sizeMultiplier": size_multiplier,
            "rRisk": preview.r_risk if preview is not None else None,
            "status": trade.status,
        },
    )
    await db.commit()
    await db.refresh(trade)

    return LiveApprovalOut(
        approved=True,
        reason=decision.reason,
        detail=decision.detail,
        liveTrade=_live_trade_to_dto(trade),
    )
