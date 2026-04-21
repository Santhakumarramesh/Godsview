"""
state/store.py — In-memory state store for all brain nodes.

Thread-safe singleton that holds the current state of every stock brain
and the supreme brain. Nodes read/write state through this store.
DB persistence is layered on top (write-behind).
"""

from __future__ import annotations
import threading
import time
import json
from datetime import datetime, timezone
from typing import Optional
from dataclasses import asdict

from .schemas import (
    StockBrainState, SupremeBrainState, ConsciousnessCard,
    NodeHealth, Attention, BrainState,
)


class BrainStore:
    """Thread-safe in-memory store for all brain node states."""

    _instance: Optional[BrainStore] = None
    _lock = threading.Lock()

    def __new__(cls) -> BrainStore:
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._init_store()
        return cls._instance

    def _init_store(self) -> None:
        self._stock_brains: dict[str, StockBrainState] = {}
        self._supreme: SupremeBrainState = SupremeBrainState()
        self._rw_lock = threading.RLock()
        self._event_log: list[dict] = []  # ring buffer of last 500 events
        self._max_events = 500

    # ── Supreme Brain ─────────────────────────────────────────────────────

    def get_supreme(self) -> SupremeBrainState:
        with self._rw_lock:
            return self._supreme

    def update_supreme(self, supreme_or_none=None, **kwargs) -> SupremeBrainState:
        with self._rw_lock:
            if supreme_or_none is not None and isinstance(supreme_or_none, SupremeBrainState):
                supreme_or_none.last_update = datetime.now(timezone.utc).isoformat()
                self._supreme = supreme_or_none
                return self._supreme
            for key, value in kwargs.items():
                if hasattr(self._supreme, key):
                    setattr(self._supreme, key, value)
            self._supreme.last_update = datetime.now(timezone.utc).isoformat()
            return self._supreme

    # ── Stock Brains ──────────────────────────────────────────────────────

    def get_stock(self, symbol: str) -> Optional[StockBrainState]:
        with self._rw_lock:
            return self._stock_brains.get(symbol)

    def get_or_create_stock(self, symbol: str, **defaults) -> StockBrainState:
        with self._rw_lock:
            if symbol not in self._stock_brains:
                brain = StockBrainState(
                    symbol=symbol,
                    display_name=defaults.get("display_name", symbol),
                    asset_class=defaults.get("asset_class", "crypto"),
                    node_health=NodeHealth.INITIALIZING,
                    last_full_update=datetime.now(timezone.utc).isoformat(),
                )
                self._stock_brains[symbol] = brain
            return self._stock_brains[symbol]

    def update_stock(self, symbol: str, brain_or_none=None, **kwargs) -> Optional[StockBrainState]:
        with self._rw_lock:
            if brain_or_none is not None and isinstance(brain_or_none, StockBrainState):
                # Replace entire brain state
                brain_or_none.last_full_update = datetime.now(timezone.utc).isoformat()
                self._stock_brains[symbol] = brain_or_none
                return brain_or_none
            brain = self._stock_brains.get(symbol)
            if brain is None:
                return None
            for key, value in kwargs.items():
                if hasattr(brain, key):
                    setattr(brain, key, value)
            brain.last_full_update = datetime.now(timezone.utc).isoformat()
            return brain

    def list_symbols(self) -> list[str]:
        with self._rw_lock:
            return list(self._stock_brains.keys())

    def list_active_stocks(self) -> list[StockBrainState]:
        """Return stocks sorted by attention score (descending)."""
        with self._rw_lock:
            active = [
                b for b in self._stock_brains.values()
                if b.attention_level != Attention.DORMANT
            ]
            active.sort(key=lambda b: b.attention_score, reverse=True)
            return active

    def remove_stock(self, symbol: str) -> bool:
        with self._rw_lock:
            return self._stock_brains.pop(symbol, None) is not None

    # ── Consciousness Board ───────────────────────────────────────────────

    def get_consciousness_board(self) -> list[ConsciousnessCard]:
        """Generate consciousness cards for all active stocks."""
        with self._rw_lock:
            cards = []
            for brain in sorted(
                self._stock_brains.values(),
                key=lambda b: b.attention_score,
                reverse=True,
            ):
                d = brain.decision
                cards.append(ConsciousnessCard(
                    symbol=brain.symbol,
                    attention=brain.attention_level.value if isinstance(brain.attention_level, Attention) else str(brain.attention_level),
                    bias=brain.structure.htf_bias.value if hasattr(brain.structure.htf_bias, 'value') else str(brain.structure.htf_bias),
                    setup=d.setup_name or "—",
                    memory_match_pct=round(brain.memory.cluster_similarity * 100, 1),
                    readiness_pct=round(d.entry_quality * 100, 1),
                    risk_state="Allowed" if brain.risk_gate.tradeable else ("Caution" if d.confidence > 0.5 else "Blocked"),
                    brain_verdict=d.reasoning_summary or "No active analysis",
                    c4_score=round(d.confidence * 100, 1),
                    regime=brain.structure.sk_sequence_stage,
                    node_health=brain.node_health.value if isinstance(brain.node_health, NodeHealth) else str(brain.node_health),
                ))
            return cards

    # ── Event Log ─────────────────────────────────────────────────────────

    def log_event(self, topic: str, symbol: str = "", payload: dict | None = None) -> None:
        with self._rw_lock:
            event = {
                "topic": topic,
                "symbol": symbol,
                "payload": payload or {},
                "ts": datetime.now(timezone.utc).isoformat(),
            }
            self._event_log.append(event)
            if len(self._event_log) > self._max_events:
                self._event_log = self._event_log[-self._max_events:]

    def get_recent_events(self, limit: int = 50, topic: str = "") -> list[dict]:
        with self._rw_lock:
            events = self._event_log
            if topic:
                events = [e for e in events if e["topic"] == topic]
            return events[-limit:]

    # ── Serialization ─────────────────────────────────────────────────────

    def snapshot_json(self) -> dict:
        """Full state snapshot as JSON-serializable dict."""
        with self._rw_lock:
            return {
                "supreme": asdict(self._supreme),
                "stocks": {
                    sym: asdict(brain)
                    for sym, brain in self._stock_brains.items()
                },
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

    def stock_json(self, symbol: str) -> Optional[dict]:
        with self._rw_lock:
            brain = self._stock_brains.get(symbol)
            if brain is None:
                return None
            return asdict(brain)


# ── Singleton accessor ────────────────────────────────────────────────────────

def get_store() -> BrainStore:
    return BrainStore()

# Alias for clearer semantics
get_brain_store = get_store
