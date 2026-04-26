"""Admin /admin/users CRUD contract tests."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest.mark.asyncio
async def test_admin_can_create_and_list_users(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}

    create = await client.post(
        "/admin/users",
        headers=h,
        json={
            "email": "analyst@godsview.io",
            "displayName": "New Analyst",
            "password": "correct-horse-battery-staple",
            "roles": ["analyst"],
        },
    )
    assert create.status_code == 201, create.text
    body = create.json()
    assert body["email"] == "analyst@godsview.io"
    assert body["roles"] == ["analyst"]
    assert body["disabled"] is False

    listing = await client.get("/admin/users", headers=h)
    assert listing.status_code == 200
    emails = {u["email"] for u in listing.json()["users"]}
    assert emails == {admin_user["email"], "analyst@godsview.io"}


@pytest.mark.asyncio
async def test_non_admin_cannot_create_user(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    # provision a non-admin via the admin path so we can log in as them
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer@godsview.io",
            "displayName": "Peep Only",
            "password": "viewer-password-4242",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(client, "viewer@godsview.io", "viewer-password-4242")
    res = await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={
            "email": "escalated@godsview.io",
            "displayName": "Nope",
            "password": "should-not-work-999",
            "roles": ["admin"],
        },
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_create_user_duplicate_email_conflicts(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {
        "email": "dup@godsview.io",
        "displayName": "First",
        "password": "first-password-9999",
        "roles": ["viewer"],
    }
    first = await client.post("/admin/users", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/admin/users", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "users.email_exists"


@pytest.mark.asyncio
async def test_patch_user_roles_and_audit(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = (
        await client.post(
            "/admin/users",
            headers=h,
            json={
                "email": "promote@godsview.io",
                "displayName": "Promote Me",
                "password": "before-promotion-4242",
                "roles": ["analyst"],
            },
        )
    ).json()
    patched = await client.patch(
        f"/admin/users/{created['id']}",
        headers=h,
        json={"roles": ["operator"], "displayName": "Promoted"},
    )
    assert patched.status_code == 200
    body = patched.json()
    assert body["roles"] == ["operator"]
    assert body["displayName"] == "Promoted"


@pytest.mark.asyncio
async def test_patch_rejects_unknown_role(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = (
        await client.post(
            "/admin/users",
            headers=h,
            json={
                "email": "role@godsview.io",
                "displayName": "Role Tester",
                "password": "role-tester-password-42",
                "roles": ["analyst"],
            },
        )
    ).json()
    bad = await client.patch(
        f"/admin/users/{created['id']}",
        headers=h,
        json={"roles": ["god"]},
    )
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "users.invalid_role"


@pytest.mark.asyncio
async def test_deactivate_user_and_self_deactivate_rejected(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    # other user
    created = (
        await client.post(
            "/admin/users",
            headers=h,
            json={
                "email": "kickme@godsview.io",
                "displayName": "Disable Me",
                "password": "hello-world-goodbye",
                "roles": ["viewer"],
            },
        )
    ).json()
    deactivated = await client.delete(f"/admin/users/{created['id']}", headers=h)
    assert deactivated.status_code == 200
    assert deactivated.json()["disabled"] is True

    # cannot self-deactivate
    self_kick = await client.delete(f"/admin/users/{admin_user['id']}", headers=h)
    assert self_kick.status_code == 409
    assert self_kick.json()["error"]["code"] == "users.cannot_self_deactivate"


@pytest.mark.asyncio
async def test_update_nonexistent_user_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        "/admin/users/usr_doesnotexist",
        headers={"authorization": f"Bearer {token}"},
        json={"displayName": "X"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "users.not_found"
