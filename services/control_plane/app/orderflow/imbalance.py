"""Buy/sell imbalance detection over a delta-bar series.

An imbalance is a run of N consecutive bars where the same side
dominates the order flow:

  * **Buy imbalance** — N consecutive bars with positive ``delta`` *and*
    ``delta / total_volume`` >= ``ratio_threshold`` for each bar.
  * **Sell imbalance** — symmetric with negative delta.

The event emitted spans the run; ``totalDelta`` is the cumulative net
of the run, ``ratio`` is ``totalDelta / totalVolume`` over the run.
``confidence`` is a clipped logistic of the bar count and ratio so a
4-bar 90% imbalance scores higher than a 2-bar 65% one.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Sequence

from app.orderflow.delta import DeltaBarLike

_UTC = timezone.utc


@dataclass(frozen=True, slots=True)
class ImbalanceEventOut:
    """Output row matching ``packages/types/src/orderflow.ts::ImbalanceEventSchema``."""

    id: str
    side: str  # "buy" | "sell"
    start_t: datetime
    end_t: datetime
    bar_count: int
    total_delta: float
    total_volume: float
    ratio: float
    confidence: float
    detected_at: datetime


def _ev_id() -> str:
    return f"imb_{uuid.uuid4().hex}"


def _confidence(*, bar_count: int, ratio: float) -> float:
    """Score in [0, 1] from bar_count and ratio.

    Heuristic: bar_count contribution saturates at ~6, ratio contributes
    linearly above the threshold. Clipped to [0.05, 1.0].
    """

    bar_term = min(1.0, bar_count / 6.0)
    ratio_term = max(0.0, ratio)
    raw = 0.5 * bar_term + 0.5 * ratio_term
    return max(0.05, min(1.0, raw))


def detect_imbalances(
    bars: Sequence[DeltaBarLike],
    *,
    ratio_threshold: float = 0.65,
    min_consecutive: int = 2,
    min_total_volume: float = 0.0,
) -> list[ImbalanceEventOut]:
    """Detect runs of consecutive imbalanced bars.

    ``bars`` must be ordered by ``t`` ascending. Bars whose total volume
    is zero are treated as a run-breaking neutral.
    """

    if not bars:
        return []

    detected_at = datetime.now(_UTC)
    events: list[ImbalanceEventOut] = []

    run_side: str | None = None
    run_start: int = 0
    run_total_delta: float = 0.0
    run_total_volume: float = 0.0

    def _close_run(end_idx: int) -> None:
        nonlocal run_side, run_total_delta, run_total_volume, run_start
        if run_side is None:
            return
        bar_count = end_idx - run_start + 1
        if (
            bar_count >= min_consecutive
            and run_total_volume >= min_total_volume
        ):
            ratio = (
                abs(run_total_delta) / run_total_volume
                if run_total_volume > 0
                else 0.0
            )
            events.append(
                ImbalanceEventOut(
                    id=_ev_id(),
                    side=run_side,
                    start_t=bars[run_start].t,
                    end_t=bars[end_idx].t,
                    bar_count=bar_count,
                    total_delta=run_total_delta,
                    total_volume=run_total_volume,
                    ratio=ratio,
                    confidence=_confidence(
                        bar_count=bar_count, ratio=ratio
                    ),
                    detected_at=detected_at,
                )
            )
        run_side = None
        run_total_delta = 0.0
        run_total_volume = 0.0

    for i, bar in enumerate(bars):
        total_volume = bar.buy_volume + bar.sell_volume
        if total_volume <= 0:
            _close_run(i - 1)
            continue
        per_bar_ratio = abs(bar.delta) / total_volume
        bar_side: str | None
        if per_bar_ratio < ratio_threshold:
            bar_side = None
        elif bar.delta > 0:
            bar_side = "buy"
        elif bar.delta < 0:
            bar_side = "sell"
        else:
            bar_side = None

        if bar_side is None:
            _close_run(i - 1)
            continue

        if run_side != bar_side:
            _close_run(i - 1)
            run_side = bar_side
            run_start = i
            run_total_delta = bar.delta
            run_total_volume = total_volume
        else:
            run_total_delta += bar.delta
            run_total_volume += total_volume

    _close_run(len(bars) - 1)
    return events
