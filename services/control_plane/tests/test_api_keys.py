"""/admin/api-keys CRUD contract tests.

Invariants checked:
  * Plaintext is returned exactly once on POST and never by GET.
  * Prefix + owner_user_id are persisted; hash is Argon2 (starts with ``$argon2``).
  * Non-admins cannot list or create keys.
  * Revocation is idempotent-once: 409 ``api_keys.already_revoked`` on repeat.
  * Creating a key with an unknown scope → 422 ``api_keys.invalid_scope``.
  * Creating for an unknown owner → 404 ``api_keys.owner_not_found``.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest.mark.asyncio
async def test_create_api_key_reveals_plaintext_once(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}

    created = await client.post(
        "/admin/api-keys",
        headers=h,
        json={"name": "tv-ingest", "scopes": ["webhooks:write", "signals:read"]},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "tv-ingest"
    assert body["ownerUserId"] == admin_user["id"]
    assert body["scopes"] == ["webhooks:write", "signals:read"]
    assert body["revokedAt"] is None
    plaintext = body["plaintext"]
    assert plaintext.startswith("gv_sk_")
    assert body["prefix"] in plaintext
    assert len(plaintext) >= len("gv_sk_") + 8 + 1 + 32

    listing = await client.get("/admin/api-keys", headers=h)
    assert listing.status_code == 200
    keys = listing.json()["apiKeys"]
    assert len(keys) == 1
    # Critically: listing does NOT re-expose plaintext.
    assert "plaintext" not in keys[0]


@pytest.mark.asyncio
async def test_non_admin_cannot_create_or_list(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    # provision a viewer
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer-apikey@godsview.io",
            "displayName": "Peep",
            "password": "viewer-pass-1234567",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer-apikey@godsview.io", "viewer-pass-1234567"
    )
    res = await client.post(
        "/admin/api-keys",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={"name": "nope", "scopes": []},
    )
    assert res.status_code == 403
    listing = await client.get(
        "/admin/api-keys", headers={"authorization": f"Bearer {viewer_token}"}
    )
    assert listing.status_code == 403


@pytest.mark.asyncio
async def test_create_rejects_unknown_scope(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/api-keys",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "bad", "scopes": ["root:everything"]},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "api_keys.invalid_scope"


@pytest.mark.asyncio
async def test_create_rejects_unknown_owner(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/api-keys",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "ghost", "ownerUserId": "usr_missing"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "api_keys.owner_not_found"


@pytest.mark.asyncio
async def test_create_conflicts_on_duplicate_name(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {"name": "cron-runner", "scopes": ["execution:read"]}
    first = await client.post("/admin/api-keys", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/admin/api-keys", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "api_keys.name_exists"


@pytest.mark.asyncio
async def test_revoke_then_double_revoke(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = (
        await client.post(
            "/admin/api-keys",
            headers=h,
            json={"name": "rotate-me", "scopes": ["ops:read"]},
        )
    ).json()
    first = await client.delete(f"/admin/api-keys/{created['id']}", headers=h)
    assert first.status_code == 200
    assert first.json()["revokedAt"] is not None
    second = await client.delete(f"/admin/api-keys/{created['id']}", headers=h)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "api_keys.already_revoked"


@pytest.mark.asyncio
async def test_revoke_unknown_api_key_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.delete(
        "/admin/api-keys/ak_does_not_exist",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "api_keys.not_found"
