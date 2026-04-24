"""
GodsView v2 — Backtest engine.

Drives the simulation loop:
  1. Fetch bars from market-data service (or accept pre-loaded bars)
  2. Build features bar-by-bar
  3. Detect signals via feature_service.signal_detector
  4. Submit orders to paper broker
  5. Update open positions on every bar
  6. Compute metrics at end
  7. Return BacktestResult
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Sequence

from services.shared.config import cfg
from services.shared.logging import get_logger
from services.shared.types import (
    BacktestMetrics, BacktestResult, Bar, Direction, Trade, TradeOutcome,
)
from services.backtest_service.broker import BrokerConfig, PaperBroker
from services.backtest_service.metrics import compute_metrics
from services.feature_service.signal_detector import detect_signal

log = get_logger(__name__)


@dataclass
class BacktestConfig:
    symbol:         str
    timeframe:      str   = "15min"
    lookback_days:  int   = 30
    initial_equity: float = 10_000.0
    commission_pct: float = 0.0005
    slippage_pct:   float = 0.0002
    risk_per_trade_pct: float = 0.01
    max_position_pct:   float = 0.10
    use_si_filter:  bool  = True
    strategy:       str   = "sk_setup"
    max_bars_forward: int = 20   # max bars to hold a position before force-exit


# Supported timeframes with metadata
SUPPORTED_TIMEFRAMES: list[dict[str, Any]] = [
    {"value": "1min",  "label": "1 Minute",  "bars_per_day": 390},
    {"value": "5min",  "label": "5 Minutes", "bars_per_day": 78},
    {"value": "15min", "label": "15 Minutes", "bars_per_day": 26},
    {"value": "30min", "label": "30 Minutes", "bars_per_day": 13},
    {"value": "1hour", "label": "1 Hour",    "bars_per_day": 6.5},
    {"value": "2hour", "label": "2 Hours",   "bars_per_day": 3.25},
    {"value": "4hour", "label": "4 Hours",   "bars_per_day": 1.625},
    {"value": "8hour", "label": "8 Hours",   "bars_per_day": 0.81},
    {"value": "12hour","label": "12 Hours",  "bars_per_day": 0.54},
    {"value": "1day",  "label": "Daily",     "bars_per_day": 1},
]

_TF_BARS_PER_DAY: dict[str, float] = {t["value"]: t["bars_per_day"] for t in SUPPORTED_TIMEFRAMES}


def run_backtest(bars: list[Bar], config: BacktestConfig) -> BacktestResult:
    """
    Execute a full backtest simulation on the provided bars.

    Args:
        bars:   List of OHLCV bars (oldest → newest)
        config: Backtest configuration

    Returns:
        BacktestResult with metrics, equity curve, trades, and signals
    """
    if not bars:
        log.warning("backtest_empty_bars", symbol=config.symbol)
        return _empty_result(config)

    broker = PaperBroker(
        initial_equity=config.initial_equity,
        config=BrokerConfig(
            commission_pct=config.commission_pct,
            slippage_pct=config.slippage_pct,
            risk_per_trade_pct=config.risk_per_trade_pct,
            max_position_pct=config.max_position_pct,
        ),
    )

    run_id       = str(uuid.uuid4())[:8]
    all_signals  = []
    bars_held    = 0
    min_lookback = 55

    # Seed equity curve with initial point
    broker.equity_curve.append({
        "timestamp":    bars[0].timestamp.isoformat(),
        "equity":       round(config.initial_equity, 2),
        "drawdown_pct": 0.0,
        "total_bars":   0,
    })

    for i in range(min_lookback, len(bars)):
        bar = bars[i]

        # ── Update open position ──────────────────────────────────────────────
        closed = broker.update(bar)
        if closed:
            closed.bars_held = bars_held
            bars_held = 0

        # ── Force-exit if held too long ───────────────────────────────────────
        if broker.open_trade:
            bars_held += 1
            if bars_held >= config.max_bars_forward:
                forced = broker.force_close(bar)
                if forced:
                    forced.bars_held = bars_held
                bars_held = 0

        # ── Signal detection (rolling window) ────────────────────────────────
        if broker.open_trade is None:
            window = bars[max(0, i - min_lookback) : i + 1]
            signal = detect_signal(window, config.timeframe)

            if signal:
                all_signals.append({
                    "bar_index": i,
                    "timestamp": bar.timestamp.isoformat(),
                    "direction": signal.direction.value,
                    "type":      signal.signal_type.value,
                    "entry":     signal.entry,
                    "stop":      signal.stop,
                    "target":    signal.target,
                    "confidence": signal.confidence,
                })

                # Open position on next bar (i+1) open; for simplicity enter now
                trade = broker.open_position(
                    bar=bar,
                    signal_id=signal.id,
                    direction=signal.direction,
                    stop_price=signal.stop,
                    target_price=signal.target,
                )
                if trade:
                    bars_held = 0

        # ── Record equity curve ───────────────────────────────────────────────
        broker.equity_curve.append({
            "timestamp":  bar.timestamp.isoformat(),
            "equity":     round(broker.equity, 2),
            "drawdown_pct": round(broker.drawdown_pct * 100, 3),
            "total_bars": i,
        })

    # ── Force-close any remaining position ───────────────────────────────────
    if broker.open_trade and bars:
        forced = broker.force_close(bars[-1])
        if forced:
            forced.bars_held = bars_held

    # ── Compute metrics ───────────────────────────────────────────────────────
    # Tag the final equity curve point with total bars
    if broker.equity_curve:
        broker.equity_curve[-1]["total_bars"] = len(bars)

    metrics = compute_metrics(
        trades=broker.closed_trades,
        equity_curve=broker.equity_curve,
        initial_equity=config.initial_equity,
        bars_per_year=_TF_BARS_PER_DAY.get(config.timeframe, 26) * 252,
    )

    trades_data = [_trade_to_dict(t) for t in broker.closed_trades]

    log.info(
        "backtest_complete",
        run_id=run_id,
        symbol=config.symbol,
        timeframe=config.timeframe,
        bars=len(bars),
        trades=metrics.total_trades,
        win_rate=f"{metrics.win_rate:.1%}",
        pnl=f"${metrics.total_pnl:.2f}",
        sharpe=f"{metrics.sharpe_ratio:.2f}",
    )

    return BacktestResult(
        run_id=run_id,
        symbol=config.symbol,
        timeframe=config.timeframe,
        start_date=bars[0].timestamp if bars else datetime.now(timezone.utc),
        end_date=bars[-1].timestamp  if bars else datetime.now(timezone.utc),
        initial_equity=config.initial_equity,
        final_equity=round(broker.equity, 2),
        metrics=metrics,
        equity_curve=broker.equity_curve,
        trades=trades_data,
        signals=all_signals,
        config={
            "symbol":    config.symbol,
            "timeframe": config.timeframe,
            "lookback_days": config.lookback_days,
            "use_si_filter": config.use_si_filter,
            "strategy":  config.strategy,
        },
    )


def _trade_to_dict(t: Trade) -> dict[str, Any]:
    return {
        "id":          t.id,
        "signal_id":   t.signal_id,
        "symbol":      t.symbol,
        "direction":   t.direction.value,
        "entry":       t.entry_price,
        "exit":        t.exit_price,
        "stop":        t.stop_price,
        "target":      t.target_price,
        "size":        t.size,
        "pnl":         t.pnl,
        "pnl_pct":     round(t.pnl_pct * 100, 3),
        "outcome":     t.outcome.value,
        "bars_held":   t.bars_held,
        "entry_time":  t.entry_time.isoformat() if t.entry_time else None,
        "exit_time":   t.exit_time.isoformat()  if t.exit_time  else None,
        "commission":  round(t.commission, 4),
    }


def _empty_result(config: BacktestConfig) -> BacktestResult:
    now = datetime.now(timezone.utc)
    return BacktestResult(
        run_id=str(uuid.uuid4())[:8],
        symbol=config.symbol,
        timeframe=config.timeframe,
        start_date=now,
        end_date=now,
        initial_equity=config.initial_equity,
        final_equity=config.initial_equity,
        metrics=BacktestMetrics(),
        config={"symbol": config.symbol, "error": "no_bars"},
    )
