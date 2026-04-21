from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Any, Optional

from app.config import settings
from app.state.schemas import BrainState, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


class ExecutionNode(NodeBase):
    name = "execution_node"

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        data = payload.get("data", payload)
        signal = data.get("signal", {}) if isinstance(data, dict) else {}
        action = str(signal.get("action", "skip"))
        close_price = float(signal.get("close_price", brain.price.last or 0.0))

        if not brain.risk_gate.tradeable or action == "skip" or close_price <= 0:
            if brain.decision.state != BrainState.BLOCKED:
                brain.decision.state = BrainState.WATCHING
            self.mark_live(brain)
            return brain

        stop_price = close_price * (1.0 - settings.default_stop_pct)
        if action == "sell":
            stop_price = close_price * (1.0 + settings.default_stop_pct)
        rr = max(brain.risk_gate.reward_risk_ratio, settings.min_rr)
        risk_unit = abs(close_price - stop_price)
        target = close_price + (risk_unit * rr) if action == "buy" else close_price - (risk_unit * rr)

        notional = min(brain.risk_gate.max_position_size_usd, 10_000.0 * settings.max_risk_per_trade * 10)
        qty = 0.0 if close_price <= 0 else notional / close_price

        brain.decision.entry_price = close_price
        brain.decision.stop_loss = stop_price
        brain.decision.take_profit = target
        brain.decision.position_size = qty
        brain.decision.state = BrainState.READY if settings.dry_run else BrainState.ENTRY_PENDING
        self.mark_live(brain)
        return brain


# ─── Position tracker used by brain_loop.py ──────────────────────────────────


@dataclass
class OpenPosition:
    symbol: str
    qty: float
    entry_price: float
    stop_loss: float
    take_profit: float
    direction: str = "long"
    position_id: str = ""


@dataclass
class PositionTracker:
    """Minimal thread-safe tracker for open simulated positions."""
    open_positions: list[OpenPosition] = field(default_factory=list)
    _lock: Lock = field(default_factory=Lock)

    def add(self, pos: OpenPosition) -> None:
        with self._lock:
            self.open_positions.append(pos)

    def close_position(self, position_id: str, exit_price: float) -> Optional[OpenPosition]:
        with self._lock:
            for i, p in enumerate(self.open_positions):
                if p.position_id == position_id:
                    return self.open_positions.pop(i)
        return None

    def update_price(self, symbol: str, last_price: float) -> list[dict[str, Any]]:
        exits: list[dict[str, Any]] = []
        with self._lock:
            for p in self.open_positions:
                if p.symbol != symbol:
                    continue
                if p.direction == "long":
                    if last_price <= p.stop_loss or last_price >= p.take_profit:
                        exits.append({
                            "position_id": p.position_id,
                            "exit_price": last_price,
                            "reason": "stop" if last_price <= p.stop_loss else "target",
                        })
                else:
                    if last_price >= p.stop_loss or last_price <= p.take_profit:
                        exits.append({
                            "position_id": p.position_id,
                            "exit_price": last_price,
                            "reason": "stop" if last_price >= p.stop_loss else "target",
                        })
        return exits


_tracker: Optional[PositionTracker] = None
_tracker_lock = Lock()


def get_position_tracker() -> PositionTracker:
    """Singleton accessor used by brain_loop and related modules."""
    global _tracker
    if _tracker is None:
        with _tracker_lock:
            if _tracker is None:
                _tracker = PositionTracker()
    return _tracker
