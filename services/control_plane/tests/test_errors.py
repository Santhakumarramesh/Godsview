"""Error envelope + validation error coverage."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_unknown_route_returns_envelope(client: AsyncClient) -> None:
    res = await client.get("/does/not/exist")
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "not_found"
    assert body["error"]["correlation_id"].startswith("cor_") or body["error"][
        "correlation_id"
    ]


@pytest.mark.asyncio
async def test_validation_error_envelope(client: AsyncClient) -> None:
    # password must be min_length=8 per LoginRequest
    res = await client.post(
        "/auth/login", json={"email": "a@b.com", "password": "short"}
    )
    assert res.status_code == 422
    body = res.json()
    assert body["error"]["code"] == "validation_error"
    assert isinstance(body["error"]["details"], list)
