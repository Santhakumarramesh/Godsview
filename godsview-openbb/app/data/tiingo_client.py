from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd
import requests

from app.config import settings
from app.data.cache import cached


def _to_tiingo_symbol(symbol: str) -> str:
    cleaned = symbol.upper().replace("/", "")
    # Tiingo equity route expects stock tickers; crypto pairs are handled elsewhere.
    return cleaned


def _normalize_tiingo_df(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["Open", "High", "Low", "Close", "Volume"])

    df = pd.DataFrame(rows)
    rename_map = {
        "open": "Open",
        "high": "High",
        "low": "Low",
        "close": "Close",
        "volume": "Volume",
        "date": "Date",
    }
    df = df.rename(columns=rename_map)
    if "Date" in df.columns:
        df["Date"] = pd.to_datetime(df["Date"], utc=True, errors="coerce")
        df = df.dropna(subset=["Date"]).set_index("Date")
    for col in ["Open", "High", "Low", "Close", "Volume"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
    df = df.dropna(subset=["Open", "High", "Low", "Close", "Volume"]).sort_index()
    return df


def get_tiingo_ohlcv(symbol: str, *, lookback: int | None = None) -> dict[str, Any]:
    lookback = int(lookback or settings.lookback)
    ticker = _to_tiingo_symbol(symbol)
    cache_key = f"tiingo:ohlcv:{ticker}:{lookback}"

    def _load() -> dict[str, Any]:
        if not settings.tiingo_api_key:
            return {
                "available": False,
                "source": "tiingo",
                "reason": "missing_tiingo_api_key",
                "symbol": ticker,
                "dataframe": pd.DataFrame(),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }
        if ticker.endswith("USD") and len(ticker) > 5:
            # Keep crypto routed through OpenBB/Alpaca for now.
            return {
                "available": False,
                "source": "tiingo",
                "reason": "crypto_symbol_not_supported_by_equity_route",
                "symbol": ticker,
                "dataframe": pd.DataFrame(),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        end_date = datetime.now(timezone.utc).date()
        start_date = end_date - timedelta(days=max(30, lookback * 2))
        url = f"https://api.tiingo.com/tiingo/daily/{ticker}/prices"
        headers = {"Content-Type": "application/json", "Authorization": f"Token {settings.tiingo_api_key}"}
        params = {"startDate": start_date.isoformat(), "endDate": end_date.isoformat(), "resampleFreq": "daily"}
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            return {
                "available": False,
                "source": "tiingo",
                "reason": f"http_{resp.status_code}",
                "symbol": ticker,
                "dataframe": pd.DataFrame(),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            }

        rows = resp.json()
        df = _normalize_tiingo_df(rows)
        return {
            "available": not df.empty,
            "source": "tiingo",
            "reason": "ok" if not df.empty else "empty_response",
            "symbol": ticker,
            "dataframe": df.tail(lookback),
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

    return cached(cache_key, ttl_seconds=60, loader=_load)

