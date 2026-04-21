"""Canonical error envelope matching docs/blueprint/reference/API_SURFACE.md."""

from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    """Raise to short-circuit a handler with a canonical envelope."""

    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        hint: str | None = None,
        docs: str | None = None,
        details: list[dict[str, Any]] | None = None,
    ) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message
        self.hint = hint
        self.docs = docs
        self.details = details or []
        super().__init__(message)


def _envelope(
    *,
    code: str,
    message: str,
    correlation_id: str,
    hint: str | None = None,
    docs: str | None = None,
    details: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "error": {
            "code": code,
            "message": message,
            "correlation_id": correlation_id,
        }
    }
    if details:
        body["error"]["details"] = details
    if hint:
        body["error"]["hint"] = hint
    if docs:
        body["error"]["docs"] = docs
    return body


def install_exception_handlers(app: Any) -> None:
    @app.exception_handler(ApiError)
    async def _handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        cid = getattr(request.state, "correlation_id", "unknown")
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(
                code=exc.code,
                message=exc.message,
                correlation_id=cid,
                hint=exc.hint,
                docs=exc.docs,
                details=exc.details,
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _handle_http(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        cid = getattr(request.state, "correlation_id", "unknown")
        code_map = {
            status.HTTP_401_UNAUTHORIZED: "unauthenticated",
            status.HTTP_403_FORBIDDEN: "forbidden",
            status.HTTP_404_NOT_FOUND: "not_found",
            status.HTTP_409_CONFLICT: "conflict",
            status.HTTP_429_TOO_MANY_REQUESTS: "rate_limited",
            status.HTTP_503_SERVICE_UNAVAILABLE: "upstream_unavailable",
        }
        return JSONResponse(
            status_code=exc.status_code,
            content=_envelope(
                code=code_map.get(exc.status_code, "internal_error"),
                message=str(exc.detail) if exc.detail else "request failed",
                correlation_id=cid,
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def _handle_validation(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        cid = getattr(request.state, "correlation_id", "unknown")
        details = [
            {"path": ".".join(str(p) for p in err["loc"]), "issue": err["msg"]}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=_envelope(
                code="validation_error",
                message="request validation failed",
                correlation_id=cid,
                details=details,
            ),
        )

    @app.exception_handler(Exception)
    async def _handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        cid = getattr(request.state, "correlation_id", "unknown")
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=_envelope(
                code="internal_error",
                message="unexpected server error",
                correlation_id=cid,
            ),
        )
