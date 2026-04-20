"""Authenticated Quant Lab replay surface — candle-by-candle time travel.

Phase 5 PR5 scope
-----------------
  * ``GET  /v1/quant/replay``                    — list replay runs (status / cursor / limit).
  * ``GET  /v1/quant/replay/{id}``               — run-level detail.
  * ``POST /v1/quant/replay``                    — enqueue + run a replay.
  * ``GET  /v1/quant/replay/{id}/frames``        — paginated persisted frames.
  * ``GET  /v1/quant/replay/{id}/stream``        — SSE live stream of frames.
  * ``POST /v1/quant/replay/{id}/cancel``        — best-effort cancel.

The replay can run in two modes:

  * ``stepMs == 0`` — run synchronously inside the POST request. Every
    frame is persisted via :class:`ReplayFrameRow`, ``hypotheticalPnLR``
    is back-filled in a single pass, and the terminal response body
    reflects ``status=completed``.
  * ``stepMs > 0``  — same synchronous run, then the SSE stream endpoint
    re-reads the persisted frames and emits them with ``stepMs``
    wall-clock delay between each. This keeps the run deterministic and
    idempotent while still supporting the time-travel UX.

Authentication is user-level (same as the rest of ``/quant``). Writes
(POST, cancel) require the admin role.
"""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Sequence

from fastapi import APIRouter, Query, Request, status
from fastapi.responses import StreamingResponse
from pydantic import ValidationError
from sqlalchemy import and_, desc, func, select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import (
    Bar,
    ReplayFrameRow,
    ReplayRun,
    Setup,
    Strategy,
    StrategyVersion,
    Symbol,
)
from app.quant_lab.engine import EngineBar
from app.quant_lab.replay import (
    ReplayConfig,
    iter_frames,
)
from app.quant_lab.replay_types import (
    QuantReplayFrameDto,
    QuantReplayFramesOut,
    ReplayRunDto,
    ReplayRunRequestDto,
    ReplayRunsListOut,
    ReplayStatusLiteral,
)
from app.quant_lab.types import (
    StrategyVersionConfigDto,
)

UTC = timezone.utc

router = APIRouter(prefix="/quant", tags=["quant-lab-replay"])


# ────────────────────────── constants ─────────────────────────────────

_ALLOWED_STATUSES: frozenset[str] = frozenset(
    {"queued", "streaming", "completed", "failed", "cancelled"}
)
_TERMINAL_STATUSES: frozenset[str] = frozenset(
    {"completed", "failed", "cancelled"}
)

# Hard ceiling on how many bars a single replay can walk. Matches the
# backtest engine's cap so the two surfaces can't be used to bypass
# each other's guard-rails.
_MAX_BARS_PER_REPLAY = 50_000

# Upper bound on per-frame wall-clock delay (mirror of the Zod schema
# in packages/types/src/quant-lab.ts — keep in lockstep).
_MAX_STEP_MS = 60_000


# ────────────────────────── helpers ───────────────────────────────────


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _replay_row_to_dto(row: ReplayRun) -> ReplayRunDto:
    request_dto = ReplayRunRequestDto(
        setupId=None,  # we don't round-trip setup_id through ReplayRun
        symbolId=(row.symbol_ids[0] if row.symbol_ids else None),
        startAt=_aware(row.from_ts) or _now_utc(),
        endAt=_aware(row.to_ts) or _now_utc(),
        tf=row.tf,  # type: ignore[arg-type]
        stepMs=row.step_ms or 0,
        withLiveGate=False,
    )
    return ReplayRunDto(
        id=row.id,
        request=request_dto,
        status=row.status,  # type: ignore[arg-type]
        totalFrames=0,  # filled in by the list query (see below)
        error=row.error,
        createdAt=_aware(row.requested_at) or _now_utc(),
        completedAt=_aware(row.completed_at),
        createdByUserId=row.requested_by_user_id,
    )


