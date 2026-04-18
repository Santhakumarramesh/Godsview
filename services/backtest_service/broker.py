"""
GodsView v2 — Paper broker simulator.

Simulates realistic order execution with:
  • Market orders (next-bar open fill with configurable slippage)
  • Stop orders (triggered when price crosses stop level)
  • Target orders (triggered when price crosses target level)
  • Commission model (per-trade percentage)
  • Position sizing based on risk pct of equity
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

from services.shared.types import Bar, Direction, Trade, TradeOutcome


class FillType(str, Enum):
    MARKET = "market"
    STOP = "stop"
    LIMIT = "limit"


@dataclass
class Order:
    id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    signal_id: str = ""
    symbol: str = ""
    direction: Direction = Direction.LONG
    side: str = "buy"
    qty: float = 0.0
    stop_price: float = 0.0
    target_price: float = 0.0
    entry_price: float = 0.0
    order_type: FillType = FillType.MARKET
    created_at: Optional[datetime] = None
    filled_at: Optional[datetime] = None
    filled_price: Optional[float] = None
    status: str = "pending"  # pending | filled | cancelled


@dataclass
class BrokerConfig:
    commission_pct: float = 0.0005  # 0.05 %  per trade (both sides)
    slippage_pct: float = 0.0002  # 0.02 % average slippage on fill
    max_position_pct: float = 0.10  # max 10 % of equity per position
    risk_per_trade_pct: float = 0.01  # risk 1 % equity per trade


class PaperBroker:
    """
    Single-position paper broker for backtesting.
    Tracks equity, handles fills, and applies commission/slippage.
    """

    def __init__(
        self, initial_equity: float, config: BrokerConfig | None = None
    ) -> None:
        self.equity = initial_equity
        self.peak_equity = initial_equity
        self.cash = initial_equity
        self.config = config or BrokerConfig()
        self.open_trade: Optional[Trade] = None
        self.closed_trades: list[Trade] = []
        self.equity_curve: list[dict] = []

    # ── Position sizing ───────────────────────────────────────────────────────

    def size_position(self, entry: float, stop: float) -> float:
        """Risk-based position sizing. Returns quantity (units)."""
        risk_amount = self.equity * self.config.risk_per_trade_pct
        risk_per_unit = abs(entry - stop)
        if risk_per_unit <= 0:
            return 0.0
        raw_qty = risk_amount / risk_per_unit
        # Also cap by max_position_pct
        max_qty = (self.equity * self.config.max_position_pct) / entry
        return min(raw_qty, max_qty)

    # ── Order entry ───────────────────────────────────────────────────────────

    def open_position(
        self,
        bar: Bar,
        signal_id: str,
        direction: Direction,
        stop_price: float,
        target_price: float,
    ) -> Trade | None:
        if self.open_trade:
            return None  # Only one position at a time

        slippage = bar.open * self.config.slippage_pct
        if direction == Direction.LONG:
            fill_price = bar.open + slippage
        else:
            fill_price = bar.open - slippage

        qty = self.size_position(fill_price, stop_price)
        if qty <= 0:
            return None

        commission = fill_price * qty * self.config.commission_pct
        self.cash -= fill_price * qty + commission

        trade = Trade(
            id=str(uuid.uuid4())[:8],
            signal_id=signal_id,
            symbol=bar.symbol,
            direction=direction,
            entry_price=round(fill_price, 6),
            stop_price=round(stop_price, 6),
            target_price=round(target_price, 6),
            size=round(qty, 6),
            entry_time=bar.timestamp,
            commission=commission,
        )
        self.open_trade = trade
        return trade

    # ── Intra-bar position management ─────────────────────────────────────────

    def update(self, bar: Bar) -> Trade | None:
        """
        Called on every bar while a position is open.
        Checks for stop or target hit using the bar's high/low/close.
        Returns the closed Trade if the position was closed this bar.
        """
        if not self.open_trade:
            return None

        trade = self.open_trade
        closed: Optional[Trade] = None

        if trade.direction == Direction.LONG:
            # Stop hit
            if bar.low <= trade.stop_price:
                closed = self._close(trade, trade.stop_price, bar, "stop")
            # Target hit
            elif bar.high >= trade.target_price:
                closed = self._close(trade, trade.target_price, bar, "target")
        else:  # SHORT
            if bar.high >= trade.stop_price:
                closed = self._close(trade, trade.stop_price, bar, "stop")
            elif bar.low <= trade.target_price:
                closed = self._close(trade, trade.target_price, bar, "target")

        if closed is None:
            # Update unrealised equity
            self._update_equity(bar.close, trade)

        return closed

    def _close(self, trade: Trade, price: float, bar: Bar, reason: str) -> Trade:
        slippage = price * self.config.slippage_pct
        if trade.direction == Direction.LONG:
            exit_price = price - slippage  # unfavourable fill
        else:
            exit_price = price + slippage

        commission = exit_price * trade.size * self.config.commission_pct
        proceeds = exit_price * trade.size - commission
        cost = trade.entry_price * trade.size

        if trade.direction == Direction.LONG:
            pnl = proceeds - cost - trade.commission
        else:
            pnl = cost - proceeds - trade.commission

        self.cash += exit_price * trade.size - commission
        self.equity = self.cash  # simplification: mark-to-market = cash

        pnl_pct = (
            pnl / (trade.entry_price * trade.size)
            if trade.entry_price * trade.size
            else 0.0
        )
        outcome = (
            TradeOutcome.WIN
            if pnl > 0
            else TradeOutcome.LOSS
            if pnl < 0
            else TradeOutcome.BE
        )

        # bars_held is calculated by the caller from entry/exit timestamps.
        trade.exit_time = bar.timestamp
        trade.exit_price = round(exit_price, 6)
        trade.pnl = round(pnl, 4)
        trade.pnl_pct = round(pnl_pct, 6)
        trade.outcome = outcome
        trade.commission += commission
        trade.slippage = abs(price - exit_price) + trade.slippage

        self.closed_trades.append(trade)
        self.open_trade = None
        self.peak_equity = max(self.peak_equity, self.equity)
        self._record_equity(bar)
        return trade

    def _update_equity(self, close: float, trade: Trade) -> None:
        if trade.direction == Direction.LONG:
            unrealised = (close - trade.entry_price) * trade.size
        else:
            unrealised = (trade.entry_price - close) * trade.size
        self.equity = self.cash + unrealised
        self.peak_equity = max(self.peak_equity, self.equity)

    def _record_equity(self, bar: Bar) -> None:
        self.equity_curve.append(
            {
                "timestamp": bar.timestamp.isoformat(),
                "equity": round(self.equity, 2),
                "drawdown_pct": round(
                    (self.peak_equity - self.equity) / self.peak_equity * 100
                    if self.peak_equity
                    else 0.0,
                    3,
                ),
            }
        )

    def force_close(self, bar: Bar) -> Trade | None:
        """Close any open position at current bar's close."""
        if not self.open_trade:
            return None
        return self._close(self.open_trade, bar.close, bar, "force")

    @property
    def drawdown_pct(self) -> float:
        if self.peak_equity <= 0:
            return 0.0
        return (self.peak_equity - self.equity) / self.peak_equity
