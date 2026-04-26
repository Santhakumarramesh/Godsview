#!/usr/bin/env python3
"""
GodsView — BOS Debug & Fix Script
===================================
1. Fetches real OHLCV data from Kraken
2. Runs OLD swing/BOS logic → shows why it fails
3. Runs NEW fixed logic → shows correct detections
4. Generates visual proof plots
5. Outputs detailed logs for each candle
"""

import ccxt
import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.patches import Rectangle
from dataclasses import dataclass
from typing import List, Dict, Any, Optional
from datetime import datetime
import os
import json

# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class Swing:
    timestamp: int
    price: float
    type: str      # 'high' or 'low'
    index: int     # candle index in dataframe
    strength: float = 0.0  # 0-100

@dataclass
class BOSEvent:
    timestamp: int
    direction: str    # 'bullish' or 'bearish'
    type: str         # 'bos' or 'choch'
    level: float      # the level that was broken
    break_price: float  # the price that broke it
    strength: float   # 0-100
    candle_idx: int

# ============================================================================
# OLD LOGIC (what's broken)
# ============================================================================

def old_detect_swings(df: pd.DataFrame, lookback: int = 10) -> List[Swing]:
    """Original swing detection — lookback=10, too strict."""
    swings = []
    highs = df['high'].values
    lows = df['low'].values

    for i in range(lookback, len(df) - lookback):
        if highs[i] == max(highs[i-lookback:i+lookback+1]):
            swings.append(Swing(
                timestamp=int(df.index[i].timestamp()) if hasattr(df.index[i], 'timestamp') else i,
                price=float(highs[i]),
                type='high',
                index=i
            ))
        if lows[i] == min(lows[i-lookback:i+lookback+1]):
            swings.append(Swing(
                timestamp=int(df.index[i].timestamp()) if hasattr(df.index[i], 'timestamp') else i,
                price=float(lows[i]),
                type='low',
                index=i
            ))

    return sorted(swings, key=lambda x: x.index)


def old_detect_bos(swings: List[Swing]) -> Dict[str, Any]:
    """Original BOS logic — only last 3 swings, strict alternation."""
    if len(swings) < 3:
        return {'bos': None, 'choch': None}

    result = {'bos': None, 'choch': None}
    recent = swings[-3:]
    s1, s2, s3 = recent

    if s1.type == 'low' and s2.type == 'high' and s3.type == 'low':
        if s3.price < s1.price:
            result['bos'] = {'direction': 'down', 'level': s1.price}
    elif s1.type == 'high' and s2.type == 'low' and s3.type == 'high':
        if s3.price > s1.price:
            result['bos'] = {'direction': 'up', 'level': s1.price}

    return result


# ============================================================================
# NEW FIXED LOGIC
# ============================================================================

def new_detect_swings(df: pd.DataFrame, lookback: int = 5) -> List[Swing]:
    """
    Improved swing detection:
    - lookback=5 (not 10) — finds more swings
    - Uses fractional scoring for strength
    - Handles equal highs/lows with small tolerance
    """
    swings = []
    highs = df['high'].values
    lows = df['low'].values
    closes = df['close'].values
    volumes = df['volume'].values

    if len(df) < lookback * 2 + 1:
        return swings

    avg_range = np.mean(highs - lows)
    tolerance = avg_range * 0.001  # 0.1% tolerance for equal levels

    for i in range(lookback, len(df) - lookback):
        left_highs = highs[i-lookback:i]
        right_highs = highs[i+1:i+lookback+1]

        # Swing high: current high >= all neighbors (with tolerance)
        is_swing_high = (highs[i] >= max(left_highs) - tolerance and
                         highs[i] >= max(right_highs) - tolerance)

        if is_swing_high:
            # Strength: how much higher than neighbors + volume confirmation
            height_above = (highs[i] - max(min(left_highs), min(right_highs))) / avg_range
            vol_ratio = volumes[i] / (np.mean(volumes[i-lookback:i+lookback+1]) + 1)
            strength = min(100, height_above * 30 + vol_ratio * 20 + 30)

            swings.append(Swing(
                timestamp=int(df.index[i].timestamp()) if hasattr(df.index[i], 'timestamp') else i,
                price=float(highs[i]),
                type='high',
                index=i,
                strength=strength
            ))

        left_lows = lows[i-lookback:i]
        right_lows = lows[i+1:i+lookback+1]

        # Swing low: current low <= all neighbors (with tolerance)
        is_swing_low = (lows[i] <= min(left_lows) + tolerance and
                        lows[i] <= min(right_lows) + tolerance)

        if is_swing_low:
            depth_below = (min(max(left_lows), max(right_lows)) - lows[i]) / avg_range
            vol_ratio = volumes[i] / (np.mean(volumes[i-lookback:i+lookback+1]) + 1)
            strength = min(100, depth_below * 30 + vol_ratio * 20 + 30)

            swings.append(Swing(
                timestamp=int(df.index[i].timestamp()) if hasattr(df.index[i], 'timestamp') else i,
                price=float(lows[i]),
                type='low',
                index=i,
                strength=strength
            ))

    return sorted(swings, key=lambda x: x.index)


