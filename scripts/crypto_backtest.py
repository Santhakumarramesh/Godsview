#!/usr/bin/env python3
"""
GodsView Crypto Backtest Engine
================================
Historical backtesting for BTCUSD, ETHUSD, SOLUSD with:
- Market structure (swing highs/lows, BOS, CHOCH)
- Order block detection (bullish/bearish)
- OHLCV-based order flow proxy (delta, CVD, absorption, imbalance)
- 3 strategies: OB Retest Long, OB Retest Short, Breakout+Retest
- Full trade simulation with slippage/fees
- Plot generation: candlestick+OB, order flow, equity, distribution

IMPORTANT: Order flow is OHLCV-PROXY based, NOT real order book data.
"""

import os, sys, json, time, math
from datetime import datetime, timezone, timedelta
from pathlib import Path
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.patches as mpatches
from matplotlib.gridspec import GridSpec

# ── Configuration ──────────────────────────────────────────────

SYMBOLS = {
    "BTCUSD": "BTC/USD",
    "ETHUSD": "ETH/USD",
    "SOLUSD": "SOL/USD",
}

EXCHANGE_ID = "kraken"  # Kraken works from US EC2 (Binance geo-blocked)

TIMEFRAMES = {
    "5m":  {"days": 60,   "limit": 1000},
    "15m": {"days": 90,   "limit": 1000},
    "1h":  {"days": 365,  "limit": 1000},
    "4h":  {"days": 730,  "limit": 1000},
}

FEES_PCT = 0.001        # 0.1% per trade (taker)
SLIPPAGE_PCT = 0.0005   # 0.05% slippage
INITIAL_CAPITAL = 100000
RISK_PER_TRADE = 0.01   # 1% risk per trade

BASE_DIR = Path("/home/ubuntu/Godsview/docs/backtests")

# ── 1. DATA FETCHING ──────────────────────────────────────────

def fetch_ohlcv(symbol_ccxt, timeframe, days, limit=1000):
    """Fetch historical OHLCV from Kraken via CCXT (US-accessible)"""
    import ccxt
    exchange = getattr(ccxt, EXCHANGE_ID)({"enableRateLimit": True})

    since_ms = int((datetime.now(timezone.utc) - timedelta(days=days)).timestamp() * 1000)
    all_data = []

    retries = 0
    max_retries = 5
    while True:
        try:
            batch = exchange.fetch_ohlcv(symbol_ccxt, timeframe, since=since_ms, limit=limit)
            retries = 0  # reset on success
        except Exception as e:
            retries += 1
            print(f"  Fetch error ({retries}/{max_retries}): {e}")
            if retries >= max_retries:
                print(f"  Max retries reached, returning what we have ({len(all_data)} candles)")
                break
            time.sleep(3)
            continue

        if not batch:
            break
        all_data.extend(batch)
        since_ms = batch[-1][0] + 1
        if len(batch) < limit:
            break
        time.sleep(exchange.rateLimit / 1000)

    if not all_data:
        return pd.DataFrame()

    df = pd.DataFrame(all_data, columns=["timestamp", "open", "high", "low", "close", "volume"])
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df = df.drop_duplicates(subset=["timestamp"]).sort_values("timestamp").reset_index(drop=True)
    return df


# ── 2. MARKET STRUCTURE ──────────────────────────────────────

def detect_swing_points(df, lookback=5):
    """Detect swing highs and swing lows"""
    highs = df["high"].values
    lows = df["low"].values
    n = len(df)
    swing_highs = []
    swing_lows = []

    for i in range(lookback, n - lookback):
        if all(highs[i] >= highs[i-j] for j in range(1, lookback+1)) and \
           all(highs[i] >= highs[i+j] for j in range(1, lookback+1)):
            swing_highs.append({"idx": i, "price": highs[i], "time": df["timestamp"].iloc[i]})

        if all(lows[i] <= lows[i-j] for j in range(1, lookback+1)) and \
           all(lows[i] <= lows[i+j] for j in range(1, lookback+1)):
            swing_lows.append({"idx": i, "price": lows[i], "time": df["timestamp"].iloc[i]})

    return swing_highs, swing_lows


def detect_bos_choch(swing_highs, swing_lows, df):
    """Detect Break of Structure and Change of Character"""
    events = []

    # Track trend: sequence of higher highs / lower lows
    all_swings = []
    for sh in swing_highs:
        all_swings.append({**sh, "type": "high"})
    for sl in swing_lows:
        all_swings.append({**sl, "type": "low"})
    all_swings.sort(key=lambda x: x["idx"])

    if len(all_swings) < 4:
        return events

    prev_high = None
    prev_low = None
    trend = "neutral"  # "up", "down", "neutral"

    for sw in all_swings:
        if sw["type"] == "high":
            if prev_high is not None:
                if sw["price"] > prev_high["price"]:
                    if trend == "down":
                        events.append({
                            "idx": sw["idx"], "price": sw["price"],
                            "time": sw["time"], "type": "CHOCH",
                            "direction": "bullish", "confidence": 0.7
                        })
                    else:
                        events.append({
                            "idx": sw["idx"], "price": sw["price"],
                            "time": sw["time"], "type": "BOS",
                            "direction": "bullish", "confidence": 0.6
                        })
                    trend = "up"
                elif sw["price"] < prev_high["price"] and trend == "up":
                    events.append({
                        "idx": sw["idx"], "price": sw["price"],
                        "time": sw["time"], "type": "CHOCH",
                        "direction": "bearish", "confidence": 0.7
                    })
                    trend = "down"
            prev_high = sw
        else:
            if prev_low is not None:
                if sw["price"] < prev_low["price"]:
                    if trend == "up":
                        events.append({
                            "idx": sw["idx"], "price": sw["price"],
                            "time": sw["time"], "type": "CHOCH",
                            "direction": "bearish", "confidence": 0.7
                        })
                    else:
                        events.append({
                            "idx": sw["idx"], "price": sw["price"],
                            "time": sw["time"], "type": "BOS",
                            "direction": "bearish", "confidence": 0.6
                        })
                    trend = "down"
            prev_low = sw

    return events


