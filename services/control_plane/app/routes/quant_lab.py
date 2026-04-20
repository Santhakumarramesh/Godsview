"""Authenticated Quant Lab surface — strategies, versions, backtests.

Phase 5 PR4 scope
-----------------
  * ``GET  /v1/quant/strategies`` — paginated list with filters
    (tier / promotionState / setupType). Admin-only for writes;
    every authenticated user can read.
  * ``GET  /v1/quant/strategies/{id}`` — detail.
  * ``POST /v1/quant/strategies`` — admin-only. Creates the strategy
    row + initial immutable version. Version 1 is automatically
    activated.
  * ``GET  /v1/quant/strategies/{id}/versions`` — full version log.
  * ``POST /v1/quant/strategies/{id}/versions`` — admin-only. Appends a
    new immutable StrategyVersion.
  * ``POST /v1/quant/strategies/{id}/versions/{versionId}/activate`` —
    admin-only. Atomic swap of ``strategies.active_version_id``.

  * ``GET  /v1/quant/backtests`` — paginated list, filter by strategy
    and status.
  * ``GET  /v1/quant/backtests/{id}`` — run-level detail + metrics.
  * ``POST /v1/quant/backtests`` — admin-only. Enqueues AND runs a
    backtest in the request/response cycle (fast, deterministic, pure
    Python). We mark the run completed before returning so the web app
    has the final metrics envelope in a single round-trip.
  * ``GET  /v1/quant/backtests/{id}/trades`` — paginated trade ledger.
  * ``GET  /v1/quant/backtests/{id}/equity`` — equity-curve points.
  * ``POST /v1/quant/backtests/{id}/cancel`` — admin-only. Best-effort;
    for fast-running synchronous backtests this typically flips
    ``status`` to ``cancelled`` post-hoc (useful for a long-running
    async worker variant shipped in a later PR).

Every mutation is audit-logged with ``resource_type="quant.strategy"``
or ``"quant.backtest"`` so the decision trail stays explicit.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any, Literal, Sequence

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import and_, desc, func, select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import (
    BacktestEquityPoint,
    BacktestRun,
    BacktestTrade,
    Bar,
    Strategy,
    StrategyVersion,
    Symbol,
)
from app.quant_lab import (
    BacktestEquityPointDto,
    BacktestMetricsDto,
    BacktestRequestDto,
    BacktestRunDto,
    BacktestTradeDto,
    EngineBar,
    StrategyCreateRequestDto,
    StrategyDto,
    StrategyVersionCreateDto,
    StrategyVersionDto,
    run_backtest,
)
from app.quant_lab.types import (
    BacktestEquityOut,
    BacktestTradesOut,
    BacktestsListOut,
    StrategiesListOut,
    StrategyEntryRulesDto,
    StrategyExitRulesDto,
    StrategySizingDto,
    StrategyVersionsListOut,
)

UTC = timezone.utc

router = APIRouter(prefix="/quant", tags=["quant-lab"])

# ────────────────────────── constants ─────────────────────────────────

_ALLOWED_TIERS = frozenset({"A", "B", "C"})
_ALLOWED_PROMOTION_STATES = frozenset(
    {"experimental", "paper", "assisted_live", "autonomous", "retired"}
)
_ALLOWED_SETUP_TYPES = frozenset(
    {
        "liquidity_sweep_reclaim",
        "ob_retest",
        "breakout_retest",
        "fvg_reaction",
        "momentum_continuation",
        "session_reversal",
    }
)
_BACKTEST_STATUSES = frozenset(
    {"queued", "running", "completed", "failed", "cancelled"}
)
_TERMINAL_BACKTEST_STATUSES = frozenset(
    {"completed", "failed", "cancelled"}
)

# ────────────────────────── row <-> dto mappers ───────────────────────


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _config_to_dto(config: dict[str, Any]) -> tuple[
    StrategyEntryRulesDto, StrategyExitRulesDto, StrategySizingDto
]:
    """Deserialise the persisted JSON config into typed rule DTOs.

    Falls back to sane defaults if an older version was persisted with
    an abbreviated schema so the route never blows up on a partial row.
    """

    entry_raw = config.get("entry") or {}
    exit_raw = config.get("exit") or {}
    sizing_raw = config.get("sizing") or {}
    try:
        entry = StrategyEntryRulesDto.model_validate(entry_raw)
    except ValidationError:
        entry = StrategyEntryRulesDto(
            setupType=config.get("setupType", "ob_retest"),
            timeframes=["1h"],
        )
    try:
        exit_rules = StrategyExitRulesDto.model_validate(exit_raw)
    except ValidationError:
        exit_rules = StrategyExitRulesDto()
    try:
        sizing = StrategySizingDto.model_validate(sizing_raw)
    except ValidationError:
        sizing = StrategySizingDto()
    return entry, exit_rules, sizing


def _strategy_to_dto(row: Strategy) -> StrategyDto:
    return StrategyDto(
        id=row.id,
        name=row.name,
        description=row.description,
        setupType=row.setup_type,  # type: ignore[arg-type]
        tier=row.current_tier,  # type: ignore[arg-type]
        promotionState=row.current_state,  # type: ignore[arg-type]
        activeVersionId=row.active_version_id,
        createdAt=_aware(row.created_at) or _now_utc(),
        updatedAt=_aware(row.updated_at) or _now_utc(),
        createdByUserId=row.created_by_user_id,
    )


def _version_to_dto(row: StrategyVersion) -> StrategyVersionDto:
    entry, exit_rules, sizing = _config_to_dto(row.config or {})
    return StrategyVersionDto(
        id=row.id,
        strategyId=row.strategy_id,
        version=row.version,
        entry=entry,
        exit=exit_rules,
        sizing=sizing,
        codeHash=row.code_hash,
        createdAt=_aware(row.created_at) or _now_utc(),
        createdByUserId=row.created_by_user_id,
        notes=row.notes,
    )


def _hash_config(
    entry: StrategyEntryRulesDto,
    exit_rules: StrategyExitRulesDto,
    sizing: StrategySizingDto,
) -> str:
    payload = json.dumps(
        {
            "entry": entry.model_dump(mode="json", by_alias=True),
            "exit": exit_rules.model_dump(mode="json", by_alias=True),
            "sizing": sizing.model_dump(mode="json", by_alias=True),
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:40]


def _backtest_row_to_dto(row: BacktestRun) -> BacktestRunDto:
    request = BacktestRequestDto(
        strategyVersionId=row.version_id,
        symbolIds=list(row.symbol_ids or []),
        startAt=_aware(row.from_ts) or _now_utc(),
        endAt=_aware(row.to_ts) or _now_utc(),
        frictionBps=row.slippage_bps + row.spread_bps,
        latencyMs=row.latency_ms,
        startingEquity=float(row.metrics.get("startingEquity", 100_000.0))
        if isinstance(row.metrics, dict)
        else 100_000.0,
        seed=row.seed,
    )
    metrics_dto: BacktestMetricsDto | None = None
    if isinstance(row.metrics, dict) and row.metrics.get("totalTrades") is not None:
        try:
            metrics_dto = BacktestMetricsDto.model_validate(row.metrics)
        except ValidationError:
            metrics_dto = None
    return BacktestRunDto(
        id=row.id,
        strategyId=row.strategy_id,
        strategyVersionId=row.version_id,
        request=request,
        status=row.status,  # type: ignore[arg-type]
        metrics=metrics_dto,
        error=row.error,
        createdAt=_aware(row.requested_at) or _now_utc(),
        startedAt=_aware(row.started_at),
        completedAt=_aware(row.completed_at),
        createdByUserId=row.requested_by_user_id,
    )


def _trade_row_to_dto(row: BacktestTrade) -> BacktestTradeDto:
    pnl_r = row.pnl_r
    outcome: Literal["win", "loss", "scratch"]
    if pnl_r > 0.05:
        outcome = "win"
    elif pnl_r < -0.05:
        outcome = "loss"
    else:
        outcome = "scratch"
    return BacktestTradeDto(
        id=row.id,
        backtestId=row.run_id,
        symbolId=row.symbol_id,
        direction=row.direction,  # type: ignore[arg-type]
        openedAt=_aware(row.entry_ts) or _now_utc(),
        closedAt=_aware(row.exit_ts) or _now_utc(),
        entryPrice=row.entry_price,
        exitPrice=row.exit_price,
        stopLoss=row.stop_loss,
        takeProfit=row.take_profit,
        sizeR=row.qty,
        pnlR=row.pnl_r,
        pnlDollars=row.pnl_dollars,
        outcome=outcome,
        mfeR=row.mfe_r if row.mfe_r is not None else 0.0,
        maeR=row.mae_r if row.mae_r is not None else 0.0,
    )


def _equity_row_to_dto(row: BacktestEquityPoint) -> BacktestEquityPointDto:
    return BacktestEquityPointDto(
        ts=_aware(row.ts) or _now_utc(),
        equity=row.equity,
        cumulativeR=0.0,
        drawdownR=row.drawdown,
    )


# ────────────────────────── validation helpers ────────────────────────


def _validate_tier(tier: str | None) -> None:
    if tier is not None and tier not in _ALLOWED_TIERS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_tier",
            message=f"tier must be one of {sorted(_ALLOWED_TIERS)}",
        )


def _validate_promotion_state(value: str | None) -> None:
    if value is not None and value not in _ALLOWED_PROMOTION_STATES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_promotion_state",
            message=(
                f"promotionState must be one of "
                f"{sorted(_ALLOWED_PROMOTION_STATES)}"
            ),
        )


def _validate_setup_type(value: str | None) -> None:
    if value is not None and value not in _ALLOWED_SETUP_TYPES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_setup_type",
            message=f"setupType must be one of {sorted(_ALLOWED_SETUP_TYPES)}",
        )


def _validate_backtest_status(value: str | None) -> None:
    if value is not None and value not in _BACKTEST_STATUSES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message=f"status must be one of {sorted(_BACKTEST_STATUSES)}",
        )


# ────────────────────────── strategies ────────────────────────────────


@router.get(
    "/strategies",
    response_model=StrategiesListOut,
    summary="List strategies",
)
async def list_strategies(
    db: DbSession,
    user: CurrentUser,
    tier: str | None = Query(default=None),
    promotionState: str | None = Query(default=None),
    setupType: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> StrategiesListOut:
    _validate_tier(tier)
    _validate_promotion_state(promotionState)
    _validate_setup_type(setupType)

    conditions = []
    if tier is not None:
        conditions.append(Strategy.current_tier == tier)
    if promotionState is not None:
        conditions.append(Strategy.current_state == promotionState)
    if setupType is not None:
        conditions.append(Strategy.setup_type == setupType)

    count_stmt = select(func.count(Strategy.id))
    if conditions:
        count_stmt = count_stmt.where(and_(*conditions))
    total = int((await db.scalar(count_stmt)) or 0)

    stmt = select(Strategy)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(desc(Strategy.created_at)).offset(offset).limit(limit)
    rows = (await db.scalars(stmt)).all()

    return StrategiesListOut(
        strategies=[_strategy_to_dto(row) for row in rows],
        total=total,
    )


@router.get(
    "/strategies/{strategy_id}",
    response_model=StrategyDto,
    summary="Strategy detail",
)
async def get_strategy(
    strategy_id: str, db: DbSession, user: CurrentUser
) -> StrategyDto:
    row = await db.scalar(select(Strategy).where(Strategy.id == strategy_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {strategy_id!r} not found",
        )
    return _strategy_to_dto(row)


@router.post(
    "/strategies",
    response_model=StrategyDto,
    status_code=status.HTTP_201_CREATED,
    summary="Create a strategy (admin)",
)
async def create_strategy(
    payload: StrategyCreateRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> StrategyDto:
    existing = await db.scalar(
        select(Strategy).where(Strategy.name == payload.name)
    )
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="strategy_name_taken",
            message=f"strategy name {payload.name!r} is already in use",
        )

    initial = payload.initialVersion
    code_hash = initial.codeHash or _hash_config(
        initial.entry, initial.exit, initial.sizing
    )

    strategy_id = f"stg_{uuid.uuid4().hex}"
    version_id = f"stv_{uuid.uuid4().hex}"
    now = _now_utc()

    strategy = Strategy(
        id=strategy_id,
        name=payload.name,
        description=payload.description,
        setup_type=payload.setupType,
        active_version_id=version_id,
        current_tier="C",
        current_state="experimental",
        created_at=now,
        updated_at=now,
        created_by_user_id=user.id,
    )
    version = StrategyVersion(
        id=version_id,
        strategy_id=strategy_id,
        version=1,
        code_hash=code_hash,
        config={
            "entry": initial.entry.model_dump(mode="json", by_alias=True),
            "exit": initial.exit.model_dump(mode="json", by_alias=True),
            "sizing": initial.sizing.model_dump(mode="json", by_alias=True),
        },
        notes=initial.notes,
        created_at=now,
        created_by_user_id=user.id,
    )
    db.add(strategy)
    db.add(version)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.strategy.create",
        resource_type="quant.strategy",
        resource_id=strategy_id,
        outcome="success",
        details={
            "name": payload.name,
            "setupType": payload.setupType,
            "versionId": version_id,
            "codeHash": code_hash,
        },
    )
    await db.commit()
    await db.refresh(strategy)
    return _strategy_to_dto(strategy)


@router.get(
    "/strategies/{strategy_id}/versions",
    response_model=StrategyVersionsListOut,
    summary="List strategy versions",
)
async def list_strategy_versions(
    strategy_id: str, db: DbSession, user: CurrentUser
) -> StrategyVersionsListOut:
    strategy = await db.scalar(
        select(Strategy).where(Strategy.id == strategy_id)
    )
    if strategy is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {strategy_id!r} not found",
        )
    rows = (
        await db.scalars(
            select(StrategyVersion)
            .where(StrategyVersion.strategy_id == strategy_id)
            .order_by(desc(StrategyVersion.version))
        )
    ).all()
    return StrategyVersionsListOut(
        versions=[_version_to_dto(row) for row in rows]
    )


@router.post(
    "/strategies/{strategy_id}/versions",
    response_model=StrategyVersionDto,
    status_code=status.HTTP_201_CREATED,
    summary="Append a new strategy version (admin)",
)
async def add_strategy_version(
    strategy_id: str,
    payload: StrategyVersionCreateDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> StrategyVersionDto:
    strategy = await db.scalar(
        select(Strategy).where(Strategy.id == strategy_id)
    )
    if strategy is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {strategy_id!r} not found",
        )

    next_version = (
        await db.scalar(
            select(func.max(StrategyVersion.version)).where(
                StrategyVersion.strategy_id == strategy_id
            )
        )
    ) or 0
    next_version = int(next_version) + 1

    code_hash = payload.codeHash or _hash_config(
        payload.entry, payload.exit, payload.sizing
    )
    version_id = f"stv_{uuid.uuid4().hex}"
    now = _now_utc()

    version = StrategyVersion(
        id=version_id,
        strategy_id=strategy_id,
        version=next_version,
        code_hash=code_hash,
        config={
            "entry": payload.entry.model_dump(mode="json", by_alias=True),
            "exit": payload.exit.model_dump(mode="json", by_alias=True),
            "sizing": payload.sizing.model_dump(mode="json", by_alias=True),
        },
        notes=payload.notes,
        created_at=now,
        created_by_user_id=user.id,
    )
    db.add(version)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.strategy.version.create",
        resource_type="quant.strategy",
        resource_id=strategy_id,
        outcome="success",
        details={"versionId": version_id, "version": next_version, "codeHash": code_hash},
    )
    await db.commit()
    await db.refresh(version)
    return _version_to_dto(version)


@router.post(
    "/strategies/{strategy_id}/versions/{version_id}/activate",
    response_model=StrategyDto,
    summary="Activate a strategy version (admin)",
)
async def activate_strategy_version(
    strategy_id: str,
    version_id: str,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> StrategyDto:
    strategy = await db.scalar(
        select(Strategy).where(Strategy.id == strategy_id)
    )
    if strategy is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {strategy_id!r} not found",
        )
    version = await db.scalar(
        select(StrategyVersion).where(
            and_(
                StrategyVersion.id == version_id,
                StrategyVersion.strategy_id == strategy_id,
            )
        )
    )
    if version is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_version_not_found",
            message=f"strategy version {version_id!r} not found",
        )
    strategy.active_version_id = version_id
    strategy.updated_at = _now_utc()
    db.add(strategy)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.strategy.version.activate",
        resource_type="quant.strategy",
        resource_id=strategy_id,
        outcome="success",
        details={"versionId": version_id},
    )
    await db.commit()
    await db.refresh(strategy)
    return _strategy_to_dto(strategy)


# ────────────────────────── backtests ─────────────────────────────────


@router.get(
    "/backtests",
    response_model=BacktestsListOut,
    summary="List backtest runs",
)
async def list_backtests(
    db: DbSession,
    user: CurrentUser,
    strategyId: str | None = Query(default=None),
    backtestStatus: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> BacktestsListOut:
    _validate_backtest_status(backtestStatus)

    conditions = []
    if strategyId is not None:
        conditions.append(BacktestRun.strategy_id == strategyId)
    if backtestStatus is not None:
        conditions.append(BacktestRun.status == backtestStatus)

    count_stmt = select(func.count(BacktestRun.id))
    if conditions:
        count_stmt = count_stmt.where(and_(*conditions))
    total = int((await db.scalar(count_stmt)) or 0)

    stmt = select(BacktestRun)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = (
        stmt.order_by(desc(BacktestRun.requested_at))
        .offset(offset)
        .limit(limit)
    )
    rows = (await db.scalars(stmt)).all()

    return BacktestsListOut(
        runs=[_backtest_row_to_dto(row) for row in rows],
        total=total,
    )


@router.get(
    "/backtests/{backtest_id}",
    response_model=BacktestRunDto,
    summary="Backtest run detail",
)
async def get_backtest(
    backtest_id: str, db: DbSession, user: CurrentUser
) -> BacktestRunDto:
    row = await db.scalar(
        select(BacktestRun).where(BacktestRun.id == backtest_id)
    )
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="backtest_not_found",
            message=f"backtest {backtest_id!r} not found",
        )
    return _backtest_row_to_dto(row)


@router.post(
    "/backtests",
    response_model=BacktestRunDto,
    status_code=status.HTTP_201_CREATED,
    summary="Run a backtest (admin)",
)
async def create_backtest(
    payload: BacktestRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> BacktestRunDto:
    if payload.endAt <= payload.startAt:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_window",
            message="endAt must be after startAt",
        )

    version = await db.scalar(
        select(StrategyVersion).where(StrategyVersion.id == payload.strategyVersionId)
    )
    if version is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_version_not_found",
            message=(
                f"strategy version {payload.strategyVersionId!r} not found"
            ),
        )

    strategy = await db.scalar(
        select(Strategy).where(Strategy.id == version.strategy_id)
    )
    if strategy is None:  # pragma: no cover — FK guards this
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {version.strategy_id!r} not found",
        )

    # Validate symbols exist and share a timeframe.
    symbol_rows = (
        await db.scalars(
            select(Symbol).where(Symbol.id.in_(payload.symbolIds))
        )
    ).all()
    found_ids = {row.id for row in symbol_rows}
    missing = set(payload.symbolIds) - found_ids
    if missing:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="symbol_not_found",
            message=f"unknown symbols: {sorted(missing)}",
        )

    entry_dto, exit_dto, sizing_dto = _config_to_dto(version.config or {})
    version_config = StrategyVersionCreateDto(
        entry=entry_dto,
        exit=exit_dto,
        sizing=sizing_dto,
        codeHash=version.code_hash,
        notes=version.notes,
    )

    primary_tf = (
        entry_dto.timeframes[0] if entry_dto.timeframes else "1h"
    )

    # Load bars per symbol inside the requested window on the strategy's
    # primary timeframe. Cap at 50k bars per symbol to guard pathological
    # requests — the engine is pure Python so worst-case complexity is
    # O(bars × open_trades).
    MAX_BARS_PER_SYMBOL = 50_000
    bars_by_symbol: dict[str, Sequence[EngineBar]] = {}
    for symbol_id in payload.symbolIds:
        rows = (
            await db.scalars(
                select(Bar)
                .where(
                    and_(
                        Bar.symbol_id == symbol_id,
                        Bar.tf == primary_tf,
                        Bar.t >= payload.startAt,
                        Bar.t <= payload.endAt,
                        Bar.closed.is_(True),
                    )
                )
                .order_by(Bar.t.asc())
                .limit(MAX_BARS_PER_SYMBOL)
            )
        ).all()
        bars_by_symbol[symbol_id] = [
            EngineBar(
                symbol_id=row.symbol_id,
                t=_aware(row.t) or row.t,
                o=row.o,
                h=row.h,
                l=row.l,
                c=row.c,
                v=row.v,
            )
            for row in rows
        ]

    run_id = f"bkt_{uuid.uuid4().hex}"
    now = _now_utc()
    run = BacktestRun(
        id=run_id,
        strategy_id=strategy.id,
        version_id=version.id,
        status="running",
        requested_by_user_id=user.id,
        symbol_ids=list(payload.symbolIds),
        tf=primary_tf,
        from_ts=payload.startAt,
        to_ts=payload.endAt,
        slippage_bps=float(payload.frictionBps),
        spread_bps=0.0,
        latency_ms=int(payload.latencyMs),
        commission_per_share=0.0,
        seed=int(payload.seed),
        requested_at=now,
        started_at=now,
        metrics={},
    )
    db.add(run)
    await db.flush()

    try:
        outcome = run_backtest(
            backtest_id=run_id,
            request=payload,
            version_config=version_config,
            bars_by_symbol=bars_by_symbol,
        )
    except Exception as exc:  # pragma: no cover — surface server-side
        run.status = "failed"
        run.error = str(exc)[:900]
        run.completed_at = _now_utc()
        db.add(run)
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="quant.backtest.run",
            resource_type="quant.backtest",
            resource_id=run_id,
            outcome="failure",
            details={"error": str(exc)[:400]},
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            code="backtest_failed",
            message=str(exc)[:400],
        ) from exc

    # Persist trades + equity points.
    for idx, trade in enumerate(outcome.trades):
        db.add(
            BacktestTrade(
                id=trade.id,
                run_id=run_id,
                trade_index=idx,
                symbol_id=trade.symbolId,
                direction=trade.direction,
                entry_ts=trade.openedAt,
                exit_ts=trade.closedAt,
                entry_price=trade.entryPrice,
                exit_price=trade.exitPrice,
                stop_loss=trade.stopLoss,
                take_profit=trade.takeProfit,
                qty=trade.sizeR,
                pnl_r=trade.pnlR,
                pnl_dollars=trade.pnlDollars,
                mae_r=trade.maeR,
                mfe_r=trade.mfeR,
                setup_type=entry_dto.setupType,
                exit_reason="take_profit"
                if trade.outcome == "win"
                else ("stop_loss" if trade.outcome == "loss" else "end_of_data"),
            )
        )
    for point in outcome.equity_curve:
        db.add(
            BacktestEquityPoint(
                id=f"bkt_eq_{uuid.uuid4().hex}",
                run_id=run_id,
                ts=point.ts,
                equity=point.equity,
                drawdown=point.drawdownR,
            )
        )

    metrics_payload: dict[str, Any] = {}
    if outcome.metrics is not None:
        metrics_payload = outcome.metrics.model_dump(mode="json", by_alias=True)
    metrics_payload["startingEquity"] = payload.startingEquity

    run.status = "completed"
    run.metrics = metrics_payload
    run.completed_at = _now_utc()
    db.add(run)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.backtest.run",
        resource_type="quant.backtest",
        resource_id=run_id,
        outcome="success",
        details={
            "strategyId": strategy.id,
            "versionId": version.id,
            "trades": len(outcome.trades),
            "totalR": metrics_payload.get("totalR"),
        },
    )
    await db.commit()
    await db.refresh(run)
    return _backtest_row_to_dto(run)


@router.get(
    "/backtests/{backtest_id}/trades",
    response_model=BacktestTradesOut,
    summary="Backtest trade ledger",
)
async def list_backtest_trades(
    backtest_id: str,
    db: DbSession,
    user: CurrentUser,
    limit: int = Query(default=200, ge=1, le=2_000),
    offset: int = Query(default=0, ge=0),
) -> BacktestTradesOut:
    run = await db.scalar(
        select(BacktestRun).where(BacktestRun.id == backtest_id)
    )
    if run is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="backtest_not_found",
            message=f"backtest {backtest_id!r} not found",
        )
    total = int(
        (
            await db.scalar(
                select(func.count(BacktestTrade.id)).where(
                    BacktestTrade.run_id == backtest_id
                )
            )
        )
        or 0
    )
    rows = (
        await db.scalars(
            select(BacktestTrade)
            .where(BacktestTrade.run_id == backtest_id)
            .order_by(BacktestTrade.trade_index.asc())
            .offset(offset)
            .limit(limit)
        )
    ).all()
    return BacktestTradesOut(
        backtestId=backtest_id,
        trades=[_trade_row_to_dto(row) for row in rows],
        total=total,
    )


@router.get(
    "/backtests/{backtest_id}/equity",
    response_model=BacktestEquityOut,
    summary="Backtest equity curve",
)
async def get_backtest_equity(
    backtest_id: str, db: DbSession, user: CurrentUser
) -> BacktestEquityOut:
    run = await db.scalar(
        select(BacktestRun).where(BacktestRun.id == backtest_id)
    )
    if run is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="backtest_not_found",
            message=f"backtest {backtest_id!r} not found",
        )
    rows = (
        await db.scalars(
            select(BacktestEquityPoint)
            .where(BacktestEquityPoint.run_id == backtest_id)
            .order_by(BacktestEquityPoint.ts.asc())
        )
    ).all()
    return BacktestEquityOut(
        backtestId=backtest_id,
        points=[_equity_row_to_dto(row) for row in rows],
    )


@router.post(
    "/backtests/{backtest_id}/cancel",
    response_model=BacktestRunDto,
    summary="Cancel a backtest run (admin)",
)
async def cancel_backtest(
    backtest_id: str,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> BacktestRunDto:
    run = await db.scalar(
        select(BacktestRun).where(BacktestRun.id == backtest_id)
    )
    if run is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="backtest_not_found",
            message=f"backtest {backtest_id!r} not found",
        )
    if run.status in _TERMINAL_BACKTEST_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="backtest_terminal",
            message=f"backtest {backtest_id!r} is already in {run.status!r}",
        )
    run.status = "cancelled"
    run.completed_at = _now_utc()
    db.add(run)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.backtest.cancel",
        resource_type="quant.backtest",
        resource_id=backtest_id,
        outcome="success",
        details={},
    )
    await db.commit()
    await db.refresh(run)
    return _backtest_row_to_dto(run)


__all__ = ["router"]
