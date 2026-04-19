"""Recall storage + similarity search.

The recall store is the "long-term memory" of the setup system — a
rolling log of past setups with their realised outcomes. New setups
query it for their top-*k* neighbours, and the calibrator turns
those neighbours into a historically-weighted confidence score.

Storage contract (:class:`RecallStore`) is deliberately minimal so the
Phase 4 DB-backed implementation is a drop-in replacement: ``add`` an
ended setup, ``search`` by fingerprint + filters, ``size`` for ops
visibility, ``clear`` for tests.

The in-memory implementation uses a stable feature-vector fingerprint
and cosine similarity. It's O(N·d) per query which is fine for the
process-local hub scope (thousands of memories, not millions).
"""

from __future__ import annotations

import math
import os
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, Literal, Protocol, Sequence

_UTC = timezone.utc

RecallOutcome = Literal["win", "loss", "scratch", "open"]


@dataclass(frozen=True, slots=True)
class RecallRecord:
    """One memory row in the recall store.

    ``features`` is an ordered feature vector; the calibrator
    guarantees the same feature order for every query so cosine
    similarity is meaningful. ``outcome`` is the realised result once
    the setup closed; open setups live in the store so they can be
    updated in place via :meth:`RecallStore.update_outcome`.
    """

    id: str
    setup_type: str
    direction: str  # "long" | "short"
    tf: str
    symbol_id: str
    features: tuple[float, ...]
    outcome: RecallOutcome
    pnl_r: float | None
    detected_at: datetime
    closed_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class RecallNeighbour:
    """One similarity-search hit."""

    record: RecallRecord
    similarity: float  # cosine similarity, in [-1, 1] but typically [0, 1]


class RecallStore(Protocol):
    """Store interface — the PR6 in-memory hub + the Phase 4 DB impl
    both satisfy this shape."""

    def add(self, record: RecallRecord) -> None: ...

    def search(
        self,
        features: Sequence[float],
        *,
        setup_type: str | None = None,
        direction: str | None = None,
        tf: str | None = None,
        symbol_id: str | None = None,
        only_closed: bool = True,
        k: int = 12,
    ) -> list[RecallNeighbour]: ...

    def size(self) -> int: ...

    def clear(self) -> None: ...

    def update_outcome(
        self,
        *,
        record_id: str,
        outcome: RecallOutcome,
        pnl_r: float | None,
        closed_at: datetime | None = None,
    ) -> bool: ...


class InMemoryRecallStore:
    """Process-local recall store. Thread-safe via ``threading.RLock``.

    Capacity-bounded via a ring buffer semantics: when ``max_size`` is
    set, the oldest records are evicted first. Default 5,000 covers
    many days of live setups per process.
    """

    def __init__(self, *, max_size: int = 5000) -> None:
        self._lock = threading.RLock()
        self._records: list[RecallRecord] = []
        self._max_size = max(1, max_size)

    # ── write path ────────────────────────────────────────────────
    def add(self, record: RecallRecord) -> None:
        with self._lock:
            self._records.append(record)
            if len(self._records) > self._max_size:
                overflow = len(self._records) - self._max_size
                del self._records[:overflow]

    def update_outcome(
        self,
        *,
        record_id: str,
        outcome: RecallOutcome,
        pnl_r: float | None,
        closed_at: datetime | None = None,
    ) -> bool:
        with self._lock:
            for i, rec in enumerate(self._records):
                if rec.id != record_id:
                    continue
                self._records[i] = RecallRecord(
                    id=rec.id,
                    setup_type=rec.setup_type,
                    direction=rec.direction,
                    tf=rec.tf,
                    symbol_id=rec.symbol_id,
                    features=rec.features,
                    outcome=outcome,
                    pnl_r=pnl_r,
                    detected_at=rec.detected_at,
                    closed_at=closed_at or datetime.now(_UTC),
                )
                return True
        return False

    def clear(self) -> None:
        with self._lock:
            self._records.clear()

    # ── read path ─────────────────────────────────────────────────
    def size(self) -> int:
        with self._lock:
            return len(self._records)

    def search(
        self,
        features: Sequence[float],
        *,
        setup_type: str | None = None,
        direction: str | None = None,
        tf: str | None = None,
        symbol_id: str | None = None,
        only_closed: bool = True,
        k: int = 12,
    ) -> list[RecallNeighbour]:
        if not features:
            return []
        q = _normalise(features)
        if q is None:
            return []
        with self._lock:
            candidates = list(self._records)
        out: list[RecallNeighbour] = []
        for rec in candidates:
            if setup_type and rec.setup_type != setup_type:
                continue
            if direction and rec.direction != direction:
                continue
            if tf and rec.tf != tf:
                continue
            if symbol_id and rec.symbol_id != symbol_id:
                continue
            if only_closed and rec.outcome == "open":
                continue
            v = _normalise(rec.features)
            if v is None:
                continue
            sim = _cosine(q, v)
            out.append(RecallNeighbour(record=rec, similarity=sim))
        out.sort(key=lambda n: n.similarity, reverse=True)
        return out[: max(0, k)]


# ───────────────────────── math helpers ────────────────────────────


def _normalise(vec: Sequence[float]) -> tuple[float, ...] | None:
    norm = math.sqrt(sum(x * x for x in vec))
    if norm <= 0:
        return None
    return tuple(x / norm for x in vec)


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    n = min(len(a), len(b))
    return sum(a[i] * b[i] for i in range(n))


# ───────────────────── process-local singleton ────────────────────


_STORE_SINGLETON: RecallStore | None = None
_SINGLETON_LOCK = threading.Lock()


def _default_max_size() -> int:
    raw = os.getenv("GV_RECALL_MAX_SIZE")
    try:
        return max(1, int(raw)) if raw else 5000
    except ValueError:
        return 5000


def get_recall_store() -> RecallStore:
    """Return the process-local recall store (lazy-initialised)."""

    global _STORE_SINGLETON
    with _SINGLETON_LOCK:
        if _STORE_SINGLETON is None:
            _STORE_SINGLETON = InMemoryRecallStore(
                max_size=_default_max_size()
            )
        return _STORE_SINGLETON


def reset_recall_store() -> None:
    """Reset the process-local store — test hook only."""

    global _STORE_SINGLETON
    with _SINGLETON_LOCK:
        _STORE_SINGLETON = None
