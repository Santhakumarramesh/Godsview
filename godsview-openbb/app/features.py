from __future__ import annotations

import numpy as np
import pandas as pd

FEATURE_COLUMNS = [
    "ret_1",
    "ret_5",
    "ret_10",
    "sma_10_gap",
    "sma_20_gap",
    "sma_50_gap",
    "vol_10",
    "vol_20",
    "mom_10",
    "mom_20",
    "hl_range",
    "oc_range",
    "volume_z",
]


def add_features(df: pd.DataFrame) -> pd.DataFrame:
    frame = df.copy()

    frame["ret_1"] = frame["Close"].pct_change(1)
    frame["ret_5"] = frame["Close"].pct_change(5)
    frame["ret_10"] = frame["Close"].pct_change(10)

    frame["sma_10"] = frame["Close"].rolling(10).mean()
    frame["sma_20"] = frame["Close"].rolling(20).mean()
    frame["sma_50"] = frame["Close"].rolling(50).mean()
    frame["sma_10_gap"] = frame["Close"] / frame["sma_10"] - 1.0
    frame["sma_20_gap"] = frame["Close"] / frame["sma_20"] - 1.0
    frame["sma_50_gap"] = frame["Close"] / frame["sma_50"] - 1.0

    frame["vol_10"] = frame["ret_1"].rolling(10).std()
    frame["vol_20"] = frame["ret_1"].rolling(20).std()

    frame["mom_10"] = frame["Close"] / frame["Close"].shift(10) - 1.0
    frame["mom_20"] = frame["Close"] / frame["Close"].shift(20) - 1.0

    frame["hl_range"] = (frame["High"] - frame["Low"]) / frame["Close"]
    frame["oc_range"] = (frame["Close"] - frame["Open"]).abs() / frame["Close"]

    vol_mean = frame["Volume"].rolling(20).mean()
    vol_std = frame["Volume"].rolling(20).std()
    frame["volume_z"] = (frame["Volume"] - vol_mean) / vol_std.replace(0, np.nan)

    # Binary target: next bar close direction.
    frame["target"] = (frame["Close"].shift(-1) > frame["Close"]).astype(int)

    frame = frame.replace([np.inf, -np.inf], np.nan).dropna().copy()
    return frame

