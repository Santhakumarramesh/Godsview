"""Cumulative + session-relative delta utilities.

The persistence layer (``delta_bars``) stores ``delta`` and
``cumulative_delta`` as materialised columns that the ingest path
populates. These helpers recompute the series from first principles so
the detector pipeline can operate on a subset of bars (a session slice,
a time window) without trusting the upstream ``cumulative_delta`` —
session boundaries reset the running total and the ingest path can't
always know where the session boundary is.

All functions are pure and deterministic.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, Sequence, runtime_checkable


@runtime_checkable
class DeltaBarLike(Protocol):
    """Minimal surface a row must expose for the detectors.

    This matches :class:`app.models.DeltaBar` at runtime but lets tests
    pass lightweight ``SimpleNamespace`` fixtures in too.
    """

    t: datetime
    buy_volume: float
    sell_volume: float
    delta: float


@dataclass(frozen=True, slots=True)
class DeltaPoint:
    """One point in the recomputed cumulative-delta series."""

    t: datetime
    delta: float
    cumulative_delta: float
    buy_volume: float
    sell_volume: float


def compute_cumulative_delta(
    bars: Sequence[DeltaBarLike],
) -> list[DeltaPoint]:
    """Recompute the cumulative delta series starting from zero.

    The input is assumed ordered by ``t`` ascending. If the upstream
    persisted ``cumulative_delta`` disagrees with this output on a given
    symbol, the detector trusts this function because it represents the
    delta movement *within the slice* — useful for session-scoped
    analysis.
    """

    series: list[DeltaPoint] = []
    running = 0.0
    for bar in bars:
        running += bar.delta
        series.append(
            DeltaPoint(
                t=bar.t,
                delta=bar.delta,
                cumulative_delta=running,
                buy_volume=bar.buy_volume,
                sell_volume=bar.sell_volume,
            )
        )
    return series


def compute_session_delta(
    bars: Sequence[DeltaBarLike],
    *,
    session_start_t: datetime | None = None,
) -> float:
    """Sum the delta from ``session_start_t`` forward (inclusive).

    Bars are assumed ordered by ``t`` ascending. With no
    ``session_start_t`` the full slice is summed.
    """

    total = 0.0
    for bar in bars:
        if session_start_t is not None and bar.t < session_start_t:
            continue
        total += bar.delta
    return total
