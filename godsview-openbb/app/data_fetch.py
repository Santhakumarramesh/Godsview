from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from app.config import settings


def _normalize_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        raise ValueError("Historical dataset is empty.")

    normalized = df.copy()
    normalized.columns = [str(c).strip() for c in normalized.columns]

    rename_map = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
        "vwap": "VWAP",
    }
    normalized = normalized.rename(columns={k: v for k, v in rename_map.items() if k in normalized.columns})

    required = ["Open", "High", "Low", "Close", "Volume"]
    for col in required:
        if col not in normalized.columns:
            raise ValueError(f"Missing required price column: {col}")

    numeric_cols = ["Open", "High", "Low", "Close", "Volume"]
    for col in numeric_cols:
        normalized[col] = pd.to_numeric(normalized[col], errors="coerce")

    normalized = normalized.dropna(subset=numeric_cols)
    normalized = normalized.sort_index()
    return normalized


def _fetch_with_openbb(symbol: str, provider: str, interval: str) -> pd.DataFrame:
    from openbb import obb  # Imported lazily for faster startup if unused.

    end_date = datetime.now(timezone.utc).date()
    start_date = end_date - timedelta(days=max(30, settings.lookback * 2))

    attempts: list[dict[str, Any]] = [
        {
            "symbol": symbol,
            "provider": provider,
            "interval": interval.lower(),
            "start_date": start_date.isoformat(),
            "end_date": end_date.isoformat(),
        },
        {
            "symbol": symbol,
            "provider": provider,
            "interval": interval.lower(),
        },
        {
            "symbol": symbol,
            "provider": provider,
        },
    ]

    last_error: Exception | None = None
    for kwargs in attempts:
        try:
            resp = obb.equity.price.historical(**kwargs)
            df = resp.to_df()
            return _normalize_ohlcv(df)
        except Exception as err:  # noqa: BLE001
            last_error = err

    raise RuntimeError(
        f"OpenBB historical fetch failed for {symbol} ({provider}, {interval}). "
        f"Last error: {last_error}"
    )


def _fetch_with_alpaca(symbol: str, interval: str) -> pd.DataFrame:
    if not settings.has_alpaca_keys:
        raise RuntimeError("Alpaca fallback unavailable: missing ALPACA_API_KEY/ALPACA_SECRET_KEY.")

    from alpaca.data import CryptoHistoricalDataClient, StockHistoricalDataClient
    from alpaca.data.requests import CryptoBarsRequest, StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    timeframe = TimeFrame.Day if interval.upper() in {"1D", "D", "DAY"} else TimeFrame.Hour
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=max(30, settings.lookback * 2))

    if symbol.endswith("USD") and len(symbol) >= 6:
        client = CryptoHistoricalDataClient(settings.alpaca_api_key, settings.alpaca_secret_key)
        req = CryptoBarsRequest(symbol_or_symbols=[symbol], timeframe=timeframe, start=start_dt, end=end_dt)
        bars = client.get_crypto_bars(req).df
    else:
        client = StockHistoricalDataClient(settings.alpaca_api_key, settings.alpaca_secret_key)
        req = StockBarsRequest(symbol_or_symbols=[symbol], timeframe=timeframe, start=start_dt, end=end_dt)
        bars = client.get_stock_bars(req).df

    if bars.empty:
        raise RuntimeError("Alpaca returned empty bars.")

    if isinstance(bars.index, pd.MultiIndex):
        bars = bars.reset_index(level=0, drop=True)

    return _normalize_ohlcv(bars)


def fetch_price_history(symbol: str | None = None, interval: str | None = None) -> pd.DataFrame:
    final_symbol = (symbol or settings.symbol).upper()
    final_interval = (interval or settings.timeframe).upper()

    try:
        df = _fetch_with_openbb(final_symbol, settings.openbb_provider, final_interval)
        return df.tail(settings.lookback)
    except Exception:
        # OpenBB is primary; Alpaca fallback improves reliability in environments where
        # OpenBB provider credentials or route support differ.
        df = _fetch_with_alpaca(final_symbol, final_interval)
        return df.tail(settings.lookback)

