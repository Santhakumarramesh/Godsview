"""Pure-function tests for the multi-timeframe Fusion Engine.

Covers:
  * bias derivation from a set of structure events (most-recent wins)
  * 4H+1H rolling into HTF, 15m+5m rolling into LTF
  * conflict flag flips when buckets disagree
  * OB ``retested`` / ``violated`` mutation across post-OB bars
  * FVG ``mitigated`` / ``mitigated_at`` mutation across post-FVG bars
  * recent_events list returns one row per timeframe sorted desc
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Iterable

from app.structure import (
    FvgOut,
    OrderBlockOut,
    PivotOut,
    StructureEventOut,
    build_market_context,
    derive_bias_from_events,
    update_fvg_state,
    update_order_block_state,
)

UTC = timezone.utc
T0 = datetime(2026, 4, 1, 0, 0, 0, tzinfo=UTC)


def _bar(i: int, *, o: float, h: float, l: float, c: float, v: float = 0.0):
    return SimpleNamespace(
        t=T0 + timedelta(minutes=15 * i), o=o, h=h, l=l, c=c, v=v
    )


def _series(rows: Iterable[tuple[float, float, float, float]]):
    return [_bar(i, o=o, h=h, l=l, c=c) for i, (o, h, l, c) in enumerate(rows)]


def _pivot(*, t: datetime, price: float, kind: str, idx: int) -> PivotOut:
    return PivotOut(t=t, price=price, kind=kind, bar_index=idx)


def _event(
    *,
    direction: str,
    confirmation_offset: int,
    kind: str = "bos",
    level: float = 100.0,
    sym: str = "sym_eurusd",
) -> StructureEventOut:
    pivot = _pivot(
        t=T0 + timedelta(minutes=15 * (confirmation_offset - 1)),
        price=level,
        kind="swing_high" if direction == "long" else "swing_low",
        idx=confirmation_offset - 1,
    )
    return StructureEventOut(
        id=f"se_{direction}_{confirmation_offset}",
        kind=kind,
        direction=direction,
        level=level,
        broken_pivot=pivot,
        confirmation_t=T0 + timedelta(minutes=15 * confirmation_offset),
        confidence=0.7,
        detected_at=T0,
    )


# ──────────────────────────── bias derivation ────────────────────────


def test_derive_bias_empty_is_neutral():
    assert derive_bias_from_events([]) == "neutral"


def test_derive_bias_picks_most_recent_event():
    events = [
        _event(direction="long", confirmation_offset=1),
        _event(direction="short", confirmation_offset=5),
    ]
    assert derive_bias_from_events(events) == "short"


# ───────────────────────── HTF / LTF aggregation ─────────────────────


def test_htf_and_ltf_align_no_conflict():
    """Both buckets long ⇒ aligned context, no conflict."""

    ctx = build_market_context(
        symbol_id="sym_eurusd",
        events_by_tf={
            "4h": [_event(direction="long", confirmation_offset=10)],
            "15m": [_event(direction="long", confirmation_offset=20)],
        },
        order_blocks=[],
        fvgs=[],
    )
    assert ctx.htf_bias == "long"
    assert ctx.ltf_bias == "long"
    assert ctx.conflict is False


def test_htf_long_ltf_short_marks_conflict():
    ctx = build_market_context(
        symbol_id="sym_eurusd",
        events_by_tf={
            "4h": [_event(direction="long", confirmation_offset=10)],
            "5m": [_event(direction="short", confirmation_offset=22)],
        },
        order_blocks=[],
        fvgs=[],
    )
    assert ctx.htf_bias == "long"
    assert ctx.ltf_bias == "short"
    assert ctx.conflict is True


def test_4h_dominates_1h_in_htf_bucket():
    """When 4H and 1H disagree, 4H wins (slower structure dominates)."""

    ctx = build_market_context(
        symbol_id="sym_eurusd",
        events_by_tf={
            "4h": [_event(direction="long", confirmation_offset=10)],
            "1h": [_event(direction="short", confirmation_offset=12)],
        },
        order_blocks=[],
        fvgs=[],
    )
    assert ctx.htf_bias == "long"


def test_15m_dominates_5m_in_ltf_bucket():
    ctx = build_market_context(
        symbol_id="sym_eurusd",
        events_by_tf={
            "15m": [_event(direction="short", confirmation_offset=18)],
            "5m": [_event(direction="long", confirmation_offset=22)],
        },
        order_blocks=[],
        fvgs=[],
    )
    assert ctx.ltf_bias == "short"


def test_neutral_buckets_never_conflict():
    """Neutral × any bias never trips conflict — only directional mismatches do."""

    ctx = build_market_context(
        symbol_id="sym_eurusd",
        events_by_tf={"15m": [_event(direction="short", confirmation_offset=22)]},
        order_blocks=[],
        fvgs=[],
    )
    assert ctx.htf_bias == "neutral"
    assert ctx.ltf_bias == "short"
    assert ctx.conflict is False


def test_recent_events_one_per_tf_ordered_desc():
    e_4h = _event(direction="long", confirmation_offset=10)
    e_1h = _event(direction="long", confirmation_offset=12)
    e_15m = _event(direction="long", confirmation_offset=20)
    ctx = build_market_context(
        symbol_id="sym_eurusd",
        events_by_tf={"4h": [e_4h], "1h": [e_1h], "15m": [e_15m]},
        order_blocks=[],
        fvgs=[],
    )
    assert [e.id for e in ctx.recent_events] == [e_15m.id, e_1h.id, e_4h.id]


# ───────────────────── OB state mutation ─────────────────────────────


def _ob(
    direction: str,
    *,
    high: float,
    low: float,
    t_offset: int,
    structure_event_id: str | None = None,
) -> OrderBlockOut:
    return OrderBlockOut(
        id=f"ob_{direction}_{t_offset}",
        direction=direction,
        high=high,
        low=low,
        t=T0 + timedelta(minutes=15 * t_offset),
        strength=0.75,
        retested=False,
        violated=False,
        structure_event_id=structure_event_id,
        detected_at=T0,
    )


def test_bullish_ob_retest_then_no_violation():
    """A bar that re-enters the body but doesn't close below ⇒ retested."""

    ob = _ob("long", high=12.2, low=12.1, t_offset=6)
    bars_after = _series(
        [
            (12.1, 13.5, 12.0, 13.4),  # impulse
            (13.4, 13.6, 12.15, 13.0),  # low 12.15 ≤ 12.2 ⇒ retest
            (13.0, 13.5, 12.3, 13.4),
        ]
    )
    # Ensure bars_after.t actually post-date the OB.
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=15 * (7 + i)),
            o=b.o, h=b.h, l=b.l, c=b.c, v=b.v,
        )
        for i, b in enumerate(bars_after)
    ]
    [updated] = update_order_block_state([ob], bars_after=bars_after)
    assert updated.retested is True
    assert updated.violated is False


