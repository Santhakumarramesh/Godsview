"""Detector-threshold helpers.

Each detector reads its numeric thresholds through these helpers so
that operators can retune without a deploy. Values live in the
``system_config`` KV table; a missing row returns the hard-coded
default the caller passes in.

The helpers coerce the stored JSON value to the expected numeric type
and clamp the result so a bad edit in ``system_config`` cannot crash a
cron pass — an invalid value falls back to the default.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import SystemConfig


async def _raw_value(
    session: AsyncSession, key: str
) -> Optional[object]:
    row = await session.get(SystemConfig, key)
    if row is None:
        return None
    return row.value


async def get_float_threshold(
    session: AsyncSession, key: str, default: float
) -> float:
    """Fetch a float threshold; fall back to ``default`` on miss or cast error."""
    raw = await _raw_value(session, key)
    if raw is None:
        return float(default)
    try:
        value = float(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return float(default)
    return value


async def get_int_threshold(
    session: AsyncSession, key: str, default: int
) -> int:
    """Fetch an int threshold; fall back to ``default`` on miss or cast error."""
    raw = await _raw_value(session, key)
    if raw is None:
        return int(default)
    try:
        value = int(raw)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return int(default)
    return value


__all__ = ["get_float_threshold", "get_int_threshold"]