def detect_liquidity_sweeps(df, swing_highs, swing_lows, threshold=0.002):
    """Detect liquidity sweeps (price spikes beyond swing points then reverses)"""
    sweeps = []

    for sh in swing_highs:
        idx = sh["idx"]
        price = sh["price"]
        # Look for candles after this high that spike above then close below
        for j in range(idx + 1, min(idx + 20, len(df))):
            if df["high"].iloc[j] > price * (1 + threshold) and df["close"].iloc[j] < price:
                sweeps.append({
                    "idx": j, "price": df["high"].iloc[j],
                    "time": df["timestamp"].iloc[j],
                    "type": "sweep_high", "level": price,
                    "confidence": 0.65
                })
                break

    for sl in swing_lows:
        idx = sl["idx"]
        price = sl["price"]
        for j in range(idx + 1, min(idx + 20, len(df))):
            if df["low"].iloc[j] < price * (1 - threshold) and df["close"].iloc[j] > price:
                sweeps.append({
                    "idx": j, "price": df["low"].iloc[j],
                    "time": df["timestamp"].iloc[j],
                    "type": "sweep_low", "level": price,
                    "confidence": 0.65
                })
                break

    return sweeps


# ── 3. ORDER BLOCK DETECTION ─────────────────────────────────

def detect_order_blocks(df, swing_highs, swing_lows, min_displacement=0.005):
    """Detect bullish and bearish order blocks"""
    order_blocks = []
    n = len(df)

    for i in range(2, n - 1):
        body_prev = abs(df["close"].iloc[i-1] - df["open"].iloc[i-1])
        body_curr = abs(df["close"].iloc[i] - df["open"].iloc[i])
        range_curr = df["high"].iloc[i] - df["low"].iloc[i]

        if range_curr == 0:
            continue

        # Bullish OB: bearish candle followed by strong bullish displacement
        is_prev_bearish = df["close"].iloc[i-1] < df["open"].iloc[i-1]
        is_curr_bullish = df["close"].iloc[i] > df["open"].iloc[i]
        displacement_up = (df["close"].iloc[i] - df["open"].iloc[i]) / df["open"].iloc[i]

        if is_prev_bearish and is_curr_bullish and displacement_up > min_displacement:
            vol_ratio = df["volume"].iloc[i] / max(df["volume"].iloc[max(0,i-10):i].mean(), 1)
            strength = min(1.0, 0.3 + displacement_up * 20 + (vol_ratio - 1) * 0.1)
            order_blocks.append({
                "idx": i - 1,
                "start_time": df["timestamp"].iloc[i-1],
                "high": max(df["open"].iloc[i-1], df["close"].iloc[i-1]),
                "low": min(df["open"].iloc[i-1], df["close"].iloc[i-1]),
                "direction": "bullish",
                "strength": round(strength, 3),
                "mitigated": False,
                "tested_count": 0,
                "displacement": round(displacement_up, 5),
                "vol_ratio": round(vol_ratio, 2),
            })

        # Bearish OB: bullish candle followed by strong bearish displacement
        is_prev_bullish = df["close"].iloc[i-1] > df["open"].iloc[i-1]
        is_curr_bearish = df["close"].iloc[i] < df["open"].iloc[i]
        displacement_down = (df["open"].iloc[i] - df["close"].iloc[i]) / df["open"].iloc[i]

        if is_prev_bullish and is_curr_bearish and displacement_down > min_displacement:
            vol_ratio = df["volume"].iloc[i] / max(df["volume"].iloc[max(0,i-10):i].mean(), 1)
            strength = min(1.0, 0.3 + displacement_down * 20 + (vol_ratio - 1) * 0.1)
            order_blocks.append({
                "idx": i - 1,
                "start_time": df["timestamp"].iloc[i-1],
                "high": max(df["open"].iloc[i-1], df["close"].iloc[i-1]),
                "low": min(df["open"].iloc[i-1], df["close"].iloc[i-1]),
                "direction": "bearish",
                "strength": round(strength, 3),
                "mitigated": False,
                "tested_count": 0,
                "displacement": round(displacement_down, 5),
                "vol_ratio": round(vol_ratio, 2),
            })

    # Mark mitigated OBs (price returned through the zone)
    for ob in order_blocks:
        for j in range(ob["idx"] + 2, n):
            if ob["direction"] == "bullish":
                if df["low"].iloc[j] <= ob["low"]:
                    ob["tested_count"] += 1
                    if df["close"].iloc[j] < ob["low"]:
                        ob["mitigated"] = True
                        break
            else:
                if df["high"].iloc[j] >= ob["high"]:
                    ob["tested_count"] += 1
                    if df["close"].iloc[j] > ob["high"]:
                        ob["mitigated"] = True
                        break

    return order_blocks


# ── 4. OHLCV ORDER FLOW PROXY ────────────────────────────────

def compute_order_flow_proxy(df):
    """
    Compute order flow proxy from OHLCV data.
    WARNING: This is PROXY data, NOT real order book data.
    """
    n = len(df)

    # Close Location Value: where close is within the range
    hl_range = df["high"] - df["low"]
    hl_range = hl_range.replace(0, np.nan)
    df["clv"] = ((df["close"] - df["low"]) - (df["high"] - df["close"])) / hl_range
    df["clv"] = df["clv"].fillna(0)

    # Delta proxy: volume * CLV (positive = buying, negative = selling)
    df["delta_proxy"] = df["volume"] * df["clv"]

    # Cumulative delta
    df["cvd"] = df["delta_proxy"].cumsum()

    # Buy/sell volume estimate
    df["buy_vol"] = df["volume"] * ((df["close"] - df["low"]) / hl_range).fillna(0.5)
    df["sell_vol"] = df["volume"] * ((df["high"] - df["close"]) / hl_range).fillna(0.5)

    # Volume spike (relative to 20-period MA)
    df["vol_ma20"] = df["volume"].rolling(20).mean()
    df["vol_spike"] = df["volume"] / df["vol_ma20"].replace(0, np.nan)
    df["vol_spike"] = df["vol_spike"].fillna(1)

    # Absorption proxy: high volume with small body (absorption)
    body = abs(df["close"] - df["open"])
    df["absorption"] = (df["vol_spike"] > 2.0) & (body < hl_range * 0.3)

    # Imbalance proxy: strong delta with volume spike
    delta_std = df["delta_proxy"].rolling(20).std().fillna(1)
    df["imbalance"] = abs(df["delta_proxy"]) > (2 * delta_std)

    # Candle spread (range relative to ATR)
    df["atr14"] = hl_range.rolling(14).mean()
    df["spread_ratio"] = hl_range / df["atr14"].replace(0, np.nan)
    df["spread_ratio"] = df["spread_ratio"].fillna(1)

    return df


# ── 5. STRATEGY LOGIC ────────────────────────────────────────

