from __future__ import annotations

from typing import Any

import pandas as pd


def detect_liquidity_sweep(
    df: pd.DataFrame,
    *,
    lookback: int = 40,
    reversal_bars: int = 3,
) -> dict[str, Any]:
    if len(df) < lookback + reversal_bars + 5:
        return {"detected": False, "direction": "none", "reason": "insufficient_bars"}

    recent = df.tail(lookback + reversal_bars + 2).copy()
    pivot = recent.iloc[:-reversal_bars]
    post = recent.iloc[-reversal_bars:]

    prev_high = float(pivot["High"].max())
    prev_low = float(pivot["Low"].min())
    post_high = float(post["High"].max())
    post_low = float(post["Low"].min())
    post_close = float(post["Close"].iloc[-1])

    swept_high = post_high > prev_high
    swept_low = post_low < prev_low

    if swept_high and post_close < prev_high:
        return {
            "detected": True,
            "direction": "bearish",
            "swept_level": prev_high,
            "close": post_close,
            "reason": "high_sweep_rejected",
        }
    if swept_low and post_close > prev_low:
        return {
            "detected": True,
            "direction": "bullish",
            "swept_level": prev_low,
            "close": post_close,
            "reason": "low_sweep_rejected",
        }

    return {
        "detected": False,
        "direction": "none",
        "swept_level": prev_high if swept_high else (prev_low if swept_low else None),
        "close": post_close,
        "reason": "no_rejection_after_sweep",
    }

