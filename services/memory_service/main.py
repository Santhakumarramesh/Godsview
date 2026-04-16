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

from fastapi import FastAPI, HTTPException, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from services.shared.config import cfg
from services.shared.logging import configure_structlog, get_logger
from services.shared.types import HealthResponse, RecallEntry
from services.memory_service.recall_store import (
    make_store, features_to_embedding, LanceRecallStore, InMemoryRecallStore,
)
from services.memory_service.screenshot_store import make_screenshot_store, ScreenshotStore
from services.memory_service.missed_trade_detector import make_missed_trade_detector, MissedTradeDetector
from services.memory_service.feedback_loop import make_feedback_loop, FeedbackLoop

log = get_logger(__name__)
_STARTED_AT = 0.0
_store: LanceRecallStore | InMemoryRecallStore | None = None
_screenshot_store: ScreenshotStore | None = None
_missed_detector: MissedTradeDetector | None = None
_feedback_loop: FeedbackLoop | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    global _STARTED_AT, _store, _screenshot_store, _missed_detector, _feedback_loop
    configure_structlog(cfg.log_level)
    _STARTED_AT = time.time()
    _store = await make_store()
    _screenshot_store = await make_screenshot_store()
    _missed_detector = await make_missed_trade_detector()
    _feedback_loop = await make_feedback_loop(retrain_threshold=50)
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
    prefer_wins: bool = True


class ScreenshotRequest(BaseModel):
    symbol:     str
    setup_type: str
    timeframe:  str = "15min"
    outcome:    str = "pending"
    pnl_pct:    float = 0.0
    tags:       list[str] = []
    bars:       list[dict] = []  # OHLCV bars
    signal:     dict = {}


class TradeOutcomeRequest(BaseModel):
    signal_id:       str
    symbol:          str
    entry_time:      str  # ISO format
    exit_time:       str  # ISO format
    setup_type:      str
    direction:       str
    entry_price:     float
    exit_price:      float
    stop_loss:       float
    take_profit:     float
    outcome:         str
    pnl_pct:         float
    features:        dict[str, float] | None = None
    signal_confidence: float = 0.0
    predicted_win_prob: float = 0.0
    regime_at_entry: str = "unknown"
    regime_at_exit:  str = "unknown"
    mae:             float = 0.0
    mfe:             float = 0.0
    notes:           str = ""


class MissedSignalRequest(BaseModel):
    symbol:          str
    setup_type:      str = ""
    timeframe:       str = "15min"
    rejection_reason: str
    signal_confidence: float = 0.0
    entry_price:     float = 0.0
    stop_loss:       float = 0.0
    take_profit:     float = 0.0
    tags:            list[str] = []


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


# ── Screenshot Endpoints ──────────────────────────────────────────────────────

@app.post("/memory/screenshot")
async def save_screenshot(req: ScreenshotRequest) -> dict[str, Any]:
    """Save a chart screenshot with trade context."""
    if not _screenshot_store:
        raise HTTPException(status_code=503, detail="Screenshot store not ready")

    # Convert bar dicts to Bar objects
    from services.shared.types import Bar
    bars = []
    for bar_data in req.bars:
        bars.append(Bar(
            symbol=req.symbol,
            timestamp=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
            open=bar_data.get("o", 0.0),
            high=bar_data.get("h", 0.0),
            low=bar_data.get("l", 0.0),
            close=bar_data.get("c", 0.0),
            volume=bar_data.get("v", 0.0),
            timeframe=req.timeframe,
        ))

    # Convert signal dict to Signal object
    from services.shared.types import Signal, Direction, SignalType
    signal = Signal(
        id=str(uuid.uuid4()),
        symbol=req.symbol,
        timeframe=req.timeframe,
        timestamp=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        direction=Direction(req.signal.get("direction", "long")),
        signal_type=SignalType(req.signal.get("signal_type", "absorption_reversal")),
        entry=float(req.signal.get("entry", 0)),
        stop=float(req.signal.get("stop", 0)),
        target=float(req.signal.get("target", 0)),
        confidence=float(req.signal.get("confidence", 0.5)),
        structure_score=float(req.signal.get("structure_score", 0)),
        order_flow_score=float(req.signal.get("order_flow_score", 0)),
        volume_score=float(req.signal.get("volume_score", 0)),
        risk_reward=float(req.signal.get("risk_reward", 1.0)),
    )

    result = await _screenshot_store.save_screenshot(
        bars=bars,
        signal=signal,
        outcome=req.outcome,
        pnl_pct=req.pnl_pct,
        tags=req.tags,
    )
    log.info("screenshot_saved_via_api", symbol=req.symbol)
    return result