def _frame_row_to_dto(row: ReplayFrameRow, run_id: str) -> QuantReplayFrameDto:
    decision = row.decision or {}
    try:
        return QuantReplayFrameDto.model_validate(decision)
    except ValidationError:
        # Persisted shape predates the current schema — surface what we
        # have + a "none" decision so the UI never crashes.
        bar = (decision.get("bar") or {}) if isinstance(decision, dict) else {}
        return QuantReplayFrameDto(
            id=row.id,
            replayRunId=run_id,
            ts=_aware(row.ts) or _now_utc(),
            symbolId=decision.get("symbolId") if isinstance(decision, dict) else "unknown",
            tf=decision.get("tf", "1h") if isinstance(decision, dict) else "1h",
            bar={  # type: ignore[arg-type]
                "open": float(bar.get("open", 0.0)),
                "high": float(bar.get("high", 0.0)),
                "low": float(bar.get("low", 0.0)),
                "close": float(bar.get("close", 0.0)),
                "volume": float(bar.get("volume", 0.0)),
            },
            structure={},  # type: ignore[arg-type]
            orderFlow={},  # type: ignore[arg-type]
            decision={"action": "none", "reasoning": "legacy frame"},  # type: ignore[arg-type]
            hypotheticalPnLR=None,
        )


def _validate_replay_status(value: str | None) -> None:
    if value is not None and value not in _ALLOWED_STATUSES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message=f"status must be one of {sorted(_ALLOWED_STATUSES)}",
        )


def _validate_request_window(req: ReplayRunRequestDto) -> None:
    if req.endAt <= req.startAt:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_window",
            message="endAt must be strictly greater than startAt",
        )
    if req.stepMs > _MAX_STEP_MS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_step_ms",
            message=f"stepMs must be <= {_MAX_STEP_MS}",
        )
    if req.setupId is None and req.symbolId is None:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_target",
            message="exactly one of setupId / symbolId must be set",
        )
    if req.setupId is not None and req.symbolId is not None:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_target",
            message="setupId and symbolId are mutually exclusive",
        )


async def _load_bars(
    db,
    *,
    symbol_id: str,
    tf: str,
    start_at: datetime,
    end_at: datetime,
) -> list[EngineBar]:
    """Fetch bars for the replay window, capped at ``_MAX_BARS_PER_REPLAY``."""

    start_aware = _aware(start_at) or _now_utc()
    end_aware = _aware(end_at) or _now_utc()
    stmt = (
        select(Bar)
        .where(
            and_(
                Bar.symbol_id == symbol_id,
                Bar.tf == tf,
                Bar.t >= start_aware,
                Bar.t <= end_aware,
            )
        )
        .order_by(Bar.t.asc())
        .limit(_MAX_BARS_PER_REPLAY + 1)
    )
    rows = (await db.execute(stmt)).scalars().all()
    if len(rows) > _MAX_BARS_PER_REPLAY:
        raise ApiError(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            code="window_too_large",
            message=(
                f"replay window spans more than {_MAX_BARS_PER_REPLAY} bars "
                "— narrow the range or step up in timeframe"
            ),
        )
    return [
        EngineBar(
            symbol_id=row.symbol_id,
            t=_aware(row.t) or _now_utc(),
            o=float(row.o),
            h=float(row.h),
            l=float(row.l),
            c=float(row.c),
            v=float(row.v or 0.0),
        )
        for row in rows
    ]


async def _resolve_strategy_config(
    db,
    *,
    strategy_id: str | None,
    version_id: str | None,
) -> tuple[StrategyVersionConfigDto | None, StrategyVersion | None]:
    """If the replay is anchored to a strategy/version, load the config."""

    if version_id is None and strategy_id is None:
        return None, None

    resolved_version_id = version_id
    if resolved_version_id is None:
        stmt = select(Strategy).where(Strategy.id == strategy_id)
        strategy = (await db.execute(stmt)).scalar_one_or_none()
        if strategy is None or strategy.active_version_id is None:
            return None, None
        resolved_version_id = strategy.active_version_id

    stmt = select(StrategyVersion).where(StrategyVersion.id == resolved_version_id)
    version_row = (await db.execute(stmt)).scalar_one_or_none()
    if version_row is None:
        return None, None

    try:
        config = StrategyVersionConfigDto.model_validate(version_row.config or {})
    except ValidationError:
        return None, version_row
    return config, version_row