def strategy_ob_retest_long(df, order_blocks, sweeps, i):
    """Strategy A: Order Block Retest Long"""
    # Find unmitigated bullish OBs where price has returned to the zone
    for ob in order_blocks:
        if ob["direction"] != "bullish" or ob["mitigated"]:
            continue
        if ob["idx"] >= i - 1:
            continue
        if ob["strength"] < 0.4:
            continue

        # Price is in or near the OB zone
        if df["low"].iloc[i] <= ob["high"] and df["close"].iloc[i] > ob["low"]:
            # Confirmation: bullish close
            if df["close"].iloc[i] > df["open"].iloc[i]:
                # Volume/delta confirmation
                if df["delta_proxy"].iloc[i] > 0 or df["vol_spike"].iloc[i] > 1.3:
                    # Check for nearby sweep (within last 10 candles)
                    has_sweep = any(
                        s["type"] == "sweep_low" and s["idx"] >= i - 10 and s["idx"] <= i
                        for s in sweeps
                    )

                    entry = df["close"].iloc[i]
                    sl = ob["low"] * 0.999  # SL just below OB low
                    risk = entry - sl
                    if risk <= 0:
                        continue
                    tp = entry + risk * 2  # 2R target

                    return {
                        "direction": "LONG",
                        "entry_price": entry,
                        "stop_loss": sl,
                        "take_profit": tp,
                        "strategy": "OB_Retest_Long",
                        "ob_strength": ob["strength"],
                        "has_sweep": has_sweep,
                        "entry_reason": f"Bullish OB retest at {ob['high']:.2f}-{ob['low']:.2f}, sweep={has_sweep}",
                    }
    return None


def strategy_ob_retest_short(df, order_blocks, sweeps, i):
    """Strategy B: Order Block Retest Short"""
    for ob in order_blocks:
        if ob["direction"] != "bearish" or ob["mitigated"]:
            continue
        if ob["idx"] >= i - 1:
            continue
        if ob["strength"] < 0.4:
            continue

        if df["high"].iloc[i] >= ob["low"] and df["close"].iloc[i] < ob["high"]:
            if df["close"].iloc[i] < df["open"].iloc[i]:
                if df["delta_proxy"].iloc[i] < 0 or df["vol_spike"].iloc[i] > 1.3:
                    has_sweep = any(
                        s["type"] == "sweep_high" and s["idx"] >= i - 10 and s["idx"] <= i
                        for s in sweeps
                    )

                    entry = df["close"].iloc[i]
                    sl = ob["high"] * 1.001
                    risk = sl - entry
                    if risk <= 0:
                        continue
                    tp = entry - risk * 2

                    return {
                        "direction": "SHORT",
                        "entry_price": entry,
                        "stop_loss": sl,
                        "take_profit": tp,
                        "strategy": "OB_Retest_Short",
                        "ob_strength": ob["strength"],
                        "has_sweep": has_sweep,
                        "entry_reason": f"Bearish OB retest at {ob['high']:.2f}-{ob['low']:.2f}, sweep={has_sweep}",
                    }
    return None


def strategy_breakout_retest(df, bos_events, i):
    """Strategy C: Breakout + Retest"""
    # Look for recent BOS and price retesting the broken level
    for event in bos_events:
        if event["type"] != "BOS":
            continue
        if event["idx"] >= i - 1 or event["idx"] < i - 30:
            continue

        level = event["price"]

        if event["direction"] == "bullish":
            # Price pulled back to the BOS level and bouncing
            if abs(df["low"].iloc[i] - level) / level < 0.005:
                if df["close"].iloc[i] > df["open"].iloc[i] and df["close"].iloc[i] > level:
                    if df["delta_proxy"].iloc[i] > 0:
                        entry = df["close"].iloc[i]
                        sl = level * 0.995
                        risk = entry - sl
                        if risk <= 0:
                            continue
                        tp = entry + risk * 2

                        return {
                            "direction": "LONG",
                            "entry_price": entry,
                            "stop_loss": sl,
                            "take_profit": tp,
                            "strategy": "Breakout_Retest",
                            "ob_strength": event["confidence"],
                            "has_sweep": False,
                            "entry_reason": f"Bullish BOS retest at {level:.2f}",
                        }

        elif event["direction"] == "bearish":
            if abs(df["high"].iloc[i] - level) / level < 0.005:
                if df["close"].iloc[i] < df["open"].iloc[i] and df["close"].iloc[i] < level:
                    if df["delta_proxy"].iloc[i] < 0:
                        entry = df["close"].iloc[i]
                        sl = level * 1.005
                        risk = sl - entry
                        if risk <= 0:
                            continue
                        tp = entry - risk * 2

                        return {
                            "direction": "SHORT",
                            "entry_price": entry,
                            "stop_loss": sl,
                            "take_profit": tp,
                            "strategy": "Breakout_Retest",
                            "ob_strength": event["confidence"],
                            "has_sweep": False,
                            "entry_reason": f"Bearish BOS retest at {level:.2f}",
                        }
    return None


# ── 6. TRADE SIMULATION ──────────────────────────────────────

