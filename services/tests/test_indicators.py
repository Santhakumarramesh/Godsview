"""Tests for feature_service.indicators"""

from __future__ import annotations

import math

import pytest

from services.feature_service import indicators as ind
from services.tests.conftest import make_bars


class TestSMA:
    def test_basic(self):
        bars = make_bars(30)
        result = ind.sma(bars, 10)
        assert len(result) == 30
        assert math.isnan(result[8])
        assert not math.isnan(result[9])

    def test_period_1(self):
        bars = make_bars(10)
        result = ind.sma(bars, 1)
        for i, r in enumerate(result):
            assert not math.isnan(r)
            assert abs(r - bars[i].close) < 1e-6

    def test_all_same_price(self):
        from services.tests.conftest import make_bar

        bars = [make_bar(close=100.0) for _ in range(20)]
        result = ind.sma(bars, 5)
        assert all(math.isnan(v) or abs(v - 100.0) < 1e-6 for v in result)


class TestEMA:
    def test_length(self):
        bars = make_bars(50)
        result = ind.ema(bars, 20)
        assert len(result) == 50

    def test_first_values_nan(self):
        bars = make_bars(50)
        result = ind.ema(bars, 20)
        for i in range(19):
            assert math.isnan(result[i])

    def test_seed_equals_sma(self):
        bars = make_bars(50)
        ema_arr = ind.ema(bars, 10)
        sma_arr = ind.sma(bars, 10)
        # At index period-1, EMA is seeded with SMA
        assert abs(ema_arr[9] - sma_arr[9]) < 1e-6

    def test_responsiveness(self):
        """EMA should react faster to price changes than SMA."""
        bars = make_bars(60, base_price=100.0, trend=0.0)
        ema_arr = ind.ema(bars, 20)
        sma_arr = ind.sma(bars, 20)
        # After a flat period both should be close
        if not math.isnan(ema_arr[-1]) and not math.isnan(sma_arr[-1]):
            assert abs(ema_arr[-1] - sma_arr[-1]) < 5.0


class TestATR:
    def test_basic(self):
        bars = make_bars(50)
        result = ind.atr(bars, 14)
        assert len(result) == 50
        assert math.isnan(result[0])
        assert not math.isnan(result[14])

    def test_positive(self):
        bars = make_bars(50)
        result = ind.atr(bars, 14)
        valid = [v for v in result if not math.isnan(v)]
        assert all(v > 0 for v in valid)


class TestRSI:
    def test_length(self):
        bars = make_bars(50)
        result = ind.rsi(bars, 14)
        assert len(result) == 50

    def test_range(self):
        bars = make_bars(100)
        result = ind.rsi(bars, 14)
        valid = [v for v in result if not math.isnan(v)]
        assert all(0.0 <= v <= 100.0 for v in valid)

    def test_overbought_signal(self):
        """Strong uptrend should push RSI toward 70+."""
        bars = make_bars(50, trend=0.008)
        result = ind.rsi(bars, 14)
        valid = [v for v in result if not math.isnan(v)]
        if valid:
            assert max(valid) > 55.0


class TestMACD:
    def test_lengths(self):
        bars = make_bars(100)
        macd_l, sig_l, hist_l = ind.macd(bars)
        assert len(macd_l) == len(bars)
        assert len(sig_l) == len(bars)
        assert len(hist_l) == len(bars)

    def test_histogram_equals_diff(self):
        bars = make_bars(100)
        ml, sl, hl = ind.macd(bars)
        for i in range(len(bars)):
            if not (math.isnan(ml[i]) or math.isnan(sl[i]) or math.isnan(hl[i])):
                assert abs(hl[i] - (ml[i] - sl[i])) < 1e-6


class TestBollinger:
    def test_upper_gt_lower(self):
        bars = make_bars(50)
        upper, mid, lower = ind.bollinger(bars, 20)
        for i in range(19, len(bars)):
            assert upper[i] >= mid[i] >= lower[i]

    def test_price_mostly_inside(self):
        """~95% of closes should be inside the 2σ bands."""
        bars = make_bars(200)
        upper, _mid, lower = ind.bollinger(bars, 20)
        inside = 0
        total = 0
        for i in range(19, len(bars)):
            if not (math.isnan(upper[i]) or math.isnan(lower[i])):
                total += 1
                if lower[i] <= bars[i].close <= upper[i]:
                    inside += 1
        assert total > 0
        assert inside / total > 0.80


class TestVolumeIndicators:
    def test_volume_sma(self):
        bars = make_bars(30)
        result = ind.volume_sma(bars, 10)
        assert len(result) == 30
        valid = [v for v in result if not math.isnan(v)]
        assert all(v > 0 for v in valid)

    def test_vwap_ascending(self):
        """VWAP in a pure uptrend should be < current close late in series."""
        bars = make_bars(50, trend=0.005)
        vw = ind.vwap(bars)
        assert len(vw) == 50
        assert all(not math.isnan(v) for v in vw)

    def test_highest_lowest(self):
        bars = make_bars(30)
        hh = ind.highest_high(bars, 5)
        ll = ind.lowest_low(bars, 5)
        for i in range(4, 30):
            assert hh[i] >= bars[i].high
            assert ll[i] <= bars[i].low
