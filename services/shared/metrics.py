"""
Prometheus metrics for all Godsview microservices.

Usage in any FastAPI service:
    from services.shared.metrics import setup_metrics, metrics_endpoint
    setup_metrics(app, service_name="market_data")
    app.add_route("/metrics", metrics_endpoint)

Counters / histograms:
  godsview_http_requests_total{service, method, path, status}
  godsview_http_request_duration_seconds{service, method, path}
  godsview_signals_total{service, symbol, timeframe, signal_type}
  godsview_trades_total{service, symbol, direction, outcome}
  godsview_bars_fetched_total{service, symbol, timeframe}
  godsview_ml_predictions_total{service, symbol, approved}
  godsview_errors_total{service, error_type}
"""

from __future__ import annotations

import time
from typing import Any, Callable

from fastapi import FastAPI, Request, Response
from fastapi.responses import PlainTextResponse
from starlette.middleware.base import BaseHTTPMiddleware

# ---------------------------------------------------------------------------
# Try to use the real prometheus_client if installed; fall back to stubs
# ---------------------------------------------------------------------------
try:
    from prometheus_client import (
        CONTENT_TYPE_LATEST,
        REGISTRY,
        Counter,
        Gauge,
        Histogram,
        generate_latest,
    )

    _PROMETHEUS_AVAILABLE = True
except ImportError:
    _PROMETHEUS_AVAILABLE = False

    # Minimal stubs so the rest of the code never crashes
    class _Noop:
        def labels(self, **_):
            return self

        def inc(self, *_, **__):
            pass

        def observe(self, *_, **__):
            pass

        def set(self, *_, **__):
            pass

    Counter = Gauge = Histogram = lambda *a, **kw: _Noop()  # type: ignore
    CONTENT_TYPE_LATEST = "text/plain"

    def generate_latest(*_):
        return b""  # type: ignore

    class REGISTRY:  # type: ignore
        @staticmethod
        def get_sample_value(*_):
            return None


# ---------------------------------------------------------------------------
# Metrics definitions (module-level singletons, created once)
# ---------------------------------------------------------------------------

_initialized: set[str] = set()
_counters: dict[str, Any] = {}
_histograms: dict[str, Any] = {}
_gauges: dict[str, Any] = {}


def _ensure_metrics() -> None:
    global _counters, _histograms, _gauges
    if _PROMETHEUS_AVAILABLE and not _counters:
        _counters["http_requests"] = Counter(
            "godsview_http_requests_total",
            "Total HTTP requests",
            ["service", "method", "path", "status"],
        )
        _counters["signals"] = Counter(
            "godsview_signals_total",
            "Total signals detected",
            ["service", "symbol", "timeframe", "signal_type"],
        )
        _counters["trades"] = Counter(
            "godsview_trades_total",
            "Total trades executed",
            ["service", "symbol", "direction", "outcome"],
        )
        _counters["bars_fetched"] = Counter(
            "godsview_bars_fetched_total",
            "Total OHLCV bars fetched",
            ["service", "symbol", "timeframe"],
        )
        _counters["ml_predictions"] = Counter(
            "godsview_ml_predictions_total",
            "Total ML predictions made",
            ["service", "symbol", "approved"],
        )
        _counters["errors"] = Counter(
            "godsview_errors_total",
            "Total errors by type",
            ["service", "error_type"],
        )
        _histograms["http_duration"] = Histogram(
            "godsview_http_request_duration_seconds",
            "HTTP request duration",
            ["service", "method", "path"],
            buckets=[0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0],
        )
        _histograms["backtest_duration"] = Histogram(
            "godsview_backtest_duration_seconds",
            "Backtest run duration",
            ["service", "symbol", "timeframe"],
            buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0],
        )
        _gauges["open_positions"] = Gauge(
            "godsview_open_positions",
            "Current number of open positions",
            ["service"],
        )
        _gauges["equity"] = Gauge(
            "godsview_equity_dollars",
            "Current account equity in USD",
            ["service"],
        )


