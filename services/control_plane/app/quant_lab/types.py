"""Pydantic v2 DTOs for the Quant Lab surface.

Mirror of ``packages/types/src/quant-lab.ts`` — camelCase over the wire
via ``populate_by_name=True``. Every DTO here has a matching Zod schema
on the web side, so field names + types MUST stay in lockstep.

We deliberately *don't* reuse the ORM rows as response shapes — the DB
columns are snake_case + timezone-naive while the wire is camelCase +
ISO-8601 strings. Keeping them separate prevents contract drift when the
schema evolves.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

# ───────────────────────────── enums (mirror TS) ────────────────────────

SetupTypeLiteral = Literal[
    "liquidity_sweep_reclaim",
    "ob_retest",
    "breakout_retest",
    "fvg_reaction",
    "momentum_continuation",
    "session_reversal",
]

DirectionLiteral = Literal["long", "short"]

TimeframeLiteral = Literal[
    "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"
]

StrategyTierLiteral = Literal["A", "B", "C"]

PromotionStateLiteral = Literal[
    "experimental", "paper", "assisted_live", "autonomous", "retired"
]

BacktestStatusLiteral = Literal[
    "queued", "running", "completed", "failed", "cancelled"
]

TradeOutcomeLiteral = Literal["win", "loss", "scratch"]

ExitReasonLiteral = Literal[
    "take_profit",
    "stop_loss",
    "time_stop",
    "end_of_data",
    "cancelled",
]

StopStyleLiteral = Literal["structure", "atr", "fixed_r"]

# ───────────────────────────── base ─────────────────────────────────────


class _CamelBase(BaseModel):
    """Base model with ``populate_by_name`` so aliases + field names both work."""

    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ───────────────────────────── strategies ───────────────────────────────


class StrategyEntryRulesDto(_CamelBase):
    setupType: SetupTypeLiteral
    timeframes: list[TimeframeLiteral]
    direction: DirectionLiteral | None = None
    minConfidence: float = 0.5
    filters: dict[str, Any] = Field(default_factory=dict)


class StrategyExitRulesDto(_CamelBase):
    stopStyle: StopStyleLiteral = "structure"
    takeProfitRR: float = 2.0
    trailAfterR: float | None = None


class StrategySizingDto(_CamelBase):
    perTradeR: float = 0.005
    maxConcurrent: int = 5


class StrategyVersionConfigDto(_CamelBase):
    """The inner version config the web app sends when creating a version."""

    entry: StrategyEntryRulesDto
    exit: StrategyExitRulesDto
    sizing: StrategySizingDto
    codeHash: str
    notes: str = ""


class StrategyDto(_CamelBase):
    id: str
    name: str
    description: str = ""
    setupType: SetupTypeLiteral
    tier: StrategyTierLiteral
    promotionState: PromotionStateLiteral
    activeVersionId: str | None
    createdAt: datetime
    updatedAt: datetime
    createdByUserId: str | None


class StrategyVersionDto(_CamelBase):
    id: str
    strategyId: str
    version: int
    entry: StrategyEntryRulesDto
    exit: StrategyExitRulesDto
    sizing: StrategySizingDto
    codeHash: str
    createdAt: datetime
    createdByUserId: str | None
    notes: str = ""


class StrategyCreateRequestDto(_CamelBase):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)
    setupType: SetupTypeLiteral
    initialVersion: StrategyVersionConfigDto


class StrategyVersionCreateDto(StrategyVersionConfigDto):
    """Alias for clarity: payload for ``POST /strategies/:id/versions``."""


class StrategiesListOut(_CamelBase):
    strategies: list[StrategyDto]
    total: int


class StrategyVersionsListOut(_CamelBase):
    versions: list[StrategyVersionDto]


# ───────────────────────────── backtest ─────────────────────────────────


class BacktestRequestDto(_CamelBase):
    strategyVersionId: str
    symbolIds: list[str] = Field(min_length=1, max_length=200)
    startAt: datetime
    endAt: datetime
    frictionBps: float = Field(default=5.0, ge=0.0, le=200.0)
    latencyMs: int = Field(default=100, ge=0, le=10_000)
    startingEquity: float = Field(default=100_000.0, gt=0.0)
    seed: int = Field(default=0, ge=0)


class BacktestMetricsDto(_CamelBase):
    totalTrades: int
    wins: int
    losses: int
    scratches: int
    winRate: float
    profitFactor: float
    expectancyR: float
    sharpe: float
    sortino: float
    maxDrawdownR: float
    meanMAER: float
    meanMFER: float
    totalR: float
    startedAt: datetime
    endedAt: datetime


class BacktestRunDto(_CamelBase):
    id: str
    strategyId: str
    strategyVersionId: str
    request: BacktestRequestDto
    status: BacktestStatusLiteral
    metrics: BacktestMetricsDto | None = None
    error: str | None = None
    createdAt: datetime
    startedAt: datetime | None = None
    completedAt: datetime | None = None
    createdByUserId: str | None


class BacktestTradeDto(_CamelBase):
    id: str
    backtestId: str
    symbolId: str
    direction: DirectionLiteral
    openedAt: datetime
    closedAt: datetime
    entryPrice: float
    exitPrice: float
    stopLoss: float
    takeProfit: float
    sizeR: float
    pnlR: float
    pnlDollars: float
    outcome: TradeOutcomeLiteral
    mfeR: float
    maeR: float


class BacktestEquityPointDto(_CamelBase):
    ts: datetime
    equity: float
    cumulativeR: float
    drawdownR: float


class BacktestsListOut(_CamelBase):
    runs: list[BacktestRunDto]
    total: int


class BacktestTradesOut(_CamelBase):
    backtestId: str
    trades: list[BacktestTradeDto]
    total: int


class BacktestEquityOut(_CamelBase):
    backtestId: str
    points: list[BacktestEquityPointDto]


__all__ = [
    "BacktestEquityOut",
    "BacktestEquityPointDto",
    "BacktestMetricsDto",
    "BacktestRequestDto",
    "BacktestRunDto",
    "BacktestStatusLiteral",
    "BacktestTradeDto",
    "BacktestTradesOut",
    "BacktestsListOut",
    "DirectionLiteral",
    "ExitReasonLiteral",
    "PromotionStateLiteral",
    "SetupTypeLiteral",
    "StopStyleLiteral",
    "StrategiesListOut",
    "StrategyCreateRequestDto",
    "StrategyDto",
    "StrategyEntryRulesDto",
    "StrategyExitRulesDto",
    "StrategySizingDto",
    "StrategyTierLiteral",
    "StrategyVersionConfigDto",
    "StrategyVersionCreateDto",
    "StrategyVersionDto",
    "StrategyVersionsListOut",
    "TimeframeLiteral",
    "TradeOutcomeLiteral",
]