def new_detect_bos(swings: List[Swing], df: pd.DataFrame) -> List[BOSEvent]:
    """
    Improved BOS detection:
    - Scans ALL swing pairs (not just last 3)
    - Detects both BOS (continuation) and CHOCH (reversal)
    - Uses CLOSE price for confirmation (not just high/low)
    - Returns strength score
    - Handles non-alternating swing sequences
    """
    events = []
    closes = df['close'].values
    highs = df['high'].values
    lows = df['low'].values
    volumes = df['volume'].values
    avg_vol = np.mean(volumes) if len(volumes) > 0 else 1
    avg_range = np.mean(highs - lows) if len(highs) > 0 else 1

    if len(swings) < 2:
        return events

    # Track trend direction
    # Start by looking at first two different-type swings
    trend = None  # 'up' or 'down'

    # Build swing high/low sequences separately
    swing_highs = [s for s in swings if s.type == 'high']
    swing_lows = [s for s in swings if s.type == 'low']

    # Check for BOS on swing highs (bullish BOS = higher high)
    for i in range(1, len(swing_highs)):
        prev_sh = swing_highs[i-1]
        curr_sh = swing_highs[i]

        # Find candles between prev_sh and curr_sh that CLOSE above prev_sh level
        for j in range(prev_sh.index + 1, min(curr_sh.index + 1, len(df))):
            if closes[j] > prev_sh.price:
                # Bullish BOS: close broke above previous swing high
                distance = (closes[j] - prev_sh.price) / avg_range
                vol_confirmation = volumes[j] / avg_vol if avg_vol > 0 else 1
                body_size = abs(closes[j] - df['open'].values[j]) / avg_range

                strength = min(100, distance * 25 + vol_confirmation * 25 + body_size * 25 + 25)

                # Is this BOS (continuation) or CHOCH (reversal)?
                event_type = 'bos' if trend == 'up' or trend is None else 'choch'

                events.append(BOSEvent(
                    timestamp=int(df.index[j].timestamp()) if hasattr(df.index[j], 'timestamp') else j,
                    direction='bullish',
                    type=event_type,
                    level=prev_sh.price,
                    break_price=closes[j],
                    strength=strength,
                    candle_idx=j
                ))
                trend = 'up'
                break  # Only first break counts

    # Check for BOS on swing lows (bearish BOS = lower low)
    for i in range(1, len(swing_lows)):
        prev_sl = swing_lows[i-1]
        curr_sl = swing_lows[i]

        for j in range(prev_sl.index + 1, min(curr_sl.index + 1, len(df))):
            if closes[j] < prev_sl.price:
                distance = (prev_sl.price - closes[j]) / avg_range
                vol_confirmation = volumes[j] / avg_vol if avg_vol > 0 else 1
                body_size = abs(closes[j] - df['open'].values[j]) / avg_range

                strength = min(100, distance * 25 + vol_confirmation * 25 + body_size * 25 + 25)

                event_type = 'bos' if trend == 'down' or trend is None else 'choch'

                events.append(BOSEvent(
                    timestamp=int(df.index[j].timestamp()) if hasattr(df.index[j], 'timestamp') else j,
                    direction='bearish',
                    type=event_type,
                    level=prev_sl.price,
                    break_price=closes[j],
                    strength=strength,
                    candle_idx=j
                ))
                trend = 'down'
                break

    # Also check CURRENT candle against most recent swing levels
    # This is critical for live trading — is the latest candle a BOS?
    if len(df) > 0:
        last_close = closes[-1]
        last_idx = len(df) - 1

        # Check against most recent swing high
        if swing_highs:
            latest_sh = swing_highs[-1]
            if last_close > latest_sh.price and last_idx > latest_sh.index:
                # Check we haven't already recorded this
                already = any(e.candle_idx == last_idx and e.direction == 'bullish' for e in events)
                if not already:
                    distance = (last_close - latest_sh.price) / avg_range
                    strength = min(100, distance * 30 + 40)
                    events.append(BOSEvent(
                        timestamp=int(df.index[-1].timestamp()) if hasattr(df.index[-1], 'timestamp') else last_idx,
                        direction='bullish',
                        type='bos' if trend == 'up' else 'choch',
                        level=latest_sh.price,
                        break_price=last_close,
                        strength=strength,
                        candle_idx=last_idx
                    ))

        # Check against most recent swing low
        if swing_lows:
            latest_sl = swing_lows[-1]
            if last_close < latest_sl.price and last_idx > latest_sl.index:
                already = any(e.candle_idx == last_idx and e.direction == 'bearish' for e in events)
                if not already:
                    distance = (latest_sl.price - last_close) / avg_range
                    strength = min(100, distance * 30 + 40)
                    events.append(BOSEvent(
                        timestamp=int(df.index[-1].timestamp()) if hasattr(df.index[-1], 'timestamp') else last_idx,
                        direction='bearish',
                        type='bos' if trend == 'down' else 'choch',
                        level=latest_sl.price,
                        break_price=last_close,
                        strength=strength,
                        candle_idx=last_idx
                    ))

    # Sort by candle index
    events.sort(key=lambda x: x.candle_idx)
    return events


