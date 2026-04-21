"""/admin/mcp registry contract tests."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest.mark.asyncio
async def test_create_http_server_requires_endpoint(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/mcp",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "alpaca", "transport": "http"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "mcp.endpoint_required"


@pytest.mark.asyncio
async def test_create_stdio_server_requires_command(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/mcp",
        headers={"authorization": f"Bearer {token}"},
        json={"name": "local-tool", "transport": "stdio"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "mcp.command_required"


@pytest.mark.asyncio
async def test_create_and_list_http_server(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = await client.post(
        "/admin/mcp",
        headers=h,
        json={
            "name": "alpaca-mcp",
            "transport": "http",
            "endpointUrl": "https://mcp.example.com/alpaca",
            "authMode": "bearer",
            "secretRef": "aws-sm://gv/mcp/alpaca",
            "scopes": ["read:tools"],
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["name"] == "alpaca-mcp"
    assert body["transport"] == "http"
    assert body["authMode"] == "bearer"
    assert body["endpointUrl"].startswith("https://mcp.example.com/alpaca")

    listing = await client.get("/admin/mcp", headers=h)
    assert listing.status_code == 200
    assert listing.json()["total"] == 1


@pytest.mark.asyncio
async def test_invalid_transport_and_auth_mode(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    bad_t = await client.post(
        "/admin/mcp",
        headers=h,
        json={"name": "x", "transport": "carrier-pigeon"},
    )
    assert bad_t.status_code == 422
    assert bad_t.json()["error"]["code"] == "mcp.invalid_transport"

    bad_auth = await client.post(
        "/admin/mcp",
        headers=h,
        json={
            "name": "y",
            "transport": "http",
            "endpointUrl": "https://mcp.example.com/y",
            "authMode": "secret-handshake",
        },
    )
    assert bad_auth.status_code == 422
    assert bad_auth.json()["error"]["code"] == "mcp.invalid_auth_mode"


@pytest.mark.asyncio
async def test_duplicate_name_conflicts(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {
        "name": "dup-mcp",
        "transport": "http",
        "endpointUrl": "https://mcp.example.com/dup",
    }
    first = await client.post("/admin/mcp", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/admin/mcp", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "mcp.name_exists"


@pytest.mark.asyncio
async def test_patch_and_deactivate(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = (
        await client.post(
            "/admin/mcp",
            headers=h,
            json={
                "name": "stdio-tool",
                "transport": "stdio",
                "command": "/usr/local/bin/godsview-mcp",
            },
        )
    ).json()

    patched = await client.patch(
        f"/admin/mcp/{created['id']}",
        headers=h,
        json={"scopes": ["read:tools", "ops:read"], "name": "stdio-tool-renamed"},
    )
    assert patched.status_code == 200
    assert patched.json()["scopes"] == ["read:tools", "ops:read"]
    assert patched.json()["name"] == "stdio-tool-renamed"

    deact = await client.delete(f"/admin/mcp/{created['id']}", headers=h)
    assert deact.status_code == 200
    assert deact.json()["active"] is False


@pytest.mark.asyncio
async def test_unknown_id_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    res = await client.patch(
        "/admin/mcp/mcp_nope", headers=h, json={"active": False}
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "mcp.not_found"


@pytest.mark.asyncio
async def test_non_admin_forbidden(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer-mcp@godsview.io",
            "displayName": "Peep",
            "password": "viewer-pass-1234567",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer-mcp@godsview.io", "viewer-pass-1234567"
    )
    res = await client.post(
        "/admin/mcp",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={"name": "x", "transport": "stdio", "command": "/bin/true"},
    )
    assert res.status_code == 403
