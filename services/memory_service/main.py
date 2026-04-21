"""
GodsView v2 — Memory Service

FastAPI service for storing and retrieving trade memory via LanceDB.
"""
from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse, RecallEntry
from services.memory_service.recall_store import (
    make_store, features_to_embedding, LanceRecallStore, InMemoryRecallStore,
)

log = get_logger(__name__)
_STARTED_AT = 0.0
_store: LanceRecallStore | InMemoryRecallStore | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT, _store
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    _store = await make_store()
    log.info("memory_service_ready", port=cfg.memory_port)
    yield


app = FastAPI(title="GodsView v2 — Memory Service", version="2.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


class StoreRequest(BaseModel):
    symbol:     str
    setup_type: str
    timeframe:  str = "15min"
    outcome:    str = "win"     # win | loss | breakeven
    pnl_pct:    float = 0.0
    features:   dict[str, float] = {}
    tags:       list[str] = []
    notes:      str = ""


class SearchRequest(BaseModel):
    features:   dict[str, float]
    limit:      int = 10
    symbol:     str | None = None


@app.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    count = await _store.count() if _store else 0
    return HealthResponse(
        service="memory",
        status="ok",
        uptime_s=round(time.time() - _STARTED_AT, 1),
        checks={
            "store_type": type(_store).__name__ if _store else "none",
            "entry_count": str(count),
        },
    )


@app.post("/recall")
async def store_recall(req: StoreRequest) -> dict[str, Any]:
    """Store a trade outcome in recall memory."""
    if not _store:
        raise HTTPException(status_code=503, detail="Store not ready")

    embedding = features_to_embedding(req.features)
    entry = RecallEntry(
        id=str(uuid.uuid4()),
        symbol=req.symbol,
        setup_type=req.setup_type,
        timeframe=req.timeframe,
        timestamp=datetime.now(timezone.utc),
        outcome=req.outcome,
        pnl_pct=req.pnl_pct,
        features=req.features,
        embedding=embedding,
        tags=req.tags,
        notes=req.notes,
    )
    await _store.add(entry)
    log.info("recall_stored", id=entry.id, symbol=req.symbol, outcome=req.outcome)
    return {"id": entry.id, "status": "stored"}


@app.post("/recall/search")
async def search_recall(req: SearchRequest) -> dict[str, Any]:
    """Vector similarity search for similar past setups."""
    if not _store:
        raise HTTPException(status_code=503, detail="Store not ready")

    query_vec = features_to_embedding(req.features)
    results = await _store.search(query_vec, limit=req.limit, symbol=req.symbol)
    return {
        "count": len(results),
        "results": results,
    }


@app.get("/recall/signals")
async def list_signals(
    symbol: str = Query(...),
    limit:  int = Query(default=50, ge=1, le=500),
) -> dict[str, Any]:
    if not _store:
        raise HTTPException(status_code=503, detail="Store not ready")

    items = await _store.list_recent(symbol=symbol, limit=limit)
    wins   = sum(1 for r in items if r.get("outcome") == "win")
    losses = sum(1 for r in items if r.get("outcome") == "loss")
    total  = len(items)

    return {
        "symbol":   symbol,
        "count":    total,
        "win_rate": round(wins / total, 3) if total else 0.0,
        "results":  items,
        "stats": {
            "wins":   wins,
            "losses": losses,
            "breakeven": total - wins - losses,
        },
    }


@app.get("/stats")
async def memory_stats() -> dict[str, Any]:
    if not _store:
        return {"status": "unavailable"}
    count = await _store.count()
    return {
        "total_entries": count,
        "store_type":    type(_store).__name__,
        "lancedb_uri":   cfg.lancedb_uri,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.memory_service.main:app",
        host="0.0.0.0",
        port=cfg.memory_port,
        reload=cfg.env == "development",
    )
