from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Any

from app.state.schemas import NodeHealth, StockBrainState
from app.state.store import BrainStore


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class NodeBase(ABC):
    name: str = "node"

    @abstractmethod
    def run(
        self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore
    ) -> StockBrainState:
        raise NotImplementedError

    def mark_live(self, brain: StockBrainState) -> None:
        brain.node_health = NodeHealth.LIVE
        brain.last_full_update = utc_now_iso()
        brain.error = None

    def fail(self, brain: StockBrainState, message: str) -> None:
        brain.node_health = NodeHealth.DEGRADED
        brain.error = message
        brain.last_full_update = utc_now_iso()
