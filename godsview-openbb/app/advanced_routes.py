"""
GodsView — Advanced Systems API Routes

FastAPI router for:
  - Strategy DNA endpoints
  - Session Intelligence endpoints
  - Confidence Calibration endpoints
  - Data Truth / Latency monitor
"""
from __future__ import annotations

import time
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .analysis.strategy_dna import StrategyDNAEngine, classify_volatility, classify_session
from .analysis.session_intelligence import (
    SessionIntelligenceEngine,
    SessionBar,
    Session,
    classify_session as classify_session_hour,
)
from .analysis.confidence_calibrator import ConfidenceCalibrator

logger = logging.getLogger("godsview.advanced_routes")
router = APIRouter(prefix="/api/advanced", tags=["advanced"])

# ── Singletons ───────────────────────────────────────────────────────────────
_dna_engine = StrategyDNAEngine()
_session_engine = SessionIntelligenceEngine()
_calibrator = ConfidenceCalibrator()


# ── Request / Response Models ────────────────────────────────────────────────

# Strategy DNA
class RecordTradeRequest(BaseModel):
    strategy_id: str
    strategy_name: str = ""
    pnl: float
    rr: float = 0.0
    regime: str = "unknown"
    session: str = "unknown"
    day_of_week: str = "unknown"
    volatility: str = "medium"
    instrument: str = "unknown"


class FitnessRequest(BaseModel):
    strategy_id: str
    regime: str = "unknown"
    session: str = "unknown"
    day_of_week: str = "unknown"
    volatility: str = "medium"


# Session Intelligence
class SessionBarInput(BaseModel):
    timestamp: float
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0


class SessionUpdateRequest(BaseModel):
    symbol: str
    bar: SessionBarInput


# Confidence Calibration
class CalibrateRequest(BaseModel):
    raw_confidence: float = Field(..., ge=0.0, le=1.0)
    strategy: str = ""
    regime: str = ""


class RecordOutcomeRequest(BaseModel):
    raw_confidence: float = Field(..., ge=0.0, le=1.0)
    outcome: bool
    strategy: str = ""
    regime: str = ""
    context: str = ""


# Data Truth
class DataSourceHealth(BaseModel):
    source: str
    status: str  # "healthy", "degraded", "offline"
    latency_ms: float
    last_update: float
    error_rate: float
    should_trade: bool


# ── Strategy DNA Routes ──────────────────────────────────────────────────────

@router.post("/dna/record-trade")
async def dna_record_trade(req: RecordTradeRequest):
    """Record a completed trade for strategy DNA profiling."""
    _dna_engine.record_trade(
        strategy_id=req.strategy_id,
        pnl=req.pnl,
        rr=req.rr,
        regime=req.regime,
        session=req.session,
        day_of_week=req.day_of_week,
        volatility=req.volatility,
        instrument=req.instrument,
        strategy_name=req.strategy_name,
    )
    return {"status": "recorded", "strategy_id": req.strategy_id}


@router.post("/dna/fitness")
async def dna_fitness(req: FitnessRequest):
    """Get fitness score for a strategy under current conditions."""
    fitness = _dna_engine.get_fitness(
        strategy_id=req.strategy_id,
        regime=req.regime,
        session=req.session,
        day_of_week=req.day_of_week,
        volatility=req.volatility,
    )
    return fitness


@router.get("/dna/rank")
async def dna_rank(
    regime: str = "unknown",
    session: str = "unknown",
    day_of_week: str = "unknown",
    volatility: str = "medium",
):
    """Rank all strategies by fitness for current conditions."""
    return _dna_engine.rank_strategies(regime, session, day_of_week, volatility)


@router.get("/dna/profiles")
async def dna_profiles():
    """Get all strategy DNA profiles."""
    return _dna_engine.get_all_profiles()


@router.get("/dna/profile/{strategy_id}")
async def dna_profile(strategy_id: str):
    """Get a specific strategy's DNA profile."""
    profiles = _dna_engine.get_all_profiles()
    if strategy_id not in profiles:
        raise HTTPException(404, f"Strategy {strategy_id} not found")
    return profiles[strategy_id]


# ── Session Intelligence Routes ──────────────────────────────────────────────

@router.post("/session/update")
async def session_update(req: SessionUpdateRequest):
    """Process a new bar and get session analysis."""
    bar = SessionBar(
        timestamp=req.bar.timestamp,
        open=req.bar.open,
        high=req.bar.high,
        low=req.bar.low,
        close=req.bar.close,
        volume=req.bar.volume,
    )
    analysis = _session_engine.update(req.symbol, bar)
    return {
        "current_session": analysis.current_session.value,
        "symbol": analysis.symbol,
        "session_open_price": analysis.session_open_price,
        "session_high": analysis.session_high,
        "session_low": analysis.session_low,
        "session_range": analysis.session_range,
        "session_range_pct": analysis.session_range_pct,
        "bars_in_session": analysis.bars_in_session,
        "expected_range": analysis.expected_range,
        "range_exhaustion_pct": analysis.range_exhaustion_pct,
        "session_bias": analysis.session_bias,
        "momentum_score": analysis.momentum_score,
        "reversal_zone": analysis.reversal_zone,
        "reversal_reason": analysis.reversal_reason,
    }


