"""
API Gateway — /api/ml routes
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.http_client import service_client

router = APIRouter()


class TrainRequest(BaseModel):
    symbol:         str | None = None   # None = all symbols
    retrain_days:   int = 90
    min_samples:    int = 200
    model_type:     str = "xgboost"


@router.post("/train")
async def trigger_training(req: TrainRequest) -> dict[str, Any]:
    async with service_client(cfg.ml_url) as client:
        resp = await client.post("/train", json=req.model_dump())
        resp.raise_for_status()
        return resp.json()


@router.get("/models")
async def list_models(
    symbol: str | None = Query(default=None),
) -> dict[str, Any]:
    params = {"symbol": symbol} if symbol else {}
    async with service_client(cfg.ml_url) as client:
        resp = await client.get("/models", params=params)
        resp.raise_for_status()
        return resp.json()


@router.get("/models/latest")
async def latest_model() -> dict[str, Any]:
    async with service_client(cfg.ml_url) as client:
        resp = await client.get("/models/latest")
        resp.raise_for_status()
        return resp.json()


@router.get("/performance")
async def model_performance(
    model_id: str | None = Query(default=None),
) -> dict[str, Any]:
    params = {"model_id": model_id} if model_id else {}
    async with service_client(cfg.ml_url) as client:
        resp = await client.get("/performance", params=params)
        resp.raise_for_status()
        return resp.json()
