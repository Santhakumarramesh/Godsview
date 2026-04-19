"""Pure-function tests for the order-flow detector library.

Like ``tests/test_structure_bos_choch.py`` these exercise the detector
logic without the database or the FastAPI client, using synthetic
``DeltaBarLike`` fixtures so every transition is verifiable by
inspection.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Iterable

from app.orderflow import (
    compute_cumulative_delta,
    compute_session_delta,
    derive_net_bias,
    detect_absorption,
    detect_imbalances,
    rollup_state,
)

UTC = timezone.utc
T0 = datetime(2026, 4, 1, 0, 0, 0, tzinfo=UTC)


def _bar(i: int, *, bv: float, sv: float, delta: float | None = None):
    """Build a minimal delta-bar fixture.

    ``delta`` defaults to ``bv - sv`` so most fixtures can omit it.
    """

    d = delta if delta is not None else bv - sv
    return SimpleNamespace(
        t=T0 + timedelta(minutes=i),
        buy_volume=bv,
        sell_volume=sv,
        delta=d,
    )


def _series(
    rows: Iterable[tuple[float, float] | tuple[float, float, float]],
):
    """Convert a list of (bv, sv) or (bv, sv, delta) into bars."""

    out = []
    for i, row in enumerate(rows):
        if len(row) == 2:
            bv, sv = row
            out.append(_bar(i, bv=bv, sv=sv))
        else:
            bv, sv, d = row
            out.append(_bar(i, bv=bv, sv=sv, delta=d))
    return out


# ─────────────────────────── delta series ──────────────────────────


def test_compute_cumulative_delta_empty_returns_empty():
    assert compute_cumulative_delta([]) == []


def test_compute_cumulative_delta_accumulates_in_order():
    bars = _series([(10, 5), (3, 8), (6, 6)])
    series = compute_cumulative_delta(bars)
    assert [p.delta for p in series] == [5.0, -5.0, 0.0]
    assert [p.cumulative_delta for p in series] == [5.0, 0.0, 0.0]


def test_compute_session_delta_respects_session_start():
    bars = _series([(10, 0), (0, 10), (5, 0)])
    # Skip the first bar.
    total = compute_session_delta(
        bars, session_start_t=bars[1].t
    )
    assert total == -10.0 + 5.0


# ─────────────────────────── imbalance ────────────────────────────


def test_detect_imbalances_no_bars_returns_empty():
    assert detect_imbalances([]) == []


def test_detect_imbalances_single_bar_below_min_consecutive():
    bars = _series([(10, 1)])
    assert detect_imbalances(bars, min_consecutive=2) == []


def test_detect_imbalances_two_consecutive_buy_run():
    bars = _series(
        [
            (10, 1),  # ratio 9/11 ≈ 0.82
            (8, 1),   # ratio 7/9 ≈ 0.78
            (5, 5),   # balanced — breaks run
        ]
    )
    events = detect_imbalances(bars, ratio_threshold=0.65)
    assert len(events) == 1
    ev = events[0]
    assert ev.side == "buy"
    assert ev.bar_count == 2
    assert ev.total_delta == 16.0  # (10-1) + (8-1)
    assert ev.total_volume == 20.0
    assert abs(ev.ratio - 0.8) < 0.01
    assert 0.0 < ev.confidence <= 1.0


def test_detect_imbalances_sell_run_then_buy_run():
    bars = _series(
        [
            (1, 10),  # sell
            (2, 12),  # sell
            (1, 1),   # balanced — closes sell run
            (12, 2),  # buy
            (10, 1),  # buy
        ]
    )
    events = detect_imbalances(bars, ratio_threshold=0.65)
    assert [e.side for e in events] == ["sell", "buy"]
    assert events[0].bar_count == 2
    assert events[1].bar_count == 2
    assert events[0].total_delta < 0
    assert events[1].total_delta > 0


def test_detect_imbalances_zero_volume_breaks_run():
    bars = _series([(10, 1), (0, 0), (8, 1)])
    events = detect_imbalances(bars, min_consecutive=2)
    # Each side of the zero bar is a single-bar run → filtered.
    assert events == []


def test_detect_imbalances_respects_min_total_volume():
    bars = _series([(3, 0), (2, 0)])
    # Total volume is 5 — below threshold of 10, no event.
    events = detect_imbalances(
        bars, ratio_threshold=0.5, min_consecutive=2, min_total_volume=10
    )
    assert events == []


def test_detect_imbalances_below_ratio_threshold_no_event():
    bars = _series([(6, 4), (7, 5)])  # ratios ~0.2, ~0.17
    events = detect_imbalances(bars, ratio_threshold=0.65)
    assert events == []


# ─────────────────────────── absorption ───────────────────────────


def test_detect_absorption_skips_short_series():
    bars = _series([(10, 10)] * 10)
    assert detect_absorption(bars, lookback=20) == []


def _noisy_prefix(n: int, base_bv: float, base_sv: float):
    """Quiet-but-not-uniform window so the rolling std is non-zero."""

    rows: list[tuple[float, float]] = []
    for i in range(n):
        jitter = (i % 5) - 2  # -2, -1, 0, 1, 2 cycle
        rows.append((base_bv + jitter, base_sv + jitter))
    return rows


def _quiet_prefix(n: int, *, bv: float, sv: float):
    """Strictly uniform window — rolling std is exactly 0."""

    return [(bv, sv)] * n


def test_detect_absorption_large_buy_volume_flat_delta():
    # 30 mildly varying bars with ~10 buy / ~10 sell, then one bar with
    # huge buy volume but near-flat delta (big buyers soaked up).
    quiet = _noisy_prefix(30, base_bv=10, base_sv=10)
    spike = (200.0, 190.0, 2.0)  # bv=200, sv=190, delta=2 (ratio ≈ 0.005)
    bars = _series(quiet + [spike])
    events = detect_absorption(
        bars,
        volume_zscore=1.5,
        max_delta_ratio=0.15,
        lookback=20,
    )
    assert len(events) == 1
    ev = events[0]
    assert ev.side == "buy"
    assert ev.volume == 200.0
    assert ev.delta_ratio < 0.15
    assert ev.zscore > 1.5
    assert 0.05 <= ev.confidence <= 1.0


def test_detect_absorption_large_sell_volume_flat_delta():
    quiet = _noisy_prefix(30, base_bv=10, base_sv=10)
    spike = (185.0, 200.0, -2.0)
    bars = _series(quiet + [spike])
    events = detect_absorption(
        bars,
        volume_zscore=1.5,
        max_delta_ratio=0.15,
        lookback=20,
    )
    assert len(events) == 1
    assert events[0].side == "sell"


def test_detect_absorption_large_volume_but_large_delta_not_absorbed():
    # Spike is huge but the net delta is also huge — that's displacement,
    # not absorption.
    quiet = _noisy_prefix(30, base_bv=10, base_sv=10)
    spike = (200.0, 5.0, 195.0)
    bars = _series(quiet + [spike])
    events = detect_absorption(
        bars,
        volume_zscore=1.5,
        max_delta_ratio=0.15,
        lookback=20,
    )
    assert events == []


def test_detect_absorption_needs_nonzero_std():
    # If every prior bar has the same side-volume, std is 0 → skipped.
    quiet = _quiet_prefix(30, bv=10, sv=10)
    spike = (100.0, 95.0, 5.0)
    bars = _series(quiet + [spike])
    events = detect_absorption(
        bars,
        volume_zscore=1.5,
        max_delta_ratio=0.15,
        lookback=20,
    )
    # Std of [10, 10, ...] is 0 so no events even with the spike.
    assert events == []


# ──────────────────────────── net bias ────────────────────────────


def test_derive_net_bias_empty_neutral():
    assert derive_net_bias([]) == "neutral"


def test_derive_net_bias_positive_cum_is_long():
    bars = _series([(10, 1), (8, 2), (6, 3)])
    assert derive_net_bias(bars, lookback=3) == "long"


def test_derive_net_bias_negative_cum_is_short():
    bars = _series([(1, 10), (2, 8), (3, 6)])
    assert derive_net_bias(bars, lookback=3) == "short"


def test_derive_net_bias_neutral_band():
    bars = _series([(5, 4)])  # delta = 1
    assert derive_net_bias(bars, neutral_band=5.0) == "neutral"


# ──────────────────────────── rollup ──────────────────────────────


def test_rollup_state_empty_bars_shell():
    rollup = rollup_state([])
    assert rollup.last_delta == 0.0
    assert rollup.cumulative_delta == 0.0
    assert rollup.active_imbalance is None
    assert rollup.recent_absorption == []
    assert rollup.net_bias == "neutral"


def test_rollup_state_active_imbalance_matches_last_bar():
    bars = _series([(10, 1), (8, 1)])
    imbalances = detect_imbalances(bars)
    rollup = rollup_state(bars, imbalances=imbalances)
    assert rollup.active_imbalance is not None
    assert rollup.active_imbalance.side == "buy"
    assert rollup.last_delta == 7.0  # 8 - 1
    assert rollup.cumulative_delta == 16.0
    assert rollup.net_bias == "long"


def test_rollup_state_stale_imbalance_not_active():
    bars = _series([(10, 1), (8, 1), (5, 5), (4, 5)])
    imbalances = detect_imbalances(bars)
    # The last bar (4,5) is balanced, not an imbalance — so the earlier
    # buy run should be closed and not marked active.
    rollup = rollup_state(bars, imbalances=imbalances)
    assert rollup.active_imbalance is None