# ============================================================================
# VISUAL VALIDATION
# ============================================================================

def plot_bos_comparison(df, symbol, timeframe, old_swings, old_bos, new_swings, new_bos_events, save_dir):
    """Generate side-by-side comparison plot."""
    os.makedirs(save_dir, exist_ok=True)

    fig, axes = plt.subplots(2, 1, figsize=(20, 16), sharex=True)
    fig.suptitle(f'{symbol} {timeframe} — BOS Debug Comparison', fontsize=16, fontweight='bold')

    for ax_idx, (ax, title, swings, bos_data, is_new) in enumerate([
        (axes[0], 'OLD Logic (lookback=10, strict alternation)', old_swings, old_bos, False),
        (axes[1], 'NEW Logic (lookback=5, flexible BOS)', new_swings, new_bos_events, True),
    ]):
        ax.set_title(title, fontsize=13, pad=10)
        ax.set_facecolor('#1a1a2e')

        # Plot candlesticks
        for i in range(len(df)):
            o, h, l, c = df['open'].iloc[i], df['high'].iloc[i], df['low'].iloc[i], df['close'].iloc[i]
            color = '#00d4aa' if c >= o else '#ff4757'
            ax.plot([i, i], [l, h], color=color, linewidth=0.8)
            ax.plot([i, i], [min(o,c), max(o,c)], color=color, linewidth=3)

        # Plot swing points
        sh_count = 0
        sl_count = 0
        for s in swings:
            if s.index < len(df):
                if s.type == 'high':
                    ax.plot(s.index, s.price, 'v', color='#00bfff', markersize=10, zorder=5)
                    sh_count += 1
                else:
                    ax.plot(s.index, s.price, '^', color='#ffa500', markersize=10, zorder=5)
                    sl_count += 1

        # Plot BOS events
        bos_count = 0
        if is_new:
            for event in bos_data:
                if event.candle_idx < len(df):
                    color = '#00ff88' if event.direction == 'bullish' else '#ff3366'
                    marker = '▲' if event.direction == 'bullish' else '▼'
                    y_offset = df['high'].iloc[event.candle_idx] * 1.002 if event.direction == 'bullish' else df['low'].iloc[event.candle_idx] * 0.998

                    ax.annotate(f'{event.type.upper()}\n{event.strength:.0f}%',
                               xy=(event.candle_idx, y_offset),
                               fontsize=8, color=color, fontweight='bold',
                               ha='center', va='bottom' if event.direction == 'bullish' else 'top')

                    # Draw horizontal line at broken level
                    ax.axhline(y=event.level, color=color, linestyle='--', alpha=0.4, linewidth=0.8)
                    bos_count += 1
        else:
            # Old BOS — just show the single result
            if bos_data.get('bos') and bos_data['bos'].get('direction'):
                color = '#00ff88' if bos_data['bos']['direction'] == 'up' else '#ff3366'
                level = bos_data['bos'].get('level', 0)
                ax.axhline(y=level, color=color, linestyle='--', alpha=0.6, linewidth=1.5,
                          label=f"BOS {bos_data['bos']['direction']} @ {level:.2f}")
                ax.legend(loc='upper left', fontsize=9)
                bos_count = 1
            else:
                ax.text(len(df)//2, df['close'].mean(), 'NO BOS DETECTED',
                       fontsize=20, color='#ff4757', alpha=0.5, ha='center', va='center',
                       fontweight='bold')

        # Stats
        stats_text = f'Swings: {sh_count}H / {sl_count}L | BOS events: {bos_count}'
        ax.text(0.02, 0.95, stats_text, transform=ax.transAxes,
               fontsize=10, color='white', verticalalignment='top',
               bbox=dict(boxstyle='round', facecolor='#16213e', alpha=0.8))

        ax.set_ylabel('Price', color='white')
        ax.tick_params(colors='white')
        ax.grid(alpha=0.1, color='white')

    axes[1].set_xlabel('Candle Index', color='white')
    fig.patch.set_facecolor('#0f0f23')

    filename = f'{save_dir}/{symbol.replace("/","_")}_{timeframe}_bos_debug.png'
    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#0f0f23')
    plt.close()
    print(f"  📊 Saved: {filename}")
    return filename


