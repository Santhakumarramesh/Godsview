from __future__ import annotations

from typing import Any

from app.state.schemas import RecentOutcome, SetupFamily, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


def _setup_family(value: str) -> SetupFamily | None:
    for item in SetupFamily:
        if item.value == value:
            return item
    return None


class MemoryNode(NodeBase):
    name = "memory_node"

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        data = payload.get("data", payload)
        monitor = data.get("monitor", {}) if isinstance(data, dict) else {}
        learning = monitor.get("learning", {}) if isinstance(monitor, dict) else {}
        signal = data.get("signal", {}) if isinstance(data, dict) else {}

        trades = int(learning.get("trades", 0))
        win_rate = max(0.0, min(1.0, float(learning.get("win_rate", 0.0))))
        setup_name = str(signal.get("setup", ""))
        setup_family = _setup_family(setup_name)

        brain.memory.closest_setup_cluster = setup_family
        brain.memory.cluster_similarity = 0.25 if trades <= 0 else max(0.0, min(1.0, 0.5 + (win_rate * 0.5)))
        brain.memory.cluster_win_rate = win_rate
        brain.memory.cluster_profit_factor = float(learning.get("profit_factor", 0.0) or 0.0)
        brain.memory.similar_cases_count = trades

        outcome = str(monitor.get("trade_outcome", "")).strip().lower()
        if outcome in {"win", "loss", "breakeven"} and setup_family is not None:
            brain.memory.recent_outcomes = (
                brain.memory.recent_outcomes[-19:]
                + [
                    RecentOutcome(
                        setup=setup_family,
                        outcome=outcome,
                        r_multiple=float(monitor.get("r_multiple", 0.0) or 0.0),
                        timestamp=str(monitor.get("recorded_at", payload.get("generated_at", ""))),
                    )
                ]
            )

        self.mark_live(brain)
        return brain

