from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
import re

import requests

from app.config import settings

POSITIVE_WORDS = {
    "bullish",
    "breakout",
    "strong",
    "buy",
    "uptrend",
    "accumulate",
    "support",
    "momentum",
}
NEGATIVE_WORDS = {
    "bearish",
    "breakdown",
    "weak",
    "sell",
    "downtrend",
    "resistance",
    "dump",
    "risk",
}


def _lexicon_score(text: str) -> float:
    tokens = re.findall(r"[a-zA-Z]+", text.lower())
    if not tokens:
        return 0.0
    pos = sum(1 for token in tokens if token in POSITIVE_WORDS)
    neg = sum(1 for token in tokens if token in NEGATIVE_WORDS)
    return (pos - neg) / max(len(tokens), 1)


def _fetch_x_recent(symbol: str, limit: int = 25) -> list[str]:
    if not settings.x_bearer_token:
        return []
    query = f"({symbol} OR ${symbol}) lang:en -is:retweet"
    url = "https://api.x.com/2/tweets/search/recent"
    headers = {"Authorization": f"Bearer {settings.x_bearer_token}"}
    params = {"query": query, "max_results": max(10, min(limit, 100)), "tweet.fields": "created_at,text"}
    try:
        resp = requests.get(url, headers=headers, params=params, timeout=8)
        if resp.status_code != 200:
            return []
        payload = resp.json()
        rows = payload.get("data", [])
        return [str(row.get("text", "")) for row in rows if row.get("text")]
    except Exception:
        return []


def get_sentiment_snapshot(symbol: str) -> dict[str, Any]:
    posts = _fetch_x_recent(symbol)
    scores = [_lexicon_score(text) for text in posts]
    avg = sum(scores) / len(scores) if scores else 0.0
    polarity = "neutral"
    if avg > 0.01:
        polarity = "positive"
    elif avg < -0.01:
        polarity = "negative"

    return {
        "symbol": symbol.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "x_recent_search" if settings.x_bearer_token else "local_lexicon",
        "posts_scanned": len(posts),
        "sentiment_score": round(float(avg), 6),
        "polarity": polarity,
    }

