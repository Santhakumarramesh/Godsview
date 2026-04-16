"""
GodsView v2 — Backtest Service

FastAPI service wrapping the full backtest engine.
Results are cached in memory (LRU) for fast retrieval.
Includes experiment tracking, replay engine, and promotion pipeline.
"""
from __future__ import annotations

import time
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse, Bar
from services.backtest_service.engine import (
    BacktestConfig, SUPPORTED_TIMEFRAMES, run_backtest,
)
from services.backtest_service.experiment_tracker import ExperimentDB
from services.backtest_service.replay_engine import replay_bars, frame_to_dict
from services.backtest_service.promotion_pipeline import PromotionPipeline

log = get_logger(__name__)
_STARTED_AT = 0.0

# In-memory results store (run_id → BacktestResult dict)
_results: dict[str, Any] = {}

# Experiment and promotion trackers
_experiment_db: ExperimentDB
_promotion_pipeline: PromotionPipeline


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT, _experiment_db, _promotion_pipeline
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    _experiment_db = ExperimentDB()
    _promotion_pipeline = PromotionPipeline()
    log.info("backtest_service_ready", port=cfg.backtest_port)
    yield


app = FastAPI(title="GodsView v2 — Backtest Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class RunRequest(BaseModel):
    symbol:         str
    timeframe:      str   = "15min"
    lookback_days:  int   = 30
    initial_equity: float = 10_000.0
    use_si_filter:  bool  = True
    strategy:       str   = "sk_setup"
    commission_pct: float = 0.0005


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return HealthResponse(
        service="backtest",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={"cached_results": str(len(_results))},
    )


@app.get("/timeframes")
async def supported_timeframes() -> dict[str, Any]:
    return {"timeframes": SUPPORTED_TIMEFRAMES}


@app.post("/run")
async def run(req: RunRequest) -> dict[str, Any]:
    """Execute a full backtest and return the result."""
    from datetime import datetime, timedelta, timezone

    # Fetch bars from market data service
    limit = int(req.lookback_days * 26)   # approximate bars count
    try:
        async with service_client(cfg.market_data_url) as client:
            resp = await client.get(
                f"/bars/{req.symbol}",
                params={
                    "timeframe": req.timeframe,
                    "limit": min(limit, 5000),
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}")

    raw = data.get("bars", [])
    if not raw:
        raise HTTPException(status_code=404, detail=f"No bars for {req.symbol}")

    bars: list[Bar] = []
    for r in raw:
        ts = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
        bars.append(Bar(
            symbol=req.symbol,
            timestamp=ts,
            open=r["o"], high=r["h"], low=r["l"], close=r["c"],
            volume=r["v"], timeframe=req.timeframe,
        ))

    config = BacktestConfig(
        symbol=req.symbol,
        timeframe=req.timeframe,
        lookback_days=req.lookback_days,
        initial_equity=req.initial_equity,
        commission_pct=req.commission_pct,
        use_si_filter=req.use_si_filter,
        strategy=req.strategy,
    )

    result = run_backtest(bars, config)
    result_dict = result.model_dump()
    result_dict["run_at"] = time.time()
    _results[result.run_id] = result_dict

    return result_dict


@app.get("/results")
async def list_results(
    symbol: str | None = Query(default=None),
    limit:  int = Query(default=20, ge=1, le=100),
) -> dict[str, Any]:
    items = list(_results.values())
    if symbol:
        items = [r for r in items if r.get("symbol") == symbol.upper()]
    items.sort(key=lambda r: r.get("run_at", 0), reverse=True)
    return {
        "total": len(items),
        "results": items[:limit],
    }


@app.get("/results/{run_id}")
async def get_result(run_id: str) -> dict[str, Any]:
    if run_id not in _results:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return _results[run_id]


# ── Quant Lab: Replay Engine ──────────────────────────────────────────────────

@app.get("/quant/replay/{symbol}")
async def replay_symbol(
    symbol: str,
    timeframe: str = Query(default="15min"),
    lookback_days: int = Query(default=30),
) -> dict[str, Any]:
    """
    Replay market history through GodsView's signal detector.
    Returns frame-by-frame analysis of what GodsView saw and decided.
    """
    limit = int(lookback_days * 26)
    try:
        async with service_client(cfg.market_data_url) as client:
            resp = await client.get(
                f"/bars/{symbol}",
                params={
                    "timeframe": timeframe,
                    "limit": min(limit, 5000),
                },
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Market data unavailable: {exc}")

    raw = data.get("bars", [])
    if not raw:
        raise HTTPException(status_code=404, detail=f"No bars for {symbol}")

    from datetime import datetime
    bars: list[Bar] = []
    for r in raw:
        ts = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
        bars.append(Bar(
            symbol=symbol,
            timestamp=ts,
            open=r["o"], high=r["h"], low=r["l"], close=r["c"],
            volume=r["v"], timeframe=timeframe,
        ))

    # Run replay
    trace = replay_bars(bars, timeframe, symbol)

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "total_bars": trace.total_bars,
        "total_signals": trace.total_signals,
        "win_rate": trace.win_rate,
        "avg_confidence": trace.avg_confidence,
        "frames": [frame_to_dict(f) for f in trace.frames],
    }


# ── Quant Lab: Experiment Tracker ─────────────────────────────────────────────

class ExperimentRequest(BaseModel):
    name: str
    parameters: dict[str, Any]
    version: str = "1.0"
    parent_experiment_id: str | None = None


@app.post("/quant/experiment")
async def create_experiment(req: ExperimentRequest) -> dict[str, Any]:
    """Create a new experiment."""
    experiment_id = _experiment_db.create_experiment(
        name=req.name,
        params=req.parameters,
        version=req.version,
        parent_id=req.parent_experiment_id,
    )
    return {
        "experiment_id": experiment_id,
        "name": req.name,
        "version": req.version,
        "status": "RUNNING",
    }


class ResultRequest(BaseModel):
    experiment_id: str
    metrics: dict[str, Any]


@app.post("/quant/experiment/result")
async def record_experiment_result(req: ResultRequest) -> dict[str, Any]:
    """Record experiment result."""
    from services.shared.types import BacktestMetrics

    # Convert dict to BacktestMetrics
    metrics = BacktestMetrics(**req.metrics)

    result_id = _experiment_db.record_result(req.experiment_id, metrics)

    return {
        "result_id": result_id,
        "experiment_id": req.experiment_id,
        "status": "recorded",
    }


@app.get("/quant/experiments")
async def list_experiments(limit: int = Query(default=50, ge=1, le=100)) -> dict[str, Any]:
    """List all experiments."""
    experiments = _experiment_db.list_experiments(limit)
    return {
        "total": len(experiments),
        "experiments": experiments,
    }


@app.get("/quant/experiment/{experiment_id}")
async def get_experiment(experiment_id: str) -> dict[str, Any]:
    """Get experiment details."""
    exp = _experiment_db.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return exp


@app.get("/quant/compare")
async def compare_experiments(
    experiment_a: str = Query(...),
    experiment_b: str = Query(...),
) -> dict[str, Any]:
    """Compare two experiments."""
    comparison = _experiment_db.compare_experiments(experiment_a, experiment_b)
    if not comparison:
        raise HTTPException(status_code=404, detail="Could not compare experiments")
    return {
        "experiment_a": comparison.experiment_a_name,
        "experiment_b": comparison.experiment_b_name,
        "metrics_diff": comparison.metrics_diff,
        "better_metrics": comparison.better_metrics,
    }


@app.get("/quant/experiments/rank")
async def rank_experiments(
    metric: str = Query(default="sharpe_ratio"),
    top_k: int = Query(default=10, ge=1, le=50),
) -> dict[str, Any]:
    """Rank experiments by a metric."""
    ranked = _experiment_db.rank_experiments(top_k, metric)
    return {
        "metric": metric,
        "top_k": top_k,
        "experiments": ranked,
    }


@app.get("/quant/experiments/sensitivity")
async def parameter_sensitivity(
    param_name: str = Query(...),
    metric: str = Query(default="sharpe_ratio"),
) -> dict[str, Any]:
    """Analyze parameter sensitivity."""
    sensitivity = _experiment_db.parameter_sensitivity(param_name, metric)
    return {
        "parameter": param_name,
        "metric": metric,
        "sensitivity": sensitivity,
    }


# ── Quant Lab: Promotion Pipeline ─────────────────────────────────────────────

class StrategyRequest(BaseModel):
    strategy_id: str
    name: str
    backtest_metrics: dict[str, Any]


@app.post("/quant/strategy/register")
async def register_strategy(req: StrategyRequest) -> dict[str, Any]:
    """Register a strategy for promotion tracking."""
    from services.shared.types import BacktestMetrics

    metrics = BacktestMetrics(**req.backtest_metrics)
    _promotion_pipeline.register_strategy(req.strategy_id, req.name, metrics)

    return {
        "strategy_id": req.strategy_id,
        "name": req.name,
        "stage": "EXPERIMENTAL",
        "registered": True,
    }


@app.get("/quant/strategy/{strategy_id}/eligibility")
async def check_eligibility(strategy_id: str) -> dict[str, Any]:
    """Check promotion eligibility."""
    return _promotion_pipeline.check_promotion_eligibility(strategy_id)


@app.post("/quant/strategy/{strategy_id}/promote")
async def promote_strategy(strategy_id: str) -> dict[str, Any]:
    """Attempt to promote strategy."""
    return _promotion_pipeline.promote_strategy(strategy_id)


class DemotionRequest(BaseModel):
    reason: str


@app.post("/quant/strategy/{strategy_id}/demote")
async def demote_strategy(
    strategy_id: str,
    req: DemotionRequest = Body(...),
) -> dict[str, Any]:
    """Demote strategy."""
    return _promotion_pipeline.demote_strategy(strategy_id, req.reason)


@app.get("/quant/pipeline/status")
async def pipeline_status() -> dict[str, Any]:
    """Get overall pipeline status."""
    return _promotion_pipeline.get_pipeline_status()


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.backtest_service.main:app",
        host="0.0.0.0",
        port=cfg.backtest_port,
        reload=cfg.env == "development",
    )
