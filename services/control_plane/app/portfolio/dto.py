"""Portfolio wire DTOs — Pydantic v2 mirror of ``packages/types/src/portfolio.ts``.

The wire contract is camelCase; ORM-internal attributes are
snake_case. Every DTO uses ``ConfigDict(populate_by_name=True,
from_attributes=True)`` so routes can build responses directly from
ORM rows or dataclasses without a manual mapper.
"""

from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class _CamelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ──────────────────────────── per-symbol ─────────────────────────────────


class PortfolioSymbolExposureDto(_CamelBase):
    symbol_id: str = Field(..., alias="symbolId")
    correlation_class: str = Field(..., alias="correlationClass")
    direction: str
    qty: float
    notional: float
    unrealized_pnl: float = Field(..., alias="unrealizedPnl")
    unrealized_r: Optional[float] = Field(None, alias="unrealizedR")
    percent_of_equity: float = Field(..., alias="percentOfEquity")
    setup_ids: List[str] = Field(default_factory=list, alias="setupIds")
    live_trade_ids: List[str] = Field(default_factory=list, alias="liveTradeIds")


class PortfolioClassExposureDto(_CamelBase):
    correlation_class: str = Field(..., alias="correlationClass")
    symbol_count: int = Field(..., alias="symbolCount")
    net_notional: float = Field(..., alias="netNotional")
    gross_notional: float = Field(..., alias="grossNotional")
    net_percent_of_equity: float = Field(..., alias="netPercentOfEquity")
    gross_percent_of_equity: float = Field(..., alias="grossPercentOfEquity")


class PortfolioExposureWarningDto(_CamelBase):
    code: Literal[
        "gross_exposure_breach",
        "correlated_exposure_breach",
        "single_symbol_concentration",
        "drawdown_cap_approaching",
        "cross_account_duplication",
    ]
    severity: Literal["info", "warn", "critical"]
    message: str
    subject_key: Optional[str] = Field(None, alias="subjectKey")


class PortfolioExposureReportDto(_CamelBase):
    account_id: str = Field(..., alias="accountId")
    observed_at: datetime = Field(..., alias="observedAt")
    total_equity: float = Field(..., alias="totalEquity")
    gross_notional: float = Field(..., alias="grossNotional")
    net_notional: float = Field(..., alias="netNotional")
    gross_percent_of_equity: float = Field(..., alias="grossPercentOfEquity")
    net_percent_of_equity: float = Field(..., alias="netPercentOfEquity")
    by_symbol: List[PortfolioSymbolExposureDto] = Field(
        default_factory=list, alias="bySymbol"
    )
    by_correlation_class: List[PortfolioClassExposureDto] = Field(
        default_factory=list, alias="byCorrelationClass"
    )
    warnings: List[PortfolioExposureWarningDto] = Field(default_factory=list)


# ──────────────────────────── allocation ─────────────────────────────────


class StrategyAllocationDto(_CamelBase):
    strategy_id: str = Field(..., alias="strategyId")
    target_percent: float = Field(..., alias="targetPercent", ge=0.0, le=1.0)
    actual_percent: float = Field(..., alias="actualPercent")
    delta_r: float = Field(..., alias="deltaR")
    source: Literal["operator", "automated", "inherited_default"]
    reviewed_at: datetime = Field(..., alias="reviewedAt")
    tier: Literal["A", "B", "C"]
    promotion_state: Literal[
        "experimental", "paper", "assisted_live", "autonomous", "retired"
    ] = Field(..., alias="promotionState")
    dna_tier: Optional[Literal["A", "B", "C"]] = Field(None, alias="dnaTier")


class AllocationPlanDto(_CamelBase):
    account_id: str = Field(..., alias="accountId")
    observed_at: datetime = Field(..., alias="observedAt")
    strategies: List[StrategyAllocationDto] = Field(default_factory=list)
    total_target_percent: float = Field(..., alias="totalTargetPercent")
    total_actual_percent: float = Field(..., alias="totalActualPercent")
    in_policy: bool = Field(..., alias="inPolicy")
    warnings: List[PortfolioExposureWarningDto] = Field(default_factory=list)


class AllocationUpdateRequestDto(_CamelBase):
    strategy_id: str = Field(..., alias="strategyId")
    target_percent: float = Field(..., alias="targetPercent", ge=0.0, le=1.0)
    reason: str = Field(..., min_length=3, max_length=280)


# ──────────────────────────── PnL ────────────────────────────────────────


class PortfolioPnlPointDto(_CamelBase):
    observed_date: str = Field(..., alias="observedDate")
    start_equity: float = Field(..., alias="startEquity")
    end_equity: float = Field(..., alias="endEquity")
    realized: float
    unrealized: float
    fees: float
    net_pnl: float = Field(..., alias="netPnl")
    r_today: float = Field(..., alias="rToday")
    cumulative_r: float = Field(..., alias="cumulativeR")
    drawdown_r: float = Field(..., alias="drawdownR")
    peak_equity: float = Field(..., alias="peakEquity")
    trade_count: int = Field(..., alias="tradeCount", ge=0)


class PortfolioPnlSummaryDto(_CamelBase):
    account_id: str = Field(..., alias="accountId")
    start_date: str = Field(..., alias="startDate")
    end_date: str = Field(..., alias="endDate")
    starting_equity: float = Field(..., alias="startingEquity")
    ending_equity: float = Field(..., alias="endingEquity")
    gross_pnl: float = Field(..., alias="grossPnl")
    net_pnl: float = Field(..., alias="netPnl")
    total_r: float = Field(..., alias="totalR")
    max_drawdown_r: float = Field(..., alias="maxDrawdownR")
    win_rate: float = Field(..., alias="winRate")
    trade_count: int = Field(..., alias="tradeCount", ge=0)
    winning_trades: int = Field(..., alias="winningTrades", ge=0)
    losing_trades: int = Field(..., alias="losingTrades", ge=0)
    scratch_trades: int = Field(..., alias="scratchTrades", ge=0)
    best_day_r: float = Field(..., alias="bestDayR")
    worst_day_r: float = Field(..., alias="worstDayR")


class PortfolioPnlReportDto(_CamelBase):
    summary: PortfolioPnlSummaryDto
    points: List[PortfolioPnlPointDto] = Field(default_factory=list)


# ──────────────────────────── accounts ───────────────────────────────────


class PortfolioAccountDto(_CamelBase):
    account_id: str = Field(..., alias="accountId")
    display_name: str = Field(..., alias="displayName")
    provider: str
    live_enabled: bool = Field(..., alias="liveEnabled")


class PortfolioAccountsListOut(_CamelBase):
    accounts: List[PortfolioAccountDto] = Field(default_factory=list)


__all__ = [
    "AllocationPlanDto",
    "AllocationUpdateRequestDto",
    "PortfolioAccountDto",
    "PortfolioAccountsListOut",
    "PortfolioClassExposureDto",
    "PortfolioExposureReportDto",
    "PortfolioExposureWarningDto",
    "PortfolioPnlPointDto",
    "PortfolioPnlReportDto",
    "PortfolioPnlSummaryDto",
    "PortfolioSymbolExposureDto",
    "StrategyAllocationDto",
]
