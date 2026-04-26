#!/usr/bin/env python3
"""
GodsView — C4 Comprehensive Plot Generator
=============================================
Generates multi-panel plots showing ALL order flow indicators:
- Candlestick chart with BOS/CHOCH, OBs, sweeps, entries, SL/TP
- Delta proxy + cumulative delta
- Absorption + imbalance markers
- Volume with profile
- C1/C2/C3/C4 score breakdown per trade
"""

import os
import sys
import json
import logging
import numpy as np
import pandas as pd
from pathlib import Path
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from c4_strategy import C4Backtester, C4Scorer, C4StructureAnalyzer
from order_flow_engine import (
    DeltaEngine, AbsorptionDetector, ImbalanceDetector,
    VolumeProfileEngine, VWAPEngine, OrderFlowScorer
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger(__name__)

try:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    import matplotlib.patches as mpatches
    from matplotlib.gridspec import GridSpec
    from matplotlib.patches import Rectangle, FancyArrowPatch
    HAS_MPL = True
except ImportError:
    HAS_MPL = False
    logger.error("matplotlib required for plots")
    sys.exit(1)

try:
    import ccxt
    HAS_CCXT = True
except ImportError:
    HAS_CCXT = False

# ============================================================================
# CONFIG
# ============================================================================
SYMBOLS = ['BTC/USD', 'ETH/USD', 'SOL/USD']
TIMEFRAMES = ['5m', '15m', '1h', '4h']
BASE_DIR = Path(os.path.dirname(os.path.abspath(__file__))).parent
OUTPUT_DIR = BASE_DIR / 'docs' / 'backtests' / 'c4'

# Theme colors
BG = '#050510'
PANEL_BG = '#0a0a1a'
GRID = '#1a1a3a'
TEXT = '#e0e0e0'
GREEN = '#00ff88'
RED = '#ff4466'
BLUE = '#4488ff'
ORANGE = '#ff8844'
PURPLE = '#cc44ff'
CYAN = '#44ddff'
YELLOW = '#ffcc00'


def fetch_ohlcv(symbol: str, timeframe: str, limit: int = 300) -> pd.DataFrame:
    if HAS_CCXT:
        try:
            exchange = ccxt.kraken({'enableRateLimit': True})
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
            df = df.astype(float)
            logger.info(f"Fetched {len(df)} candles for {symbol} {timeframe}")
            return df
        except Exception as e:
            logger.warning(f"ccxt failed: {e}, using synthetic")

    return _generate_synthetic(symbol, timeframe, limit)


def _generate_synthetic(symbol: str, timeframe: str, limit: int) -> pd.DataFrame:
    np.random.seed(hash(symbol + timeframe) % 2**31)
    base_prices = {'BTC/USD': 65000, 'ETH/USD': 3400, 'SOL/USD': 150}
    base = base_prices.get(symbol, 1000)
    volatility = base * 0.008

    freq_map = {'5m': '5min', '15m': '15min', '1h': '1h', '4h': '4h'}
    freq = freq_map.get(timeframe, '1h')
    dates = pd.date_range('2024-06-01', periods=limit, freq=freq)

    returns = np.random.randn(limit) * volatility
    trend = np.sin(np.linspace(0, 4 * np.pi, limit)) * base * 0.05
    prices = base + np.cumsum(returns) + trend

    df = pd.DataFrame({
        'open': prices,
        'high': prices + np.abs(np.random.randn(limit)) * volatility * 1.5,
        'low': prices - np.abs(np.random.randn(limit)) * volatility * 1.5,
        'close': prices + np.random.randn(limit) * volatility * 0.3,
        'volume': np.random.lognormal(10, 1.5, limit)
    }, index=dates)

    df['high'] = df[['open', 'high', 'close']].max(axis=1)
    df['low'] = df[['open', 'low', 'close']].min(axis=1)
    return df


def compute_indicators(df: pd.DataFrame):
    """Compute all order flow indicators."""
    # Delta proxy (CLV-based)
    clv = ((df['close'] - df['low']) - (df['high'] - df['close'])) / (df['high'] - df['low']).replace(0, 1)
    df['delta'] = df['volume'] * clv

    # Cumulative delta
    df['cvd'] = df['delta'].cumsum()

    # Absorption score: high volume + small body
    body = abs(df['close'] - df['open'])
    wick = df['high'] - df['low']
    df['absorption'] = ((df['volume'] > df['volume'].rolling(20).mean() * 1.3) &
                        (body < wick * 0.3)).astype(float)

    # Imbalance: consecutive strong CLV candles
    df['imbalance'] = 0.0
    for i in range(2, len(df)):
        if clv.iloc[i] > 0.5 and clv.iloc[i-1] > 0.5:
            df.iloc[i, df.columns.get_loc('imbalance')] = 1.0  # bullish imbalance
        elif clv.iloc[i] < -0.5 and clv.iloc[i-1] < -0.5:
            df.iloc[i, df.columns.get_loc('imbalance')] = -1.0  # bearish imbalance

    # VWAP
    typical = (df['high'] + df['low'] + df['close']) / 3
    df['vwap'] = (typical * df['volume']).cumsum() / df['volume'].cumsum()

    return df


def detect_structure(df: pd.DataFrame):
    """Detect BOS, CHOCH, OBs, sweeps using C4 analyzer."""
    analyzer = C4StructureAnalyzer()
    swings = analyzer.detect_swings(df)
    bos_result = analyzer.detect_bos_choch(swings, df)  # returns dict with bos/choch/trend
    obs = analyzer.detect_order_blocks(df, swings)  # takes swings, returns OrderBlock list
    sweeps = analyzer.detect_liquidity_sweeps(df, swings)  # returns list of dicts
    # Convert bos_result dict into list of markers for plotting
    bos_markers = []
    for key in ['bos', 'choch']:
        entry = bos_result.get(key, {})
        if entry.get('detected'):
            bos_markers.append({
                'type': key.upper(),
                'direction': entry.get('direction', ''),
                'index': entry.get('index', 0),
                'strength': entry.get('strength', 0)
            })
    return swings, bos_markers, obs, sweeps


def plot_comprehensive(df, trades, swings, bos_list, obs, sweeps,
                       symbol, timeframe, output_path):
    """Generate the comprehensive multi-panel C4 plot."""
    fig = plt.figure(figsize=(22, 18))
    gs = GridSpec(6, 1, height_ratios=[4, 1.2, 1, 1, 0.8, 0.6], hspace=0.12)
    fig.patch.set_facecolor(BG)

    n = len(df)
    x = np.arange(n)

    # ── Panel 1: Candlestick + Structure + Trades ──
    ax1 = fig.add_subplot(gs[0])
    ax1.set_facecolor(PANEL_BG)

    # Candlesticks
    up = df['close'] >= df['open']
    down = ~up
    width = 0.6
    ax1.bar(x[up], (df['close'] - df['open'])[up], width, bottom=df['open'][up],
            color=GREEN + '88', edgecolor=GREEN, linewidth=0.5)
    ax1.bar(x[down], (df['open'] - df['close'])[down], width, bottom=df['close'][down],
            color=RED + '88', edgecolor=RED, linewidth=0.5)
    # Wicks
    ax1.vlines(x[up], df['low'][up], df['high'][up], color=GREEN, linewidth=0.4)
    ax1.vlines(x[down], df['low'][down], df['high'][down], color=RED, linewidth=0.4)

    # VWAP line
    if 'vwap' in df.columns:
        ax1.plot(x, df['vwap'], color=YELLOW, linewidth=1, alpha=0.6, label='VWAP')

    # Swing highs/lows (SwingPoint dataclass: .index, .price, .type, .strength)
    for s in swings:
        idx = s.index if hasattr(s, 'index') else s.get('index', 0)
        price = s.price if hasattr(s, 'price') else s.get('price', 0)
        stype = s.type if hasattr(s, 'type') else s.get('type', '')
        if idx < n:
            if stype == 'high':
                ax1.plot(idx, price, 'v', color=CYAN, markersize=5, alpha=0.7)
            else:
                ax1.plot(idx, price, '^', color=CYAN, markersize=5, alpha=0.7)

    # BOS / CHOCH markers
    for b in bos_list:
        idx = b.get('index', b.get('break_index', 0))
        if idx < n:
            color = BLUE if b.get('type') == 'BOS' else PURPLE
            label = b.get('type', 'BOS')
            direction = b.get('direction', '')
            marker = '^' if 'bullish' in str(direction).lower() else 'v'
            ax1.plot(idx, df['close'].iloc[idx], marker, color=color,
                     markersize=8, alpha=0.9, zorder=6)
            ax1.annotate(f'{label}', (idx, df['close'].iloc[idx]),
                         fontsize=6, color=color, xytext=(3, 8 if marker == '^' else -8),
                         textcoords='offset points')

    # Order blocks as shaded rectangles (OrderBlock dataclass: .start_idx, .end_idx, .high, .low, .ob_type, .strength)
    for ob in obs[:15]:  # limit to 15 to avoid clutter
        start = ob.start_idx if hasattr(ob, 'start_idx') else ob.get('start_index', ob.get('index', 0))
        end_idx = ob.end_idx if hasattr(ob, 'end_idx') else min(start + 5, n - 1)
        end = min(end_idx + 3, n - 1)  # extend slightly for visibility
        top = ob.high if hasattr(ob, 'high') else ob.get('high', ob.get('top', 0))
        bottom = ob.low if hasattr(ob, 'low') else ob.get('low', ob.get('bottom', 0))
        if start < n and top > 0 and bottom > 0:
            ob_type = ob.ob_type if hasattr(ob, 'ob_type') else ob.get('type', ob.get('direction', 'bullish'))
            color = GREEN + '15' if 'bull' in str(ob_type).lower() else RED + '15'
            edge = GREEN if 'bull' in str(ob_type).lower() else RED
            rect = Rectangle((start, bottom), end - start, top - bottom,
                              facecolor=color, edgecolor=edge, linewidth=0.8, alpha=0.5)
            ax1.add_patch(rect)

    # Liquidity sweeps (dicts with 'type', 'level', 'index', 'depth', 'strength')
    for sw in sweeps[:10]:
        idx = sw.get('index', sw.get('sweep_index', 0)) if isinstance(sw, dict) else getattr(sw, 'index', 0)
        sw_type = sw.get('type', '') if isinstance(sw, dict) else getattr(sw, 'type', '')
        if idx < n:
            ax1.plot(idx, df['low'].iloc[idx] if 'bull' in str(sw_type).lower()
                     else df['high'].iloc[idx],
                     '*', color=YELLOW, markersize=10, alpha=0.9, zorder=7)
            ax1.annotate('SWEEP', (idx, df['close'].iloc[idx]),
                         fontsize=5, color=YELLOW, xytext=(3, -12),
                         textcoords='offset points')

    # Trade entries/exits
    for t in trades:
        ei = t['entry_index']
        xi = t['exit_index']
        if ei >= n or xi >= n:
            continue

        is_win = t['pnl'] > 0
        color = GREEN if is_win else RED
        marker = '^' if t['direction'] == 'LONG' else 'v'

        ax1.scatter(ei, t['entry_price'], marker=marker, color=color, s=120,
                    zorder=8, edgecolors='white', linewidth=0.5)
        ax1.scatter(xi, t['exit_price'], marker='x', color=color, s=80, zorder=8)

        # SL/TP lines
        ax1.plot([ei, xi], [t['stop_loss'], t['stop_loss']],
                 color=RED, linewidth=0.8, linestyle=':', alpha=0.5)
        ax1.plot([ei, xi], [t['take_profit'], t['take_profit']],
                 color=GREEN, linewidth=0.8, linestyle=':', alpha=0.5)

        # C4 score label
        ax1.annotate(f'C4:{t["c4_score"]:.0f}', (ei, t['entry_price']),
                     fontsize=7, color='white', fontweight='bold',
                     xytext=(5, 12 if t['direction'] == 'LONG' else -12),
                     textcoords='offset points',
                     bbox=dict(boxstyle='round,pad=0.2', facecolor=PANEL_BG, alpha=0.8))

    # Absorption markers on candles
    abs_mask = df['absorption'] > 0
    if abs_mask.any():
        ax1.scatter(x[abs_mask], df['high'][abs_mask] * 1.001,
                    marker='D', color=ORANGE, s=25, alpha=0.7, zorder=5, label='Absorption')

    ax1.set_title(f'GodsView C4 Strategy — {symbol} {timeframe}  [OHLCV PROXY ORDER FLOW]',
                  color=TEXT, fontsize=14, fontweight='bold', pad=10)
    ax1.set_ylabel('Price', color=TEXT, fontsize=10)
    ax1.tick_params(colors=TEXT, labelsize=8)
    ax1.grid(True, alpha=0.15, color=GRID)
    ax1.legend(loc='upper left', fontsize=7, facecolor=PANEL_BG, edgecolor=GRID,
               labelcolor=TEXT)

    # ── Panel 2: Delta Proxy ──
    ax2 = fig.add_subplot(gs[1], sharex=ax1)
    ax2.set_facecolor(PANEL_BG)
    delta_colors = [GREEN if d > 0 else RED for d in df['delta']]
    ax2.bar(x, df['delta'], color=delta_colors, alpha=0.7, width=0.8)
    ax2.axhline(y=0, color='#444', linewidth=0.5)
    ax2.set_ylabel('Delta (proxy)', color=TEXT, fontsize=9)
    ax2.tick_params(colors=TEXT, labelsize=7)
    ax2.grid(True, alpha=0.1, color=GRID)

    # ── Panel 3: Cumulative Delta (CVD) ──
    ax3 = fig.add_subplot(gs[2], sharex=ax1)
    ax3.set_facecolor(PANEL_BG)
    ax3.plot(x, df['cvd'], color=CYAN, linewidth=1.2, label='CVD')
    ax3.fill_between(x, df['cvd'], 0, where=df['cvd'] > 0, alpha=0.15, color=GREEN)
    ax3.fill_between(x, df['cvd'], 0, where=df['cvd'] < 0, alpha=0.15, color=RED)
    ax3.axhline(y=0, color='#444', linewidth=0.5)
    ax3.set_ylabel('CVD', color=TEXT, fontsize=9)
    ax3.tick_params(colors=TEXT, labelsize=7)
    ax3.grid(True, alpha=0.1, color=GRID)
    ax3.legend(loc='upper left', fontsize=7, facecolor=PANEL_BG, edgecolor=GRID, labelcolor=TEXT)

    # ── Panel 4: Volume + Imbalance ──
    ax4 = fig.add_subplot(gs[3], sharex=ax1)
    ax4.set_facecolor(PANEL_BG)
    vol_colors = [GREEN + '88' if c >= o else RED + '88'
                  for c, o in zip(df['close'], df['open'])]
    ax4.bar(x, df['volume'], color=vol_colors, width=0.8)

    # Imbalance markers
    bull_imb = df['imbalance'] > 0
    bear_imb = df['imbalance'] < 0
    if bull_imb.any():
        ax4.scatter(x[bull_imb], df['volume'][bull_imb], marker='^',
                    color=GREEN, s=30, zorder=5, label='Bull Imbalance')
    if bear_imb.any():
        ax4.scatter(x[bear_imb], df['volume'][bear_imb], marker='v',
                    color=RED, s=30, zorder=5, label='Bear Imbalance')

    ax4.set_ylabel('Volume', color=TEXT, fontsize=9)
    ax4.tick_params(colors=TEXT, labelsize=7)
    ax4.grid(True, alpha=0.1, color=GRID)
    ax4.legend(loc='upper right', fontsize=6, facecolor=PANEL_BG, edgecolor=GRID, labelcolor=TEXT)

    # ── Panel 5: C1/C2/C3/C4 Score Bars per Trade ──
    ax5 = fig.add_subplot(gs[4])
    ax5.set_facecolor(PANEL_BG)

    if trades:
        trade_x = np.arange(1, len(trades) + 1)
        w = 0.2
        c1s = [t.get('c1', 0) for t in trades]
        c2s = [t.get('c2', 0) for t in trades]
        c3s = [t.get('c3', 0) for t in trades]
        c4s = [t.get('c4_control', 0) for t in trades]

        ax5.bar(trade_x - 1.5*w, c1s, w, label='C1 Context', color=BLUE)
        ax5.bar(trade_x - 0.5*w, c2s, w, label='C2 Confirm', color=GREEN)
        ax5.bar(trade_x + 0.5*w, c3s, w, label='C3 Commit', color=ORANGE)
        ax5.bar(trade_x + 1.5*w, c4s, w, label='C4 Control', color=PURPLE)

        ax5.axhline(y=20, color=YELLOW, alpha=0.3, linestyle='--', linewidth=0.5)
        ax5.set_xlabel('Trade #', color=TEXT, fontsize=8)
        ax5.set_ylabel('Score /25', color=TEXT, fontsize=9)
        ax5.legend(fontsize=6, loc='upper right', facecolor=PANEL_BG, edgecolor=GRID, labelcolor=TEXT)
    else:
        ax5.text(0.5, 0.5, 'No trades passed C4 threshold', color='#666',
                 fontsize=10, ha='center', va='center', transform=ax5.transAxes)

    ax5.tick_params(colors=TEXT, labelsize=7)
    ax5.grid(True, alpha=0.1, color=GRID)

    # ── Panel 6: Metrics Summary ──
    ax6 = fig.add_subplot(gs[5])
    ax6.set_facecolor(PANEL_BG)
    ax6.axis('off')

    if trades:
        wins = len([t for t in trades if t['pnl'] > 0])
        losses = len(trades) - wins
        total_pnl = sum(t.get('pnl_pct', 0) for t in trades)
        avg_rr = np.mean([t.get('risk_reward', 0) for t in trades])
        avg_c4 = np.mean([t.get('c4_score', 0) for t in trades])
        max_dd = max(abs(t.get('pnl_pct', 0)) for t in trades if t.get('pnl', 0) < 0) if losses > 0 else 0

        metrics = (
            f"Trades: {len(trades)}  |  Wins: {wins}  |  Losses: {losses}  |  "
            f"WR: {wins/len(trades)*100:.1f}%  |  PnL: {total_pnl:+.2f}%  |  "
            f"Avg RR: {avg_rr:.1f}  |  Avg C4: {avg_c4:.0f}  |  Max Loss: {max_dd:.2f}%"
        )
    else:
        metrics = f"No trades met C4 threshold (≥80) on {symbol} {timeframe}"

    ax6.text(0.5, 0.5, metrics, color=TEXT, fontsize=10, ha='center', va='center',
             transform=ax6.transAxes,
             bbox=dict(boxstyle='round,pad=0.5', facecolor='#1a1a3a', alpha=0.9))

    # Watermark
    fig.text(0.99, 0.01, 'GodsView C4 | OHLCV Proxy Order Flow | Not Real Order Book Data',
             color='#333', fontsize=7, ha='right', va='bottom')

    plt.savefig(output_path, dpi=150, bbox_inches='tight', facecolor=BG)
    plt.close()
    logger.info(f"Comprehensive plot saved: {output_path}")


def run_all():
    """Generate comprehensive plots for all symbols and timeframes."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for symbol in SYMBOLS:
        sc = symbol.replace('/', '')
        for tf in TIMEFRAMES:
            logger.info(f"\n{'='*50}")
            logger.info(f"COMPREHENSIVE PLOT: {symbol} {tf}")
            logger.info(f"{'='*50}")

            df = fetch_ohlcv(symbol, tf, limit=300)
            if len(df) < 50:
                logger.warning(f"Insufficient data for {symbol} {tf}")
                continue

            # Compute all indicators
            df = compute_indicators(df)

            # Detect structure
            swings, bos_list, obs, sweeps = detect_structure(df)

            # Run C4 backtest to get trades
            bt = C4Backtester()
            result = bt.run(df, symbol, tf, min_score=80)
            trades = result['trades']
            metrics = result['metrics']

            logger.info(f"  Trades: {metrics['total_trades']}, WR: {metrics['win_rate']}%, "
                         f"PF: {metrics['profit_factor']}, PnL: {metrics['total_pnl_pct']:.2f}%")

            # Generate plot
            plot_dir = OUTPUT_DIR / sc / tf
            plot_dir.mkdir(parents=True, exist_ok=True)
            plot_comprehensive(
                df, trades, swings, bos_list, obs, sweeps,
                symbol, tf,
                plot_dir / 'c4_comprehensive.png'
            )

    logger.info(f"\nAll comprehensive plots saved to: {OUTPUT_DIR}")


if __name__ == '__main__':
    run_all()
