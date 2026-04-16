"""
GodsView v2 — Canonical domain types (dataclasses + pydantic models).

These are the single source of truth for data flowing between services.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Enumerations ───────────────────────────────────────────────────────────────

class Direction(str, Enum):
    LONG  = "long"
    SHORT = "short"


class SignalType(str, Enum):
    ABSORPTION_REVERSAL = "absorption_reversal"
    LIQUIDITY_SWEEP     = "liquidity_sweep"
    BREAKOUT            = "breakout"
    REVERSION           = "reversion"


class OrderSide(str, Enum):
    BUY  = "buy"
    SELL = "sell"


class OrderStatus(str, Enum):
    PENDING   = "pending"
    FILLED    = "filled"
    PARTIAL   = "partial"
    CANCELLED = "cancelled"
    REJECTED  = "rejected"


class TradeOutcome(str, Enum):
    WIN  = "win"
    LOSS = "loss"
    OPEN = "open"
    BE   = "breakeven"


class Timeframe(str, Enum):
    M1  = "1min"
    M5  = "5min"
    M15 = "15min"
    M30 = "30min"
    H1  = "1hour"
    H2  = "2hour"
    H4  = "4hour"
    H8  = "8hour"
    H12 = "12hour"
    D1  = "1day"


# ── Primitive OHLCV bar ────────────────────────────────────────────────────────

@dataclass(slots=True)
class Bar:
    symbol:    str
    timestamp: datetime
    open:      float
    high:      float
    low:       float
    close:     float
    volume:    float
    timeframe: str = "1min"
    vwap:      Optional[float] = None
    trades:    Optional[int] = None

    @property
    def body_size(self) -> float:
        return abs(self.close - self.open)

    @property
    def range_size(self) -> float:
        return self.high - self.low

    @property
    def is_bullish(self) -> bool:
        return self.close >= self.open


# ── Signal ────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Signal:
    id:            str
    symbol:        str
    timeframe:     str
    timestamp:     datetime
    direction:     Direction
    signal_type:   SignalType
    entry:         float
    stop:          float
    target:        float
    confidence:    float          # 0–1
    structure_score: float = 0.0
    order_flow_score: float = 0.0
    volume_score:  float = 0.0
    atr:           float = 0.0
    ema20:         float = 0.0
    risk_reward:   float = 0.0
    approved_by_si: Optional[bool] = None
    win_probability: Optional[float] = None
    meta:          dict[str, Any] = field(default_factory=dict)


# ── Trade ─────────────────────────────────────────────────────────────────────

@dataclass(slots=True)
class Trade:
    id:            str
    signal_id:     str
    symbol:        str
    direction:     Direction
    entry_price:   float
    stop_price:    float
    target_price:  float
    size:          float          # units / contracts
    entry_time:    datetime
    exit_time:     Optional[datetime] = None
    exit_price:    Optional[float] = None
    pnl:           float = 0.0
    pnl_pct:       float = 0.0
    outcome:       TradeOutcome = TradeOutcome.OPEN
    bars_held:     int = 0
    commission:    float = 0.0
    slippage:      float = 0.0
    meta:          dict[str, Any] = field(default_factory=dict)

    @property
    def risk(self) -> float:
        return abs(self.entry_price - self.stop_price) * self.size

    @property
    def reward(self) -> float:
        return abs(self.target_price - self.entry_price) * self.size


# ── Portfolio snapshot ────────────────────────────────────────────────────────

@dataclass(slots=True)
class PortfolioSnapshot:
    timestamp:        datetime
    equity:           float
    cash:             float
    unrealised_pnl:   float
    realised_pnl:     float
    open_positions:   int
    drawdown_pct:     float
    peak_equity:      float
    daily_pnl:        float
    daily_pnl_pct:    float


# ── Backtest result ───────────────────────────────────────────────────────────

class BacktestMetrics(BaseModel):
    total_trades:    int   = 0
    winning_trades:  int   = 0
    losing_trades:   int   = 0
    win_rate:        float = 0.0
    profit_factor:   float = 0.0
    total_pnl:       float = 0.0
    total_pnl_pct:   float = 0.0
    max_drawdown:    float = 0.0
    max_drawdown_pct: float = 0.0
    sharpe_ratio:    float = 0.0
    sortino_ratio:   float = 0.0
    calmar_ratio:    float = 0.0
    avg_rr:          float = 0.0
    avg_win_pct:     float = 0.0
    avg_loss_pct:    float = 0.0
    expectancy:      float = 0.0
    recovery_factor: float = 0.0
    total_bars:      int   = 0
    signal_rate:     float = 0.0
    # MAE / MFE metrics
    avg_mae:         float = 0.0  # Average maximum adverse excursion
    max_mae:         float = 0.0  # Maximum adverse excursion across all trades
    avg_mfe:         float = 0.0  # Average maximum favorable excursion
    max_mfe:         float = 0.0  # Maximum favorable excursion across all trades
    avg_efficiency:  float = 0.0  # Average MFE/MAE ratio (upside vs downside)
    avg_exit_efficiency: float = 0.0  # Average actual profit / MFE (profit capture rate)


class BacktestResult(BaseModel):
    run_id:       str
    symbol:       str
    timeframe:    str
    start_date:   datetime
    end_date:     datetime
    initial_equity: float
    final_equity:   float
    metrics:      BacktestMetrics
    equity_curve: list[dict[str, Any]] = Field(default_factory=list)
    trades:       list[dict[str, Any]] = Field(default_factory=list)
    signals:      list[dict[str, Any]] = Field(default_factory=list)
    config:       dict[str, Any]        = Field(default_factory=dict)


# ── ML prediction ─────────────────────────────────────────────────────────────

class MLPrediction(BaseModel):
    signal_id:       str
    symbol:          str
    timestamp:       datetime
    win_probability: float
    confidence:      float
    approved:        bool
    model_version:   str
    model_accuracy:  Optional[float] = None
    feature_importance: dict[str, float] = Field(default_factory=dict)
    shap_values:     dict[str, float] = Field(default_factory=dict)
    meta:            dict[str, Any]    = Field(default_factory=dict)


# ── Recall / memory ───────────────────────────────────────────────────────────

class RecallEntry(BaseModel):
    id:          str
    symbol:      str
    setup_type:  str
    timeframe:   str
    timestamp:   datetime
    outcome:     str          # win / loss / breakeven
    pnl_pct:     float
    features:    dict[str, float]
    embedding:   list[float] = Field(default_factory=list)
    tags:        list[str]   = Field(default_factory=list)
    notes:       str = ""


# ── Health check ─────────────────────────────────────────────────────────────

class HealthResponse(BaseModel):
    service:   str
    status:    str              # ok | degraded | error
    version:   str = "2.0.0"
    uptime_s:  float = 0.0
    checks:    dict[str, str] = Field(default_factory=dict)