@app.get("/memory/screenshots/{symbol}")
async def list_screenshots(
    symbol: str,
    setup_type: str | None = Query(None),
    outcome: str | None = Query(None),
    days_back: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=500),
) -> dict[str, Any]:
    """List screenshots for a symbol with optional filters."""
    if not _screenshot_store:
        raise HTTPException(status_code=503, detail="Screenshot store not ready")

    items = await _screenshot_store.list_screenshots(
        symbol=symbol,
        setup_type=setup_type,
        outcome=outcome,
        days_back=days_back,
        limit=limit,
    )
    return {
        "symbol": symbol,
        "count": len(items),
        "screenshots": items,
    }


@app.get("/memory/screenshot/{screenshot_id}")
async def get_screenshot(screenshot_id: str) -> dict[str, Any]:
    """Retrieve a specific screenshot."""
    if not _screenshot_store:
        raise HTTPException(status_code=503, detail="Screenshot store not ready")

    item = await _screenshot_store.get_screenshot(screenshot_id)
    if not item:
        raise HTTPException(status_code=404, detail="Screenshot not found")

    return item


# ── Missed Trade Endpoints ────────────────────────────────────────────────────

@app.post("/memory/missed")
async def record_missed_signal(req: MissedSignalRequest) -> dict[str, Any]:
    """Record a signal that was detected but rejected."""
    if not _missed_detector:
        raise HTTPException(status_code=503, detail="Missed trade detector not ready")

    from services.shared.types import Signal, Direction, SignalType
    signal = Signal(
        id=str(uuid.uuid4()),
        symbol=req.symbol,
        timeframe=req.timeframe,
        timestamp=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
        direction=Direction.LONG,
        signal_type=SignalType(req.setup_type or "absorption_reversal"),
        entry=req.entry_price,
        stop=req.stop_loss,
        target=req.take_profit,
        confidence=req.signal_confidence,
        structure_score=0.0,
        order_flow_score=0.0,
        volume_score=0.0,
        risk_reward=0.0,
    )

    result = await _missed_detector.record_missed_signal(
        signal=signal,
        rejection_reason=req.rejection_reason,
        rejection_score=req.signal_confidence,
        tags=req.tags,
    )
    return result


@app.get("/memory/missed")
async def list_missed_opportunities(
    symbol: str | None = Query(None),
    days_back: int = Query(30, ge=1, le=365),
    limit: int = Query(100, ge=1, le=500),
) -> dict[str, Any]:
    """List missed trading opportunities."""
    if not _missed_detector:
        raise HTTPException(status_code=503, detail="Missed trade detector not ready")

    items = await _missed_detector.get_missed_opportunities(
        symbol=symbol,
        days_back=days_back,
        limit=limit,
    )
    return {
        "symbol": symbol or "all",
        "count": len(items),
        "missed": items,
    }


@app.get("/memory/missed/cost")
async def missed_opportunity_cost(
    symbol: str | None = Query(None),
    days_back: int = Query(30, ge=1, le=365),
) -> dict[str, Any]:
    """Calculate opportunity cost analysis."""
    if not _missed_detector:
        raise HTTPException(status_code=503, detail="Missed trade detector not ready")

    return await _missed_detector.compute_opportunity_cost(
        symbol=symbol,
        days_back=days_back,
    )


@app.get("/memory/missed/patterns")
async def missed_patterns(
    days_back: int = Query(60, ge=1, le=365),
) -> dict[str, Any]:
    """Identify systematic miss patterns."""
    if not _missed_detector:
        raise HTTPException(status_code=503, detail="Missed trade detector not ready")

    return await _missed_detector.identify_systematic_misses(days_back=days_back)


# ── Trade Outcome & Feedback Loop Endpoints ──────────────────────────────────

