"""
GodsView v2 — API Gateway

Single public entry-point that fans out to downstream microservices.
Handles: auth, rate-limiting, request ID injection, CORS, health-roll-up.
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from services.api_gateway.routers import (
    backtest,
    health,
    market_data,
    ml,
    signals,
    trades,
)
from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse

log = get_logger(__name__)

# ── Lifespan ──────────────────────────────────────────────────────────────────

_STARTED_AT: float = 0.0


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    log.info(
        "api_gateway_starting",
        port=cfg.api_gateway_port,
        env=cfg.env,
        live_trading=cfg.live_trading_enabled,
    )
    yield
    log.info("api_gateway_shutdown")


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="GodsView v2 API Gateway",
    description="Unified API for GodsView autonomous trading system",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────

_CORS_ORIGINS = [
    "http://localhost:5173",  # Vite dev server
    "http://localhost:3000",
    "https://godsview.app",
    "https://app.godsview.ai",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request ID middleware ─────────────────────────────────────────────────────


@app.middleware("http")
async def inject_request_id(request: Request, call_next: object) -> Response:
    req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())[:8]
    import structlog

    with structlog.contextvars.bound_contextvars(request_id=req_id):
        response: Response = await call_next(request)  # type: ignore[operator]
    response.headers["X-Request-ID"] = req_id
    return response


# ── Timing middleware ─────────────────────────────────────────────────────────


@app.middleware("http")
async def add_process_time(request: Request, call_next: object) -> Response:
    start = time.perf_counter()
    response: Response = await call_next(request)  # type: ignore[operator]
    ms = round((time.perf_counter() - start) * 1000, 2)
    response.headers["X-Process-Time-Ms"] = str(ms)
    return response


# ── Global exception handler ──────────────────────────────────────────────────


@app.exception_handler(Exception)
async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.error("unhandled_exception", path=request.url.path, err=str(exc), exc_info=exc)
    return JSONResponse(status_code=500, content={"error": "Internal server error"})


# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(health.router, prefix="/health", tags=["health"])
app.include_router(signals.router, prefix="/api/signals", tags=["signals"])
app.include_router(trades.router, prefix="/api/trades", tags=["trades"])
app.include_router(market_data.router, prefix="/api/market", tags=["market-data"])
app.include_router(backtest.router, prefix="/api/backtest", tags=["backtest"])
app.include_router(ml.router, prefix="/api/ml", tags=["ml"])

# ── Root ──────────────────────────────────────────────────────────────────────


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {
        "service": "GodsView v2 API Gateway",
        "version": "2.0.0",
        "docs": "/docs",
        "uptime_s": round(time.time() - _STARTED_AT, 1),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "services.api_gateway.main:app",
        host="0.0.0.0",
        port=cfg.api_gateway_port,
        reload=cfg.env == "development",
        log_level=cfg.log_level.lower(),
    )
