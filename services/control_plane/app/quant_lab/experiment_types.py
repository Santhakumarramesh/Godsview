"""Pydantic v2 DTOs for the Quant Lab — Phase 5 PR6 experiment surface.

Mirror of the experiment / ranking / promotion shapes in
``packages/types/src/quant-lab.ts``. Kept in a dedicated module so the
PR4 ``types.py`` module can stay focused on strategies + backtests.

Every DTO wears the same ``ConfigDict(populate_by_name=True,
from_attributes=True)`` so SQLAlchemy rows can be fed directly into
``.model_validate(row, from_attributes=True)`` when that is convenient
— even though route code prefers explicit mappers for clarity.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.quant_lab.types import (
    BacktestMetricsDto,
    PromotionStateLiteral,
    StrategyTierLiteral,
)

# ───────────────────────────── enums ─────────────────────────────────────

ExperimentStatusLiteral = Literal["draft", "running", "completed", "cancelled"]


class _CamelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ───────────────────────────── experiments ───────────────────────────────


class ExperimentDto(_CamelBase):
    id: str
    name: str
    hypothesis: str = ""
    strategyId: str
    backtestIds: list[str] = Field(default_factory=list)
    status: ExperimentStatusLiteral
    winningBacktestId: str | None = None
    verdict: str = ""
    createdAt: datetime
    completedAt: datetime | None = None
    createdByUserId: str | None = None


class ExperimentCreateRequestDto(_CamelBase):
    name: str = Field(min_length=1, max_length=200)
    hypothesis: str = Field(default="", max_length=2000)
    strategyId: str = Field(min_length=1)


class ExperimentCompleteRequestDto(_CamelBase):
    winningBacktestId: str | None = None
    verdict: str = Field(default="", max_length=2000)


class ExperimentsListOut(_CamelBase):
    experiments: list[ExperimentDto]
    total: int


# ───────────────────────────── rankings ──────────────────────────────────


class StrategyRankingDto(_CamelBase):
    id: str
    strategyId: str
    tier: StrategyTierLiteral
    compositeScore: float = Field(ge=0.0, le=1.0)
    bestMetrics: BacktestMetricsDto | None = None
    liveMetrics: BacktestMetricsDto | None = None
    rank: int = Field(ge=1)
    rationale: str = ""
    rankedAt: datetime


class RankingsListOut(_CamelBase):
    rankings: list[StrategyRankingDto]
    generatedAt: datetime


class RankingsHistoryOut(_CamelBase):
    rankings: list[StrategyRankingDto]


# ───────────────────────────── promotion ─────────────────────────────────


class PromotionEventDto(_CamelBase):
    id: str
    strategyId: str
    fromState: PromotionStateLiteral
    toState: PromotionStateLiteral
    reason: str
    triggeredByUserId: str | None = None
    automated: bool
    occurredAt: datetime


class PromotionEventsListOut(_CamelBase):
    strategyId: str
    events: list[PromotionEventDto]


class PromotionRequestDto(_CamelBase):
    targetState: PromotionStateLiteral
    reason: str = Field(min_length=1, max_length=2000)


__all__ = [
    "ExperimentCompleteRequestDto",
    "ExperimentCreateRequestDto",
    "ExperimentDto",
    "ExperimentStatusLiteral",
    "ExperimentsListOut",
    "PromotionEventDto",
    "PromotionEventsListOut",
    "PromotionRequestDto",
    "RankingsHistoryOut",
    "RankingsListOut",
    "StrategyRankingDto",
]
