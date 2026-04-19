"""Canonical error envelope matching docs/blueprint/04-api-surface.md.

The envelope is BOTH a runtime contract (every exception handler emits it)
and a schema contract (every non-2xx response in the OpenAPI spec references
``ErrorEnvelope`` below). ``contract-validation.yml`` enforces the latter.
"""

from __future__ import annotations

from typing import Any

from fastapi import Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException as StarletteHTTPException


class ErrorDetail(BaseModel):
    """Structured detail for multi-error responses (e.g. validation failures)."""

    path: str = Field(..., description="Dotted path to the offending field.")
    issue: str = Field(..., description="Human-readable problem statement.")


class ErrorBody(BaseModel):
    """Inner ``error`` object — see blueprint 04-api-surface.md."""

    code: str = Field(..., description="Stable machine-readable error code.")
    message: str = Field(..., description="Human-readable error description.")
    correlation_id: str = Field(
        ...,
        description="X-Correlation-ID echoed back so logs can be joined.",
    )
    details: list[ErrorDetail] | None = Field(
        default=None,
        description="Per-field detail, present for validation_error and friends.",
    )
    hint: str | None = Field(default=None, description="Recovery hint for the caller.")
    docs: str | None = Field(default=None, description="Link to runbook / docs.")


class ErrorEnvelope(BaseModel):
    """Outer envelope — every 4xx / 5xx response body conforms to this model."""

    error: ErrorBody


# Responses map consumed by ``app.include_router`` / endpoint decorators. We
# attach these to the canonical auth-gated endpoints so the OpenAPI spec
# advertises 401/403 consistently.
AUTH_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    401: {"model": ErrorEnvelope, "description": "Missing or invalid credentials."},
    403: {"model": ErrorEnvelope, "description": "Insufficient role for this operation."},
}

COMMON_ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    400: {"model": ErrorEnvelope, "description": "Malformed request."},
    404: {"model": ErrorEnvelope, "description": "Resource not found."},
    409: {"model": ErrorEnvelope, "description": "State conflict."},
    422: {"model": ErrorEnvelope, "description": "Request validation failed."},
    429: {"model": ErrorEnvelope, "description": "Rate limit exceeded."},
    500: {"model": ErrorEnvelope, "description": "Internal server error."},
}


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
    async def _handle_validation(request: Request, exc: RequestValidationError) -> JSONResponse:
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
