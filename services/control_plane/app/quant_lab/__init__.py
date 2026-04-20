"""Quant Lab — Phase 5 research core.

The :mod:`app.quant_lab` package hosts the deterministic research tooling:

* :mod:`app.quant_lab.types`             — Pydantic v2 DTOs (camelCase wire).
* :mod:`app.quant_lab.seeder`            — deterministic PRNG for friction / noise.
* :mod:`app.quant_lab.engine`            — event-driven backtest simulator.
* :mod:`app.quant_lab.replay`            — candle-by-candle replay simulator.
* :mod:`app.quant_lab.replay_types`      — Pydantic v2 replay DTOs.
* :mod:`app.quant_lab.experiment_types`  — Pydantic v2 experiment/ranking/promotion DTOs.
* :mod:`app.quant_lab.ranking`           — pure scoring + promotion FSM.

The engine is pure: given identical (strategy config, bars, friction,
latency, seed) it produces bit-identical trade ledgers, equity curves,
and metrics. That determinism is the contract backtests, replay, and
the promotion pipeline all depend on.
"""

from __future__ import annotations

from app.quant_lab.engine import (
    BacktestOutcome,
    EngineBar,
    run_backtest,
)
from app.quant_lab.experiment_types import (
    ExperimentCompleteRequestDto,
    ExperimentCreateRequestDto,
    ExperimentDto,
    ExperimentStatusLiteral,
    ExperimentsListOut,
    PromotionEventDto,
    PromotionEventsListOut,
    PromotionRequestDto,
    RankingsHistoryOut,
    RankingsListOut,
    StrategyRankingDto,
)
from app.quant_lab.ranking import (
    DEFAULT_THRESHOLDS,
    InvalidPromotionError,
    PROMOTION_STATES,
    RankingOutcome,
    TierThresholds,
    classify_tier,
    compute_composite_score,
    compute_transition,
    outcome_to_ranking_dto,
    rank_strategies,
    score_metrics,
)
from app.quant_lab.replay import (
    ReplayConfig,
    iter_frames,
    iter_frames_stream,
)
from app.quant_lab.replay_types import (
    QuantReplayFrameDto,
    QuantReplayFramesOut,
    ReplayRunDto,
    ReplayRunRequestDto,
    ReplayRunsListOut,
    ReplayStatusLiteral,
)
from app.quant_lab.seeder import DeterministicRng
from app.quant_lab.types import (
    BacktestEquityPointDto,
    BacktestMetricsDto,
    BacktestRequestDto,
    BacktestRunDto,
    BacktestTradeDto,
    StrategyCreateRequestDto,
    StrategyDto,
    StrategyVersionCreateDto,
    StrategyVersionDto,
)

__all__ = [
    "BacktestEquityPointDto",
    "BacktestMetricsDto",
    "BacktestOutcome",
    "BacktestRequestDto",
    "BacktestRunDto",
    "BacktestTradeDto",
    "DEFAULT_THRESHOLDS",
    "DeterministicRng",
    "EngineBar",
    "ExperimentCompleteRequestDto",
    "ExperimentCreateRequestDto",
    "ExperimentDto",
    "ExperimentStatusLiteral",
    "ExperimentsListOut",
    "InvalidPromotionError",
    "PROMOTION_STATES",
    "PromotionEventDto",
    "PromotionEventsListOut",
    "PromotionRequestDto",
    "QuantReplayFrameDto",
    "QuantReplayFramesOut",
    "RankingOutcome",
    "RankingsHistoryOut",
    "RankingsListOut",
    "ReplayConfig",
    "ReplayRunDto",
    "ReplayRunRequestDto",
    "ReplayRunsListOut",
    "ReplayStatusLiteral",
    "StrategyCreateRequestDto",
    "StrategyDto",
    "StrategyRankingDto",
    "StrategyVersionCreateDto",
    "StrategyVersionDto",
    "TierThresholds",
    "classify_tier",
    "compute_composite_score",
    "compute_transition",
    "iter_frames",
    "iter_frames_stream",
    "outcome_to_ranking_dto",
    "rank_strategies",
    "run_backtest",
    "score_metrics",
]
