"""Pure-function tests for the Order Block + FVG detectors.

Like ``test_structure_bos_choch.py`` these use synthetic OHLC bar
fixtures so each emission is verifiable by inspection. The detectors
are deterministic and side-effect-free, so the database/HTTP fixtures
are not needed.

The test bar series mirror the BOS/CHOCH suite where appropriate so
the OB tests can chain ``detect_bos_choch`` → ``detect_order_blocks``
end-to-end.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Iterable

from app.structure import (
    detect_bos_choch,
    detect_fvgs,
    detect_order_blocks,
)

UTC = timezone.utc
T0 = datetime(2026, 4, 1, 0, 0, 0, tzinfo=UTC)


def _bar(i: int, *, o: float, h: float, l: float, c: float, v: float = 0.0):
    """Build a minimal bar fixture; only OHLCV + t are read by detectors."""

    return SimpleNamespace(
        t=T0 + timedelta(minutes=15 * i), o=o, h=h, l=l, c=c, v=v
    )


def _series(rows: Iterable[tuple[float, float, float, float]]):
    """Convert (o, h, l, c) tuples into a bar list with zero volume."""

    return [_bar(i, o=o, h=h, l=l, c=c) for i, (o, h, l, c) in enumerate(rows)]


def _series_v(
    rows: Iterable[tuple[float, float, float, float, float]],
):
    """Convert (o, h, l, c, v) tuples into a bar list with explicit volume."""

    return [
        _bar(i, o=o, h=h, l=l, c=c, v=v)
        for i, (o, h, l, c, v) in enumerate(rows)
    ]


# ──────────────────────────── Order Block ────────────────────────────


def test_bullish_ob_emitted_for_long_choch():
    """The OB candle should be the last down-close before the impulse."""

    bars = _series(
        [
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),  # swing-high pivot @ idx 3, price 13
            (12.5, 12.8, 11.5, 12),  # down candle (c<o) — OB candidate
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),  # last down-close before impulse
            (12.1, 13.5, 12, 13.4),  # impulse → CHOCH break of 13
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    assert len(events) == 1
    obs = detect_order_blocks(bars, events)
    assert len(obs) == 1
    ob = obs[0]
    assert ob.direction == "long"
    # Last down candle before impulse is bar 6: o=12.2, c=12.1.
    # Body high = 12.2, body low = 12.1.
    assert ob.high == 12.2
    assert ob.low == 12.1
    assert ob.t == bars[6].t
    assert ob.structure_event_id == events[0].id
    assert ob.retested is False
    assert ob.violated is False
    assert 0.0 <= ob.strength <= 1.0


def test_bearish_ob_emitted_for_short_choch():
    """A short event should pick the last up-close before the down impulse."""

    bars = _series(
        [
            # Phase A: bullish CHOCH establishes long bias.
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),  # swing-high @ idx 3 (price 13)
            (12.5, 12.8, 11.5, 12),
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),
            (12.1, 13.5, 12, 13.4),  # CHOCH long
            # Phase B: pullback → swing-low pivot at idx 11 (12.5).
            (13.4, 13.6, 13, 13.5),
            (13.5, 13.7, 13.2, 13.4),  # up candle — OB candidate
            (13.4, 13.5, 12.8, 13.0),  # down candle
            (13.0, 13.2, 12.5, 12.7),  # swing-low pivot
            (12.7, 13.0, 12.6, 12.9),  # up candle
            (12.9, 13.3, 12.7, 13.2),  # up candle
            (13.2, 13.5, 13.0, 13.4),  # up candle — last up before short
            # Phase C: bearish CHOCH at idx 15 (close 12.4 < 12.5).
            (13.4, 13.5, 12.0, 12.4),
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    short_events = [e for e in events if e.direction == "short"]
    assert short_events, "expected a bearish CHOCH"

    obs = detect_order_blocks(bars, events)
    short_obs = [o for o in obs if o.direction == "short"]
    assert short_obs, "expected a bearish OB tied to the short event"
    sob = short_obs[0]
    # Last up candle before the bearish impulse is bar 14: o=13.2, c=13.4.
    assert sob.t == bars[14].t
    assert sob.high == 13.4
    assert sob.low == 13.2


def test_ob_strength_no_volume_uses_two_term_formula():
    """Without volume, strength == 0.6 · displacement + 0.4 · follow_through.

    We feed a clean long CHOCH whose OB candle has zero volume so the
    volume term collapses out of the weighting. The follow-through
    bar is the impulse bar itself (next bar after the OB, always a
    continuation candle for a valid break), so follow = 1.0. The
    resulting strength therefore lives in [0.6·ε, 0.6 + 0.4] = [≈0, 1].
    """

    bars = _series(
        [
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10, 11),
            (11, 12, 10.5, 11.5),
            (11.5, 13, 11, 12.5),
            (12.5, 12.8, 11.5, 12),
            (12, 12.5, 11.8, 12.2),
            (12.2, 12.5, 11.9, 12.1),
            (12.1, 13.5, 12, 13.4),  # impulse / break
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    obs = detect_order_blocks(bars, events)
    assert len(obs) == 1
    # No volume path: must land on the 0.6/0.4 surface, bounded by 1.0.
    assert 0.4 <= obs[0].strength <= 1.0


def test_ob_strength_uses_volume_when_present():
    """When the OB candle has elevated volume the punch term lifts strength."""

    bars = _series_v(
        [
            (10, 11, 9.5, 10.5, 100),
            (10.5, 11.5, 10, 11, 100),
            (11, 12, 10.5, 11.5, 100),
            (11.5, 13, 11, 12.5, 100),
            (12.5, 12.8, 11.5, 12, 100),
            (12, 12.5, 11.8, 12.2, 100),
            (12.2, 12.5, 11.9, 12.1, 400),  # OB candle — punchy volume
            (12.1, 13.5, 12, 13.4, 100),
            (13.4, 13.6, 13.3, 13.5, 100),  # follow-through up
        ]
    )
    events = detect_bos_choch(bars, lookback=3)
    obs = detect_order_blocks(bars, events)
    assert len(obs) == 1
    # Volume punch ≈ 400/100 ÷ 2 → clipped to 1.0; combined with
    # follow_through=1 the strength must clear the no-volume baseline.
    assert obs[0].strength > 0.5


def test_no_events_no_obs():
    """Empty event list ⇒ empty OB list."""

    assert detect_order_blocks(_series([(10, 11, 9, 10)] * 5), []) == []


# ──────────────────────────── Fair Value Gap ─────────────────────────


def test_bullish_fvg_detected_and_unmitigated():
    """3-bar gap up — c.l > a.h — must emit one bullish FVG."""

    bars = _series(
        [
            (10.0, 10.5, 9.8, 10.2),  # A — high 10.5
            (10.2, 11.5, 10.1, 11.4),  # B — displacement
            (11.4, 12.0, 11.0, 11.8),  # C — low 11.0 > A.high 10.5
            (11.8, 12.2, 11.5, 12.0),  # no close ≤ 10.5 ⇒ unmitigated
        ]
    )
    fvgs = detect_fvgs(bars)
    assert len(fvgs) == 1
    g = fvgs[0]
    assert g.direction == "long"
    assert g.top == 11.0
    assert g.bottom == 10.5
    assert g.t == bars[1].t
    assert g.mitigated is False
    assert g.mitigated_at is None


def test_bearish_fvg_detected_and_mitigated():
    """3-bar gap down — c.h < a.l — must emit a bearish FVG and mitigate."""

    bars = _series(
        [
            (12.0, 12.5, 11.8, 12.2),  # A — low 11.8
            (12.2, 12.3, 10.5, 10.6),  # B — displacement
            (10.6, 11.0, 10.0, 10.5),  # C — high 11.0 < A.low 11.8
            (10.5, 11.5, 10.4, 11.4),  # close 11.4 < top 11.8 → not mitigation
            (11.4, 12.5, 11.3, 12.3),  # close 12.3 ≥ top 11.8 → mitigation
        ]
    )
    fvgs = detect_fvgs(bars)
    bear = [g for g in fvgs if g.direction == "short"]
    assert len(bear) == 1
    g = bear[0]
    assert g.top == 11.8
    assert g.bottom == 11.0
    assert g.t == bars[1].t
    assert g.mitigated is True
    assert g.mitigated_at == bars[4].t


def test_no_fvg_on_continuous_overlap():
    """Bars whose ranges overlap leave no 3-bar gap."""

    bars = _series(
        [
            (10, 11, 9.5, 10.5),
            (10.5, 11.5, 10.2, 11.2),
            (11.2, 12.0, 10.8, 11.8),  # C.low 10.8 < A.high 11 → no FVG
            (11.8, 12.2, 11.5, 12.0),
        ]
    )
    assert detect_fvgs(bars) == []


def test_short_series_returns_empty():
    """Fewer than 3 bars cannot form an FVG."""

    assert detect_fvgs(_series([(10, 11, 9, 10), (10, 11, 9, 10)])) == []


def test_multiple_fvgs_in_a_run():
    """Successive 3-bar gaps each produce their own FVG row."""

    bars = _series(
        [
            (10.0, 10.5, 9.8, 10.2),  # A1 — high 10.5
            (10.2, 11.5, 10.1, 11.4),  # B1
            (11.4, 12.0, 11.0, 11.8),  # C1 — low 11.0 > 10.5 ⇒ FVG #1
            (11.8, 13.0, 11.7, 12.9),  # B2
            (12.9, 13.5, 12.5, 13.2),  # C2 — low 12.5 > 11.8.high? B-A check
        ]
    )
    fvgs = detect_fvgs(bars)
    # The detector slides a 3-bar window over every index, so a
    # sustained trending leg with three clean gaps emits a row at i=0
    # (10.5 → 11.0), i=1 (11.5 → 11.7), and i=2 (12.0 → 12.5).
    assert len(fvgs) == 3
    assert all(g.direction == "long" for g in fvgs)
    # Emission order follows bar order.
    assert [g.t for g in fvgs] == [bars[1].t, bars[2].t, bars[3].t]
