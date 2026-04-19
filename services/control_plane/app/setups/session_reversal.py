"""Session-reversal setup detector.

Pattern definition
------------------

A bar pierces the session high or low and then reverses against it
inside the same trading session. Sessions used here are the canonical
FX windows (UTC):

* Asia      00:00 → 07:00
* London    07:00 → 12:00
* NY        12:00 → 21:00

Pattern conditions
------------------

* **short session reversal** — bar's high > running session high AND
  bar closes inside the prior intra-session range (below the prior
  session high) AND running bias = short OR there's a sell-side
  imbalance overlapping the bar.
* **long session reversal** — symmetric on the session low.

The setup is only emitted at the moment of the reversal (the bar that
prints the first reversal close), not on every subsequent bar.
"""

from __future__ import annotations

from datetime import datetime, time, timezone
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

# (start_hour, end_hour, label) — UTC.
_SESSIONS: tuple[tuple[int, int, str], ...] = (
    (0, 7, "asia"),
    (7, 12, "london"),
    (12, 21, "ny"),
)


def _session_for(t: datetime) -> str | None:
    h = t.astimezone(_UTC).hour
    for start, end, label in _SESSIONS:
        if start <= h < end:
            return label
    return None


def detect_session_reversal(
    bars: Sequence[BarLike],
    *,
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    symbol_id: str,
    tf: str,
    min_rr: float = 1.5,
) -> list[SetupOut]:
    """Emit one setup per first reversal of a session extreme.

    Walks ``bars`` chronologically. For each bar, tracks the running
    session high/low. When a bar pierces and reverses, emits a setup
    and refuses to emit further reversals in the same session against
    the same extreme.
    """

    if not bars:
        return []

    detected_at = datetime.now(_UTC)
    out: list[SetupOut] = []

    cur_session: str | None = None
    sess_high: float | None = None
    sess_low: float | None = None
    consumed_high = False
    consumed_low = False

    for bar in bars:
        sess = _session_for(bar.t)
        if sess != cur_session:
            cur_session = sess
            sess_high = bar.h
            sess_low = bar.l
            consumed_high = False
            consumed_low = False
            continue

        # ── short reversal: pierce + reject above prior session high ─
        if (
            sess_high is not None
            and not consumed_high
            and bar.h > sess_high
            and bar.c < sess_high
        ):
            consumed_high = True
            stop = bar.h + (bar.h - bar.l) * 0.1
            entry_lo = min(bar.o, bar.c)
            entry_hi = max(bar.o, bar.c)
            entry_ref = entry_hi
            risk = stop - entry_ref
            tp = entry_ref - 2.0 * risk
            rr = compute_rr(
                entry_ref=entry_ref, stop_loss=stop, take_profit=tp
            )
            if rr >= min_rr:
                of_score = _orderflow_score(
                    "sell", imbalances, absorptions, bar.t
                )
                confidence = blend_confidence(
                    structure_score=_struct_score(bar, sess_high, "short"),
                    order_flow_score=of_score,
                    session_score=0.7,
                )
                out.append(
                    SetupOut(
                        id=_ev_id(),
                        symbol_id=symbol_id,
                        tf=tf,
                        type="session_reversal",
                        direction="short",
                        status="detected",
                        detected_at=detected_at,
                        entry=PriceZoneOut(
                            low=entry_lo, high=entry_hi, ref=entry_ref
                        ),
                        stop_loss=stop,
                        take_profit=tp,
                        rr=rr,
                        confidence=confidence,
                        reasoning=(
                            f"{cur_session} session-high reversal at "
                            f"{sess_high:.5f}"
                        ),
                        structure_event_ids=[],
                        order_flow_event_ids=_collect_of_ids(
                            "sell", imbalances, absorptions, bar.t
                        ),
                        expires_at=default_expiry(tf, detected_at=detected_at),
                    )
                )

        # ── long reversal: pierce + reject below prior session low ──
        if (
            sess_low is not None
            and not consumed_low
            and bar.l < sess_low
            and bar.c > sess_low
        ):
            consumed_low = True
            stop = bar.l - (bar.h - bar.l) * 0.1
            entry_lo = min(bar.o, bar.c)
            entry_hi = max(bar.o, bar.c)
            entry_ref = entry_lo
            risk = entry_ref - stop
            tp = entry_ref + 2.0 * risk
            rr = compute_rr(
                entry_ref=entry_ref, stop_loss=stop, take_profit=tp
            )
            if rr >= min_rr:
                of_score = _orderflow_score(
                    "buy", imbalances, absorptions, bar.t
                )
                confidence = blend_confidence(
                    structure_score=_struct_score(bar, sess_low, "long"),
                    order_flow_score=of_score,
                    session_score=0.7,
                )
                out.append(
                    SetupOut(
                        id=_ev_id(),
                        symbol_id=symbol_id,
                        tf=tf,
                        type="session_reversal",
                        direction="long",
                        status="detected",
                        detected_at=detected_at,
                        entry=PriceZoneOut(
                            low=entry_lo, high=entry_hi, ref=entry_ref
                        ),
                        stop_loss=stop,
                        take_profit=tp,
                        rr=rr,
                        confidence=confidence,
                        reasoning=(
                            f"{cur_session} session-low reversal at "
                            f"{sess_low:.5f}"
                        ),
                        structure_event_ids=[],
                        order_flow_event_ids=_collect_of_ids(
                            "buy", imbalances, absorptions, bar.t
                        ),
                        expires_at=default_expiry(tf, detected_at=detected_at),
                    )
                )

        # Update running extremes after evaluation so the bar that
        # pierces is compared against the *prior* session extreme.
        if sess_high is None or bar.h > sess_high:
            sess_high = bar.h
        if sess_low is None or bar.l < sess_low:
            sess_low = bar.l

    return out


def _struct_score(
    bar: BarLike, level: float, direction: str
) -> float:
    rng = max(bar.h - bar.l, 1e-6)
    if direction == "short":
        # How far below the swept level did we close?
        depth = max(0.0, level - bar.c)
    else:
        depth = max(0.0, bar.c - level)
    return max(0.1, min(1.0, depth / rng))


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
