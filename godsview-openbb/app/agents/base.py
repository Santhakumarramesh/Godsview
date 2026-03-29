from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from app.brain import BrainMemoryStore


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class AgentState:
    symbol: str
    live: bool = False
    dry_run: bool = True
    started_at: str = field(default_factory=utc_now_iso)
    blocked: bool = False
    block_reason: str | None = None
    errors: list[str] = field(default_factory=list)
    data: dict[str, Any] = field(default_factory=dict)
    brain: BrainMemoryStore = field(default_factory=BrainMemoryStore)

    def set_blocked(self, reason: str) -> None:
        self.blocked = True
        self.block_reason = reason

    def add_error(self, message: str) -> None:
        self.errors.append(message)


class Agent(ABC):
    name: str = "agent"

    @abstractmethod
    def run(self, state: AgentState) -> AgentState:
        raise NotImplementedError