@app.post("/memory/outcome")
async def record_trade_outcome(req: TradeOutcomeRequest) -> dict[str, Any]:
    """Record a completed trade outcome for feedback loop."""
    if not _feedback_loop:
        raise HTTPException(status_code=503, detail="Feedback loop not ready")

    from datetime import datetime, timezone
    entry_time = datetime.fromisoformat(req.entry_time.replace("Z", "+00:00"))
    exit_time = datetime.fromisoformat(req.exit_time.replace("Z", "+00:00"))

    result = await _feedback_loop.record_trade_outcome(
        signal_id=req.signal_id,
        symbol=req.symbol,
        entry_time=entry_time,
        exit_time=exit_time,
        setup_type=req.setup_type,
        direction=req.direction,
        entry_price=req.entry_price,
        exit_price=req.exit_price,
        stop_loss=req.stop_loss,
        take_profit=req.take_profit,
        outcome=req.outcome,
        pnl_pct=req.pnl_pct,
        features=req.features,
        signal_confidence=req.signal_confidence,
        predicted_win_prob=req.predicted_win_prob,
        regime_at_entry=req.regime_at_entry,
        regime_at_exit=req.regime_at_exit,
        mae=req.mae,
        mfe=req.mfe,
        notes=req.notes,
    )
    return result


@app.get("/memory/feedback/stats")
async def feedback_stats(symbol: str | None = Query(None)) -> dict[str, Any]:
    """Get retraining buffer status and feedback loop stats."""
    if not _feedback_loop:
        raise HTTPException(status_code=503, detail="Feedback loop not ready")

    return await _feedback_loop.get_feedback_stats(symbol=symbol)


@app.post("/memory/retrain")
async def trigger_retraining(
    symbol: str = Query(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
) -> dict[str, Any]:
    """Trigger model retraining based on accumulated trade outcomes."""
    if not _feedback_loop:
        raise HTTPException(status_code=503, detail="Feedback loop not ready")

    # Get current buffer stats
    stats = await _feedback_loop.get_feedback_stats(symbol=symbol)

    if not stats.get("ready_for_retrain"):
        return {
            "status": "not_ready",
            "message": f"Need {stats.get('retrain_threshold', 50) - stats.get('trade_count', 0)} more trades",
            "stats": stats,
        }

    # Calculate metrics
    feature_importance = await _feedback_loop.calculate_feature_importance(symbol)
    calibration = await _feedback_loop.calculate_confidence_calibration(symbol)

    # Record retraining event
    retrain_result = await _feedback_loop.record_retraining(
        symbol=symbol,
        trades_in_buffer=stats.get("trade_count", 0),
        pre_metrics={
            "win_rate": stats.get("win_rate", 0),
            "trade_count": stats.get("trade_count", 0),
        },
        post_metrics={
            "feature_importance_updated": True,
            "calibration_updated": True,
        },
        feature_importance=feature_importance.get("importance", {}),
        confidence_calibration=calibration.get("calibration", {}),
        status="triggered",
    )

    log.info("retraining_triggered", symbol=symbol, trades=stats.get("trade_count"))

    return {
        "status": "retrain_triggered",
        "symbol": symbol,
        "retrain_id": retrain_result.get("id"),
        "trades_in_buffer": stats.get("trade_count", 0),
    }


@app.get("/memory/retraining/history")
async def retraining_history(
    symbol: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    """Get retraining history."""
    if not _feedback_loop:
        raise HTTPException(status_code=503, detail="Feedback loop not ready")

    history = await _feedback_loop.get_retraining_history(symbol=symbol, limit=limit)
    return {
        "symbol": symbol or "all",
        "count": len(history),
        "history": history,
    }


@app.get("/memory/setup/stats")
async def setup_statistics(
    setup_type: str = Query(...),
    symbol: str | None = Query(None),
) -> dict[str, Any]:
    """Get historical statistics for a setup type."""
    if not _store:
        raise HTTPException(status_code=503, detail="Store not ready")

    stats = await _store.get_setup_statistics(setup_type, symbol=symbol)
    if not stats:
        return {
            "setup_type": setup_type,
            "symbol": symbol or "all",
            "status": "no_data",
        }

    return stats


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "services.memory_service.main:app",
        host="0.0.0.0",
        port=cfg.memory_port,
        reload=cfg.env == "development",
    )