def simulate_trades(df, order_blocks, sweeps, bos_events):
    """Run trade simulation across all strategies"""
    trades = []
    in_trade = False
    current_trade = None
    cooldown = 0

    warmup = 50  # skip first N candles for indicator warmup

    for i in range(warmup, len(df)):
        if cooldown > 0:
            cooldown -= 1
            continue

        if in_trade:
            # Check exit conditions
            t = current_trade
            if t["direction"] == "LONG":
                # Stop loss hit
                if df["low"].iloc[i] <= t["stop_loss"]:
                    exit_price = t["stop_loss"] * (1 - SLIPPAGE_PCT)
                    pnl = (exit_price - t["entry_price"]) / t["entry_price"]
                    pnl -= FEES_PCT * 2  # entry + exit fees
                    t.update({
                        "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
                        "exit_price": exit_price, "result": "loss",
                        "pnl_pct": round(pnl * 100, 4),
                        "exit_reason": "Stop loss hit",
                    })
                    trades.append(t)
                    in_trade = False
                    cooldown = 3
                    continue
                # Take profit hit
                if df["high"].iloc[i] >= t["take_profit"]:
                    exit_price = t["take_profit"] * (1 - SLIPPAGE_PCT)
                    pnl = (exit_price - t["entry_price"]) / t["entry_price"]
                    pnl -= FEES_PCT * 2
                    t.update({
                        "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
                        "exit_price": exit_price, "result": "win",
                        "pnl_pct": round(pnl * 100, 4),
                        "exit_reason": "Take profit hit",
                    })
                    trades.append(t)
                    in_trade = False
                    cooldown = 3
                    continue
                # Time stop: close after 50 candles
                if i - t["entry_idx"] > 50:
                    exit_price = df["close"].iloc[i] * (1 - SLIPPAGE_PCT)
                    pnl = (exit_price - t["entry_price"]) / t["entry_price"]
                    pnl -= FEES_PCT * 2
                    result = "win" if pnl > 0 else "loss"
                    t.update({
                        "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
                        "exit_price": exit_price, "result": result,
                        "pnl_pct": round(pnl * 100, 4),
                        "exit_reason": "Time stop (50 candles)",
                    })
                    trades.append(t)
                    in_trade = False
                    cooldown = 3
                    continue

            elif t["direction"] == "SHORT":
                if df["high"].iloc[i] >= t["stop_loss"]:
                    exit_price = t["stop_loss"] * (1 + SLIPPAGE_PCT)
                    pnl = (t["entry_price"] - exit_price) / t["entry_price"]
                    pnl -= FEES_PCT * 2
                    t.update({
                        "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
                        "exit_price": exit_price, "result": "loss",
                        "pnl_pct": round(pnl * 100, 4),
                        "exit_reason": "Stop loss hit",
                    })
                    trades.append(t)
                    in_trade = False
                    cooldown = 3
                    continue
                if df["low"].iloc[i] <= t["take_profit"]:
                    exit_price = t["take_profit"] * (1 + SLIPPAGE_PCT)
                    pnl = (t["entry_price"] - exit_price) / t["entry_price"]
                    pnl -= FEES_PCT * 2
                    t.update({
                        "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
                        "exit_price": exit_price, "result": "win",
                        "pnl_pct": round(pnl * 100, 4),
                        "exit_reason": "Take profit hit",
                    })
                    trades.append(t)
                    in_trade = False
                    cooldown = 3
                    continue
                if i - t["entry_idx"] > 50:
                    exit_price = df["close"].iloc[i] * (1 + SLIPPAGE_PCT)
                    pnl = (t["entry_price"] - exit_price) / t["entry_price"]
                    pnl -= FEES_PCT * 2
                    result = "win" if pnl > 0 else "loss"
                    t.update({
                        "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
                        "exit_price": exit_price, "result": result,
                        "pnl_pct": round(pnl * 100, 4),
                        "exit_reason": "Time stop (50 candles)",
                    })
                    trades.append(t)
                    in_trade = False
                    cooldown = 3
                    continue
            continue

        # Try strategies in order
        signal = strategy_ob_retest_long(df, order_blocks, sweeps, i)
        if not signal:
            signal = strategy_ob_retest_short(df, order_blocks, sweeps, i)
        if not signal:
            signal = strategy_breakout_retest(df, bos_events, i)

        if signal:
            # Apply slippage to entry
            if signal["direction"] == "LONG":
                signal["entry_price"] *= (1 + SLIPPAGE_PCT)
            else:
                signal["entry_price"] *= (1 - SLIPPAGE_PCT)

            risk = abs(signal["entry_price"] - signal["stop_loss"])
            if risk == 0:
                continue

            position_size = (INITIAL_CAPITAL * RISK_PER_TRADE) / risk
            signal.update({
                "entry_idx": i,
                "entry_time": df["timestamp"].iloc[i],
                "position_size": round(position_size, 4),
                "risk_amount": round(risk, 4),
            })

            # Compute R-multiple targets
            signal["r_multiple_target"] = 2.0

            current_trade = signal
            in_trade = True

    # Close any open trade at end
    if in_trade and current_trade:
        i = len(df) - 1
        exit_price = df["close"].iloc[i]
        if current_trade["direction"] == "LONG":
            pnl = (exit_price - current_trade["entry_price"]) / current_trade["entry_price"]
        else:
            pnl = (current_trade["entry_price"] - exit_price) / current_trade["entry_price"]
        pnl -= FEES_PCT * 2
        current_trade.update({
            "exit_idx": i, "exit_time": df["timestamp"].iloc[i],
            "exit_price": exit_price,
            "result": "win" if pnl > 0 else "loss",
            "pnl_pct": round(pnl * 100, 4),
            "exit_reason": "End of data",
        })
        trades.append(current_trade)

    # Compute R-multiples
    for t in trades:
        risk = abs(t["entry_price"] - t["stop_loss"])
        if risk > 0:
            if t["direction"] == "LONG":
                t["r_multiple"] = round((t["exit_price"] - t["entry_price"]) / risk, 2)
            else:
                t["r_multiple"] = round((t["entry_price"] - t["exit_price"]) / risk, 2)
        else:
            t["r_multiple"] = 0

        t["holding_candles"] = t["exit_idx"] - t["entry_idx"]

    return trades


# ── 7. PERFORMANCE METRICS ────────────────────────────────────

def compute_metrics(trades):
    """Compute performance metrics"""
    if not trades:
        return {"total_trades": 0}

    wins = [t for t in trades if t["result"] == "win"]
    losses = [t for t in trades if t["result"] == "loss"]
    longs = [t for t in trades if t["direction"] == "LONG"]
    shorts = [t for t in trades if t["direction"] == "SHORT"]

    pnls = [t["pnl_pct"] for t in trades]
    r_multiples = [t["r_multiple"] for t in trades]

    gross_profit = sum(t["pnl_pct"] for t in wins) if wins else 0
    gross_loss = abs(sum(t["pnl_pct"] for t in losses)) if losses else 0.001

    # Equity curve for drawdown
    equity = [INITIAL_CAPITAL]
    for t in trades:
        equity.append(equity[-1] * (1 + t["pnl_pct"] / 100))

    peak = equity[0]
    max_dd = 0
    for e in equity:
        if e > peak:
            peak = e
        dd = (peak - e) / peak * 100
        if dd > max_dd:
            max_dd = dd

    # Sharpe (annualized, assuming daily granularity approximation)
    pnl_arr = np.array(pnls)
    sharpe = (pnl_arr.mean() / pnl_arr.std() * np.sqrt(252)) if pnl_arr.std() > 0 else 0

    long_wins = [t for t in longs if t["result"] == "win"]
    short_wins = [t for t in shorts if t["result"] == "win"]

    return {
        "total_trades": len(trades),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": round(len(wins) / len(trades) * 100, 1),
        "profit_factor": round(gross_profit / gross_loss, 2) if gross_loss > 0 else 999,
        "total_return_pct": round(sum(pnls), 2),
        "avg_pnl_pct": round(np.mean(pnls), 3),
        "avg_r_multiple": round(np.mean(r_multiples), 2),
        "max_drawdown_pct": round(max_dd, 2),
        "sharpe_ratio": round(sharpe, 2),
        "best_trade_pct": round(max(pnls), 2),
        "worst_trade_pct": round(min(pnls), 2),
        "avg_holding_candles": round(np.mean([t["holding_candles"] for t in trades]), 1),
        "long_trades": len(longs),
        "long_wins": len(long_wins),
        "long_win_rate": round(len(long_wins) / len(longs) * 100, 1) if longs else 0,
        "long_total_pnl": round(sum(t["pnl_pct"] for t in longs), 2),
        "short_trades": len(shorts),
        "short_wins": len(short_wins),
        "short_win_rate": round(len(short_wins) / len(shorts) * 100, 1) if shorts else 0,
        "short_total_pnl": round(sum(t["pnl_pct"] for t in shorts), 2),
        "final_equity": round(equity[-1], 2),
        "equity_curve": equity,
        "by_strategy": {},
    }


