"""
API Gateway — /api/portfolio routes
Portfolio snapshot, allocations, and pre-trade risk checks
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class PortfolioSnapshot(BaseModel):
    """Portfolio snapshot response"""
    total_equity: float
    cash: float
    positions_value: float
    unrealized_pnl: float
    realized_pnl: float
    return_pct: float
    positions: list[dict[str, Any]]


class AllocationBreakdown(BaseModel):
    """Strategy allocation breakdown"""
    total_allocation: float
    by_strategy: dict[str, float]
    by_sector: dict[str, float]
    by_symbol: dict[str, float]


class RiskPolicy(BaseModel):
    """Risk policy definition"""
    name: str
    max_daily_loss_pct: float
    max_position_size_pct: float
    max_open_positions: int
    default_risk_per_trade_pct: float


class RiskCheckRequest(BaseModel):
    """Pre-trade risk check parameters"""
    symbol: str
    shares: float
    price: float
    side: str  # "BUY" | "SELL"


class RiskCheckResponse(BaseModel):
    """Pre-trade risk check result"""
    approved: bool
    symbol: str
    shares: float
    risk_pct: float
    max_risk_pct: float
    violations: list[str]


@router.get("/snapshot")
async def get_portfolio_snapshot() -> PortfolioSnapshot:
    """Get current portfolio snapshot with positions and PnL"""
    return PortfolioSnapshot(
        total_equity=1_000_000.0,
        cash=450_000.0,
        positions_value=550_000.0,
        unrealized_pnl=25_000.0,
        realized_pnl=15_000.0,
        return_pct=4.0,
        positions=[
            {
                "symbol": "AAPL",
                "shares": 100,
                "entry_price": 145.50,
                "current_price": 152.30,
                "pnl": 680.0,
                "allocation_pct": 15.2,
            },
            {
                "symbol": "TSLA",
                "shares": 50,
                "entry_price": 240.00,
                "current_price": 245.75,
                "pnl": 287.5,
                "allocation_pct": 12.3,
            },
        ],
    )


@router.get("/allocations")
async def get_allocations() -> AllocationBreakdown:
    """Get strategy allocation breakdown by strategy, sector, and symbol"""
    return AllocationBreakdown(
        total_allocation=550_000.0,
        by_strategy={
            "mean_reversion": 275_000.0,
            "trend_following": 165_000.0,
            "ml_signals": 110_000.0,
        },
        by_sector={
            "Technology": 220_000.0,
            "Healthcare": 165_000.0,
            "Financials": 110_000.0,
            "Energy": 55_000.0,
        },
        by_symbol={
            "AAPL": 152_300.0,
            "TSLA": 122_875.0,
            "MSFT": 110_000.0,
            "META": 88_000.0,
            "NVDA": 76_825.0,
        },
    )


@router.get("/risk/policies")
async def get_risk_policies() -> dict[str, Any]:
    """Get active risk policies"""
    return {
        "policies": [
            {
                "name": "default",
                "max_daily_loss_pct": 2.0,
                "max_position_size_pct": 5.0,
                "max_open_positions": 10,
                "default_risk_per_trade_pct": 1.0,
            },
            {
                "name": "conservative",
                "max_daily_loss_pct": 1.0,
                "max_position_size_pct": 3.0,
                "max_open_positions": 5,
                "default_risk_per_trade_pct": 0.5,
            },
        ],
        "active_policy": "default",
    }


@router.get("/risk/check/{order_id}")
async def check_pre_trade_risk(order_id: str) -> RiskCheckResponse:
    """Run pre-trade risk check on an order (mock)"""
    return RiskCheckResponse(
        approved=True,
        symbol="AAPL",
        shares=100,
        risk_pct=1.2,
        max_risk_pct=2.0,
        violations=[],
    )


@router.get("/risk/killswitch")
async def get_killswitch_status() -> dict[str, Any]:
    """Get killswitch status and recent triggers"""
    return {
        "enabled": False,
        "triggered": False,
        "reason": None,
        "triggered_at": None,
        "triggered_by": None,
        "last_5_triggers": [
            {
                "timestamp": "2026-04-19T14:32:10Z",
                "reason": "max_daily_loss_exceeded",
                "daily_loss_pct": 2.5,
            },
        ],
    }


@router.post("/risk/killswitch")
async def trigger_killswitch() -> dict[str, Any]:
    """Emergency killswitch - halt all trading"""
    return {
        "status": "triggered",
        "timestamp": "2026-04-20T10:00:00Z",
        "message": "Trading halted - killswitch activated",
        "all_positions_closed": True,
    }
