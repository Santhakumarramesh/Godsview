from __future__ import annotations

from typing import Any

from app.analysis.fvg import detect_fvg
from app.analysis.order_blocks import detect_order_blocks
from app.analysis.structure import analyze_structure
from app.data_fetch import fetch_price_history


DEFAULT_TIMEFRAMES = ["5m", "15m", "1h", "4h", "1d"]


def analyze_single_timeframe(symbol: str, timeframe: str) -> dict[str, Any]:
    try:
        df = fetch_price_history(symbol, timeframe)
    except Exception as err:  # noqa: BLE001
        return {
            "timeframe": timeframe,
            "status": "error",
            "error": str(err),
        }

    structure = analyze_structure(df)
    order_blocks = detect_order_blocks(df)
    fvgs = detect_fvg(df)
    latest_close = float(df["Close"].iloc[-1]) if len(df) else None

    return {
        "timeframe": timeframe,
        "status": "ok",
        "rows": int(len(df)),
        "latest_close": latest_close,
        "structure": structure,
        "order_blocks": order_blocks[-20:],
        "fvgs": fvgs[-20:],
    }


def analyze_multi_timeframes(symbol: str, timeframes: list[str] | None = None) -> dict[str, Any]:
    frames = timeframes or DEFAULT_TIMEFRAMES
    results = [analyze_single_timeframe(symbol, tf) for tf in frames]

    valid = [r for r in results if r.get("status") == "ok"]
    trend_votes = {"bullish": 0, "bearish": 0, "range": 0}
    for row in valid:
        trend = str(row.get("structure", {}).get("trend", "range"))
        if trend not in trend_votes:
            trend = "range"
        trend_votes[trend] += 1

    dominant = max(trend_votes, key=trend_votes.get) if valid else "unknown"
    confluence = 0.0
    if valid:
        confluence = trend_votes.get(dominant, 0) / len(valid)

    return {
        "symbol": symbol.upper(),
        "timeframes": frames,
        "results": results,
        "summary": {
            "valid_timeframes": len(valid),
            "dominant_trend": dominant,
            "trend_votes": trend_votes,
            "confluence": round(float(confluence), 4),
        },
    }

