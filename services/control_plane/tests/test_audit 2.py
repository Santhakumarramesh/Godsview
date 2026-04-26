"""/admin/audit/events + /admin/audit/exports contract tests.

Every prior PR already emits audit_log rows on mutation — this suite
walks through those rows via the new read surface.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


async def _seed_users(client: AsyncClient, admin_token: str, n: int) -> None:
    h = {"authorization": f"Bearer {admin_token}"}
    for i in range(n):
        r = await client.post(
            "/admin/users",
            headers=h,
            json={
                "email": f"seed{i}@godsview.io",
                "displayName": f"Seed {i}",
                "password": "seed-password-4242",
                "roles": ["viewer"],
            },
        )
        assert r.status_code == 201


@pytest.mark.asyncio
async def test_events_pagination_and_total(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}

    await _seed_users(client, token, 5)

    page1 = await client.get("/admin/audit/events?limit=3", headers=h)
    assert page1.status_code == 200
    body = page1.json()
    assert body["total"] >= 5  # one user.create row per seed
    assert len(body["events"]) == 3
    assert body["nextCursor"] is not None

    page2 = await client.get(
        f"/admin/audit/events?limit=3&beforeId={body['nextCursor']}", headers=h
    )
    assert page2.status_code == 200
    assert len(page2.json()["events"]) >= 1
    # no overlap across pages
    page1_ids = {e["id"] for e in body["events"]}
    page2_ids = {e["id"] for e in page2.json()["events"]}
    assert page1_ids.isdisjoint(page2_ids)


@pytest.mark.asyncio
async def test_events_filter_by_action(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    await _seed_users(client, token, 2)

    # also create + revoke an API key so there are non-user.create rows
    created = await client.post(
        "/admin/api-keys",
        headers=h,
        json={"name": "audit-hits", "scopes": ["ops:read"]},
    )
    assert created.status_code == 201

    user_rows = await client.get(
        "/admin/audit/events?action=user.create", headers=h
    )
    assert user_rows.status_code == 200
    assert user_rows.json()["total"] >= 2
    assert all(e["action"] == "user.create" for e in user_rows.json()["events"])

    ak_rows = await client.get(
        "/admin/audit/events?action=api_key.create", headers=h
    )
    assert ak_rows.json()["total"] == 1


@pytest.mark.asyncio
async def test_events_cursor_not_found(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/admin/audit/events?beforeId=aud_nope",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "audit.cursor_not_found"


@pytest.mark.asyncio
async def test_export_create_and_fetch(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    await _seed_users(client, token, 3)

    created = await client.post(
        "/admin/audit/exports",
        headers=h,
        json={"format": "csv", "filters": {"action": "user.create"}},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["format"] == "csv"
    assert body["status"] == "ready"
    assert body["rowCount"] >= 3
    assert body["artifactKey"].startswith("s3://gv-audit-exports/")
    assert body["downloadUrl"]
    assert "sig=" in body["downloadUrl"]

    fetched = await client.get(f"/admin/audit/exports/{body['id']}", headers=h)
    assert fetched.status_code == 200
    assert fetched.json()["id"] == body["id"]

    listing = await client.get("/admin/audit/exports", headers=h)
    assert listing.status_code == 200
    assert any(e["id"] == body["id"] for e in listing.json()["exports"])


@pytest.mark.asyncio
async def test_export_rejects_unknown_format(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/audit/exports",
        headers={"authorization": f"Bearer {token}"},
        json={"format": "parquet"},
    )
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_export_not_found(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/admin/audit/exports/auex_missing",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "audit_export.not_found"


@pytest.mark.asyncio
async def test_non_admin_forbidden(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer-audit@godsview.io",
            "displayName": "Peep",
            "password": "viewer-pass-1234567",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer-audit@godsview.io", "viewer-pass-1234567"
    )
    res = await client.get(
        "/admin/audit/events",
        headers={"authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403