# ── 8. PLOT GENERATION ────────────────────────────────────────

def plot_price_chart(df, trades, order_blocks, bos_events, sweeps, symbol, tf, out_dir):
    """Plot A: Candlestick with OBs, trades, structure"""
    # Use last 200 candles for readability
    window = min(200, len(df))
    df_plot = df.iloc[-window:].copy()
    start_idx = len(df) - window

    fig, axes = plt.subplots(2, 1, figsize=(16, 10), height_ratios=[3, 1],
                              gridspec_kw={"hspace": 0.05})
    ax = axes[0]
    ax_vol = axes[1]

    fig.patch.set_facecolor("#0d1117")
    for a in [ax, ax_vol]:
        a.set_facecolor("#0d1117")
        a.tick_params(colors="#8b949e")
        a.spines["top"].set_visible(False)
        a.spines["right"].set_visible(False)
        for spine in a.spines.values():
            spine.set_color("#30363d")

    # Candlesticks
    times = np.arange(len(df_plot))
    for j, (idx, row) in enumerate(df_plot.iterrows()):
        color = "#3fb950" if row["close"] >= row["open"] else "#f85149"
        ax.plot([j, j], [row["low"], row["high"]], color=color, linewidth=0.5)
        body_low = min(row["open"], row["close"])
        body_high = max(row["open"], row["close"])
        ax.add_patch(plt.Rectangle((j - 0.3, body_low), 0.6, max(body_high - body_low, 0.01),
                                    facecolor=color, edgecolor=color, linewidth=0.5))

    # Order blocks
    for ob in order_blocks:
        ob_j = ob["idx"] - start_idx
        if ob_j < -10 or ob_j >= window:
            continue
        left = max(0, ob_j)
        right = min(window - 1, ob_j + 30)
        alpha = 0.15 if ob["mitigated"] else 0.3
        color = "#3fb950" if ob["direction"] == "bullish" else "#f85149"
        ax.add_patch(plt.Rectangle((left, ob["low"]), right - left, ob["high"] - ob["low"],
                                    facecolor=color, alpha=alpha, edgecolor=color,
                                    linewidth=0.5, linestyle="--"))

    # BOS/CHOCH markers
    for ev in bos_events:
        ev_j = ev["idx"] - start_idx
        if 0 <= ev_j < window:
            marker = "^" if ev["direction"] == "bullish" else "v"
            color = "#58a6ff" if ev["type"] == "BOS" else "#d2a8ff"
            ax.scatter(ev_j, ev["price"], marker=marker, color=color, s=40, zorder=5)

    # Sweeps
    for sw in sweeps:
        sw_j = sw["idx"] - start_idx
        if 0 <= sw_j < window:
            color = "#ffa657"
            ax.scatter(sw_j, sw["price"], marker="x", color=color, s=60, zorder=5)

    # Trades
    for t in trades:
        entry_j = t["entry_idx"] - start_idx
        exit_j = t["exit_idx"] - start_idx

        if entry_j < 0 and exit_j < 0:
            continue

        entry_j = max(0, min(window - 1, entry_j))
        exit_j = max(0, min(window - 1, exit_j))

        # Entry marker
        if t["direction"] == "LONG":
            ax.scatter(entry_j, t["entry_price"], marker="^", color="#3fb950", s=80, zorder=10, edgecolors="white", linewidth=0.5)
        else:
            ax.scatter(entry_j, t["entry_price"], marker="v", color="#f85149", s=80, zorder=10, edgecolors="white", linewidth=0.5)

        # Exit marker
        exit_color = "#3fb950" if t["result"] == "win" else "#f85149"
        ax.scatter(exit_j, t["exit_price"], marker="D", color=exit_color, s=50, zorder=10, edgecolors="white", linewidth=0.5)

        # SL/TP lines
        ax.plot([entry_j, exit_j], [t["stop_loss"]] * 2, "--", color="#f85149", alpha=0.4, linewidth=0.8)
        ax.plot([entry_j, exit_j], [t["take_profit"]] * 2, "--", color="#3fb950", alpha=0.4, linewidth=0.8)

    ax.set_title(f"{symbol} {tf} — Price + Order Blocks + Trades", color="#e6edf3", fontsize=14, pad=10)
    ax.set_ylabel("Price", color="#8b949e")

    # Volume bars
    for j, (idx, row) in enumerate(df_plot.iterrows()):
        color = "#3fb95066" if row["close"] >= row["open"] else "#f8514966"
        ax_vol.bar(j, row["volume"], color=color, width=0.6)

    ax_vol.set_ylabel("Volume", color="#8b949e")
    ax_vol.set_xlim(-1, window)
    ax.set_xlim(-1, window)

    # Legend
    legend_elements = [
        mpatches.Patch(facecolor="#3fb950", alpha=0.3, label="Bullish OB"),
        mpatches.Patch(facecolor="#f85149", alpha=0.3, label="Bearish OB"),
        plt.Line2D([0], [0], marker="^", color="#3fb950", label="Long Entry", markersize=8, linestyle="None"),
        plt.Line2D([0], [0], marker="v", color="#f85149", label="Short Entry", markersize=8, linestyle="None"),
        plt.Line2D([0], [0], marker="D", color="#3fb950", label="Win Exit", markersize=6, linestyle="None"),
        plt.Line2D([0], [0], marker="D", color="#f85149", label="Loss Exit", markersize=6, linestyle="None"),
    ]
    ax.legend(handles=legend_elements, loc="upper left", fontsize=8,
              facecolor="#161b22", edgecolor="#30363d", labelcolor="#e6edf3")

    plt.savefig(out_dir / "price_chart.png", dpi=150, bbox_inches="tight", facecolor="#0d1117")
    plt.close()


