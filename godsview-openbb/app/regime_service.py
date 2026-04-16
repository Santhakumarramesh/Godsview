"""
GodsView — Regime Detection Service Routes

FastAPI router exposing regime detection, history, and confluence endpoints.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .analysis.regime_detector import (
    Regime,
    RegimeAnalysis,
    detect_regime,
    detect_regime_from_bars,
)
from .analysis.regime_history import RegimeTracker, RegimeTransition, RegimeStats

logger = logging.getLogger("godsview.regime_service")
router = APIRouter(prefix="/api/regime", tags=["regime"])

# ── Singleton tracker ────────────────────────────────────────────────────────
_tracker = RegimeTracker()


# ── Request / Response Models ────────────────────────────────────────────────

class BarInput(BaseModel):
    open: float = Field(..., alias="Open", description="Open price")
    high: float = Field(..., alias="High", description="High price")
    low: float = Field(..., alias="Low", description="Low price")
    close: float = Field(..., alias="Close", description="Close price")
    volume: float = Field(..., alias="Volume", description="Volume")

    class Config:
        populate_by_name = True


class DetectRequest(BaseModel):
    symbol: str = "UNKNOWN"
    timeframe: str = "1H"
    bars: list[dict] = Field(..., min_length=20, description="OHLCV bar dicts")


class RegimeResponse(BaseModel):
    current_regime: str
    confidence: float
    regime_scores: dict[str, float]
    regime_duration_bars: int
    transition_probability: float
    supporting_evidence: list[str]


class TransitionResponse(BaseModel):
    timestamp: float
    symbol: str
    timeframe: str
    from_regime: str
    to_regime: str
    confidence: float
    duration_bars: int


class StatsResponse(BaseModel):
    total_transitions: int
    avg_regime_duration: float
    regime_frequency: dict[str, int]
    current_regime: str
    current_duration: int


class ConfluenceResponse(BaseModel):
    symbol: str
    timeframes: dict[str, str]
    confluence_score: float
    dominant_regime: str


class HealthResponse(BaseModel):
    status: str
    tracked_symbols: int
    total_transitions: int


# ── Helper ───────────────────────────────────────────────────────────────────

def _analysis_to_response(a: RegimeAnalysis) -> RegimeResponse:
    return RegimeResponse(
        current_regime=a.current_regime.value,
        confidence=a.confidence,
        regime_scores=a.regime_scores,
        regime_duration_bars=a.regime_duration_bars,
        transition_probability=a.transition_probability,
        supporting_evidence=a.supporting_evidence,
    )


def _transition_to_response(t: RegimeTransition) -> TransitionResponse:
    return TransitionResponse(
        timestamp=t.timestamp,
        symbol=t.symbol,
        timeframe=t.timeframe,
        from_regime=t.from_regime.value,
        to_regime=t.to_regime.value,
        confidence=t.confidence,
        duration_bars=t.duration_bars,
    )


# ── Routes ───────────────────────────────────────────────────────────────────

@router.post("/detect", response_model=RegimeResponse)
async def detect(req: DetectRequest):
    """Detect current market regime from OHLCV bars."""
    if len(req.bars) < 20:
        raise HTTPException(400, "Need at least 20 bars for regime detection")

    # Get previous state for duration tracking
    prev_regime, prev_bars = _tracker.get_current(req.symbol, req.timeframe)

    analysis = detect_regime_from_bars(
        req.bars,
        prev_regime=prev_regime if prev_bars > 0 else None,
        prev_regime_bars=prev_bars,
    )

    # Update tracker
    _tracker.update(req.symbol, req.timeframe, analysis)

    logger.info(
        "regime_detect symbol=%s tf=%s regime=%s conf=%.2f",
        req.symbol, req.timeframe,
        analysis.current_regime.value, analysis.confidence,
    )
    return _analysis_to_response(analysis)


@router.get("/current/{symbol}", response_model=RegimeResponse)
async def get_current(
    symbol: str,
    timeframe: str = Query("1H", description="Timeframe"),
):
    """Get the last detected regime for a symbol/timeframe."""
    regime, duration = _tracker.get_current(symbol, timeframe)
    return RegimeResponse(
        current_regime=regime.value,
        confidence=0.0,
        regime_scores={},
        regime_duration_bars=duration,
        transition_probability=0.0,
        supporting_evidence=["cached state"],
    )


@router.get("/history/{symbol}", response_model=list[TransitionResponse])
async def get_history(
    symbol: str,
    timeframe: str = Query("1H"),
    limit: int = Query(50, ge=1, le=500),
):
    """Get regime transition history."""
    transitions = _tracker.get_history(symbol, timeframe, limit)
    return [_transition_to_response(t) for t in transitions]


@router.get("/stats/{symbol}", response_model=StatsResponse)
async def get_stats(
    symbol: str,
    timeframe: str = Query("1H"),
):
    """Get aggregate regime statistics."""
    stats = _tracker.get_stats(symbol, timeframe)
    return StatsResponse(
        total_transitions=stats.total_transitions,
        avg_regime_duration=stats.avg_regime_duration,
        regime_frequency=stats.regime_frequency,
        current_regime=stats.current_regime.value,
        current_duration=stats.current_duration,
    )


@router.get("/confluence/{symbol}", response_model=ConfluenceResponse)
async def get_confluence(symbol: str):
    """Multi-timeframe regime confluence analysis."""
    tfs = _tracker.get_confluence(symbol)
    score = _tracker.get_confluence_score(symbol)

    # Find dominant regime
    if tfs:
        from collections import Counter
        counts = Counter(tfs.values())
        dominant = counts.most_common(1)[0][0]
    else:
        dominant = Regime.RANGE.value

    return ConfluenceResponse(
        symbol=symbol,
        timeframes=tfs,
        confluence_score=round(score, 4),
        dominant_regime=dominant,
    )


@router.get("/health", response_model=HealthResponse)
async def health():
    """Regime service health check."""
    tracked = len(_tracker._current)
    total_trans = sum(
        len(tl)
        for sym_map in _tracker._history.values()
        for tl in sym_map.values()
    )
    return HealthResponse(
        status="ok",
        tracked_symbols=tracked,
        total_transitions=total_trans,
    )
