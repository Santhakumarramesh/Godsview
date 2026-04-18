"""
GodsView v2 — Risk Service

Pre-trade risk checks, position limits, daily loss limits, and
kill-switch logic.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse

log = get_logger(__name__)
_STARTED_AT = 0.0

# Runtime state
_daily_pnl = 0.0
_open_positions = 0
_kill_switch = False
_trades_today = 0
_RESET_HOUR = 0  # reset daily at midnight UTC


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    log.info(
        "risk_service_ready",
        port=cfg.risk_port,
        max_daily_loss=cfg.max_daily_loss_pct,
        max_open=cfg.max_open_positions,
    )
    yield


app = FastAPI(title="GodsView v2 — Risk Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


class TradeCheckRequest(BaseModel):
    signal_id: str
    symbol: str
    side: str
    qty: float
    entry_price: float
    stop_price: float
    target_price: float
    dry_run: bool = True


class PnlUpdate(BaseModel):
    trade_pnl_pct: float
    closed: bool = True


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="risk",
        status="ok" if not _kill_switch else "degraded",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={
            "kill_switch": str(_kill_switch),
            "daily_pnl_pct": f"{_daily_pnl:.2f}%",
            "open_positions": str(_open_positions),
            "trades_today": str(_trades_today),
        },
    )


@app.post("/check")
async def pre_trade_check(req: TradeCheckRequest) -> dict[str, Any]:
    """
    Run all pre-trade risk checks.
    Returns approved: True/False + reason.
    """
    global _kill_switch

    # ── Kill switch ───────────────────────────────────────────────────────────
    if _kill_switch:
        return _reject("kill_switch_active")

    # ── Daily loss limit ──────────────────────────────────────────────────────
    if _daily_pnl <= -cfg.max_daily_loss_pct:
        _kill_switch = True
        log.warning("kill_switch_triggered", daily_pnl=_daily_pnl)
        return _reject("daily_loss_limit_breached")

    # ── Max open positions ─────────────────────────────────────────────────────
    if _open_positions >= cfg.max_open_positions:
        return _reject(f"max_open_positions_reached ({cfg.max_open_positions})")

    # ── Position size check ───────────────────────────────────────────────────
    trade_value = req.entry_price * req.qty
    # Would need account equity for real check; use a nominal $10k for now
    nominal_equity = 10_000.0
    size_pct = trade_value / nominal_equity * 100
    if size_pct > cfg.max_position_size_pct:
        return _reject(
            f"position_too_large ({size_pct:.1f}% > {cfg.max_position_size_pct}%)"
        )

    # ── Minimum risk:reward ───────────────────────────────────────────────────
    risk = abs(req.entry_price - req.stop_price)
    reward = abs(req.entry_price - req.target_price)
    rr = reward / risk if risk else 0.0
    if rr < 1.5:
        return _reject(f"rr_too_low ({rr:.2f} < 1.5)")

    log.info(
        "risk_approved",
        symbol=req.symbol,
        size_pct=f"{size_pct:.1f}%",
        rr=f"{rr:.2f}",
    )
    return {
        "approved": True,
        "reason": "all_checks_passed",
        "checks": {
            "kill_switch": False,
            "daily_loss": f"{_daily_pnl:.2f}%",
            "open_pos": _open_positions,
            "size_pct": round(size_pct, 2),
            "rr": round(rr, 2),
        },
    }


@app.post("/pnl/update")
async def update_pnl(update: PnlUpdate) -> dict[str, Any]:
    """Record a trade result for daily P&L tracking."""
    global _daily_pnl, _open_positions, _trades_today
    _daily_pnl += update.trade_pnl_pct
    if update.closed:
        _open_positions = max(0, _open_positions - 1)
        _trades_today += 1
    log.info("pnl_updated", daily_pnl=f"{_daily_pnl:.3f}%")
    return {"daily_pnl_pct": round(_daily_pnl, 4), "trades_today": _trades_today}


@app.post("/position/open")
async def record_position_open() -> dict[str, Any]:
    global _open_positions
    _open_positions += 1
    return {"open_positions": _open_positions}


@app.get("/status")
async def risk_status() -> dict[str, Any]:
    return {
        "kill_switch": _kill_switch,
        "daily_pnl_pct": round(_daily_pnl, 4),
        "open_positions": _open_positions,
        "trades_today": _trades_today,
        "limits": {
            "max_daily_loss_pct": cfg.max_daily_loss_pct,
            "max_open_positions": cfg.max_open_positions,
            "max_position_size_pct": cfg.max_position_size_pct,
            "risk_per_trade_pct": cfg.default_risk_per_trade_pct,
        },
    }


@app.post("/kill-switch/reset")
async def reset_kill_switch() -> dict[str, Any]:
    global _kill_switch, _daily_pnl
    _kill_switch = False
    _daily_pnl = 0.0
    log.warning("kill_switch_reset")
    return {"kill_switch": False, "message": "Kill switch reset — trading re-enabled"}


def _reject(reason: str) -> dict[str, Any]:
    log.warning("risk_rejected", reason=reason)
    return {"approved": False, "reason": reason}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "services.risk_service.main:app",
        host="0.0.0.0",
        port=cfg.risk_port,
        reload=cfg.env == "development",
    )
