"""Cross-cutting middleware: correlation ids, access logging, security headers."""

from __future__ import annotations

import re
import time
import uuid
from typing import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.logging import get_logger

_CORRELATION_HEADER = "x-correlation-id"
_CORRELATION_RX = re.compile(r"^[A-Za-z0-9_\-]{1,80}$")


class CorrelationIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(_CORRELATION_HEADER, "")
        cid = incoming if incoming and _CORRELATION_RX.match(incoming) else f"cor_{uuid.uuid4().hex}"
        request.state.correlation_id = cid
        response = await call_next(request)
        response.headers[_CORRELATION_HEADER] = cid
        return response


class AccessLogMiddleware(BaseHTTPMiddleware):
    _log = get_logger("http")

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        start = time.perf_counter()
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        self._log.info(
            "http_request",
            method=request.method,
            path=request.url.path,
            status_code=response.status_code,
            elapsed_ms=round(elapsed_ms, 2),
            correlation_id=getattr(request.state, "correlation_id", None),
            user_id=getattr(request.state, "user_id", None),
        )
        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("x-content-type-options", "nosniff")
        response.headers.setdefault("x-frame-options", "DENY")
        response.headers.setdefault("referrer-policy", "strict-origin-when-cross-origin")
        return response
