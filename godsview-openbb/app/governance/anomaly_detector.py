from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Optional

from app.governance.audit_log import AuditLogger, EventType


class AnomalyType(Enum):
    """Enumeration of detectable anomalies."""
    WIN_RATE_DRIFT = "win_rate_drift"
    DRAWDOWN_ANOMALY = "drawdown_anomaly"
    PROFIT_FACTOR_COLLAPSE = "profit_factor_collapse"
    EXECUTION_QUALITY_DEGRADATION = "execution_quality_degradation"
    BEHAVIORAL_ANOMALY_FREQUENCY = "behavioral_anomaly_frequency"
    SLIPPAGE_ANOMALY = "slippage_anomaly"


@dataclass
class AnomalyDetectionConfig:
    """Configuration for anomaly detection thresholds."""

    # Win rate: if live win rate drops > X% below backtest win rate over 20+ trades
    win_rate_drift_pct: float = 15.0
    min_trades_for_winrate_check: int = 20

    # Drawdown: if live max DD exceeds backtest max DD by > X%
    drawdown_excess_pct: float = 50.0

    # Profit factor: if live PF drops below 1.0 for X+ consecutive trades
    profit_factor_threshold: float = 1.0
    consecutive_losses_for_pf_alert: int = 10

    # Execution quality: if average slippage exceeds 2x expected
    slippage_multiplier: float = 2.0
    expected_slippage_pct: float = 0.1

    # Behavioral: if trade frequency spikes/drops > 3 standard deviations
    frequency_std_dev_threshold: float = 3.0
    lookback_days_for_frequency: int = 20


@dataclass
class AnomalyResult:
    """Result of anomaly detection check."""

    is_anomaly: bool
    anomaly_type: Optional[AnomalyType] = None
    severity: str = "info"  # info, warning, critical
    message: str = ""
    metrics: dict[str, Any] = None

    def __post_init__(self) -> None:
        if self.metrics is None:
            self.metrics = {}


