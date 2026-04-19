"""Pure-function tests for the setup detector library.

Each setup detector exposes a deterministic ``detect_*`` function over
synthetic ``BarLike`` fixtures. These tests avoid the database and the
FastAPI client — they only assert the detector logic itself.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Iterable

from app.setups import (
    blend_confidence,
    compute_rr,
    default_expiry,
    detect_all_setups,
    detect_breakout_retest,
    detect_fvg_reaction,
    detect_liquidity_sweep_reclaim,
    detect_momentum_continuation,
    detect_ob_retest,
    detect_session_reversal,
)

UTC = timezone.utc
T0 = datetime(2026, 4, 1, 8, 0, 0, tzinfo=UTC)


def _bar(i: int, *, o: float, h: float, l: float, c: float):
    return SimpleNamespace(
        t=T0 + timedelta(minutes=i),
        o=o,
        h=h,
        l=l,
        c=c,
    )


def _series(rows: Iterable[tuple[float, float, float, float]]):
    return [
        _bar(i, o=o, h=h, l=l, c=c) for i, (o, h, l, c) in enumerate(rows)
    ]


def _pivot(*, kind: str, price: float, t: datetime, bar_index: int):
    return SimpleNamespace(
        kind=kind, price=price, t=t, bar_index=bar_index
    )


def _ob(
    *,
    direction: str,
    high: float,
    low: float,
    t: datetime,
    strength: float = 0.7,
    violated: bool = False,
):
    return SimpleNamespace(
        id=f"ob_{int(low*1000)}",
        direction=direction,
        high=high,
        low=low,
        t=t,
        strength=strength,
        retested=False,
        violated=violated,
        detected_at=t,
    )


def _fvg(
    *,
    direction: str,
    top: float,
    bottom: float,
    t: datetime,
    mitigated: bool = False,
):
    return SimpleNamespace(
        id=f"fvg_{int(bottom*1000)}",
        direction=direction,
        top=top,
        bottom=bottom,
        t=t,
        mitigated=mitigated,
        mitigated_at=None,
        detected_at=t,
    )


def _struct(
    *,
    kind: str,
    direction: str,
    level: float,
    confirmation_t: datetime,
    confidence: float = 0.7,
):
    pivot = SimpleNamespace(
        kind="swing_high" if direction == "long" else "swing_low",
        price=level,
        t=confirmation_t,
        bar_index=0,
    )
    return SimpleNamespace(
        id=f"se_{int(level*1000)}",
        kind=kind,
        direction=direction,
        level=level,
        broken_pivot=pivot,
        confirmation_t=confirmation_t,
        confidence=confidence,
        detected_at=confirmation_t,
    )


def _imbalance(
    *,
    side: str,
    end_t: datetime,
    confidence: float = 0.8,
    bar_count: int = 3,
):
    return SimpleNamespace(
        id=f"imb_{side}_{end_t.minute}",
        side=side,
        start_t=end_t - timedelta(minutes=bar_count),
        end_t=end_t,
        bar_count=bar_count,
        total_delta=10.0 if side == "buy" else -10.0,
        total_volume=20.0,
        ratio=0.7,
        confidence=confidence,
        detected_at=end_t,
    )


# ─────────────────────────── shared helpers ────────────────────────


def test_blend_confidence_clipped():
    out = blend_confidence(
        structure_score=2.0,
        order_flow_score=-1.0,
    )
    assert 0.05 <= out.score <= 0.95
    assert out.components.structure_score == 1.0
    assert out.components.order_flow_score == 0.0


def test_compute_rr_basic():
    assert compute_rr(entry_ref=100, stop_loss=99, take_profit=102) == 2.0


def test_compute_rr_zero_risk_returns_zero():
    assert compute_rr(entry_ref=100, stop_loss=100, take_profit=110) == 0.0


def test_default_expiry_per_tf():
    base = T0
    assert default_expiry("1m", detected_at=base) == base + timedelta(minutes=5)
    assert default_expiry("1h", detected_at=base) == base + timedelta(minutes=240)
    # Unknown tf falls back to a 60-minute default.
    assert default_expiry("xyz", detected_at=base) == base + timedelta(minutes=60)


# ──────────────────── liquidity sweep + reclaim ────────────────────


def test_liquidity_sweep_long_emits_setup():
    # Bars: a swing low at index 1, then a sweep + reclaim bar at index 4.
    bars = _series(
        [
            (1.10, 1.105, 1.095, 1.10),  # 0
            (1.10, 1.102, 1.090, 1.092),  # 1 — swing low at 1.090
            (1.092, 1.095, 1.088, 1.094),  # 2
            (1.094, 1.097, 1.090, 1.096),  # 3
            (1.095, 1.099, 1.085, 1.098),  # 4 — sweep below 1.090, reclaim
        ]
    )
    pivots = [_pivot(kind="swing_low", price=1.090, t=bars[1].t, bar_index=1)]
    out = detect_liquidity_sweep_reclaim(
        bars, pivots=pivots, symbol_id="sym_eu", tf="15m"
    )
    assert len(out) == 1
    s = out[0]
    assert s.direction == "long"
    assert s.type == "liquidity_sweep_reclaim"
    assert s.entry.low <= s.entry.high
    assert s.stop_loss < s.entry.low
    assert s.take_profit > s.entry.high
    assert s.rr > 0


def test_liquidity_sweep_short_emits_setup():
    bars = _series(
        [
            (1.10, 1.110, 1.099, 1.101),
            (1.101, 1.115, 1.100, 1.108),  # swing high at 1.115
            (1.108, 1.112, 1.105, 1.110),
            (1.110, 1.118, 1.108, 1.116),
            (1.116, 1.125, 1.110, 1.112),  # sweep above 1.115, reclaim below
        ]
    )
    pivots = [_pivot(kind="swing_high", price=1.115, t=bars[1].t, bar_index=1)]
    out = detect_liquidity_sweep_reclaim(
        bars, pivots=pivots, symbol_id="sym_eu", tf="15m"
    )
    assert len(out) == 1
    assert out[0].direction == "short"


def test_liquidity_sweep_no_reclaim_no_setup():
    # Bar pierces the swing low and *closes below it* — that's a
    # break, not a sweep+reclaim.
    bars = _series(
        [
            (1.10, 1.102, 1.090, 1.092),  # swing low candidate
            (1.092, 1.095, 1.080, 1.082),  # closes below — no reclaim
        ]
    )
    pivots = [_pivot(kind="swing_low", price=1.090, t=bars[0].t, bar_index=0)]
    out = detect_liquidity_sweep_reclaim(
        bars, pivots=pivots, symbol_id="sym_eu", tf="15m"
    )
    assert out == []


def test_liquidity_sweep_orderflow_boosts_confidence():
    bars = _series(
        [
            (1.10, 1.102, 1.090, 1.092),
            (1.092, 1.095, 1.085, 1.094),  # sweep + reclaim long
        ]
    )
    pivots = [_pivot(kind="swing_low", price=1.090, t=bars[0].t, bar_index=0)]
    base = detect_liquidity_sweep_reclaim(
        bars, pivots=pivots, symbol_id="s", tf="15m"
    )
    boosted = detect_liquidity_sweep_reclaim(
        bars,
        pivots=pivots,
        imbalances=[_imbalance(side="buy", end_t=bars[1].t, confidence=0.95)],
        symbol_id="s",
        tf="15m",
    )
    assert base[0].confidence.score < boosted[0].confidence.score


# ─────────────────────────── ob retest ─────────────────────────────


def test_ob_retest_long_emits_setup():
    bars = _series(
        [
            (1.10, 1.115, 1.099, 1.114),
            (1.114, 1.116, 1.108, 1.115),
            (1.115, 1.117, 1.110, 1.116),  # bar 2 — retest of OB at [1.108, 1.114]
        ]
    )
    obs = [
        _ob(direction="long", high=1.114, low=1.108, t=bars[0].t)
    ]
    out = detect_ob_retest(
        bars, order_blocks=obs, symbol_id="sym_eu", tf="15m"
    )
    assert len(out) == 1
    assert out[0].direction == "long"
    assert out[0].entry.low == 1.108
    assert out[0].entry.high == 1.114


def test_ob_retest_violated_skipped():
    bars = _series([(1.0, 1.01, 0.99, 1.005)])
    obs = [_ob(direction="long", high=1.0, low=0.99, t=bars[0].t, violated=True)]
    out = detect_ob_retest(
        bars, order_blocks=obs, symbol_id="s", tf="15m"
    )
    assert out == []


def test_ob_retest_close_through_marks_consumed_no_emit():
    bars = _series(
        [
            (1.10, 1.115, 1.099, 1.114),
            (1.115, 1.117, 1.105, 1.107),  # closes BELOW OB low → violation
        ]
    )
    obs = [_ob(direction="long", high=1.114, low=1.108, t=bars[0].t)]
    out = detect_ob_retest(
        bars, order_blocks=obs, symbol_id="s", tf="15m"
    )
    assert out == []


# ───────────────────────── breakout retest ─────────────────────────


def test_breakout_retest_long_emits_setup():
    bars = _series(
        [
            (1.10, 1.115, 1.099, 1.114),
            (1.114, 1.118, 1.110, 1.116),  # impulse
            (1.116, 1.117, 1.111, 1.115),  # retest of broken level 1.115
        ]
    )
    events = [
        _struct(
            kind="bos",
            direction="long",
            level=1.115,
            confirmation_t=bars[0].t,
            confidence=0.7,
        )
    ]
    out = detect_breakout_retest(
        bars, events=events, symbol_id="s", tf="15m"
    )
    assert len(out) == 1
    s = out[0]
    assert s.direction == "long"
    assert s.entry.ref == 1.115
    assert s.stop_loss < s.entry.low
    assert s.take_profit > s.entry.high


def test_breakout_retest_close_through_failed_no_emit():
    bars = _series(
        [
            (1.10, 1.115, 1.099, 1.114),
            (1.115, 1.118, 1.105, 1.108),  # closes way below broken level
        ]
    )
    events = [
        _struct(
            kind="bos",
            direction="long",
            level=1.115,
            confirmation_t=bars[0].t,
        )
    ]
    out = detect_breakout_retest(
        bars, events=events, symbol_id="s", tf="15m"
    )
    assert out == []


# ───────────────────────── fvg reaction ────────────────────────────


def test_fvg_reaction_long_emits_setup():
    bars = _series(
        [
            (1.10, 1.105, 1.099, 1.104),
            (1.104, 1.109, 1.103, 1.108),
            (1.108, 1.110, 1.106, 1.109),
            (1.109, 1.111, 1.103, 1.110),  # touches gap [1.105, 1.108], closes above
        ]
    )
    fvgs = [
        _fvg(direction="long", top=1.108, bottom=1.105, t=bars[1].t)
    ]
    out = detect_fvg_reaction(
        bars, fvgs=fvgs, symbol_id="s", tf="15m"
    )
    assert len(out) == 1
    assert out[0].direction == "long"


def test_fvg_reaction_no_close_outside_no_emit():
    bars = _series(
        [
            (1.10, 1.108, 1.105, 1.107),  # inside the gap, doesn't close above top
        ]
    )
    fvgs = [
        _fvg(direction="long", top=1.108, bottom=1.105, t=bars[0].t - timedelta(minutes=5))
    ]
    # Bar timestamp must be after the FVG; create a fresh bar.
    bars = _series(
        [
            (1.10, 1.108, 1.105, 1.107),
            (1.107, 1.108, 1.105, 1.107),
        ]
    )
    fvgs[0].t = bars[0].t  # type: ignore[attr-defined]
    out = detect_fvg_reaction(
        bars[1:], fvgs=fvgs, symbol_id="s", tf="15m"
    )
    assert out == []


def test_fvg_reaction_mitigated_skipped():
    bars = _series([(1.0, 1.02, 0.99, 1.01)])
    fvgs = [
        _fvg(
            direction="long",
            top=1.005,
            bottom=1.000,
            t=bars[0].t - timedelta(minutes=1),
            mitigated=True,
        )
    ]
    out = detect_fvg_reaction(
        bars, fvgs=fvgs, symbol_id="s", tf="15m"
    )
    assert out == []


# ─────────────────────── momentum continuation ─────────────────────


def test_momentum_continuation_long_with_flow_emits():
    bars = _series(
        [
            (1.10, 1.103, 1.099, 1.102),  # small green bar
            (1.102, 1.115, 1.101, 1.114),  # bigger green bar — expansion
        ]
    )
    imb = [_imbalance(side="buy", end_t=bars[1].t, confidence=0.85)]
    out = detect_momentum_continuation(
        bars,
        bias="long",
        imbalances=imb,
        symbol_id="s",
        tf="15m",
    )
    assert len(out) == 1
    assert out[0].direction == "long"


def test_momentum_continuation_no_flow_no_emit():
    # Without any imbalance, the of_score stays at 0.5 baseline → skip.
    bars = _series(
        [
            (1.10, 1.103, 1.099, 1.102),
            (1.102, 1.115, 1.101, 1.114),
        ]
    )
    out = detect_momentum_continuation(
        bars, bias="long", symbol_id="s", tf="15m"
    )
    assert out == []


def test_momentum_continuation_neutral_bias_no_emit():
    bars = _series(
        [
            (1.10, 1.103, 1.099, 1.102),
            (1.102, 1.115, 1.101, 1.114),
        ]
    )
    out = detect_momentum_continuation(
        bars, bias="neutral", symbol_id="s", tf="15m"
    )
    assert out == []


# ──────────────────────── session reversal ─────────────────────────


def test_session_reversal_short_at_session_high():
    # Bar timestamps are inside the London session (07:00-12:00 UTC).
    base = datetime(2026, 4, 1, 7, 0, 0, tzinfo=UTC)
    bars = [
        SimpleNamespace(
            t=base + timedelta(minutes=i),
            o=o, h=h, l=l, c=c,
        )
        for i, (o, h, l, c) in enumerate(
            [
                (1.10, 1.102, 1.099, 1.101),  # establish session
                (1.101, 1.105, 1.100, 1.104),  # session high climbs to 1.105
                (1.104, 1.110, 1.103, 1.102),  # pierce 1.105, reverse + close low
            ]
        )
    ]
    out = detect_session_reversal(
        bars, symbol_id="s", tf="15m"
    )
    assert len(out) == 1
    assert out[0].direction == "short"
    assert "session-high reversal" in out[0].reasoning


def test_session_reversal_long_at_session_low():
    base = datetime(2026, 4, 1, 12, 0, 0, tzinfo=UTC)  # NY open
    bars = [
        SimpleNamespace(
            t=base + timedelta(minutes=i),
            o=o, h=h, l=l, c=c,
        )
        for i, (o, h, l, c) in enumerate(
            [
                (1.10, 1.102, 1.099, 1.101),
                (1.101, 1.1015, 1.095, 1.097),  # extend session low only
                (1.097, 1.099, 1.090, 1.098),  # pierce 1.095, reverse up
            ]
        )
    ]
    out = detect_session_reversal(
        bars, symbol_id="s", tf="15m"
    )
    assert len(out) == 1
    assert out[0].direction == "long"


def test_session_reversal_no_reversal_no_setup():
    base = datetime(2026, 4, 1, 8, 0, 0, tzinfo=UTC)
    bars = [
        SimpleNamespace(
            t=base + timedelta(minutes=i),
            o=o, h=h, l=l, c=c,
        )
        for i, (o, h, l, c) in enumerate(
            [
                (1.10, 1.102, 1.099, 1.101),
                (1.101, 1.105, 1.100, 1.104),
                (1.104, 1.110, 1.103, 1.109),  # pierces but closes at the high
            ]
        )
    ]
    out = detect_session_reversal(
        bars, symbol_id="s", tf="15m"
    )
    assert out == []


# ─────────────────────────── orchestrator ──────────────────────────


def test_detect_all_setups_combines_outputs():
    bars = _series(
        [
            (1.10, 1.115, 1.099, 1.114),
            (1.114, 1.118, 1.110, 1.116),
            (1.116, 1.117, 1.111, 1.115),  # breakout retest
        ]
    )
    events = [
        _struct(
            kind="bos",
            direction="long",
            level=1.115,
            confirmation_t=bars[0].t,
        )
    ]
    out = detect_all_setups(
        bars,
        symbol_id="s",
        tf="15m",
        structure_events=events,
    )
    assert any(s.type == "breakout_retest" for s in out)


def test_detect_all_setups_dedupes_collisions():
    # Two detectors firing at the same entry-ref / direction should
    # collapse to the higher-confidence one.
    bars = _series(
        [
            (1.10, 1.115, 1.099, 1.114),
            (1.114, 1.118, 1.110, 1.116),
            (1.116, 1.117, 1.111, 1.115),
        ]
    )
    events = [
        _struct(
            kind="bos",
            direction="long",
            level=1.115,
            confirmation_t=bars[0].t,
        )
    ]
    obs = [
        _ob(direction="long", high=1.117, low=1.111, t=bars[1].t)
    ]
    out = detect_all_setups(
        bars,
        symbol_id="s",
        tf="15m",
        structure_events=events,
        order_blocks=obs,
    )
    # No two emitted setups share the same (ref, direction) key.
    keys = [(round(s.entry.ref, 6), s.direction) for s in out]
    assert len(keys) == len(set(keys))
