from __future__ import annotations

from typing import Any

from app.state.schemas import StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


class EvolutionNode(NodeBase):
    name = "evolution_node"

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        # Conservative confidence calibration based on memory sample quality.
        sample = max(0, brain.memory.similar_cases_count)
        win_rate = max(0.0, min(1.0, brain.memory.cluster_win_rate))
        similarity = max(0.0, min(1.0, brain.memory.cluster_similarity))

        if sample >= 50 and win_rate < 0.40:
            brain.decision.confidence *= 0.85
            brain.decision.conditions_to_block.append("evolution:low_win_rate_cluster")
        elif sample >= 50 and win_rate > 0.58 and similarity > 0.70:
            brain.decision.confidence = min(1.0, brain.decision.confidence * 1.05)

        brain.attention_score = max(
            0.0,
            min(
                1.0,
                (brain.decision.confidence * 0.35)
                + (brain.structure.sk_score * 0.25)
                + (brain.order_flow.imbalance_score * 0.15)
                + (brain.memory.cluster_similarity * 0.15)
                + (1.0 if brain.risk_gate.tradeable else 0.0) * 0.10,
            ),
        )
        self.mark_live(brain)
        return brain

