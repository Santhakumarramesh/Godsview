"""Authenticated /v1/setups surface — list + detail + detect + status.

Phase 3 PR7 scope
-----------------
  * ``GET  /v1/setups`` — paginated list with filters (symbol / tf /
    type / direction / status / min_confidence / date window). Orders
    by ``detected_at DESC`` so newest setups sit on top.
  * ``GET  /v1/setups/{id}`` — full detail — entry/SL/TP, calibrated
    confidence components, reasoning, provenance.
  * ``POST /v1/setups/detect`` — admin-only. Runs the full detector
    chain (:func:`app.setups.orchestrator.detect_all_setups`) on the
    most recent bars + structure events for the requested (symbol, tf),
    persists each :class:`app.setups.types.SetupOut` into the ``setups``
    table and returns the resulting rows. Calibrated against the
    process-local recall store so confidence reflects history.
  * ``PATCH /v1/setups/{id}/status`` — admin-only status transitions
    (detected → approved_paper / approved_live / rejected, or any
    closed-state transition). Records ``closed_at`` + ``closed_pnl_r``
    on close so the setup round-trips into the recall engine for
    future calibration.

The detectors stay pure; this module is the single place that loads
DB state, feeds the detectors, persists results, and calls the recall
calibrator. That keeps the unit-test surface tiny and makes PR8's
execution gate a drop-in consumer of the persisted rows.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, asc, desc, select

from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import (
    Bar,
    Fvg,
    OrderBlock,
    Setup,
    StructureEvent,
    Symbol,
)
from app.orderflow import (
    detect_absorption,
    detect_imbalances,
)
from app.recall import (
    RecallRecord,
    get_recall_store,
)
from app.recall.calibrator import (
    calibrate_with_store,
    feature_fingerprint,
)
from app.setups import (
    PriceZoneOut,
    SetupConfidenceComponents,
    SetupConfidenceOut,
    SetupOut,
    detect_all_setups,
)
from app.structure.bos_choch import StructureEventOut
from app.structure.fvgs import FvgOut
from app.structure.order_blocks import OrderBlockOut
from app.structure.pivots import PivotOut, detect_pivots

router = APIRouter(prefix="/setups", tags=["setups"])

_ALLOWED_TFS = frozenset(
    {"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"}
)

_SETUP_TYPES = frozenset(
    {
        "liquidity_sweep_reclaim",
        "ob_retest",
        "breakout_retest",
        "fvg_reaction",
        "momentum_continuation",
        "session_reversal",
    }
)

_STATUS_VALUES = frozenset(
    {
        "detected",
        "approved_paper",
        "approved_live",
        "filled",
        "closed",
        "expired",
        "rejected",
    }
)

# Terminal states can't transition any further.
_TERMINAL_STATUSES = frozenset({"closed", "rejected", "expired"})


# ─────────────────────────── DTOs ────────────────────────────────────


class PriceZoneDto(BaseModel):
    model_config = {"populate_by_name": True}

    low: float
    high: float
    ref: float


class ConfidenceComponentsDto(BaseModel):
    model_config = {"populate_by_name": True}

    structureScore: float
    orderFlowScore: float
    regimeScore: float
    sessionScore: float
    historyScore: float


class ConfidenceDto(BaseModel):
    model_config = {"populate_by_name": True}

    score: float
    components: ConfidenceComponentsDto
    historyCount: int


class SetupDto(BaseModel):
    """Matches ``packages/types/src/setups.ts::SetupSchema``."""

    model_config = {"populate_by_name": True}

    id: str
    symbolId: str
    tf: str
    type: Literal[
        "liquidity_sweep_reclaim",
        "ob_retest",
        "breakout_retest",
        "fvg_reaction",
        "momentum_continuation",
        "session_reversal",
    ]
    direction: Literal["long", "short"]
    status: Literal[
        "detected",
        "approved_paper",
        "approved_live",
        "filled",
        "closed",
        "expired",
        "rejected",
    ]
    detectedAt: datetime
    expiresAt: datetime | None = None
    entry: PriceZoneDto
    stopLoss: float
    takeProfit: float
    rr: float
    confidence: ConfidenceDto
    reasoning: str
    structureEventIds: list[str] = Field(default_factory=list)
    orderFlowEventIds: list[str] = Field(default_factory=list)
    closedAt: datetime | None = None
    closedPnlR: float | None = None


class SetupsListOut(BaseModel):
    model_config = {"populate_by_name": True}

    setups: list[SetupDto]
    total: int
    offset: int
    limit: int


class SetupsDetectIn(BaseModel):
    model_config = {"populate_by_name": True}

    symbolId: str = Field(..., min_length=1)
    tf: str = Field(..., min_length=1)
    bars: int = Field(400, ge=50, le=5000)
    # Optional override — when the caller already has a macro bias
    # from the fusion engine the momentum detector uses it verbatim.
    bias: Literal["long", "short", "neutral"] = "neutral"


class SetupsDetectOut(BaseModel):
    model_config = {"populate_by_name": True}

    symbolId: str
    tf: str
    persisted: int
    setups: list[SetupDto]


class SetupStatusPatchIn(BaseModel):
    model_config = {"populate_by_name": True}

    status: Literal[
        "detected",
        "approved_paper",
        "approved_live",
        "filled",
        "closed",
        "expired",
        "rejected",
    ]
    # Only meaningful when the new status is ``closed``.
    pnlR: float | None = None


# ─────────────────────────── helpers ────────────────────────────────


async def _load_symbol_or_404(db: DbSession, symbol_id: str) -> Symbol:
    sym = await db.scalar(select(Symbol).where(Symbol.id == symbol_id))
    if sym is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="symbol_not_found",
            message=f"symbol {symbol_id} does not exist",
        )
    return sym


def _validate_tf(tf: str) -> str:
    if tf not in _ALLOWED_TFS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_timeframe",
            message=f"unknown tf: {tf}",
        )
    return tf


def _row_to_dto(row: Setup) -> SetupDto:
    return SetupDto(
        id=row.id,
        symbolId=row.symbol_id,
        tf=row.tf,
        type=row.type,  # type: ignore[arg-type]
        direction=row.direction,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        detectedAt=row.detected_at,
        expiresAt=row.expires_at,
        entry=PriceZoneDto(
            low=row.entry_low, high=row.entry_high, ref=row.entry_ref
        ),
        stopLoss=row.stop_loss,
        takeProfit=row.take_profit,
        rr=row.rr,
        confidence=ConfidenceDto(
            score=row.confidence_score,
            components=ConfidenceComponentsDto(
                structureScore=row.structure_score,
                orderFlowScore=row.order_flow_score,
                regimeScore=row.regime_score,
                sessionScore=row.session_score,
                historyScore=row.history_score,
            ),
            historyCount=row.history_count,
        ),
        reasoning=row.reasoning,
        structureEventIds=list(row.structure_event_ids or []),
        orderFlowEventIds=list(row.order_flow_event_ids or []),
        closedAt=row.closed_at,
        closedPnlR=row.closed_pnl_r,
    )


def _setup_out_to_row(out: SetupOut, *, symbol_id: str) -> Setup:
    return Setup(
        id=out.id,
        symbol_id=symbol_id,
        tf=out.tf,
        type=out.type,
        direction=out.direction,
        status=out.status,
        detected_at=out.detected_at,
        expires_at=out.expires_at,
        entry_low=out.entry.low,
        entry_high=out.entry.high,
        entry_ref=out.entry.ref,
        stop_loss=out.stop_loss,
        take_profit=out.take_profit,
        rr=out.rr,
        confidence_score=out.confidence.score,
        structure_score=out.confidence.components.structure_score,
        order_flow_score=out.confidence.components.order_flow_score,
        regime_score=out.confidence.components.regime_score,
        session_score=out.confidence.components.session_score,
        history_score=out.confidence.components.history_score,
        history_count=out.confidence.history_count,
        reasoning=out.reasoning,
        structure_event_ids=list(out.structure_event_ids),
        order_flow_event_ids=list(out.order_flow_event_ids),
    )


def _apply_calibration(out: SetupOut, *, symbol_id: str) -> SetupOut:
    """Blend recall-store history into the raw detector confidence.

    The calibrator is side-effect-free; when the recall store has no
    matching history the score passes through untouched.
    """

    store = get_recall_store()
    calibrated: SetupConfidenceOut = calibrate_with_store(
        components=out.confidence.components,
        raw_score=out.confidence.score,
        store=store,
        setup_type=out.type,
        direction=out.direction,
        tf=out.tf,
        symbol_id=symbol_id,
        rr=out.rr,
        entry_ref=out.entry.ref,
        of_score=out.confidence.components.order_flow_score,
        structure_score=out.confidence.components.structure_score,
        regime_score=out.confidence.components.regime_score,
        session_score=out.confidence.components.session_score,
    )
    # Rebuild the SetupOut with the calibrated envelope. The underlying
    # dataclass is frozen so we construct a new instance.
    return SetupOut(
        id=out.id,
        symbol_id=out.symbol_id,
        tf=out.tf,
        type=out.type,
        direction=out.direction,
        status=out.status,
        detected_at=out.detected_at,
        entry=out.entry,
        stop_loss=out.stop_loss,
        take_profit=out.take_profit,
        rr=out.rr,
        confidence=calibrated,
        reasoning=out.reasoning,
        structure_event_ids=list(out.structure_event_ids),
        order_flow_event_ids=list(out.order_flow_event_ids),
        expires_at=out.expires_at,
    )


def _record_recall_on_close(row: Setup) -> None:
    """Push a closed setup into the recall store as a memory row.

    Uses the same feature fingerprint as the calibrator so future
    setups can find this one by cosine similarity.
    """

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
    if row.closed_pnl_r is None:
        outcome = "scratch"
    elif row.closed_pnl_r > 0.0:
        outcome = "win"
    elif row.closed_pnl_r < 0.0:
        outcome = "loss"
    else:
        outcome = "scratch"

    store.add(
        RecallRecord(
            id=row.id,
            setup_type=row.type,
            direction=row.direction,
            tf=row.tf,
            symbol_id=row.symbol_id,
            features=features,
            outcome=outcome,  # type: ignore[arg-type]
            pnl_r=row.closed_pnl_r,
            detected_at=row.detected_at,
            closed_at=row.closed_at,
        )
    )


async def _load_bars(
    db: DbSession, *, symbol_id: str, tf: str, limit: int
) -> list[Bar]:
    stmt = (
        select(Bar)
        .where(and_(Bar.symbol_id == symbol_id, Bar.tf == tf, Bar.closed == True))  # noqa: E712
        .order_by(desc(Bar.t))
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    rows.reverse()  # back to ascending order for detectors
    return rows


async def _load_structure_events(
    db: DbSession, *, symbol_id: str, tf: str, limit: int = 200
) -> list[StructureEvent]:
    stmt = (
        select(StructureEvent)
        .where(
            and_(
                StructureEvent.symbol_id == symbol_id,
                StructureEvent.tf == tf,
            )
        )
        .order_by(desc(StructureEvent.confirmation_t))
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    rows.reverse()
    return rows


async def _load_order_blocks(
    db: DbSession, *, symbol_id: str, tf: str, limit: int = 200
) -> list[OrderBlock]:
    stmt = (
        select(OrderBlock)
        .where(and_(OrderBlock.symbol_id == symbol_id, OrderBlock.tf == tf))
        .order_by(desc(OrderBlock.t))
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    rows.reverse()
    return rows


async def _load_fvgs(
    db: DbSession, *, symbol_id: str, tf: str, limit: int = 200
) -> list[Fvg]:
    stmt = (
        select(Fvg)
        .where(and_(Fvg.symbol_id == symbol_id, Fvg.tf == tf))
        .order_by(desc(Fvg.t))
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    rows.reverse()
    return rows


def _struct_to_out(row: StructureEvent) -> StructureEventOut:
    pivot = PivotOut(
        kind=row.broken_pivot_kind,
        price=row.broken_pivot_price,
        t=row.broken_pivot_t,
        bar_index=row.broken_pivot_bar_index,
    )
    return StructureEventOut(
        id=row.id,
        kind=row.kind,
        direction=row.direction,
        level=row.level,
        broken_pivot=pivot,
        confirmation_t=row.confirmation_t,
        confidence=row.confidence,
        detected_at=row.detected_at,
    )


def _ob_to_out(row: OrderBlock) -> OrderBlockOut:
    return OrderBlockOut(
        id=row.id,
        direction=row.direction,
        high=row.high,
        low=row.low,
        t=row.t,
        strength=row.strength,
        retested=row.retested,
        violated=row.violated,
        structure_event_id=row.structure_event_id,
        detected_at=row.detected_at,
    )


def _fvg_to_out(row: Fvg) -> FvgOut:
    return FvgOut(
        id=row.id,
        direction=row.direction,
        top=row.top,
        bottom=row.bottom,
        t=row.t,
        mitigated=row.mitigated,
        mitigated_at=row.mitigated_at,
        detected_at=row.detected_at,
    )


def _validate_status_transition(old: str, new: str) -> None:
    if old == new:
        return  # no-op update is allowed
    if old in _TERMINAL_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="setup_terminal",
            message=f"setup already in terminal state: {old}",
        )


# ─────────────────────────── routes ─────────────────────────────────


@router.get("", response_model=SetupsListOut)
async def list_setups(
    user: CurrentUser,
    db: DbSession,
    symbol_id: str | None = Query(None, alias="symbolId"),
    tf: str | None = Query(None),
    setup_type: str | None = Query(None, alias="type"),
    direction: Literal["long", "short"] | None = Query(None),
    setup_status: str | None = Query(None, alias="status"),
    min_confidence: float = Query(0.0, alias="minConfidence", ge=0.0, le=1.0),
    from_ts: datetime | None = Query(None, alias="fromTs"),
    to_ts: datetime | None = Query(None, alias="toTs"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> SetupsListOut:
    """Paginated list of persisted setups with filter support."""

    if setup_type is not None and setup_type not in _SETUP_TYPES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_setup_type",
            message=f"unknown setup type: {setup_type}",
        )
    if setup_status is not None and setup_status not in _STATUS_VALUES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_setup_status",
            message=f"unknown setup status: {setup_status}",
        )
    if tf is not None:
        _validate_tf(tf)

    conds: list[Any] = []
    if symbol_id is not None:
        conds.append(Setup.symbol_id == symbol_id)
    if tf is not None:
        conds.append(Setup.tf == tf)
    if setup_type is not None:
        conds.append(Setup.type == setup_type)
    if direction is not None:
        conds.append(Setup.direction == direction)
    if setup_status is not None:
        conds.append(Setup.status == setup_status)
    if min_confidence > 0.0:
        conds.append(Setup.confidence_score >= min_confidence)
    if from_ts is not None:
        conds.append(Setup.detected_at >= from_ts)
    if to_ts is not None:
        conds.append(Setup.detected_at < to_ts)

    base_stmt = select(Setup)
    if conds:
        base_stmt = base_stmt.where(and_(*conds))

    count_stmt = select(Setup).where(and_(*conds)) if conds else select(Setup)
    # Lightweight count — aiosqlite-friendly; acceptable under the
    # page-limit ceiling.
    total = len((await db.scalars(count_stmt)).all())

    stmt = base_stmt.order_by(desc(Setup.detected_at)).offset(offset).limit(limit)
    rows = list((await db.scalars(stmt)).all())

    return SetupsListOut(
        setups=[_row_to_dto(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/{setup_id}", response_model=SetupDto)
async def get_setup(
    setup_id: str,
    user: CurrentUser,
    db: DbSession,
) -> SetupDto:
    row = await db.scalar(select(Setup).where(Setup.id == setup_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="setup_not_found",
            message=f"setup {setup_id} does not exist",
        )
    return _row_to_dto(row)


@router.post(
    "/detect",
    response_model=SetupsDetectOut,
    status_code=status.HTTP_201_CREATED,
)
async def detect_setups(
    body: SetupsDetectIn,
    user: AdminUser,
    db: DbSession,
) -> SetupsDetectOut:
    """Run the full detector chain and persist fresh setups.

    Loads the most recent ``bars`` closed bars + structure events +
    order blocks + FVGs for the (symbol, tf) pair, runs the order-flow
    detectors on the matching delta-bars, then fans out to the six
    setup detectors via :func:`detect_all_setups`. Each fired setup is
    calibrated against the recall store and persisted.
    """

    _validate_tf(body.tf)
    await _load_symbol_or_404(db, body.symbolId)

    bars = await _load_bars(
        db, symbol_id=body.symbolId, tf=body.tf, limit=body.bars
    )
    if not bars:
        return SetupsDetectOut(
            symbolId=body.symbolId, tf=body.tf, persisted=0, setups=[]
        )

    struct_events = await _load_structure_events(
        db, symbol_id=body.symbolId, tf=body.tf
    )
    order_blocks = await _load_order_blocks(
        db, symbol_id=body.symbolId, tf=body.tf
    )
    fvgs = await _load_fvgs(db, symbol_id=body.symbolId, tf=body.tf)

    pivots = detect_pivots(bars)

    # Order-flow runs on delta-bars if present, otherwise an empty
    # sequence is passed — detectors fall back to baseline of_score.
    from app.models import DeltaBar

    delta_stmt = (
        select(DeltaBar)
        .where(
            and_(DeltaBar.symbol_id == body.symbolId, DeltaBar.tf == body.tf)
        )
        .order_by(asc(DeltaBar.t))
        .limit(body.bars)
    )
    delta_bars = list((await db.scalars(delta_stmt)).all())
    imbalances = detect_imbalances(delta_bars)
    absorptions = detect_absorption(delta_bars)

    outs = detect_all_setups(
        bars,
        symbol_id=body.symbolId,
        tf=body.tf,
        pivots=pivots,
        structure_events=[_struct_to_out(s) for s in struct_events],
        order_blocks=[_ob_to_out(b) for b in order_blocks],
        fvgs=[_fvg_to_out(f) for f in fvgs],
        imbalances=imbalances,
        absorptions=absorptions,
        bias=body.bias,
    )

    calibrated = [
        _apply_calibration(o, symbol_id=body.symbolId) for o in outs
    ]

    persisted: list[Setup] = []
    for out in calibrated:
        row = _setup_out_to_row(out, symbol_id=body.symbolId)
        db.add(row)
        persisted.append(row)
    await db.commit()

    return SetupsDetectOut(
        symbolId=body.symbolId,
        tf=body.tf,
        persisted=len(persisted),
        setups=[_row_to_dto(r) for r in persisted],
    )


@router.patch("/{setup_id}/status", response_model=SetupDto)
async def patch_status(
    setup_id: str,
    body: SetupStatusPatchIn,
    user: AdminUser,
    db: DbSession,
) -> SetupDto:
    row = await db.scalar(select(Setup).where(Setup.id == setup_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="setup_not_found",
            message=f"setup {setup_id} does not exist",
        )

    _validate_status_transition(row.status, body.status)

    row.status = body.status
    if body.status == "closed":
        from datetime import timezone as _tz

        row.closed_at = datetime.now(_tz.utc)
        row.closed_pnl_r = body.pnlR
        # Push into the recall store so future calibrations see this
        # setup's outcome.
        await db.flush()
        _record_recall_on_close(row)
    elif body.status in {"rejected", "expired"}:
        from datetime import timezone as _tz

        row.closed_at = datetime.now(_tz.utc)

    await db.commit()
    await db.refresh(row)
    return _row_to_dto(row)
