"""
GodsView v2 — ML Service

FastAPI service for model training (XGBoost), inference, model registry,
and MLflow experiment tracking.
"""
from __future__ import annotations

import asyncio
import time
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse, Signal, Direction, SignalType
from services.ml_service.models.registry import registry, ModelEntry
from services.ml_service.predictor import predict

log = get_logger(__name__)
_STARTED_AT = 0.0


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    log.info(
        "ml_service_ready",
        port=cfg.ml_port,
        models_in_registry=len(registry.list_all()),
    )
    yield


app = FastAPI(title="GodsView v2 — ML Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class TrainRequest(BaseModel):
    symbol:         str | None = None
    timeframe:      str = "15min"
    retrain_days:   int = 90
    stop_pct:       float = 0.01
    target_pct:     float = 0.02
    direction_long: bool = True


class PredictRequest(BaseModel):
    signal:   dict[str, Any]
    features: dict[str, float] = {}


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    latest = registry.get_latest()
    return HealthResponse(
        service="ml",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={
            "latest_model": latest.model_id if latest else "none",
            "model_count":  str(len(registry.list_all())),
        },
    )


@app.post("/train")
async def trigger_training(
    req: TrainRequest,
    background_tasks: BackgroundTasks,
) -> dict[str, Any]:
    """Kick off model training in the background."""
    background_tasks.add_task(_run_training, req)
    return {
        "status":    "training_started",
        "symbol":    req.symbol,
        "timeframe": req.timeframe,
        "message":   "Training running in background. Poll /models for results.",
    }


async def _run_training(req: TrainRequest) -> None:
    """Background training task."""
    from datetime import datetime, timedelta, timezone
    from services.shared.types import Bar
    from services.ml_service.training.trainer import train as train_model

    symbol = req.symbol or "AAPL"
    limit  = req.retrain_days * 26

    try:
        async with service_client(cfg.market_data_url) as client:
            resp = await client.get(
                f"/bars/{symbol}",
                params={"timeframe": req.timeframe, "limit": min(limit, 5000)},
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        log.error("training_data_fetch_failed", symbol=symbol, err=str(exc))
        return

    raw = data.get("bars", [])
    if not raw:
        log.warning("training_no_bars", symbol=symbol)
        return

    bars: list[Bar] = []
    for r in raw:
        from datetime import datetime
        ts = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
        bars.append(Bar(
            symbol=symbol,
            timestamp=ts,
            open=r["o"], high=r["h"], low=r["l"], close=r["c"],
            volume=r["v"], timeframe=req.timeframe,
        ))

    result = train_model(
        bars=bars,
        symbol=symbol,
        timeframe=req.timeframe,
        stop_pct=req.stop_pct,
        target_pct=req.target_pct,
        direction_long=req.direction_long,
    )

    if result:
        entry = ModelEntry(
            model_id=result.model_id,
            symbol=symbol,
            timeframe=req.timeframe,
            model_path=result.model_path,
            test_accuracy=result.test_accuracy,
            roc_auc=result.roc_auc,
            train_rows=result.train_rows,
            test_rows=result.test_rows,
            trained_at=result.trained_at,
            mlflow_run_id=result.mlflow_run_id,
        )
        registry.register(entry, activate=True)
        log.info("training_registered", model_id=result.model_id)


@app.post("/predict")
async def run_prediction(req: PredictRequest) -> dict[str, Any]:
    """Run inference for a signal."""
    try:
        sig_data = req.signal
        signal = Signal(
            id=sig_data.get("id", "unknown"),
            symbol=sig_data.get("symbol", ""),
            timeframe=sig_data.get("timeframe", "15min"),
            timestamp=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            direction=Direction(sig_data.get("direction", "long")),
            signal_type=SignalType(sig_data.get("signal_type", "absorption_reversal")),
            entry=float(sig_data.get("entry", 0)),
            stop=float(sig_data.get("stop", 0)),
            target=float(sig_data.get("target", 0)),
            confidence=float(sig_data.get("confidence", 0)),
            structure_score=float(sig_data.get("structure_score", 0)),
            order_flow_score=float(sig_data.get("order_flow_score", 0)),
            volume_score=float(sig_data.get("volume_score", 0)),
            risk_reward=float(sig_data.get("risk_reward", 0)),
        )
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid signal data: {exc}")

    prediction = predict(signal, req.features)
    return prediction.model_dump()


@app.get("/models")
async def list_models(
    symbol: str | None = Query(default=None),
) -> dict[str, Any]:
    models = registry.list_all(symbol)
    return {
        "count":  len(models),
        "models": [
            {
                "model_id":      m.model_id,
                "symbol":        m.symbol,
                "timeframe":     m.timeframe,
                "test_accuracy": m.test_accuracy,
                "roc_auc":       m.roc_auc,
                "train_rows":    m.train_rows,
                "test_rows":     m.test_rows,
                "trained_at":    m.trained_at,
                "is_active":     m.is_active,
            }
            for m in models
        ],
    }


@app.get("/models/latest")
async def latest_model() -> dict[str, Any]:
    m = registry.get_latest()
    if not m:
        raise HTTPException(status_code=404, detail="No models trained yet")
    return {
        "model_id":      m.model_id,
        "symbol":        m.symbol,
        "timeframe":     m.timeframe,
        "test_accuracy": m.test_accuracy,
        "roc_auc":       m.roc_auc,
        "train_rows":    m.train_rows,
        "test_rows":     m.test_rows,
        "trained_at":    m.trained_at,
        "is_active":     m.is_active,
    }


@app.get("/performance")
async def model_performance(
    model_id: str | None = Query(default=None),
) -> dict[str, Any]:
    m = (
        next((e for e in registry.list_all() if e.model_id == model_id), None)
        if model_id else registry.get_latest()
    )
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    return {
        "model_id":      m.model_id,
        "test_accuracy": m.test_accuracy,
        "roc_auc":       m.roc_auc,
        "mlflow_run_id": m.mlflow_run_id,
        "trained_at":    m.trained_at,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.ml_service.main:app",
        host="0.0.0.0",
        port=cfg.ml_port,
        reload=cfg.env == "development",
    )
