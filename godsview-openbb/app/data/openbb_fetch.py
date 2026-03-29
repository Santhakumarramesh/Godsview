from __future__ import annotations

import pandas as pd

from app.data_fetch import fetch_price_history


def get_ohlcv(symbol: str, timeframe: str, lookback: int | None = None) -> pd.DataFrame:
    df = fetch_price_history(symbol, timeframe)
    if lookback is None or lookback <= 0:
        return df
    return df.tail(lookback)

