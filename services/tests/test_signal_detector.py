"""Tests for feature_service.signal_detector"""

from __future__ import annotations

import pytest

from services.feature_service.signal_detector import batch_detect, detect_signal
from services.shared.types import Direction, SignalType
from services.tests.conftest import make_bars


class TestDetectSignal:
    def test_returns_none_insufficient_bars(self):
        bars = make_bars(20)
        result = detect_signal(bars)
        assert result is None

    def test_returns_none_or_signal(self):
        bars = make_bars(200)
        result = detect_signal(bars)
        # Must be None or a valid Signal
        if result is not None:
            assert result.entry > 0
            assert result.stop > 0
            assert result.target > 0
            assert result.symbol == "AAPL"
            assert 0.0 <= result.confidence <= 1.0

    def test_signal_direction_valid(self):
        bars = make_bars(200)
        result = detect_signal(bars)
        if result is not None:
            assert result.direction in (Direction.LONG, Direction.SHORT)

    def test_signal_type_valid(self):
        bars = make_bars(200)
        result = detect_signal(bars)
        if result is not None:
            assert result.signal_type in (
                SignalType.ABSORPTION_REVERSAL,
                SignalType.LIQUIDITY_SWEEP,
            )

    def test_long_stop_below_entry(self):
        bars = make_bars(200, trend=0.003)
        result = detect_signal(bars)
        if result is not None and result.direction == Direction.LONG:
            assert result.stop < result.entry
            assert result.target > result.entry

    def test_short_stop_above_entry(self):
        bars = make_bars(200, trend=-0.003)
        result = detect_signal(bars)
        if result is not None and result.direction == Direction.SHORT:
            assert result.stop > result.entry
            assert result.target < result.entry

    def test_risk_reward_positive(self):
        bars = make_bars(200)
        result = detect_signal(bars)
        if result is not None:
            assert result.risk_reward > 0

    def test_signal_has_id(self):
        bars = make_bars(200)
        result = detect_signal(bars)
        if result is not None:
            assert len(result.id) > 0

    def test_timeframe_propagated(self):
        bars = make_bars(200, timeframe="1hour")
        result = detect_signal(bars, timeframe="1hour")
        if result is not None:
            assert result.timeframe == "1hour"


class TestBatchDetect:
    def test_batch_returns_list(self):
        symbol_bars = {
            "AAPL": make_bars(200, symbol="AAPL"),
            "TSLA": make_bars(200, symbol="TSLA", trend=-0.002),
        }
        results = batch_detect(symbol_bars)
        assert isinstance(results, list)

    def test_batch_symbols_correct(self):
        symbol_bars = {
            "SPY": make_bars(200, symbol="SPY"),
            "QQQ": make_bars(200, symbol="QQQ"),
        }
        results = batch_detect(symbol_bars)
        for sig in results:
            assert sig.symbol in ("SPY", "QQQ")

    def test_empty_batch(self):
        results = batch_detect({})
        assert results == []
