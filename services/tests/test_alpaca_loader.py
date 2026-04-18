"""Tests for market_data_service.loaders.alpaca_loader"""

from __future__ import annotations

import pytest

from services.market_data_service.loaders.alpaca_loader import (
    _TF_MAP,
    _aggregate,
    _generate_synthetic,
    _parse_alpaca_bars,
)
from services.shared.types import Bar
from services.tests.conftest import make_bars


class TestAggregate:
    def test_no_aggregation_n1(self):
        bars = make_bars(10)
        result = _aggregate(bars, 1)
        assert len(result) == len(bars)

    def test_aggregate_4_bars(self):
        bars = make_bars(12)
        result = _aggregate(bars, 4)
        assert len(result) == 3  # 12 / 4 = 3

    def test_aggregate_high_is_max(self):
        bars = make_bars(4)
        result = _aggregate(bars, 4)
        assert len(result) == 1
        assert result[0].high == max(b.high for b in bars)

    def test_aggregate_low_is_min(self):
        bars = make_bars(4)
        result = _aggregate(bars, 4)
        assert result[0].low == min(b.low for b in bars)

    def test_aggregate_volume_sum(self):
        bars = make_bars(4)
        result = _aggregate(bars, 4)
        assert abs(result[0].volume - sum(b.volume for b in bars)) < 1.0

    def test_aggregate_open_is_first(self):
        bars = make_bars(4)
        result = _aggregate(bars, 4)
        assert result[0].open == bars[0].open

    def test_aggregate_close_is_last(self):
        bars = make_bars(4)
        result = _aggregate(bars, 4)
        assert result[0].close == bars[-1].close

    def test_partial_group_excluded(self):
        """Group of 5 bars with factor=3 → 1 complete group (3 bars), 2 leftover excluded."""
        bars = make_bars(5)
        result = _aggregate(bars, 3)
        assert len(result) == 1


class TestGenerateSynthetic:
    def test_returns_correct_count(self):
        bars = _generate_synthetic("AAPL", "15min", 100)
        assert len(bars) == 100

    def test_ohlc_valid(self):
        bars = _generate_synthetic("BTCUSD", "1hour", 50)
        for b in bars:
            assert b.high >= max(b.open, b.close)
            assert b.low <= min(b.open, b.close)
            assert b.open > 0
            assert b.close > 0

    def test_btc_base_price(self):
        bars = _generate_synthetic("BTCUSD", "1day", 1)
        assert bars[0].open > 10_000  # BTC should be above $10k

    def test_volumes_positive(self):
        bars = _generate_synthetic("SPY", "15min", 20)
        for b in bars:
            assert b.volume > 0


class TestTfMap:
    def test_all_keys_present(self):
        expected = ["1min", "5min", "15min", "30min", "1hour", "2hour", "4hour", "1day"]
        for tf in expected:
            assert tf in _TF_MAP

    def test_aggregation_factors_correct(self):
        assert _TF_MAP["30min"][1] == 2  # 30min = 2 × 15min
        assert _TF_MAP["2hour"][1] == 2  # 2h = 2 × 1h
        assert _TF_MAP["4hour"][1] == 4  # 4h = 4 × 1h
        assert _TF_MAP["1min"][1] == 1  # no aggregation
        assert _TF_MAP["15min"][1] == 1  # no aggregation
