"""
GodsView v2 — Async HTTP client factory (httpx-based).

Usage:
    from services.shared.http_client import service_client
    async with service_client(cfg.ml_url) as client:
        resp = await client.post("/predict", json=payload)
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator

import httpx

# Default timeouts
_CONNECT_TIMEOUT = 5.0
_READ_TIMEOUT    = 30.0
_WRITE_TIMEOUT   = 10.0


@asynccontextmanager
async def service_client(
    base_url: str,
    *,
    connect_timeout: float = _CONNECT_TIMEOUT,
    read_timeout:    float = _READ_TIMEOUT,
    write_timeout:   float = _WRITE_TIMEOUT,
    headers:         dict[str, str] | None = None,
) -> AsyncIterator[httpx.AsyncClient]:
    """Yield a configured async HTTP client for inter-service calls."""
    timeout = httpx.Timeout(
        connect=connect_timeout,
        read=read_timeout,
        write=write_timeout,
        pool=5.0,
    )
    default_headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if headers:
        default_headers.update(headers)

    async with httpx.AsyncClient(
        base_url=base_url,
        timeout=timeout,
        headers=default_headers,
        follow_redirects=True,
    ) as client:
        yield client


async def get_json(url: str, **kwargs: object) -> dict:
    """One-shot GET returning parsed JSON."""
    async with httpx.AsyncClient(timeout=_READ_TIMEOUT) as client:
        resp = await client.get(url, **kwargs)  # type: ignore[arg-type]
        resp.raise_for_status()
        return resp.json()


async def post_json(url: str, payload: dict, **kwargs: object) -> dict:
    """One-shot POST with JSON body, returning parsed JSON."""
    async with httpx.AsyncClient(timeout=_READ_TIMEOUT) as client:
        resp = await client.post(url, json=payload, **kwargs)  # type: ignore[arg-type]
        resp.raise_for_status()
        return resp.json()
