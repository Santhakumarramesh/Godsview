"""
GodsView — Regime Detection Engine

Multi-method ensemble classifier that identifies market regime:
  TREND_UP, TREND_DOWN, RANGE, COMPRESSION, EXPANSION, CHAOTIC

Detection methods (weighted voting):
  1. ADX-based trend detection  (25%)
  2. Volatility regime (ATR + BB width) (20%)
  3. Moving average alignment (25%)
  4. Price action structure (HH/HL vs LH/LL) (20%)
  5. Volume confirmation (10%)
"""
from __future__ import annotations

import math
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Sequence

logger = logging.getLogger("godsview.regime_detector")


class Regime(str, Enum):
    TREND_UP = "TREND_UP"
    TREND_DOWN = "TREND_DOWN"
    RANGE = "RANGE"
    COMPRESSION = "COMPRESSION"
    EXPANSION = "EXPANSION"
    CHAOTIC = "CHAOTIC"


@dataclass
class RegimeAnalysis:
    """Output of regime detection."""
    current_regime: Regime
    confidence: float  # 0–1
    regime_scores: dict[str, float] = field(default_factory=dict)
    regime_duration_bars: int = 0
    transition_probability: float = 0.0
    supporting_evidence: list[str] = field(default_factory=list)


# ── Indicator helpers (self-contained, no external deps) ──────────────────────


def _ema(closes: list[float], period: int) -> list[float]:
    if not closes:
        return []
    result = [closes[0]]
    k = 2.0 / (period + 1)
    for i in range(1, len(closes)):
        result.append(closes[i] * k + result[-1] * (1 - k))
    return result


def _atr(highs: list[float], lows: list[float], closes: list[float], period: int) -> list[float]:
    n = len(closes)
    if n < 2:
        return [0.0] * n
    tr = [highs[0] - lows[0]]
    for i in range(1, n):
        tr.append(max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        ))
    return _ema(tr, period)


def _adx(highs: list[float], lows: list[float], closes: list[float], period: int = 14) -> tuple[list[float], list[float], list[float]]:
    """Returns (adx, di_plus, di_minus) arrays."""
    n = len(closes)
    if n < period + 1:
        z = [0.0] * n
        return z, z, z

    plus_dm = [0.0]
    minus_dm = [0.0]
    for i in range(1, n):
        up = highs[i] - highs[i - 1]
        down = lows[i - 1] - lows[i]
        plus_dm.append(max(up, 0) if up > down else 0.0)
        minus_dm.append(max(down, 0) if down > up else 0.0)

    atr_vals = _atr(highs, lows, closes, period)
    sm_plus = _ema(plus_dm, period)
    sm_minus = _ema(minus_dm, period)

    di_plus = []
    di_minus = []
    dx = []
    for i in range(n):
        a = atr_vals[i] if atr_vals[i] > 0 else 1e-10
        dp = (sm_plus[i] / a) * 100
        dm = (sm_minus[i] / a) * 100
        di_plus.append(dp)
        di_minus.append(dm)
        s = dp + dm
        dx.append(abs(dp - dm) / s * 100 if s > 0 else 0.0)

    adx = _ema(dx, period)
    return adx, di_plus, di_minus


def _bollinger_width(closes: list[float], period: int = 20) -> list[float]:
    n = len(closes)
    widths = [0.0] * n
    for i in range(period - 1, n):
        window = closes[i - period + 1 : i + 1]
        mean = sum(window) / period
        variance = sum((x - mean) ** 2 for x in window) / period
        std = math.sqrt(variance)
        widths[i] = (2 * std * 2) / mean if mean > 0 else 0.0  # 2-std BB width as pct
    return widths


# ── Detection Methods ─────────────────────────────────────────────────────────


