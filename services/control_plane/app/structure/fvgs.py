"""Fair Value Gap (FVG) detection.

Classic 3-bar imbalance:

  * **Bullish FVG**: the low of bar N+2 is strictly greater than the
    high of bar N. The gap is (top=low[N+2], bottom=high[N]).
  * **Bearish FVG**: the high of bar N+2 is strictly less than the
    low of bar N. The gap is (top=low[N], bottom=high[N+2]).

The middle bar N+1 is the displacement candle. FVGs are the cleanest
read of supply/demand imbalance on a closed bar series and pair
naturally with order blocks for retest-zone fusion in PR6.

The detector is pure-function and tied only to the bar series — it
does not read structure events. Mitigation status (closed through) is
populated here if the input bar series extends past the gap; the
caller can always re-run detection as new bars arrive.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from app.structure.pivots import BarLike

_UTC = timezone.utc


@dataclass(frozen=True, slots=True)
class FvgOut:
    """Output row matching ``packages/types/src/structure.ts::FvgSchema``."""

    id: str
    direction: str  # "long" | "short"
    top: float
    bottom: float
    t: datetime
    mitigated: bool
    mitigated_at: datetime | None
    detected_at: datetime


def detect_fvgs(bars: Sequence[BarLike]) -> list[FvgOut]:
    """Walk the bar series and emit every 3-bar FVG found.

    Mitigation: after emitting a gap at bar index ``i+1``, the
    detector scans bars ``[i+2:]`` for the first bar whose close
    closes *through* the gap. For a bullish FVG (top=low[i+2],
    bottom=high[i]) mitigation is a close ≤ ``bottom``; for a
    bearish FVG (top=low[i], bottom=high[i+2]) mitigation is a
    close ≥ ``top``.
    """

    out: list[FvgOut] = []
    n = len(bars)
    if n < 3:
        return out

    for i in range(n - 2):
        a = bars[i]
        b = bars[i + 1]  # displacement bar
        c = bars[i + 2]

        # Bullish FVG: gap between A.high and C.low.
        if c.l > a.h:
            top = c.l
            bottom = a.h
            mitigated_at = _scan_bullish_mitigation(
                bars, start=i + 3, bottom=bottom
            )
            out.append(
                FvgOut(
                    id=f"fvg_{uuid.uuid4().hex}",
                    direction="long",
                    top=top,
                    bottom=bottom,
                    t=b.t,
                    mitigated=mitigated_at is not None,
                    mitigated_at=mitigated_at,
                    detected_at=datetime.now(_UTC),
                )
            )
            continue
        # Bearish FVG: gap between A.low and C.high.
        if c.h < a.l:
            top = a.l
            bottom = c.h
            mitigated_at = _scan_bearish_mitigation(
                bars, start=i + 3, top=top
            )
            out.append(
                FvgOut(
                    id=f"fvg_{uuid.uuid4().hex}",
                    direction="short",
                    top=top,
                    bottom=bottom,
                    t=b.t,
                    mitigated=mitigated_at is not None,
                    mitigated_at=mitigated_at,
                    detected_at=datetime.now(_UTC),
                )
            )
    return out


def _scan_bullish_mitigation(
    bars: Sequence[BarLike], *, start: int, bottom: float
) -> datetime | None:
    for i in range(start, len(bars)):
        if bars[i].c <= bottom:
            return bars[i].t
    return None


def _scan_bearish_mitigation(
    bars: Sequence[BarLike], *, start: int, top: float
) -> datetime | None:
    for i in range(start, len(bars)):
        if bars[i].c >= top:
            return bars[i].t
    return None
