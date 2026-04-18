"""
GodsView v2 — Backtest Service

FastAPI service wrapping the full backtest engine.
Results are cached in memory (LRU) for fast retrieval.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.backtest_service.engine import (
    SUPPORTED_TIMEFRAMES,
    BacktestConfig,
    run_backtest,
)
from services.shared.config import cfg
from services.shared.http_client import service_client
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import Bar, HealthResponse

log = get_logger(__name__)
_STARTED_AT = 0.0

# In-memory results store (run_id → BacktestResult dict)
_results: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    log.info("backtest_service_ready", port=cfg.backtest_port)
    yield


app = FastAPI(
    title="GodsView v2 — Backtest Service", version="2.0.0", lifespan=lifespan
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class RunRequest(BaseModel):
    symbol: str
    timeframe: str = "15min"
    lookback_days: int = 30
    initial_equity: float = 10_000.0
    use_si_filter: bool = True
    strategy: str = "sk_setup"
    commission_pct: float = 0.0005


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="backtest",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={"cached_results": str(len(_results))},
    )


@app.get("/timeframes")
async def supported_timeframes() -> dict[str, Any]:
    return {"timeframes": SUPPORTED_TIMEFRAMES}


@app.post("/run")
async def run(req: RunRequest) -> dict[str, Any]:
    """Execute a full backtest and return the result."""
    from datetime import datetime, timedelta, timezone

    # Fetch bars from market data service
    limit = int(req.lookback_days * 26)  # approximate bars count
    try:
        async with service_client(cfg.market_data_url) as client:
            resp = await client.get(
                f"/bars/{req.symbol}",
                params={
                    "timeframe": req.timeframe,
                    "limit": min(limit, 5000),
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}")

    raw = data.get("bars", [])
    if not raw:
        raise HTTPException(status_code=404, detail=f"No bars for {req.symbol}")

    bars: list[Bar] = []
    for r in raw:
        ts = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
        bars.append(
            Bar(
                symbol=req.symbol,
                timestamp=ts,
                open=r["o"],
                high=r["h"],
                low=r["l"],
                close=r["c"],
                volume=r["v"],
                timeframe=req.timeframe,
            )
        )

    config = BacktestConfig(
        symbol=req.symbol,
        timeframe=req.timeframe,
        lookback_days=req.lookback_days,
        initial_equity=req.initial_equity,
        commission_pct=req.commission_pct,
        use_si_filter=req.use_si_filter,
        strategy=req.strategy,
    )

    result = run_backtest(bars, config)
    result_dict = result.model_dump()
    result_dict["run_at"] = time.time()
    _results[result.run_id] = result_dict

    return result_dict


@app.get("/results")
async def list_results(
    symbol: str | None = Query(default=None),
    limit: int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    items = list(_results.values())
    if symbol:
        items = [r for r in items if r.get("symbol") == symbol.upper()]
    items.sort(key=lambda r: r.get("run_at", 0), reverse=True)
    return {
        "total": len(items),
        "results": items[:limit],
    }


@app.get("/results/{run_id}")
async def get_result(run_id: str) -> dict[str, Any]:
    if run_id not in _results:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _results[run_id]


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "services.backtest_service.main:app",
        host="0.0.0.0",
        port=cfg.backtest_port,
        reload=cfg.env == "development",
    )
