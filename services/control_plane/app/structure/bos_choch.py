"""Break-of-Structure (BOS) and Change-of-Character (CHOCH) detection.

Definitions used by this detector:

* **BOS** — price closes through a prior swing point in the *same*
  direction as the current trend bias. Confirms continuation.

  - Bullish BOS: a closed bar's close > the most recent unbroken
    swing-high while the running bias is bullish.
  - Bearish BOS: a closed bar's close < the most recent unbroken
    swing-low while the running bias is bearish.

* **CHOCH** — price closes through a swing point in the *opposite*
  direction of the current bias. First sign of a regime flip.

  - Bullish CHOCH: bias was bearish, then a close > the most recent
    swing-high. After this event the bias becomes bullish.
  - Bearish CHOCH: bias was bullish, then a close < the most recent
    swing-low. After this event the bias becomes bearish.

Bias is seeded ``neutral`` and flips on the first BOS/CHOCH that
qualifies.

Confidence is a simple 0..1 score derived from the displacement of the
breaking close relative to the swing-leg height (clipped at 1.0). The
fusion engine in PR6 enriches this with order-flow context.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence

_UTC = timezone.utc

from app.structure.pivots import BarLike, PivotOut, detect_pivots


@dataclass(frozen=True, slots=True)
class StructureEventOut:
    """Output row matching ``packages/types/src/structure.ts::StructureEventSchema``."""

    id: str
    kind: str  # "bos" | "choch"
    direction: str  # "long" | "short"
    level: float
    broken_pivot: PivotOut
    confirmation_t: datetime
    confidence: float
    detected_at: datetime


def _confidence_for_break(
    *, breaking_close: float, swing_price: float, leg_height: float
) -> float:
    """Score a structure break in [0, 1].

    Heuristic: ``displacement / leg_height`` — a small wick-through
    barely above the level scores low, a strong impulse break scores
    high. Clipped to [0.05, 1.0] so a near-zero displacement still
    leaves a non-zero score for downstream weighting.
    """

    if leg_height <= 0:
        return 0.5
    displacement = abs(breaking_close - swing_price)
    raw = displacement / leg_height
    return max(0.05, min(1.0, raw))


def detect_bos_choch(
    bars: Sequence[BarLike],
    *,
    lookback: int = 3,
    pivots: Iterable[PivotOut] | None = None,
    seed_bias: str = "neutral",
) -> list[StructureEventOut]:
    """Detect BOS/CHOCH events across ``bars``.

    Algorithm:

      1. Build the pivot frame (swings) over ``bars`` if not supplied.
      2. Walk bars left→right. Track the most-recent unbroken
         swing-high and swing-low and the current bias.
      3. On each closed bar, test for a BOS/CHOCH against the active
         high/low. Emit an event, flip bias on CHOCH, then promote the
         next available pivot of the broken kind.

    The detector is deterministic and pure — no I/O, no globals.
    Tests pin every transition with synthetic OHLC fixtures.
    """

    if pivots is None:
        pivots = detect_pivots(bars, lookback=lookback)
    pivot_list = sorted(pivots, key=lambda p: p.bar_index)

    if not pivot_list or not bars:
        return []

    events: list[StructureEventOut] = []
    bias = seed_bias  # "long" | "short" | "neutral"

    # Walking pointers into pivot_list — `pivot_list[hi_idx]` is the
    # next swing-high to scan for, `pivot_list[lo_idx]` the next
    # swing-low. We only consider pivots whose `bar_index` is strictly
    # less than the bar we're currently evaluating (i.e. they exist in
    # the past).
    active_high: PivotOut | None = None
    active_low: PivotOut | None = None
    pivot_cursor = 0

    def _advance_pivots(through_bar_index: int) -> None:
        nonlocal pivot_cursor, active_high, active_low
        while pivot_cursor < len(pivot_list) and pivot_list[
            pivot_cursor
        ].bar_index < through_bar_index:
            p = pivot_list[pivot_cursor]
            if p.kind == "swing_high":
                # Only adopt if it's higher than the existing active
                # high — otherwise we'd regress to a lower target.
                if active_high is None or p.price > active_high.price:
                    active_high = p
                # If it's lower than the existing active high but the
                # active high was already broken, adopt it as the new
                # one. The "broken" state is implicit — once we emit a
                # BOS for `active_high` we null it, so the very next
                # qualifying pivot becomes the new active high.
                elif active_high is None:
                    active_high = p
            else:  # swing_low
                if active_low is None or p.price < active_low.price:
                    active_low = p
                elif active_low is None:
                    active_low = p
            pivot_cursor += 1

    for bar_idx, bar in enumerate(bars):
        _advance_pivots(through_bar_index=bar_idx)

        # Bullish break of active swing-high.
        if active_high is not None and bar.c > active_high.price:
            leg_height = (
                (active_high.price - active_low.price)
                if active_low is not None
                else max(0.0, active_high.price - bar.c)
            )
            kind = "bos" if bias == "long" else "choch"
            direction = "long"
            conf = _confidence_for_break(
                breaking_close=bar.c,
                swing_price=active_high.price,
                leg_height=leg_height or active_high.price,
            )
            events.append(
                StructureEventOut(
                    id=f"se_{uuid.uuid4().hex}",
                    kind=kind,
                    direction=direction,
                    level=active_high.price,
                    broken_pivot=active_high,
                    confirmation_t=bar.t,
                    confidence=conf,
                    detected_at=datetime.now(_UTC),
                )
            )
            bias = "long"
            active_high = None  # consumed
            # The active_low stays — next bear move tests it.

        # Bearish break of active swing-low.
        if active_low is not None and bar.c < active_low.price:
            leg_height = (
                (active_high.price - active_low.price)
                if active_high is not None
                else max(0.0, bar.c - active_low.price)
            )
            kind = "bos" if bias == "short" else "choch"
            direction = "short"
            conf = _confidence_for_break(
                breaking_close=bar.c,
                swing_price=active_low.price,
                leg_height=leg_height or active_low.price,
            )
            events.append(
                StructureEventOut(
                    id=f"se_{uuid.uuid4().hex}",
                    kind=kind,
                    direction=direction,
                    level=active_low.price,
                    broken_pivot=active_low,
                    confirmation_t=bar.t,
                    confidence=conf,
                    detected_at=datetime.now(_UTC),
                )
            )
            bias = "short"
            active_low = None

    return events
