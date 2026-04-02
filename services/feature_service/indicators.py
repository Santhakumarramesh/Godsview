"""
GodsView v2 — Technical indicators.

Pure functions operating on list[Bar] → list[float].
All functions return NaN for bars with insufficient lookback
so callers can safely zip with the original bar list.
"""
from __future__ import annotations

import math
from typing import Sequence

from services.shared.types import Bar

NaN = float("nan")


# ── Simple Moving Average ─────────────────────────────────────────────────────

def sma(bars: Sequence[Bar], period: int, attr: str = "close") -> list[float]:
    prices = [getattr(b, attr) for b in bars]
    result: list[float] = []
    for i in range(len(prices)):
        if i < period - 1:
            result.append(NaN)
        else:
            result.append(sum(prices[i - period + 1 : i + 1]) / period)
    return result


# ── Exponential Moving Average ────────────────────────────────────────────────

def ema(bars: Sequence[Bar], period: int, attr: str = "close") -> list[float]:
    prices = [getattr(b, attr) for b in bars]
    result: list[float] = [NaN] * len(prices)
    if len(prices) < period:
        return result

    k = 2.0 / (period + 1)
    # Seed with SMA of first `period` prices
    seed = sum(prices[:period]) / period
    result[period - 1] = seed
    prev = seed

    for i in range(period, len(prices)):
        val = prices[i] * k + prev * (1 - k)
        result[i] = val
        prev = val

    return result


# ── Average True Range ────────────────────────────────────────────────────────

def atr(bars: Sequence[Bar], period: int = 14) -> list[float]:
    """Average True Range (Wilder smoothing)."""
    n = len(bars)
    if n < 2:
        return [NaN] * n

    tr: list[float] = [NaN]
    for i in range(1, n):
        h = bars[i].high
        l = bars[i].low
        pc = bars[i - 1].close
        true_range = max(h - l, abs(h - pc), abs(l - pc))
        tr.append(true_range)

    result: list[float] = [NaN] * n
    if n < period + 1:
        return result

    # Seed with simple average of first `period` TR values
    seed = sum(tr[1 : period + 1]) / period
    result[period] = seed
    prev = seed

    for i in range(period + 1, n):
        val = (prev * (period - 1) + tr[i]) / period
        result[i] = val
        prev = val

    return result


# ── RSI ───────────────────────────────────────────────────────────────────────

def rsi(bars: Sequence[Bar], period: int = 14) -> list[float]:
    prices = [b.close for b in bars]
    n = len(prices)
    result = [NaN] * n
    if n < period + 1:
        return result

    gains: list[float] = []
    losses: list[float] = []
    for i in range(1, n):
        delta = prices[i] - prices[i - 1]
        gains.append(max(delta, 0.0))
        losses.append(max(-delta, 0.0))

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    def _rsi_val(ag: float, al: float) -> float:
        if al == 0:
            return 100.0
        rs = ag / al
        return 100.0 - 100.0 / (1 + rs)

    result[period] = _rsi_val(avg_gain, avg_loss)

    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gains[i - 1]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i - 1]) / period
        result[i] = _rsi_val(avg_gain, avg_loss)

    return result


# ── MACD ──────────────────────────────────────────────────────────────────────

def macd(
    bars: Sequence[Bar],
    fast: int = 12,
    slow: int = 26,
    signal_period: int = 9,
) -> tuple[list[float], list[float], list[float]]:
    """Returns (macd_line, signal_line, histogram)."""
    fast_ema  = ema(bars, fast)
    slow_ema  = ema(bars, slow)
    n = len(bars)

    macd_line = [
        fast_ema[i] - slow_ema[i]
        if not (math.isnan(fast_ema[i]) or math.isnan(slow_ema[i]))
        else NaN
        for i in range(n)
    ]

    # Signal = EMA of macd_line over non-NaN segment
    signal_line = [NaN] * n
    hist_line   = [NaN] * n

    valid_start = next((i for i, v in enumerate(macd_line) if not math.isnan(v)), None)
    if valid_start is None:
        return macd_line, signal_line, hist_line

    # Build signal EMA on the macd sub-list
    k = 2.0 / (signal_period + 1)
    valid_macd = [v for v in macd_line if not math.isnan(v)]
    if len(valid_macd) < signal_period:
        return macd_line, signal_line, hist_line

    seed = sum(valid_macd[:signal_period]) / signal_period
    sig_vals = [NaN] * signal_period + [seed]
    prev = seed
    for i in range(signal_period, len(valid_macd)):
        val = valid_macd[i] * k + prev * (1 - k)
        sig_vals.append(val)
        prev = val

    sig_idx = 0
    for i in range(valid_start, n):
        if not math.isnan(macd_line[i]):
            if sig_idx < len(sig_vals):
                signal_line[i] = sig_vals[sig_idx]
                if not math.isnan(sig_vals[sig_idx]):
                    hist_line[i] = macd_line[i] - sig_vals[sig_idx]
            sig_idx += 1

    return macd_line, signal_line, hist_line


# ── Bollinger Bands ───────────────────────────────────────────────────────────

def bollinger(
    bars: Sequence[Bar],
    period: int = 20,
    num_std: float = 2.0,
) -> tuple[list[float], list[float], list[float]]:
    """Returns (upper, middle, lower)."""
    prices = [b.close for b in bars]
    n = len(prices)
    mid    = [NaN] * n
    upper  = [NaN] * n
    lower  = [NaN] * n

    for i in range(period - 1, n):
        window = prices[i - period + 1 : i + 1]
        m = sum(window) / period
        variance = sum((x - m) ** 2 for x in window) / period
        std = math.sqrt(variance)
        mid[i]   = m
        upper[i] = m + num_std * std
        lower[i] = m - num_std * std

    return upper, mid, lower


# ── Volume SMA ────────────────────────────────────────────────────────────────

def volume_sma(bars: Sequence[Bar], period: int = 20) -> list[float]:
    vols = [b.volume for b in bars]
    n = len(vols)
    result: list[float] = [NaN] * n
    for i in range(period - 1, n):
        result[i] = sum(vols[i - period + 1 : i + 1]) / period
    return result


# ── VWAP (session) ────────────────────────────────────────────────────────────

def vwap(bars: Sequence[Bar]) -> list[float]:
    """Cumulative VWAP from start of the bar list (treat as one session)."""
    cum_pv = 0.0
    cum_v  = 0.0
    result: list[float] = []
    for b in bars:
        typical = (b.high + b.low + b.close) / 3
        cum_pv += typical * b.volume
        cum_v  += b.volume
        result.append(cum_pv / cum_v if cum_v > 0 else NaN)
    return result


# ── Highest High / Lowest Low lookback ───────────────────────────────────────

def highest_high(bars: Sequence[Bar], lookback: int) -> list[float]:
    n = len(bars)
    result: list[float] = [NaN] * n
    for i in range(lookback - 1, n):
        result[i] = max(b.high for b in bars[i - lookback + 1 : i + 1])
    return result


def lowest_low(bars: Sequence[Bar], lookback: int) -> list[float]:
    n = len(bars)
    result: list[float] = [NaN] * n
    for i in range(lookback - 1, n):
        result[i] = min(b.low for b in bars[i - lookback + 1 : i + 1])
    return result
