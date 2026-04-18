from __future__ import annotations

from typing import Any

from app.brain.memory import BrainMemoryStore


def build_learning_summary(store: BrainMemoryStore, symbol: str) -> dict[str, Any]:
    memories = store.get_memories(symbol, memory_type="trade", limit=500)
    wins = [m for m in memories if str(m.get("outcome")) == "win"]
    losses = [m for m in memories if str(m.get("outcome")) == "loss"]
    total = len(memories)
    win_rate = len(wins) / total if total else 0.0

    by_setup: dict[str, dict[str, int]] = {}
    for m in memories:
        setup = str(m.get("setup") or "unknown")
        bucket = by_setup.setdefault(setup, {"total": 0, "wins": 0, "losses": 0})
        bucket["total"] += 1
        if str(m.get("outcome")) == "win":
            bucket["wins"] += 1
        if str(m.get("outcome")) == "loss":
            bucket["losses"] += 1

    return {
        "symbol": symbol.upper(),
        "trades": total,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(float(win_rate), 6),
        "by_setup": by_setup,
    }
