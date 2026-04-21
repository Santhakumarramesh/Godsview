"""
API Gateway — /api/flow routes
Proxy to Order Flow service for real-time market microstructure analysis
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from services.shared.config import cfg
from services.shared.http_client import service_client

router = APIRouter()


@router.get("/{symbol}/snapshot")
async def get_orderflow_snapshot(symbol: str) -> dict[str, Any]:
    """Get current order flow snapshot for symbol"""
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/snapshot")
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/heatmap")
async def get_orderflow_heatmap(
    symbol: str,
    interval: str = Query(default="1min"),
) -> dict[str, Any]:
    """Get order flow heatmap (price levels vs volume intensity)"""
    params = {"interval": interval}
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/heatmap", params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/dom")
async def get_depth_of_market(symbol: str) -> dict[str, Any]:
    """Get depth of market (DOM) - bid/ask ladder"""
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/dom")
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/footprint")
async def get_price_footprint(
    symbol: str,
    timeframe: str = Query(default="5min"),
) -> dict[str, Any]:
    """Get footprint chart data (delta per price level per candle)"""
    params = {"timeframe": timeframe}
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/footprint", params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/absorption")
async def get_absorption_analysis(symbol: str) -> dict[str, Any]:
    """Analyze order absorption at key price levels"""
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/absorption")
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/imbalance")
async def get_order_imbalance(symbol: str) -> dict[str, Any]:
    """Get bid/ask volume imbalance metrics"""
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/imbalance")
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/pressure")
async def get_buying_selling_pressure(symbol: str) -> dict[str, Any]:
    """Get cumulative buying/selling pressure indicators"""
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/pressure")
        resp.raise_for_status()
        return resp.json()


@router.get("/{symbol}/confluence")
async def get_confluence_zones(symbol: str) -> dict[str, Any]:
    """Get confluence analysis - zones where multiple order flow signals align"""
    async with service_client(cfg.orderflow_url) as client:
        resp = await client.get(f"/v1/flow/{symbol}/confluence")
        resp.raise_for_status()
        return resp.json()
