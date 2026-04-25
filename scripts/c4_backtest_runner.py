#!/usr/bin/env python3
"""
GodsView — C4 Strategy Backtest Runner
========================================
Fetches historical OHLCV data, runs C4 backtests, generates plots and reports.

Usage: python3 c4_backtest_runner.py
"""

import os
import sys
import json
import logging
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

# Ensure we can import from scripts/
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from c4_strategy import C4Backtester, C4Scorer, log_c4_scan

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

# Try matplotlib
try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.gridspec import GridSpec
    HAS_MPL = True
except ImportError:
    HAS_MPL = False
    logger.warning("matplotlib not available — skipping plots")

# Try ccxt
try:
    import ccxt
    HAS_CCXT = True
except ImportError:
    HAS_CCXT = False
    logger.warning("ccxt not available — using synthetic data")

# ============================================================================
# CONFIG
# ============================================================================

SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD']
TIMEFRAMES = ['5m', '15m', '1h', '4h']  # All timeframes including scalp
BASE_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent
OUTPUT_DIR = BASE_DIR / 'docs' / 'backtests' / 'c4'

# Score thresholds for comparison runs
STRATEGIES = {
    'BOS_OB_only': 0,       # no C4 gate (just BOS+OB)
    'BOS_OB_Flow': 60,      # medium gate
    'Full_C4': 80,           # strict C4 gate
}


def fetch_ohlcv(symbol: str, timeframe: str, limit: int = 500) -> pd.DataFrame:
    """Fetch OHLCV data from Kraken via ccxt."""
    if not HAS_CCXT:
        return _generate_synthetic(symbol, timeframe, limit)

    try:
        exchange = ccxt.kraken({'enableRateLimit': True})
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)

        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        df.set_index('timestamp', inplace=True)
        df = df.astype(float)

        logger.info(f"Fetched {len(df)} candles for {symbol} {timeframe} from Kraken")
        return df
    except Exception as e:
        logger.warning(f"ccxt fetch failed for {symbol} {timeframe}: {e}, using synthetic")
        return _generate_synthetic(symbol, timeframe, limit)


