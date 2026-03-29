from __future__ import annotations

from typing import Any

import pandas as pd


def detect_equal_levels(df: pd.DataFrame, tolerance_pct: float = 0.0015) -> dict[str, list[dict[str, Any]]]:
    highs = df["High"].tolist()
    lows = df["Low"].tolist()
    idx = list(df.index)

    equal_highs: list[dict[str, Any]] = []
    equal_lows: list[dict[str, Any]] = []

    for i in range(2, len(df)):
        h = float(highs[i])
        l = float(lows[i])
        for j in range(max(0, i - 40), i):
            h2 = float(highs[j])
            l2 = float(lows[j])
            if abs(h - h2) / max(h2, 1e-9) <= tolerance_pct:
                equal_highs.append({"index_a": j, "index_b": i, "time": str(idx[i]), "price": (h + h2) / 2.0})
            if abs(l - l2) / max(l2, 1e-9) <= tolerance_pct:
                equal_lows.append({"index_a": j, "index_b": i, "time": str(idx[i]), "price": (l + l2) / 2.0})

    return {
        "equal_highs": equal_highs[-50:],
        "equal_lows": equal_lows[-50:],
    }