# ---------------------------------------------------------------------------
# Public recording helpers
# ---------------------------------------------------------------------------


def record_request(service: str, method: str, path: str, status: int) -> None:
    _ensure_metrics()
    if "http_requests" in _counters:
        _counters["http_requests"].labels(
            service=service, method=method, path=path, status=str(status)
        ).inc()


def record_signal(service: str, symbol: str, timeframe: str, signal_type: str) -> None:
    _ensure_metrics()
    if "signals" in _counters:
        _counters["signals"].labels(
            service=service,
            symbol=symbol,
            timeframe=timeframe,
            signal_type=signal_type,
        ).inc()


def record_trade(service: str, symbol: str, direction: str, outcome: str) -> None:
    _ensure_metrics()
    if "trades" in _counters:
        _counters["trades"].labels(
            service=service,
            symbol=symbol,
            direction=direction,
            outcome=outcome,
        ).inc()


def record_bars_fetched(service: str, symbol: str, timeframe: str, count: int) -> None:
    _ensure_metrics()
    if "bars_fetched" in _counters:
        _counters["bars_fetched"].labels(
            service=service,
            symbol=symbol,
            timeframe=timeframe,
        ).inc(count)


def record_ml_prediction(service: str, symbol: str, approved: bool) -> None:
    _ensure_metrics()
    if "ml_predictions" in _counters:
        _counters["ml_predictions"].labels(
            service=service,
            symbol=symbol,
            approved=str(approved).lower(),
        ).inc()


def record_error(service: str, error_type: str) -> None:
    _ensure_metrics()
    if "errors" in _counters:
        _counters["errors"].labels(service=service, error_type=error_type).inc()


def observe_duration(service: str, method: str, path: str, seconds: float) -> None:
    _ensure_metrics()
    if "http_duration" in _histograms:
        _histograms["http_duration"].labels(
            service=service,
            method=method,
            path=path,
        ).observe(seconds)


def observe_backtest_duration(
    service: str, symbol: str, timeframe: str, seconds: float
) -> None:
    _ensure_metrics()
    if "backtest_duration" in _histograms:
        _histograms["backtest_duration"].labels(
            service=service,
            symbol=symbol,
            timeframe=timeframe,
        ).observe(seconds)


def set_open_positions(service: str, count: int) -> None:
    _ensure_metrics()
    if "open_positions" in _gauges:
        _gauges["open_positions"].labels(service=service).set(count)


def set_equity(service: str, equity: float) -> None:
    _ensure_metrics()
    if "equity" in _gauges:
        _gauges["equity"].labels(service=service).set(equity)


# ---------------------------------------------------------------------------
# Prometheus scrape endpoint
# ---------------------------------------------------------------------------


async def metrics_endpoint(request: Request) -> Response:
    """GET /metrics — scraped by Prometheus."""
    _ensure_metrics()
    if _PROMETHEUS_AVAILABLE:
        data = generate_latest()
        return Response(content=data, media_type=CONTENT_TYPE_LATEST)
    return PlainTextResponse("# prometheus_client not installed\n")


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class PrometheusMiddleware(BaseHTTPMiddleware):
    """Auto-records request count + latency for every endpoint."""

    def __init__(self, app, service_name: str) -> None:
        super().__init__(app)
        self.service_name = service_name
        _ensure_metrics()

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        duration = time.perf_counter() - start

        path = request.url.path
        method = request.method
        status_code = response.status_code

        record_request(self.service_name, method, path, status_code)
        observe_duration(self.service_name, method, path, duration)

        return response


# ---------------------------------------------------------------------------
# Setup helper
# ---------------------------------------------------------------------------


def setup_metrics(app: FastAPI, service_name: str) -> None:
    """
    Attach Prometheus middleware and /metrics route to a FastAPI app.

    Call once during app startup:
        setup_metrics(app, service_name="market_data")
    """
    _ensure_metrics()
    app.add_middleware(PrometheusMiddleware, service_name=service_name)
    app.add_route("/metrics", metrics_endpoint, include_in_schema=False)