def _method_adx(
    adx_vals: list[float], di_plus: list[float], di_minus: list[float]
) -> dict[str, float]:
    """ADX-based regime scoring."""
    if not adx_vals:
        return {r.value: 0.0 for r in Regime}

    adx = adx_vals[-1]
    dp = di_plus[-1]
    dm = di_minus[-1]

    scores: dict[str, float] = {r.value: 0.0 for r in Regime}

    if adx > 25:
        if dp > dm:
            scores["TREND_UP"] = min(1.0, adx / 50)
        else:
            scores["TREND_DOWN"] = min(1.0, adx / 50)
    elif adx < 20:
        scores["RANGE"] = 1.0 - (adx / 20)
    else:
        scores["RANGE"] = 0.3
        if dp > dm:
            scores["TREND_UP"] = 0.3
        else:
            scores["TREND_DOWN"] = 0.3

    return scores


def _method_volatility(
    atr_vals: list[float], bb_widths: list[float], closes: list[float]
) -> dict[str, float]:
    """Volatility-based regime scoring."""
    scores: dict[str, float] = {r.value: 0.0 for r in Regime}
    if len(atr_vals) < 20 or len(bb_widths) < 20:
        return scores

    curr_atr = atr_vals[-1]
    avg_atr = sum(atr_vals[-20:]) / 20

    curr_bb = bb_widths[-1]
    recent_bb = bb_widths[-5:]

    # Compression: BB width decreasing
    if len(recent_bb) >= 5 and all(recent_bb[i] <= recent_bb[i - 1] for i in range(1, 5)):
        scores["COMPRESSION"] = 0.8

    # Expansion: BB width increasing rapidly
    if len(recent_bb) >= 3 and recent_bb[-1] > recent_bb[-3] * 1.3:
        scores["EXPANSION"] = 0.7

    # Chaotic: ATR > 1.5x average
    if avg_atr > 0 and curr_atr > avg_atr * 1.5:
        scores["CHAOTIC"] = min(1.0, (curr_atr / avg_atr - 1.0))

    return scores


def _method_ma_alignment(closes: list[float]) -> dict[str, float]:
    """Moving average alignment scoring."""
    scores: dict[str, float] = {r.value: 0.0 for r in Regime}
    if len(closes) < 50:
        return scores

    ema9 = _ema(closes, 9)[-1]
    ema21 = _ema(closes, 21)[-1]
    ema50 = _ema(closes, 50)[-1]

    if ema9 > ema21 > ema50:
        scores["TREND_UP"] = 0.9
    elif ema9 < ema21 < ema50:
        scores["TREND_DOWN"] = 0.9
    else:
        scores["RANGE"] = 0.6

    return scores


def _method_structure(highs: list[float], lows: list[float]) -> dict[str, float]:
    """Price action structure (HH/HL vs LH/LL)."""
    scores: dict[str, float] = {r.value: 0.0 for r in Regime}
    n = len(highs)
    if n < 20:
        return scores

    # Find recent swing highs/lows (simplified: local extremes over 5-bar window)
    swing_highs: list[float] = []
    swing_lows: list[float] = []
    for i in range(2, n - 2):
        if highs[i] >= max(highs[i - 2 : i] + highs[i + 1 : i + 3]):
            swing_highs.append(highs[i])
        if lows[i] <= min(lows[i - 2 : i] + lows[i + 1 : i + 3]):
            swing_lows.append(lows[i])

    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        hh = swing_highs[-1] > swing_highs[-2]
        hl = swing_lows[-1] > swing_lows[-2]
        lh = swing_highs[-1] < swing_highs[-2]
        ll = swing_lows[-1] < swing_lows[-2]

        if hh and hl:
            scores["TREND_UP"] = 0.85
        elif lh and ll:
            scores["TREND_DOWN"] = 0.85
        else:
            scores["RANGE"] = 0.6

    return scores


def _method_volume(volumes: list[float], closes: list[float]) -> dict[str, float]:
    """Volume confirmation scoring."""
    scores: dict[str, float] = {r.value: 0.0 for r in Regime}
    if len(volumes) < 20:
        return scores

    avg_vol = sum(volumes[-20:]) / 20
    curr_vol = volumes[-1]
    price_change = closes[-1] - closes[-5] if len(closes) >= 5 else 0.0

    # Rising volume on trend moves confirms trend
    if curr_vol > avg_vol * 1.2 and abs(price_change) > 0:
        if price_change > 0:
            scores["TREND_UP"] = 0.6
        else:
            scores["TREND_DOWN"] = 0.6

    # Falling volume → range
    if curr_vol < avg_vol * 0.7:
        scores["RANGE"] = 0.5

    # Spike volume → possible regime change
    if avg_vol > 0 and curr_vol > avg_vol * 2.5:
        scores["CHAOTIC"] = 0.4

    return scores