async def _resolve_target(
    db,
    req: ReplayRunRequestDto,
) -> tuple[str, str]:
    """Return ``(symbol_id, tf)`` from either ``setupId`` or ``symbolId``."""

    if req.setupId is not None:
        stmt = select(Setup).where(Setup.id == req.setupId)
        setup = (await db.execute(stmt)).scalar_one_or_none()
        if setup is None:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="setup_not_found",
                message=f"setup {req.setupId} not found",
            )
        return setup.symbol_id, setup.tf

    assert req.symbolId is not None  # validated upstream
    stmt = select(Symbol).where(Symbol.id == req.symbolId)
    symbol = (await db.execute(stmt)).scalar_one_or_none()
    if symbol is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="symbol_not_found",
            message=f"symbol {req.symbolId} not found",
        )
    return symbol.id, req.tf


# ────────────────────────── list ───────────────────────────────────────


@router.get(
    "/replay",
    response_model=ReplayRunsListOut,
    summary="List replay runs",
)
async def list_replays(
    db: DbSession,
    _user: CurrentUser,
    backtestStatus: str | None = Query(default=None, alias="status"),
    cursor: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
) -> ReplayRunsListOut:
    _validate_replay_status(backtestStatus)

    filters: list[Any] = []
    if backtestStatus is not None:
        filters.append(ReplayRun.status == backtestStatus)

    count_stmt = select(func.count()).select_from(ReplayRun)
    if filters:
        count_stmt = count_stmt.where(and_(*filters))
    total = (await db.execute(count_stmt)).scalar_one()

    stmt = (
        select(ReplayRun)
        .order_by(desc(ReplayRun.requested_at))
        .limit(limit)
    )
    if filters:
        stmt = stmt.where(and_(*filters))
    if cursor is not None:
        stmt = stmt.where(ReplayRun.id > cursor)
    rows = (await db.execute(stmt)).scalars().all()

    dtos: list[ReplayRunDto] = []
    for row in rows:
        dto = _replay_row_to_dto(row)
        # populate totalFrames from the persisted frame count
        frame_total = (
            await db.execute(
                select(func.count()).select_from(ReplayFrameRow).where(
                    ReplayFrameRow.replay_id == row.id
                )
            )
        ).scalar_one()
        dto.totalFrames = int(frame_total or 0)
        dtos.append(dto)

    return ReplayRunsListOut(runs=dtos, total=int(total or 0))


# ────────────────────────── detail ─────────────────────────────────────


@router.get(
    "/replay/{run_id}",
    response_model=ReplayRunDto,
    summary="Get a replay run",
)
async def get_replay(
    run_id: str,
    db: DbSession,
    _user: CurrentUser,
) -> ReplayRunDto:
    stmt = select(ReplayRun).where(ReplayRun.id == run_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="replay_not_found",
            message=f"replay {run_id} not found",
        )
    dto = _replay_row_to_dto(row)
    frame_total = (
        await db.execute(
            select(func.count()).select_from(ReplayFrameRow).where(
                ReplayFrameRow.replay_id == run_id
            )
        )
    ).scalar_one()
    dto.totalFrames = int(frame_total or 0)
    return dto


# ────────────────────────── create ─────────────────────────────────────


