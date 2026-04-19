"""Order-Block retest setup detector.

Pattern definition
------------------

After a BOS/CHOCH prints, the detector identifies the last opposite-
colour candle (the **order block**) that produced the impulse. A retest
setup fires when price comes back into the OB zone without closing
through it, ideally with matching-side order-flow.

* **long OB retest** — bullish OB zone (high/low of the OB candle),
  price returns to tag the zone from above, absorption or imbalance
  prints on the way down.
* **short OB retest** — bearish OB zone, price returns from below,
  imbalance / absorption prints on the way up.

Trade plan
----------

* ``entry`` zone — the OB body (``low`` ↔ ``high``).
* ``stop_loss`` — a buffer beyond the OB extreme on the invalidation
  side.
* ``take_profit`` — the extreme of the BOS impulse leg, clamped to a
  minimum 1.5R target.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.imbalance import ImbalanceEventOut
from app.structure.order_blocks import OrderBlockOut
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


def detect_ob_retest(
    bars: Sequence[BarLike],
    *,
    order_blocks: Sequence[OrderBlockOut],
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    symbol_id: str,
    tf: str,
    min_rr: float = 1.5,
) -> list[SetupOut]:
    """Emit one setup per first-retest of each non-violated order block.

    Each OB is consumed after its first retest; subsequent touches are
    ignored so the UI doesn't flood. OBs flagged ``violated=True`` are
    skipped entirely — a violated zone is no longer a valid retest
    setup.
    """

    if not bars or not order_blocks:
        return []

    detected_at = datetime.now(_UTC)
    out: list[SetupOut] = []
    consumed: set[str] = set()

    for bar in bars:
        for ob in order_blocks:
            if ob.id in consumed or ob.violated:
                continue
            if bar.t <= ob.t:
                continue
            # Check for retest: price must trade inside the OB band.
            inside = bar.l <= ob.high and bar.h >= ob.low
            if not inside:
                continue
            # Don't fire if the retest also closes through the zone
            # in the wrong direction (that's violation, not retest).
            if ob.direction == "long" and bar.c < ob.low:
                consumed.add(ob.id)
                continue
            if ob.direction == "short" and bar.c > ob.high:
                consumed.add(ob.id)
                continue

            consumed.add(ob.id)
            zone = PriceZoneOut(
                low=ob.low,
                high=ob.high,
                ref=(ob.low + ob.high) / 2.0,
            )
            rng = max(ob.high - ob.low, 1e-6)
            if ob.direction == "long":
                stop = ob.low - rng * 0.25
                risk = zone.ref - stop
                tp = zone.ref + max(1.5, min_rr) * risk
                side_for_of = "buy"
            else:
                stop = ob.high + rng * 0.25
                risk = stop - zone.ref
                tp = zone.ref - max(1.5, min_rr) * risk
                side_for_of = "sell"

            rr = compute_rr(
                entry_ref=zone.ref, stop_loss=stop, take_profit=tp
            )
            if rr < min_rr:
                continue
            of_score = _orderflow_score(
                side_for_of, imbalances, absorptions, bar.t
            )
            confidence = blend_confidence(
                structure_score=max(0.2, min(1.0, ob.strength)),
                order_flow_score=of_score,
            )
            out.append(
                SetupOut(
                    id=_ev_id(),
                    symbol_id=symbol_id,
                    tf=tf,
                    type="ob_retest",
                    direction="long" if ob.direction == "long" else "short",
                    status="detected",
                    detected_at=detected_at,
                    entry=zone,
                    stop_loss=stop,
                    take_profit=tp,
                    rr=rr,
                    confidence=confidence,
                    reasoning=(
                        f"{ob.direction.capitalize()} OB retest at "
                        f"[{ob.low:.5f}, {ob.high:.5f}]"
                    ),
                    structure_event_ids=[ob.id],
                    order_flow_event_ids=_collect_of_ids(
                        side_for_of, imbalances, absorptions, bar.t
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