def plot_order_flow(df, symbol, tf, out_dir):
    """Plot B: Order flow proxy chart"""
    window = min(200, len(df))
    df_plot = df.iloc[-window:].copy().reset_index(drop=True)

    fig, axes = plt.subplots(4, 1, figsize=(16, 12), height_ratios=[2, 1, 1, 1],
                              gridspec_kw={"hspace": 0.1})
    fig.patch.set_facecolor("#0d1117")

    for a in axes:
        a.set_facecolor("#0d1117")
        a.tick_params(colors="#8b949e")
        a.spines["top"].set_visible(False)
        a.spines["right"].set_visible(False)
        for spine in a.spines.values():
            spine.set_color("#30363d")

    x = np.arange(len(df_plot))

    # Price
    axes[0].plot(x, df_plot["close"], color="#58a6ff", linewidth=1)
    axes[0].set_title(f"{symbol} {tf} — Order flow proxy (OHLCV-based, NOT real order book)",
                       color="#e6edf3", fontsize=13, pad=10)
    axes[0].set_ylabel("Price", color="#8b949e")

    # Delta proxy bars
    colors = ["#3fb950" if d > 0 else "#f85149" for d in df_plot["delta_proxy"]]
    axes[1].bar(x, df_plot["delta_proxy"], color=colors, width=0.6)
    axes[1].set_ylabel("Delta proxy", color="#8b949e")
    axes[1].axhline(0, color="#30363d", linewidth=0.5)

    # CVD
    axes[2].plot(x, df_plot["cvd"], color="#d2a8ff", linewidth=1)
    axes[2].set_ylabel("Cum. delta", color="#8b949e")
    axes[2].fill_between(x, df_plot["cvd"], alpha=0.15, color="#d2a8ff")

    # Imbalance + absorption markers
    axes[3].bar(x, df_plot["vol_spike"], color="#8b949e44", width=0.6)
    imb_idx = df_plot[df_plot["imbalance"]].index
    abs_idx = df_plot[df_plot["absorption"]].index
    if len(imb_idx) > 0:
        axes[3].scatter(imb_idx, df_plot.loc[imb_idx, "vol_spike"],
                        color="#ffa657", s=20, zorder=5, label="Imbalance")
    if len(abs_idx) > 0:
        axes[3].scatter(abs_idx, df_plot.loc[abs_idx, "vol_spike"],
                        color="#58a6ff", s=20, zorder=5, marker="s", label="Absorption")
    axes[3].set_ylabel("Vol spike", color="#8b949e")
    axes[3].axhline(2.0, color="#ffa657", linewidth=0.5, linestyle="--", alpha=0.5)
    axes[3].legend(loc="upper left", fontsize=8, facecolor="#161b22",
                   edgecolor="#30363d", labelcolor="#e6edf3")

    plt.savefig(out_dir / "order_flow.png", dpi=150, bbox_inches="tight", facecolor="#0d1117")
    plt.close()


def plot_equity_curve(trades, metrics, symbol, tf, out_dir):
    """Plot C: Equity curve + drawdown"""
    if not trades:
        return

    equity = metrics["equity_curve"]

    fig, axes = plt.subplots(2, 1, figsize=(14, 7), height_ratios=[2, 1],
                              gridspec_kw={"hspace": 0.1})
    fig.patch.set_facecolor("#0d1117")

    for a in axes:
        a.set_facecolor("#0d1117")
        a.tick_params(colors="#8b949e")
        a.spines["top"].set_visible(False)
        a.spines["right"].set_visible(False)
        for spine in a.spines.values():
            spine.set_color("#30363d")

    x = np.arange(len(equity))
    axes[0].plot(x, equity, color="#58a6ff", linewidth=1.5)
    axes[0].fill_between(x, INITIAL_CAPITAL, equity, where=[e >= INITIAL_CAPITAL for e in equity],
                          alpha=0.15, color="#3fb950")
    axes[0].fill_between(x, INITIAL_CAPITAL, equity, where=[e < INITIAL_CAPITAL for e in equity],
                          alpha=0.15, color="#f85149")
    axes[0].axhline(INITIAL_CAPITAL, color="#30363d", linewidth=0.5, linestyle="--")
    axes[0].set_title(f"{symbol} {tf} — Equity curve ({metrics['total_trades']} trades, "
                       f"PF={metrics['profit_factor']}, WR={metrics['win_rate']}%)",
                       color="#e6edf3", fontsize=13, pad=10)
    axes[0].set_ylabel("Equity ($)", color="#8b949e")

    # Drawdown
    peak = equity[0]
    dd = []
    for e in equity:
        if e > peak:
            peak = e
        dd.append((peak - e) / peak * 100)

    axes[1].fill_between(x, 0, dd, color="#f85149", alpha=0.3)
    axes[1].plot(x, dd, color="#f85149", linewidth=0.8)
    axes[1].set_ylabel("Drawdown %", color="#8b949e")
    axes[1].invert_yaxis()

    plt.savefig(out_dir / "equity_curve.png", dpi=150, bbox_inches="tight", facecolor="#0d1117")
    plt.close()


def plot_trade_distribution(trades, metrics, symbol, tf, out_dir):
    """Plot D: Trade distribution"""
    if not trades:
        return

    fig, axes = plt.subplots(1, 3, figsize=(16, 5))
    fig.patch.set_facecolor("#0d1117")

    for a in axes:
        a.set_facecolor("#0d1117")
        a.tick_params(colors="#8b949e")
        a.spines["top"].set_visible(False)
        a.spines["right"].set_visible(False)
        for spine in a.spines.values():
            spine.set_color("#30363d")

    # Win/Loss pie
    wins = metrics["wins"]
    losses = metrics["losses"]
    if wins + losses > 0:
        axes[0].pie([wins, losses], labels=[f"Wins ({wins})", f"Losses ({losses})"],
                     colors=["#3fb950", "#f85149"], textprops={"color": "#e6edf3", "fontsize": 10},
                     startangle=90, autopct="%1.0f%%")
    axes[0].set_title("Win / Loss", color="#e6edf3", fontsize=12)

    # R-multiple histogram
    r_mults = [t["r_multiple"] for t in trades]
    colors = ["#3fb950" if r > 0 else "#f85149" for r in r_mults]
    axes[1].bar(range(len(r_mults)), sorted(r_mults), color=sorted(colors, key=lambda c: c == "#3fb950"), width=0.8)
    axes[1].axhline(0, color="#30363d", linewidth=0.5)
    axes[1].set_title("R-multiple distribution", color="#e6edf3", fontsize=12)
    axes[1].set_ylabel("R", color="#8b949e")

    # Long vs Short comparison
    categories = ["Trades", "Win Rate %", "Total PnL %"]
    long_vals = [metrics["long_trades"], metrics["long_win_rate"], metrics["long_total_pnl"]]
    short_vals = [metrics["short_trades"], metrics["short_win_rate"], metrics["short_total_pnl"]]

    x = np.arange(len(categories))
    w = 0.35
    axes[2].bar(x - w/2, long_vals, w, label="Long", color="#3fb950", alpha=0.7)
    axes[2].bar(x + w/2, short_vals, w, label="Short", color="#f85149", alpha=0.7)
    axes[2].set_xticks(x)
    axes[2].set_xticklabels(categories, color="#8b949e", fontsize=9)
    axes[2].legend(facecolor="#161b22", edgecolor="#30363d", labelcolor="#e6edf3")
    axes[2].set_title("Long vs Short", color="#e6edf3", fontsize=12)

    fig.suptitle(f"{symbol} {tf} — Trade distribution", color="#e6edf3", fontsize=14, y=1.02)
    plt.savefig(out_dir / "trade_distribution.png", dpi=150, bbox_inches="tight", facecolor="#0d1117")
    plt.close()


