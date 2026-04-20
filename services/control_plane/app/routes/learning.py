"""Learning + governance HTTP surface — Phase 5 PR8.

Wire contract:

  * ``GET  /v1/learning/events``                 — append-only event log.
  * ``GET  /v1/learning/calibration``            — latest curves per scope.
  * ``POST /v1/learning/calibration/recompute``  — admin recompute trigger.
  * ``GET  /v1/learning/regime``                 — current regime verdicts.
  * ``GET  /v1/learning/regime/history``         — history for symbol+tf.
  * ``GET  /v1/learning/sessions``               — per-session rollups.
  * ``GET  /v1/learning/data-truth``             — health + kill-switch.
  * ``POST /v1/learning/data-truth/checks``      — admin write a check.
  * ``GET  /v1/learning/dna``                    — strategy DNA grids.
  * ``POST /v1/learning/dna/{strategyId}/rebuild``— admin recompute DNA.

Reads accept either snake_case or camelCase parameters. Writes go
through :func:`app.audit.log_event` with the relevant
``resource_type``. Reads are un-logged to keep the audit stream
readable.

Error codes:
  * ``invalid_event_kind``        — unknown kind on GET /events.
  * ``invalid_subject_kind``      — unknown subject on GET /events.
  * ``invalid_data_truth_kind``   — unknown check kind on POST checks.
  * ``invalid_threshold_pair``    — amber >= red on POST checks.
  * ``strategy_not_found``        — POST /dna/{id}/rebuild, id missing.
  * ``regime_query_missing``      — GET /regime/history, symbolId+tf required.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query, Request, status

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.learning.dto import (
    CalibrationCurvesOut,
    CalibrationRecomputeRequestDto,
    CalibrationRecomputeResponseDto,
    DataTruthCheckCreateRequestDto,
    DataTruthCheckDto,
    DataTruthStatusOutDto,
    LearningEventsListOut,
    RegimeCurrentOutDto,
    RegimeHistoryOutDto,
    SessionIntelOutDto,
    StrategyDNADto,
    StrategyDNAListOutDto,
)
from app.learning.repo import (
    build_dna_for_strategy,
    get_data_truth_status,
    list_learning_events,
    list_regime_history,
    list_regime_snapshots,
    list_session_snapshots,
    list_strategy_dna,
    load_calibration_curves,
    recompute_calibration,
    upsert_data_truth_check,
)


UTC = timezone.utc

router = APIRouter(prefix="/learning", tags=["learning"])


_VALID_EVENT_KINDS = frozenset(
    {
        "setup_detected",
        "setup_approved",
        "setup_rejected",
        "trade_opened",
        "trade_closed_win",
        "trade_closed_loss",
        "trade_closed_scratch",
        "backtest_completed",
        "calibration_updated",
        "regime_flipped",
        "data_truth_breach",
        "promotion_auto_demote",
        "promotion_manual",
    }
)
_VALID_SUBJECT_KINDS = frozenset(
    {
        "setup",
        "paper_trade",
        "live_trade",
        "backtest",
        "strategy",
        "calibration",
        "regime",
        "data_truth",
    }
)
_VALID_DATA_TRUTH_KINDS = frozenset(
    {
        "bar_latency",
        "bar_gap",
        "book_staleness",
        "feed_desync",
        "symbol_missing",
        "broker_heartbeat",
    }
)
_VALID_SESSIONS = frozenset(
    {"asia", "london", "ny_am", "ny_pm", "off_hours"}
)


def _now_utc() -> datetime:
    return datetime.now(UTC)


# ─────────────────────────── learning events ───────────────────────────


@router.get(
    "/events",
    response_model=LearningEventsListOut,
    summary="List learning events (newest first)",
)
async def list_events(
    db: DbSession,
    user: CurrentUser,
    kind: str | None = Query(default=None),
    subject_kind: str | None = Query(default=None, alias="subjectKind"),
    strategy_id: str | None = Query(default=None, alias="strategyId"),
    from_ts: datetime | None = Query(default=None, alias="fromTs"),
    to_ts: datetime | None = Query(default=None, alias="toTs"),
    cursor: datetime | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
) -> LearningEventsListOut:
    if kind is not None and kind not in _VALID_EVENT_KINDS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_event_kind",
            message=f"kind must be one of {sorted(_VALID_EVENT_KINDS)}",
        )
    if subject_kind is not None and subject_kind not in _VALID_SUBJECT_KINDS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_subject_kind",
            message=f"subjectKind must be one of {sorted(_VALID_SUBJECT_KINDS)}",
        )
    return await list_learning_events(
        db,
        kind=kind,  # type: ignore[arg-type]
        subject_kind=subject_kind,  # type: ignore[arg-type]
        strategy_id=strategy_id,
        from_ts=from_ts,
        to_ts=to_ts,
        cursor=cursor,
        limit=limit,
    )


# ─────────────────────────── calibration ───────────────────────────────


@router.get(
    "/calibration",
    response_model=CalibrationCurvesOut,
    summary="List latest calibration curves per scope",
)
async def get_calibration(
    db: DbSession,
    user: CurrentUser,
) -> CalibrationCurvesOut:
    return await load_calibration_curves(db)


@router.post(
    "/calibration/recompute",
    response_model=CalibrationRecomputeResponseDto,
    status_code=status.HTTP_201_CREATED,
    summary="Recompute the calibration curve for a scope (admin only)",
)
async def recompute_calibration_route(
    request: Request,
    req: CalibrationRecomputeRequestDto,
    db: DbSession,
    admin: AdminUser,
) -> CalibrationRecomputeResponseDto:
    response = await recompute_calibration(db, req=req)
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="learning.calibration.recompute",
        resource_type="learning.calibration",
        resource_id=response.curve.id,
        outcome="success",
        details={
            "strategyId": req.strategy_id,
            "setupType": req.setup_type,
            "tf": req.tf,
            "kind": req.kind,
            "sampleSize": response.sample_size,
        },
    )
    await db.commit()
    return response


# ─────────────────────────── regime ────────────────────────────────────


@router.get(
    "/regime",
    response_model=RegimeCurrentOutDto,
    summary="List current regime verdicts (latest per symbolId + tf)",
)
async def get_regime(
    db: DbSession,
    user: CurrentUser,
) -> RegimeCurrentOutDto:
    return await list_regime_snapshots(db)


@router.get(
    "/regime/history",
    response_model=RegimeHistoryOutDto,
    summary="Regime history for one (symbolId, tf)",
)
async def get_regime_history(
    db: DbSession,
    user: CurrentUser,
    symbol_id: str | None = Query(default=None, alias="symbolId"),
    tf: str | None = Query(default=None),
    from_ts: datetime | None = Query(default=None, alias="fromTs"),
    to_ts: datetime | None = Query(default=None, alias="toTs"),
    limit: int = Query(default=200, ge=1, le=500),
) -> RegimeHistoryOutDto:
    if not symbol_id or not tf:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="regime_query_missing",
            message="symbolId and tf are required",
        )
    return await list_regime_history(
        db,
        symbol_id=symbol_id,
        tf=tf,
        from_ts=from_ts,
        to_ts=to_ts,
        limit=limit,
    )


# ─────────────────────────── sessions ──────────────────────────────────


@router.get(
    "/sessions",
    response_model=SessionIntelOutDto,
    summary="Per-session snapshots",
)
async def get_sessions(
    db: DbSession,
    user: CurrentUser,
    symbol_id: str | None = Query(default=None, alias="symbolId"),
    session: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> SessionIntelOutDto:
    if session is not None and session not in _VALID_SESSIONS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_session",
            message=f"session must be one of {sorted(_VALID_SESSIONS)}",
        )
    return await list_session_snapshots(
        db, symbol_id=symbol_id, session=session, limit=limit
    )


# ─────────────────────────── data truth ────────────────────────────────


@router.get(
    "/data-truth",
    response_model=DataTruthStatusOutDto,
    summary="Data-truth status + kill-switch",
)
async def get_data_truth(
    db: DbSession,
    user: CurrentUser,
) -> DataTruthStatusOutDto:
    return await get_data_truth_status(db)


@router.post(
    "/data-truth/checks",
    response_model=DataTruthCheckDto,
    status_code=status.HTTP_201_CREATED,
    summary="Write a data-truth check (admin only)",
)
async def post_data_truth_check(
    request: Request,
    req: DataTruthCheckCreateRequestDto,
    db: DbSession,
    admin: AdminUser,
) -> DataTruthCheckDto:
    if req.kind not in _VALID_DATA_TRUTH_KINDS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_data_truth_kind",
            message=f"kind must be one of {sorted(_VALID_DATA_TRUTH_KINDS)}",
        )
    if req.amber_threshold > req.red_threshold:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_threshold_pair",
            message="amberThreshold must be ≤ redThreshold",
        )

    row, check_status = await upsert_data_truth_check(db, req=req)
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="learning.data_truth.write",
        resource_type="learning.data_truth",
        resource_id=row.id,
        outcome="success",
        details={
            "kind": req.kind,
            "measurement": req.measurement,
            "amberThreshold": req.amber_threshold,
            "redThreshold": req.red_threshold,
            "status": check_status,
        },
    )
    await db.commit()
    return DataTruthCheckDto(
        id=row.id,
        kind=req.kind,
        status=check_status,
        message=req.message or "",
        measurement=req.measurement,
        amberThreshold=req.amber_threshold,
        redThreshold=req.red_threshold,
        symbolId=req.symbol_id,
        observedAt=row.last_observed_at,
    )


# ─────────────────────────── strategy DNA ──────────────────────────────


@router.get(
    "/dna",
    response_model=StrategyDNAListOutDto,
    summary="List strategy DNA grids",
)
async def get_dna(
    db: DbSession,
    user: CurrentUser,
    strategy_id: str | None = Query(default=None, alias="strategyId"),
) -> StrategyDNAListOutDto:
    return await list_strategy_dna(db, strategy_id=strategy_id)


@router.post(
    "/dna/{strategy_id}/rebuild",
    response_model=StrategyDNADto,
    status_code=status.HTTP_201_CREATED,
    summary="Rebuild the DNA grid for one strategy (admin only)",
)
async def rebuild_dna(
    strategy_id: str,
    request: Request,
    db: DbSession,
    admin: AdminUser,
) -> StrategyDNADto:
    try:
        dto = await build_dna_for_strategy(db, strategy_id=strategy_id)
    except LookupError:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"no strategy with id {strategy_id!r}",
        )
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="learning.dna.rebuild",
        resource_type="learning.dna",
        resource_id=strategy_id,
        outcome="success",
        details={
            "strategyId": strategy_id,
            "totalTrades": dto.total_trades,
        },
    )
    await db.commit()
    return dto
