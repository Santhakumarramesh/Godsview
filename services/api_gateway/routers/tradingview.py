"""
API Gateway — /api/tv routes
Proxy to TV Bridge service for TradingView webhooks and strategy sync
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client

router = APIRouter()


class WebhookPayload(BaseModel):
    alert_id: str | None = None
    message: str | None = None
    action: str | None = None


@router.post("/webhooks/tradingview")
async def tradingview_webhook(payload: WebhookPayload) -> dict[str, Any]:
    """Forward TradingView webhook to TV Bridge service"""
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.post("/v1/webhooks/tradingview", json=payload.model_dump())
        resp.raise_for_status()
        return resp.json()


@router.get("/webhooks/events")
async def list_webhook_events(limit: int = 100, offset: int = 0) -> dict[str, Any]:
    """List recent webhook events from TV Bridge"""
    params = {"limit": min(limit, 100), "offset": offset}
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.get("/v1/webhooks/events", params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/pine-scripts")
async def list_pine_scripts() -> dict[str, Any]:
    """List available Pine Script strategies"""
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.get("/v1/pine-scripts")
        resp.raise_for_status()
        return resp.json()


@router.post("/pine-scripts")
async def create_pine_script(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Create or update a Pine Script strategy"""
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.post("/v1/pine-scripts", json=payload)
        resp.raise_for_status()
        return resp.json()


@router.get("/strategy-sync")
async def get_strategy_sync() -> dict[str, Any]:
    """Get current strategy sync status"""
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.get("/v1/strategy-sync")
        resp.raise_for_status()
        return resp.json()


@router.post("/strategy-sync")
async def trigger_strategy_sync(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Trigger strategy sync from TradingView"""
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.post("/v1/strategy-sync", json=payload)
        resp.raise_for_status()
        return resp.json()


@router.post("/actions")
async def create_action(payload: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Create a new trading action from TV signal"""
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.post("/v1/actions", json=payload)
        resp.raise_for_status()
        return resp.json()


@router.get("/actions")
async def list_actions(limit: int = 50, offset: int = 0) -> dict[str, Any]:
    """List trading actions triggered from TradingView"""
    params = {"limit": min(limit, 100), "offset": offset}
    async with service_client(cfg.tv_bridge_url) as client:
        resp = await client.get("/v1/actions", params=params)
        resp.raise_for_status()
        return resp.json()
