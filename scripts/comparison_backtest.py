#!/usr/bin/env python3
"""
GodsView — Comparison Backtest Engine
======================================
Runs 3-mode comparison backtest:
  A) BOS only (structure breaks, no OB confirmation)
  B) BOS + OB (structure + order block retest)
  C) BOS + OB + Advanced Order Flow (full pipeline with score gating)

Generates per-symbol metrics + plots + summary comparison.
All order flow indicators are OHLCV PROXY — not real order book data.

Usage:
  python3 comparison_backtest.py
"""

import sys
import json
import os
from pathlib import Path
from datetime import datetime
from collections import defaultdict

import numpy as np
import pandas as pd
import ccxt

# Ensure scripts dir is in path for imports
SCRIPT_DIR = Path(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, str(SCRIPT_DIR))

from order_flow_engine import OrderFlowScorer, DeltaEngine

# ============================================================================
# CONFIG
# ============================================================================

SYMBOLS = {
    'BTCUSD': {'ccxt': 'BTC/USD', 'timeframe': '4h', 'candles': 500},
    'ETHUSD': {'ccxt': 'ETH/USD', 'timeframe': '1h', 'candles': 500},
    'SOLUSD': {'ccxt': 'SOL/USD', 'timeframe': '4h', 'candles': 500},
}

RISK_PER_TRADE = 0.01       # 1% risk
STARTING_CAPITAL = 100_000
ORDER_FLOW_THRESHOLD = 60   # Minimum OF score for mode C

OUTPUT_DIR = SCRIPT_DIR.parent / 'docs' / 'backtests' / 'order-flow'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ============================================================================
# DATA FETCH
# ============================================================================

