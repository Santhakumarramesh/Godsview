"""
GodsView v2 — Structured JSON logging (structlog + stdlib).

Usage:
    from services.shared.logging import get_logger
    log = get_logger(__name__)
    log.info("bar_fetched", symbol="AAPL", count=100)
"""
from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def _configure_structlog(level: str = "INFO") -> None:
    """Call once at service startup."""
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    if sys.stdout.isatty():
        # Human-readable in local dev
        shared_processors.append(structlog.dev.ConsoleRenderer())
    else:
        # JSON in staging / production
        shared_processors.append(structlog.processors.JSONRenderer())

    structlog.configure(
        processors=shared_processors,
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelName(level)
        ),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )

    # Also configure stdlib so third-party libs emit structured logs
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stdout,
        level=logging.getLevelName(level),
    )


def get_logger(name: str) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)


# Configure on import with a sensible default; services call
# configure_structlog() with their own log level at startup.
configure_structlog = _configure_structlog
# Back-compat alias used by scheduler_service and other callers that import
# configure_logging directly.
configure_logging = _configure_structlog

__all__ = ["get_logger", "configure_structlog", "configure_logging"]
