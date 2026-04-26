"""Smoke tests for the health probes."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_live_returns_ok(client: AsyncClient) -> None:
    res = await client.get("/health/live")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}
    # Correlation id middleware must always set the response header.
    assert res.headers.get("x-correlation-id", "").startswith("cor_") or res.headers.get(
        "x-correlation-id"
    )


@pytest.mark.asyncio
async def test_ready_returns_overall_status(client: AsyncClient) -> None:
    res = await client.get("/health/ready")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] in {"ok", "degraded"}
    assert body["service"] == "control_plane"
    assert "uptimeSeconds" in body
    assert "database" in body["checks"]


@pytest.mark.asyncio
async def test_correlation_id_passthrough(client: AsyncClient) -> None:
    res = await client.get("/health/live", headers={"x-correlation-id": "cor_abc12345"})
    assert res.status_code == 200
    assert res.headers["x-correlation-id"] == "cor_abc12345"


@pytest.mark.asyncio
async def test_security_headers_present(client: AsyncClient) -> None:
    res = await client.get("/health/live")
    assert res.headers.get("x-content-type-options") == "nosniff"
    assert res.headers.get("x-frame-options") in {"DENY", "SAMEORIGIN"}
    assert "referrer-policy" in res.headers
