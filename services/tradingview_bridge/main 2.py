"""TradingView Bridge Service — webhook receiver, Pine registry, MCP actions."""
import os
import hmac
import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import FastAPI, Request, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logger = logging.getLogger("tv_bridge")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="GodsView TradingView Bridge", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── In-memory stores (replace with DB in production) ──
webhook_events: list[dict] = []
pine_scripts: dict[str, dict] = {}
tv_actions: list[dict] = []
strategy_syncs: dict[str, dict] = {}

WEBHOOK_SECRET = os.getenv("TV_WEBHOOK_SECRET", "godsview-dev-secret")
API_GATEWAY = os.getenv("API_GATEWAY_URL", "http://localhost:8000")


# ── Models ──
class WebhookPayload(BaseModel):
    symbol: str
    action: str = "info"  # buy, sell, close, info
    price: Optional[float] = None
    message: Optional[str] = None
    strategy_name: Optional[str] = None

class PineScriptCreate(BaseModel):
    name: str
    version: str = "1.0"
    code: str
    signals: list[str] = []

class TVActionRequest(BaseModel):
    type: str  # analyze_symbol, compare_setups, save_chart, launch_backtest, queue_trade
    symbol: Optional[str] = None
    params: dict = {}

class StrategySyncRequest(BaseModel):
    strategy_id: str
    tv_strategy_name: str
    parameter_map: dict = {}


# ── Health ──
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "tradingview_bridge",
        "events_count": len(webhook_events),
        "scripts_count": len(pine_scripts),
        "actions_count": len(tv_actions),
    }


# ── Webhook Receiver ──
@app.post("/v1/webhooks/tradingview")
async def receive_webhook(payload: WebhookPayload, request: Request, background_tasks: BackgroundTasks):
    """Receive and process TradingView webhook alerts."""
    # Verify HMAC signature if present
    sig = request.headers.get("X-TV-Signature")
    if sig:
        body = await request.body()
        expected = hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event = {
        "id": str(uuid.uuid4()),
        "source": "pine_alert" if payload.strategy_name else "manual",
        "symbol": payload.symbol,
        "action": payload.action,
        "price": payload.price,
        "message": payload.message,
        "strategy_name": payload.strategy_name,
        "received_at": datetime.now(timezone.utc).isoformat(),
        "processed": False,
    }
    webhook_events.append(event)
    logger.info(f"Webhook received: {payload.symbol} {payload.action}")

    # Route event to appropriate service
    background_tasks.add_task(route_webhook_event, event)

    return {"status": "received", "event_id": event["id"]}


async def route_webhook_event(event: dict):
    """Route webhook to scanner/execution based on action type."""
    import httpx
    try:
        if event["action"] in ("buy", "sell"):
            async with httpx.AsyncClient() as client:
                await client.post(
                    f"{API_GATEWAY}/v1/signals/from-webhook",
                    json=event,
                    timeout=10,
                )
        event["processed"] = True
        logger.info(f"Routed event {event['id']} to signal pipeline")
    except Exception as e:
        logger.error(f"Failed to route event {event['id']}: {e}")


@app.get("/v1/webhooks/events")
async def list_webhook_events(limit: int = 50):
    """List recent webhook events."""
    return {"events": webhook_events[-limit:][::-1], "total": len(webhook_events)}


