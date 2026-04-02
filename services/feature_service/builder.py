"""
GodsView v2 — Feature builder pipeline.

Converts a list[Bar] into a feature matrix (list[dict[str, float]])
suitable for ML training, signal scoring, and recall storage.

Feature groups:
  price     — OHLC ratios, bar body/wick analysis
  momentum  — EMA bias, RSI, MACD
  volatility — ATR normalised, Bollinger width
  volume    — volume spike, VWAP deviation
  structure — swing pivots, BOS, FVG, liquidity sweeps
  sk_setup  — SK-specific pattern features (order flow, absorption)
"""
from __future__ import annotations

import math
from typing import Any, Sequence

from services.shared.types import Bar
from services.feature_service import indicators as ind
from services.feature_service.structure import (
    find_swing_pivots,
    find_liquidity_sweeps,
    find_fvgs,
    compute_structure_score,
    StructureType,
)

_NaN = float("nan")


def _safe(val: float, default: float = 0.0) -> float:
    return val if not math.isnan(val) else default


# ── Individual feature groups ─────────────────────────────────────────────────

def _price_features(bars: Sequence[Bar], i: int) -> dict[str, float]:
    b = bars[i]
    prev = bars[i - 1] if i > 0 else b
    rng = b.high - b.low or 1e-8

    body = abs(b.close - b.open)
    upper_wick = b.high - max(b.open, b.close)
    lower_wick = min(b.open, b.close) - b.low

    return {
        "body_ratio":     body / rng,
        "upper_wick_ratio": upper_wick / rng,
        "lower_wick_ratio": lower_wick / rng,
        "bullish_bar":    float(b.close >= b.open),
        "gap_pct":        (b.open - prev.close) / prev.close if prev.close else 0.0,
        "close_position": (b.close - b.low) / rng,    # 0=low, 1=high
        "bar_range_pct":  rng / prev.close if prev.close else 0.0,
    }


def _momentum_features(
    bars: Sequence[Bar],
    i: int,
    ema20_arr:  list[float],
    ema50_arr:  list[float],
    rsi14_arr:  list[float],
    macd_line:  list[float],
    macd_sig:   list[float],
) -> dict[str, float]:
    close = bars[i].close
    e20   = _safe(ema20_arr[i])
    e50   = _safe(ema50_arr[i])

    ema20_dist = (close - e20) / e20 if e20 else 0.0
    ema50_dist = (close - e50) / e50 if e50 else 0.0
    ema_slope  = (e20 - _safe(ema20_arr[i - 1])) / e20 if (e20 and i > 0) else 0.0

    ml = _safe(macd_line[i])
    ms = _safe(macd_sig[i])

    return {
        "ema20_dist":   ema20_dist,
        "ema50_dist":   ema50_dist,
        "ema20_slope":  ema_slope,
        "above_ema20":  float(close > e20),
        "above_ema50":  float(close > e50),
        "rsi14":        _safe(rsi14_arr[i], 50.0) / 100.0,
        "macd_diff":    ml - ms,
        "macd_positive": float(ml > 0),
    }


def _volatility_features(
    bars: Sequence[Bar],
    i: int,
    atr14_arr: list[float],
    bb_upper:  list[float],
    bb_lower:  list[float],
) -> dict[str, float]:
    close = bars[i].close
    a14   = _safe(atr14_arr[i], 1e-8)
    bu    = _safe(bb_upper[i])
    bl    = _safe(bb_lower[i])
    bb_width = (bu - bl) / close if close else 0.0
    bb_pct = (close - bl) / (bu - bl) if (bu - bl) else 0.5

    return {
        "atr14_pct":   a14 / close if close else 0.0,
        "bb_width":    bb_width,
        "bb_pct":      bb_pct,
        "near_bb_upper": float(bb_pct > 0.9),
        "near_bb_lower": float(bb_pct < 0.1),
    }


def _volume_features(
    bars: Sequence[Bar],
    i: int,
    vol_sma20: list[float],
    vwap_arr:  list[float],
) -> dict[str, float]:
    b   = bars[i]
    avg = _safe(vol_sma20[i], 1.0)
    vw  = _safe(vwap_arr[i])

    return {
        "volume_spike_ratio":  b.volume / avg if avg else 1.0,
        "is_volume_spike":     float(b.volume > avg * 1.5),
        "vwap_deviation_pct":  (b.close - vw) / vw if vw else 0.0,
        "above_vwap":          float(b.close > vw) if vw else 0.5,
    }


def _structure_features(bars: Sequence[Bar], i: int) -> dict[str, float]:
    score = compute_structure_score(bars, i)
    window = bars[max(0, i - 20) : i + 1]

    sweeps = find_liquidity_sweeps(window, lookback=min(15, len(window) - 1))
    fvgs   = find_fvgs(window)

    bull_sweep = sum(1 for s in sweeps if s.event_type == StructureType.LIQ_SWEEP_LOW)
    bear_sweep = sum(1 for s in sweeps if s.event_type == StructureType.LIQ_SWEEP_HIGH)
    bull_fvg   = sum(1 for f in fvgs   if f.event_type == StructureType.FVG_BULLISH)
    bear_fvg   = sum(1 for f in fvgs   if f.event_type == StructureType.FVG_BEARISH)

    return {
        "structure_score":  score,
        "bull_sweep_cnt":   float(min(bull_sweep, 3)),
        "bear_sweep_cnt":   float(min(bear_sweep, 3)),
        "bull_fvg_cnt":     float(min(bull_fvg, 3)),
        "bear_fvg_cnt":     float(min(bear_fvg, 3)),
    }


