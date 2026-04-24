"""
API Gateway — /api/brain routes
Brain hologram data - graph structure and real-time streaming updates
"""
from __future__ import annotations

import json
from typing import AsyncGenerator, Any

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.get("/graph")
async def get_brain_graph() -> dict[str, Any]:
    """
    Get brain graph structure for hologram rendering.
    Returns nodes (concepts/strategies/signals) and edges (relationships/flows).
    """
    return {
        "nodes": [
            {
                "id": "market_data",
                "label": "Market Data",
                "type": "input",
                "value": 95.2,
                "position": {"x": 0, "y": 0},
            },
            {
                "id": "feature_eng",
                "label": "Feature Engineering",
                "type": "processing",
                "value": 87.5,
                "position": {"x": 200, "y": 0},
            },
            {
                "id": "signal_gen",
                "label": "Signal Generation",
                "type": "processing",
                "value": 92.1,
                "position": {"x": 400, "y": 0},
            },
            {
                "id": "risk_check",
                "label": "Risk Validation",
                "type": "gate",
                "value": 99.8,
                "position": {"x": 600, "y": 0},
            },
            {
                "id": "execution",
                "label": "Order Execution",
                "type": "output",
                "value": 98.3,
                "position": {"x": 800, "y": 0},
            },
            {
                "id": "ml_model",
                "label": "ML Predictor",
                "type": "ai",
                "value": 85.7,
                "position": {"x": 400, "y": 200},
            },
            {
                "id": "order_flow",
                "label": "Order Flow",
                "type": "input",
                "value": 78.4,
                "position": {"x": 0, "y": 200},
            },
            {
                "id": "brain_state",
                "label": "Brain State",
                "type": "memory",
                "value": 91.2,
                "position": {"x": 400, "y": -200},
            },
        ],
        "edges": [
            {"from": "market_data", "to": "feature_eng", "weight": 0.95, "label": "raw_ohlcv"},
            {"from": "order_flow", "to": "feature_eng", "weight": 0.87, "label": "microstructure"},
            {"from": "feature_eng", "to": "signal_gen", "weight": 0.92, "label": "computed_features"},
            {"from": "feature_eng", "to": "ml_model", "weight": 0.85, "label": "ml_input"},
            {"from": "signal_gen", "to": "risk_check", "weight": 0.89, "label": "signal_vector"},
            {"from": "ml_model", "to": "signal_gen", "weight": 0.83, "label": "predictions"},
            {"from": "brain_state", "to": "signal_gen", "weight": 0.91, "label": "context"},
            {"from": "brain_state", "to": "ml_model", "weight": 0.88, "label": "memory"},
            {"from": "risk_check", "to": "execution", "weight": 0.98, "label": "approved"},
            {"from": "execution", "to": "brain_state", "weight": 0.94, "label": "execution_feedback"},
        ],
        "metadata": {
            "health": 91.3,
            "uptime_pct": 99.98,
            "last_signal": "2026-04-20T10:42:15Z",
            "signals_today": 47,
            "execution_success_rate": 0.987,
        },
    }


async def _generate_sse_events() -> AsyncGenerator[str, None]:
    """Generate SSE events simulating live brain updates"""
    import asyncio

    events = [
        {
            "type": "node_update",
            "node_id": "market_data",
            "value": 96.1,
            "timestamp": "2026-04-20T10:43:01Z",
        },
        {
            "type": "edge_pulse",
            "from": "market_data",
            "to": "feature_eng",
            "intensity": 0.92,
            "timestamp": "2026-04-20T10:43:02Z",
        },
        {
            "type": "node_update",
            "node_id": "signal_gen",
            "value": 93.5,
            "timestamp": "2026-04-20T10:43:03Z",
        },
        {
            "type": "signal_fired",
            "signal_id": "sk_setup_aapl_long",
            "symbol": "AAPL",
            "direction": "LONG",
            "confidence": 0.89,
            "timestamp": "2026-04-20T10:43:04Z",
        },
        {
            "type": "node_update",
            "node_id": "risk_check",
            "value": 99.9,
            "timestamp": "2026-04-20T10:43:05Z",
        },
        {
            "type": "edge_pulse",
            "from": "signal_gen",
            "to": "execution",
            "intensity": 0.96,
            "timestamp": "2026-04-20T10:43:06Z",
        },
        {
            "type": "order_executed",
            "order_id": "order_2026_001",
            "symbol": "AAPL",
            "shares": 100,
            "price": 152.30,
            "timestamp": "2026-04-20T10:43:07Z",
        },
    ]

    for event in events:
        yield f"data: {json.dumps(event)}\n\n"
        await asyncio.sleep(1)


@router.get("/stream")
async def stream_brain_updates() -> StreamingResponse:
    """
    SSE endpoint for live brain hologram updates.
    Streams node value updates, edge pulses, signals, and executions.
    """
    return StreamingResponse(
        _generate_sse_events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