def plot_summary_dashboard(metrics, symbol, tf, out_dir):
    """Plot E: Summary dashboard"""
    fig, ax = plt.subplots(figsize=(12, 6))
    fig.patch.set_facecolor("#0d1117")
    ax.set_facecolor("#0d1117")
    ax.axis("off")

    lines = [
        f"{symbol} {tf} — BACKTEST SUMMARY",
        f"{'='*50}",
        f"Total trades:        {metrics.get('total_trades', 0)}",
        f"Win rate:            {metrics.get('win_rate', 0)}%",
        f"Profit factor:       {metrics.get('profit_factor', 0)}",
        f"Sharpe ratio:        {metrics.get('sharpe_ratio', 0)}",
        f"Max drawdown:        {metrics.get('max_drawdown_pct', 0)}%",
        f"Total return:        {metrics.get('total_return_pct', 0)}%",
        f"Avg R-multiple:      {metrics.get('avg_r_multiple', 0)}",
        f"Best trade:          {metrics.get('best_trade_pct', 0)}%",
        f"Worst trade:         {metrics.get('worst_trade_pct', 0)}%",
        f"Avg holding:         {metrics.get('avg_holding_candles', 0)} candles",
        f"{'='*50}",
        f"LONG:  {metrics.get('long_trades', 0)} trades, WR={metrics.get('long_win_rate', 0)}%, PnL={metrics.get('long_total_pnl', 0)}%",
        f"SHORT: {metrics.get('short_trades', 0)} trades, WR={metrics.get('short_win_rate', 0)}%, PnL={metrics.get('short_total_pnl', 0)}%",
        f"{'='*50}",
        f"Final equity:        ${metrics.get('final_equity', INITIAL_CAPITAL):,.2f}",
        f"",
        f"Order flow method:   OHLCV PROXY (not real order book)",
        f"Fees:                0.1% per trade (taker)",
        f"Slippage:            0.05%",
    ]

    text = "\n".join(lines)
    ax.text(0.05, 0.95, text, transform=ax.transAxes, fontsize=11,
            verticalalignment="top", fontfamily="monospace", color="#e6edf3",
            bbox=dict(boxstyle="round,pad=0.5", facecolor="#161b22", edgecolor="#30363d"))

    plt.savefig(out_dir / "summary.png", dpi=150, bbox_inches="tight", facecolor="#0d1117")
    plt.close()


# ── 9. REPORT GENERATION ─────────────────────────────────────

def generate_report(symbol, tf, df, trades, metrics, order_blocks, bos_events, out_dir):
    """Generate markdown report"""

    approved = (
        metrics.get("profit_factor", 0) > 1.3
        and metrics.get("total_trades", 0) >= 30
        and metrics.get("max_drawdown_pct", 100) < 25
    )

    report = f"""# GodsView Backtest Report: {symbol} {tf}

**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}

## Data

| Field | Value |
|-------|-------|
| Symbol | {symbol} |
| Timeframe | {tf} |
| Data source | Binance (via CCXT) |
| Date range | {df['timestamp'].iloc[0].strftime('%Y-%m-%d')} to {df['timestamp'].iloc[-1].strftime('%Y-%m-%d')} |
| Total candles | {len(df):,} |
| Order flow method | **OHLCV PROXY** (not real order book) |

## Strategy rules

**Strategy A — OB Retest Long:** Bullish order block retest with delta/volume confirmation. TP=2R, SL below OB.

**Strategy B — OB Retest Short:** Bearish order block retest with delta/volume confirmation. TP=2R, SL above OB.

**Strategy C — Breakout + Retest:** BOS level retest with order flow confirmation. TP=2R, SL beyond level.

## Performance

| Metric | Value |
|--------|-------|
| Total trades | {metrics.get('total_trades', 0)} |
| Win rate | {metrics.get('win_rate', 0)}% |
| Profit factor | {metrics.get('profit_factor', 0)} |
| Sharpe ratio | {metrics.get('sharpe_ratio', 0)} |
| Max drawdown | {metrics.get('max_drawdown_pct', 0)}% |
| Total return | {metrics.get('total_return_pct', 0)}% |
| Avg R-multiple | {metrics.get('avg_r_multiple', 0)} |
| Best trade | {metrics.get('best_trade_pct', 0)}% |
| Worst trade | {metrics.get('worst_trade_pct', 0)}% |
| Final equity | ${metrics.get('final_equity', INITIAL_CAPITAL):,.2f} |

## Long vs Short

| Side | Trades | Win Rate | Total PnL |
|------|--------|----------|-----------|
| LONG | {metrics.get('long_trades', 0)} | {metrics.get('long_win_rate', 0)}% | {metrics.get('long_total_pnl', 0)}% |
| SHORT | {metrics.get('short_trades', 0)} | {metrics.get('short_win_rate', 0)}% | {metrics.get('short_total_pnl', 0)}% |

## Structure detected

- Order blocks: {len(order_blocks)} ({len([ob for ob in order_blocks if ob['direction']=='bullish'])} bullish, {len([ob for ob in order_blocks if ob['direction']=='bearish'])} bearish)
- BOS/CHOCH events: {len(bos_events)}
- Unmitigated OBs: {len([ob for ob in order_blocks if not ob['mitigated']])}

## Plots

- [Price chart](price_chart.png)
- [Order flow](order_flow.png)
- [Equity curve](equity_curve.png)
- [Trade distribution](trade_distribution.png)
- [Summary](summary.png)

## Approval for paper trading

**{'APPROVED' if approved else 'NOT APPROVED'}**

Criteria check:
- Profit factor > 1.3: {'PASS' if metrics.get('profit_factor', 0) > 1.3 else 'FAIL'} ({metrics.get('profit_factor', 0)})
- At least 30 trades: {'PASS' if metrics.get('total_trades', 0) >= 30 else 'FAIL'} ({metrics.get('total_trades', 0)})
- Max drawdown < 25%: {'PASS' if metrics.get('max_drawdown_pct', 100) < 25 else 'FAIL'} ({metrics.get('max_drawdown_pct', 0)}%)

## Lessons

- Order flow is OHLCV-proxy only — real order book data would improve signal quality
- Crypto 24/7 market means variable liquidity by session
- Walk-forward validation recommended before live deployment
"""

    (out_dir / "report.md").write_text(report)
    return approved


