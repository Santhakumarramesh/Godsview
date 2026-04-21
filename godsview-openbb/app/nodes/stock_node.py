from __future__ import annotations

from typing import Any, Optional

from app.state.schemas import Attention, StockBrainState
from app.state.store import BrainStore, get_store

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


# ─── Module-level helper used by brain_loop.py ────────────────────────────────
#
# brain_loop imports `update_stock_brain(symbol, bars_1m=..., ...)`. It refreshes
# the per-symbol StockBrainState from a fresh bar snapshot and persists it.
# Kept lightweight and resilient: missing child nodes are tolerated so this
# continues to work even if only a subset of nodes is wired up.


def _build_default_pipeline() -> Optional[StockNode]:
    """Construct the default child-node pipeline, best effort."""
    children: list[NodeBase] = []
    try:
        from .perception_node import PerceptionNode
        children.append(PerceptionNode())
    except Exception:
        pass
    try:
        from .structure_node import StructureNode
        children.append(StructureNode())
    except Exception:
        pass
    try:
        from .orderflow_node import OrderflowNode
        children.append(OrderflowNode())
    except Exception:
        pass
    try:
        from .reasoning_node import ReasoningNode
        children.append(ReasoningNode())
    except Exception:
        pass
    try:
        from .risk_node import RiskNode
        children.append(RiskNode())
    except Exception:
        pass
    if not children:
        return None
    return StockNode(children)


def update_stock_brain(
    symbol: str,
    bars_1m: Optional[list] = None,
    bars_5m: Optional[list] = None,
    bars_15m: Optional[list] = None,
    bars_1h: Optional[list] = None,
    store: Optional[BrainStore] = None,
    **extra: Any,
) -> StockBrainState:
    """Refresh the brain for `symbol` from a bar snapshot.

    Small shim so `brain_loop.py` can drive a single-symbol update without
    having to instantiate the full pipeline itself.
    """
    store = store or get_store()
    brain = store.get_or_create_stock(symbol)

    payload: dict[str, Any] = {
        "symbol": symbol,
        "bars_1m": bars_1m or [],
        "bars_5m": bars_5m or [],
        "bars_15m": bars_15m or [],
        "bars_1h": bars_1h or [],
        **extra,
    }

    pipeline = _build_default_pipeline()
    if pipeline is None:
        store.update_stock(symbol, brain)
        return brain

    try:
        brain = pipeline.run(brain, payload, store)
    except Exception:
        # Never let a node failure bring down the caller.
        store.update_stock(symbol, brain)
    return brain
