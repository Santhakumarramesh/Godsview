"""
GodsView v2 — Feature Service

FastAPI service for feature engineering, signal detection, and batch scanning.
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse
from services.feature_service.builder import build_features, build_feature_vector, FEATURE_NAMES
from services.feature_service.signal_detector import detect_signal, batch_detect
from services.feature_service.regime_service import router as regime_router

log = get_logger(__name__)
_STARTED_AT = 0.0


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    log.info("feature_service_ready", port=cfg.feature_port)
    yield


app = FastAPI(title="GodsView v2 — Feature Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.include_router(regime_router)


class SignalRequest(BaseModel):
    symbol:    str
    timeframe: str = "15min"
    limit:     int = 300
    use_si_filter: bool = True


class BatchRequest(BaseModel):
    symbols:   list[str]
    timeframe: str = "15min"


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="feature",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={"feature_names": str(len(FEATURE_NAMES))},
    )


@app.post("/signals/generate")
async def generate_signal(req: SignalRequest) -> dict[str, Any]:
    """Fetch bars, compute features, detect SK setup signal."""
    # Fetch bars from market data service
    try:
        async with service_client(cfg.market_data_url) as client:
            resp = await client.get(
                f"/bars/{req.symbol}",
                params={"timeframe": req.timeframe, "limit": req.limit},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}")

    from services.shared.types import Bar
    from datetime import datetime, timezone

    raw_bars = data.get("bars", [])
    bars: list[Bar] = []
    for r in raw_bars:
        ts = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
        bars.append(Bar(
            symbol=req.symbol,
            timestamp=ts,
            open=r["o"], high=r["h"], low=r["l"], close=r["c"],
            volume=r["v"],
            timeframe=req.timeframe,
        ))

    signal = detect_signal(bars, req.timeframe)

    if signal is None:
        return {
            "detected": False,
            "symbol": req.symbol,
            "timeframe": req.timeframe,
            "message": "No qualifying setup detected",
            "bars_analysed": len(bars),
        }

    from dataclasses import asdict
    return {
        "detected": True,
        "signal": {
            "id":          signal.id,
            "symbol":      signal.symbol,
            "timeframe":   signal.timeframe,
            "timestamp":   signal.timestamp.isoformat(),
            "direction":   signal.direction.value,
            "signal_type": signal.signal_type.value,
            "entry":       signal.entry,
            "stop":        signal.stop,
            "target":      signal.target,
            "confidence":  signal.confidence,
            "risk_reward": signal.risk_reward,
            "atr":         signal.atr,
            "structure_score":  signal.structure_score,
            "order_flow_score": signal.order_flow_score,
            "volume_score":     signal.volume_score,
        },
    }


@app.post("/signals/batch")
async def batch_signals(req: BatchRequest) -> dict[str, Any]:
    """Scan multiple symbols concurrently."""
    import asyncio

    async def _scan(symbol: str) -> dict[str, Any]:
        single_req = SignalRequest(symbol=symbol, timeframe=req.timeframe)
        try:
            return await generate_signal(single_req)
        except Exception:
            return {"detected": False, "symbol": symbol, "error": "scan_failed"}

    results = await asyncio.gather(*[_scan(sym) for sym in req.symbols])
    detected = [r for r in results if r.get("detected")]
    return {
        "scanned": len(req.symbols),
        "detected": len(detected),
        "timeframe": req.timeframe,
        "signals": detected,
        "all_results": list(results),
    }


@app.get("/features/{symbol}")
async def get_features(
    symbol:    str,
    timeframe: str = Query(default="15min"),
    limit:     int = Query(default=200, ge=55, le=1000),
) -> dict[str, Any]:
    """Return full feature matrix for a symbol."""
    try:
        async with service_client(cfg.market_data_url) as client:
            resp = await client.get(f"/bars/{symbol}", params={"timeframe": timeframe, "limit": limit})
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    from services.shared.types import Bar
    from datetime import datetime

    bars = [
        Bar(
            symbol=symbol,
            timestamp=datetime.fromisoformat(r["t"].replace("Z", "+00:00")),
            open=r["o"], high=r["h"], low=r["l"], close=r["c"],
            volume=r["v"], timeframe=timeframe,
        )
        for r in data.get("bars", [])
    ]

    features = build_features(bars)
    return {
        "symbol":    symbol,
        "timeframe": timeframe,
        "count":     len(features),
        "feature_names": FEATURE_NAMES,
        "features":  features,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.feature_service.main:app",
        host="0.0.0.0",
        port=cfg.feature_port,
        reload=cfg.env == "development",
    )