# ── Pine Script Registry ──
@app.post("/v1/pine-scripts")
async def register_pine_script(script: PineScriptCreate):
    """Register a Pine Script in the signal registry."""
    script_id = str(uuid.uuid4())
    entry = {
        "id": script_id,
        "name": script.name,
        "version": script.version,
        "code": script.code,
        "signals": script.signals,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    pine_scripts[script_id] = entry
    logger.info(f"Registered Pine Script: {script.name} v{script.version}")
    return {"status": "registered", "script": entry}


@app.get("/v1/pine-scripts")
async def list_pine_scripts():
    """List all registered Pine Scripts."""
    return {"scripts": list(pine_scripts.values())}


@app.get("/v1/pine-scripts/{script_id}")
async def get_pine_script(script_id: str):
    if script_id not in pine_scripts:
        raise HTTPException(status_code=404, detail="Script not found")
    return pine_scripts[script_id]


@app.patch("/v1/pine-scripts/{script_id}/toggle")
async def toggle_pine_script(script_id: str):
    if script_id not in pine_scripts:
        raise HTTPException(status_code=404, detail="Script not found")
    pine_scripts[script_id]["active"] = not pine_scripts[script_id]["active"]
    return pine_scripts[script_id]


# ── TV Strategy Sync ──
@app.post("/v1/strategy-sync")
async def create_strategy_sync(sync: StrategySyncRequest):
    """Sync a TradingView strategy with the internal strategy engine."""
    entry = {
        "strategy_id": sync.strategy_id,
        "tv_strategy_name": sync.tv_strategy_name,
        "parameter_map": sync.parameter_map,
        "synced": True,
        "last_sync": datetime.now(timezone.utc).isoformat(),
    }
    strategy_syncs[sync.strategy_id] = entry
    return {"status": "synced", "sync": entry}


@app.get("/v1/strategy-sync")
async def list_strategy_syncs():
    return {"syncs": list(strategy_syncs.values())}


# ── MCP Action Bridge ──
@app.post("/v1/actions")
async def create_action(action: TVActionRequest, background_tasks: BackgroundTasks):
    """Execute a TradingView MCP action."""
    entry = {
        "id": str(uuid.uuid4()),
        "type": action.type,
        "symbol": action.symbol,
        "params": action.params,
        "status": "pending",
        "result": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    tv_actions.append(entry)
    background_tasks.add_task(execute_action, entry)
    return {"status": "queued", "action": entry}


async def execute_action(action: dict):
    """Execute MCP action by routing to appropriate service."""
    import httpx
    try:
        action["status"] = "running"
        if action["type"] == "analyze_symbol":
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{API_GATEWAY}/v1/features/{action['symbol']}",
                    timeout=15,
                )
                action["result"] = resp.json() if resp.status_code == 200 else None
        elif action["type"] == "launch_backtest":
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{API_GATEWAY}/v1/backtest/run",
                    json={"symbol": action["symbol"], **action["params"]},
                    timeout=30,
                )
                action["result"] = resp.json() if resp.status_code == 200 else None
        elif action["type"] == "queue_trade":
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{API_GATEWAY}/v1/trades/paper",
                    json={"symbol": action["symbol"], **action["params"]},
                    timeout=10,
                )
                action["result"] = resp.json() if resp.status_code == 200 else None
        elif action["type"] == "save_chart":
            action["result"] = {"saved": True, "symbol": action["symbol"]}
        elif action["type"] == "compare_setups":
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"{API_GATEWAY}/v1/memory/similar?symbol={action['symbol']}",
                    timeout=10,
                )
                action["result"] = resp.json() if resp.status_code == 200 else None

        action["status"] = "completed"
        logger.info(f"Action {action['id']} completed: {action['type']}")
    except Exception as e:
        action["status"] = "failed"
        action["result"] = {"error": str(e)}
        logger.error(f"Action {action['id']} failed: {e}")


@app.get("/v1/actions")
async def list_actions(limit: int = 50):
    return {"actions": tv_actions[-limit:][::-1], "total": len(tv_actions)}


@app.get("/v1/actions/{action_id}")
async def get_action(action_id: str):
    for a in tv_actions:
        if a["id"] == action_id:
            return a
    raise HTTPException(status_code=404, detail="Action not found")


# ── Replay Connector ──
@app.post("/v1/replay/save")
async def save_replay_session(data: dict):
    """Save a TradingView replay session observation to memory."""
    import httpx
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{API_GATEWAY}/v1/memory/store",
                json={
                    "symbol": data.get("symbol", "UNKNOWN"),
                    "setup_type": "replay_observation",
                    "outcome": "pending",
                    "notes": data.get("notes", ""),
                    "features": data.get("features", {}),
                },
                timeout=10,
            )
            return {"status": "saved", "memory_id": resp.json().get("id")}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8007)