def plot_bos_detail(df, symbol, timeframe, new_swings, new_bos_events, save_dir):
    """Detailed plot of NEW logic only, with candle-by-candle annotations."""
    os.makedirs(save_dir, exist_ok=True)

    fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(20, 12),
                                     gridspec_kw={'height_ratios': [3, 1]}, sharex=True)
    fig.suptitle(f'{symbol} {timeframe} — Fixed BOS Detection Detail', fontsize=16, fontweight='bold')

    ax1.set_facecolor('#1a1a2e')
    ax2.set_facecolor('#1a1a2e')

    # Candlesticks
    for i in range(len(df)):
        o, h, l, c = df['open'].iloc[i], df['high'].iloc[i], df['low'].iloc[i], df['close'].iloc[i]
        color = '#00d4aa' if c >= o else '#ff4757'
        ax1.plot([i, i], [l, h], color=color, linewidth=0.8)
        ax1.plot([i, i], [min(o,c), max(o,c)], color=color, linewidth=3)

    # Swings with connecting lines
    swing_highs = [s for s in new_swings if s.type == 'high']
    swing_lows = [s for s in new_swings if s.type == 'low']

    if swing_highs:
        ax1.plot([s.index for s in swing_highs], [s.price for s in swing_highs],
                'o--', color='#00bfff', alpha=0.6, markersize=8, label='Swing Highs')
    if swing_lows:
        ax1.plot([s.index for s in swing_lows], [s.price for s in swing_lows],
                'o--', color='#ffa500', alpha=0.6, markersize=8, label='Swing Lows')

    # BOS events
    for event in new_bos_events:
        if event.candle_idx < len(df):
            color = '#00ff88' if event.direction == 'bullish' else '#ff3366'

            # Arrow marker
            y_pos = df['high'].iloc[event.candle_idx] if event.direction == 'bullish' else df['low'].iloc[event.candle_idx]
            ax1.annotate(
                f'{event.type.upper()} ({event.strength:.0f}%)',
                xy=(event.candle_idx, y_pos),
                xytext=(event.candle_idx, y_pos * (1.01 if event.direction == 'bullish' else 0.99)),
                fontsize=9, color=color, fontweight='bold',
                ha='center',
                arrowprops=dict(arrowstyle='->', color=color, lw=2)
            )

            # Level line
            ax1.axhline(y=event.level, color=color, linestyle=':', alpha=0.3)

    ax1.legend(loc='upper left', fontsize=9)
    ax1.set_ylabel('Price', color='white')
    ax1.tick_params(colors='white')
    ax1.grid(alpha=0.1, color='white')

    # Volume subplot
    colors = ['#00d4aa' if df['close'].iloc[i] >= df['open'].iloc[i] else '#ff4757'
              for i in range(len(df))]
    ax2.bar(range(len(df)), df['volume'].values, color=colors, alpha=0.7)
    ax2.set_ylabel('Volume', color='white')
    ax2.set_xlabel('Candle Index', color='white')
    ax2.tick_params(colors='white')
    ax2.grid(alpha=0.1, color='white')

    fig.patch.set_facecolor('#0f0f23')

    filename = f'{save_dir}/{symbol.replace("/","_")}_{timeframe}_bos_fixed.png'
    plt.tight_layout()
    plt.savefig(filename, dpi=150, bbox_inches='tight', facecolor='#0f0f23')
    plt.close()
    print(f"  📊 Saved: {filename}")
    return filename


