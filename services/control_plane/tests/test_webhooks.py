"""/admin/webhooks CRUD + secret rotation contract tests."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest.mark.asyncio
async def test_create_webhook_reveals_secret_once(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}

    created = await client.post(
        "/admin/webhooks",
        headers=h,
        json={
            "name": "tv-eurusd",
            "source": "tradingview",
            "scopes": ["signals:ingest"],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "tv-eurusd"
    assert body["source"] == "tradingview"
    assert body["active"] is True
    assert body["secret"].startswith("whsec_")

    # listing must NOT re-expose the secret
    listing = await client.get("/admin/webhooks", headers=h)
    assert listing.status_code == 200
    rows = listing.json()["webhooks"]
    assert len(rows) == 1
    assert "secret" not in rows[0]


@pytest.mark.asyncio
async def test_create_rejects_unknown_source(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/webhooks",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "x", "source": "myspace"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "webhooks.invalid_source"


@pytest.mark.asyncio
async def test_create_rejects_unknown_scope(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/webhooks",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "x", "source": "generic", "scopes": ["root:everything"]},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "webhooks.invalid_scope"


@pytest.mark.asyncio
async def test_duplicate_name_conflicts(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {"name": "dup-hook", "source": "generic"}
    first = await client.post("/admin/webhooks", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/admin/webhooks", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "webhooks.name_exists"


@pytest.mark.asyncio
async def test_rotate_secret_returns_new_secret(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = (
        await client.post(
            "/admin/webhooks",
            headers=h,
            json={"name": "rot-hook", "source": "alpaca"},
        )
    ).json()
    first_secret = created["secret"]
    rot = await client.post(
        f"/admin/webhooks/{created['id']}/rotate-secret", headers=h
    )
    assert rot.status_code == 200
    rot_body = rot.json()
    assert rot_body["id"] == created["id"]
    assert rot_body["secret"].startswith("whsec_")
    assert rot_body["secret"] != first_secret


@pytest.mark.asyncio
async def test_patch_and_deactivate(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = (
        await client.post(
            "/admin/webhooks",
            headers=h,
            json={"name": "patch-me", "source": "generic"},
        )
    ).json()
    patched = await client.patch(
        f"/admin/webhooks/{created['id']}",
        headers=h,
        json={"name": "patched", "scopes": ["signals:read"]},
    )
    assert patched.status_code == 200
    assert patched.json()["name"] == "patched"
    assert patched.json()["scopes"] == ["signals:read"]

    deact = await client.delete(f"/admin/webhooks/{created['id']}", headers=h)
    assert deact.status_code == 200
    assert deact.json()["active"] is False


@pytest.mark.asyncio
async def test_unknown_id_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    res = await client.patch(
        "/admin/webhooks/wh_nope", headers=h, json={"active": False}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "webhooks.not_found"
    rot = await client.post("/admin/webhooks/wh_nope/rotate-secret", headers=h)
    assert rot.status_code == 404
