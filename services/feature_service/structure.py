"""
GodsView v2 — Market structure detection.

Detects:
  • Swing highs / swing lows (pivot points)
  • Break of Structure (BOS)
  • Change of Character (CHoCH)
  • Fair Value Gaps (FVG / imbalance)
  • Order blocks
  • Liquidity sweeps (equal highs / lows)
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Sequence

from services.shared.types import Bar


class StructureType(str, Enum):
    SWING_HIGH    = "swing_high"
    SWING_LOW     = "swing_low"
    BOS_BULLISH   = "bos_bullish"
    BOS_BEARISH   = "bos_bearish"
    CHOCH_BULLISH = "choch_bullish"
    CHOCH_BEARISH = "choch_bearish"
    FVG_BULLISH   = "fvg_bullish"
    FVG_BEARISH   = "fvg_bearish"
    ORDER_BLOCK   = "order_block"
    LIQ_SWEEP_HIGH = "liq_sweep_high"
    LIQ_SWEEP_LOW  = "liq_sweep_low"


@dataclass
class StructureEvent:
    bar_index: int
    event_type: StructureType
    price:      float
    high:       float
    low:        float
    strength:   float = 0.0         # 0–1 relative importance
    meta:       dict  = field(default_factory=dict)


# ── Swing pivot detection ─────────────────────────────────────────────────────

def find_swing_pivots(
    bars: Sequence[Bar],
    left:  int = 3,
    right: int = 3,
) -> list[StructureEvent]:
    """
    Detect swing highs and swing lows using a pivot-point algorithm.
    A pivot high requires the bar to have the highest high in the
    left+right window.  Pivot low is the mirror.
    """
    n = len(bars)
    events: list[StructureEvent] = []

    for i in range(left, n - right):
        window_highs = [bars[j].high for j in range(i - left, i + right + 1)]
        window_lows  = [bars[j].low  for j in range(i - left, i + right + 1)]
        center_high  = bars[i].high
        center_low   = bars[i].low

        if center_high == max(window_highs) and window_highs.count(center_high) == 1:
            strength = (center_high - min(window_highs)) / max(window_highs) if max(window_highs) else 0.0
            events.append(StructureEvent(
                bar_index=i,
                event_type=StructureType.SWING_HIGH,
                price=center_high,
                high=bars[i].high,
                low=bars[i].low,
                strength=min(strength, 1.0),
            ))

        if center_low == min(window_lows) and window_lows.count(center_low) == 1:
            strength = (max(window_lows) - center_low) / max(window_lows) if max(window_lows) else 0.0
            events.append(StructureEvent(
                bar_index=i,
                event_type=StructureType.SWING_LOW,
                price=center_low,
                high=bars[i].high,
                low=bars[i].low,
                strength=min(strength, 1.0),
            ))

    return events


# ── Break of Structure / CHoCH ────────────────────────────────────────────────

def find_bos_choch(
    bars: Sequence[Bar],
    pivots: list[StructureEvent] | None = None,
) -> list[StructureEvent]:
    """
    Identify Break of Structure (BOS) and Change of Character (CHoCH).

    BOS = price breaks the last confirmed swing in the direction of the trend.
    CHoCH = price breaks the last swing AGAINST the prevailing structure
            (trend reversal signal).
    """
    if pivots is None:
        pivots = find_swing_pivots(bars)

    swing_highs = sorted(
        [p for p in pivots if p.event_type == StructureType.SWING_HIGH],
        key=lambda p: p.bar_index,
    )
    swing_lows = sorted(
        [p for p in pivots if p.event_type == StructureType.SWING_LOW],
        key=lambda p: p.bar_index,
    )

    events: list[StructureEvent] = []
    n = len(bars)

    for i in range(1, n):
        close = bars[i].close

        # Check BOS bullish — break above last swing high
        relevant_highs = [p for p in swing_highs if p.bar_index < i]
        if relevant_highs:
            last_high = relevant_highs[-1]
            if close > last_high.price:
                # Determine if BOS or CHoCH by checking prior structure
                prior_lows = [p for p in swing_lows if p.bar_index < last_high.bar_index]
                is_choch = bool(prior_lows and prior_lows[-1].price < (
                    swing_lows[-1].price if swing_lows else float("inf")
                ))
                events.append(StructureEvent(
                    bar_index=i,
                    event_type=StructureType.CHOCH_BULLISH if is_choch else StructureType.BOS_BULLISH,
                    price=close,
                    high=bars[i].high,
                    low=bars[i].low,
                    meta={"broke_level": last_high.price},
                ))

        # Check BOS bearish — break below last swing low
        relevant_lows = [p for p in swing_lows if p.bar_index < i]
        if relevant_lows:
            last_low = relevant_lows[-1]
            if close < last_low.price:
                prior_highs = [p for p in swing_highs if p.bar_index < last_low.bar_index]
                is_choch = bool(prior_highs and prior_highs[-1].price > (
                    swing_highs[-1].price if swing_highs else 0.0
                ))
                events.append(StructureEvent(
                    bar_index=i,
                    event_type=StructureType.CHOCH_BEARISH if is_choch else StructureType.BOS_BEARISH,
                    price=close,
                    high=bars[i].high,
                    low=bars[i].low,
                    meta={"broke_level": last_low.price},
                ))

    return events


# ── Fair Value Gaps ───────────────────────────────────────────────────────────

def find_fvgs(bars: Sequence[Bar], min_size_atr_mult: float = 0.3) -> list[StructureEvent]:
    """
    Fair Value Gaps (3-bar imbalance pattern).

    Bullish FVG: low[i+1] > high[i-1]
    Bearish FVG: high[i+1] < low[i-1]
    """
    n = len(bars)
    events: list[StructureEvent] = []

    for i in range(1, n - 1):
        gap_bull = bars[i + 1].low - bars[i - 1].high
        gap_bear = bars[i - 1].low - bars[i + 1].high

        if gap_bull > 0:
            events.append(StructureEvent(
                bar_index=i,
                event_type=StructureType.FVG_BULLISH,
                price=(bars[i - 1].high + bars[i + 1].low) / 2,
                high=bars[i + 1].low,
                low=bars[i - 1].high,
                strength=min(gap_bull / bars[i].close, 1.0),
                meta={"gap_size": round(gap_bull, 6)},
            ))
        elif gap_bear > 0:
            events.append(StructureEvent(
                bar_index=i,
                event_type=StructureType.FVG_BEARISH,
                price=(bars[i - 1].low + bars[i + 1].high) / 2,
                high=bars[i - 1].low,
                low=bars[i + 1].high,
                strength=min(gap_bear / bars[i].close, 1.0),
                meta={"gap_size": round(gap_bear, 6)},
            ))

    return events


# ── Liquidity sweeps ──────────────────────────────────────────────────────────

def find_liquidity_sweeps(
    bars: Sequence[Bar],
    lookback: int = 20,
    tolerance: float = 0.002,
) -> list[StructureEvent]:
    """
    Detect liquidity sweeps (fakeouts above resistance / below support).

    A sweep is identified when a bar wicks beyond the recent high/low
    but closes back inside it.
    """
    n = len(bars)
    events: list[StructureEvent] = []

    for i in range(lookback, n):
        window = bars[i - lookback : i]
        recent_high = max(b.high  for b in window)
        recent_low  = min(b.low   for b in window)
        bar = bars[i]

        # Sweep of highs (wick above, close below)
        if bar.high > recent_high * (1 + tolerance) and bar.close < recent_high:
            events.append(StructureEvent(
                bar_index=i,
                event_type=StructureType.LIQ_SWEEP_HIGH,
                price=bar.high,
                high=bar.high,
                low=bar.low,
                strength=min((bar.high - recent_high) / recent_high, 1.0),
                meta={"swept_level": recent_high, "close": bar.close},
            ))

        # Sweep of lows (wick below, close above)
        if bar.low < recent_low * (1 - tolerance) and bar.close > recent_low:
            events.append(StructureEvent(
                bar_index=i,
                event_type=StructureType.LIQ_SWEEP_LOW,
                price=bar.low,
                high=bar.high,
                low=bar.low,
                strength=min((recent_low - bar.low) / recent_low, 1.0),
                meta={"swept_level": recent_low, "close": bar.close},
            ))

    return events


# ── Composite structure score ─────────────────────────────────────────────────

def compute_structure_score(
    bars: Sequence[Bar],
    bar_index: int,
) -> float:
    """
    Return a 0–1 structure confluence score for a specific bar.
    Higher = more confluent bullish setup.
    """
    if bar_index < 20 or bar_index >= len(bars):
        return 0.0

    window = bars[max(0, bar_index - 50) : bar_index + 1]
    pivots = find_swing_pivots(window, left=2, right=2)
    sweeps = find_liquidity_sweeps(window, lookback=15)
    fvgs   = find_fvgs(window)

    score = 0.0
    # Bullish structure building (+)
    bull_bos   = sum(1 for s in find_bos_choch(window, pivots)
                     if s.event_type in (StructureType.BOS_BULLISH, StructureType.CHOCH_BULLISH))
    bull_sweep = sum(1 for s in sweeps if s.event_type == StructureType.LIQ_SWEEP_LOW)
    bull_fvg   = sum(1 for f in fvgs   if f.event_type == StructureType.FVG_BULLISH)

    score += min(bull_bos, 3)   * 0.20
    score += min(bull_sweep, 2) * 0.25
    score += min(bull_fvg, 2)   * 0.15

    # Trend bias via swing pivots
    highs = sorted([p for p in pivots if p.event_type == StructureType.SWING_HIGH],
                   key=lambda p: p.bar_index)
    lows  = sorted([p for p in pivots if p.event_type == StructureType.SWING_LOW],
                   key=lambda p: p.bar_index)

    if len(highs) >= 2 and highs[-1].price > highs[-2].price:
        score += 0.20  # Higher high
    if len(lows) >= 2 and lows[-1].price > lows[-2].price:
        score += 0.20  # Higher low

    return min(score, 1.0)
