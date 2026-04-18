from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
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
    normalized = normalized.rename(
        columns={k: v for k, v in rename_map.items() if k in normalized.columns}
    )

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
        raise RuntimeError(
            "Alpaca fallback unavailable: missing ALPACA_API_KEY/ALPACA_SECRET_KEY."
        )

    from alpaca.data import CryptoHistoricalDataClient, StockHistoricalDataClient
    from alpaca.data.requests import CryptoBarsRequest, StockBarsRequest
    from alpaca.data.timeframe import TimeFrame

    timeframe = (
        TimeFrame.Day if interval.upper() in {"1D", "D", "DAY"} else TimeFrame.Hour
    )
    end_dt = datetime.now(timezone.utc)
    start_dt = end_dt - timedelta(days=max(30, settings.lookback * 2))

    if symbol.endswith("USD") and len(symbol) >= 6:
        client = CryptoHistoricalDataClient(
            settings.alpaca_api_key, settings.alpaca_secret_key
        )
        req = CryptoBarsRequest(
            symbol_or_symbols=[symbol], timeframe=timeframe, start=start_dt, end=end_dt
        )
        bars = client.get_crypto_bars(req).df
    else:
        client = StockHistoricalDataClient(
            settings.alpaca_api_key, settings.alpaca_secret_key
        )
        req = StockBarsRequest(
            symbol_or_symbols=[symbol], timeframe=timeframe, start=start_dt, end=end_dt
        )
        bars = client.get_stock_bars(req).df

    if bars.empty:
        raise RuntimeError("Alpaca returned empty bars.")

    if isinstance(bars.index, pd.MultiIndex):
        bars = bars.reset_index(level=0, drop=True)

    return _normalize_ohlcv(bars)


def _generate_synthetic_ohlcv(symbol: str, interval: str) -> pd.DataFrame:
    bars = max(settings.lookback, 220)
    interval_u = interval.upper()
    if interval_u in {"1M", "5M", "15M", "30M"}:
        freq = "15min"
    elif interval_u in {"1H", "H", "HOUR"}:
        freq = "1h"
    else:
        freq = "1D"

    end_ts = pd.Timestamp(datetime.now(timezone.utc))
    index = pd.date_range(end=end_ts, periods=bars, freq=freq, tz="UTC")

    # Deterministic synthetic path per symbol for stable demo runs.
    seed = sum(ord(ch) for ch in symbol) + len(interval_u) * 97
    rng = np.random.default_rng(seed)
    drift = 0.0004 if symbol.endswith("USD") else 0.00025
    noise = rng.normal(loc=drift, scale=0.008, size=bars)
    base_price = 100.0 + (seed % 70)
    close = base_price * np.exp(np.cumsum(noise))
    open_ = np.roll(close, 1)
    open_[0] = close[0] * (1 - 0.002)
    high = np.maximum(open_, close) * (1 + rng.uniform(0.0008, 0.006, size=bars))
    low = np.minimum(open_, close) * (1 - rng.uniform(0.0008, 0.006, size=bars))
    volume = np.abs(rng.normal(loc=5_000, scale=1_600, size=bars)) + 1_000

    df = pd.DataFrame(
        {
            "Open": open_,
            "High": high,
            "Low": low,
            "Close": close,
            "Volume": volume,
        },
        index=index,
    )
    return _normalize_ohlcv(df)


def fetch_price_history(
    symbol: str | None = None, interval: str | None = None
) -> pd.DataFrame:
    final_symbol = (symbol or settings.symbol).upper()
    final_interval = (interval or settings.timeframe).upper()

    try:
        df = _fetch_with_openbb(final_symbol, settings.openbb_provider, final_interval)
        return df.tail(settings.lookback)
    except Exception as openbb_err:
        # OpenBB is primary; Alpaca fallback improves reliability in environments where
        # OpenBB provider credentials or route support differ.
        try:
            df = _fetch_with_alpaca(final_symbol, final_interval)
            return df.tail(settings.lookback)
        except Exception as alpaca_err:
            if settings.allow_synthetic_data_fallback:
                synthetic = _generate_synthetic_ohlcv(final_symbol, final_interval)
                synthetic.attrs["data_source"] = "synthetic_fallback"
                synthetic.attrs["openbb_error"] = str(openbb_err)
                synthetic.attrs["alpaca_error"] = str(alpaca_err)
                return synthetic.tail(settings.lookback)
            raise RuntimeError(
                "Price history fetch failed via OpenBB and Alpaca fallback. "
                f"OpenBB error: {openbb_err}. Alpaca error: {alpaca_err}."
            ) from alpaca_err
