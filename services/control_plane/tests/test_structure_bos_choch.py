"""Pure-function tests for the BOS/CHOCH detector.

Uses synthetic OHLC fixtures rather than real market data so each
transition is verifiable by inspection. The detector is deterministic
and side-effect-free, so these tests do not need the database or the
HTTP client fixtures.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Iterable

import pytest

from app.structure import detect_bos_choch, detect_pivots
from app.structure.bos_choch import _confidence_for_break

UTC = timezone.utc
T0 = datetime(2026, 4, 1, 0, 0, 0, tzinfo=UTC)


def _bar(i: int, *, o: float, h: float, l: float, c: float):
    """Build a minimal bar fixture; only OHLC + t are read by the detector."""

    return SimpleNamespace(
        t=T0 + timedelta(minutes=15 * i), o=o, h=h, l=l, c=c, v=0.0
    )


def _series(rows: Iterable[tuple[float, float, float, float]]):
    """Convert a list of (o, h, l, c) into a series of bars."""

    return [_bar(i, o=o, h=h, l=l, c=c) for i, (o, h, l, c) in enumerate(rows)]


# ────────────────────────── pivot detector ──────────────────────────


def test_detect_pivots_finds_strict_swing_high():
    bars = _series(
        [
            # ramp up then back down — bar 3 is the strict peak.
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),  # i=3 — peak high 13
            (12.5, 12.8, 11.5, 12),
            (12, 12.2, 11, 11.2),
            (11.2, 11.4, 10, 10.5),
        ]
    )
    pivots = detect_pivots(bars, lookback=3)
    assert len(pivots) == 1
    assert pivots[0].kind == "swing_high"
    assert pivots[0].bar_index == 3
    assert pivots[0].price == 13


def test_detect_pivots_finds_strict_swing_low():
    bars = _series(
        [
            (10, 10.5, 9, 9.2),
            (9.2, 9.4, 8.5, 8.8),
            (8.8, 9, 8, 8.3),
            (8.3, 8.5, 7, 7.5),  # i=3 — trough low 7
            (7.5, 8, 7.2, 7.8),
            (7.8, 8.5, 7.6, 8.3),
            (8.3, 9, 8, 8.8),
        ]
    )
    pivots = detect_pivots(bars, lookback=3)
    assert len(pivots) == 1
    assert pivots[0].kind == "swing_low"
    assert pivots[0].bar_index == 3
    assert pivots[0].price == 7


def test_detect_pivots_too_few_bars_returns_empty():
    bars = _series([(10, 11, 9, 10) for _ in range(3)])
    assert detect_pivots(bars, lookback=3) == []


def test_detect_pivots_invalid_lookback():
    with pytest.raises(ValueError):
        detect_pivots(_series([]), lookback=0)


def test_detect_pivots_skips_non_strict_equal_highs():
    """Equal-height bars on either side disqualify the swing."""

    bars = _series(
        [
            (10, 11, 9, 10),
            (10, 12, 10, 11),
            (10, 12, 10, 11),  # equal high — must NOT be a swing
            (10, 12, 10, 11),
            (10, 11, 9, 10),
        ]
    )
    assert detect_pivots(bars, lookback=2) == []


# ────────────────────────── BOS / CHOCH ─────────────────────────────


def test_first_qualifying_break_is_choch_when_neutral():
    """Seed bias = neutral → first break must be CHOCH, not BOS."""

    bars = _series(
        [
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),  # swing-high pivot @ idx 3, price 13
            (12.5, 12.8, 11.5, 12),
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),
            (12.1, 13.5, 12, 13.4),  # close 13.4 > 13 → break
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    assert len(events) == 1
    e = events[0]
    assert e.kind == "choch"
    assert e.direction == "long"
    assert e.level == 13
    assert e.confidence > 0


def test_continuation_break_is_bos_after_choch():
    """After CHOCH flips bias to long, the next swing-high break = BOS."""

    bars = _series(
        [
            # First leg up + pullback — establishes a swing-high @ ~13.
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),  # swing-high #1 at idx 3
            (12.5, 12.8, 11.5, 12),
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),
            (12.1, 13.5, 12, 13.4),  # CHOCH break of 13
            # Pullback + new swing-high @ ~14.
            (13.4, 13.6, 13, 13.2),
            (13.2, 13.4, 13, 13.1),
            (13.1, 13.3, 12.8, 13),
            (13, 14, 12.9, 13.5),  # swing-high #2 at idx 11, price 14
            (13.5, 13.8, 13, 13.2),
            (13.2, 13.4, 13, 13.1),
            (13.1, 13.3, 12.9, 13),
            (13, 14.5, 12.9, 14.4),  # BOS break of 14
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    assert len(events) == 2
    assert [e.kind for e in events] == ["choch", "bos"]
    assert [e.direction for e in events] == ["long", "long"]
    assert events[1].level == 14


def test_bearish_choch_after_bullish_bias():
    """Bullish bias flips to short on a sub-swing-low close.

    Swing-low pivot forms at idx 11 (price 12.5), bracketed by higher
    lows on each side. The close at idx 15 (12.4) breaks below it.
    """

    bars = _series(
        [
            # Phase A: bullish CHOCH establishes long bias.
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),  # swing-high pivot idx 3 (price 13)
            (12.5, 12.8, 11.5, 12),
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),
            (12.1, 13.5, 12, 13.4),  # CHOCH long — close 13.4 > 13
            # Phase B: pullback forms swing-low @ idx 11 (price 12.5).
            (13.4, 13.6, 13, 13.5),
            (13.5, 13.7, 13.2, 13.4),
            (13.4, 13.5, 12.8, 13.0),
            (13.0, 13.2, 12.5, 12.7),  # swing-low pivot idx 11
            (12.7, 13.0, 12.6, 12.9),
            (12.9, 13.3, 12.7, 13.2),
            (13.2, 13.5, 13.0, 13.4),
            # Phase C: bearish CHOCH — close 12.4 < 12.5.
            (13.4, 13.5, 12.0, 12.4),
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    kinds = [(e.kind, e.direction) for e in events]
    assert ("choch", "long") in kinds
    assert ("choch", "short") in kinds
    # Verify ordering — long CHOCH happens before short CHOCH.
    long_idx = next(i for i, e in enumerate(events) if e.direction == "long")
    short_idx = next(i for i, e in enumerate(events) if e.direction == "short")
    assert long_idx < short_idx
    # The bearish event should reference the swing-low we set up.
    bear = next(e for e in events if e.direction == "short")
    assert bear.level == 12.5


def test_no_pivots_no_events():
    """Flat bars produce no swings → no events."""

    bars = _series([(10, 10, 10, 10) for _ in range(20)])
    assert detect_bos_choch(bars, lookback=3) == []


def test_confidence_scales_with_displacement():
    """Bigger break magnitude → higher confidence, capped at 1.0."""

    weak = _confidence_for_break(
        breaking_close=100.01, swing_price=100.0, leg_height=10.0
    )
    strong = _confidence_for_break(
        breaking_close=110.0, swing_price=100.0, leg_height=10.0
    )
    capped = _confidence_for_break(
        breaking_close=200.0, swing_price=100.0, leg_height=10.0
    )
    assert weak < strong
    assert weak >= 0.05  # floor
    assert capped == 1.0


def test_confidence_zero_leg_returns_neutral():
    assert _confidence_for_break(
        breaking_close=10.0, swing_price=10.0, leg_height=0.0
    ) == 0.5


def test_seed_bias_long_yields_bos_first():
    """If caller asserts existing long bias, the first break is BOS not CHOCH."""

    bars = _series(
        [
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),
            (12.5, 12.8, 11.5, 12),
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),
            (12.1, 13.5, 12, 13.4),  # close 13.4 > 13
        ]
    )
    events = detect_bos_choch(bars, lookback=3, seed_bias="long")
    assert len(events) == 1
    assert events[0].kind == "bos"
    assert events[0].direction == "long"
