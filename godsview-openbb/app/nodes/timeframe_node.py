"""
nodes/timeframe_node.py — Timeframe SubNode

Each stock brain contains multiple timeframe nodes (tick, 1m, 5m, 15m, 1h, 1d).
Each one watches a different layer of truth and outputs a structured opinion:
bias, confidence, regime, invalidation level, strongest setup, momentum.
"""

from __future__ import annotations
import math
import logging
from datetime import datetime, timezone
from typing import Optional

from ..state.schemas import (
    Timeframe, TimeframeOpinion, Bias, Regime, SetupFamily,
)

logger = logging.getLogger("godsview.nodes.timeframe")


def _safe_div(n: float, d: float, fallback: float = 0.0) -> float:
    if not math.isfinite(d) or d == 0:
        return fallback
    r = n / d
    return r if math.isfinite(r) else fallback


def _clamp(v: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, v))


# ─── Bar helpers ──────────────────────────────────────────────────────────────

def _slope(bars: list[dict]) -> float:
    if len(bars) < 2:
        return 0.0
    return _safe_div(bars[-1]["close"] - bars[0]["close"], bars[0]["close"])


def _avg_range(bars: list[dict]) -> float:
    if not bars:
        return 0.0
    return sum(b["high"] - b["low"] for b in bars) / len(bars)


def _atr(bars: list[dict]) -> float:
    if len(bars) < 2:
        return _avg_range(bars)
    trs = []
    for i in range(1, len(bars)):
        tr = max(
            bars[i]["high"] - bars[i]["low"],
            abs(bars[i]["high"] - bars[i - 1]["close"]),
            abs(bars[i]["low"] - bars[i - 1]["close"]),
        )
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _ema(values: list[float], period: int) -> float:
    if not values or period <= 0:
        return 0.0
    k = 2 / (period + 1)
    ema = values[0]
    for v in values[1:]:
        ema = v * k + ema * (1 - k)
    return ema


def _rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = 0.0, 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d > 0:
            gains += d
        else:
            losses -= d
    ag = gains / period
    al = losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        ag = (ag * (period - 1) + (d if d > 0 else 0)) / period
        al = (al * (period - 1) + (-d if d < 0 else 0)) / period
    if al == 0:
        return 100.0
    if ag == 0:
        return 0.0
    return 100 - 100 / (1 + ag / al)


# ─── Regime Detection ─────────────────────────────────────────────────────────

def detect_regime(bars: list[dict]) -> Regime:
    if len(bars) < 20:
        return Regime.RANGING
    last20 = bars[-20:]
    closes = [b["close"] for b in last20 if math.isfinite(b["close"])]
    if len(closes) < 10:
        return Regime.RANGING

    s = _slope(last20)
    highs = [b["high"] for b in last20]
    lows = [b["low"] for b in last20]
    high = max(highs) if highs else 0
    low = min(lows) if lows else 0
    mid = (high + low) / 2

    dir_matches = sum(1 for b in last20 if (s > 0 and b["close"] > b["open"]) or (s < 0 and b["close"] < b["open"]))
    persistence = _safe_div(dir_matches, len(last20))
    range_pct = _safe_div(high - low, mid)

    if persistence < 0.45 and range_pct < 0.03:
        return Regime.CHOP

    avg_close = sum(closes) / len(closes)
    atr_val = _atr(last20)
    atr_pct = _safe_div(atr_val, avg_close)
    if atr_pct > 0.025:
        return Regime.VOLATILE

    if persistence > 0.6 and abs(s) > 0.008:
        return Regime.TRENDING_BULL if s > 0 else Regime.TRENDING_BEAR

    return Regime.RANGING


# ─── Main Compute ─────────────────────────────────────────────────────────────

def compute_timeframe_opinion(
    timeframe: Timeframe,
    bars: list[dict],
) -> TimeframeOpinion:
    """
    Compute a structured opinion for a given timeframe from OHLCV bars.

    Each bar: {"timestamp": str, "open": float, "high": float, "low": float, "close": float, "volume": float}
    """
    now = datetime.now(timezone.utc).isoformat()

    if len(bars) < 5:
        return TimeframeOpinion(timeframe=timeframe, updated_at=now)

    closes = [b["close"] for b in bars]
    last = closes[-1]

    # Regime
    regime = detect_regime(bars)

    # Momentum: normalized slope of last 10 bars
    last10 = bars[-10:] if len(bars) >= 10 else bars
    momentum = _clamp(_slope(last10) * 100, -1, 1)

    # EMA cross bias
    ema_fast = _ema(closes, 12)
    ema_slow = _ema(closes, 26)
    ema_spread = _safe_div(ema_fast - ema_slow, last)

    # RSI
    rsi = _rsi(closes, 14)

    # Structure score: directional persistence * (1 - wick noise)
    last20 = bars[-20:] if len(bars) >= 20 else bars
    bull_count = sum(1 for b in last20 if b["close"] > b["open"])
    dir_pers = _safe_div(bull_count, len(last20))
    wick_ratios = []
    for b in last20:
        rng = b["high"] - b["low"]
        body = abs(b["close"] - b["open"])
        wick_ratios.append(_safe_div(rng - body, rng))
    avg_wick = sum(wick_ratios) / len(wick_ratios) if wick_ratios else 0.5
    structure_score = _clamp(dir_pers * (1 - avg_wick * 0.6))

    # Bias
    bull_signals = 0
    bear_signals = 0
    if ema_spread > 0.001:
        bull_signals += 2
    elif ema_spread < -0.001:
        bear_signals += 2
    if rsi > 55:
        bull_signals += 1
    elif rsi < 45:
        bear_signals += 1
    if momentum > 0.1:
        bull_signals += 1
    elif momentum < -0.1:
        bear_signals += 1
    if regime in (Regime.TRENDING_BULL,):
        bull_signals += 1
    elif regime in (Regime.TRENDING_BEAR,):
        bear_signals += 1

    if bull_signals > bear_signals + 1:
        bias = Bias.BULLISH
    elif bear_signals > bull_signals + 1:
        bias = Bias.BEARISH
    else:
        bias = Bias.NEUTRAL

    # Confidence
    total_signals = bull_signals + bear_signals
    agreement = abs(bull_signals - bear_signals)
    confidence = _clamp(_safe_div(agreement, max(total_signals, 1)) * 0.7 + structure_score * 0.3)

    # Key levels
    high20 = max(b["high"] for b in last20)
    low20 = min(b["low"] for b in last20)
    atr_val = _atr(last20)

    # Invalidation: if bullish, invalidated below recent low; vice versa
    if bias == Bias.BULLISH:
        invalidation = low20
    elif bias == Bias.BEARISH:
        invalidation = high20
    else:
        invalidation = (high20 + low20) / 2

    # Strongest setup detection (simplified)
    strongest_setup: Optional[SetupFamily] = None
    if regime == Regime.RANGING and structure_score > 0.5:
        strongest_setup = SetupFamily.ABSORPTION_REVERSAL
    elif regime in (Regime.TRENDING_BULL, Regime.TRENDING_BEAR) and momentum != 0:
        strongest_setup = SetupFamily.CONTINUATION_PULLBACK

    return TimeframeOpinion(
        timeframe=timeframe,
        bias=bias,
        confidence=round(confidence, 3),
        regime=regime,
        invalidation_level=round(invalidation, 2),
        strongest_setup=strongest_setup,
        key_level_above=round(high20, 2),
        key_level_below=round(low20, 2),
        momentum=round(momentum, 4),
        structure_score=round(structure_score, 3),
        updated_at=now,
    )
