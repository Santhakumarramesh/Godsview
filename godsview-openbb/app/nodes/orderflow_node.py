from __future__ import annotations

from typing import Any

from app.state.schemas import StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


class OrderFlowNode(NodeBase):
    name = "orderflow_node"

    def run(
        self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore
    ) -> StockBrainState:
        data = payload.get("data", payload)
        market = data.get("market", {}) if isinstance(data, dict) else {}
        hard_gates = data.get("hard_gates", {}) if isinstance(data, dict) else {}
        scoring = data.get("scoring", {}) if isinstance(data, dict) else {}
        components = scoring.get("components", {}) if isinstance(scoring, dict) else {}

        liquidity = float(hard_gates.get("liquidity_score", 0.0))
        pattern = float(components.get("setup_pattern_quality", 0.0))
        trend = float(market.get("trend_20", 0.0))

        of = brain.order_flow
        of.delta_score = max(-1.0, min(1.0, (liquidity * 2.0) - 1.0))
        of.cvd_slope = trend
        of.cvd_trend = "up" if trend > 0 else "down" if trend < 0 else "flat"
        of.absorption_score = max(0.0, min(1.0, pattern))
        of.imbalance_score = max(
            0.0, min(1.0, float(hard_gates.get("pass_ratio", 0.0)))
        )
        of.buy_volume_ratio = 0.5 + max(-0.5, min(0.5, trend * 5))
        of.delta_momentum = max(-1.0, min(1.0, trend * 10))
        of.large_delta_bar = abs(of.delta_momentum) > 0.6
        of.cvd_divergence = bool(of.delta_momentum * trend < 0)
        self.mark_live(brain)
        return brain
