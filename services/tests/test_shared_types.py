"""Tests for services.shared.types"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from services.shared.types import (
    Bar, Signal, Trade, Direction, SignalType, TradeOutcome,
    BacktestMetrics, BacktestResult, MLPrediction, RecallEntry,
)
from services.tests.conftest import make_bar


class TestBar:
    def test_body_size(self):
        b = make_bar(close=102.0, open_=100.0)
        assert abs(b.body_size - 2.0) < 1e-6

    def test_range_size(self):
        b = make_bar(close=101.0, high=105.0, low=99.0)
        assert abs(b.range_size - 6.0) < 1e-6

    def test_is_bullish_true(self):
        b = make_bar(close=101.0, open_=100.0)
        assert b.is_bullish is True

    def test_is_bullish_false(self):
        b = make_bar(close=99.0, open_=100.0)
        assert b.is_bullish is False

    def test_is_bullish_doji(self):
        b = make_bar(close=100.0, open_=100.0)
        assert b.is_bullish is True


class TestTrade:
    def _trade(self) -> Trade:
        return Trade(
            id="t1",
            signal_id="s1",
            symbol="AAPL",
            direction=Direction.LONG,
            entry_price=100.0,
            stop_price=95.0,
            target_price=110.0,
            size=10.0,
            entry_time=datetime.now(timezone.utc),
        )

    def test_risk(self):
        t = self._trade()
        assert abs(t.risk - 50.0) < 1e-6  # |100 - 95| * 10

    def test_reward(self):
        t = self._trade()
        assert abs(t.reward - 100.0) < 1e-6  # |110 - 100| * 10


class TestBacktestMetrics:
    def test_default_zeros(self):
        m = BacktestMetrics()
        assert m.total_trades == 0
        assert m.win_rate == 0.0
        assert m.sharpe_ratio == 0.0

    def test_fields_present(self):
        m = BacktestMetrics(
            total_trades=10,
            winning_trades=6,
            win_rate=0.6,
            profit_factor=2.0,
        )
        assert m.total_trades == 10
        assert m.winning_trades == 6
        assert m.win_rate == 0.6


class TestMLPrediction:
    def test_approved_threshold(self):
        pred = MLPrediction(
            signal_id="s1",
            symbol="AAPL",
            timestamp=datetime.now(timezone.utc),
            win_probability=0.72,
            confidence=0.72,
            approved=True,
            model_version="xgb-v1",
        )
        assert pred.approved is True
        assert pred.win_probability == 0.72


class TestRecallEntry:
    def test_basic(self):
        entry = RecallEntry(
            id="r1",
            symbol="AAPL",
            setup_type="absorption_reversal",
            timeframe="15min",
            timestamp=datetime.now(timezone.utc),
            outcome="win",
            pnl_pct=0.025,
            features={"body_ratio": 0.4},
        )
        assert entry.outcome == "win"
        assert entry.pnl_pct == 0.025
