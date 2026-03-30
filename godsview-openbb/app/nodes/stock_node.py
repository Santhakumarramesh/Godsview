from __future__ import annotations

from typing import Any

from app.state.schemas import Attention, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


class StockNode(NodeBase):
    name = "stock_node"

    def __init__(self, child_nodes: list[NodeBase]) -> None:
        self.child_nodes = child_nodes

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        for node in self.child_nodes:
            try:
                brain = node.run(brain, payload, store)
            except Exception as err:  # noqa: BLE001
                self.fail(brain, f"{node.name}_failed:{err}")
                break
        self._refresh_attention(brain)
        self.mark_live(brain)
        store.update_stock(brain.symbol, brain)
        return brain

    def _refresh_attention(self, brain: StockBrainState) -> None:
        score = max(0.0, min(1.0, brain.attention_score))
        if score >= 0.85:
            brain.attention_level = Attention.CRITICAL
        elif score >= 0.70:
            brain.attention_level = Attention.HIGH
        elif score >= 0.45:
            brain.attention_level = Attention.MEDIUM
        elif score >= 0.20:
            brain.attention_level = Attention.LOW
        else:
            brain.attention_level = Attention.DORMANT

