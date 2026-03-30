from __future__ import annotations

from typing import Any

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

