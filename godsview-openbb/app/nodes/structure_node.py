from __future__ import annotations

from typing import Any

from app.state.schemas import Bias, BrainState, SetupFamily, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


def _setup_family(name: str) -> SetupFamily | None:
    normalized = name.strip().lower()
    for item in SetupFamily:
        if item.value == normalized:
            return item
    if "sweep" in normalized:
        return SetupFamily.SWEEP_RECLAIM
    if "continuation" in normalized:
        return SetupFamily.CONTINUATION_PULLBACK
    if "breakout" in normalized:
        return SetupFamily.BREAKOUT_FAILURE
    if "fvg" in normalized:
        return SetupFamily.FVG_FILL
    if "order_block" in normalized or "ob" in normalized:
        return SetupFamily.ORDER_BLOCK_RETEST
    return None


class StructureNode(NodeBase):
    name = "structure_node"

    def run(
        self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore
    ) -> StockBrainState:
        data = payload.get("data", payload)
        market = data.get("market", {}) if isinstance(data, dict) else {}
        signal = data.get("signal", {}) if isinstance(data, dict) else {}
        scoring = data.get("scoring", {}) if isinstance(data, dict) else {}
        components = scoring.get("components", {}) if isinstance(scoring, dict) else {}
        setup_validation = (
            signal.get("setup_validation", {}) if isinstance(signal, dict) else {}
        )

        trend = float(market.get("trend_20", 0.0))
        if trend > 0.002:
            bias = Bias.BULLISH
        elif trend < -0.002:
            bias = Bias.BEARISH
        else:
            bias = Bias.NEUTRAL

        setup_name = str(signal.get("setup", ""))
        family = _setup_family(setup_name)
        structure_score = float(components.get("structure_score", 0.0))

        brain.structure.htf_bias = bias
        brain.structure.itf_bias = bias
        brain.structure.ltf_bias = bias
        brain.structure.bos_count = int(brain.structure.bos_count or 0) + (
            1 if abs(trend) > 0.015 else 0
        )
        brain.structure.choch_detected = bool("choch" in setup_name.lower())
        brain.structure.sweep_detected = bool("sweep" in setup_name.lower())
        brain.structure.sk_sequence_stage = str(
            market.get("regime", brain.structure.sk_sequence_stage or "none")
        )
        brain.structure.sk_in_zone = bool(setup_validation.get("valid", False))
        brain.structure.sk_score = max(0.0, min(1.0, structure_score))

        brain.decision.setup_name = setup_name or None
        brain.decision.setup_family = family
        brain.decision.entry_quality = max(
            brain.decision.entry_quality, brain.structure.sk_score
        )
        brain.decision.state = (
            BrainState.WATCHING if brain.structure.sk_in_zone else BrainState.SCANNING
        )
        self.mark_live(brain)
        return brain
