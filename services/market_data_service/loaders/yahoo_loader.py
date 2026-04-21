"""
GodsView v2 — Yahoo Finance loader (yfinance).

Used as a free data source for backtesting, model training, and
reference data when Alpaca credentials are absent.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from services.shared.logging import get_logger
from services.shared.types import Bar

log = get_logger(__name__)

# Yahoo interval mapping
_YF_INTERVAL: dict[str, str] = {
    "1min":  "1m",
    "5min":  "5m",
    "15min": "15m",
    "30min": "30m",
    "1hour": "1h",
    "2hour": "2h",
    "4hour": "4h",
    "1day":  "1d",
    "1week": "1wk",
}

# yfinance max lookback per interval
_MAX_LOOKBACK: dict[str, int] = {
    "1m": 7, "5m": 60, "15m": 60, "30m": 60,
    "1h": 730, "2h": 730, "4h": 730,
    "1d": 3650, "1wk": 3650,
}


async def fetch_bars(
    symbol:    str,
    timeframe: str = "1day",
    start:     datetime | None = None,
    end:       datetime | None = None,
    limit:     int = 500,
) -> list[Bar]:
    """
    Download OHLCV bars from Yahoo Finance via yfinance.
    Runs yfinance (synchronous) in a thread-pool executor.
    """
    import asyncio

    def _download() -> list[Bar]:
        try:
            import yfinance as yf  # type: ignore[import]
        except ImportError:
            log.error("yfinance_not_installed")
            return []

        interval = _YF_INTERVAL.get(timeframe.lower(), "1d")
        max_days = _MAX_LOOKBACK.get(interval, 365)

        now = datetime.now(timezone.utc)
        end_dt   = end   or now
        start_dt = start or (now - timedelta(days=min(max_days, 90)))

        # Clamp start to yfinance max lookback
        earliest = now - timedelta(days=max_days - 1)
        if start_dt < earliest:
            start_dt = earliest

        try:
            ticker = yf.Ticker(symbol)
            df = ticker.history(
                start=start_dt.strftime("%Y-%m-%d"),
                end=end_dt.strftime("%Y-%m-%d"),
                interval=interval,
                auto_adjust=True,
            )
        except Exception as exc:
            log.error("yfinance_download_failed", symbol=symbol, err=str(exc))
            return []

        if df is None or df.empty:
            return []

        bars: list[Bar] = []
        for ts, row in df.iterrows():
            try:
                # pandas Timestamp → datetime
                if hasattr(ts, "to_pydatetime"):
                    ts_dt = ts.to_pydatetime()
                else:
                    ts_dt = datetime.fromisoformat(str(ts))

                if ts_dt.tzinfo is None:
                    ts_dt = ts_dt.replace(tzinfo=timezone.utc)

                bars.append(Bar(
                    symbol=symbol,
                    timestamp=ts_dt,
                    open=float(row["Open"]),
                    high=float(row["High"]),
                    low=float(row["Low"]),
                    close=float(row["Close"]),
                    volume=float(row.get("Volume", 0)),
                    timeframe=timeframe,
                ))
            except Exception as exc:
                log.warning("yf_bar_skip", err=str(exc))
                continue

        return bars[-limit:] if len(bars) > limit else bars

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _download)


async def fetch_info(symbol: str) -> dict[str, Any]:
    """Fetch company/asset metadata from Yahoo Finance."""
    import asyncio

    def _get_info() -> dict[str, Any]:
        try:
            import yfinance as yf  # type: ignore[import]
            ticker = yf.Ticker(symbol)
            info = ticker.info or {}
            return {
                "symbol":       symbol,
                "name":         info.get("longName", symbol),
                "sector":       info.get("sector", ""),
                "industry":     info.get("industry", ""),
                "market_cap":   info.get("marketCap", 0),
                "pe_ratio":     info.get("trailingPE"),
                "beta":         info.get("beta"),
                "52w_high":     info.get("fiftyTwoWeekHigh"),
                "52w_low":      info.get("fiftyTwoWeekLow"),
                "avg_volume":   info.get("averageVolume"),
                "description":  info.get("longBusinessSummary", ""),
            }
        except Exception as exc:
            log.warning("yf_info_failed", symbol=symbol, err=str(exc))
            return {"symbol": symbol, "error": str(exc)}

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_info)
