"""
Shared Data Contracts — Pydantic v2 models matching Node Zod schemas.

Each model here corresponds to a Zod schema in:
  artifacts/api-server/src/lib/shared_contracts.ts

RULE: Any change in the TypeScript file MUST be mirrored here.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field

# ── Signal Contract ──────────────────────────────────────────────────────────


class SignalDirection(str, Enum):
    long = "long"
    short = "short"
    flat = "flat"


class SourceLayer(str, Enum):
    smc = "smc"
    ml = "ml"
    sentiment = "sentiment"
    regime = "regime"
    composite = "composite"
    manual = "manual"


class Signal(BaseModel):
    signal_id: UUID
    timestamp: datetime
    symbol: str = Field(min_length=1)
    direction: SignalDirection
    confidence: float = Field(ge=0, le=1)
    setup_type: str
    timeframe: str
    entry_price: float = Field(gt=0)
    stop_loss: float = Field(gt=0)
    take_profit: float = Field(gt=0)
    risk_reward: float = Field(gt=0)
    source_layer: SourceLayer
    metadata: Optional[dict[str, Any]] = None


# ── Order Contract ───────────────────────────────────────────────────────────


class OrderSide(str, Enum):
    buy = "buy"
    sell = "sell"


class OrderType(str, Enum):
    market = "market"
    limit = "limit"
    stop = "stop"
    stop_limit = "stop_limit"


class TimeInForce(str, Enum):
    day = "day"
    gtc = "gtc"
    ioc = "ioc"
    fok = "fok"


class OrderStatus(str, Enum):
    pending = "pending"
    submitted = "submitted"
    partial = "partial"
    filled = "filled"
    cancelled = "cancelled"
    rejected = "rejected"


class Order(BaseModel):
    order_id: UUID
    timestamp: datetime
    symbol: str = Field(min_length=1)
    side: OrderSide
    order_type: OrderType
    quantity: float = Field(gt=0)
    price: Optional[float] = Field(default=None, gt=0)
    stop_price: Optional[float] = Field(default=None, gt=0)
    time_in_force: TimeInForce
    status: OrderStatus
    filled_qty: float = Field(default=0, ge=0)
    avg_fill_price: Optional[float] = None
    signal_id: Optional[UUID] = None
    broker: str = "alpaca"


# ── Position Contract ────────────────────────────────────────────────────────


class PositionSide(str, Enum):
    long = "long"
    short = "short"


class Position(BaseModel):
    position_id: UUID
    symbol: str = Field(min_length=1)
    side: PositionSide
    quantity: float = Field(gt=0)
    entry_price: float = Field(gt=0)
    current_price: float = Field(gt=0)
    unrealized_pnl: float
    realized_pnl: float
    opened_at: datetime
    closed_at: Optional[datetime] = None
    stop_loss: Optional[float] = Field(default=None, gt=0)
    take_profit: Optional[float] = Field(default=None, gt=0)


# ── Risk Assessment Contract ─────────────────────────────────────────────────


class RiskAssessment(BaseModel):
    assessment_id: UUID
    timestamp: datetime
    portfolio_var_95: float
    portfolio_var_99: float
    max_drawdown: float
    current_drawdown: float
    exposure_pct: float = Field(ge=0, le=100)
    margin_used_pct: float = Field(ge=0, le=100)
    risk_score: float = Field(ge=0, le=100)
    circuit_breaker_active: bool
    warnings: list[str]


# ── Market Data Tick Contract ────────────────────────────────────────────────


class MarketTick(BaseModel):
    symbol: str = Field(min_length=1)
    timestamp: datetime
    bid: float = Field(gt=0)
    ask: float = Field(gt=0)
    last: float = Field(gt=0)
    volume: float = Field(ge=0)
    vwap: Optional[float] = Field(default=None, gt=0)


# ── OHLCV Bar Contract ──────────────────────────────────────────────────────


class OHLCVBar(BaseModel):
    symbol: str = Field(min_length=1)
    timeframe: str
    timestamp: datetime
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(ge=0)


# ── Brain Event Contract ────────────────────────────────────────────────────


class BrainEventType(str, Enum):
    signal = "signal"
    decision = "decision"
    execution = "execution"
    risk = "risk"
    alert = "alert"
    status = "status"
    heartbeat = "heartbeat"


class Severity(str, Enum):
    info = "info"
    warning = "warning"
    error = "error"
    critical = "critical"


class BrainEvent(BaseModel):
    event_id: UUID
    timestamp: datetime
    subsystem: str
    event_type: BrainEventType
    severity: Severity
    payload: dict[str, Any]
    correlation_id: Optional[UUID] = None


# ── Strategy Performance Contract ────────────────────────────────────────────


class StrategyPerformance(BaseModel):
    strategy_id: str
    strategy_name: str
    period_start: datetime
    period_end: datetime
    total_trades: int = Field(ge=0)
    win_rate: float = Field(ge=0, le=1)
    profit_factor: float = Field(ge=0)
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    total_pnl: float
    avg_trade_duration_ms: float = Field(ge=0)
