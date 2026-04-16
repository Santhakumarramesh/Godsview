"""
GodsView v2 — Risk Service

Pre-trade risk checks, position limits, daily loss limits, kill-switch logic,
and comprehensive portfolio intelligence (correlation, sector exposure, VaR, Sharpe, etc.)
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from services.risk_service.portfolio_engine import PortfolioEngine, Position
from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse

log = get_logger(__name__)
_STARTED_AT = 0.0

# Runtime state
_daily_pnl         = 0.0
_open_positions    = 0
_kill_switch       = False
_trades_today      = 0
_RESET_HOUR        = 0   # reset daily at midnight UTC

# Portfolio state
_portfolio_engine  = None
_portfolio_positions: dict[str, dict[str, Any]] = {}  # symbol -> {qty, price, entry_time, strategy}
_portfolio_price_history: dict[str, pd.DataFrame] = {}  # symbol -> DataFrame
_peak_equity = 10_000.0
_strategy_pnls: dict[str, dict[str, dict[str, float]]] = {}  # strategy -> symbol -> {win_rate, avg_win, avg_loss}


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT, _portfolio_engine
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    _portfolio_engine = PortfolioEngine(
        risk_free_rate=0.02,
        lookback_days=20,
        var_confidence=0.95,
    )
    log.info(
        "risk_service_ready",
        port=cfg.risk_port,
        max_daily_loss=cfg.max_daily_loss_pct,
        max_open=cfg.max_open_positions,
    )
    yield


app = FastAPI(title="GodsView v2 — Risk Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class TradeCheckRequest(BaseModel):
    signal_id:   str
    symbol:      str
    side:        str
    qty:         float
    entry_price: float
    stop_price:  float
    target_price: float
    dry_run:     bool = True


class PnlUpdate(BaseModel):
    trade_pnl_pct: float
    closed:        bool = True


# ── Portfolio-specific models ──────────────────────────────────────────────────

class PortfolioPositionRequest(BaseModel):
    symbol: str
    qty: float
    entry_price: float
    current_price: float
    strategy: str = "default"


class PriceBarUpdate(BaseModel):
    """Update price history for correlation/risk calculations."""
    symbol: str
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    volume: float
    timestamp: datetime


class RebalanceRequest(BaseModel):
    account_equity: float
    cash: float
    max_position_pct: float = Field(default=0.05)
    max_strategy_pct: float = Field(default=0.40)


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="risk",
        status="ok" if not _kill_switch else "degraded",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={
            "kill_switch":     str(_kill_switch),
            "daily_pnl_pct":   f"{_daily_pnl:.2f}%",
            "open_positions":  str(_open_positions),
            "trades_today":    str(_trades_today),
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
        return _reject(f"position_too_large ({size_pct:.1f}% > {cfg.max_position_size_pct}%)")

    # ── Minimum risk:reward ───────────────────────────────────────────────────
    risk   = abs(req.entry_price - req.stop_price)
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
        "reason":   "all_checks_passed",
        "checks": {
            "kill_switch": False,
            "daily_loss":  f"{_daily_pnl:.2f}%",
            "open_pos":    _open_positions,
            "size_pct":    round(size_pct, 2),
            "rr":          round(rr, 2),
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
        "kill_switch":    _kill_switch,
        "daily_pnl_pct":  round(_daily_pnl, 4),
        "open_positions": _open_positions,
        "trades_today":   _trades_today,
        "limits": {
            "max_daily_loss_pct":    cfg.max_daily_loss_pct,
            "max_open_positions":    cfg.max_open_positions,
            "max_position_size_pct": cfg.max_position_size_pct,
            "risk_per_trade_pct":    cfg.default_risk_per_trade_pct,
        },
    }


@app.post("/kill-switch/reset")
async def reset_kill_switch() -> dict[str, Any]:
    global _kill_switch, _daily_pnl
    _kill_switch = False
    _daily_pnl   = 0.0
    log.warning("kill_switch_reset")
    return {"kill_switch": False, "message": "Kill switch reset — trading re-enabled"}


# ── Portfolio Intelligence Endpoints ──────────────────────────────────────────

@app.get("/portfolio/summary")
async def portfolio_summary() -> dict[str, Any]:
    """Return full portfolio intelligence snapshot."""
    if not _portfolio_engine or not _portfolio_positions:
        return {
            "status": "no_positions",
            "num_positions": 0,
            "total_equity": 0.0,
            "timestamp": datetime.utcnow().isoformat(),
        }

    # Convert positions
    positions = []
    total_equity = sum(
        p["current_price"] * p["qty"]
        for p in _portfolio_positions.values()
    )
    if total_equity == 0:
        total_equity = 10_000.0

    for symbol, pos_data in _portfolio_positions.items():
        try:
            positions.append(Position(
                symbol=symbol,
                qty=pos_data["qty"],
                entry_price=pos_data["entry_price"],
                current_price=pos_data["current_price"],
                entry_time=pos_data["entry_time"],
                strategy=pos_data.get("strategy", "default"),
            ))
        except Exception:
            log.debug("error_converting_position", symbol=symbol, exc_info=True)

    # Run full analysis
    try:
        intel = _portfolio_engine.analyze_portfolio(
            positions=positions,
            price_history=_portfolio_price_history,
            account_equity=total_equity,
            cash=10_000.0 - total_equity,
            peak_equity=_peak_equity,
            strategy_pnls=_strategy_pnls,
            max_position_pct=cfg.max_position_size_pct / 100.0,
            max_strategy_pct=0.40,
        )

        return {
            "timestamp": intel.timestamp.isoformat(),
            "status": "ok",
            "total_equity": round(intel.total_equity, 2),
            "cash": round(intel.cash, 2),
            "num_positions": intel.num_positions,
            "num_warnings": len(intel.health_warnings),
            "warnings": intel.health_warnings,
            "summary": {
                "correlations_analyzed": len(intel.correlations.symbols),
                "dangerous_pairs": len(intel.correlations.dangerous_pairs),
                "sectors_exposed": len(intel.sector_exposure.exposures),
                "over_concentrated": len(intel.sector_exposure.over_concentrated),
                "drawdown_pct": round(intel.drawdown_metrics.drawdown_pct, 2),
                "position_size_multiplier": round(intel.drawdown_metrics.position_size_multiplier, 2),
                "trading_halted": intel.drawdown_metrics.trading_halted,
                "sharpe_ratio": round(intel.risk_metrics.sharpe_ratio, 3),
                "sortino_ratio": round(intel.risk_metrics.sortino_ratio, 3),
                "var_95_pct": round(intel.risk_metrics.var_95, 4),
                "cvar_95_pct": round(intel.risk_metrics.cvar_95, 4),
            },
        }
    except Exception as e:
        log.error(f"portfolio_summary_error: {e}")
        return {
            "status": "error",
            "message": str(e),
            "timestamp": datetime.utcnow().isoformat(),
        }


@app.get("/portfolio/correlation")
async def portfolio_correlation() -> dict[str, Any]:
    """Return correlation matrix."""
    if not _portfolio_engine or not _portfolio_positions:
        return {"status": "no_positions", "correlations": {}}

    positions = []
    for symbol, pos_data in _portfolio_positions.items():
        try:
            positions.append(Position(
                symbol=symbol,
                qty=pos_data["qty"],
                entry_price=pos_data["entry_price"],
                current_price=pos_data["current_price"],
                entry_time=pos_data["entry_time"],
                strategy=pos_data.get("strategy", "default"),
            ))
        except Exception:
            log.debug("error_converting_position_for_correlation", symbol=symbol, exc_info=True)

    if len(positions) < 2:
        return {"status": "insufficient_positions", "min_required": 2}

    try:
        corr = _portfolio_engine._compute_correlations(positions, _portfolio_price_history)
        return {
            "timestamp": corr.timestamp.isoformat(),
            "symbols": corr.symbols,
            "matrix": corr.matrix.tolist() if hasattr(corr.matrix, 'tolist') else [],
            "dangerous_pairs": [
                {"symbol_a": s1, "symbol_b": s2, "correlation": round(c, 3)}
                for s1, s2, c in corr.dangerous_pairs
            ],
        }
    except Exception as e:
        log.error(f"correlation_error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/portfolio/sectors")
async def portfolio_sectors() -> dict[str, Any]:
    """Return sector exposure breakdown."""
    if not _portfolio_engine or not _portfolio_positions:
        return {"status": "no_positions", "exposures": {}}

    positions = []
    total_value = 0.0
    for symbol, pos_data in _portfolio_positions.items():
        try:
            pos = Position(
                symbol=symbol,
                qty=pos_data["qty"],
                entry_price=pos_data["entry_price"],
                current_price=pos_data["current_price"],
                entry_time=pos_data["entry_time"],
                strategy=pos_data.get("strategy", "default"),
            )
            positions.append(pos)
            total_value += pos.value
        except Exception:
            log.debug("error_converting_position_for_sectors", symbol=symbol, exc_info=True)

    if total_value == 0:
        total_value = 10_000.0

    try:
        sector_exp = _portfolio_engine._compute_sector_exposure(positions, total_value)
        return {
            "timestamp": sector_exp.timestamp.isoformat(),
            "exposures": {s: round(pct, 2) for s, pct in sector_exp.exposures.items()},
            "over_concentrated": [
                {"sector": s, "pct": round(pct, 2)}
                for s, pct in sector_exp.over_concentrated
            ],
        }
    except Exception as e:
        log.error(f"sectors_error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/portfolio/risk-metrics")
async def portfolio_risk_metrics() -> dict[str, Any]:
    """Return comprehensive risk metrics."""
    if not _portfolio_engine or not _portfolio_positions:
        return {"status": "no_positions"}

    positions = []
    for symbol, pos_data in _portfolio_positions.items():
        try:
            positions.append(Position(
                symbol=symbol,
                qty=pos_data["qty"],
                entry_price=pos_data["entry_price"],
                current_price=pos_data["current_price"],
                entry_time=pos_data["entry_time"],
                strategy=pos_data.get("strategy", "default"),
            ))
        except Exception:
            log.debug("error_converting_position_for_risk_metrics", symbol=symbol, exc_info=True)

    try:
        metrics = _portfolio_engine._compute_risk_metrics(positions, _portfolio_price_history)
        return {
            "timestamp": metrics.timestamp.isoformat(),
            "var_95_pct": round(metrics.var_95, 4),
            "var_99_pct": round(metrics.var_99, 4),
            "cvar_95_pct": round(metrics.cvar_95, 4),
            "cvar_99_pct": round(metrics.cvar_99, 4),
            "sharpe_ratio": round(metrics.sharpe_ratio, 3),
            "sortino_ratio": round(metrics.sortino_ratio, 3),
            "beta_to_spy": round(metrics.beta_to_spy, 3) if metrics.beta_to_spy else None,
        }
    except Exception as e:
        log.error(f"risk_metrics_error: {e}")
        return {"status": "error", "message": str(e)}


@app.get("/portfolio/allocation")
async def portfolio_allocation() -> dict[str, Any]:
    """Return current and recommended allocation."""
    if not _portfolio_engine or not _portfolio_positions:
        return {"status": "no_positions"}

    positions = []
    total_value = 0.0
    for symbol, pos_data in _portfolio_positions.items():
        try:
            pos = Position(
                symbol=symbol,
                qty=pos_data["qty"],
                entry_price=pos_data["entry_price"],
                current_price=pos_data["current_price"],
                entry_time=pos_data["entry_time"],
                strategy=pos_data.get("strategy", "default"),
            )
            positions.append(pos)
            total_value += pos.value
        except Exception:
            log.debug("error_converting_position_for_allocation", symbol=symbol, exc_info=True)

    if total_value == 0:
        total_value = 10_000.0

    try:
        # Compute drawdown for multiplier
        drawdown = _portfolio_engine._compute_drawdown(total_value, _peak_equity)

        # Position sizing
        sizings = _portfolio_engine._compute_position_sizing(
            positions,
            _strategy_pnls,
            cfg.max_position_size_pct / 100.0,
            drawdown.position_size_multiplier,
        )

        # Strategy allocations
        strat_allocs = _portfolio_engine._compute_strategy_allocations(
            positions,
            _strategy_pnls,
            total_value,
            0.40,
        )

        return {
            "timestamp": datetime.utcnow().isoformat(),
            "current_allocations": [
                {
                    "symbol": s.symbol,
                    "current_pct": round((s.value / total_value * 100.0), 2),
                    "recommended_pct": round(s.final_pct, 2),
                    "kelly_fraction": round(s.kelly_fraction, 3),
                    "half_kelly_fraction": round(s.half_kelly_fraction, 3),
                }
                for s in sizings
            ],
            "strategy_allocations": [
                {
                    "strategy": a.strategy,
                    "positions": a.positions_count,
                    "allocated_pct": round(a.allocated_pct, 2),
                    "total_pnl": round(a.total_pnl, 2),
                    "total_pnl_pct": round(a.total_pnl_pct, 2),
                    "recommended_increase": a.recommended_increase,
                }
                for a in strat_allocs
            ],
            "drawdown_multiplier": round(drawdown.position_size_multiplier, 2),
        }
    except Exception as e:
        log.error(f"allocation_error: {e}")
        return {"status": "error", "message": str(e)}


@app.post("/portfolio/rebalance")
async def rebalance_portfolio(req: RebalanceRequest) -> dict[str, Any]:
    """Trigger a rebalancing calculation and recommendation."""
    if not _portfolio_engine or not _portfolio_positions:
        return {"status": "no_positions", "recommendations": []}

    positions = []
    for symbol, pos_data in _portfolio_positions.items():
        try:
            positions.append(Position(
                symbol=symbol,
                qty=pos_data["qty"],
                entry_price=pos_data["entry_price"],
                current_price=pos_data["current_price"],
                entry_time=pos_data["entry_time"],
                strategy=pos_data.get("strategy", "default"),
            ))
        except Exception:
            log.debug("error_converting_position_for_rebalance", symbol=symbol, exc_info=True)

    try:
        intel = _portfolio_engine.analyze_portfolio(
            positions=positions,
            price_history=_portfolio_price_history,
            account_equity=req.account_equity,
            cash=req.cash,
            peak_equity=_peak_equity,
            strategy_pnls=_strategy_pnls,
            max_position_pct=req.max_position_pct,
            max_strategy_pct=req.max_strategy_pct,
        )

        recommendations = []
        for sizing in intel.position_sizing:
            recommendations.append({
                "symbol": sizing.symbol,
                "kelly_fraction": round(sizing.kelly_fraction, 3),
                "half_kelly_fraction": round(sizing.half_kelly_fraction, 3),
                "recommended_pct": round(sizing.recommended_pct, 2),
                "final_pct_after_dd": round(sizing.final_pct, 2),
                "reason": sizing.reason,
            })

        return {
            "timestamp": intel.timestamp.isoformat(),
            "status": "ok",
            "recommendations": recommendations,
            "warnings": intel.health_warnings,
            "total_equity": round(intel.total_equity, 2),
            "num_positions": intel.num_positions,
            "drawdown_pct": round(intel.drawdown_metrics.drawdown_pct, 2),
            "trading_halted": intel.drawdown_metrics.trading_halted,
        }
    except Exception as e:
        log.error(f"rebalance_error: {e}")
        return {"status": "error", "message": str(e)}


# ── Position Management Endpoints ──────────────────────────────────────────────

@app.post("/portfolio/position/add")
async def add_position(req: PortfolioPositionRequest) -> dict[str, Any]:
    """Add a position to portfolio tracking."""
    global _portfolio_positions, _peak_equity
    _portfolio_positions[req.symbol] = {
        "qty": req.qty,
        "entry_price": req.entry_price,
        "current_price": req.current_price,
        "entry_time": datetime.utcnow(),
        "strategy": req.strategy,
    }
    log.info("position_added", symbol=req.symbol, qty=req.qty, strategy=req.strategy)
    return {"status": "ok", "symbol": req.symbol, "positions_count": len(_portfolio_positions)}


@app.post("/portfolio/position/remove")
async def remove_position(symbol: str) -> dict[str, Any]:
    """Remove a position from portfolio tracking."""
    global _portfolio_positions
    if symbol in _portfolio_positions:
        del _portfolio_positions[symbol]
        log.info("position_removed", symbol=symbol)
    return {"status": "ok", "symbol": symbol, "positions_count": len(_portfolio_positions)}


@app.post("/portfolio/price/update")
async def update_price(update: PriceBarUpdate) -> dict[str, Any]:
    """Update price history for correlation/risk calculations."""
    global _portfolio_price_history

    if update.symbol not in _portfolio_price_history:
        _portfolio_price_history[update.symbol] = pd.DataFrame()

    # Append new bar
    bar = {
        "timestamp": update.timestamp,
        "open": update.open_price,
        "high": update.high_price,
        "low": update.low_price,
        "close": update.close_price,
        "volume": update.volume,
    }

    # Keep last 100 bars for rolling correlation
    df = _portfolio_price_history[update.symbol]
    if len(df) == 0:
        _portfolio_price_history[update.symbol] = pd.DataFrame([bar])
    else:
        new_df = pd.concat([df, pd.DataFrame([bar])], ignore_index=True)
        _portfolio_price_history[update.symbol] = new_df.tail(100)

    log.info("price_updated", symbol=update.symbol, close=update.close_price)
    return {"status": "ok", "symbol": update.symbol, "bars_stored": len(_portfolio_price_history[update.symbol])}


@app.post("/portfolio/strategy-pnl/update")
async def update_strategy_pnl(strategy: str, symbol: str, pnl_data: dict[str, float]) -> dict[str, Any]:
    """Update win rate / avg win / avg loss for a strategy-symbol pair."""
    global _strategy_pnls
    if strategy not in _strategy_pnls:
        _strategy_pnls[strategy] = {}
    _strategy_pnls[strategy][symbol] = pnl_data
    log.info("strategy_pnl_updated", strategy=strategy, symbol=symbol)
    return {"status": "ok"}


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