# ── Main Detector ─────────────────────────────────────────────────────────────

# Method weights
_WEIGHTS = {
    "adx": 0.25,
    "volatility": 0.20,
    "ma_alignment": 0.25,
    "structure": 0.20,
    "volume": 0.10,
}


def detect_regime(
    opens: list[float],
    highs: list[float],
    lows: list[float],
    closes: list[float],
    volumes: list[float],
    prev_regime: Regime | None = None,
    prev_regime_bars: int = 0,
) -> RegimeAnalysis:
    """
    Detect the current market regime from OHLCV data.

    Parameters
    ----------
    opens, highs, lows, closes, volumes : list[float]
        OHLCV arrays (must be same length, chronological order).
    prev_regime : optional previous regime for duration tracking.
    prev_regime_bars : bars spent in prev_regime.

    Returns
    -------
    RegimeAnalysis with the detected regime, confidence, and evidence.
    """
    n = len(closes)
    if n < 20:
        return RegimeAnalysis(
            current_regime=Regime.RANGE,
            confidence=0.0,
            supporting_evidence=["insufficient data (< 20 bars)"],
        )

    # Compute indicators
    atr_vals = _atr(highs, lows, closes, 14)
    adx_vals, di_plus, di_minus = _adx(highs, lows, closes, 14)
    bb_widths = _bollinger_width(closes, 20)

    # Run methods
    method_scores = {
        "adx": _method_adx(adx_vals, di_plus, di_minus),
        "volatility": _method_volatility(atr_vals, bb_widths, closes),
        "ma_alignment": _method_ma_alignment(closes),
        "structure": _method_structure(highs, lows),
        "volume": _method_volume(volumes, closes),
    }

    # Weighted combination
    combined: dict[str, float] = {r.value: 0.0 for r in Regime}
    evidence: list[str] = []

    for method_name, scores in method_scores.items():
        w = _WEIGHTS[method_name]
        top_regime = max(scores, key=scores.get) if any(v > 0 for v in scores.values()) else None
        if top_regime and scores[top_regime] > 0.3:
            evidence.append(f"{method_name} → {top_regime} ({scores[top_regime]:.2f})")
        for regime, score in scores.items():
            combined[regime] += score * w

    # Pick winner
    best_regime = max(combined, key=combined.get)  # type: ignore[arg-type]
    best_score = combined[best_regime]
    total = sum(combined.values())
    confidence = best_score / total if total > 0 else 0.0

    # Duration tracking
    regime_enum = Regime(best_regime)
    duration = (prev_regime_bars + 1) if prev_regime == regime_enum else 1

    # Transition probability (higher when confidence is low or duration is long)
    transition_prob = max(0.0, min(1.0, (1.0 - confidence) * 0.5 + (duration / 100) * 0.3))

    return RegimeAnalysis(
        current_regime=regime_enum,
        confidence=round(confidence, 4),
        regime_scores={k: round(v, 4) for k, v in combined.items()},
        regime_duration_bars=duration,
        transition_probability=round(transition_prob, 4),
        supporting_evidence=evidence,
    )


def detect_regime_from_bars(bars: list[dict], **kwargs) -> RegimeAnalysis:
    """
    Convenience: detect regime from a list of bar dicts.

    Each dict should have keys: Open/open, High/high, Low/low, Close/close, Volume/volume.
    """
    def _g(bar: dict, *keys: str) -> float:
        for k in keys:
            if k in bar:
                return float(bar[k])
        return 0.0

    opens = [_g(b, "Open", "open", "o") for b in bars]
    highs = [_g(b, "High", "high", "h") for b in bars]
    lows = [_g(b, "Low", "low", "l") for b in bars]
    closes = [_g(b, "Close", "close", "c") for b in bars]
    volumes = [_g(b, "Volume", "volume", "v") for b in bars]

    return detect_regime(opens, highs, lows, closes, volumes, **kwargs)
