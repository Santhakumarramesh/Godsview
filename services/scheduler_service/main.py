"""
Scheduler Service — Port 8008

Autonomous background loops:
  • Signal scan     : every N minutes, fetch bars for watchlist symbols,
                      detect signals, forward approved ones to API gateway
  • Model retrain   : daily at market close, trigger ml_service /train
  • Position monitor: every minute, check open positions vs current price
  • Health ticker   : every 30s, ping all sibling services
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import get_settings
from services.shared.logging import configure_logging

configure_logging()
log = logging.getLogger(__name__)
settings = get_settings()

# ---------------------------------------------------------------------------
# State
# ---------------------------------------------------------------------------

class SchedulerState:
    def __init__(self) -> None:
        self.running: bool = False
        self.scan_interval_seconds: int = settings.scan_interval_seconds
        self.last_scan: datetime | None = None
        self.last_retrain: datetime | None = None
        self.last_position_check: datetime | None = None
        self.scan_count: int = 0
        self.signals_found: int = 0
        self.retrain_count: int = 0
        self.errors: list[str] = []
        self.service_health: dict[str, bool] = {}

    def to_dict(self) -> dict[str, Any]:
        return {
            "running": self.running,
            "scan_interval_seconds": self.scan_interval_seconds,
            "last_scan": self.last_scan.isoformat() if self.last_scan else None,
            "last_retrain": self.last_retrain.isoformat() if self.last_retrain else None,
            "last_position_check": self.last_position_check.isoformat() if self.last_position_check else None,
            "scan_count": self.scan_count,
            "signals_found": self.signals_found,
            "retrain_count": self.retrain_count,
            "recent_errors": self.errors[-10:],
            "service_health": self.service_health,
        }


state = SchedulerState()

# ---------------------------------------------------------------------------
# Watchlist
# ---------------------------------------------------------------------------

WATCHLIST: list[str] = [
    "AAPL", "MSFT", "TSLA", "NVDA", "META",
    "GOOGL", "AMZN", "SPY", "QQQ", "AMD",
    "BTCUSD", "ETHUSD",
]

TIMEFRAMES: list[str] = ["15min", "1hour"]

# ---------------------------------------------------------------------------
# Service URLs
# ---------------------------------------------------------------------------

def _url(port: int, path: str) -> str:
    return f"http://localhost:{port}{path}"


GATEWAY    = settings.api_gateway_port
MARKET     = settings.market_data_port
FEATURE    = settings.feature_port
ML         = settings.ml_port
EXECUTION  = settings.execution_port
RISK       = settings.risk_port
MEMORY     = settings.memory_port

SERVICE_URLS: dict[str, str] = {
    "api_gateway":     _url(GATEWAY, "/health"),
    "market_data":     _url(MARKET,  "/health"),
    "feature":         _url(FEATURE, "/health"),
    "ml":              _url(ML,      "/health"),
    "execution":       _url(EXECUTION, "/health"),
    "risk":            _url(RISK,    "/health"),
    "memory":          _url(MEMORY,  "/health"),
}

# ---------------------------------------------------------------------------
# Background tasks
# ---------------------------------------------------------------------------

async def _ping_services() -> None:
    """Check health of all sibling services."""
    async with httpx.AsyncClient(timeout=3.0) as client:
        for name, url in SERVICE_URLS.items():
            try:
                r = await client.get(url)
                state.service_health[name] = r.status_code == 200
            except Exception:
                state.service_health[name] = False


async def _scan_symbol(client: httpx.AsyncClient, symbol: str, timeframe: str) -> int:
    """Fetch bars, build features, detect signals, forward to gateway."""
    signals_found = 0
    try:
        # 1. Fetch bars from market data service
        r = await client.get(
            _url(MARKET, f"/bars/{symbol}"),
            params={"timeframe": timeframe, "count": 200},
            timeout=10.0,
        )
        if r.status_code != 200:
            return 0

        bars = r.json().get("bars", [])
        if len(bars) < 55:
            return 0

        # 2. Detect signals via feature service
        r2 = await client.post(
            _url(FEATURE, "/detect"),
            json={"symbol": symbol, "timeframe": timeframe, "bars": bars},
            timeout=10.0,
        )
        if r2.status_code != 200:
            return 0

        signals = r2.json().get("signals", [])

        # 3. Forward each signal through gateway (ML filter applied there)
        for sig in signals:
            try:
                await client.post(
                    _url(GATEWAY, "/api/signals"),
                    json=sig,
                    timeout=5.0,
                )
                signals_found += 1
            except Exception:
                pass

    except Exception as exc:
        state.errors.append(f"scan {symbol}/{timeframe}: {exc}")

    return signals_found


async def _scan_loop() -> None:
    """Periodic signal scanner — runs every scan_interval_seconds."""
    log.info("scan_loop.started interval=%s", state.scan_interval_seconds)
    while state.running:
        try:
            async with httpx.AsyncClient() as client:
                tasks = [
                    _scan_symbol(client, sym, tf)
                    for sym in WATCHLIST
                    for tf in TIMEFRAMES
                ]
                results = await asyncio.gather(*tasks, return_exceptions=True)
                found = sum(r for r in results if isinstance(r, int))
                state.scan_count += 1
                state.signals_found += found
                state.last_scan = datetime.now(timezone.utc)
                log.info("scan.complete signals_found=%s total_scan=%s", found, state.scan_count)
        except Exception as exc:
            state.errors.append(f"scan_loop: {exc}")

        await asyncio.sleep(state.scan_interval_seconds)


async def _retrain_loop() -> None:
    """Daily retrain trigger — fires at 16:15 ET (21:15 UTC, after market close)."""
    log.info("retrain_loop.started")
    while state.running:
        now = datetime.now(timezone.utc)
        # Trigger once per day at 21:15 UTC
        target_hour, target_min = 21, 15
        secs_until = (
            (target_hour - now.hour) * 3600
            + (target_min - now.minute) * 60
            - now.second
        )
        if secs_until < 0:
            secs_until += 86400  # next day

        await asyncio.sleep(min(secs_until, 300))  # wake every 5 min max

        now = datetime.now(timezone.utc)
        if now.hour == target_hour and now.minute >= target_min and now.minute < target_min + 5:
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    for sym in WATCHLIST[:5]:  # retrain top-5 symbols
                        for tf in TIMEFRAMES:
                            await client.post(
                                _url(ML, "/train"),
                                json={"symbol": sym, "timeframe": tf},
                                timeout=120.0,
                            )
                state.retrain_count += 1
                state.last_retrain = datetime.now(timezone.utc)
                log.info("retrain.triggered count=%s", state.retrain_count)
            except Exception as exc:
                state.errors.append(f"retrain_loop: {exc}")

            await asyncio.sleep(600)  # wait 10 min before checking again


async def _position_monitor_loop() -> None:
    """Every 60s: check open positions vs current price, alert if near SL."""
    log.info("position_monitor.started")
    while state.running:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(_url(EXECUTION, "/positions"))
                if r.status_code == 200:
                    positions = r.json().get("positions", [])
                    state.last_position_check = datetime.now(timezone.utc)
                    for pos in positions:
                        symbol = pos.get("symbol", "")
                        entry = pos.get("entry_price", 0)
                        stop = pos.get("stop_price", 0)
                        size = pos.get("size", 0)
                        direction = pos.get("direction", "LONG")

                        # Fetch current price
                        try:
                            pr = await client.get(
                                _url(MARKET, f"/price/{symbol}"),
                                timeout=3.0,
                            )
                            if pr.status_code == 200:
                                current = pr.json().get("price", entry)
                                distance_to_sl = (
                                    (current - stop) if direction == "LONG"
                                    else (stop - current)
                                )
                                if distance_to_sl < 0:
                                    log.warning(
                                        "position.sl_breached",
                                        symbol=symbol,
                                        current=current,
                                        stop=stop,
                                        direction=direction,
                                    )
                        except Exception:
                            pass
        except Exception as exc:
            state.errors.append(f"position_monitor: {exc}")

        await asyncio.sleep(60)


async def _health_ticker_loop() -> None:
    """Every 30s: ping all services and update health map."""
    while state.running:
        await _ping_services()
        await asyncio.sleep(30)


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

_tasks: list[asyncio.Task] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    state.running = True
    _tasks.extend([
        asyncio.create_task(_scan_loop(),             name="scan"),
        asyncio.create_task(_retrain_loop(),          name="retrain"),
        asyncio.create_task(_position_monitor_loop(), name="position_monitor"),
        asyncio.create_task(_health_ticker_loop(),    name="health_ticker"),
    ])
    log.info("scheduler.started tasks=%s", len(_tasks))
    yield
    state.running = False
    for task in _tasks:
        task.cancel()
    await asyncio.gather(*_tasks, return_exceptions=True)
    log.info("scheduler.stopped")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Godsview Scheduler Service",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://godsview.app"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "scheduler",
        "running": state.running,
        "scan_count": state.scan_count,
    }


@app.get("/scheduler/status")
async def get_status():
    return state.to_dict()


class ScanTriggerRequest(BaseModel):
    symbols: list[str] | None = None
    timeframes: list[str] | None = None


@app.post("/scheduler/scan/trigger")
async def trigger_scan(req: ScanTriggerRequest = ScanTriggerRequest()):
    """Manually trigger an immediate scan."""
    symbols = req.symbols or WATCHLIST
    timeframes = req.timeframes or TIMEFRAMES

    async def _run():
        async with httpx.AsyncClient() as client:
            tasks = [
                _scan_symbol(client, sym, tf)
                for sym in symbols
                for tf in timeframes
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            found = sum(r for r in results if isinstance(r, int))
            state.scan_count += 1
            state.signals_found += found
            state.last_scan = datetime.now(timezone.utc)
            log.info("manual_scan.complete signals_found=%s", found)

    asyncio.create_task(_run())
    return {
        "status": "triggered",
        "symbols": len(symbols),
        "timeframes": timeframes,
    }


@app.post("/scheduler/retrain/trigger")
async def trigger_retrain():
    """Manually trigger an immediate retrain for all watchlist symbols."""
    async def _run():
        async with httpx.AsyncClient(timeout=120.0) as client:
            for sym in WATCHLIST[:5]:
                for tf in TIMEFRAMES:
                    try:
                        await client.post(
                            _url(ML, "/train"),
                            json={"symbol": sym, "timeframe": tf},
                            timeout=120.0,
                        )
                    except Exception as exc:
                        state.errors.append(f"retrain {sym}: {exc}")
        state.retrain_count += 1
        state.last_retrain = datetime.now(timezone.utc)
        log.info("manual_retrain.complete")

    asyncio.create_task(_run())
    return {"status": "triggered", "symbols": WATCHLIST[:5]}


@app.get("/scheduler/watchlist")
async def get_watchlist():
    return {"symbols": WATCHLIST, "timeframes": TIMEFRAMES}


class WatchlistUpdateRequest(BaseModel):
    add: list[str] = []
    remove: list[str] = []


@app.patch("/scheduler/watchlist")
async def update_watchlist(req: WatchlistUpdateRequest):
    for sym in req.add:
        if sym not in WATCHLIST:
            WATCHLIST.append(sym.upper())
    for sym in req.remove:
        if sym.upper() in WATCHLIST:
            WATCHLIST.remove(sym.upper())
    return {"symbols": WATCHLIST}


@app.post("/scheduler/scan-interval")
async def set_scan_interval(seconds: int):
    state.scan_interval_seconds = max(30, min(seconds, 3600))
    return {"scan_interval_seconds": state.scan_interval_seconds}


@app.get("/scheduler/errors")
async def get_errors():
    return {"errors": state.errors[-50:], "total": len(state.errors)}


@app.delete("/scheduler/errors")
async def clear_errors():
    state.errors.clear()
    return {"cleared": True}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.scheduler_service.main:app",
        host="0.0.0.0",
        port=settings.scheduler_port,
        reload=False,
    )
