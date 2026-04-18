"""
GodsView v2 — Execution Service

Handles order lifecycle: submit, fill, close, P&L tracking.
Supports paper mode (Alpaca Paper) and live mode.
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse

log = get_logger(__name__)
_STARTED_AT = 0.0

# In-memory order book
_orders: dict[str, dict[str, Any]] = {}
_pnl_history: list[dict[str, Any]] = []


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    log.info("execution_service_ready", port=cfg.execution_port, paper=cfg.alpaca_paper)
    yield


app = FastAPI(
    title="GodsView v2 — Execution Service", version="2.0.0", lifespan=lifespan
)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class OrderRequest(BaseModel):
    signal_id: str
    symbol: str
    side: str  # buy | sell
    qty: float
    entry_price: float
    stop_price: float
    target_price: float
    dry_run: bool = True


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    open_orders = sum(1 for o in _orders.values() if o["status"] == "open")
    return HealthResponse(
        service="execution",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={
            "open_orders": str(open_orders),
            "alpaca_paper": str(cfg.alpaca_paper),
            "live_trading": str(cfg.live_trading_enabled),
        },
    )


@app.post("/orders")
async def submit_order(req: OrderRequest) -> dict[str, Any]:
    """Submit a new order (paper or live)."""
    order_id = str(uuid.uuid4())[:8]

    if req.dry_run or not cfg.live_trading_enabled:
        order = {
            "id": order_id,
            "signal_id": req.signal_id,
            "symbol": req.symbol.upper(),
            "side": req.side,
            "qty": req.qty,
            "entry_price": req.entry_price,
            "stop_price": req.stop_price,
            "target_price": req.target_price,
            "status": "open",
            "fill_price": req.entry_price,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "mode": "paper",
        }
        _orders[order_id] = order
        log.info(
            "paper_order_opened", order_id=order_id, symbol=req.symbol, qty=req.qty
        )
        return order

    # Live: submit to Alpaca
    return await _submit_alpaca(req, order_id)


async def _submit_alpaca(req: OrderRequest, order_id: str) -> dict[str, Any]:
    """Submit a bracket order to Alpaca."""
    headers = {
        "APCA-API-KEY-ID": cfg.alpaca_key_id,
        "APCA-API-SECRET-KEY": cfg.alpaca_secret_key,
        "Content-Type": "application/json",
    }
    payload = {
        "symbol": req.symbol,
        "qty": str(req.qty),
        "side": req.side,
        "type": "market",
        "time_in_force": "day",
        "order_class": "bracket",
        "stop_loss": {"stop_price": str(req.stop_price)},
        "take_profit": {"limit_price": str(req.target_price)},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{cfg.alpaca_base_url}/v2/orders",
                headers=headers,
                json=payload,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Alpaca order failed: {exc}")

    order = {
        "id": order_id,
        "alpaca_id": data.get("id"),
        "signal_id": req.signal_id,
        "symbol": req.symbol.upper(),
        "side": req.side,
        "qty": req.qty,
        "entry_price": req.entry_price,
        "stop_price": req.stop_price,
        "target_price": req.target_price,
        "status": "pending",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "mode": "live",
    }
    _orders[order_id] = order
    log.info("live_order_submitted", order_id=order_id, alpaca_id=data.get("id"))
    return order


@app.delete("/orders/{order_id}")
async def close_order(order_id: str, reason: str = "manual") -> dict[str, Any]:
    if order_id not in _orders:
        raise HTTPException(status_code=404, detail=f"Order {order_id} not found")

    order = _orders[order_id]
    order["status"] = "closed"
    order["closed_at"] = datetime.now(timezone.utc).isoformat()
    order["close_reason"] = reason

    log.info("order_closed", order_id=order_id, reason=reason)
    return order


@app.get("/orders")
async def list_orders(
    status: str = Query(default="open"),
    limit: int = Query(default=50),
) -> dict[str, Any]:
    items = [o for o in _orders.values() if o["status"] == status]
    items.sort(key=lambda o: o.get("submitted_at", ""), reverse=True)
    return {"count": len(items), "status": status, "orders": items[:limit]}


@app.get("/pnl")
async def get_pnl() -> dict[str, Any]:
    closed = [o for o in _orders.values() if o["status"] == "closed"]
    total_pnl = sum(
        (float(o.get("exit_price", o["entry_price"])) - float(o["entry_price"]))
        * float(o["qty"])
        * (1 if o["side"] == "buy" else -1)
        for o in closed
    )
    return {
        "total_pnl": round(total_pnl, 2),
        "closed_trades": len(closed),
        "open_positions": sum(1 for o in _orders.values() if o["status"] == "open"),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "services.execution_service.main:app",
        host="0.0.0.0",
        port=cfg.execution_port,
        reload=cfg.env == "development",
    )
