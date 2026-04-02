"""
API Gateway — /api/market routes

Thin proxy to the market data service.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from services.shared.config import cfg
from services.shared.http_client import service_client

router = APIRouter()


@router.get("/bars/{symbol}")
async def get_bars(
    symbol:    str,
    timeframe: str = Query(default="15min"),
    limit:     int = Query(default=200, ge=1, le=5000),
    start:     str | None = Query(default=None),
    end:       str | None = Query(default=None),
) -> dict[str, Any]:
    params: dict[str, Any] = {"timeframe": timeframe, "limit": limit}
    if start:
        params["start"] = start
    if end:
        params["end"] = end

    async with service_client(cfg.market_data_url) as client:
        resp = await client.get(f"/bars/{symbol}", params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/quote/{symbol}")
async def get_quote(symbol: str) -> dict[str, Any]:
    async with service_client(cfg.market_data_url) as client:
        resp = await client.get(f"/quote/{symbol}")
        resp.raise_for_status()
        return resp.json()


@router.get("/symbols")
async def list_symbols(
    asset_class: str = Query(default="us_equity"),
) -> dict[str, Any]:
    async with service_client(cfg.market_data_url) as client:
        resp = await client.get("/symbols", params={"asset_class": asset_class})
        resp.raise_for_status()
        return resp.json()
