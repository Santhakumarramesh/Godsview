"""
regime_service.py — Regime Detection API Endpoints

FastAPI endpoints for regime analysis:
  - GET /regime/:symbol — current regime analysis
  - GET /regime/:symbol/history — regime change history
  - GET /regime/:symbol/confluence — multi-timeframe regime view
  - GET /regime/market — regime for multiple symbols at once
"""

from __future__ import annotations

import sys
import os
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from datetime import datetime

# Add godsview-openbb to path for imports
GODSVIEW_ROOT = os.getenv("GODSVIEW_ROOT", "/app")
sys.path.insert(0, GODSVIEW_ROOT)

from godsview_openbb.app.analysis.regime_detector import detect_regime, RegimeType
from godsview_openbb.app.analysis.regime_history import RegimeTracker, RegimeHistoryState

router = APIRouter(prefix="/regime", tags=["regime"])
tracker = RegimeTracker()


# ─── Pydantic Models ────────────────────────────────────────────────────────

class RegimeResponse(BaseModel):
    symbol: str
    timeframe: str
    current_regime: str
    confidence: float
    regime_scores: dict[str, float]
    regime_duration_bars: int
    transition_probability: float
    supporting_evidence: list[str]
    timestamp: str


class RegimeHistoryItem(BaseModel):
    timestamp: str
    from_regime: str
    to_regime: str
    duration_bars: int
    confidence_from: float
    confidence_to: float


class RegimeHistoryResponse(BaseModel):
    symbol: str
    timeframe: str
    current_regime: str
    current_confidence: float
    transitions: list[RegimeHistoryItem]
    regime_durations: dict[str, list[int]]


class TimeframeRegimeView(BaseModel):
    timeframe: str
    regime: str
    confidence: float


class RegimeConfluenceResponse(BaseModel):
    symbol: str
    confluence_score: float
    aligned: bool
    dominant_regime: str
    timeframes: list[TimeframeRegimeView]


class BatchRegimeResponse(BaseModel):
    symbol: str
    timeframe: str
    current_regime: str
    confidence: float


class MarketRegimeResponse(BaseModel):
    timestamp: str
    regimes: list[BatchRegimeResponse]
    count: int


# ─── Helper: Fetch bars from Market Data Service ──────────────────────────

async def fetch_bars_for_symbol(
    symbol: str,
    timeframe: str,
    limit: int = 100,
) -> Any:
    """Fetch OHLCV bars from market data service."""
    import httpx

    market_data_url = os.getenv("MARKET_DATA_URL", "http://market-data-service:8001")
    timeout = httpx.Timeout(30.0)

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.get(
                f"{market_data_url}/bars/{symbol}",
                params={"timeframe": timeframe, "limit": limit},
            )
            response.raise_for_status()
            return response.json()
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Market data service unavailable: {str(exc)}"
        )


def bars_to_dataframe(raw_bars: list[dict]) -> Any:
    """Convert raw bar data to pandas DataFrame for analysis."""
    import pandas as pd

    if not raw_bars:
        raise ValueError("No bars provided")

    data = {
        "Timestamp": [b.get("t") or b.get("timestamp") for b in raw_bars],
        "Open": [b.get("o") or b.get("open") for b in raw_bars],
        "High": [b.get("h") or b.get("high") for b in raw_bars],
        "Low": [b.get("l") or b.get("low") for b in raw_bars],
        "Close": [b.get("c") or b.get("close") for b in raw_bars],
        "Volume": [b.get("v") or b.get("volume") for b in raw_bars],
    }

    df = pd.DataFrame(data)
    df["Timestamp"] = pd.to_datetime(df["Timestamp"])
    df.set_index("Timestamp", inplace=True)
    return df


# ─── Endpoints ──────────────────────────────────────────────────────────────

@router.get("/{symbol}", response_model=RegimeResponse)
async def get_regime(
    symbol: str,
    timeframe: str = Query(default="1h"),
    limit: int = Query(default=100, ge=50, le=500),
) -> dict[str, Any]:
    """Get current regime analysis for a symbol."""
    try:
        # Fetch bars
        data = await fetch_bars_for_symbol(symbol, timeframe, limit)
        raw_bars = data.get("bars", [])

        if not raw_bars:
            raise HTTPException(status_code=404, detail=f"No bars for {symbol}/{timeframe}")

        # Convert to DataFrame
        df = bars_to_dataframe(raw_bars)

        # Detect regime
        analysis = detect_regime(df)

        # Update tracker
        timestamp = datetime.now()
        tracker.update(symbol, timeframe, analysis, len(df) - 1, timestamp)

        return RegimeResponse(
            symbol=symbol,
            timeframe=timeframe,
            current_regime=analysis.current_regime,
            confidence=analysis.confidence,
            regime_scores=analysis.regime_scores,
            regime_duration_bars=analysis.regime_duration_bars,
            transition_probability=analysis.transition_probability,
            supporting_evidence=analysis.supporting_evidence,
            timestamp=timestamp.isoformat(),
        ).dict()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}/history", response_model=RegimeHistoryResponse)
