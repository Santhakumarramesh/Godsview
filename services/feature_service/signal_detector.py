"""
GodsView v2 — SK Setup signal detector.

Combines feature vectors + rule-based logic to detect high-probability
entry candidates.  The output is a Signal object ready for ML scoring.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Sequence

from services.feature_service import indicators as ind
from services.feature_service.builder import FEATURE_NAMES, build_feature_vector
from services.shared.types import Bar, Direction, Signal, SignalType


def detect_signal(bars: Sequence[Bar], timeframe: str = "15min") -> Signal | None:
    """
    Detect the latest SK-setup signal from a bar sequence.

    Returns a Signal if a qualifying setup is present on the last bar,
    otherwise None.
    """
    if len(bars) < 55:
        return None

    feat = build_feature_vector(bars)
    if feat is None:
        return None

    # Pre-compute needed scalars
    atr14 = ind.atr(bars, 14)
    ema20 = ind.ema(bars, 20)

    last = bars[-1]
    last_atr = (
        atr14[-1] if atr14 and not (atr14[-1] != atr14[-1]) else (last.high - last.low)
    )
    last_ema = ema20[-1] if ema20 and not (ema20[-1] != ema20[-1]) else last.close

    # ── Trend bias ────────────────────────────────────────────────────────────
    trend_bullish = last.close > last_ema
    trend_bearish = last.close < last_ema

    # ── Order flow ────────────────────────────────────────────────────────────
    of_bullish = (
        feat.get("absorption_bull", 0) > 0 and feat.get("lower_wick_ratio", 0) > 0.35
    )
    of_bearish = (
        feat.get("rejection_bear", 0) > 0 and feat.get("upper_wick_ratio", 0) > 0.35
    )

    # ── S/R proximity ─────────────────────────────────────────────────────────
    near_support = feat.get("near_support", 0) > 0
    near_resistance = feat.get("near_resistance", 0) > 0

    # ── Volume spike ──────────────────────────────────────────────────────────
    vol_spike = feat.get("volume_spike_ratio", 1.0) >= 1.5

    # ── Structure score ───────────────────────────────────────────────────────
    struct_ok = feat.get("structure_score", 0) >= 0.25

    # ── Long setup: absorption_reversal ──────────────────────────────────────
    long_signal = (
        trend_bullish and of_bullish and near_support and vol_spike and struct_ok
    )

    # ── Short setup: liquidity_sweep ─────────────────────────────────────────
    short_signal = (
        trend_bearish and of_bearish and near_resistance and vol_spike and struct_ok
    )

    if not (long_signal or short_signal):
        return None

    direction = Direction.LONG if long_signal else Direction.SHORT
    signal_type = (
        SignalType.ABSORPTION_REVERSAL if long_signal else SignalType.LIQUIDITY_SWEEP
    )

    # ── Entry / Stop / Target calculation ────────────────────────────────────
    if direction == Direction.LONG:
        entry = last.close
        stop = last.low - last_atr * 0.5
        target = entry + (entry - stop) * 2.0  # 2R minimum
    else:
        entry = last.close
        stop = last.high + last_atr * 0.5
        target = entry - (stop - entry) * 2.0

    risk_reward = (
        abs(target - entry) / abs(entry - stop) if abs(entry - stop) > 0 else 0.0
    )

    # ── Confidence ───────────────────────────────────────────────────────────
    confidence_factors = [
        feat.get("structure_score", 0),
        feat.get("volume_spike_ratio", 1.0) / 3.0,  # normalise to ~0-1
        feat.get("absorption_bull", 0)
        if long_signal
        else feat.get("rejection_bear", 0),
        min(risk_reward / 3.0, 1.0),
    ]
    confidence = sum(confidence_factors) / len(confidence_factors)

    return Signal(
        id=str(uuid.uuid4()),
        symbol=last.symbol,
        timeframe=timeframe,
        timestamp=last.timestamp,
        direction=direction,
        signal_type=signal_type,
        entry=round(entry, 6),
        stop=round(stop, 6),
        target=round(target, 6),
        confidence=round(min(confidence, 1.0), 4),
        structure_score=round(feat.get("structure_score", 0.0), 4),
        order_flow_score=round(feat.get("wick_asymmetry", 0.0) + 0.5, 4),
        volume_score=round(min(feat.get("volume_spike_ratio", 1.0) / 3.0, 1.0), 4),
        atr=round(last_atr, 6),
        ema20=round(last_ema, 6),
        risk_reward=round(risk_reward, 2),
        meta={
            "features": {
                k: round(v, 4) for k, v in feat.items() if not k.startswith("__")
            },
            "trend_bullish": trend_bullish,
            "of_bullish": of_bullish,
            "vol_spike": vol_spike,
        },
    )


def batch_detect(
    symbol_bars: dict[str, list[Bar]],
    timeframe: str = "15min",
) -> list[Signal]:
    """Detect signals across multiple symbols and return all found."""
    signals: list[Signal] = []
    for symbol, bars in symbol_bars.items():
        sig = detect_signal(bars, timeframe)
        if sig:
            signals.append(sig)
    return signals