def fetch_ohlcv(symbol_ccxt: str, timeframe: str, limit: int) -> pd.DataFrame:
    """Fetch OHLCV from Kraken via ccxt."""
    print(f"  Fetching {symbol_ccxt} {timeframe} x{limit}...")
    exchange = ccxt.kraken()
    candles = exchange.fetch_ohlcv(symbol_ccxt, timeframe, limit=limit)
    df = pd.DataFrame(candles, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    df.set_index('timestamp', inplace=True)
    print(f"  Got {len(df)} candles: {df.index[0]} → {df.index[-1]}")
    return df

# ============================================================================
# STRUCTURE DETECTION (shared across all modes)
# ============================================================================

def detect_swings(df: pd.DataFrame, lookback: int = 5):
    """Detect swing high/low points."""
    swings = []
    highs = df['high'].values
    lows = df['low'].values
    volumes = df['volume'].values
    avg_range = np.mean(highs - lows)
    tolerance = avg_range * 0.001

    for i in range(lookback, len(df) - lookback):
        left_h = highs[i - lookback:i]
        right_h = highs[i + 1:i + lookback + 1]
        if highs[i] >= max(left_h) - tolerance and highs[i] >= max(right_h) - tolerance:
            swings.append({'idx': i, 'price': float(highs[i]), 'type': 'high'})

        left_l = lows[i - lookback:i]
        right_l = lows[i + 1:i + lookback + 1]
        if lows[i] <= min(left_l) + tolerance and lows[i] <= min(right_l) + tolerance:
            swings.append({'idx': i, 'price': float(lows[i]), 'type': 'low'})

    return sorted(swings, key=lambda x: x['idx'])


def detect_bos(swings):
    """Detect BOS from swing sequence. Returns list of BOS events."""
    bos_events = []
    swing_highs = [s for s in swings if s['type'] == 'high']
    swing_lows = [s for s in swings if s['type'] == 'low']

    for i in range(1, len(swing_highs)):
        if swing_highs[i]['price'] > swing_highs[i - 1]['price']:
            bos_events.append({
                'idx': swing_highs[i]['idx'],
                'direction': 'up',
                'level': swing_highs[i - 1]['price'],
                'break_price': swing_highs[i]['price'],
            })

    for i in range(1, len(swing_lows)):
        if swing_lows[i]['price'] < swing_lows[i - 1]['price']:
            bos_events.append({
                'idx': swing_lows[i]['idx'],
                'direction': 'down',
                'level': swing_lows[i - 1]['price'],
                'break_price': swing_lows[i]['price'],
            })

    return sorted(bos_events, key=lambda x: x['idx'])


def detect_order_blocks(df: pd.DataFrame):
    """Detect order blocks."""
    obs = []
    closes = df['close'].values
    highs = df['high'].values
    lows = df['low'].values

    for i in range(20, len(df) - 5):
        down_move = closes[i - 10:i - 5]
        zone = closes[i - 5:i]
        if np.mean(down_move) > np.mean(zone):
            pct = (np.mean(down_move) - np.mean(zone)) / np.mean(down_move)
            if pct > 0.01:
                obs.append({
                    'idx': i, 'type': 'bullish',
                    'high': float(np.max(zone)), 'low': float(np.min(zone)),
                    'strength': min(100, pct * 1000 + 50),
                })

        up_move = closes[i - 10:i - 5]
        zone = closes[i - 5:i]
        if np.mean(up_move) < np.mean(zone):
            pct = (np.mean(zone) - np.mean(up_move)) / np.mean(up_move)
            if pct > 0.01:
                obs.append({
                    'idx': i, 'type': 'bearish',
                    'high': float(np.max(zone)), 'low': float(np.min(zone)),
                    'strength': min(100, pct * 1000 + 50),
                })

    return obs

# ============================================================================
# BACKTEST MODES
# ============================================================================

def backtest_mode_a(df: pd.DataFrame, swings, bos_events):
    """Mode A: BOS only — enter on every BOS in the break direction."""
    trades = []
    closes = df['close'].values
    highs = df['high'].values
    lows = df['low'].values

    for bos in bos_events:
        idx = bos['idx']
        if idx >= len(df) - 5:
            continue

        entry = closes[idx]
        direction = 'LONG' if bos['direction'] == 'up' else 'SHORT'

        if direction == 'LONG':
            sl = entry * 0.985
            tp = entry * 1.03
        else:
            sl = entry * 1.015
            tp = entry * 0.97

        # Simulate forward
        trade = simulate_trade(df, idx, direction, entry, sl, tp)
        if trade:
            trade['mode'] = 'A_BOS_only'
            trades.append(trade)

    return trades


def backtest_mode_b(df: pd.DataFrame, swings, bos_events, order_blocks):
    """Mode B: BOS + OB — enter only when BOS + price in OB zone."""
    trades = []
    closes = df['close'].values

    for bos in bos_events:
        idx = bos['idx']
        if idx >= len(df) - 5:
            continue

        price = closes[idx]
        direction = 'LONG' if bos['direction'] == 'up' else 'SHORT'

        # Find matching OB near the BOS
        ob_match = None
        for ob in order_blocks:
            if abs(ob['idx'] - idx) > 20:
                continue
            if direction == 'LONG' and ob['type'] == 'bullish':
                if price >= ob['low'] * 0.99 and price <= ob['high'] * 1.01:
                    ob_match = ob
                    break
            elif direction == 'SHORT' and ob['type'] == 'bearish':
                if price >= ob['low'] * 0.99 and price <= ob['high'] * 1.01:
                    ob_match = ob
                    break

        if ob_match is None:
            continue

        entry = price
        if direction == 'LONG':
            sl = ob_match['low'] * 0.99
            tp = entry * 1.03
        else:
            sl = ob_match['high'] * 1.01
            tp = entry * 0.97

        trade = simulate_trade(df, idx, direction, entry, sl, tp)
        if trade:
            trade['mode'] = 'B_BOS_OB'
            trade['ob_strength'] = ob_match['strength']
            trades.append(trade)

    return trades


def backtest_mode_c(df: pd.DataFrame, swings, bos_events, order_blocks, scorer):
    """Mode C: BOS + OB + Advanced Order Flow gating."""
    trades = []
    closes = df['close'].values

    for bos in bos_events:
        idx = bos['idx']
        if idx >= len(df) - 5 or idx < 30:
            continue

        price = closes[idx]
        direction = 'LONG' if bos['direction'] == 'up' else 'SHORT'

        # Find matching OB
        ob_match = None
        for ob in order_blocks:
            if abs(ob['idx'] - idx) > 20:
                continue
            if direction == 'LONG' and ob['type'] == 'bullish':
                if price >= ob['low'] * 0.99 and price <= ob['high'] * 1.01:
                    ob_match = ob
                    break
            elif direction == 'SHORT' and ob['type'] == 'bearish':
                if price >= ob['low'] * 0.99 and price <= ob['high'] * 1.01:
                    ob_match = ob
                    break

        if ob_match is None:
            continue

        # Compute order flow score on data up to this point
        lookback_start = max(0, idx - 30)
        df_slice = df.iloc[lookback_start:idx + 1].copy()

        if len(df_slice) < 20:
            continue

        swing_dicts = [
            {'index': s['idx'], 'price': s['price'], 'type': s['type']}
            for s in swings if s['idx'] <= idx
        ]

        dir_arg = 'long' if direction == 'LONG' else 'short'
        of_result = scorer.score(df_slice, direction=dir_arg, swings=swing_dicts, lookback=20)

        if of_result.total_score < ORDER_FLOW_THRESHOLD:
            continue

        entry = price
        if direction == 'LONG':
            sl = ob_match['low'] * 0.99
            tp = entry * 1.03
        else:
            sl = ob_match['high'] * 1.01
            tp = entry * 0.97

        trade = simulate_trade(df, idx, direction, entry, sl, tp)
        if trade:
            trade['mode'] = 'C_BOS_OB_OF'
            trade['ob_strength'] = ob_match['strength']
            trade['of_score'] = of_result.total_score
            trade['of_strength'] = of_result.strength.value
            trade['of_confirmations'] = of_result.confirmations
            trades.append(trade)

    return trades


def simulate_trade(df, entry_idx, direction, entry, sl, tp, max_hold=50):
    """Simulate a trade forward from entry_idx."""
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values

    for i in range(entry_idx + 1, min(entry_idx + max_hold, len(df))):
        if direction == 'LONG':
            if lows[i] <= sl:
                pnl = sl - entry
                return make_trade(df, entry_idx, i, direction, entry, sl, pnl, 'SL')
            if highs[i] >= tp:
                pnl = tp - entry
                return make_trade(df, entry_idx, i, direction, entry, tp, pnl, 'TP')
        else:
            if highs[i] >= sl:
                pnl = entry - sl
                return make_trade(df, entry_idx, i, direction, entry, sl, pnl, 'SL')
            if lows[i] <= tp:
                pnl = entry - tp
                return make_trade(df, entry_idx, i, direction, entry, tp, pnl, 'TP')

    # Time stop
    final_idx = min(entry_idx + max_hold, len(df) - 1)
    close_price = closes[final_idx]
    pnl = (close_price - entry) if direction == 'LONG' else (entry - close_price)
    return make_trade(df, entry_idx, final_idx, direction, entry, close_price, pnl, 'TIME')


def make_trade(df, entry_idx, exit_idx, direction, entry, close_price, pnl, reason):
    """Construct trade dict."""
    risk = abs(entry * 0.015)  # ~1.5% risk approx
    r_multiple = pnl / risk if risk > 0 else 0
    return {
        'entry_idx': entry_idx,
        'exit_idx': exit_idx,
        'entry_time': str(df.index[entry_idx]),
        'exit_time': str(df.index[exit_idx]),
        'direction': direction,
        'entry_price': round(float(entry), 2),
        'close_price': round(float(close_price), 2),
        'pnl': round(float(pnl), 2),
        'pnl_pct': round(float(pnl / entry * 100), 4),
        'r_multiple': round(float(r_multiple), 2),
        'reason': reason,
        'candles_held': exit_idx - entry_idx,
    }

# ============================================================================
# METRICS
# ============================================================================

def compute_metrics(trades, starting_capital=STARTING_CAPITAL):
    """Compute performance metrics from trade list."""
    if not trades:
        return {
            'trades': 0, 'wins': 0, 'losses': 0, 'win_rate': 0,
            'profit_factor': 0, 'total_pnl': 0, 'total_pnl_pct': 0,
            'avg_r': 0, 'max_drawdown_pct': 0, 'expectancy': 0,
            'avg_win': 0, 'avg_loss': 0, 'sharpe': 0,
        }

    wins = [t for t in trades if t['pnl'] > 0]
    losses = [t for t in trades if t['pnl'] <= 0]
    gross_profit = sum(t['pnl'] for t in wins)
    gross_loss = abs(sum(t['pnl'] for t in losses))
    total_pnl = sum(t['pnl'] for t in trades)

    # Equity curve for drawdown
    equity = starting_capital
    peak = equity
    max_dd = 0
    for t in trades:
        equity += t['pnl']
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100
        max_dd = max(max_dd, dd)

    pnl_series = [t['pnl'] for t in trades]
    avg_pnl = np.mean(pnl_series)
    std_pnl = np.std(pnl_series) if len(pnl_series) > 1 else 1
    sharpe = (avg_pnl / std_pnl) * np.sqrt(252) if std_pnl > 0 else 0

    avg_win = np.mean([t['pnl'] for t in wins]) if wins else 0
    avg_loss = np.mean([abs(t['pnl']) for t in losses]) if losses else 0
    wr = len(wins) / len(trades) * 100
    expectancy = (wr / 100 * avg_win) - ((100 - wr) / 100 * avg_loss)

    return {
        'trades': len(trades),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(wr, 1),
        'profit_factor': round(gross_profit / gross_loss, 2) if gross_loss > 0 else float('inf'),
        'total_pnl': round(total_pnl, 2),
        'total_pnl_pct': round(total_pnl / starting_capital * 100, 2),
        'avg_r': round(np.mean([t['r_multiple'] for t in trades]), 2),
        'max_drawdown_pct': round(max_dd, 2),
        'expectancy': round(expectancy, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'sharpe': round(sharpe, 2),
    }

# ============================================================================
# PLOTTING
# ============================================================================

def generate_plots(symbol_name, df, trades_a, trades_b, trades_c, metrics_a, metrics_b, metrics_c):
    """Generate comparison plots using matplotlib."""
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        import matplotlib.dates as mdates
    except ImportError:
        print("  matplotlib not available — skipping plots")
        return

    sym_dir = OUTPUT_DIR / symbol_name
    sym_dir.mkdir(parents=True, exist_ok=True)

    # --- Plot 1: Equity curves comparison ---
    fig, ax = plt.subplots(figsize=(14, 6))
    for trades, label, color in [
        (trades_a, f"A: BOS only ({metrics_a['trades']}t, WR={metrics_a['win_rate']}%)", '#ff6b6b'),
        (trades_b, f"B: BOS+OB ({metrics_b['trades']}t, WR={metrics_b['win_rate']}%)", '#ffa500'),
        (trades_c, f"C: BOS+OB+OF ({metrics_c['trades']}t, WR={metrics_c['win_rate']}%)", '#00cc88'),
    ]:
        equity = [STARTING_CAPITAL]
        for t in trades:
            equity.append(equity[-1] + t['pnl'])
        ax.plot(equity, label=label, color=color, linewidth=1.5)

    ax.set_title(f'{symbol_name} — Equity Curve Comparison', fontsize=14, fontweight='bold')
    ax.set_xlabel('Trade #')
    ax.set_ylabel('Equity ($)')
    ax.legend(loc='upper left', fontsize=9)
    ax.grid(True, alpha=0.3)
    ax.axhline(y=STARTING_CAPITAL, color='gray', linestyle='--', alpha=0.5)
    plt.tight_layout()
    plt.savefig(sym_dir / 'equity_comparison.png', dpi=150)
    plt.close()

    # --- Plot 2: Win rate + PF comparison bar chart ---
    fig, axes = plt.subplots(1, 3, figsize=(14, 5))
    modes = ['A: BOS', 'B: BOS+OB', 'C: BOS+OB+OF']
    colors = ['#ff6b6b', '#ffa500', '#00cc88']

    # Win rate
    wr = [metrics_a['win_rate'], metrics_b['win_rate'], metrics_c['win_rate']]
    axes[0].bar(modes, wr, color=colors)
    axes[0].set_title('Win Rate (%)')
    axes[0].set_ylim(0, 100)
    for i, v in enumerate(wr):
        axes[0].text(i, v + 1, f'{v}%', ha='center', fontsize=10)

    # Profit Factor
    pf = [metrics_a['profit_factor'], metrics_b['profit_factor'], metrics_c['profit_factor']]
    pf_display = [min(p, 20) for p in pf]  # cap for display
    axes[1].bar(modes, pf_display, color=colors)
    axes[1].set_title('Profit Factor')
    for i, v in enumerate(pf):
        label = f'{v:.1f}' if v < 100 else '∞'
        axes[1].text(i, pf_display[i] + 0.2, label, ha='center', fontsize=10)

    # Total PnL
    pnl = [metrics_a['total_pnl'], metrics_b['total_pnl'], metrics_c['total_pnl']]
    bar_colors = ['green' if p > 0 else 'red' for p in pnl]
    axes[2].bar(modes, pnl, color=bar_colors)
    axes[2].set_title('Total PnL ($)')
    for i, v in enumerate(pnl):
        axes[2].text(i, v + abs(v) * 0.05, f'${v:,.0f}', ha='center', fontsize=9)

    plt.suptitle(f'{symbol_name} — Strategy Comparison', fontsize=14, fontweight='bold')
    plt.tight_layout()
    plt.savefig(sym_dir / 'metrics_comparison.png', dpi=150)
    plt.close()

    # --- Plot 3: Price chart with trade markers (Mode C only) ---
    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(16, 10), height_ratios=[3, 1],
                                     sharex=True, gridspec_kw={'hspace': 0.05})

    dates = df.index
    ax1.plot(dates, df['close'], color='#333', linewidth=0.8, alpha=0.7)

    # Mark mode C trades
    for t in trades_c:
        idx = t['entry_idx']
        exit_idx = t['exit_idx']
        if idx < len(dates) and exit_idx < len(dates):
            color = '#00cc88' if t['pnl'] > 0 else '#ff4444'
            marker = '^' if t['direction'] == 'LONG' else 'v'
            ax1.scatter(dates[idx], t['entry_price'], marker=marker, color=color, s=60, zorder=5)
            ax1.scatter(dates[exit_idx], t['close_price'], marker='x', color=color, s=40, zorder=5)

    ax1.set_title(f'{symbol_name} — Mode C Trades (BOS+OB+OrderFlow)', fontsize=13)
    ax1.set_ylabel('Price')
    ax1.grid(True, alpha=0.2)

    # Delta proxy on bottom
    delta = DeltaEngine.calculate_delta(df)
    cvd = delta.cumsum()
    ax2.fill_between(dates, delta, 0, where=delta > 0, color='#00cc88', alpha=0.4, label='Buy delta')
    ax2.fill_between(dates, delta, 0, where=delta < 0, color='#ff4444', alpha=0.4, label='Sell delta')
    ax2_twin = ax2.twinx()
    ax2_twin.plot(dates, cvd, color='#6666ff', linewidth=1, alpha=0.7, label='CVD')
    ax2.set_ylabel('Delta (OHLCV proxy)')
    ax2_twin.set_ylabel('CVD')
    ax2.legend(loc='upper left', fontsize=8)
    ax2_twin.legend(loc='upper right', fontsize=8)
    ax2.grid(True, alpha=0.2)

    plt.tight_layout()
    plt.savefig(sym_dir / 'price_trades_orderflow.png', dpi=150)
    plt.close()

    print(f"  Plots saved to {sym_dir}")

# ============================================================================
# MAIN
# ============================================================================

def run_backtest_for_symbol(symbol_name, config):
    """Run all 3 backtest modes for one symbol."""
    print(f"\n{'='*60}")
    print(f"BACKTESTING: {symbol_name} ({config['timeframe']})")
    print(f"{'='*60}")

    df = fetch_ohlcv(config['ccxt'], config['timeframe'], config['candles'])

    # Detect structure
    print("  Detecting market structure...")
    swings = detect_swings(df, lookback=5)
    bos_events = detect_bos(swings)
    order_blocks = detect_order_blocks(df)
    print(f"  Found: {len(swings)} swings, {len(bos_events)} BOS, {len(order_blocks)} OBs")

    # Mode A: BOS only
    print("  Running Mode A: BOS only...")
    trades_a = backtest_mode_a(df, swings, bos_events)
    metrics_a = compute_metrics(trades_a)
    print(f"    → {metrics_a['trades']} trades, WR={metrics_a['win_rate']}%, PF={metrics_a['profit_factor']}")

    # Mode B: BOS + OB
    print("  Running Mode B: BOS + OB...")
    trades_b = backtest_mode_b(df, swings, bos_events, order_blocks)
    metrics_b = compute_metrics(trades_b)
    print(f"    → {metrics_b['trades']} trades, WR={metrics_b['win_rate']}%, PF={metrics_b['profit_factor']}")

    # Mode C: BOS + OB + Order Flow
    print(f"  Running Mode C: BOS + OB + OrderFlow (threshold={ORDER_FLOW_THRESHOLD})...")
    scorer = OrderFlowScorer()
    trades_c = backtest_mode_c(df, swings, bos_events, order_blocks, scorer)
    metrics_c = compute_metrics(trades_c)
    print(f"    → {metrics_c['trades']} trades, WR={metrics_c['win_rate']}%, PF={metrics_c['profit_factor']}")

    # Generate plots
    print("  Generating plots...")
    generate_plots(symbol_name, df, trades_a, trades_b, trades_c, metrics_a, metrics_b, metrics_c)

    # Save results
    sym_dir = OUTPUT_DIR / symbol_name
    sym_dir.mkdir(parents=True, exist_ok=True)

    result = {
        'symbol': symbol_name,
        'timeframe': config['timeframe'],
        'candles': len(df),
        'date_range': f"{df.index[0]} → {df.index[-1]}",
        'structure': {
            'swings': len(swings),
            'bos_events': len(bos_events),
            'order_blocks': len(order_blocks),
        },
        'mode_A_BOS_only': {**metrics_a, 'trade_count': len(trades_a)},
        'mode_B_BOS_OB': {**metrics_b, 'trade_count': len(trades_b)},
        'mode_C_BOS_OB_OF': {**metrics_c, 'trade_count': len(trades_c)},
        'order_flow_threshold': ORDER_FLOW_THRESHOLD,
        'data_type': 'OHLCV_PROXY',
        'generated_at': datetime.now().isoformat(),
    }

    with open(sym_dir / 'comparison_results.json', 'w') as f:
        json.dump(result, f, indent=2)

    # Save trade logs
    for mode, trades in [('A', trades_a), ('B', trades_b), ('C', trades_c)]:
        with open(sym_dir / f'trades_mode_{mode}.json', 'w') as f:
            json.dump(trades, f, indent=2, default=str)

    return result


def main():
    print("=" * 70)
    print("GodsView — Comparison Backtest: BOS vs BOS+OB vs BOS+OB+OrderFlow")
    print("All order flow data is OHLCV PROXY — not real order book")
    print("=" * 70)

    all_results = {}
    for sym_name, config in SYMBOLS.items():
        try:
            result = run_backtest_for_symbol(sym_name, config)
            all_results[sym_name] = result
        except Exception as e:
            print(f"  ERROR on {sym_name}: {e}")
            import traceback
            traceback.print_exc()
            all_results[sym_name] = {'error': str(e)}

    # Save master summary
    with open(OUTPUT_DIR / 'comparison_summary.json', 'w') as f:
        json.dump(all_results, f, indent=2, default=str)

    # Print summary table
    print("\n" + "=" * 90)
    print("COMPARISON SUMMARY")
    print("=" * 90)
    print(f"{'Symbol':<10} {'Mode':<18} {'Trades':>7} {'WR%':>7} {'PF':>7} {'PnL':>12} {'MaxDD%':>8} {'Sharpe':>7}")
    print("-" * 90)

    for sym, res in all_results.items():
        if 'error' in res:
            print(f"{sym:<10} ERROR: {res['error']}")
            continue
        for mode_key, label in [
            ('mode_A_BOS_only', 'A: BOS'),
            ('mode_B_BOS_OB', 'B: BOS+OB'),
            ('mode_C_BOS_OB_OF', 'C: BOS+OB+OF'),
        ]:
            m = res[mode_key]
            pf_str = f"{m['profit_factor']:.1f}" if m['profit_factor'] < 100 else "∞"
            print(f"{sym:<10} {label:<18} {m['trades']:>7} {m['win_rate']:>6.1f}% {pf_str:>7} "
                  f"${m['total_pnl']:>10,.0f} {m['max_drawdown_pct']:>7.1f}% {m['sharpe']:>7.1f}")
        print("-" * 90)

    print(f"\nResults saved to: {OUTPUT_DIR}")
    print("Done.")


if __name__ == '__main__':
    main()
