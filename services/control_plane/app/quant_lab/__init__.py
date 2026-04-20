"""Quant Lab — Phase 5 research core.

The :mod:`app.quant_lab` package hosts the deterministic research tooling:

* :mod:`app.quant_lab.types`     — Pydantic v2 DTOs (camelCase wire).
* :mod:`app.quant_lab.seeder`    — deterministic PRNG for friction / noise.
* :mod:`app.quant_lab.engine`    — event-driven backtest simulator.

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
    "DeterministicRng",
    "EngineBar",
    "QuantReplayFrameDto",
    "QuantReplayFramesOut",
    "ReplayConfig",
    "ReplayRunDto",
    "ReplayRunRequestDto",
    "ReplayRunsListOut",
    "ReplayStatusLiteral",
    "StrategyCreateRequestDto",
    "StrategyDto",
    "StrategyVersionCreateDto",
    "StrategyVersionDto",
    "iter_frames",
    "iter_frames_stream",
    "run_backtest",
]
