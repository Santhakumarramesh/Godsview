"""
GodsView v2 — LanceDB recall store.

Stores historical trade outcomes as vector embeddings.
Enables fast nearest-neighbour lookup: "find past setups similar to this one."

Schema:
  id, symbol, setup_type, timeframe, timestamp, outcome, pnl_pct,
  feature embedding (float[]), tags, notes

Falls back to a SQLite-based in-memory store if LanceDB is unavailable.
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.shared.config import cfg
from services.shared.logging import get_logger
from services.shared.types import RecallEntry

log = get_logger(__name__)

_DB_PATH = Path(cfg.lancedb_uri)

# Feature vector dimension (one embedding per feature name)
_EMB_DIM = 36


# ── LanceDB store ─────────────────────────────────────────────────────────────


class LanceRecallStore:
    """Persistent vector store using LanceDB."""

    def __init__(self) -> None:
        self._db = None
        self._tbl = None
        self._ready = False

    async def init(self) -> None:
        try:
            import lancedb  # type: ignore[import]
            import pyarrow as pa  # type: ignore[import]

            _DB_PATH.mkdir(parents=True, exist_ok=True)
            self._db = await lancedb.connect_async(str(_DB_PATH))

            schema = pa.schema(
                [
                    pa.field("id", pa.string()),
                    pa.field("symbol", pa.string()),
                    pa.field("setup_type", pa.string()),
                    pa.field("timeframe", pa.string()),
                    pa.field("timestamp", pa.string()),
                    pa.field("outcome", pa.string()),
                    pa.field("pnl_pct", pa.float32()),
                    pa.field("vector", pa.list_(pa.float32(), _EMB_DIM)),
                    pa.field("tags", pa.string()),  # JSON array
                    pa.field("notes", pa.string()),
                ]
            )

            tables = await self._db.table_names()
            if "recall" not in tables:
                self._tbl = await self._db.create_table("recall", schema=schema)
            else:
                self._tbl = await self._db.open_table("recall")

            self._ready = True
            log.info("lancedb_ready", path=str(_DB_PATH))

        except ImportError:
            log.warning("lancedb_not_installed", fallback="in_memory")
        except Exception as exc:
            log.error("lancedb_init_failed", err=str(exc))

    async def add(self, entry: RecallEntry) -> None:
        if not self._ready or self._tbl is None:
            return
        try:
            vec = _pad_vector(entry.embedding, _EMB_DIM)
            await self._tbl.add(
                [
                    {
                        "id": entry.id,
                        "symbol": entry.symbol,
                        "setup_type": entry.setup_type,
                        "timeframe": entry.timeframe,
                        "timestamp": entry.timestamp.isoformat(),
                        "outcome": entry.outcome,
                        "pnl_pct": float(entry.pnl_pct),
                        "vector": vec,
                        "tags": json.dumps(entry.tags),
                        "notes": entry.notes,
                    }
                ]
            )
        except Exception as exc:
            log.error("recall_add_failed", id=entry.id, err=str(exc))

    async def search(
        self,
        query_vector: list[float],
        limit: int = 10,
        symbol: str | None = None,
    ) -> list[dict[str, Any]]:
        if not self._ready or self._tbl is None:
            return []
        try:
            q = self._tbl.search(
                _pad_vector(query_vector, _EMB_DIM),
                vector_column_name="vector",
            ).limit(limit)

            if symbol:
                q = q.where(f"symbol = '{symbol}'")

            results = await q.to_arrow()
            return results.to_pylist()
        except Exception as exc:
            log.error("recall_search_failed", err=str(exc))
            return []

    async def list_recent(
        self,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        if not self._ready or self._tbl is None:
            return []
        try:
            q = self._tbl.query()
            if symbol:
                q = q.where(f"symbol = '{symbol}'")
            results = await q.limit(limit).to_arrow()
            return results.to_pylist()
        except Exception as exc:
            log.error("recall_list_failed", err=str(exc))
            return []

    async def count(self) -> int:
        if not self._ready or self._tbl is None:
            return 0
        try:
            return await self._tbl.count_rows()
        except Exception:
            return 0


# ── In-memory fallback ────────────────────────────────────────────────────────


class InMemoryRecallStore:
    """Simple list-based fallback when LanceDB is unavailable."""

    def __init__(self) -> None:
        self._entries: list[RecallEntry] = []

    async def init(self) -> None:
        log.info("in_memory_recall_store_ready")

    async def add(self, entry: RecallEntry) -> None:
        self._entries.append(entry)

    async def search(
        self,
        query_vector: list[float],
        limit: int = 10,
        symbol: str | None = None,
    ) -> list[dict[str, Any]]:
        candidates = [e for e in self._entries if not symbol or e.symbol == symbol]
        # Cosine similarity
        ranked = sorted(
            candidates,
            key=lambda e: _cosine_sim(query_vector, e.embedding),
            reverse=True,
        )
        return [_entry_to_dict(e) for e in ranked[:limit]]

    async def list_recent(
        self,
        symbol: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        candidates = [e for e in self._entries if not symbol or e.symbol == symbol]
        recent = sorted(candidates, key=lambda e: e.timestamp, reverse=True)
        return [_entry_to_dict(e) for e in recent[:limit]]

    async def count(self) -> int:
        return len(self._entries)


# ── Utilities ─────────────────────────────────────────────────────────────────


def _pad_vector(vec: list[float], dim: int) -> list[float]:
    if len(vec) >= dim:
        return vec[:dim]
    return vec + [0.0] * (dim - len(vec))


def _cosine_sim(a: list[float], b: list[float]) -> float:
    if not a or not b:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag_a = math.sqrt(sum(x**2 for x in a)) or 1.0
    mag_b = math.sqrt(sum(x**2 for x in b)) or 1.0
    return dot / (mag_a * mag_b)


def _entry_to_dict(e: RecallEntry) -> dict[str, Any]:
    return {
        "id": e.id,
        "symbol": e.symbol,
        "setup_type": e.setup_type,
        "timeframe": e.timeframe,
        "timestamp": e.timestamp.isoformat(),
        "outcome": e.outcome,
        "pnl_pct": e.pnl_pct,
        "tags": e.tags,
        "notes": e.notes,
    }


def features_to_embedding(features: dict[str, float]) -> list[float]:
    """Convert a feature dict to a fixed-length embedding vector."""
    from services.feature_service.builder import FEATURE_NAMES

    return [float(features.get(k, 0.0)) for k in FEATURE_NAMES[:_EMB_DIM]]


# ── Factory ───────────────────────────────────────────────────────────────────


async def make_store() -> LanceRecallStore | InMemoryRecallStore:
    """Try LanceDB first; fall back to in-memory."""
    store = LanceRecallStore()
    await store.init()
    if store._ready:
        return store
    fallback = InMemoryRecallStore()
    await fallback.init()
    return fallback