class AnomalyDetector:
    """Detects when live performance diverges from backtest expectations."""

    def __init__(self, config: Optional[AnomalyDetectionConfig] = None):
        """Initialize anomaly detector.

        Args:
            config: Detection configuration (uses defaults if None)
        """
        self.config = config or AnomalyDetectionConfig()

    def check_win_rate_drift(
        self,
        backtest_win_rate: float,
        live_trades: list[dict[str, Any]],
    ) -> AnomalyResult:
        """Detect if live win rate drops significantly below backtest.

        Args:
            backtest_win_rate: Win rate from backtest (0-1)
            live_trades: List of live trade records with 'pnl' or 'outcome' field

        Returns:
            AnomalyResult with detection status
        """
        if len(live_trades) < self.config.min_trades_for_winrate_check:
            return AnomalyResult(is_anomaly=False)

        # Calculate live win rate
        wins = sum(1 for t in live_trades if float(t.get("pnl", 0)) > 0)
        live_win_rate = wins / len(live_trades) if live_trades else 0.0

        # Check drift
        drift_pct = (backtest_win_rate - live_win_rate) * 100
        threshold = self.config.win_rate_drift_pct

        if drift_pct > threshold:
            return AnomalyResult(
                is_anomaly=True,
                anomaly_type=AnomalyType.WIN_RATE_DRIFT,
                severity="warning",
                message=(
                    f"Win rate drift detected: backtest {backtest_win_rate:.2%} "
                    f"vs live {live_win_rate:.2%} (drift: {drift_pct:.1f}%)"
                ),
                metrics={
                    "backtest_win_rate": backtest_win_rate,
                    "live_win_rate": live_win_rate,
                    "drift_pct": drift_pct,
                    "threshold": threshold,
                    "trades_analyzed": len(live_trades),
                },
            )

        return AnomalyResult(is_anomaly=False)

    def check_drawdown_anomaly(
        self,
        backtest_max_dd_pct: float,
        live_max_dd_pct: float,
    ) -> AnomalyResult:
        """Detect if live max drawdown exceeds backtest by significant margin.

        Args:
            backtest_max_dd_pct: Maximum drawdown from backtest (as %)
            live_max_dd_pct: Current live maximum drawdown (as %)

        Returns:
            AnomalyResult with detection status
        """
        if backtest_max_dd_pct <= 0:
            return AnomalyResult(is_anomaly=False)

        excess_pct = ((live_max_dd_pct - backtest_max_dd_pct) / backtest_max_dd_pct) * 100
        threshold = self.config.drawdown_excess_pct

        if excess_pct > threshold:
            return AnomalyResult(
                is_anomaly=True,
                anomaly_type=AnomalyType.DRAWDOWN_ANOMALY,
                severity="critical",
                message=(
                    f"Drawdown anomaly: backtest {backtest_max_dd_pct:.2f}% "
                    f"vs live {live_max_dd_pct:.2f}% (excess: {excess_pct:.1f}%)"
                ),
                metrics={
                    "backtest_max_dd": backtest_max_dd_pct,
                    "live_max_dd": live_max_dd_pct,
                    "excess_pct": excess_pct,
                    "threshold": threshold,
                },
            )

        return AnomalyResult(is_anomaly=False)

    def check_profit_factor_collapse(
        self,
        live_trades: list[dict[str, Any]],
    ) -> AnomalyResult:
        """Detect if live profit factor drops below 1.0 for many consecutive trades.

        Args:
            live_trades: List of live trade records sorted by timestamp

        Returns:
            AnomalyResult with detection status
        """
        if not live_trades:
            return AnomalyResult(is_anomaly=False)

        # Count consecutive losses from most recent trades
        consecutive_losses = 0
        for trade in reversed(live_trades):
            pnl = float(trade.get("pnl", 0))
            if pnl <= 0:
                consecutive_losses += 1
            else:
                break

        threshold = self.config.consecutive_losses_for_pf_alert

        if consecutive_losses >= threshold:
            return AnomalyResult(
                is_anomaly=True,
                anomaly_type=AnomalyType.PROFIT_FACTOR_COLLAPSE,
                severity="critical",
                message=(
                    f"Profit factor collapse: {consecutive_losses} consecutive "
                    f"loss-making trades (threshold: {threshold})"
                ),
                metrics={
                    "consecutive_losses": consecutive_losses,
                    "threshold": threshold,
                    "recent_trades": len(live_trades),
                },
            )

        return AnomalyResult(is_anomaly=False)

    def check_execution_quality(
        self,
        expected_slippage_pct: Optional[float] = None,
        live_trades: Optional[list[dict[str, Any]]] = None,
    ) -> AnomalyResult:
        """Detect if average slippage exceeds 2x expected levels.

        Args:
            expected_slippage_pct: Expected slippage % (uses config default if None)
            live_trades: List of live trades with 'slippage_pct' field

        Returns:
            AnomalyResult with detection status
        """
        if not live_trades:
            return AnomalyResult(is_anomaly=False)

        expected = expected_slippage_pct or self.config.expected_slippage_pct
        slippages = [float(t.get("slippage_pct", 0)) for t in live_trades if "slippage_pct" in t]

        if not slippages:
            return AnomalyResult(is_anomaly=False)

        avg_slippage = sum(slippages) / len(slippages)
        threshold = expected * self.config.slippage_multiplier

        if avg_slippage > threshold:
            return AnomalyResult(
                is_anomaly=True,
                anomaly_type=AnomalyType.EXECUTION_QUALITY_DEGRADATION,
                severity="warning",
                message=(
                    f"Execution quality degradation: average slippage {avg_slippage:.3f}% "
                    f"exceeds threshold {threshold:.3f}%"
                ),
                metrics={
                    "average_slippage_pct": avg_slippage,
                    "threshold_pct": threshold,
                    "trades_analyzed": len(slippages),
                },
            )

        return AnomalyResult(is_anomaly=False)

    def check_behavioral_anomaly(
        self,
        daily_trade_counts: list[int],
    ) -> AnomalyResult:
        """Detect if trade frequency spikes or drops significantly (> 3 std devs).

        Args:
            daily_trade_counts: List of daily trade counts over lookback period

        Returns:
            AnomalyResult with detection status
        """
        if len(daily_trade_counts) < 5:
            return AnomalyResult(is_anomaly=False)

        import statistics

        try:
            mean = statistics.mean(daily_trade_counts)
            stdev = statistics.stdev(daily_trade_counts) if len(daily_trade_counts) > 1 else 0
        except (ValueError, statistics.StatisticsError):
            return AnomalyResult(is_anomaly=False)

        if stdev == 0:
            return AnomalyResult(is_anomaly=False)

        # Check most recent day
        current_count = daily_trade_counts[-1] if daily_trade_counts else 0
        z_score = abs((current_count - mean) / stdev) if stdev > 0 else 0

        threshold = self.config.frequency_std_dev_threshold

        if z_score > threshold:
            return AnomalyResult(
                is_anomaly=True,
                anomaly_type=AnomalyType.BEHAVIORAL_ANOMALY_FREQUENCY,
                severity="warning",
                message=(
                    f"Behavioral anomaly in trade frequency: current {current_count} trades "
                    f"vs average {mean:.1f} (z-score: {z_score:.2f})"
                ),
                metrics={
                    "current_trades": current_count,
                    "average_trades": mean,
                    "std_dev": stdev,
                    "z_score": z_score,
                    "threshold": threshold,
                    "lookback_days": len(daily_trade_counts),
                },
            )

        return AnomalyResult(is_anomaly=False)

    def run_all_checks(
        self,
        backtest_metrics: dict[str, Any],
        live_trades: list[dict[str, Any]],
        daily_trade_counts: Optional[list[int]] = None,
    ) -> list[AnomalyResult]:
        """Run all anomaly detection checks.

        Args:
            backtest_metrics: Dict with keys like 'win_rate', 'max_drawdown_pct', etc.
            live_trades: List of live trade records
            daily_trade_counts: Optional list of daily trade counts

        Returns:
            List of AnomalyResult objects (only anomalies if any detected)
        """
        results = []

        # Win rate drift
        if "win_rate" in backtest_metrics:
            result = self.check_win_rate_drift(
                float(backtest_metrics["win_rate"]),
                live_trades,
            )
            if result.is_anomaly:
                results.append(result)

        # Drawdown anomaly
        if "max_drawdown_pct" in backtest_metrics:
            result = self.check_drawdown_anomaly(
                float(backtest_metrics["max_drawdown_pct"]),
                float(backtest_metrics.get("live_max_drawdown_pct", 0)),
            )
            if result.is_anomaly:
                results.append(result)

        # Profit factor collapse
        result = self.check_profit_factor_collapse(live_trades)
        if result.is_anomaly:
            results.append(result)

        # Execution quality
        result = self.check_execution_quality(live_trades=live_trades)
        if result.is_anomaly:
            results.append(result)

        # Behavioral anomaly
        if daily_trade_counts:
            result = self.check_behavioral_anomaly(daily_trade_counts)
            if result.is_anomaly:
                results.append(result)

        return results
