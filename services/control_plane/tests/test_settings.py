"""/v1/settings self-service contract tests.

Exercises every sub-surface (profile, password, preferences, personal
API tokens) as a non-admin user where possible — admin_user is used
only to seed a viewer account for isolation.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


async def _provision_viewer(
    client: AsyncClient, admin_token: str, email: str, password: str
) -> str:
    r = await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": email,
            "displayName": "Viewer",
            "password": password,
            "roles": ["viewer"],
        },
    )
    assert r.status_code == 201, r.text
    return await _login(client, email, password)


@pytest.mark.asyncio
async def test_get_profile_returns_self(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/v1/settings/profile", headers={"authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == admin_user["email"]
    assert "admin" in body["roles"]
    assert "password" not in body and "passwordHash" not in body


@pytest.mark.asyncio
async def test_patch_profile_updates_self(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    viewer_token = await _provision_viewer(
        client, admin_token, "viewer-self@godsview.io", "viewer-pass-1234567"
    )
    h = {"authorization": f"Bearer {viewer_token}"}
    patched = await client.patch(
        "/v1/settings/profile",
        headers=h,
        json={"displayName": "Fresh Name", "mfaEnabled": True},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["displayName"] == "Fresh Name"
    assert body["mfaEnabled"] is True
    # re-read confirms persistence
    confirmed = await client.get("/v1/settings/profile", headers=h)
    assert confirmed.json()["displayName"] == "Fresh Name"


@pytest.mark.asyncio
async def test_patch_profile_requires_auth(client: AsyncClient) -> None:
    res = await client.patch(
        "/v1/settings/profile", json={"displayName": "x"}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_password_change_rejects_wrong_current(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/v1/settings/password",
        headers={"authorization": f"Bearer {token}"},
        json={
            "currentPassword": "wrong-one",
            "newPassword": "brand-new-pass-9876",
        },
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "settings.password_mismatch"


@pytest.mark.asyncio
async def test_password_change_rejects_unchanged(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/v1/settings/password",
        headers={"authorization": f"Bearer {token}"},
        json={
            "currentPassword": admin_user["password"],
            "newPassword": admin_user["password"],
        },
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "settings.password_unchanged"


@pytest.mark.asyncio
async def test_password_change_happy_path(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    await _provision_viewer(
        client, admin_token, "pw-change@godsview.io", "original-pass-4242"
    )
    viewer_token = await _login(
        client, "pw-change@godsview.io", "original-pass-4242"
    )
    res = await client.post(
        "/v1/settings/password",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={
            "currentPassword": "original-pass-4242",
            "newPassword": "replacement-pass-9999",
        },
    )
    assert res.status_code == 200
    assert res.json()["ok"] is True
    # old password now rejected; new one works
    bad = await client.post(
        "/auth/login",
        json={"email": "pw-change@godsview.io", "password": "original-pass-4242"},
    )
    assert bad.status_code == 401
    good = await client.post(
        "/auth/login",
        json={
            "email": "pw-change@godsview.io",
            "password": "replacement-pass-9999",
        },
    )
    assert good.status_code == 200


@pytest.mark.asyncio
async def test_preferences_default_empty_and_put(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    first = await client.get("/v1/settings/preferences", headers=h)
    assert first.status_code == 200
    assert first.json()["preferences"] == {}
    assert first.json()["updatedAt"] is None

    saved = await client.put(
        "/v1/settings/preferences",
        headers=h,
        json={"preferences": {"theme": "dark", "density": "compact"}},
    )
    assert saved.status_code == 200
    assert saved.json()["preferences"]["theme"] == "dark"
    assert saved.json()["updatedAt"] is not None

    # subsequent PUT overwrites (not merges)
    updated = await client.put(
        "/v1/settings/preferences",
        headers=h,
        json={"preferences": {"theme": "light"}},
    )
    assert updated.status_code == 200
    assert "density" not in updated.json()["preferences"]
    assert updated.json()["preferences"]["theme"] == "light"


@pytest.mark.asyncio
async def test_preferences_too_large_rejected(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    # 64KB payload >> 32KB cap
    payload = {"preferences": {"blob": "x" * (64 * 1024)}}
    res = await client.put(
        "/v1/settings/preferences",
        headers={"authorization": f"Bearer {token}"},
        json=payload,
    )
    assert res.status_code == 413
    assert res.json()["error"]["code"] == "settings.preferences_too_large"


@pytest.mark.asyncio
async def test_preferences_isolated_per_user(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    viewer_token = await _provision_viewer(
        client, admin_token, "pref-iso@godsview.io", "viewer-pass-1234567"
    )
    await client.put(
        "/v1/settings/preferences",
        headers={"authorization": f"Bearer {admin_token}"},
        json={"preferences": {"theme": "dark"}},
    )
    viewer_read = await client.get(
        "/v1/settings/preferences",
        headers={"authorization": f"Bearer {viewer_token}"},
    )
    assert viewer_read.json()["preferences"] == {}


@pytest.mark.asyncio
async def test_api_tokens_create_and_reveal(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = await client.post(
        "/v1/settings/api-tokens",
        headers=h,
        json={"name": "my-local-tool", "scopes": ["signals:read"]},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "my-local-tool"
    assert body["plaintext"].startswith("gv_sk_")
    assert body["plaintext"].split("_")[2] == body["prefix"]

    listing = await client.get("/v1/settings/api-tokens", headers=h)
    assert listing.status_code == 200
    rows = listing.json()["tokens"]
    assert len(rows) == 1
    # listing MUST NOT re-reveal the secret
    assert "plaintext" not in rows[0]


@pytest.mark.asyncio
async def test_api_tokens_reject_unknown_scope(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/v1/settings/api-tokens",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "bad", "scopes": ["root:everything"]},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "settings.token_invalid_scope"


@pytest.mark.asyncio
async def test_api_tokens_duplicate_name_conflicts(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {"name": "dup-token", "scopes": []}
    first = await client.post("/v1/settings/api-tokens", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/v1/settings/api-tokens", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "settings.token_name_exists"


@pytest.mark.asyncio
async def test_api_tokens_revoke_and_not_found(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = await client.post(
        "/v1/settings/api-tokens",
        headers=h,
        json={"name": "revoke-me", "scopes": []},
    )
    token_id = created.json()["id"]
    revoked = await client.delete(
        f"/v1/settings/api-tokens/{token_id}", headers=h
    )
    assert revoked.status_code == 200
    assert revoked.json()["revokedAt"] is not None
    again = await client.delete(
        f"/v1/settings/api-tokens/{token_id}", headers=h
    )
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "settings.token_already_revoked"
    missing = await client.delete(
        "/v1/settings/api-tokens/ak_nope", headers=h
    )
    assert missing.status_code == 404


@pytest.mark.asyncio
async def test_api_tokens_isolated_per_user(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    await _provision_viewer(
        client, admin_token, "token-iso@godsview.io", "viewer-pass-1234567"
    )
    viewer_token = await _login(
        client, "token-iso@godsview.io", "viewer-pass-1234567"
    )
    # viewer creates
    created = await client.post(
        "/v1/settings/api-tokens",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={"name": "viewer-only"},
    )
    viewer_token_id = created.json()["id"]
    # admin cannot see viewer's token via self-service listing
    admin_listing = await client.get(
        "/v1/settings/api-tokens",
        headers={"authorization": f"Bearer {admin_token}"},
    )
    assert all(r["id"] != viewer_token_id for r in admin_listing.json()["tokens"])
    # admin cannot revoke viewer's token via self-service endpoint
    cross = await client.delete(
        f"/v1/settings/api-tokens/{viewer_token_id}",
        headers={"authorization": f"Bearer {admin_token}"},
    )
    assert cross.status_code == 404
