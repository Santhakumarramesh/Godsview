"""Recall engine — memory of past setups + similarity search.

The recall engine gives GodsView trader-like memory: every closed
setup is appended to the store as a :class:`RecallRecord` with its
feature fingerprint + realised outcome. New setups query the store
for their *k* nearest neighbours, and the calibrator turns that
neighbour set into a historically-weighted confidence.

Phase 3 PR6 ships the in-memory implementation (process-local hub
behind an interface) so the calibrator path is live end-to-end. The
DB-backed implementation lands in Phase 4 alongside a background
outcome-labeller that walks bars past each setup's TP/SL to decide
``win`` / ``loss`` / ``scratch``.

Public interface
----------------

* :class:`RecallRecord` — one closed-setup memory row.
* :class:`RecallStore` — protocol with ``add`` + ``search`` + ``size``.
* :class:`InMemoryRecallStore` — tiny cosine-similarity impl.
* :func:`get_recall_store` — process-local singleton accessor.
* :func:`reset_recall_store` — test hook (tests clear state between
  runs).
"""

from app.recall.calibrator import (
    calibrate_confidence,
    feature_fingerprint,
    neighbour_win_rate,
)
from app.recall.store import (
    InMemoryRecallStore,
    RecallNeighbour,
    RecallRecord,
    RecallStore,
    get_recall_store,
    reset_recall_store,
)

__all__ = [
    "InMemoryRecallStore",
    "RecallNeighbour",
    "RecallRecord",
    "RecallStore",
    "calibrate_confidence",
    "feature_fingerprint",
    "get_recall_store",
    "neighbour_win_rate",
    "reset_recall_store",
]
