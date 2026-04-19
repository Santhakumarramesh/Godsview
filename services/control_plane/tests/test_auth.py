"""Auth round-trip: login → me → refresh → logout."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_rejects_bad_credentials(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    res = await client.post(
        "/auth/login",
        json={"email": admin_user["email"], "password": "wrong-password"},
    )
    assert res.status_code == 401
    body = res.json()
    assert body["error"]["code"] == "unauthenticated"
    assert "correlation_id" in body["error"]


@pytest.mark.asyncio
async def test_login_unknown_email_returns_401(client: AsyncClient) -> None:
    res = await client.post(
        "/auth/login",
        json={"email": "nobody@godsview.io", "password": "also-wrong-1"},
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


@pytest.mark.asyncio
async def test_login_happy_path_and_me(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    res = await client.post(
        "/auth/login",
        json={"email": admin_user["email"], "password": admin_user["password"]},
    )
    assert res.status_code == 200
    tokens = res.json()
    assert "accessToken" in tokens
    assert "refreshToken" in tokens
    assert tokens["accessToken"] != tokens["refreshToken"]

    me = await client.get(
        "/auth/me",
        headers={"authorization": f"Bearer {tokens['accessToken']}"},
    )
    assert me.status_code == 200
    body = me.json()
    assert body["email"] == admin_user["email"]
    assert "admin" in body["roles"]


@pytest.mark.asyncio
async def test_refresh_rotates_tokens(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    login = await client.post(
        "/auth/login",
        json={"email": admin_user["email"], "password": admin_user["password"]},
    )
    tokens = login.json()
    old_refresh = tokens["refreshToken"]

    res = await client.post(
        "/auth/refresh", json={"refreshToken": old_refresh}
    )
    assert res.status_code == 200
    rotated = res.json()
    assert rotated["refreshToken"] != old_refresh
    assert rotated["accessToken"] != tokens["accessToken"]

    # Old refresh token is now revoked; reusing it must fail.
    reuse = await client.post(
        "/auth/refresh", json={"refreshToken": old_refresh}
    )
    assert reuse.status_code == 401


@pytest.mark.asyncio
async def test_logout_revokes_all_refresh_tokens(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    login = await client.post(
        "/auth/login",
        json={"email": admin_user["email"], "password": admin_user["password"]},
    )
    tokens = login.json()

    logout = await client.post(
        "/auth/logout",
        headers={"authorization": f"Bearer {tokens['accessToken']}"},
    )
    assert logout.status_code == 204

    reuse = await client.post(
        "/auth/refresh", json={"refreshToken": tokens["refreshToken"]}
    )
    assert reuse.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_bearer(client: AsyncClient) -> None:
    res = await client.get("/auth/me")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"
