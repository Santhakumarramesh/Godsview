from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class BrainEvent:
    event_type: str
    symbol: str | None = None
    payload: dict[str, Any] = field(default_factory=dict)
    source: str = "unknown"
    correlation_id: str | None = None
    ts: str = field(default_factory=_now_iso)


@dataclass
class MarketDataEvent(BrainEvent):
    event_type: str = "market.data"


@dataclass
class NodeUpdateEvent(BrainEvent):
    event_type: str = "node.update"
    node: str = "unknown"


@dataclass
class DecisionEvent(BrainEvent):
    event_type: str = "decision.update"
    decision_state: str = "watch"


@dataclass
class ExecutionEvent(BrainEvent):
    event_type: str = "execution.update"
    status: str = "pending"


@dataclass
class EvolutionEvent(BrainEvent):
    event_type: str = "evolution.update"
    run_id: str | None = None
