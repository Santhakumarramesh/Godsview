"""Quant Lab experiments, rankings, and promotion pipeline — Phase 5 PR6.

Scope of this module
====================

Experiment tracker
------------------
  * ``GET  /v1/quant/experiments``             — paginated list.
  * ``GET  /v1/quant/experiments/{id}``        — detail with candidate ids.
  * ``POST /v1/quant/experiments``             — admin; create draft experiment.
  * ``POST /v1/quant/experiments/{id}/backtests/{backtestId}`` — attach.
  * ``DELETE /v1/quant/experiments/{id}/backtests/{backtestId}`` — detach.
  * ``POST /v1/quant/experiments/{id}/complete`` — admin; lock verdict.

Strategy ranking
----------------
  * ``GET  /v1/quant/rankings``                — latest snapshot cohort.
  * ``GET  /v1/quant/rankings/history``        — per-strategy history.
  * ``POST /v1/quant/rankings/recompute``      — admin; fresh scoring pass.

Promotion FSM
-------------
  * ``GET  /v1/quant/strategies/{id}/promotion`` — event log.
  * ``POST /v1/quant/strategies/{id}/promote``   — admin; forward hop.
  * ``POST /v1/quant/strategies/{id}/demote``    — admin or auto; backward.

Every mutation is audit-logged (``resource_type`` ∈
{``"quant.experiment"``, ``"quant.ranking"``, ``"quant.promotion"``}).

The ranking pass is synchronous + deterministic — we read the latest
completed backtest per strategy, feed it into
:func:`app.quant_lab.ranking.score_metrics`, and persist a
``StrategyRanking`` row. The request/response cycle returns the fresh
cohort so the web app does not need a round-trip.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Sequence

from fastapi import APIRouter, Query, Request, status
from pydantic import ValidationError
from sqlalchemy import and_, desc, func, select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import (
    BacktestRun,
    Experiment,
    ExperimentBacktest,
    PromotionEvent,
    Strategy,
    StrategyRanking,
)
from app.quant_lab import (
    BacktestMetricsDto,
    DEFAULT_THRESHOLDS,
    ExperimentCompleteRequestDto,
    ExperimentCreateRequestDto,
    ExperimentDto,
    ExperimentsListOut,
    InvalidPromotionError,
    PromotionEventDto,
    PromotionEventsListOut,
    PromotionRequestDto,
    RankingOutcome,
    RankingsHistoryOut,
    RankingsListOut,
    StrategyRankingDto,
    compute_transition,
    outcome_to_ranking_dto,
    rank_strategies,
    score_metrics,
)

UTC = timezone.utc

router = APIRouter(prefix="/quant", tags=["quant-lab-experiments"])

# ────────────────────────── constants ──────────────────────────────────

_EXPERIMENT_STATUSES = frozenset({"draft", "running", "completed", "cancelled"})
_TERMINAL_EXPERIMENT_STATUSES = frozenset({"completed", "cancelled"})

_ALLOWED_PROMOTION_TARGETS = frozenset(
    {"experimental", "paper", "assisted_live", "autonomous", "retired"}
)

_MAX_RANK_WINDOW_DAYS = 120  # sane cap for "latest lab metrics"

# ────────────────────────── helpers ───────────────────────────────────


def _now_utc() -> datetime:
    return datetime.now(UTC)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


async def _load_backtest_ids(db, experiment_id: str) -> list[str]:
    rows = (
        await db.scalars(
            select(ExperimentBacktest.backtest_run_id)
            .where(ExperimentBacktest.experiment_id == experiment_id)
            .order_by(ExperimentBacktest.attached_at.asc())
        )
    ).all()
    return [row for row in rows]


def _experiment_row_to_dto(row: Experiment, backtest_ids: list[str]) -> ExperimentDto:
    return ExperimentDto(
        id=row.id,
        name=row.name,
        hypothesis=row.hypothesis,
        strategyId=row.strategy_id,
        backtestIds=backtest_ids,
        status=row.status,  # type: ignore[arg-type]
        winningBacktestId=row.winning_backtest_id,
        verdict=row.verdict or "",
        createdAt=_aware(row.created_at) or _now_utc(),
        completedAt=_aware(row.completed_at),
        createdByUserId=row.created_by_user_id,
    )


def _metrics_from_row(row: BacktestRun) -> BacktestMetricsDto | None:
    if not isinstance(row.metrics, dict) or row.metrics.get("totalTrades") is None:
        return None
    try:
        return BacktestMetricsDto.model_validate(row.metrics)
    except ValidationError:
        return None


def _promotion_row_to_dto(row: PromotionEvent) -> PromotionEventDto:
    return PromotionEventDto(
        id=row.id,
        strategyId=row.strategy_id,
        fromState=row.from_state,  # type: ignore[arg-type]
        toState=row.to_state,  # type: ignore[arg-type]
        reason=row.reason or "",
        triggeredByUserId=row.actor_user_id,
        automated=row.auto,
        occurredAt=_aware(row.occurred_at) or _now_utc(),
    )


def _ranking_row_to_dto(row: StrategyRanking, rank: int) -> StrategyRankingDto:
    reasons_raw: Any = row.reasons
    if isinstance(reasons_raw, list) and reasons_raw:
        rationale = str(reasons_raw[0])
    elif isinstance(reasons_raw, list):
        rationale = ""
    else:
        rationale = str(reasons_raw) if reasons_raw is not None else ""
    return StrategyRankingDto(
        id=row.id,
        strategyId=row.strategy_id,
        tier=row.tier,  # type: ignore[arg-type]
        compositeScore=row.score,
        bestMetrics=None,  # persisted aggregate only keeps scalars
        liveMetrics=None,
        rank=rank,
        rationale=rationale,
        rankedAt=_aware(row.computed_at) or _now_utc(),
    )


def _validate_experiment_status(value: str | None) -> None:
    if value is not None and value not in _EXPERIMENT_STATUSES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_status",
            message=f"status must be one of {sorted(_EXPERIMENT_STATUSES)}",
        )


# ────────────────────────── experiments ───────────────────────────────


@router.get(
    "/experiments",
    response_model=ExperimentsListOut,
    summary="List experiments",
)
async def list_experiments(
    db: DbSession,
    user: CurrentUser,
    strategyId: str | None = Query(default=None),
    experimentStatus: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> ExperimentsListOut:
    _validate_experiment_status(experimentStatus)

    conditions = []
    if strategyId is not None:
        conditions.append(Experiment.strategy_id == strategyId)
    if experimentStatus is not None:
        conditions.append(Experiment.status == experimentStatus)

    count_stmt = select(func.count(Experiment.id))
    if conditions:
        count_stmt = count_stmt.where(and_(*conditions))
    total = int((await db.scalar(count_stmt)) or 0)

    stmt = select(Experiment)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    stmt = stmt.order_by(desc(Experiment.created_at)).offset(offset).limit(limit)
    rows = (await db.scalars(stmt)).all()

    dtos: list[ExperimentDto] = []
    for row in rows:
        backtest_ids = await _load_backtest_ids(db, row.id)
        dtos.append(_experiment_row_to_dto(row, backtest_ids))
    return ExperimentsListOut(experiments=dtos, total=total)


@router.get(
    "/experiments/{experiment_id}",
    response_model=ExperimentDto,
    summary="Experiment detail",
)
async def get_experiment(
    experiment_id: str, db: DbSession, user: CurrentUser
) -> ExperimentDto:
    row = await db.scalar(select(Experiment).where(Experiment.id == experiment_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="experiment_not_found",
            message=f"experiment {experiment_id!r} not found",
        )
    return _experiment_row_to_dto(row, await _load_backtest_ids(db, row.id))


@router.post(
    "/experiments",
    response_model=ExperimentDto,
    status_code=status.HTTP_201_CREATED,
    summary="Create an experiment (admin)",
)
async def create_experiment(
    payload: ExperimentCreateRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> ExperimentDto:
    strategy = await db.scalar(
        select(Strategy).where(Strategy.id == payload.strategyId)
    )
    if strategy is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {payload.strategyId!r} not found",
        )

    experiment_id = f"exp_{uuid.uuid4().hex}"
    now = _now_utc()
    exp = Experiment(
        id=experiment_id,
        name=payload.name,
        hypothesis=payload.hypothesis,
        strategy_id=payload.strategyId,
        status="draft",
        winning_backtest_id=None,
        verdict=None,
        created_at=now,
        completed_at=None,
        created_by_user_id=user.id,
    )
    db.add(exp)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.experiment.create",
        resource_type="quant.experiment",
        resource_id=experiment_id,
        outcome="success",
        details={"name": payload.name, "strategyId": payload.strategyId},
    )
    await db.commit()
    await db.refresh(exp)
    return _experiment_row_to_dto(exp, [])


@router.post(
    "/experiments/{experiment_id}/backtests/{backtest_id}",
    response_model=ExperimentDto,
    summary="Attach a backtest run to an experiment (admin)",
)
async def attach_backtest(
    experiment_id: str,
    backtest_id: str,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> ExperimentDto:
    exp = await db.scalar(
        select(Experiment).where(Experiment.id == experiment_id)
    )
    if exp is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="experiment_not_found",
            message=f"experiment {experiment_id!r} not found",
        )
    if exp.status in _TERMINAL_EXPERIMENT_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="experiment_terminal",
            message=f"experiment {experiment_id!r} is already {exp.status!r}",
        )
    run = await db.scalar(
        select(BacktestRun).where(BacktestRun.id == backtest_id)
    )
    if run is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="backtest_not_found",
            message=f"backtest {backtest_id!r} not found",
        )
    if run.strategy_id != exp.strategy_id:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="strategy_mismatch",
            message=(
                "backtest strategy does not match experiment strategy"
            ),
        )

    existing = await db.scalar(
        select(ExperimentBacktest).where(
            and_(
                ExperimentBacktest.experiment_id == experiment_id,
                ExperimentBacktest.backtest_run_id == backtest_id,
            )
        )
    )
    if existing is None:
        link = ExperimentBacktest(
            experiment_id=experiment_id,
            backtest_run_id=backtest_id,
            role="candidate",
            attached_at=_now_utc(),
        )
        db.add(link)

    # Kick the experiment into ``running`` once it has at least one
    # attached run.
    if exp.status == "draft":
        exp.status = "running"
        db.add(exp)

    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.experiment.attach",
        resource_type="quant.experiment",
        resource_id=experiment_id,
        outcome="success",
        details={"backtestId": backtest_id},
    )
    await db.commit()
    await db.refresh(exp)
    return _experiment_row_to_dto(exp, await _load_backtest_ids(db, experiment_id))


@router.delete(
    "/experiments/{experiment_id}/backtests/{backtest_id}",
    response_model=ExperimentDto,
    summary="Detach a backtest run from an experiment (admin)",
)
async def detach_backtest(
    experiment_id: str,
    backtest_id: str,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> ExperimentDto:
    exp = await db.scalar(
        select(Experiment).where(Experiment.id == experiment_id)
    )
    if exp is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="experiment_not_found",
            message=f"experiment {experiment_id!r} not found",
        )
    if exp.status in _TERMINAL_EXPERIMENT_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="experiment_terminal",
            message=f"experiment {experiment_id!r} is already {exp.status!r}",
        )

    link = await db.scalar(
        select(ExperimentBacktest).where(
            and_(
                ExperimentBacktest.experiment_id == experiment_id,
                ExperimentBacktest.backtest_run_id == backtest_id,
            )
        )
    )
    if link is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="experiment_link_not_found",
            message=(
                f"backtest {backtest_id!r} is not attached to "
                f"experiment {experiment_id!r}"
            ),
        )
    await db.delete(link)

    # Clear winner pointer if the detached run was the winner.
    if exp.winning_backtest_id == backtest_id:
        exp.winning_backtest_id = None
        db.add(exp)

    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.experiment.detach",
        resource_type="quant.experiment",
        resource_id=experiment_id,
        outcome="success",
        details={"backtestId": backtest_id},
    )
    await db.commit()
    await db.refresh(exp)
    return _experiment_row_to_dto(exp, await _load_backtest_ids(db, experiment_id))


@router.post(
    "/experiments/{experiment_id}/complete",
    response_model=ExperimentDto,
    summary="Lock experiment verdict (admin)",
)
async def complete_experiment(
    experiment_id: str,
    payload: ExperimentCompleteRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> ExperimentDto:
    exp = await db.scalar(
        select(Experiment).where(Experiment.id == experiment_id)
    )
    if exp is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="experiment_not_found",
            message=f"experiment {experiment_id!r} not found",
        )
    if exp.status in _TERMINAL_EXPERIMENT_STATUSES:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="experiment_terminal",
            message=f"experiment {experiment_id!r} is already {exp.status!r}",
        )

    if payload.winningBacktestId is not None:
        link = await db.scalar(
            select(ExperimentBacktest).where(
                and_(
                    ExperimentBacktest.experiment_id == experiment_id,
                    ExperimentBacktest.backtest_run_id
                    == payload.winningBacktestId,
                )
            )
        )
        if link is None:
            raise ApiError(
                status_code=status.HTTP_400_BAD_REQUEST,
                code="winning_backtest_not_attached",
                message=(
                    "winningBacktestId must reference a backtest attached "
                    "to this experiment"
                ),
            )

    exp.status = "completed"
    exp.winning_backtest_id = payload.winningBacktestId
    exp.verdict = payload.verdict or ""
    exp.completed_at = _now_utc()
    db.add(exp)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.experiment.complete",
        resource_type="quant.experiment",
        resource_id=experiment_id,
        outcome="success",
        details={
            "winningBacktestId": payload.winningBacktestId,
            "verdictLen": len(payload.verdict or ""),
        },
    )
    await db.commit()
    await db.refresh(exp)
    return _experiment_row_to_dto(exp, await _load_backtest_ids(db, experiment_id))


# ────────────────────────── rankings ──────────────────────────────────


async def _latest_metrics_per_strategy(
    db,
) -> dict[str, BacktestMetricsDto]:
    """Find the most-recent *completed* BacktestRun per strategy and
    project its metrics envelope. Strategies without any completed run
    are omitted.
    """

    rows: Sequence[BacktestRun] = (
        await db.scalars(
            select(BacktestRun)
            .where(BacktestRun.status == "completed")
            .order_by(desc(BacktestRun.completed_at))
        )
    ).all()
    out: dict[str, BacktestMetricsDto] = {}
    for row in rows:
        if row.strategy_id in out:
            continue
        metrics = _metrics_from_row(row)
        if metrics is None:
            continue
        out[row.strategy_id] = metrics
    return out


async def _latest_rankings_snapshot(db) -> list[StrategyRanking]:
    """Return the newest ranking row per strategy (one per strategy)."""

    rows: Sequence[StrategyRanking] = (
        await db.scalars(
            select(StrategyRanking).order_by(desc(StrategyRanking.computed_at))
        )
    ).all()
    seen: set[str] = set()
    latest: list[StrategyRanking] = []
    for row in rows:
        if row.strategy_id in seen:
            continue
        seen.add(row.strategy_id)
        latest.append(row)
    return latest


@router.get(
    "/rankings",
    response_model=RankingsListOut,
    summary="Latest strategy ranking snapshot",
)
async def list_latest_rankings(
    db: DbSession, user: CurrentUser
) -> RankingsListOut:
    rows = await _latest_rankings_snapshot(db)
    # Sort by score desc, strategy_id asc for stable rank assignment.
    rows.sort(key=lambda r: (-r.score, r.strategy_id))
    dtos = [_ranking_row_to_dto(row, idx + 1) for idx, row in enumerate(rows)]
    generated_at = (
        max((_aware(r.computed_at) or _now_utc() for r in rows))
        if rows
        else _now_utc()
    )
    return RankingsListOut(rankings=dtos, generatedAt=generated_at)


@router.get(
    "/rankings/history",
    response_model=RankingsHistoryOut,
    summary="Per-strategy ranking history",
)
async def list_ranking_history(
    db: DbSession,
    user: CurrentUser,
    strategyId: str = Query(..., min_length=1),
    limit: int = Query(default=100, ge=1, le=1_000),
) -> RankingsHistoryOut:
    rows = (
        await db.scalars(
            select(StrategyRanking)
            .where(StrategyRanking.strategy_id == strategyId)
            .order_by(desc(StrategyRanking.computed_at))
            .limit(limit)
        )
    ).all()
    # History entries all share the same strategy — rank is meaningless
    # here but the DTO requires a positive int; surface the reverse
    # chronological position instead.
    dtos = [_ranking_row_to_dto(row, idx + 1) for idx, row in enumerate(rows)]
    return RankingsHistoryOut(rankings=dtos)


@router.post(
    "/rankings/recompute",
    response_model=RankingsListOut,
    status_code=status.HTTP_200_OK,
    summary="Recompute strategy rankings (admin)",
)
async def recompute_rankings(
    request: Request, db: DbSession, user: AdminUser
) -> RankingsListOut:
    metrics_map = await _latest_metrics_per_strategy(db)
    if not metrics_map:
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="quant.ranking.recompute",
            resource_type="quant.ranking",
            resource_id=None,
            outcome="success",
            details={"scored": 0},
        )
        await db.commit()
        return RankingsListOut(rankings=[], generatedAt=_now_utc())

    outcomes: list[tuple[str, RankingOutcome]] = [
        (sid, score_metrics(metrics, thresholds=DEFAULT_THRESHOLDS))
        for sid, metrics in metrics_map.items()
    ]
    ranked = rank_strategies(outcomes)

    now = _now_utc()
    dtos: list[StrategyRankingDto] = []
    for sid, outcome, rank in ranked:
        ranking_id = f"rnk_{uuid.uuid4().hex}"
        best = outcome.best
        row = StrategyRanking(
            id=ranking_id,
            computed_at=now,
            strategy_id=sid,
            tier=outcome.tier,
            score=float(outcome.composite_score),
            sample_size=best.totalTrades,
            sharpe=float(best.sharpe),
            profit_factor=float(best.profitFactor),
            win_rate=float(best.winRate),
            drawdown=float(best.maxDrawdownR),
            expectancy=float(best.expectancyR),
            reasons=[outcome.rationale],
        )
        db.add(row)

        # Mirror the live tier onto the strategy row so the UI can render
        # it without joining to the rankings table.
        strategy = await db.scalar(select(Strategy).where(Strategy.id == sid))
        if strategy is not None and strategy.current_tier != outcome.tier:
            strategy.current_tier = outcome.tier
            strategy.updated_at = now
            db.add(strategy)

        dtos.append(
            outcome_to_ranking_dto(
                ranking_id=ranking_id,
                strategy_id=sid,
                outcome=outcome,
                rank=rank,
                ranked_at=now,
            )
        )

    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="quant.ranking.recompute",
        resource_type="quant.ranking",
        resource_id=None,
        outcome="success",
        details={"scored": len(ranked)},
    )
    await db.commit()
    return RankingsListOut(rankings=dtos, generatedAt=now)


# ────────────────────────── promotion FSM ─────────────────────────────


async def _apply_promotion(
    *,
    db,
    request: Request,
    user_id: str,
    user_email: str,
    strategy_id: str,
    target_state: str,
    reason: str,
    audit_action: str,
) -> Strategy:
    strategy = await db.scalar(
        select(Strategy).where(Strategy.id == strategy_id)
    )
    if strategy is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="strategy_not_found",
            message=f"strategy {strategy_id!r} not found",
        )
    if target_state not in _ALLOWED_PROMOTION_TARGETS:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_target_state",
            message=(
                f"targetState must be one of "
                f"{sorted(_ALLOWED_PROMOTION_TARGETS)}"
            ),
        )
    try:
        resolved = compute_transition(
            strategy.current_state,  # type: ignore[arg-type]
            target_state,  # type: ignore[arg-type]
            strategy.current_tier,  # type: ignore[arg-type]
        )
    except InvalidPromotionError as exc:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code=exc.code,
            message=exc.message,
        ) from exc

    now = _now_utc()
    event = PromotionEvent(
        id=f"prm_{uuid.uuid4().hex}",
        strategy_id=strategy_id,
        from_state=strategy.current_state,
        to_state=resolved,
        reason=reason,
        occurred_at=now,
        actor_user_id=user_id,
        auto=False,
        ranking_id=None,
    )
    db.add(event)

    strategy.current_state = resolved
    strategy.updated_at = now
    db.add(strategy)
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user_id,
        actor_email=user_email,
        action=audit_action,
        resource_type="quant.promotion",
        resource_id=strategy_id,
        outcome="success",
        details={
            "fromState": event.from_state,
            "toState": event.to_state,
            "reasonLen": len(reason or ""),
        },
    )
    await db.commit()
    await db.refresh(strategy)
    return strategy


@router.get(
    "/strategies/{strategy_id}/promotion",
    response_model=PromotionEventsListOut,
    summary="Promotion event history",
)
async def list_promotion_history(
    strategy_id: str,
    db: DbSession,
    user: CurrentUser,
    limit: int = Query(default=200, ge=1, le=1_000),
) -> PromotionEventsListOut:
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
            select(PromotionEvent)
            .where(PromotionEvent.strategy_id == strategy_id)
            .order_by(desc(PromotionEvent.occurred_at))
            .limit(limit)
        )
    ).all()
    return PromotionEventsListOut(
        strategyId=strategy_id,
        events=[_promotion_row_to_dto(row) for row in rows],
    )


@router.post(
    "/strategies/{strategy_id}/promote",
    response_model=dict,
    summary="Promote a strategy (admin)",
)
async def promote_strategy(
    strategy_id: str,
    payload: PromotionRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> dict[str, Any]:
    strategy = await _apply_promotion(
        db=db,
        request=request,
        user_id=user.id,
        user_email=user.email,
        strategy_id=strategy_id,
        target_state=payload.targetState,
        reason=payload.reason,
        audit_action="quant.promotion.promote",
    )
    return {
        "id": strategy.id,
        "promotionState": strategy.current_state,
        "tier": strategy.current_tier,
        "updatedAt": (_aware(strategy.updated_at) or _now_utc()).isoformat(),
    }


@router.post(
    "/strategies/{strategy_id}/demote",
    response_model=dict,
    summary="Demote a strategy (admin)",
)
async def demote_strategy(
    strategy_id: str,
    payload: PromotionRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> dict[str, Any]:
    strategy = await _apply_promotion(
        db=db,
        request=request,
        user_id=user.id,
        user_email=user.email,
        strategy_id=strategy_id,
        target_state=payload.targetState,
        reason=payload.reason,
        audit_action="quant.promotion.demote",
    )
    return {
        "id": strategy.id,
        "promotionState": strategy.current_state,
        "tier": strategy.current_tier,
        "updatedAt": (_aware(strategy.updated_at) or _now_utc()).isoformat(),
    }


__all__ = ["router"]
