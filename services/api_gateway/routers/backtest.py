"""
API Gateway — /api/backtest routes
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client

router = APIRouter()


class BacktestRequest(BaseModel):
    symbol:         str
    timeframe:      str   = "15min"
    lookback_days:  int   = 30
    initial_equity: float = 10_000.0
    use_si_filter:  bool  = True
    strategy:       str   = "sk_setup"
    commission_pct: float = 0.0005


@router.post("/run")
async def run_backtest(req: BacktestRequest) -> dict[str, Any]:
    async with service_client(cfg.backtest_url) as client:
        resp = await client.post("/run", json=req.model_dump())
        resp.raise_for_status()
        return resp.json()


@router.get("/results")
async def list_results(
    symbol:    str | None = Query(default=None),
    limit:     int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    params: dict[str, Any] = {"limit": limit}
    if symbol:
        params["symbol"] = symbol

    async with service_client(cfg.backtest_url) as client:
        resp = await client.get("/results", params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/results/{run_id}")
async def get_result(run_id: str) -> dict[str, Any]:
    async with service_client(cfg.backtest_url) as client:
        resp = await client.get(f"/results/{run_id}")
        resp.raise_for_status()
        return resp.json()


@router.get("/timeframes")
async def supported_timeframes() -> dict[str, Any]:
    async with service_client(cfg.backtest_url) as client:
        resp = await client.get("/timeframes")
        resp.raise_for_status()
        return resp.json()
