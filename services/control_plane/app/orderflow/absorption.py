"""Absorption event detection.

An **absorption** is a bar where one side prints an abnormally large
volume — relative to the recent rolling mean — but the net ``delta``
stays small in magnitude. That pattern is the signature of a resting
opposite-side wall soaking up the pressure: lots of buy (or sell) prints
go off but price doesn't move, because the other side's resting book
swallowed them.

Parameters
----------
``volume_zscore``
    How far above the rolling-window mean a bar's side-volume must sit
    before it qualifies as "abnormally large". Default 1.5 σ.
``max_delta_ratio``
    Upper bound on ``|delta| / total_volume`` for the bar. A heavily
    absorbed bar has a small magnitude even though one side was huge;
    0.15 works well as a baseline.
``lookback``
    Number of prior bars used to compute the rolling mean/std.

Side semantics
--------------
If the ``buy_volume`` spike was absorbed → side = ``"buy"`` (buyers
were absorbed). If the ``sell_volume`` spike was absorbed → side =
``"sell"``.
"""

from __future__ import annotations

import math
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.delta import DeltaBarLike

_UTC = timezone.utc


@dataclass(frozen=True, slots=True)
class AbsorptionEventOut:
    """Output row matching ``packages/types/src/orderflow.ts::AbsorptionEventSchema``."""

    id: str
    side: str  # "buy" | "sell"
    t: datetime
    volume: float
    delta: float
    delta_ratio: float
    zscore: float
    confidence: float
    detected_at: datetime


def _ev_id() -> str:
    return f"abs_{uuid.uuid4().hex}"


def _confidence(*, zscore: float, delta_ratio: float) -> float:
    """Clipped score in [0, 1].

    Grows with zscore (capped at 4σ) and shrinks with delta_ratio. A
    bar with 4σ volume spike and ~0 delta should score near 1.0.
    """

    z_term = min(1.0, max(0.0, zscore) / 4.0)
    ratio_penalty = max(0.0, 1.0 - delta_ratio * 4.0)
    raw = 0.5 * z_term + 0.5 * ratio_penalty
    return max(0.05, min(1.0, raw))


def _rolling_mean_std(values: Sequence[float]) -> tuple[float, float]:
    n = len(values)
    if n == 0:
        return 0.0, 0.0
    mean = sum(values) / n
    var = sum((v - mean) ** 2 for v in values) / n
    return mean, math.sqrt(var)


def detect_absorption(
    bars: Sequence[DeltaBarLike],
    *,
    volume_zscore: float = 1.5,
    max_delta_ratio: float = 0.15,
    lookback: int = 20,
) -> list[AbsorptionEventOut]:
    """Scan ``bars`` and emit one event per absorbed bar.

    ``bars`` must be ordered by ``t`` ascending. The rolling window for
    the zscore is ``bars[i - lookback : i]``. Bars with ``i < lookback``
    are skipped (not enough history).
    """

    if lookback < 2 or len(bars) <= lookback:
        return []

    detected_at = datetime.now(_UTC)
    events: list[AbsorptionEventOut] = []

    for i in range(lookback, len(bars)):
        window = bars[i - lookback : i]
        bar = bars[i]
        total_volume = bar.buy_volume + bar.sell_volume
        if total_volume <= 0:
            continue

        delta_ratio = abs(bar.delta) / total_volume
        if delta_ratio > max_delta_ratio:
            continue

        # Score both sides and emit at most one event for the *dominant*
        # absorbed side (highest z-score over the threshold). Iterating
        # in fixed order would bias toward "buy" when both sides spike.
        best: tuple[str, float, float] | None = None  # (side, side_vol, z)
        for side in ("buy", "sell"):
            side_vol = bar.buy_volume if side == "buy" else bar.sell_volume
            window_vals = [
                w.buy_volume if side == "buy" else w.sell_volume
                for w in window
            ]
            mean, std = _rolling_mean_std(window_vals)
            if std <= 0:
                continue
            z = (side_vol - mean) / std
            if z < volume_zscore:
                continue
            if best is None or z > best[2]:
                best = (side, side_vol, z)

        if best is not None:
            side, side_vol, z = best
            events.append(
                AbsorptionEventOut(
                    id=_ev_id(),
                    side=side,
                    t=bar.t,
                    volume=side_vol,
                    delta=bar.delta,
                    delta_ratio=delta_ratio,
                    zscore=z,
                    confidence=_confidence(
                        zscore=z, delta_ratio=delta_ratio
                    ),
                    detected_at=detected_at,
                )
            )

    return events
