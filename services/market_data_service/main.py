"""
GodsView v2 — Market Data Service

FastAPI service exposing historical bars, quotes, and asset listings.
Caches data in SQLite; refreshes from Alpaca / Yahoo on-demand.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from services.market_data_service.loaders import alpaca_loader, yahoo_loader
from services.market_data_service.storage import BarStorage
from services.market_data_service.validator import validate_bars
from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse

log = get_logger(__name__)

_STARTED_AT = 0.0
_storage: BarStorage | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT, _storage
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    _storage = BarStorage()
    await _storage.init()
    log.info("market_data_service_ready", port=cfg.market_data_port)
    yield
    log.info("market_data_service_shutdown")


app = FastAPI(
    title="GodsView v2 — Market Data",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    has_creds = alpaca_loader._has_credentials()
    return HealthResponse(
        service="market_data",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={
            "alpaca_credentials": "ok" if has_creds else "missing",
            "storage": "ok" if _storage else "not_ready",
        },
    )


@app.get("/bars/{symbol}")
async def get_bars(
    symbol: str,
    timeframe: str = Query(default="15min"),
    limit: int = Query(default=200, ge=1, le=5000),
    start: str | None = Query(default=None),
    end: str | None = Query(default=None),
    source: str = Query(default="alpaca"),  # alpaca | yahoo | cache
) -> dict[str, Any]:
    """
    Fetch OHLCV bars for a symbol.

    source=cache  → SQLite only (fastest, no network)
    source=alpaca → Alpaca API (live/paper)
    source=yahoo  → Yahoo Finance (free, delayed)
    """
    from datetime import datetime

    start_dt = datetime.fromisoformat(start) if start else None
    end_dt = datetime.fromisoformat(end) if end else None

    # Try cache first if storage is available
    if _storage and source == "cache":
        bars = await _storage.load_bars(
            symbol, timeframe, start=start_dt, end=end_dt, limit=limit
        )
        if bars:
            _, report = validate_bars(bars)
            return {
                "symbol": symbol,
                "timeframe": timeframe,
                "count": len(bars),
                "source": "cache",
                "quality": round(report.pass_rate, 3),
                "bars": [_bar_to_dict(b) for b in bars],
            }

    # Fetch from upstream
    bars = []
    if source == "yahoo":
        bars = await yahoo_loader.fetch_bars(
            symbol, timeframe, start=start_dt, end=end_dt, limit=limit
        )
        fetch_source = "yahoo"
    else:
        bars = await alpaca_loader.fetch_bars(
            symbol, timeframe, start=start_dt, end=end_dt, limit=limit
        )
        fetch_source = "alpaca"

    if not bars:
        raise HTTPException(status_code=404, detail=f"No bars found for {symbol}")

    bars, report = validate_bars(bars)

    # Cache the clean bars
    if _storage:
        await _storage.upsert_bars(bars)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "count": len(bars),
        "source": fetch_source,
        "quality": round(report.pass_rate, 3),
        "bars": [_bar_to_dict(b) for b in bars],
    }


@app.get("/quote/{symbol}")
async def get_quote(symbol: str) -> dict[str, Any]:
    return await alpaca_loader.fetch_latest_quote(symbol)


@app.get("/symbols")
async def list_symbols(
    asset_class: str = Query(default="us_equity"),
) -> dict[str, Any]:
    assets = await alpaca_loader.list_assets(asset_class)
    return {"asset_class": asset_class, "count": len(assets), "assets": assets}


@app.get("/info/{symbol}")
async def symbol_info(symbol: str) -> dict[str, Any]:
    return await yahoo_loader.fetch_info(symbol)


def _bar_to_dict(b: Any) -> dict[str, Any]:
    return {
        "t": b.timestamp.isoformat(),
        "o": b.open,
        "h": b.high,
        "l": b.low,
        "c": b.close,
        "v": b.volume,
        "vwap": b.vwap,
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "services.market_data_service.main:app",
        host="0.0.0.0",
        port=cfg.market_data_port,
        reload=cfg.env == "development",
    )