def _generate_synthetic(symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    """Generate synthetic OHLCV for testing when no exchange access."""
    np.random.seed(hash(symbol + timeframe) % 2**31)

    base_prices = {'BTC/USD': 65000, 'ETH/USD': 3400, 'SOL/USD': 150}
    base = base_prices.get(symbol, 1000)
    volatility = base * 0.008

    freq_map = {'5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h'}
    freq = freq_map.get(timeframe, '1h')
    dates = pd.date_range('2024-06-01', periods=limit, freq=freq)

    returns = np.random.randn(limit) * volatility
    # Add trend and mean reversion
    trend = np.sin(np.linspace(0, 4 * np.pi, limit)) * base * 0.05
    prices = base + np.cumsum(returns) + trend

    df = pd.DataFrame({
        'open': prices,
        'high': prices + np.abs(np.random.randn(limit)) * volatility * 1.5,
        'low': prices - np.abs(np.random.randn(limit)) * volatility * 1.5,
        'close': prices + np.random.randn(limit) * volatility * 0.3,
        'volume': np.random.lognormal(10, 1.5, limit)
    }, index=dates)

    # Ensure OHLC consistency
    df['high'] = df[['open', 'high', 'close']].max(axis=1)
    df['low'] = df[['open', 'low', 'close']].min(axis=1)

    logger.info(f"Generated {len(df)} synthetic candles for {symbol} {timeframe}")
    return df


def plot_c4_backtest(df, trades, symbol, timeframe, output_path):
    """Generate C4 backtest plot with candlesticks, signals, and C4 breakdown."""
    if not HAS_MPL or not trades:
        return

    fig = plt.figure(figsize=(20, 14))
    gs = GridSpec(4, 1, height_ratios=[3, 1, 1, 0.8], hspace=0.15)

    # Colors
    bg_color = '#0a0a1a'
    text_color = '#e0e0e0'
    grid_color = '#1a1a3a'

    fig.patch.set_facecolor(bg_color)

    # ── Panel 1: Price + Trades ──
    ax1 = fig.add_subplot(gs[0])
    ax1.set_facecolor(bg_color)

    # Candlesticks (simplified as line)
    up = df['close'] >= df['open']
    down = ~up
    ax1.plot(df.index, df['close'], color='#888888', linewidth=0.5, alpha=0.5)

    # Plot trades
    for t in trades:
        entry_idx = t['entry_index']
        exit_idx = t['exit_index']
        if entry_idx >= len(df) or exit_idx >= len(df):
            continue

        entry_time = df.index[entry_idx]
        exit_time = df.index[exit_idx]

        color = '#00ff88' if t['pnl'] > 0 else '#ff4444'
        marker = '^' if t['direction'] == 'LONG' else 'v'

        ax1.scatter(entry_time, t['entry_price'], marker=marker, color=color, s=100, zorder=5)
        ax1.scatter(exit_time, t['exit_price'], marker='x', color=color, s=80, zorder=5)

        # Draw trade line
        ax1.plot([entry_time, exit_time], [t['entry_price'], t['exit_price']],
                 color=color, linewidth=1, alpha=0.7, linestyle='--')

        # SL / TP lines
        ax1.axhline(y=t['stop_loss'], xmin=0, xmax=1, color='#ff4444', alpha=0.1, linewidth=0.5)
        ax1.axhline(y=t['take_profit'], xmin=0, xmax=1, color='#00ff88', alpha=0.1, linewidth=0.5)

        # C4 score annotation
        ax1.annotate(f'C4:{t["c4_score"]:.0f}', (entry_time, t['entry_price']),
                     fontsize=7, color=text_color, xytext=(5, 10),
                     textcoords='offset points')

    ax1.set_title(f'C4 Strategy — {symbol} {timeframe}', color=text_color, fontsize=14, fontweight='bold')
    ax1.set_ylabel('Price', color=text_color)
    ax1.tick_params(colors=text_color)
    ax1.grid(True, alpha=0.2, color=grid_color)

    # ── Panel 2: Volume ──
    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax2.set_facecolor(bg_color)
    colors = ['#00ff88' if c >= o else '#ff4444' for c, o in zip(df['close'], df['open'])]
    ax2.bar(df.index, df['volume'], color=colors, alpha=0.6, width=0.8)
    ax2.set_ylabel('Volume', color=text_color)
    ax2.tick_params(colors=text_color)
    ax2.grid(True, alpha=0.2, color=grid_color)

    # ── Panel 3: C4 Scores per trade ──
    ax3 = fig.add_subplot(gs[2])
    ax3.set_facecolor(bg_color)

    if trades:
        trade_nums = range(1, len(trades) + 1)
        c1_scores = [t['c1'] for t in trades]
        c2_scores = [t['c2'] for t in trades]
        c3_scores = [t['c3'] for t in trades]
        c4_scores = [t['c4_control'] for t in trades]

        width = 0.2
        x = np.array(list(trade_nums))
        ax3.bar(x - 1.5 * width, c1_scores, width, label='C1 Context', color='#4488ff')
        ax3.bar(x - 0.5 * width, c2_scores, width, label='C2 Confirm', color='#44ff88')
        ax3.bar(x + 0.5 * width, c3_scores, width, label='C3 Commit', color='#ff8844')
        ax3.bar(x + 1.5 * width, c4_scores, width, label='C4 Control', color='#ff44ff')

        ax3.axhline(y=20, color='#ffff00', alpha=0.3, linestyle='--', linewidth=0.5)
        ax3.set_xlabel('Trade #', color=text_color)
        ax3.set_ylabel('C Score (/25)', color=text_color)
        ax3.legend(fontsize=8, loc='upper right')

    ax3.tick_params(colors=text_color)
    ax3.grid(True, alpha=0.2, color=grid_color)

    # ── Panel 4: Metrics summary ──
    ax4 = fig.add_subplot(gs[3])
    ax4.set_facecolor(bg_color)
    ax4.axis('off')

    wins = len([t for t in trades if t['pnl'] > 0])
    losses = len([t for t in trades if t['pnl'] <= 0])
    total_pnl = sum(t['pnl_pct'] for t in trades)
    avg_score = np.mean([t['c4_score'] for t in trades]) if trades else 0

    metrics_text = (
        f"Trades: {len(trades)}  |  Wins: {wins}  |  Losses: {losses}  |  "
        f"Win Rate: {wins / len(trades) * 100:.1f}%  |  "
        f"Total PnL: {total_pnl:.2f}%  |  Avg C4: {avg_score:.1f}"
    )
    ax4.text(0.5, 0.5, metrics_text, color=text_color, fontsize=11,
             ha='center', va='center', transform=ax4.transAxes,
             bbox=dict(boxstyle='round,pad=0.5', facecolor='#1a1a3a', alpha=0.8))

    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=bg_color)
    plt.close()
    logger.info(f"Plot saved: {output_path}")


