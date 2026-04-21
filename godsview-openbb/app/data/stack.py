from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd

from app.config import settings
from app.data.alpaca_client import get_alpaca_execution_context
from app.data.fred_client import get_fred_macro_snapshot
from app.data.macro import get_macro_event_context
from app.data.quiver_client import get_quiver_snapshot
from app.data.sentiment import get_sentiment_snapshot
from app.data.tiingo_client import get_tiingo_ohlcv
from app.data_fetch import fetch_price_history


def get_market_ohlcv(symbol: str, timeframe: str, lookback: int | None = None) -> tuple[pd.DataFrame, dict[str, Any]]:
    lookback = int(lookback or settings.lookback)
    tiingo = get_tiingo_ohlcv(symbol, lookback=lookback)
    if bool(tiingo.get("available")):
        df = tiingo.get("dataframe")
        if isinstance(df, pd.DataFrame) and not df.empty:
            tiingo_meta = {k: v for k, v in tiingo.items() if k != "dataframe"}
            return df.tail(lookback), {
                "primary_source": "tiingo",
                "source_details": tiingo_meta,
                "fallback_used": False,
            }

    df = fetch_price_history(symbol, timeframe).tail(lookback)
    fallback_source = str(df.attrs.get("data_source", "openbb_or_alpaca"))
    return df, {
        "primary_source": fallback_source,
        "source_details": {
            "tiingo": {k: v for k, v in tiingo.items() if k != "dataframe"},
            "openbb_error": df.attrs.get("openbb_error"),
            "alpaca_error": df.attrs.get("alpaca_error"),
        },
        "fallback_used": True,
    }


def get_macro_context(symbol: str) -> dict[str, Any]:
    ftmo = get_macro_event_context(symbol)
    fred = get_fred_macro_snapshot()
    rate_state = "unknown"
    fed_funds_value = None
    if bool(fred.get("available")):
        fed_funds = (fred.get("series", {}) or {}).get("fed_funds", {}) or {}
        fed_funds_value = fed_funds.get("value")
        if isinstance(fed_funds_value, (float, int)):
            rate_state = "high" if float(fed_funds_value) >= 4.0 else "normal"

    return {
        "symbol": symbol.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "blackout": bool(ftmo.get("blackout", False)),
        "high_impact_events": ftmo.get("high_impact_events", []),
        "ftmo": ftmo,
        "fred": fred,
        "rate_state": rate_state,
        "fed_funds": fed_funds_value,
        "source": "ftmo+fred",
    }


def get_sentiment_context(symbol: str) -> dict[str, Any]:
    x_sent = get_sentiment_snapshot(symbol)
    quiver = get_quiver_snapshot(symbol)
    x_score = float(x_sent.get("sentiment_score", 0.0))
    quiver_score = float(quiver.get("smart_money_score", 0.0))
    blended = (x_score * 0.6) + (quiver_score * 0.4)
    polarity = "neutral"
    if blended > 0.02:
        polarity = "positive"
    elif blended < -0.02:
        polarity = "negative"

    return {
        "symbol": symbol.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "x+quiver",
        "x": x_sent,
        "quiver": quiver,
        "sentiment_score": round(float(blended), 6),
        "polarity": polarity,
    }


def get_execution_context() -> dict[str, Any]:
    return get_alpaca_execution_context()
