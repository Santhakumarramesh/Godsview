"""Liveness and readiness endpoints."""

from __future__ import annotations

import time
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text

from app import __version__
from app.config import Settings, get_settings
from app.db import DbSession
from app.logging import get_logger

router = APIRouter(prefix="/health", tags=["health"])
_log = get_logger("health")


@router.get("/live", summary="Liveness probe")
async def live() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready", summary="Readiness probe")
async def ready(
    request: Request,
    db: DbSession,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, object]:
    checks: dict[str, dict[str, str]] = {}

    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = {"status": "ok"}
    except Exception as exc:  # pragma: no cover - exercised by integration tests
        checks["database"] = {"status": "down", "detail": str(exc)}
        _log.warning("health.db_check_failed", detail=str(exc))

    uptime = time.monotonic() - request.app.state.started_at_monotonic
    overall = "ok" if all(c["status"] == "ok" for c in checks.values()) else "degraded"

    return {
        "status": overall,
        "service": settings.godsview_service_name,
        "version": __version__,
        "uptimeSeconds": round(uptime, 3),
        "checks": checks,
    }
