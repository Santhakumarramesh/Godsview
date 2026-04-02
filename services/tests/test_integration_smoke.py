"""
Integration smoke tests — exercise the full pipeline without live HTTP calls.

These tests run the entire signal detection → backtest → ML pipeline using
only in-process calls (no actual HTTP). They verify the pieces fit together
and the complete data flow produces valid outputs.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from services.backtest_service.engine import BacktestConfig, run_backtest
from services.backtest_service.metrics import compute_metrics
from services.feature_service.builder import build_features, FEATURE_NAMES
from services.feature_service.signal_detector import detect_signal, batch_detect
from services.market_data_service.loaders.alpaca_loader import _generate_synthetic
from services.market_data_service.validator import validate_bars, quick_validate
from services.shared.types import BacktestResult, Direction, TradeOutcome
from services.tests.conftest import make_bars


# ---------------------------------------------------------------------------
# Full pipeline: synthetic bars → validate → features → signal → backtest
# ---------------------------------------------------------------------------

class TestFullPipeline:
    def test_synthetic_bars_pass_validation(self):
        bars = _generate_synthetic("AAPL", "15min", 200)
        cleaned, report = validate_bars(bars)
        assert report.pass_rate >= 0.95
        assert report.is_usable

    def test_features_from_synthetic_bars(self):
        bars = _generate_synthetic("AAPL", "15min", 200)
        cleaned, _ = validate_bars(bars)
        features = build_features(cleaned, min_lookback=55)
        assert len(features) > 0
        for feat_dict in features[-5:]:
            for k, v in feat_dict.items():
                assert not math.isnan(v), f"NaN in feature {k}"

    def test_signal_detection_pipeline(self):
        bars = _generate_synthetic("AAPL", "15min", 300)
        cleaned, report = validate_bars(bars)
        assert report.is_usable
        # detect_signal on last 200 bars — may or may not find a signal
        result = detect_signal(cleaned[-200:], "15min")
        if result is not None:
            assert result.symbol == "AAPL"
            assert result.entry_price > 0
            assert result.stop_price > 0
            assert result.target_price > 0
            assert 0.0 <= result.structure_score <= 1.0

    def test_batch_detect_multi_symbol(self):
        symbol_bars = {
            sym: _generate_synthetic(sym, "15min", 200)
            for sym in ["AAPL", "TSLA", "SPY"]
        }
        signals = batch_detect(symbol_bars)
        assert isinstance(signals, list)

    def test_backtest_full_run(self):
        bars = _generate_synthetic("AAPL", "15min", 500)
        cleaned, _ = validate_bars(bars)
        config = BacktestConfig(
            symbol="AAPL",
            timeframe="15min",
            initial_equity=10_000.0,
        )
        result = run_backtest(cleaned, config)
        assert isinstance(result, BacktestResult)
        assert result.symbol == "AAPL"
        assert result.final_equity > 0
        assert len(result.equity_curve) > 0
        assert result.start_date <= result.end_date

    def test_backtest_metrics_consistency(self):
        bars = _generate_synthetic("AAPL", "1hour", 400)
        config = BacktestConfig(symbol="AAPL", timeframe="1hour")
        result = run_backtest(bars, config)
        m = result.metrics
        # Basic metric invariants
        assert 0.0 <= m.win_rate <= 1.0
        assert m.profit_factor >= 0.0
        assert m.max_drawdown >= 0.0
        assert m.max_drawdown_pct >= 0.0
        if m.total_trades > 0:
            assert m.winning_trades + m.losing_trades <= m.total_trades
            expected_wr = m.winning_trades / m.total_trades
            assert abs(m.win_rate - expected_wr) < 0.001

    def test_equity_never_goes_negative(self):
        bars = make_bars(300)
        config = BacktestConfig(symbol="TEST", initial_equity=5_000.0)
        result = run_backtest(bars, config)
        for point in result.equity_curve:
            assert point["equity"] > 0, "Equity went negative — risk sizing bug"

    def test_multiple_timeframes(self):
        """Run backtests on all major timeframes — none should crash."""
        for tf in ["15min", "1hour", "1day"]:
            bars = _generate_synthetic("SPY", tf, 250)
            config = BacktestConfig(symbol="SPY", timeframe=tf)
            result = run_backtest(bars, config)
            assert isinstance(result, BacktestResult)

    def test_btc_synthetic_bars_valid(self):
        bars = _generate_synthetic("BTCUSD", "1hour", 100)
        cleaned, report = validate_bars(bars)
        assert report.is_usable
        for b in cleaned:
            assert b.open > 10_000, "BTC open should be above $10k"


# ---------------------------------------------------------------------------
# Feature → metrics end-to-end
# ---------------------------------------------------------------------------

class TestFeatureMetricsIntegration:
    def test_feature_count_matches_names(self):
        bars = make_bars(200)
        features = build_features(bars, min_lookback=55)
        if features:
            # Features may include internal meta-keys (prefixed __); exclude them
            public_keys = {k for k in features[0].keys() if not k.startswith("__")}
            assert public_keys == set(FEATURE_NAMES), (
                f"Extra: {public_keys - set(FEATURE_NAMES)}, "
                f"Missing: {set(FEATURE_NAMES) - public_keys}"
            )

    def test_features_all_finite(self):
        bars = _generate_synthetic("NVDA", "15min", 200)
        features = build_features(bars, min_lookback=55)
        for feat_dict in features:
            for name, val in feat_dict.items():
                assert math.isfinite(val), f"Non-finite value in {name}: {val}"


# ---------------------------------------------------------------------------
# Compute metrics with synthetic trade streams
# ---------------------------------------------------------------------------

class TestComputeMetricsIntegration:
    def _build_equity(self, pnl_list: list[float], start: float = 10_000.0):
        equity = start
        curve = [{"equity": equity}]
        for p in pnl_list:
            equity += p
            curve.append({"equity": equity})
        return curve

    def test_positive_pf_scenario(self):
        from services.tests.conftest import make_bar
        from services.shared.types import Trade, TradeOutcome
        from datetime import datetime, timezone

        pnl_list = [200, -80, 150, -60, 300, -100]
        trades = []
        for pnl in pnl_list:
            outcome = TradeOutcome.WIN if pnl > 0 else TradeOutcome.LOSS
            t = Trade(
                id="t1", signal_id="s1", symbol="AAPL",
                direction=Direction.LONG,
                entry_price=100.0, stop_price=95.0, target_price=110.0,
                size=1.0,
                entry_time=datetime.now(timezone.utc),
                exit_time=datetime.now(timezone.utc),
                exit_price=100.0 + pnl,
                pnl=float(pnl),
                pnl_pct=pnl / 100.0,
                outcome=outcome,
            )
            trades.append(t)

        equity_curve = self._build_equity(pnl_list)
        m = compute_metrics(trades, equity_curve, 10_000.0)

        assert m.profit_factor > 1.0
        assert m.win_rate > 0.4
        assert m.total_pnl == sum(pnl_list)


# ---------------------------------------------------------------------------
# Validator edge cases
# ---------------------------------------------------------------------------

class TestValidatorEdgeCases:
    def test_all_invalid_returns_empty(self):
        from services.tests.conftest import make_bar
        import math
        bad_bars = [make_bar(close=float("nan")) for _ in range(10)]
        cleaned, report = validate_bars(bad_bars)
        assert len(cleaned) == 0
        assert report.removed_bars == 10
        assert not report.is_usable

    def test_single_bar_is_usable(self):
        bars = make_bars(1)
        cleaned, report = validate_bars(bars)
        assert len(cleaned) == 1
        assert report.is_usable

    def test_quick_validate_consistency(self):
        bars = make_bars(50)
        assert quick_validate(bars) is True
        cleaned, report = validate_bars(bars)
        assert report.is_usable  # both agree