@router.post(
    "/replay",
    response_model=ReplayRunDto,
    status_code=status.HTTP_201_CREATED,
    summary="Enqueue + run a replay",
)
async def create_replay(
    payload: ReplayRunRequestDto,
    request: Request,
    db: DbSession,
    admin: AdminUser,
) -> ReplayRunDto:
    _validate_request_window(payload)

    symbol_id, tf = await _resolve_target(db, payload)
    if tf != payload.tf and payload.setupId is not None:
        # When the setup pins a tf, the payload's tf is ignored but we
        # don't 400 — we use the setup's tf of record for the replay
        # (matches the UI, which seeds the form from the setup row).
        tf = payload.tf if payload.setupId is None else tf

    # Strategy config (optional) — only present when the setup links to
    # one; bare ad-hoc replays run without a strategy overlay.
    strategy_id: str | None = None
    version_id: str | None = None
    if payload.setupId is not None:
        stmt_setup = select(Setup).where(Setup.id == payload.setupId)
        setup_row = (await db.execute(stmt_setup)).scalar_one_or_none()
        # For now Setup rows don't hold a strategy_id directly; if a
        # future PR adds it, pick it up here. We still pass None today.
        if setup_row is not None:
            _ = setup_row

    strategy_config, _version_row = await _resolve_strategy_config(
        db,
        strategy_id=strategy_id,
        version_id=version_id,
    )

    bars = await _load_bars(
        db,
        symbol_id=symbol_id,
        tf=tf,
        start_at=payload.startAt,
        end_at=payload.endAt,
    )
    if not bars:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="no_bars",
            message=(
                f"no bars available for symbol={symbol_id} tf={tf} "
                f"in [{payload.startAt.isoformat()}, {payload.endAt.isoformat()}]"
            ),
        )

    # Persist the run row first so we have an id before streaming frames.
    run = ReplayRun(
        strategy_id=strategy_id,
        version_id=version_id,
        status="streaming",
        symbol_ids=[symbol_id],
        tf=tf,
        from_ts=_aware(payload.startAt) or _now_utc(),
        to_ts=_aware(payload.endAt) or _now_utc(),
        cursor_ts=None,
        step_ms=int(payload.stepMs or 0),
        requested_at=_now_utc(),
        started_at=_now_utc(),
        completed_at=None,
        requested_by_user_id=getattr(admin, "id", None),
        error=None,
    )
    db.add(run)
    await db.flush()  # populate run.id

    # Run the replay synchronously (deterministic, pure python).
    config = ReplayConfig(
        replay_run_id=run.id,
        symbol_id=symbol_id,
        tf=tf,  # type: ignore[arg-type]
        bars=bars,
        strategy_config=strategy_config,
        start_at=_aware(payload.startAt),
        end_at=_aware(payload.endAt),
    )
    try:
        frames = iter_frames(config, populate_hypothetical_pnl=True)
    except Exception as exc:  # pragma: no cover — defensive
        run.status = "failed"
        run.error = str(exc)[:990]
        run.completed_at = _now_utc()
        await db.flush()
        raise ApiError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="replay_engine_error",
            message="replay engine raised — run marked failed",
        )

    # Persist every frame. We store the full DTO in ``decision`` for
    # lossless round-trip via ``_frame_row_to_dto`` even if the schema
    # evolves.
    for idx, frame in enumerate(frames):
        frame_row = ReplayFrameRow(
            replay_id=run.id,
            frame_index=idx,
            ts=frame.ts,
            decision=json.loads(frame.model_dump_json(by_alias=True)),
            bars_applied={"count": 1, "symbolId": symbol_id, "tf": tf},
        )
        db.add(frame_row)

    # Finalise run state.
    run.cursor_ts = frames[-1].ts if frames else run.to_ts
    run.status = "completed"
    run.completed_at = _now_utc()
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=getattr(admin, "id", None),
        actor_email=getattr(admin, "email", None),
        action="quant.replay.run",
        resource_type="quant.replay",
        resource_id=run.id,
        outcome="success",
        details={
            "symbolId": symbol_id,
            "tf": tf,
            "totalFrames": len(frames),
            "stepMs": int(payload.stepMs or 0),
        },
    )
    await db.commit()

    dto = _replay_row_to_dto(run)
    dto.totalFrames = len(frames)
    return dto


# ────────────────────────── frames list (paginated) ────────────────────


