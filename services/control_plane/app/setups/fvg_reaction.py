"""Fair-Value-Gap reaction setup detector.

Pattern definition
------------------

Price returns to a non-mitigated 3-bar Fair Value Gap (FVG) and
**reacts** — prints a rejection bar at the gap boundary. The detector
requires the reaction bar to close out of the gap in the FVG's
direction:

* **long FVG reaction** — bullish FVG (bottom = high[N], top = low[N+2]).
  The reaction bar's low trades into the gap; its close must end back
  above the gap top (or at minimum above the mid).
* **short FVG reaction** — bearish FVG; reaction bar's high trades
  into the gap and closes back below it.

Trade plan
----------

* ``entry`` zone — the FVG body (``top`` ↔ ``bottom``).
* ``stop_loss`` — the opposite side of the gap + a small buffer.
* ``take_profit`` — 2× risk (PR6 calibration may extend this with
  swing-target heuristics).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.imbalance import ImbalanceEventOut
from app.structure.fvgs import FvgOut
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


def detect_fvg_reaction(
    bars: Sequence[BarLike],
    *,
    fvgs: Sequence[FvgOut],
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    symbol_id: str,
    tf: str,
    min_rr: float = 1.5,
) -> list[SetupOut]:
    """Emit one setup per first FVG reaction.

    Mitigated FVGs are skipped. Each FVG consumes on its first reaction
    — later touches don't re-emit setups.
    """

    if not bars or not fvgs:
        return []

    detected_at = datetime.now(_UTC)
    out: list[SetupOut] = []
    consumed: set[str] = set()

    for bar in bars:
        for gap in fvgs:
            if gap.id in consumed or gap.mitigated:
                continue
            if bar.t <= gap.t:
                continue
            inside = bar.l <= gap.top and bar.h >= gap.bottom
            if not inside:
                continue

            # Require close back outside the gap in the FVG's direction.
            if gap.direction == "long" and bar.c <= gap.top:
                # Not a reaction — price is still consolidating inside.
                continue
            if gap.direction == "short" and bar.c >= gap.bottom:
                continue

            consumed.add(gap.id)
            rng = max(gap.top - gap.bottom, 1e-6)
            if gap.direction == "long":
                stop = gap.bottom - rng * 0.5
                entry_ref = (gap.top + gap.bottom) / 2.0
                risk = entry_ref - stop
                tp = entry_ref + 2.0 * risk
                side_for_of = "buy"
            else:
                stop = gap.top + rng * 0.5
                entry_ref = (gap.top + gap.bottom) / 2.0
                risk = stop - entry_ref
                tp = entry_ref - 2.0 * risk
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
                structure_score=_fvg_score(gap, bar),
                order_flow_score=of_score,
            )
            out.append(
                SetupOut(
                    id=_ev_id(),
                    symbol_id=symbol_id,
                    tf=tf,
                    type="fvg_reaction",
                    direction="long" if gap.direction == "long" else "short",
                    status="detected",
                    detected_at=detected_at,
                    entry=PriceZoneOut(
                        low=gap.bottom, high=gap.top, ref=entry_ref
                    ),
                    stop_loss=stop,
                    take_profit=tp,
                    rr=rr,
                    confidence=confidence,
                    reasoning=(
                        f"{gap.direction.capitalize()} FVG reaction at "
                        f"[{gap.bottom:.5f}, {gap.top:.5f}]"
                    ),
                    structure_event_ids=[gap.id],
                    order_flow_event_ids=_collect_of_ids(
                        side_for_of, imbalances, absorptions, bar.t
                    ),
                    expires_at=default_expiry(tf, detected_at=detected_at),
                )
            )

    return out


def _fvg_score(gap: FvgOut, bar: BarLike) -> float:
    """Reaction displacement from the gap boundary normalised by gap size."""

    gap_size = max(gap.top - gap.bottom, 1e-6)
    if gap.direction == "long":
        displacement = max(0.0, bar.c - gap.top)
    else:
        displacement = max(0.0, gap.bottom - bar.c)
    return max(0.1, min(1.0, displacement / gap_size))


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
