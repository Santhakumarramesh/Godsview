from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path
from typing import Any

from app.brain.schema import (
    AssetEntity,
    BaseMemory,
    Relationship,
    utc_now_iso,
)
from app.config import ROOT_DIR


class BrainMemoryStore:
    """
    Lightweight persistent memory graph (JSON-backed).

    This v1 store keeps schema simple and explicit:
    - entities keyed by symbol
    - append-only relations
    - append-only memories
    - aggregated trade/setup statistics
    """

    def __init__(self, file_path: Path | None = None) -> None:
        self.file_path = file_path or (
            ROOT_DIR / "data" / "processed" / "brain_store.json"
        )
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
        self._state = self._load_state()

    def _default_state(self) -> dict[str, Any]:
        return {
            "schema_version": 1,
            "updated_at": utc_now_iso(),
            "entities": {},
            "relations": [],
            "memories": [],
            "stats": {
                "trades_total": 0,
                "wins": 0,
                "losses": 0,
                "setups": {},
                "regimes": {},
            },
        }

    def _load_state(self) -> dict[str, Any]:
        if not self.file_path.exists():
            state = self._default_state()
            self._atomic_write(state)
            return state
        try:
            raw = self.file_path.read_text(encoding="utf-8")
            loaded = json.loads(raw)
            if not isinstance(loaded, dict):
                return self._default_state()
            for key in ["entities", "relations", "memories", "stats"]:
                loaded.setdefault(key, self._default_state()[key])
            loaded.setdefault("schema_version", 1)
            loaded.setdefault("updated_at", utc_now_iso())
            return loaded
        except Exception:
            return self._default_state()

    def _atomic_write(self, payload: dict[str, Any]) -> None:
        temp_path = self.file_path.with_suffix(f"{self.file_path.suffix}.tmp")
        temp_path.write_text(
            json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8"
        )
        temp_path.replace(self.file_path)

    def _flush(self) -> None:
        self._state["updated_at"] = utc_now_iso()
        self._atomic_write(self._state)

    def snapshot(self) -> dict[str, Any]:
        return self._state

    def upsert_entity(self, entity: AssetEntity) -> AssetEntity:
        symbol = entity.symbol.strip().upper()
        if not symbol:
            raise ValueError("symbol is required for entity.")

        existing = self._state["entities"].get(symbol)
        if existing:
            merged = dict(existing)
            merged.update(entity.to_dict())
            merged["symbol"] = symbol
            merged["updated_at"] = utc_now_iso()
            self._state["entities"][symbol] = merged
            self._flush()
            return AssetEntity.from_dict(merged)

        entity.symbol = symbol
        entity.created_at = utc_now_iso()
        entity.updated_at = entity.created_at
        self._state["entities"][symbol] = entity.to_dict()
        self._flush()
        return entity

    def get_entity(self, symbol: str) -> AssetEntity | None:
        row = self._state["entities"].get(symbol.strip().upper())
        return AssetEntity.from_dict(row) if row else None

    def add_relation(self, relation: Relationship) -> Relationship:
        relation.source_symbol = relation.source_symbol.strip().upper()
        relation.target_symbol = relation.target_symbol.strip().upper()
        relation.created_at = utc_now_iso()
        self._state["relations"].append(relation.to_dict())
        self._flush()
        return relation

    def get_relations(self, symbol: str, limit: int = 100) -> list[dict[str, Any]]:
        key = symbol.strip().upper()
        rows = [
            row
            for row in self._state["relations"]
            if row.get("source_symbol") == key or row.get("target_symbol") == key
        ]
        rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return rows[: max(1, min(limit, 1000))]

    def add_memory(self, memory: BaseMemory) -> dict[str, Any]:
        payload = memory.to_dict()
        payload["symbol"] = payload["symbol"].strip().upper()
        payload["created_at"] = utc_now_iso()
        self._state["memories"].append(payload)
        self._update_stats_from_memory(payload)
        self._flush()
        return payload

    def get_memories(
        self,
        symbol: str,
        *,
        memory_type: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        key = symbol.strip().upper()
        rows = [row for row in self._state["memories"] if row.get("symbol") == key]
        if memory_type:
            rows = [row for row in rows if row.get("memory_type") == memory_type]
        rows.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return rows[: max(1, min(limit, 1000))]

    def update_trade_outcome(
        self,
        *,
        symbol: str,
        setup: str | None,
        regime: str | None,
        outcome: str,
        confidence_delta: float = 0.05,
    ) -> None:
        key = symbol.strip().upper()
        outcome_norm = outcome.strip().lower()
        if outcome_norm not in {"win", "loss", "open", "flat"}:
            outcome_norm = "open"

        latest = None
        for row in reversed(self._state["memories"]):
            if row.get("symbol") == key and row.get("memory_type") == "trade":
                latest = row
                break

        if latest is not None:
            latest["outcome"] = outcome_norm
            conf = float(latest.get("confidence", 0.5))
            if outcome_norm == "win":
                conf = min(1.0, conf + abs(confidence_delta))
            elif outcome_norm == "loss":
                conf = max(0.0, conf - abs(confidence_delta))
            latest["confidence"] = round(conf, 4)
            latest["setup"] = setup or latest.get("setup")
            latest["regime"] = regime or latest.get("regime")

        self._increment_trade_stats(setup=setup, regime=regime, outcome=outcome_norm)
        self._flush()

    def _update_stats_from_memory(self, memory: dict[str, Any]) -> None:
        if memory.get("memory_type") != "trade":
            return
        self._increment_trade_stats(
            setup=memory.get("setup"),
            regime=memory.get("regime"),
            outcome=str(memory.get("outcome") or "open").lower(),
        )

    def _increment_trade_stats(
        self, *, setup: str | None, regime: str | None, outcome: str
    ) -> None:
        stats = self._state["stats"]
        stats["trades_total"] = int(stats.get("trades_total", 0)) + 1

        if outcome == "win":
            stats["wins"] = int(stats.get("wins", 0)) + 1
        elif outcome == "loss":
            stats["losses"] = int(stats.get("losses", 0)) + 1

        setup_key = (setup or "unknown").strip().lower()
        regime_key = (regime or "unknown").strip().lower()

        setup_bucket = stats["setups"].setdefault(
            setup_key, {"total": 0, "wins": 0, "losses": 0}
        )
        regime_bucket = stats["regimes"].setdefault(
            regime_key, {"total": 0, "wins": 0, "losses": 0}
        )

        setup_bucket["total"] += 1
        regime_bucket["total"] += 1

        if outcome == "win":
            setup_bucket["wins"] += 1
            regime_bucket["wins"] += 1
        elif outcome == "loss":
            setup_bucket["losses"] += 1
            regime_bucket["losses"] += 1
