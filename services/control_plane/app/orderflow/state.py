"""Order-flow state roll-up.

Takes raw delta-bar input + the detector outputs and produces the
snapshot envelope served by ``GET /v1/orderflow/symbols/{id}/state``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Literal, Sequence

from app.orderflow.absorption import AbsorptionEventOut
from app.orderflow.delta import DeltaBarLike, compute_cumulative_delta
from app.orderflow.imbalance import ImbalanceEventOut

_UTC = timezone.utc

NetBias = Literal["long", "short", "neutral"]


@dataclass(frozen=True, slots=True)
class OrderFlowStateRollup:
    """Rolled-up order-flow state for a symbol.

    Mirrors ``OrderFlowStateOut`` in the route module — the route just
    serialises this dataclass to camelCase JSON.
    """

    as_of: datetime
    last_delta: float
    cumulative_delta: float
    active_imbalance: ImbalanceEventOut | None
    recent_absorption: list[AbsorptionEventOut]
    recent_exhaustion: list[dict]  # reserved for PR5
    walls: list[dict]  # reserved for PR5
    clusters: list[dict]  # reserved for PR5
    net_bias: NetBias


def derive_net_bias(
    bars: Sequence[DeltaBarLike],
    *,
    lookback: int = 10,
    neutral_band: float = 0.0,
) -> NetBias:
    """Pick ``long`` / ``short`` / ``neutral`` from the recent cum-delta.

    Uses the trailing ``lookback`` bars — the sign of the summed delta
    over that window is the bias. ``neutral_band`` lets callers demand
    a minimum magnitude before flipping off neutral (default 0 = any
    non-zero sign flips).
    """

    if not bars:
        return "neutral"
    slice_ = bars[-lookback:] if lookback > 0 else list(bars)
    total = sum(b.delta for b in slice_)
    if total > neutral_band:
        return "long"
    if total < -neutral_band:
        return "short"
    return "neutral"


def rollup_state(
    bars: Sequence[DeltaBarLike],
    *,
    imbalances: Sequence[ImbalanceEventOut] = (),
    absorptions: Sequence[AbsorptionEventOut] = (),
    as_of: datetime | None = None,
    net_bias_lookback: int = 10,
    recent_absorption_n: int = 5,
) -> OrderFlowStateRollup:
    """Compose an :class:`OrderFlowStateRollup` from raw + detector output.

    * ``as_of`` defaults to ``datetime.now(UTC)``.
    * ``active_imbalance`` is the most recent imbalance whose ``end_t``
      == ``bars[-1].t`` (i.e. currently running). Older imbalances are
      ignored here — the full history lives on the events endpoint.
    * ``recent_absorption`` returns the most recent ``n`` events.
    """

    now = as_of or datetime.now(_UTC)

    series = compute_cumulative_delta(bars)
    last_delta = series[-1].delta if series else 0.0
    cumulative = series[-1].cumulative_delta if series else 0.0

    active: ImbalanceEventOut | None = None
    if bars and imbalances:
        last_t = bars[-1].t
        for ev in reversed(imbalances):
            if ev.end_t == last_t:
                active = ev
                break

    recent = list(absorptions[-recent_absorption_n:])

    return OrderFlowStateRollup(
        as_of=now,
        last_delta=last_delta,
        cumulative_delta=cumulative,
        active_imbalance=active,
        recent_absorption=recent,
        recent_exhaustion=[],
        walls=[],
        clusters=[],
        net_bias=derive_net_bias(bars, lookback=net_bias_lookback),
    )
