from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import requests

from app.config import settings


def get_macro_event_context(symbol: str) -> dict[str, Any]:
    """
    FTMO endpoint format can change; this keeps a safe fallback context.
    """
    blackout = False
    high_impact_events: list[dict[str, Any]] = []

    try:
        resp = requests.get(settings.ftmo_calendar_url, timeout=6)
        if resp.status_code == 200:
            html = resp.text.lower()
            # conservative heuristic; avoids scraping dependency
            if "high impact" in html:
                high_impact_events.append(
                    {"source": "ftmo", "title": "High impact event detected"}
                )
    except Exception:
        pass

    # If many high-impact markers exist, activate blackout warning.
    if len(high_impact_events) >= 1:
        blackout = True

    return {
        "symbol": symbol.upper(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "blackout": blackout,
        "high_impact_events": high_impact_events,
        "source": settings.ftmo_calendar_url,
    }
