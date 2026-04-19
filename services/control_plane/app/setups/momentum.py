"""Momentum-continuation setup detector.

Pattern definition
------------------

Two consecutive same-direction bars with expanding range and matching
order-flow imbalance. The trend is already in motion — this is a
*continuation* entry that joins the move on a shallow pullback.

* **long momentum continuation** — bar N closes higher than bar N-1,
  bar N's range > bar N-1's range, current bias = long, an active buy
  imbalance overlaps bar N's interval.
* **short momentum continuation** — symmetric on the sell side.

Trade plan
----------

* ``entry`` zone — the body of bar N.
* ``stop_loss`` — the opposite side of bar N-1 (the launchpad bar).
* ``take_profit`` — 2× risk extension.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.imbalance import ImbalanceEventOut
from app.structure.pivots import BarLike
from app.setups.types import (
    PriceZoneOut,
    SetupOut,
    _ev_id,
    blend_confidence,
    compute_rr,
    default_expiry,
)

_UTC = timezone.utc


def _bar_body(bar: BarLike) -> tuple[float, float]:
    return min(bar.o, bar.c), max(bar.o, bar.c)


def _bar_range(bar: BarLike) -> float:
    return max(0.0, bar.h - bar.l)


def detect_momentum_continuation(
    bars: Sequence[BarLike],
    *,
    bias: str,
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    symbol_id: str,
    tf: str,
    min_rr: float = 1.5,
    range_growth: float = 1.05,
) -> list[SetupOut]:
    """Emit one setup per qualifying continuation pair.

    Iterates across consecutive bar pairs ``(bars[i-1], bars[i])`` and
    fires when the pair shows expanding-range momentum aligned with
    ``bias``.
    """

    if len(bars) < 2 or bias not in {"long", "short"}:
        return []

    detected_at = datetime.now(_UTC)
    out: list[SetupOut] = []

    for i in range(1, len(bars)):
        prev = bars[i - 1]
        cur = bars[i]
        cur_range = _bar_range(cur)
        prev_range = _bar_range(prev)
        if cur_range <= 0 or prev_range <= 0:
            continue
        if cur_range / prev_range < range_growth:
            continue
        if bias == "long":
            if cur.c <= cur.o or prev.c <= prev.o or cur.c <= prev.c:
                continue
            side_for_of = "buy"
            stop = prev.l - cur_range * 0.1
            entry_lo, entry_hi = _bar_body(cur)
            entry_ref = entry_lo
            risk = entry_ref - stop
            tp = entry_ref + 2.0 * risk
            direction = "long"
        else:
            if cur.c >= cur.o or prev.c >= prev.o or cur.c >= prev.c:
                continue
            side_for_of = "sell"
            stop = prev.h + cur_range * 0.1
            entry_lo, entry_hi = _bar_body(cur)
            entry_ref = entry_hi
            risk = stop - entry_ref
            tp = entry_ref - 2.0 * risk
            direction = "short"

        rr = compute_rr(entry_ref=entry_ref, stop_loss=stop, take_profit=tp)
        if rr < min_rr:
            continue
        of_score = _orderflow_score(
            side_for_of, imbalances, absorptions, cur.t
        )
        # Demand at least baseline order-flow alignment for momentum
        # setups — without flow, this is just a candle pattern.
        if of_score <= 0.5:
            continue
        confidence = blend_confidence(
            structure_score=min(1.0, cur_range / prev_range / 2.0),
            order_flow_score=of_score,
        )
        out.append(
            SetupOut(
                id=_ev_id(),
                symbol_id=symbol_id,
                tf=tf,
                type="momentum_continuation",
                direction=direction,
                status="detected",
                detected_at=detected_at,
                entry=PriceZoneOut(low=entry_lo, high=entry_hi, ref=entry_ref),
                stop_loss=stop,
                take_profit=tp,
                rr=rr,
                confidence=confidence,
                reasoning=(
                    f"Momentum continuation ({direction}) — range "
                    f"expansion {cur_range / prev_range:.2f}×"
                ),
                structure_event_ids=[],
                order_flow_event_ids=_collect_of_ids(
                    side_for_of, imbalances, absorptions, cur.t
                ),
                expires_at=default_expiry(tf, detected_at=detected_at),
            )
        )

    return out


def _orderflow_score(
    side: str,
    imbalances: Sequence[ImbalanceEventOut],
    absorptions: Sequence[AbsorptionEventOut],
    bar_t: datetime,
) -> float:
    score = 0.5
    for imb in imbalances:
        if imb.side == side and imb.end_t <= bar_t:
            score = max(score, imb.confidence)
    flip = {"buy": "sell", "sell": "buy"}
    for ab in absorptions:
        if flip[ab.side] == side and ab.t <= bar_t:
            score = max(score, ab.confidence)
    return score


def _collect_of_ids(
    side: str,
    imbalances: Sequence[ImbalanceEventOut],
    absorptions: Sequence[AbsorptionEventOut],
    bar_t: datetime,
) -> list[str]:
    ids: list[str] = []
    for imb in imbalances:
        if imb.side == side and imb.end_t <= bar_t:
            ids.append(imb.id)
    flip = {"buy": "sell", "sell": "buy"}
    for ab in absorptions:
        if flip[ab.side] == side and ab.t <= bar_t:
            ids.append(ab.id)
    return ids