# ============================================================================
# MAIN DEBUG RUNNER
# ============================================================================

def run_debug():
    print("=" * 70)
    print("  GodsView BOS Debug & Fix Validation")
    print("=" * 70)

    exchange = ccxt.kraken()

    test_cases = [
        ("BTC/USD", "1h", 200),
        ("BTC/USD", "4h", 100),
        ("ETH/USD", "1h", 200),
        ("ETH/USD", "4h", 100),
        ("SOL/USD", "1h", 200),
        ("SOL/USD", "4h", 100),
    ]

    base_dir = os.path.dirname(os.path.abspath(__file__))
    save_dir = os.path.join(os.path.dirname(base_dir), 'docs', 'debug', 'bos')
    os.makedirs(save_dir, exist_ok=True)

    all_results = {}

    for symbol, timeframe, limit in test_cases:
        print(f"\n{'─'*60}")
        print(f"  {symbol} {timeframe} (last {limit} candles)")
        print(f"{'─'*60}")

        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
            df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df.set_index('timestamp', inplace=True)
        except Exception as e:
            print(f"  ✗ Failed to fetch data: {e}")
            continue

        price = df['close'].iloc[-1]
        print(f"  Current price: ${price:,.2f}")
        print(f"  Data range: {df.index[0]} → {df.index[-1]}")

        # ──── OLD LOGIC ────
        print(f"\n  ── OLD LOGIC (lookback=10) ──")
        old_swings = old_detect_swings(df, lookback=10)
        old_sh = [s for s in old_swings if s.type == 'high']
        old_sl = [s for s in old_swings if s.type == 'low']
        print(f"  Swing highs: {len(old_sh)}")
        print(f"  Swing lows:  {len(old_sl)}")

        old_bos = old_detect_bos(old_swings)
        bos_dir = old_bos.get('bos', {})
        if bos_dir and bos_dir.get('direction'):
            print(f"  BOS: {bos_dir['direction']} @ {bos_dir.get('level', 0):.2f}")
        else:
            print(f"  BOS: ❌ NONE DETECTED")
            # Explain why
            if len(old_swings) < 3:
                print(f"    Reason: Only {len(old_swings)} swings found (need 3)")
            elif len(old_swings) >= 3:
                last3 = old_swings[-3:]
                pattern = [s.type for s in last3]
                print(f"    Reason: Last 3 swings = {pattern}")
                if pattern == ['low', 'high', 'low']:
                    print(f"    s1.low={last3[0].price:.2f}, s3.low={last3[2].price:.2f}")
                    print(f"    s3 > s1 → no lower low → no bearish BOS")
                elif pattern == ['high', 'low', 'high']:
                    print(f"    s1.high={last3[0].price:.2f}, s3.high={last3[2].price:.2f}")
                    print(f"    s3 < s1 → no higher high → no bullish BOS")
                else:
                    print(f"    Pattern doesn't match [L,H,L] or [H,L,H] → BOS impossible")

        # ──── NEW LOGIC ────
        print(f"\n  ── NEW LOGIC (lookback=5, flexible) ──")
        new_swings = new_detect_swings(df, lookback=5)
        new_sh = [s for s in new_swings if s.type == 'high']
        new_sl = [s for s in new_swings if s.type == 'low']
        print(f"  Swing highs: {len(new_sh)} (was {len(old_sh)})")
        print(f"  Swing lows:  {len(new_sl)} (was {len(old_sl)})")

        new_bos = new_detect_bos(new_swings, df)
        print(f"  BOS events:  {len(new_bos)} (was {'1' if old_bos.get('bos') and old_bos['bos'].get('direction') else '0'})")

        bullish_bos = [e for e in new_bos if e.direction == 'bullish']
        bearish_bos = [e for e in new_bos if e.direction == 'bearish']
        print(f"    Bullish: {len(bullish_bos)}")
        print(f"    Bearish: {len(bearish_bos)}")

        if new_bos:
            print(f"\n  ── BOS EVENT LOG ──")
            for i, event in enumerate(new_bos[-5:], 1):  # Last 5
                ts = df.index[event.candle_idx] if event.candle_idx < len(df) else "?"
                print(f"    [{i}] {ts}")
                print(f"        {event.direction} {event.type.upper()} | "
                      f"Level: ${event.level:,.2f} → Broke: ${event.break_price:,.2f} | "
                      f"Strength: {event.strength:.0f}%")

        # Most recent BOS for signal generation
        latest_bos = new_bos[-1] if new_bos else None
        if latest_bos:
            print(f"\n  ✅ LATEST BOS: {latest_bos.direction} {latest_bos.type.upper()} "
                  f"@ candle {latest_bos.candle_idx} | Strength: {latest_bos.strength:.0f}%")
        else:
            print(f"\n  ⚠ No BOS events at all (even with fixed logic)")

        # ──── GENERATE PLOTS ────
        sym_dir = os.path.join(save_dir, symbol.replace('/', '_'))

        plot_bos_comparison(df, symbol, timeframe, old_swings, old_bos, new_swings, new_bos, sym_dir)
        plot_bos_detail(df, symbol, timeframe, new_swings, new_bos, sym_dir)

        all_results[f"{symbol}_{timeframe}"] = {
            'symbol': symbol,
            'timeframe': timeframe,
            'price': price,
            'old_swing_highs': len(old_sh),
            'old_swing_lows': len(old_sl),
            'old_bos': bool(old_bos.get('bos') and old_bos['bos'].get('direction')),
            'new_swing_highs': len(new_sh),
            'new_swing_lows': len(new_sl),
            'new_bos_count': len(new_bos),
            'new_bullish_bos': len(bullish_bos),
            'new_bearish_bos': len(bearish_bos),
            'latest_bos': {
                'direction': latest_bos.direction,
                'type': latest_bos.type,
                'strength': latest_bos.strength,
                'level': latest_bos.level,
                'break_price': latest_bos.break_price
            } if latest_bos else None
        }

    # ──── SUMMARY ────
    print(f"\n{'='*70}")
    print(f"  SUMMARY — OLD vs NEW")
    print(f"{'='*70}")
    print(f"  {'Symbol/TF':<18} {'Old Swings':>12} {'Old BOS':>10} {'New Swings':>12} {'New BOS':>10}")
    print(f"  {'─'*62}")

    for key, r in all_results.items():
        old_s = f"{r['old_swing_highs']}H/{r['old_swing_lows']}L"
        new_s = f"{r['new_swing_highs']}H/{r['new_swing_lows']}L"
        old_b = "✅" if r['old_bos'] else "❌"
        new_b = f"✅ {r['new_bos_count']}" if r['new_bos_count'] > 0 else "❌"
        print(f"  {key:<18} {old_s:>12} {old_b:>10} {new_s:>12} {new_b:>10}")

    # Save results JSON
    results_file = os.path.join(save_dir, 'bos_debug_results.json')
    with open(results_file, 'w') as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"\n  📄 Results saved: {results_file}")

    print(f"\n{'='*70}")
    print(f"  VERDICT")
    print(f"{'='*70}")
    old_total_bos = sum(1 for r in all_results.values() if r['old_bos'])
    new_total_bos = sum(r['new_bos_count'] for r in all_results.values())
    print(f"  Old logic: {old_total_bos}/{len(all_results)} symbols had BOS")
    print(f"  New logic: {new_total_bos} total BOS events across all symbols")

    if new_total_bos > old_total_bos:
        print(f"  ✅ NEW logic detects {new_total_bos - old_total_bos} more BOS events")
        print(f"  ✅ Ready to integrate into signal engine")
    else:
        print(f"  ⚠ Check data — may need further tuning")

    return all_results


if __name__ == '__main__':
    run_debug()
