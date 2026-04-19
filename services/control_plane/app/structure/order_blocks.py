"""Order Block (OB) detection.

Definition used here (SMC canonical):

  * A **bullish OB** is the last down-close candle before the bullish
    impulse that produces a BOS/CHOCH long. Its body (open ↔ close)
    defines the zone of interest for retest entries.

  * A **bearish OB** is the last up-close candle before the bearish
    impulse that produces a BOS/CHOCH short.

The detector is event-driven — it consumes a list of
:class:`StructureEventOut` (from :mod:`app.structure.bos_choch`)
together with the underlying bar frame and walks backwards from each
event's ``broken_pivot.bar_index + 1`` to find the last opposite
candle.

Strength score:
  Combines three inputs on a 0..1 scale:
    * ``displacement`` — size of the impulse leg relative to the
      preceding swing height.
    * ``follow_through`` — whether the next bar after the OB kept
      going in the impulse direction.
    * ``volume_punch`` — volume ratio of the OB candle vs. the local
      average (optional; skipped when volume is absent / zero).

  Weighted: 0.5·displacement + 0.3·follow_through + 0.2·volume_punch.
  When volume is absent the weights collapse to 0.6·displacement +
  0.4·follow_through.

Retest + violation state is left as ``False`` at emission time. The
PR6 fusion engine runs a separate pass that updates those flags as
subsequent bars mitigate or close through the zone.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterable, Sequence

from app.structure.bos_choch import StructureEventOut
from app.structure.pivots import BarLike

_UTC = timezone.utc


@dataclass(frozen=True, slots=True)
class OrderBlockOut:
    """Output row matching ``packages/types/src/structure.ts::OrderBlockSchema``."""

    id: str
    direction: str  # "long" | "short"
    high: float
    low: float
    t: datetime
    strength: float
    retested: bool
    violated: bool
    structure_event_id: str | None
    detected_at: datetime


def _is_up_candle(bar: BarLike) -> bool:
    return bar.c > bar.o


def _is_down_candle(bar: BarLike) -> bool:
    return bar.c < bar.o


def _volume_punch(idx: int, bars: Sequence[BarLike], window: int = 10) -> float:
    """Return the OB volume / local-average ratio clipped to [0, 1].

    Returns 0.0 when the series lacks usable volume data or the
    window has zero mean. The 2x-of-local-average saturation keeps
    the score well-behaved.
    """

    ob_v = getattr(bars[idx], "v", 0.0) or 0.0
    if ob_v <= 0:
        return 0.0
    lo = max(0, idx - window)
    sample = [
        getattr(b, "v", 0.0) or 0.0 for b in bars[lo:idx] if getattr(b, "v", 0.0)
    ]
    if not sample:
        return 0.0
    avg = sum(sample) / len(sample)
    if avg <= 0:
        return 0.0
    return max(0.0, min(1.0, (ob_v / avg) / 2.0))


def _displacement_score(
    *, ob_bar: BarLike, break_level: float, leg_height: float
) -> float:
    if leg_height <= 0:
        return 0.5
    # Measure the OB body → break-level distance as a share of the
    # leg the impulse ran. A big impulse over a small OB body scores
    # high.
    body_mid = (ob_bar.o + ob_bar.c) / 2.0
    impulse = abs(break_level - body_mid)
    raw = impulse / leg_height
    return max(0.05, min(1.0, raw))


def _follow_through_score(
    *, ob_idx: int, direction: str, bars: Sequence[BarLike]
) -> float:
    """1.0 if the next bar kept going in `direction`, else 0.0."""

    nxt_idx = ob_idx + 1
    if nxt_idx >= len(bars):
        return 0.0
    nxt = bars[nxt_idx]
    if direction == "long" and nxt.c > nxt.o:
        return 1.0
    if direction == "short" and nxt.c < nxt.o:
        return 1.0
    return 0.0


def detect_order_blocks(
    bars: Sequence[BarLike],
    events: Iterable[StructureEventOut],
) -> list[OrderBlockOut]:
    """For each structure event, emit the OB candle behind the impulse."""

    out: list[OrderBlockOut] = []
    bar_n = len(bars)
    events_list = sorted(
        events, key=lambda e: e.broken_pivot.bar_index
    )  # stable order
    for ev in events_list:
        # The impulse begins the bar *after* the broken pivot. The OB
        # is the most recent opposite-coloured candle between the
        # broken pivot and the confirmation bar.
        search_end = _bar_index_of(bars, ev.confirmation_t)
        if search_end is None:
            continue
        search_start = max(0, ev.broken_pivot.bar_index)
        ob_idx: int | None = None
        for i in range(search_end - 1, search_start - 1, -1):
            b = bars[i]
            if ev.direction == "long" and _is_down_candle(b):
                ob_idx = i
                break
            if ev.direction == "short" and _is_up_candle(b):
                ob_idx = i
                break
        if ob_idx is None:
            continue

        ob_bar = bars[ob_idx]
        high = max(ob_bar.o, ob_bar.c)
        low = min(ob_bar.o, ob_bar.c)

        leg_height = abs(ev.level - ev.broken_pivot.price) or abs(
            ev.level - low if ev.direction == "long" else high - ev.level
        )
        disp = _displacement_score(
            ob_bar=ob_bar, break_level=ev.level, leg_height=leg_height
        )
        follow = _follow_through_score(
            ob_idx=ob_idx, direction=ev.direction, bars=bars
        )
        vol = _volume_punch(ob_idx, bars)

        if vol > 0:
            strength = 0.5 * disp + 0.3 * follow + 0.2 * vol
        else:
            strength = 0.6 * disp + 0.4 * follow

        out.append(
            OrderBlockOut(
                id=f"ob_{uuid.uuid4().hex}",
                direction=ev.direction,
                high=high,
                low=low,
                t=ob_bar.t,
                strength=round(min(1.0, max(0.0, strength)), 4),
                retested=False,
                violated=False,
                structure_event_id=ev.id,
                detected_at=datetime.now(_UTC),
            )
        )
    return out


def _bar_index_of(bars: Sequence[BarLike], t: datetime) -> int | None:
    """Return the index whose bar.t == t, or None."""

    for i, b in enumerate(bars):
        if b.t == t:
            return i
    return None
