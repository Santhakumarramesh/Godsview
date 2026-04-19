"""Swing-high / swing-low pivot detection.

A pivot is a bar whose high (or low) is an extreme over a symmetric
window of ``lookback`` bars on each side. The window size is a tunable
parameter — default 3 on 15m is the classic SMC fractal. Higher values
filter noise; lower values surface more micro-structure.

The detector emits a tuple of (pivot, bar_index) pairs so downstream
callers can correlate events back to the source bar frame without
re-scanning.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, Sequence


class BarLike(Protocol):
    """Minimal bar shape the detector requires.

    Both the SQLAlchemy ``Bar`` row and a plain dict can satisfy this
    via attribute access or ``types.SimpleNamespace``. The tests lean
    on ``SimpleNamespace`` for fixture clarity.
    """

    t: datetime
    o: float
    h: float
    l: float
    c: float


@dataclass(frozen=True, slots=True)
class PivotOut:
    """Pivot output matching ``packages/types/src/structure.ts::PivotSchema``."""

    kind: str  # "swing_high" | "swing_low"
    price: float
    t: datetime
    bar_index: int


def detect_pivots(
    bars: Sequence[BarLike],
    *,
    lookback: int = 3,
) -> list[PivotOut]:
    """Return pivots found in ``bars``.

    A bar at index ``i`` is a swing high iff its high is strictly
    greater than every high in ``bars[i-lookback:i] + bars[i+1:i+1+lookback]``.
    Strict inequality matters: equal highs create ambiguous levels and
    the fusion engine prefers unique pivots.

    Edge windows (the first and last ``lookback`` bars) are skipped
    because there is no two-sided window to evaluate against.

    Parameters
    ----------
    bars:
        Time-ascending bar series. Must be contiguous within a single
        symbol + timeframe.
    lookback:
        Window size on each side. Raises ``ValueError`` if < 1.

    Returns
    -------
    A list of ``PivotOut`` sorted by ``bar_index`` ascending.
    """

    if lookback < 1:
        raise ValueError("lookback must be >= 1")
    n = len(bars)
    if n < 2 * lookback + 1:
        return []

    out: list[PivotOut] = []
    for i in range(lookback, n - lookback):
        pivot_bar = bars[i]
        left = bars[i - lookback : i]
        right = bars[i + 1 : i + 1 + lookback]

        # Swing-high: strict peak across the window.
        if all(pivot_bar.h > b.h for b in left) and all(
            pivot_bar.h > b.h for b in right
        ):
            out.append(
                PivotOut(
                    kind="swing_high",
                    price=pivot_bar.h,
                    t=pivot_bar.t,
                    bar_index=i,
                )
            )
            continue
        # Swing-low: strict trough across the window.
        if all(pivot_bar.l < b.l for b in left) and all(
            pivot_bar.l < b.l for b in right
        ):
            out.append(
                PivotOut(
                    kind="swing_low",
                    price=pivot_bar.l,
                    t=pivot_bar.t,
                    bar_index=i,
                )
            )
    return out