def _sk_setup_features(
    bars: Sequence[Bar],
    i: int,
    atr14_arr: list[float],
) -> dict[str, float]:
    """SK-specific order-flow + setup pattern features."""
    b   = bars[i]
    atr = _safe(atr14_arr[i], b.high - b.low or 1e-8)
    rng = b.high - b.low or 1e-8

    body       = abs(b.close - b.open)
    upper_wick = b.high - max(b.open, b.close)
    lower_wick = min(b.open, b.close) - b.low

    # Absorption: large lower wick, close near high → buyers absorbing sellers
    absorption_bull = (lower_wick / rng) > 0.4 and (b.close - b.low) / rng > 0.6

    # Rejection: large upper wick, close near low → sellers rejecting buyers
    rejection_bear  = (upper_wick / rng) > 0.4 and (b.high - b.close) / rng > 0.6

    # Lookback S/R proximity
    lookback = bars[max(0, i - 20) : i]
    near_low  = bool(lookback and abs(b.low  - min(lb.low  for lb in lookback)) < atr * 0.5)
    near_high = bool(lookback and abs(b.high - max(lb.high for lb in lookback)) < atr * 0.5)

    return {
        "absorption_bull":  float(absorption_bull),
        "rejection_bear":   float(rejection_bear),
        "near_support":     float(near_low),
        "near_resistance":  float(near_high),
        "body_to_atr":      body / atr if atr else 0.0,
        "range_to_atr":     rng / atr  if atr else 0.0,
        "wick_asymmetry":   (lower_wick - upper_wick) / rng,  # +ve = bullish
    }


# ── Main builder ──────────────────────────────────────────────────────────────

def build_features(bars: Sequence[Bar], min_lookback: int = 55) -> list[dict[str, float]]:
    """
    Build a feature row for EVERY bar that has sufficient lookback.

    Returns a list of dicts; callers can convert to a DataFrame with
    pd.DataFrame(build_features(bars)).
    """
    n = len(bars)
    if n < min_lookback:
        return []

    # Pre-compute indicator arrays (vectorised over all bars)
    ema20  = ind.ema(bars, 20)
    ema50  = ind.ema(bars, 50)
    rsi14  = ind.rsi(bars, 14)
    atr14  = ind.atr(bars, 14)
    vol_sm = ind.volume_sma(bars, 20)
    vwap_a = ind.vwap(bars)
    ml, ms, _ = ind.macd(bars)
    bb_u, _, bb_l = ind.bollinger(bars, 20)

    rows: list[dict[str, float]] = []

    for i in range(min_lookback, n):
        feat: dict[str, float] = {}
        feat.update(_price_features(bars, i))
        feat.update(_momentum_features(bars, i, ema20, ema50, rsi14, ml, ms))
        feat.update(_volatility_features(bars, i, atr14, bb_u, bb_l))
        feat.update(_volume_features(bars, i, vol_sm, vwap_a))
        feat.update(_structure_features(bars, i))
        feat.update(_sk_setup_features(bars, i, atr14))

        # Metadata (not fed to ML model, but useful for filtering/logging)
        feat["__bar_index"] = float(i)
        feat["__timestamp"] = bars[i].timestamp.timestamp()

        rows.append(feat)

    return rows


def build_feature_vector(bars: Sequence[Bar]) -> dict[str, float] | None:
    """
    Build a single feature vector for the LATEST bar.
    Returns None if insufficient bars.
    """
    rows = build_features(bars)
    return rows[-1] if rows else None


# ── Feature names (for ML training column ordering) ───────────────────────────

FEATURE_NAMES: list[str] = [
    # price
    "body_ratio", "upper_wick_ratio", "lower_wick_ratio",
    "bullish_bar", "gap_pct", "close_position", "bar_range_pct",
    # momentum
    "ema20_dist", "ema50_dist", "ema20_slope",
    "above_ema20", "above_ema50",
    "rsi14", "macd_diff", "macd_positive",
    # volatility
    "atr14_pct", "bb_width", "bb_pct", "near_bb_upper", "near_bb_lower",
    # volume
    "volume_spike_ratio", "is_volume_spike", "vwap_deviation_pct", "above_vwap",
    # structure
    "structure_score", "bull_sweep_cnt", "bear_sweep_cnt",
    "bull_fvg_cnt", "bear_fvg_cnt",
    # sk_setup
    "absorption_bull", "rejection_bear", "near_support", "near_resistance",
    "body_to_atr", "range_to_atr", "wick_asymmetry",
]
