from __future__ import annotations

from typing import Any

import pandas as pd


def detect_fvg(df: pd.DataFrame, max_gaps: int = 150) -> list[dict[str, Any]]:
    if len(df) < 5:
        return []

    gaps: list[dict[str, Any]] = []
    for i in range(2, len(df)):
        b0 = df.iloc[i - 2]
        b2 = df.iloc[i]

        # Bullish FVG: current low above low-2 high (gap up inefficiency)
        if float(b2["Low"]) > float(b0["High"]):
            low = float(b0["High"])
            high = float(b2["Low"])
            gaps.append(
                {
                    "index": int(i),
                    "time": str(df.index[i]),
                    "side": "bullish",
                    "low": low,
                    "high": high,
                    "size_pct": round((high - low) / max(low, 1e-9), 6),
                }
            )

        # Bearish FVG: current high below low-2 low (gap down inefficiency)
        if float(b2["High"]) < float(b0["Low"]):
            low = float(b2["High"])
            high = float(b0["Low"])
            gaps.append(
                {
                    "index": int(i),
                    "time": str(df.index[i]),
                    "side": "bearish",
                    "low": low,
                    "high": high,
                    "size_pct": round((high - low) / max(high, 1e-9), 6),
                }
            )

    return gaps[-max_gaps:]

