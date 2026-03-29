from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

EntityType = Literal["stock", "crypto", "forex", "futures", "macro", "index", "unknown"]
MemoryType = Literal["episodic", "semantic", "trade"]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class AssetEntity:
    symbol: str
    entity_type: EntityType = "unknown"
    name: str | None = None
    sector: str | None = None
    regime: str | None = None
    volatility: float | None = None
    last_price: float | None = None
    state: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(payload: dict[str, Any]) -> "AssetEntity":
        return AssetEntity(
            symbol=str(payload.get("symbol", "")).upper(),
            entity_type=payload.get("entity_type", "unknown"),
            name=payload.get("name"),
            sector=payload.get("sector"),
            regime=payload.get("regime"),
            volatility=payload.get("volatility"),
            last_price=payload.get("last_price"),
            state=payload.get("state") or {},
            created_at=payload.get("created_at") or utc_now_iso(),
            updated_at=payload.get("updated_at") or utc_now_iso(),
        )


@dataclass
class Relationship:
    source_symbol: str
    target_symbol: str
    relation_type: str
    strength: float = 0.5
    context: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @staticmethod
    def from_dict(payload: dict[str, Any]) -> "Relationship":
        return Relationship(
            source_symbol=str(payload.get("source_symbol", "")).upper(),
            target_symbol=str(payload.get("target_symbol", "")).upper(),
            relation_type=str(payload.get("relation_type", "")),
            strength=float(payload.get("strength", 0.5)),
            context=payload.get("context") or {},
            created_at=payload.get("created_at") or utc_now_iso(),
        )


@dataclass
class BaseMemory:
    symbol: str
    title: str
    content: str
    memory_type: MemoryType
    confidence: float = 0.5
    tags: list[str] = field(default_factory=list)
    context: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EpisodicMemory(BaseMemory):
    memory_type: MemoryType = field(default="episodic", init=False)


@dataclass
class SemanticMemory(BaseMemory):
    memory_type: MemoryType = field(default="semantic", init=False)


@dataclass
class TradeMemory(BaseMemory):
    memory_type: MemoryType = field(default="trade", init=False)
    trade_id: str | None = None
    signal_action: str | None = None
    entry_price: float | None = None
    exit_price: float | None = None
    pnl_pct: float | None = None
    setup: str | None = None
    regime: str | None = None
    outcome: str | None = None