@router.get(
    "/replay/{run_id}/frames",
    response_model=QuantReplayFramesOut,
    summary="List persisted replay frames",
)
async def list_replay_frames(
    run_id: str,
    db: DbSession,
    _user: CurrentUser,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=5_000),
) -> QuantReplayFramesOut:
    # Ensure run exists so the 404 path doesn't leak frame rows from a
    # deleted run.
    exists = (
        await db.execute(
            select(func.count()).select_from(ReplayRun).where(ReplayRun.id == run_id)
        )
    ).scalar_one()
    if not exists:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="replay_not_found",
            message=f"replay {run_id} not found",
        )

    total = (
        await db.execute(
            select(func.count()).select_from(ReplayFrameRow).where(
                ReplayFrameRow.replay_id == run_id
            )
        )
    ).scalar_one()

    stmt = (
        select(ReplayFrameRow)
        .where(ReplayFrameRow.replay_id == run_id)
        .order_by(ReplayFrameRow.frame_index.asc())
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()

    return QuantReplayFramesOut(
        replayRunId=run_id,
        frames=[_frame_row_to_dto(row, run_id) for row in rows],
        total=int(total or 0),
    )


# ────────────────────────── SSE stream ─────────────────────────────────


async def _sse_generator(
    rows: Sequence[ReplayFrameRow],
    run_id: str,
    step_ms: int,
):
    """Yield ``text/event-stream`` chunks — one per persisted frame."""

    # Header event so the UI can prep its timeline before the first
    # frame lands.
    yield (
        "event: replay.start\n"
        f"data: {json.dumps({'runId': run_id, 'total': len(rows)})}\n\n"
    ).encode("utf-8")

    delay_s = max(0.0, min(step_ms, _MAX_STEP_MS) / 1000.0)
    for row in rows:
        dto = _frame_row_to_dto(row, run_id)
        payload = dto.model_dump_json(by_alias=True)
        yield (
            "event: replay.frame\n"
            f"id: {row.frame_index}\n"
            f"data: {payload}\n\n"
        ).encode("utf-8")
        if delay_s > 0:
            await asyncio.sleep(delay_s)

    yield (
        "event: replay.end\n"
        f"data: {json.dumps({'runId': run_id, 'total': len(rows)})}\n\n"
    ).encode("utf-8")


@router.get(
    "/replay/{run_id}/stream",
    summary="SSE stream of replay frames",
    response_class=StreamingResponse,
)
async def stream_replay(
    run_id: str,
    db: DbSession,
    _user: CurrentUser,
) -> StreamingResponse:
    stmt = select(ReplayRun).where(ReplayRun.id == run_id)
    run = (await db.execute(stmt)).scalar_one_or_none()
    if run is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="replay_not_found",
            message=f"replay {run_id} not found",
        )

    stmt_frames = (
        select(ReplayFrameRow)
        .where(ReplayFrameRow.replay_id == run_id)
        .order_by(ReplayFrameRow.frame_index.asc())
    )
    rows = (await db.execute(stmt_frames)).scalars().all()

    step_ms = int(run.step_ms or 0)
    generator = _sse_generator(rows, run_id, step_ms)
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# ────────────────────────── cancel ─────────────────────────────────────


@router.post(
    "/replay/{run_id}/cancel",
    response_model=ReplayRunDto,
    summary="Cancel a replay run",
)
async def cancel_replay(
    run_id: str,
    request: Request,
    db: DbSession,
    admin: AdminUser,
) -> ReplayRunDto:
    stmt = select(ReplayRun).where(ReplayRun.id == run_id)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="replay_not_found",
            message=f"replay {run_id} not found",
        )

    if row.status in _TERMINAL_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="replay_terminal",
            message=(
                f"replay {run_id} already in terminal status "
                f"'{row.status}'; cannot cancel"
            ),
        )

    row.status = "cancelled"
    row.completed_at = _now_utc()
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=getattr(admin, "id", None),
        actor_email=getattr(admin, "email", None),
        action="quant.replay.cancel",
        resource_type="quant.replay",
        resource_id=run_id,
        outcome="success",
        details={},
    )
    await db.commit()

    dto = _replay_row_to_dto(row)
    frame_total = (
        await db.execute(
            select(func.count()).select_from(ReplayFrameRow).where(
                ReplayFrameRow.replay_id == run_id
            )
        )
    ).scalar_one()
    dto.totalFrames = int(frame_total or 0)
    return dto


__all__ = ["router"]
