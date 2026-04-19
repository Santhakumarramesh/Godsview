"""Liquidity-sweep + reclaim setup detector.

Pattern definition
------------------

A liquidity sweep + reclaim is a bar (or pair of bars) that:

1. Pierces a recent swing high (or low) — running stops on the wrong
   side of the level.
2. Closes back inside the prior range — the **reclaim**.
3. Is followed by, or co-occurs with, an order-flow imbalance pushing
   in the reclaim direction (sellers absorbed on a buy-side sweep, or
   buyers absorbed on a sell-side sweep).

Setup direction
---------------

* **long** — sweep below a swing low + reclaim back above + buy-side
  imbalance / sell-side absorption.
* **short** — sweep above a swing high + reclaim back below + sell-side
  imbalance / buy-side absorption.

Trade plan
----------

* ``entry`` zone — the body of the reclaiming bar (open ↔ close).
* ``stop_loss`` — beyond the swept extreme by a small ATR-style buffer
  (1× the bar range here, because real ATR lives in PR6 calibration).
* ``take_profit`` — the next opposite swing inside the bar window, or
  a 2R extension when no opposite swing is available.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.imbalance import ImbalanceEventOut
from app.structure.pivots import BarLike, PivotOut
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
    low = min(bar.o, bar.c)
    high = max(bar.o, bar.c)
    return low, high


def _bar_range(bar: BarLike) -> float:
    return max(0.0, bar.h - bar.l)


def detect_liquidity_sweep_reclaim(
    bars: Sequence[BarLike],
    *,
    pivots: Sequence[PivotOut],
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    symbol_id: str,
    tf: str,
    sweep_buffer_pct: float = 0.0,
) -> list[SetupOut]:
    """Scan ``bars`` for sweep+reclaim patterns and emit one setup per hit.

    ``pivots`` must come from :func:`app.structure.detect_pivots` over
    the same bar series. ``imbalances`` / ``absorptions`` provide the
    order-flow confirmation; either being non-empty boosts confidence
    but is not strictly required.

    Setups emitted in chronological order. The same swing pivot can
    only be swept once — once a sweep-and-reclaim fires against it, it
    is removed from the candidate set so duplicate setups don't flood
    the UI.
    """

    if not bars or not pivots:
        return []

    detected_at = datetime.now(_UTC)
    out: list[SetupOut] = []

    swing_highs = [p for p in pivots if p.kind == "swing_high"]
    swing_lows = [p for p in pivots if p.kind == "swing_low"]
    consumed: set[tuple[str, int]] = set()

    for i, bar in enumerate(bars):
        # ── short side: sweep above a swing high + reclaim below ────
        for piv in swing_highs:
            key = ("swing_high", piv.bar_index)
            if key in consumed or piv.bar_index >= i:
                continue
            level = piv.price * (1.0 + sweep_buffer_pct)
            if bar.h <= level:
                continue
            if bar.c >= level:
                # Pierced but did not reclaim back below.
                continue
            # We have a sweep + reclaim short candidate.
            consumed.add(key)
            body_lo, body_hi = _bar_body(bar)
            stop = bar.h + max(_bar_range(bar) * 0.1, 1e-6)
            risk = stop - body_hi
            tp = body_lo - 2.0 * risk
            entry = PriceZoneOut(low=body_lo, high=body_hi, ref=body_hi)
            of_score = _orderflow_score("sell", imbalances, absorptions, bar.t)
            structure_score = _structure_score(bar, piv.price)
            confidence = blend_confidence(
                structure_score=structure_score,
                order_flow_score=of_score,
            )
            rr = compute_rr(
                entry_ref=entry.ref, stop_loss=stop, take_profit=tp
            )
            if rr <= 0:
                continue
            out.append(
                SetupOut(
                    id=_ev_id(),
                    symbol_id=symbol_id,
                    tf=tf,
                    type="liquidity_sweep_reclaim",
                    direction="short",
                    status="detected",
                    detected_at=detected_at,
                    entry=entry,
                    stop_loss=stop,
                    take_profit=tp,
                    rr=rr,
                    confidence=confidence,
                    reasoning=(
                        f"Sweep above swing high {piv.price:.5f} + reclaim "
                        f"close {bar.c:.5f}"
                    ),
                    structure_event_ids=[],
                    order_flow_event_ids=_collect_of_ids(
                        "sell", imbalances, absorptions, bar.t
                    ),
                    expires_at=default_expiry(tf, detected_at=detected_at),
                )
            )

        # ── long side: sweep below a swing low + reclaim above ──────
        for piv in swing_lows:
            key = ("swing_low", piv.bar_index)
            if key in consumed or piv.bar_index >= i:
                continue
            level = piv.price * (1.0 - sweep_buffer_pct)
            if bar.l >= level:
                continue
            if bar.c <= level:
                continue
            consumed.add(key)
            body_lo, body_hi = _bar_body(bar)
            stop = bar.l - max(_bar_range(bar) * 0.1, 1e-6)
            risk = body_lo - stop
            tp = body_hi + 2.0 * risk
            entry = PriceZoneOut(low=body_lo, high=body_hi, ref=body_lo)
            of_score = _orderflow_score("buy", imbalances, absorptions, bar.t)
            structure_score = _structure_score(bar, piv.price)
            confidence = blend_confidence(
                structure_score=structure_score,
                order_flow_score=of_score,
            )
            rr = compute_rr(
                entry_ref=entry.ref, stop_loss=stop, take_profit=tp
            )
            if rr <= 0:
                continue
            out.append(
                SetupOut(
                    id=_ev_id(),
                    symbol_id=symbol_id,
                    tf=tf,
                    type="liquidity_sweep_reclaim",
                    direction="long",
                    status="detected",
                    detected_at=detected_at,
                    entry=entry,
                    stop_loss=stop,
                    take_profit=tp,
                    rr=rr,
                    confidence=confidence,
                    reasoning=(
                        f"Sweep below swing low {piv.price:.5f} + reclaim "
                        f"close {bar.c:.5f}"
                    ),
                    structure_event_ids=[],
                    order_flow_event_ids=_collect_of_ids(
                        "buy", imbalances, absorptions, bar.t
                    ),
                    expires_at=default_expiry(tf, detected_at=detected_at),
                )
            )

    return out


def _structure_score(bar: BarLike, swept_level: float) -> float:
    """How clean was the reclaim? Larger reclaim displacement → higher."""

    body_lo, body_hi = _bar_body(bar)
    rng = _bar_range(bar) or 1.0
    if bar.c <= swept_level:
        # short reclaim: how far below the swept level did we close?
        depth = swept_level - bar.c
    else:
        depth = bar.c - swept_level
    return max(0.05, min(1.0, depth / rng))


def _orderflow_score(
    side: str,
    imbalances: Sequence[ImbalanceEventOut],
    absorptions: Sequence[AbsorptionEventOut],
    bar_t: datetime,
) -> float:
    """Boost the confidence floor when matching-side flow is present."""

    score = 0.5
    for imb in imbalances:
        if imb.side == side and imb.end_t <= bar_t:
            score = max(score, imb.confidence)
    # Absorption side semantics: if buyers were absorbed (side="buy"),
    # the resulting move is short. Likewise sell absorption = long move.
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
