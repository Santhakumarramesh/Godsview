"""Tests for backtest_service.engine"""

from __future__ import annotations

import pytest

from services.backtest_service.engine import (
    SUPPORTED_TIMEFRAMES,
    BacktestConfig,
    run_backtest,
)
from services.shared.types import BacktestResult
from services.tests.conftest import make_bars


class TestRunBacktest:
    def test_empty_bars(self):
        config = BacktestConfig(symbol="AAPL")
        result = run_backtest([], config)
        assert result.symbol == "AAPL"
        assert result.metrics.total_trades == 0
        assert result.final_equity == config.initial_equity

    def test_returns_backtest_result(self):
        bars = make_bars(200)
        config = BacktestConfig(symbol="AAPL", initial_equity=10_000.0)
        result = run_backtest(bars, config)
        assert isinstance(result, BacktestResult)
        assert result.symbol == "AAPL"
        assert result.initial_equity == 10_000.0

    def test_equity_curve_generated(self):
        bars = make_bars(200)
        config = BacktestConfig(symbol="AAPL")
        result = run_backtest(bars, config)
        assert len(result.equity_curve) > 0
        for point in result.equity_curve:
            assert "equity" in point
            assert "timestamp" in point

    def test_run_id_generated(self):
        bars = make_bars(200)
        config = BacktestConfig(symbol="AAPL")
        result = run_backtest(bars, config)
        assert len(result.run_id) > 0

    def test_final_equity_positive(self):
        bars = make_bars(200)
        config = BacktestConfig(symbol="AAPL", initial_equity=10_000.0)
        result = run_backtest(bars, config)
        assert result.final_equity > 0

    def test_metrics_consistent(self):
        """win_rate = winning_trades / total_trades."""
        bars = make_bars(300)
        config = BacktestConfig(symbol="AAPL")
        result = run_backtest(bars, config)
        m = result.metrics
        if m.total_trades > 0:
            expected_wr = m.winning_trades / m.total_trades
            assert abs(m.win_rate - expected_wr) < 0.001

    def test_dates_correct(self):
        bars = make_bars(200)
        config = BacktestConfig(symbol="AAPL")
        result = run_backtest(bars, config)
        assert result.start_date <= result.end_date

    def test_config_preserved(self):
        bars = make_bars(200)
        config = BacktestConfig(symbol="TSLA", timeframe="1hour")
        result = run_backtest(bars, config)
        assert result.symbol == "TSLA"
        assert result.timeframe == "1hour"


class TestSupportedTimeframes:
    def test_not_empty(self):
        assert len(SUPPORTED_TIMEFRAMES) > 0

    def test_has_required_fields(self):
        for tf in SUPPORTED_TIMEFRAMES:
            assert "value" in tf
            assert "label" in tf
            assert "bars_per_day" in tf

    def test_1day_bars(self):
        day_tf = next(t for t in SUPPORTED_TIMEFRAMES if t["value"] == "1day")
        assert day_tf["bars_per_day"] == 1

    def test_15min_bars(self):
        tf_15 = next(t for t in SUPPORTED_TIMEFRAMES if t["value"] == "15min")
        assert tf_15["bars_per_day"] == 26
