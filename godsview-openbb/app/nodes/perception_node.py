from __future__ import annotations

from typing import Any

from app.state.schemas import StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


class PerceptionNode(NodeBase):
    name = "perception_node"

    def run(
        self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore
    ) -> StockBrainState:
        data = payload.get("data", payload)
        market = data.get("market", {}) if isinstance(data, dict) else {}
        signal = data.get("signal", {}) if isinstance(data, dict) else {}
        hard_gates = data.get("hard_gates", {}) if isinstance(data, dict) else {}
        session = data.get("session", {}) if isinstance(data, dict) else {}

        last = float(
            market.get("last_price", signal.get("close_price", brain.price.last or 0.0))
        )
        spread_proxy = float(
            hard_gates.get("spread_quality_score", brain.price.spread_pct or 0.0)
        )
        trend_20 = float(market.get("trend_20", 0.0))
        vol = float(market.get("volatility_100", 0.0))

        brain.price.last = last
        brain.price.bid = last
        brain.price.ask = last
        brain.price.spread_pct = spread_proxy
        brain.price.relative_volatility = max(0.1, min(3.0, 1.0 + vol * 10))
        brain.price.atr_pct = vol

        brain.ticks.tick_velocity = abs(trend_20) * 10
        brain.ticks.aggression_score = max(
            0.0, min(1.0, float(hard_gates.get("liquidity_score", 0.5)))
        )
        brain.ticks.micro_reversal_score = max(
            0.0, min(1.0, 1.0 - float(signal.get("confidence", 0.5)))
        )
        brain.ticks.burst_probability = max(
            0.0, min(1.0, float(signal.get("confidence", 0.0)))
        )
        brain.ticks.last_update = str(payload.get("generated_at", ""))

        brain.market_status = (
            "open" if bool(session.get("allowed", False)) else "closed"
        )
        brain.data_freshness_ms = 0.0
        self.mark_live(brain)
        return brain
