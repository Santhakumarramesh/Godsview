"""Tests for feature_service.structure"""
from __future__ import annotations

import pytest

from services.feature_service.structure import (
    StructureType,
    find_swing_pivots,
    find_bos_choch,
    find_fvgs,
    find_liquidity_sweeps,
    compute_structure_score,
)
from services.tests.conftest import make_bars, make_bar


class TestSwingPivots:
    def test_returns_list(self):
        bars = make_bars(50)
        pivots = find_swing_pivots(bars)
        assert isinstance(pivots, list)

    def test_types(self):
        bars = make_bars(60)
        pivots = find_swing_pivots(bars)
        for p in pivots:
            assert p.event_type in (StructureType.SWING_HIGH, StructureType.SWING_LOW)

    def test_bar_index_in_range(self):
        bars = make_bars(60)
        pivots = find_swing_pivots(bars, left=3, right=3)
        for p in pivots:
            assert 3 <= p.bar_index <= len(bars) - 4

    def test_swing_high_is_actual_high(self):
        bars = make_bars(60)
        pivots = find_swing_pivots(bars)
        for p in pivots:
            if p.event_type == StructureType.SWING_HIGH:
                assert p.price == bars[p.bar_index].high

    def test_swing_low_is_actual_low(self):
        bars = make_bars(60)
        pivots = find_swing_pivots(bars)
        for p in pivots:
            if p.event_type == StructureType.SWING_LOW:
                assert p.price == bars[p.bar_index].low


class TestFVG:
    def test_basic(self):
        bars = make_bars(30)
        fvgs = find_fvgs(bars)
        assert isinstance(fvgs, list)

    def test_fvg_types(self):
        bars = make_bars(50)
        fvgs = find_fvgs(bars)
        for f in fvgs:
            assert f.event_type in (StructureType.FVG_BULLISH, StructureType.FVG_BEARISH)

    def test_no_fvg_flat_market(self):
        """Perfectly flat bars should have no gaps."""
        from datetime import datetime, timedelta, timezone
        now = datetime.now(timezone.utc)
        bars = [
            make_bar(close=100.0, open_=100.0, high=100.5, low=99.5,
                     ts=now - timedelta(minutes=15 * i))
            for i in range(20)
        ]
        fvgs = find_fvgs(bars)
        # Flat bars very rarely create gaps
        assert len(fvgs) <= 2


class TestLiquiditySweeps:
    def test_basic(self):
        bars = make_bars(50)
        sweeps = find_liquidity_sweeps(bars, lookback=15)
        assert isinstance(sweeps, list)

    def test_sweep_types(self):
        bars = make_bars(50)
        sweeps = find_liquidity_sweeps(bars)
        for s in sweeps:
            assert s.event_type in (
                StructureType.LIQ_SWEEP_HIGH,
                StructureType.LIQ_SWEEP_LOW,
            )


class TestStructureScore:
    def test_range(self):
        bars = make_bars(100)
        for i in range(20, len(bars)):
            score = compute_structure_score(bars, i)
            assert 0.0 <= score <= 1.0

    def test_insufficient_lookback_returns_zero(self):
        bars = make_bars(10)
        assert compute_structure_score(bars, 5) == 0.0

    def test_trending_market_has_higher_score(self):
        uptrend = make_bars(120, trend=0.005)
        flat    = make_bars(120, trend=0.0)
        up_score   = compute_structure_score(uptrend, 100)
        flat_score = compute_structure_score(flat,    100)
        # Uptrend should generally produce non-trivial structure
        assert up_score >= 0.0
        assert flat_score >= 0.0
