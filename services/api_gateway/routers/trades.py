"""
API Gateway — /api/trades routes

Proxies execution queries and trade lifecycle events.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client
from services.shared.logging import get_logger

router = APIRouter()
log = get_logger(__name__)


class TradeRequest(BaseModel):
    signal_id:   str
    symbol:      str
    side:        str    # buy | sell
    qty:         float
    entry_price: float
    stop_price:  float
    target_price: float
    dry_run:     bool = True


class CloseTradeRequest(BaseModel):
    trade_id: str
    reason:   str = "manual"


@router.post("")
async def submit_trade(req: TradeRequest) -> dict[str, Any]:
    """Submit a trade to the execution service (paper or live)."""
    if not cfg.live_trading_enabled and not req.dry_run:
        raise HTTPException(
            status_code=403,
            detail="Live trading disabled — set LIVE_TRADING_ENABLED=true to enable",
        )

    # First pass through risk service
    async with service_client(cfg.risk_url) as risk:
        check = await risk.post("/check", json=req.model_dump())
        if check.status_code != 200:
            raise HTTPException(status_code=409, detail="Risk check failed")
        risk_result = check.json()
        if not risk_result.get("approved"):
            raise HTTPException(
                status_code=409,
                detail=f"Risk rejected: {risk_result.get('reason', 'unknown')}",
            )

    # Then submit to execution service
    async with service_client(cfg.execution_url) as exec_:
        resp = await exec_.post("/orders", json=req.model_dump())
        resp.raise_for_status()
        return resp.json()


@router.delete("/{trade_id}")
async def close_trade(trade_id: str, reason: str = "manual") -> dict[str, Any]:
    """Close / flatten an open trade."""
    async with service_client(cfg.execution_url) as exec_:
        resp = await exec_.delete(f"/orders/{trade_id}", params={"reason": reason})
        resp.raise_for_status()
        return resp.json()


@router.get("")
async def list_trades(
    status: str = Query(default="open"),
    limit:  int = Query(default=50),
) -> dict[str, Any]:
    """List open or recent trades from execution service."""
    async with service_client(cfg.execution_url) as exec_:
        resp = await exec_.get("/orders", params={"status": status, "limit": limit})
        resp.raise_for_status()
        return resp.json()


@router.get("/pnl")
async def pnl_summary() -> dict[str, Any]:
    """Get daily + cumulative P&L from execution service."""
    async with service_client(cfg.execution_url) as exec_:
        resp = await exec_.get("/pnl")
        resp.raise_for_status()
        return resp.json()
