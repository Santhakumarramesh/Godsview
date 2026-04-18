"""
API Gateway — /health routes

GET /health          → gateway heartbeat
GET /health/services → fan-out to all downstream services
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx
from fastapi import APIRouter

from services.shared.config import cfg
from services.shared.logging import get_logger
from services.shared.types import HealthResponse

router = APIRouter()
log = get_logger(__name__)

_DOWNSTREAM: dict[str, str] = {
    "market_data": cfg.market_data_url,
    "feature": cfg.feature_url,
    "backtest": cfg.backtest_url,
    "ml": cfg.ml_url,
    "execution": cfg.execution_url,
    "risk": cfg.risk_url,
    "memory": cfg.memory_url,
}

_STARTED_AT = time.time()


@router.get("", response_model=HealthResponse)
async def gateway_health() -> HealthResponse:
    return HealthResponse(
        service="api_gateway",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={"database": "n/a", "config": "ok"},
    )


@router.get("/services")
async def services_health() -> dict[str, Any]:
    """Fan-out health checks to all downstream services concurrently."""

    async def _ping(name: str, base_url: str) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{base_url}/health")
                if resp.status_code == 200:
                    return {"name": name, "status": "ok", **resp.json()}
                return {"name": name, "status": "degraded", "code": resp.status_code}
        except Exception as exc:
            return {"name": name, "status": "offline", "error": str(exc)}

    tasks = [_ping(name, url) for name, url in _DOWNSTREAM.items()]
    results = await asyncio.gather(*tasks)

    statuses = [r["status"] for r in results]
    overall = (
        "ok"
        if all(s == "ok" for s in statuses)
        else "degraded"
        if any(s == "ok" for s in statuses)
        else "critical"
    )

    return {
        "gateway": "ok",
        "overall": overall,
        "services": results,
        "checked_at": time.time(),
    }
