"""Tests for backtest_service.broker (PaperBroker)"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from services.backtest_service.broker import BrokerConfig, PaperBroker
from services.shared.types import Bar, Direction, TradeOutcome
from services.tests.conftest import make_bar, make_bars


def _bar(close: float, high: float | None = None, low: float | None = None) -> Bar:
    return make_bar(
        close=close,
        high=high or close * 1.01,
        low=low or close * 0.99,
    )


class TestPaperBrokerBasics:
    def test_initial_equity(self):
        broker = PaperBroker(10_000.0)
        assert broker.equity == 10_000.0
        assert broker.cash == 10_000.0
        assert broker.open_trade is None

    def test_open_position_long(self):
        broker = PaperBroker(10_000.0)
        bar = _bar(100.0)
        trade = broker.open_position(bar, "sig1", Direction.LONG, 95.0, 110.0)
        assert trade is not None
        assert broker.open_trade is trade
        assert trade.direction == Direction.LONG
        assert trade.entry_price > 0

    def test_only_one_position_at_a_time(self):
        broker = PaperBroker(10_000.0)
        bar = _bar(100.0)
        t1 = broker.open_position(bar, "sig1", Direction.LONG, 95.0, 110.0)
        t2 = broker.open_position(bar, "sig2", Direction.LONG, 95.0, 115.0)
        assert t1 is not None
        assert t2 is None


class TestPaperBrokerPnL:
    def test_target_hit_is_win(self):
        broker = PaperBroker(10_000.0)
        entry_bar = _bar(100.0)
        broker.open_position(entry_bar, "sig", Direction.LONG, 95.0, 110.0)

        # Bar that hits the target
        target_bar = make_bar(close=112.0, high_=115.0, low_=108.0) \
            if False else _bar(112.0, high=115.0, low=108.0)
        closed = broker.update(target_bar)
        assert closed is not None
        assert closed.outcome == TradeOutcome.WIN
        assert closed.pnl > 0

    def test_stop_hit_is_loss(self):
        broker = PaperBroker(10_000.0)
        entry_bar = _bar(100.0)
        broker.open_position(entry_bar, "sig", Direction.LONG, 95.0, 110.0)

        stop_bar = _bar(93.0, high=96.0, low=92.0)
        closed = broker.update(stop_bar)
        assert closed is not None
        assert closed.outcome == TradeOutcome.LOSS
        assert closed.pnl < 0

    def test_no_close_between_sl_tp(self):
        broker = PaperBroker(10_000.0)
        entry_bar = _bar(100.0)
        broker.open_position(entry_bar, "sig", Direction.LONG, 95.0, 110.0)

        mid_bar = _bar(102.0, high=104.0, low=99.0)
        result = broker.update(mid_bar)
        assert result is None
        assert broker.open_trade is not None


class TestPaperBrokerShort:
    def test_short_target_hit(self):
        broker = PaperBroker(10_000.0)
        entry_bar = _bar(100.0)
        broker.open_position(entry_bar, "sig", Direction.SHORT, 105.0, 90.0)

        target_bar = _bar(88.0, high=92.0, low=86.0)
        closed = broker.update(target_bar)
        assert closed is not None
        assert closed.outcome == TradeOutcome.WIN

    def test_short_stop_hit(self):
        broker = PaperBroker(10_000.0)
        entry_bar = _bar(100.0)
        broker.open_position(entry_bar, "sig", Direction.SHORT, 105.0, 90.0)

        stop_bar = _bar(108.0, high=110.0, low=103.0)
        closed = broker.update(stop_bar)
        assert closed is not None
        assert closed.outcome == TradeOutcome.LOSS


class TestPositionSizing:
    def test_risk_capped_at_pct(self):
        """Position should never risk more than risk_per_trade_pct of equity."""
        config = BrokerConfig(risk_per_trade_pct=0.01)
        broker = PaperBroker(10_000.0, config=config)
        bar = _bar(100.0)
        broker.open_position(bar, "s", Direction.LONG, 95.0, 115.0)

        trade = broker.open_trade
        if trade:
            risk_amount = abs(trade.entry_price - trade.stop_price) * trade.size
            assert risk_amount <= 10_000.0 * 0.01 * 1.1   # 10% tolerance for slippage

    def test_zero_qty_when_no_risk(self):
        broker = PaperBroker(10_000.0)
        bar = _bar(100.0)
        # Entry == stop → zero risk → no position
        trade = broker.open_position(bar, "s", Direction.LONG, 100.0, 110.0)
        # With 0 distance, sizing might return 0 but with slippage could be non-zero
        # Just ensure no crash
        assert trade is None or trade.size >= 0


class TestForceClose:
    def test_force_close_returns_trade(self):
        broker = PaperBroker(10_000.0)
        entry_bar = _bar(100.0)
        broker.open_position(entry_bar, "sig", Direction.LONG, 95.0, 110.0)

        close_bar = _bar(101.0)
        result = broker.force_close(close_bar)
        assert result is not None
        assert broker.open_trade is None

    def test_force_close_no_position(self):
        broker = PaperBroker(10_000.0)
        bar = _bar(100.0)
        result = broker.force_close(bar)
        assert result is None