# ── 10. MAIN EXECUTION ────────────────────────────────────────

def run_backtest(symbol_name, symbol_ccxt, tf, tf_config):
    """Run full backtest for one symbol/timeframe combination"""
    out_dir = BASE_DIR / symbol_name / tf
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  {symbol_name} {tf}")
    print(f"{'='*60}")

    # 1. Fetch data
    print(f"  Fetching {tf_config['days']} days of {tf} data...")
    df = fetch_ohlcv(symbol_ccxt, tf, tf_config["days"], tf_config["limit"])
    if df.empty or len(df) < 100:
        print(f"  ERROR: Insufficient data ({len(df)} candles), skipping.")
        return None

    print(f"  Got {len(df):,} candles: {df['timestamp'].iloc[0]} to {df['timestamp'].iloc[-1]}")

    # 2. Order flow proxy
    print(f"  Computing order flow proxy...")
    df = compute_order_flow_proxy(df)

    # 3. Market structure
    print(f"  Detecting market structure...")
    lookback = {"5m": 3, "15m": 4, "1h": 5, "4h": 5}.get(tf, 5)
    swing_highs, swing_lows = detect_swing_points(df, lookback=lookback)
    print(f"    Swing highs: {len(swing_highs)}, Swing lows: {len(swing_lows)}")

    bos_events = detect_bos_choch(swing_highs, swing_lows, df)
    print(f"    BOS/CHOCH events: {len(bos_events)}")

    sweeps = detect_liquidity_sweeps(df, swing_highs, swing_lows)
    print(f"    Liquidity sweeps: {len(sweeps)}")

    # 4. Order blocks
    print(f"  Detecting order blocks...")
    min_disp = {"5m": 0.003, "15m": 0.004, "1h": 0.005, "4h": 0.007}.get(tf, 0.005)
    order_blocks = detect_order_blocks(df, swing_highs, swing_lows, min_displacement=min_disp)
    bullish_obs = [ob for ob in order_blocks if ob["direction"] == "bullish"]
    bearish_obs = [ob for ob in order_blocks if ob["direction"] == "bearish"]
    print(f"    Order blocks: {len(order_blocks)} ({len(bullish_obs)} bullish, {len(bearish_obs)} bearish)")

    # 5. Trade simulation
    print(f"  Running trade simulation...")
    trades = simulate_trades(df, order_blocks, sweeps, bos_events)
    print(f"    Trades: {len(trades)}")

    # 6. Metrics
    metrics = compute_metrics(trades)
    if metrics["total_trades"] > 0:
        print(f"    Win rate: {metrics['win_rate']}%  PF: {metrics['profit_factor']}  "
              f"Return: {metrics['total_return_pct']}%  MaxDD: {metrics['max_drawdown_pct']}%")

    # 7. Plots
    print(f"  Generating plots...")
    plot_price_chart(df, trades, order_blocks, bos_events, sweeps, symbol_name, tf, out_dir)
    plot_order_flow(df, symbol_name, tf, out_dir)
    if trades:
        plot_equity_curve(trades, metrics, symbol_name, tf, out_dir)
        plot_trade_distribution(trades, metrics, symbol_name, tf, out_dir)
    plot_summary_dashboard(metrics, symbol_name, tf, out_dir)

    # 8. Report
    approved = generate_report(symbol_name, tf, df, trades, metrics, order_blocks, bos_events, out_dir)
    print(f"  Paper trading approval: {'YES' if approved else 'NO'}")

    # 9. Save trades JSON
    trades_export = []
    for t in trades:
        te = {k: v for k, v in t.items() if k not in ("entry_time", "exit_time")}
        te["entry_time"] = str(t.get("entry_time", ""))
        te["exit_time"] = str(t.get("exit_time", ""))
        trades_export.append(te)

    (out_dir / "trades.json").write_text(json.dumps(trades_export, indent=2, default=str))

    # Save metrics JSON
    metrics_export = {k: v for k, v in metrics.items() if k != "equity_curve"}
    (out_dir / "metrics.json").write_text(json.dumps(metrics_export, indent=2))

    return {
        "symbol": symbol_name,
        "timeframe": tf,
        "candles": len(df),
        "trades": len(trades),
        "metrics": metrics_export,
        "approved": approved,
    }


def main():
    print("=" * 60)
    print("  GodsView Crypto Backtest Engine")
    print("  OHLCV order flow proxy — NOT real order book data")
    print("=" * 60)

    BASE_DIR.mkdir(parents=True, exist_ok=True)

    all_results = []

    for symbol_name, symbol_ccxt in SYMBOLS.items():
        for tf, tf_config in TIMEFRAMES.items():
            try:
                result = run_backtest(symbol_name, symbol_ccxt, tf, tf_config)
                if result:
                    all_results.append(result)
            except Exception as e:
                print(f"  ERROR running {symbol_name} {tf}: {e}")
                import traceback
                traceback.print_exc()

    # Final summary
    print("\n" + "=" * 60)
    print("  FINAL SUMMARY")
    print("=" * 60)

    for r in all_results:
        m = r["metrics"]
        status = "APPROVED" if r["approved"] else "NOT APPROVED"
        print(f"  {r['symbol']:8s} {r['timeframe']:4s}  "
              f"Trades={m.get('total_trades',0):4d}  "
              f"WR={m.get('win_rate',0):5.1f}%  "
              f"PF={m.get('profit_factor',0):5.2f}  "
              f"Return={m.get('total_return_pct',0):7.2f}%  "
              f"MaxDD={m.get('max_drawdown_pct',0):5.2f}%  "
              f"[{status}]")

    # Save master summary
    summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "initial_capital": INITIAL_CAPITAL,
        "fees_pct": FEES_PCT,
        "slippage_pct": SLIPPAGE_PCT,
        "order_flow_method": "OHLCV_PROXY",
        "results": all_results,
    }
    (BASE_DIR / "master_summary.json").write_text(json.dumps(summary, indent=2, default=str))
    print(f"\n  Results saved to {BASE_DIR}/")
    print(f"  Master summary: {BASE_DIR}/master_summary.json")


if __name__ == "__main__":
    main()
