"""Tests for backtest_service.metrics"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from services.backtest_service.metrics import _max_drawdown, _sharpe, compute_metrics
from services.shared.types import BacktestMetrics, Direction, Trade, TradeOutcome


def _make_trade(pnl: float, pnl_pct: float, outcome: TradeOutcome) -> Trade:
    return Trade(
        id="t1",
        signal_id="s1",
        symbol="AAPL",
        direction=Direction.LONG,
        entry_price=100.0,
        stop_price=95.0,
        target_price=110.0,
        size=1.0,
        entry_time=datetime.now(timezone.utc),
        exit_time=datetime.now(timezone.utc),
        exit_price=100.0 + pnl,
        pnl=pnl,
        pnl_pct=pnl_pct,
        outcome=outcome,
    )


class TestComputeMetrics:
    def test_empty_trades_returns_zeros(self):
        m = compute_metrics([], [], 10_000.0)
        assert m.total_trades == 0
        assert m.win_rate == 0.0

    def test_win_rate(self):
        trades = [
            _make_trade(100, 0.01, TradeOutcome.WIN),
            _make_trade(100, 0.01, TradeOutcome.WIN),
            _make_trade(-50, -0.005, TradeOutcome.LOSS),
        ]
        equity = [
            {"equity": 10000.0},
            {"equity": 10100.0},
            {"equity": 10200.0},
            {"equity": 10150.0},
        ]
        m = compute_metrics(trades, equity, 10_000.0)
        assert abs(m.win_rate - 2 / 3) < 0.01

    def test_profit_factor(self):
        trades = [
            _make_trade(200, 0.02, TradeOutcome.WIN),
            _make_trade(-100, -0.01, TradeOutcome.LOSS),
        ]
        equity = [{"equity": 10000.0}, {"equity": 10200.0}, {"equity": 10100.0}]
        m = compute_metrics(trades, equity, 10_000.0)
        assert abs(m.profit_factor - 2.0) < 0.01

    def test_all_wins_profit_factor_high(self):
        trades = [_make_trade(100, 0.01, TradeOutcome.WIN) for _ in range(5)]
        equity = [{"equity": 10000.0 + i * 100} for i in range(6)]
        m = compute_metrics(trades, equity, 10_000.0)
        assert m.profit_factor > 10.0  # No losses → very high PF

    def test_total_pnl(self):
        trades = [
            _make_trade(300, 0.03, TradeOutcome.WIN),
            _make_trade(-100, -0.01, TradeOutcome.LOSS),
        ]
        equity = [{"equity": 10000.0}, {"equity": 10300.0}, {"equity": 10200.0}]
        m = compute_metrics(trades, equity, 10_000.0)
        assert abs(m.total_pnl - 200.0) < 0.01

    def test_sharpe_positive_for_winners(self):
        trades = [_make_trade(100, 0.01, TradeOutcome.WIN) for _ in range(20)]
        equity = [{"equity": 10000.0 + i * 100} for i in range(21)]
        m = compute_metrics(trades, equity, 10_000.0)
        assert m.sharpe_ratio > 0

    def test_max_drawdown_detected(self):
        trades = [
            _make_trade(100, 0.01, TradeOutcome.WIN),
            _make_trade(-500, -0.05, TradeOutcome.LOSS),
            _make_trade(200, 0.02, TradeOutcome.WIN),
        ]
        equity = [
            {"equity": 10000.0},
            {"equity": 10100.0},
            {"equity": 9600.0},  # big drop
            {"equity": 9800.0},
        ]
        m = compute_metrics(trades, equity, 10_000.0)
        assert m.max_drawdown > 0
        assert m.max_drawdown_pct > 0


class TestMaxDrawdown:
    def test_no_drawdown(self):
        curve = [{"equity": 100 + i * 10} for i in range(10)]
        dd, pct = _max_drawdown(curve)
        assert dd == 0.0
        assert pct == 0.0

    def test_drawdown_detected(self):
        curve = [
            {"equity": 1000},
            {"equity": 1100},
            {"equity": 900},  # 200 drawdown from peak
        ]
        dd, pct = _max_drawdown(curve)
        assert abs(dd - 200.0) < 0.01
        assert abs(pct - 200 / 1100) < 0.001

    def test_empty_curve(self):
        dd, pct = _max_drawdown([])
        assert dd == 0.0
        assert pct == 0.0


class TestSharpe:
    def test_positive_returns(self):
        returns = [0.01] * 50
        s = _sharpe(returns, 252.0)
        assert s > 0

    def test_negative_returns(self):
        returns = [-0.01] * 50
        s = _sharpe(returns, 252.0)
        assert s < 0

    def test_zero_std(self):
        # All same returns → Sharpe is either 0 (std=0 guard) or very large
        # either way it must not be NaN or negative
        import math

        returns = [0.005] * 50
        s = _sharpe(returns, 252.0)
        assert not math.isnan(s)
        assert s >= 0.0  # positive returns → non-negative Sharpe

    def test_empty(self):
        assert _sharpe([], 252.0) == 0.0
