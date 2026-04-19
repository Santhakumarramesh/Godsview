"""Breakout + retest setup detector.

Pattern definition
------------------

A BOS/CHOCH prints, then price retraces to retest the *level that was
broken* (the swing price, not the OB body). The retest is confirmed
when a bar touches the prior level from the displacement side and
holds — it did not close back through.

* **long breakout retest** — bullish BOS/CHOCH; retest of the broken
  swing-high from above.
* **short breakout retest** — bearish BOS/CHOCH; retest of the broken
  swing-low from below.

Trade plan
----------

* ``entry`` zone — a thin band anchored at the broken level.
* ``stop_loss`` — the opposite side of the bar that broke structure.
* ``take_profit`` — the extreme of the post-break impulse, fallback to
  2× risk if no impulse extreme is available.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.imbalance import ImbalanceEventOut
from app.structure.bos_choch import StructureEventOut
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


def detect_breakout_retest(
    bars: Sequence[BarLike],
    *,
    events: Sequence[StructureEventOut],
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    symbol_id: str,
    tf: str,
    band_pct: float = 0.0005,
    min_rr: float = 1.5,
) -> list[SetupOut]:
    """Emit one setup per retest of each breakout level.

    The band is expressed as a fraction of the broken level
    (``band_pct=0.0005`` → 5 basis points).
    """

    if not bars or not events:
        return []

    detected_at = datetime.now(_UTC)
    out: list[SetupOut] = []
    consumed: set[str] = set()

    for ev in events:
        if ev.id in consumed:
            continue
        # Anchor the retest band at the broken level.
        level = ev.level
        band = max(abs(level) * band_pct, 1e-6)
        zone_low = level - band
        zone_high = level + band

        # Scan bars strictly after the confirmation to find the first
        # retest touch.
        for bar in bars:
            if bar.t <= ev.confirmation_t:
                continue

            if ev.direction == "long":
                # Retest from above — bar's low must pierce the band
                # without the close dropping through.
                if bar.l > zone_high:
                    continue
                if bar.c < zone_low:
                    # Retest failed — we closed through in the wrong
                    # direction, not a setup.
                    consumed.add(ev.id)
                    break
                stop = min(bar.l, zone_low) - band * 2.0
                entry_ref = level
                risk = entry_ref - stop
                if risk <= 0:
                    continue
                tp = entry_ref + max(min_rr, 2.0) * risk
                side_for_of = "buy"
            else:
                if bar.h < zone_low:
                    continue
                if bar.c > zone_high:
                    consumed.add(ev.id)
                    break
                stop = max(bar.h, zone_high) + band * 2.0
                entry_ref = level
                risk = stop - entry_ref
                if risk <= 0:
                    continue
                tp = entry_ref - max(min_rr, 2.0) * risk
                side_for_of = "sell"

            rr = compute_rr(
                entry_ref=entry_ref, stop_loss=stop, take_profit=tp
            )
            if rr < min_rr:
                continue
            of_score = _orderflow_score(
                side_for_of, imbalances, absorptions, bar.t
            )
            confidence = blend_confidence(
                structure_score=ev.confidence,
                order_flow_score=of_score,
            )
            out.append(
                SetupOut(
                    id=_ev_id(),
                    symbol_id=symbol_id,
                    tf=tf,
                    type="breakout_retest",
                    direction="long" if ev.direction == "long" else "short",
                    status="detected",
                    detected_at=detected_at,
                    entry=PriceZoneOut(
                        low=zone_low, high=zone_high, ref=level
                    ),
                    stop_loss=stop,
                    take_profit=tp,
                    rr=rr,
                    confidence=confidence,
                    reasoning=(
                        f"{ev.kind.upper()} retest at {level:.5f}"
                    ),
                    structure_event_ids=[ev.id],
                    order_flow_event_ids=_collect_of_ids(
                        side_for_of, imbalances, absorptions, bar.t
                    ),
                    expires_at=default_expiry(tf, detected_at=detected_at),
                )
            )
            consumed.add(ev.id)
            break

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
