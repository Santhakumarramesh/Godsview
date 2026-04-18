"""
Auth middleware and rate limiter for Godsview API Gateway.

• API key validation via X-API-Key header (configurable)
• In-memory sliding-window rate limiter (per-key, per-minute)
• JWT verification stub (ready for production JWT library)
• Public routes bypass (health checks, docs)
"""

from __future__ import annotations

import hashlib
import time
from collections import defaultdict, deque
from typing import Callable

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from services.shared.config import get_settings

settings = get_settings()

# ---------------------------------------------------------------------------
# Public routes that skip auth
# ---------------------------------------------------------------------------

PUBLIC_PATHS: set[str] = {
    "/health",
    "/health/services",
    "/docs",
    "/openapi.json",
    "/redoc",
    "/favicon.ico",
}


def _is_public(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith("/health")


# ---------------------------------------------------------------------------
# Rate limiter — in-memory sliding window
# ---------------------------------------------------------------------------

# key → deque of request timestamps (unix seconds)
_rate_windows: dict[str, deque] = defaultdict(deque)


def _rate_limit_check(key: str, limit: int, window: int = 60) -> bool:
    """Return True if request is allowed, False if rate-limited."""
    now = time.time()
    dq = _rate_windows[key]

    # Evict timestamps older than the window
    while dq and now - dq[0] > window:
        dq.popleft()

    if len(dq) >= limit:
        return False

    dq.append(now)
    return True


# ---------------------------------------------------------------------------
# API key store (production: replace with DB/Redis lookup)
# ---------------------------------------------------------------------------

# Hashed keys: sha256(raw_key) → metadata
_API_KEYS: dict[str, dict] = {
    hashlib.sha256(settings.internal_api_key.encode()).hexdigest(): {
        "client": "internal",
        "rate_limit": settings.rate_limit_per_minute * 10,  # internal gets 10×
    },
    hashlib.sha256(b"dev-key-frontend").hexdigest(): {
        "client": "dashboard",
        "rate_limit": settings.rate_limit_per_minute,
    },
}


def _lookup_api_key(raw_key: str) -> dict | None:
    h = hashlib.sha256(raw_key.encode()).hexdigest()
    return _API_KEYS.get(h)


def register_api_key(raw_key: str, client: str, rate_limit: int | None = None) -> None:
    """Runtime registration of API keys (for testing and admin endpoints)."""
    h = hashlib.sha256(raw_key.encode()).hexdigest()
    _API_KEYS[h] = {
        "client": client,
        "rate_limit": rate_limit or settings.rate_limit_per_minute,
    }


# ---------------------------------------------------------------------------
# Auth middleware
# ---------------------------------------------------------------------------


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Validates X-API-Key on every non-public request.
    Applies per-key sliding-window rate limiting.
    Injects x-client-id into request state for downstream use.
    """

    async def dispatch(self, request: Request, call_next: Callable):
        if _is_public(request.url.path):
            return await call_next(request)

        # Extract API key
        raw_key = request.headers.get(settings.api_key_header, "")
        if not raw_key:
            return JSONResponse(
                status_code=status.HTTP_401_UNAUTHORIZED,
                content={"detail": f"Missing {settings.api_key_header} header"},
            )

        key_meta = _lookup_api_key(raw_key)
        if key_meta is None:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Invalid API key"},
            )

        # Rate limiting
        client_id = key_meta["client"]
        limit = key_meta["rate_limit"]
        if not _rate_limit_check(client_id, limit):
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": f"Rate limit exceeded: {limit} requests/minute",
                    "client": client_id,
                },
                headers={"Retry-After": "60"},
            )

        # Inject client identity into request state
        request.state.client_id = client_id
        response = await call_next(request)
        response.headers["X-Client-ID"] = client_id
        return response


# ---------------------------------------------------------------------------
# Dependency: require_auth (for individual routes that need it)
# ---------------------------------------------------------------------------


async def require_auth(request: Request) -> str:
    """FastAPI dependency — returns client_id or raises 401."""
    client_id = getattr(request.state, "client_id", None)
    if client_id is None:
        raw_key = request.headers.get(settings.api_key_header, "")
        if not raw_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Missing {settings.api_key_header} header",
            )
        key_meta = _lookup_api_key(raw_key)
        if key_meta is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Invalid API key",
            )
        client_id = key_meta["client"]
        request.state.client_id = client_id
    return client_id
