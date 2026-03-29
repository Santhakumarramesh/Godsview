from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any

import pandas as pd


@dataclass
class SwingPoint:
    index: int
    ts: str
    price: float
    kind: str  # "high" | "low"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def detect_swings(df: pd.DataFrame, left: int = 2, right: int = 2) -> tuple[list[SwingPoint], list[SwingPoint]]:
    highs = df["High"].tolist()
    lows = df["Low"].tolist()
    idx = list(df.index)

    swing_highs: list[SwingPoint] = []
    swing_lows: list[SwingPoint] = []

    start = left
    end = len(df) - right
    for i in range(start, end):
        h = highs[i]
        l = lows[i]

        left_high = max(highs[i - left : i])
        right_high = max(highs[i + 1 : i + 1 + right])
        if h > left_high and h > right_high:
            swing_highs.append(SwingPoint(index=i, ts=str(idx[i]), price=float(h), kind="high"))

        left_low = min(lows[i - left : i])
        right_low = min(lows[i + 1 : i + 1 + right])
        if l < left_low and l < right_low:
            swing_lows.append(SwingPoint(index=i, ts=str(idx[i]), price=float(l), kind="low"))

    return swing_highs, swing_lows


def analyze_structure(df: pd.DataFrame) -> dict[str, Any]:
    if len(df) < 30:
        return {
            "trend": "unknown",
            "bos": False,
            "choch": False,
            "bos_direction": "none",
            "swing_highs": [],
            "swing_lows": [],
            "invalidation": None,
            "structure_score": 0.0,
        }

    closes = df["Close"].tolist()
    trend_ret = closes[-1] / closes[-20] - 1.0
    trend = "range"
    if trend_ret > 0.02:
        trend = "bullish"
    elif trend_ret < -0.02:
        trend = "bearish"

    swing_highs, swing_lows = detect_swings(df)
    last_high = swing_highs[-1].price if swing_highs else None
    last_low = swing_lows[-1].price if swing_lows else None
    last_close = float(closes[-1])

    bos = False
    bos_direction = "none"
    if last_high is not None and last_close > last_high:
        bos = True
        bos_direction = "bullish"
    elif last_low is not None and last_close < last_low:
        bos = True
        bos_direction = "bearish"

    choch = bos and ((trend == "bullish" and bos_direction == "bearish") or (trend == "bearish" and bos_direction == "bullish"))

    score = 0.35
    if trend != "range":
        score += 0.2
    if bos:
        score += 0.25
    if choch:
        score += 0.1
    score += min(abs(trend_ret) * 2.5, 0.1)
    score = round(max(0.0, min(score, 1.0)), 4)

    invalidation = None
    if bos_direction == "bullish" and last_low is not None:
        invalidation = float(last_low)
    elif bos_direction == "bearish" and last_high is not None:
        invalidation = float(last_high)

    return {
        "trend": trend,
        "trend_return_20": float(trend_ret),
        "bos": bos,
        "choch": choch,
        "bos_direction": bos_direction,
        "swing_highs": [sp.to_dict() for sp in swing_highs[-20:]],
        "swing_lows": [sp.to_dict() for sp in swing_lows[-20:]],
        "invalidation": invalidation,
        "structure_score": score,
    }