@router.get("/session/profiles/{symbol}")
async def session_profiles(symbol: str):
    """Get all session profiles for a symbol."""
    profiles = _session_engine.get_all_profiles(symbol)
    return {
        k: {
            "session": p.session.value,
            "avg_range": p.avg_range,
            "avg_range_pct": p.avg_range_pct,
            "avg_volume": p.avg_volume,
            "directional_bias": p.directional_bias,
            "reversal_rate": p.reversal_rate,
            "continuation_rate": p.continuation_rate,
            "sample_count": p.sample_count,
        }
        for k, p in profiles.items()
    }


@router.get("/session/comparison/{symbol}")
async def session_comparison(symbol: str):
    """Compare all sessions for a symbol ranked by opportunity."""
    return _session_engine.get_session_comparison(symbol)


@router.get("/session/current")
async def session_current():
    """Get the current trading session based on UTC time."""
    import datetime
    now = datetime.datetime.utcnow()
    session = classify_session_hour(now.hour)
    return {
        "session": session.value,
        "hour_utc": now.hour,
        "day_of_week": now.strftime("%A").lower(),
    }


# ── Confidence Calibration Routes ────────────────────────────────────────────

@router.post("/calibration/calibrate")
async def calibrate(req: CalibrateRequest):
    """Calibrate a raw confidence score based on historical accuracy."""
    calibrated = _calibrator.calibrate(
        raw_confidence=req.raw_confidence,
        strategy=req.strategy,
        regime=req.regime,
    )
    return {
        "raw_confidence": req.raw_confidence,
        "calibrated_confidence": calibrated,
        "adjustment": round(calibrated - req.raw_confidence, 4),
    }


@router.post("/calibration/record")
async def calibration_record(req: RecordOutcomeRequest):
    """Record a prediction outcome for calibration tracking."""
    _calibrator.record_outcome(
        raw_confidence=req.raw_confidence,
        outcome=req.outcome,
        strategy=req.strategy,
        regime=req.regime,
        context=req.context,
    )
    return {"status": "recorded"}


@router.get("/calibration/report")
async def calibration_report(key: str = "global"):
    """Get calibration report for a given key."""
    report = _calibrator.get_report(key)
    return {
        "total_predictions": report.total_predictions,
        "total_correct": report.total_correct,
        "overall_accuracy": report.overall_accuracy,
        "overall_brier": report.overall_brier,
        "mean_calibration_error": report.mean_calibration_error,
        "max_calibration_error": report.max_calibration_error,
        "calibration_quality": report.calibration_quality,
        "buckets": report.buckets,
    }


@router.get("/calibration/curve")
async def calibration_curve(key: str = "global"):
    """Get calibration curve data for plotting."""
    curve = _calibrator.get_calibration_curve(key)
    return {
        "key": key,
        "points": [{"predicted": p, "actual": a} for p, a in curve],
    }


@router.get("/calibration/keys")
async def calibration_keys():
    """List all calibration keys."""
    return _calibrator.get_all_keys()


# ── Data Truth / Latency Monitor ─────────────────────────────────────────────

_data_source_status: dict[str, dict] = {}
_MAX_DATA_SOURCES = 200  # Prevent unbounded memory growth


@router.post("/data-truth/report")
async def report_data_source(source: str, latency_ms: float, success: bool):
    """Report a data source fetch result for health tracking."""
    # Input validation
    if not source or len(source) > 128:
        return {"status": "error", "detail": "source must be 1-128 chars"}
    if not (-1.0 <= latency_ms <= 300_000):
        return {"status": "error", "detail": "latency_ms must be 0-300000"}
    # Prevent unbounded dict growth
    if source not in _data_source_status and len(_data_source_status) >= _MAX_DATA_SOURCES:
        return {"status": "error", "detail": f"max {_MAX_DATA_SOURCES} data sources tracked"}
    entry = _data_source_status.setdefault(source, {
        "total": 0, "errors": 0, "latency_sum": 0.0, "last_update": 0.0,
    })
    entry["total"] += 1
    entry["latency_sum"] += latency_ms
    entry["last_update"] = time.time()
    if not success:
        entry["errors"] += 1
    return {"status": "recorded"}


@router.get("/data-truth/health")
async def data_truth_health():
    """Get health status of all data sources."""
    results: list[dict] = []
    now = time.time()
    for source, entry in _data_source_status.items():
        total = entry["total"]
        avg_latency = entry["latency_sum"] / total if total > 0 else 0.0
        error_rate = entry["errors"] / total if total > 0 else 0.0
        stale = (now - entry["last_update"]) > 60  # stale if > 60s

        if error_rate > 0.5 or stale:
            status = "offline"
        elif error_rate > 0.1 or avg_latency > 5000:
            status = "degraded"
        else:
            status = "healthy"

        should_trade = status != "offline"

        results.append({
            "source": source,
            "status": status,
            "latency_ms": round(avg_latency, 2),
            "last_update": entry["last_update"],
            "error_rate": round(error_rate, 4),
            "should_trade": should_trade,
            "total_checks": total,
        })
    return results


@router.get("/health")
async def advanced_health():
    """Health check for all advanced systems."""
    return {
        "status": "ok",
        "systems": {
            "strategy_dna": {
                "strategies_tracked": len(_dna_engine._profiles),
            },
            "session_intelligence": {
                "symbols_tracked": len(_session_engine._current_session),
            },
            "confidence_calibration": {
                "keys_tracked": len(_calibrator._buckets),
                "total_predictions": sum(
                    sum(b.predictions for b in bkts)
                    for bkts in _calibrator._buckets.values()
                ),
            },
            "data_truth": {
                "sources_monitored": len(_data_source_status),
            },
        },
    }
