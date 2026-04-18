"""
API Gateway — /api/signals routes

Proxies signal queries to the feature service (which computes live signals)
and the memory service (which retrieves past similar setups).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client
from services.shared.logging import get_logger

router = APIRouter()
log = get_logger(__name__)


class SignalRequest(BaseModel):
    symbol: str
    timeframe: str = "15min"
    use_si_filter: bool = True


@router.post("")
async def generate_signal(req: SignalRequest) -> dict[str, Any]:
    """
    Ask the feature service to run the full signal pipeline for a symbol.
    Optionally runs the SI (Super Intelligence) filter on the result.
    """
    payload = req.model_dump()

    async with service_client(cfg.feature_url) as client:
        resp = await client.post("/signals/generate", json=payload)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text)
        signal = resp.json()

    if req.use_si_filter and signal.get("detected"):
        async with service_client(cfg.ml_url) as ml:
            ml_resp = await ml.post("/predict", json={"signal": signal})
            if ml_resp.status_code == 200:
                signal["ml_prediction"] = ml_resp.json()

    return signal


@router.get("/live")
async def live_signals(
    symbols: str = Query(default="AAPL,TSLA,NVDA,SPY"),
    timeframe: str = Query(default="15min"),
) -> dict[str, Any]:
    """Batch live signal scan across multiple symbols."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    payload = {"symbols": symbol_list, "timeframe": timeframe}

    async with service_client(cfg.feature_url) as client:
        resp = await client.post("/signals/batch", json=payload)
        resp.raise_for_status()
        return resp.json()


@router.get("/history")
async def signal_history(
    symbol: str = Query(...),
    limit: int = Query(default=50, ge=1, le=500),
) -> dict[str, Any]:
    """Retrieve recent signal history from memory service."""
    async with service_client(cfg.memory_url) as client:
        resp = await client.get(
            "/recall/signals",
            params={"symbol": symbol, "limit": limit},
        )
        resp.raise_for_status()
        return resp.json()