async def get_regime_history(
    symbol: str,
    timeframe: str = Query(default="1h"),
    limit: int = Query(default=100, ge=50, le=500),
) -> dict[str, Any]:
    """Get regime history and transitions."""
    try:
        # Fetch bars
        data = await fetch_bars_for_symbol(symbol, timeframe, limit)
        raw_bars = data.get("bars", [])

        if not raw_bars:
            raise HTTPException(status_code=404, detail=f"No bars for {symbol}/{timeframe}")

        # Convert to DataFrame
        df = bars_to_dataframe(raw_bars)

        # Initialize tracker if needed
        tracker.initialize(symbol, timeframe)

        # Run detection over the sequence
        from godsview_openbb.app.analysis.regime_history import analyze_regime_sequence
        analyze_regime_sequence(df, timeframe, tracker, symbol)

        # Get state
        state = tracker.get_state(symbol, timeframe)
        if not state:
            raise HTTPException(status_code=500, detail="Failed to analyze regime history")

        return RegimeHistoryResponse(
            symbol=symbol,
            timeframe=timeframe,
            current_regime=state.current_regime,
            current_confidence=state.current_confidence,
            transitions=[
                RegimeHistoryItem(
                    timestamp=t.timestamp.isoformat(),
                    from_regime=t.from_regime,
                    to_regime=t.to_regime,
                    duration_bars=t.duration_bars,
                    confidence_from=t.confidence_from,
                    confidence_to=t.confidence_to,
                )
                for t in state.transitions[-20:]
            ],
            regime_durations={
                k: list(v) for k, v in state.regime_durations.items()
            },
        ).dict()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{symbol}/confluence", response_model=RegimeConfluenceResponse)
async def get_regime_confluence(
    symbol: str,
    timeframes: str = Query(default="1m,5m,1h"),
) -> dict[str, Any]:
    """Get multi-timeframe regime confluence."""
    try:
        tf_list = [tf.strip() for tf in timeframes.split(",")]

        # Fetch and analyze each timeframe
        for tf in tf_list:
            data = await fetch_bars_for_symbol(symbol, tf, limit=100)
            raw_bars = data.get("bars", [])

            if raw_bars:
                df = bars_to_dataframe(raw_bars)
                analysis = detect_regime(df)
                timestamp = datetime.now()
                tracker.update(symbol, tf, analysis, len(df) - 1, timestamp)

        # Get confluence
        confluence = tracker.get_confluence(symbol, tf_list)

        return RegimeConfluenceResponse(
            symbol=symbol,
            confluence_score=confluence["confluence_score"],
            aligned=confluence["aligned"],
            dominant_regime=confluence.get("dominant_regime", "unknown"),
            timeframes=[
                TimeframeRegimeView(
                    timeframe=tf["timeframe"],
                    regime=tf["regime"],
                    confidence=tf["confidence"],
                )
                for tf in confluence["timeframes"]
            ],
        ).dict()

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/market", response_model=MarketRegimeResponse)
async def get_market_regimes(
    symbols: list[str] = Query(...),
    timeframe: str = Query(default="1h"),
    limit: int = Query(default=100, ge=50, le=500),
) -> dict[str, Any]:
    """Get regime for multiple symbols at once."""
    import asyncio

    async def _fetch_one(sym: str) -> dict[str, Any]:
        try:
            data = await fetch_bars_for_symbol(sym, timeframe, limit)
            raw_bars = data.get("bars", [])

            if not raw_bars:
                return {
                    "symbol": sym,
                    "timeframe": timeframe,
                    "current_regime": "unknown",
                    "confidence": 0.0,
                }

            df = bars_to_dataframe(raw_bars)
            analysis = detect_regime(df)
            tracker.update(sym, timeframe, analysis, len(df) - 1, datetime.now())

            return {
                "symbol": sym,
                "timeframe": timeframe,
                "current_regime": analysis.current_regime,
                "confidence": analysis.confidence,
            }
        except Exception:
            return {
                "symbol": sym,
                "timeframe": timeframe,
                "current_regime": "error",
                "confidence": 0.0,
            }

    results = await asyncio.gather(*[_fetch_one(sym) for sym in symbols])

    return MarketRegimeResponse(
        timestamp=datetime.now().isoformat(),
        regimes=results,
        count=len(results),
    ).dict()


@router.get("/", include_in_schema=False)
async def regime_root():
    """Root endpoint - returns available regime endpoints."""
    return {
        "message": "Regime Detection Service",
        "endpoints": {
            "GET /regime/{symbol}": "Current regime analysis",
            "GET /regime/{symbol}/history": "Regime change history",
            "GET /regime/{symbol}/confluence": "Multi-timeframe confluence",
            "POST /regime/market": "Regime for multiple symbols",
        },
    }
