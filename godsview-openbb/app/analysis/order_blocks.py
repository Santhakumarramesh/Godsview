from __future__ import annotations

from typing import Any

import pandas as pd


def detect_order_blocks(df: pd.DataFrame, max_blocks: int = 100) -> list[dict[str, Any]]:
    if len(df) < 8:
        return []

    avg_volume = float(df["Volume"].mean()) if len(df) > 0 else 0.0
    blocks: list[dict[str, Any]] = []

    for i in range(2, len(df) - 2):
        prev = df.iloc[i - 1]
        bar = df.iloc[i]
        n1 = df.iloc[i + 1]
        n2 = df.iloc[i + 2]

        bar_range = max(float(bar["High"] - bar["Low"]), 1e-8)
        body_size = abs(float(bar["Close"] - bar["Open"]))
        body_ratio = body_size / bar_range
        vol_strength = float(bar["Volume"]) / avg_volume if avg_volume > 0 else 1.0

        bullish = (
            float(bar["Close"]) < float(bar["Open"])
            and float(n1["Close"]) > float(n1["Open"])
            and float(n2["Close"]) > float(n2["Open"])
            and float(n1["Close"]) > float(bar["High"])
            and vol_strength > 1.05
        )
        bearish = (
            float(bar["Close"]) > float(bar["Open"])
            and float(n1["Close"]) < float(n1["Open"])
            and float(n2["Close"]) < float(n2["Open"])
            and float(n1["Close"]) < float(bar["Low"])
            and vol_strength > 1.05
        )
        if not bullish and not bearish:
            continue

        low = min(float(bar["Low"]), float(prev["Low"]))
        high = max(float(bar["High"]), float(prev["High"]))
        blocks.append(
            {
                "index": int(i),
                "time": str(df.index[i]),
                "side": "bullish" if bullish else "bearish",
                "low": low,
                "high": high,
                "mid": (low + high) / 2.0,
                "strength": round(min(1.0, vol_strength * 0.5 + (1.0 - body_ratio) * 0.5), 4),
            }
        )

    return blocks[-max_blocks:]