def run_all_backtests():
    """Run C4 backtests for all symbols/timeframes and generate reports."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_results = {}
    comparison_data = []

    for symbol in SYMBOLS:
        symbol_clean = symbol.replace('/', '')

        for timeframe in TIMEFRAMES:
            logger.info(f"\n{'='*60}")
            logger.info(f"C4 BACKTEST: {symbol} {timeframe}")
            logger.info(f"{'='*60}")

            # Fetch data
            df = fetch_ohlcv(symbol, timeframe, limit=500)

            if len(df) < 50:
                logger.warning(f"Insufficient data for {symbol} {timeframe} ({len(df)} candles)")
                continue

            # Run C4 backtest at different thresholds for comparison
            backtester = C4Backtester()

            for strategy_name, threshold in STRATEGIES.items():
                result = backtester.run(df, symbol, timeframe, min_score=max(threshold, 1))
                metrics = result['metrics']

                key = f"{symbol_clean}_{timeframe}_{strategy_name}"
                all_results[key] = result

                comparison_data.append({
                    'symbol': symbol,
                    'timeframe': timeframe,
                    'strategy': strategy_name,
                    'threshold': threshold,
                    'total_trades': metrics['total_trades'],
                    'win_rate': metrics['win_rate'],
                    'profit_factor': metrics['profit_factor'],
                    'max_drawdown': metrics['max_drawdown_pct'],
                    'total_pnl_pct': metrics['total_pnl_pct'],
                    'avg_c4_score': metrics['avg_c4_score'],
                    'long_trades': metrics['long_trades'],
                    'short_trades': metrics['short_trades'],
                    'long_wr': metrics['long_win_rate'],
                    'short_wr': metrics['short_win_rate'],
                })

                logger.info(
                    f"  {strategy_name}: {metrics['total_trades']} trades, "
                    f"WR={metrics['win_rate']}%, PF={metrics['profit_factor']}, "
                    f"PnL={metrics['total_pnl_pct']:.2f}%, DD={metrics['max_drawdown_pct']:.2f}%"
                )

            # Generate plot for Full C4
            full_c4_key = f"{symbol_clean}_{timeframe}_Full_C4"
            if full_c4_key in all_results:
                plot_dir = OUTPUT_DIR / symbol_clean / timeframe
                plot_dir.mkdir(parents=True, exist_ok=True)
                plot_c4_backtest(
                    df, all_results[full_c4_key]['trades'],
                    symbol, timeframe,
                    plot_dir / 'c4_backtest.png'
                )

    # Save comparison report
    if comparison_data:
        comp_df = pd.DataFrame(comparison_data)
        report_path = OUTPUT_DIR / 'c4_comparison_report.json'
        comp_df.to_json(report_path, orient='records', indent=2)
        logger.info(f"\nComparison report saved: {report_path}")

        # Print comparison table
        logger.info("\n" + "=" * 100)
        logger.info("C4 STRATEGY COMPARISON REPORT")
        logger.info("=" * 100)
        logger.info(f"{'Symbol':<10} {'TF':<5} {'Strategy':<15} {'Trades':>7} {'WR%':>7} "
                     f"{'PF':>7} {'PnL%':>8} {'DD%':>7} {'AvgC4':>7}")
        logger.info("-" * 100)
        for row in comparison_data:
            logger.info(
                f"{row['symbol']:<10} {row['timeframe']:<5} {row['strategy']:<15} "
                f"{row['total_trades']:>7} {row['win_rate']:>6.1f}% "
                f"{row['profit_factor']:>7.2f} {row['total_pnl_pct']:>7.2f}% "
                f"{row['max_drawdown']:>6.2f}% {row['avg_c4_score']:>6.1f}"
            )

    # Save all trade details
    for key, result in all_results.items():
        if result['trades']:
            trades_path = OUTPUT_DIR / f'{key}_trades.json'
            # Convert trades to serializable format
            serializable_trades = []
            for t in result['trades']:
                st = {k: v for k, v in t.items() if k != 'confirmations' and k != 'warnings'}
                st['confirmations'] = t.get('confirmations', [])
                st['warnings'] = t.get('warnings', [])
                serializable_trades.append(st)
            with open(trades_path, 'w') as f:
                json.dump(serializable_trades, f, indent=2, default=str)

    logger.info(f"\nAll outputs saved to: {OUTPUT_DIR}")
    return comparison_data


if __name__ == '__main__':
    results = run_all_backtests()
