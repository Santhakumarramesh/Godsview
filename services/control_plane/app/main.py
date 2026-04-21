"""FastAPI entrypoint for GodsView control_plane."""

from __future__ import annotations

import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import get_settings
from app.errors import install_exception_handlers
from app.logging import configure_logging, get_logger
from app.middleware import (
    AccessLogMiddleware,
    CorrelationIdMiddleware,
    SecurityHeadersMiddleware,
)
from app.routes import api_router

START_MONOTONIC = time.monotonic()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger("control_plane")
    log.info(
        "control_plane.boot",
        env=settings.godsview_env,
        version=__version__,
        kill_switch_on_boot=settings.kill_switch_on_boot,
    )
    try:
        yield
    finally:
        log.info("control_plane.shutdown")


def _create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="GodsView control_plane",
        version=__version__,
        default_response_class=None,  # default JSONResponse is fine; orjson wired later.
        openapi_url="/openapi.json",
        docs_url="/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.started_at_monotonic = START_MONOTONIC

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["x-correlation-id"],
    )

    install_exception_handlers(app)
    app.include_router(api_router)
    return app


app = _create_app()


def run() -> None:
    import uvicorn

    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.godsview_env == "local",
        log_level=settings.log_level,
    )