def test_bullish_ob_violation_short_circuits():
    """First close below the body sets violated=True and stops the scan."""

    ob = _ob("long", high=12.2, low=12.1, t_offset=6)
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=15 * (7 + i)),
            o=b[0], h=b[1], l=b[2], c=b[3], v=0.0,
        )
        for i, b in enumerate(
            [
                (12.1, 13.5, 12.0, 13.4),
                (13.4, 13.6, 12.0, 12.05),  # close 12.05 < 12.1 ⇒ violated
                (12.05, 13.0, 12.0, 12.9),  # would be retest, but already violated
            ]
        )
    ]
    [updated] = update_order_block_state([ob], bars_after=bars_after)
    assert updated.violated is True


def test_bearish_ob_retest_and_violation_rules():
    """Mirror the bullish rules for a short OB."""

    ob = _ob("short", high=13.4, low=13.2, t_offset=14)
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=15 * (15 + i)),
            o=b[0], h=b[1], l=b[2], c=b[3], v=0.0,
        )
        for i, b in enumerate(
            [
                (13.4, 13.5, 12.5, 12.7),  # impulse down
                (12.7, 13.25, 12.6, 12.9),  # high 13.25 ≥ 13.2 ⇒ retest
                (12.9, 13.45, 12.8, 13.5),  # close 13.5 > 13.4 ⇒ violated
            ]
        )
    ]
    [updated] = update_order_block_state([ob], bars_after=bars_after)
    assert updated.retested is True
    assert updated.violated is True


def test_ob_state_unchanged_when_no_post_bars():
    ob = _ob("long", high=12.2, low=12.1, t_offset=6)
    [updated] = update_order_block_state([ob], bars_after=[])
    assert updated.retested is False
    assert updated.violated is False


# ───────────────────── FVG state mutation ─────────────────────────────


def _fvg(
    direction: str,
    *,
    top: float,
    bottom: float,
    t_offset: int,
) -> FvgOut:
    return FvgOut(
        id=f"fvg_{direction}_{t_offset}",
        direction=direction,
        top=top,
        bottom=bottom,
        t=T0 + timedelta(minutes=15 * t_offset),
        mitigated=False,
        mitigated_at=None,
        detected_at=T0,
    )


def test_bullish_fvg_mitigation_stamps_first_through_close():
    g = _fvg("long", top=11.0, bottom=10.5, t_offset=1)
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=15 * (3 + i)),
            o=0, h=0, l=0, c=c, v=0,
        )
        for i, c in enumerate([10.7, 10.49, 10.4])
    ]
    [updated] = update_fvg_state([g], bars_after=bars_after)
    assert updated.mitigated is True
    assert updated.mitigated_at == bars_after[1].t  # first close ≤ 10.5


def test_bearish_fvg_mitigation_uses_top_threshold():
    g = _fvg("short", top=11.8, bottom=11.0, t_offset=1)
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=15 * (3 + i)),
            o=0, h=0, l=0, c=c, v=0,
        )
        for i, c in enumerate([11.5, 11.79, 11.85])
    ]
    [updated] = update_fvg_state([g], bars_after=bars_after)
    assert updated.mitigated is True
    assert updated.mitigated_at == bars_after[2].t


def test_already_mitigated_fvg_kept_as_is():
    g = FvgOut(
        id="fvg_pre",
        direction="long",
        top=11.0,
        bottom=10.5,
        t=T0 + timedelta(minutes=15),
        mitigated=True,
        mitigated_at=T0 + timedelta(minutes=60),
        detected_at=T0,
    )
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=120),
            o=0, h=0, l=0, c=10.6, v=0,
        )
    ]
    [updated] = update_fvg_state([g], bars_after=bars_after)
    assert updated.mitigated is True
    assert updated.mitigated_at == g.mitigated_at  # preserved


def test_fvg_unmitigated_when_no_close_breaks_through():
    g = _fvg("long", top=11.0, bottom=10.5, t_offset=1)
    bars_after = [
        SimpleNamespace(
            t=T0 + timedelta(minutes=15 * (3 + i)),
            o=0, h=0, l=0, c=c, v=0,
        )
        for i, c in enumerate([10.8, 10.9, 11.5])
    ]
    [updated] = update_fvg_state([g], bars_after=bars_after)
    assert updated.mitigated is False
    assert updated.mitigated_at is None
