"""
Startup validator + graceful shutdown handler for all Godsview microservices.

Usage in any FastAPI service:
    from services.shared.startup import lifespan_factory

    app = FastAPI(lifespan=lifespan_factory("market_data", on_startup=my_init))

Features:
  • SIGTERM / SIGINT handler — sets shutdown_event; background tasks can poll it
  • Startup health checks — verifies required config before accepting traffic
  • Readiness probe — /ready returns 503 until startup completes
  • Drain timer — waits for in-flight requests before exiting (grace=10s)
"""

from __future__ import annotations

import asyncio
import logging
import signal
import time
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Callable, Coroutine

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from services.shared.config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

# Module-level shutdown event — shared across all coroutines in the process
shutdown_event: asyncio.Event = asyncio.Event()

# Module-level ready flag — set to True once startup completes
_ready: bool = False
_startup_time: float = 0.0
_service_name: str = "unknown"


def is_ready() -> bool:
    return _ready


def _install_signal_handlers() -> None:
    """Register SIGTERM / SIGINT to fire the shutdown event."""
    loop = asyncio.get_event_loop()

    def _handle(sig_name: str):
        log.info("signal_received", signal=sig_name, service=_service_name)
        shutdown_event.set()

    try:
        loop.add_signal_handler(signal.SIGTERM, lambda: _handle("SIGTERM"))
        loop.add_signal_handler(signal.SIGINT, lambda: _handle("SIGINT"))
    except NotImplementedError:
        # Windows — signals work differently; skip
        pass


async def _startup_checks(service_name: str) -> dict[str, bool]:
    """Run mandatory startup checks. Returns {check: passed}."""
    checks: dict[str, bool] = {}

    # Check 1: required env vars present
    checks["secret_key_set"] = bool(
        settings.secret_key
        and settings.secret_key != "dev-secret-change-me"
        or settings.env == "development"
    )

    # Check 2: database path writeable (for SQLite services)
    if "market_data" in service_name or "backtest" in service_name:
        try:
            import os
            import tempfile

            tf = tempfile.NamedTemporaryFile(dir=".", delete=True)
            tf.close()
            checks["db_writable"] = True
        except OSError:
            checks["db_writable"] = False
    else:
        checks["db_writable"] = True

    failed = [k for k, v in checks.items() if not v]
    if failed:
        log.warning("startup_checks.failed", failed=failed, service=service_name)
    else:
        log.info("startup_checks.passed", service=service_name)

    return checks


def lifespan_factory(
    service_name: str,
    on_startup: Callable[[], Coroutine] | None = None,
    on_shutdown: Callable[[], Coroutine] | None = None,
    grace_seconds: float = 10.0,
):
    """
    Returns an async context manager suitable for ``FastAPI(lifespan=...)``.

    Args:
        service_name:  Human-readable name used in logs + health probes.
        on_startup:    Optional coroutine called once on startup.
        on_shutdown:   Optional coroutine called once on shutdown.
        grace_seconds: Seconds to wait for in-flight requests to drain.
    """

    @asynccontextmanager
    async def _lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
        global _ready, _startup_time, _service_name
        _service_name = service_name
        t0 = time.perf_counter()

        _install_signal_handlers()

        log.info("service.starting", service=service_name)
        await _startup_checks(service_name)

        if on_startup:
            try:
                await on_startup()
            except Exception as exc:
                log.error("startup.hook_failed", error=str(exc), service=service_name)
                raise

        _ready = True
        _startup_time = time.perf_counter() - t0
        log.info(
            "service.ready",
            service=service_name,
            startup_ms=round(_startup_time * 1000, 1),
        )

        yield  # ← service is running

        # ── Shutdown sequence ──────────────────────────────────────────────
        _ready = False
        shutdown_event.set()
        log.info(
            "service.shutting_down",
            service=service_name,
            grace_seconds=grace_seconds,
        )

        # Allow in-flight requests to complete
        await asyncio.sleep(grace_seconds)

        if on_shutdown:
            try:
                await on_shutdown()
            except Exception as exc:
                log.error("shutdown.hook_failed", error=str(exc), service=service_name)

        log.info("service.stopped", service=service_name)

    return _lifespan


# ---------------------------------------------------------------------------
# Readiness probe route (attach to each FastAPI app)
# ---------------------------------------------------------------------------


async def ready_endpoint(request: Request) -> Response:
    """GET /ready — returns 200 when service is up, 503 if still starting."""
    if _ready:
        return JSONResponse(
            content={
                "status": "ready",
                "service": _service_name,
                "startup_ms": round(_startup_time * 1000, 1),
            }
        )
    return JSONResponse(
        status_code=503,
        content={"status": "starting", "service": _service_name},
    )


def add_readiness_probe(app: FastAPI) -> None:
    """Attach /ready endpoint to a FastAPI app."""
    app.add_route("/ready", ready_endpoint, include_in_schema=False)
