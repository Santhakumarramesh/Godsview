from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from app.config import settings

SESSION_WINDOWS = {
    "ASIAN": (0, 4),  # 00:00-03:59
    "LONDON": (3, 8),  # 03:00-07:59
    "NEW_YORK": (8, 12),  # 08:00-11:59
}


def evaluate_time_window(now: datetime | None = None) -> dict[str, Any]:
    tz = ZoneInfo(settings.session_timezone)
    ts = now.astimezone(tz) if now else datetime.now(tz)
    hour = ts.hour

    active_session = "OFF"
    for name, (start, end) in SESSION_WINDOWS.items():
        if start <= hour < end:
            active_session = name
            break

    allowlist = {
        s.strip().upper() for s in settings.allowed_sessions.split(",") if s.strip()
    }
    allowed = active_session in allowlist
    return {
        "timezone": settings.session_timezone,
        "timestamp": ts.isoformat(),
        "session": active_session,
        "allowed": allowed,
        "allowlist": sorted(list(allowlist)),
    }
