"""Feature-flag admin API coverage."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


async def _login(client: AsyncClient, admin_user: dict[str, Any]) -> str:
    res = await client.post(
        "/auth/login",
        json={"email": admin_user["email"], "password": admin_user["password"]},
    )
    return res.json()["accessToken"]


@pytest.mark.asyncio
async def test_flag_list_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/admin/flags")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_flag_roundtrip(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db: AsyncSession,
) -> None:
    # Seed a flag directly via ORM so the list endpoint has something to return.
    from app.models import FeatureFlag

    db.add(
        FeatureFlag(
            key="execution.kill_switch",
            enabled=True,
            description="Deterministic safety floor.",
            scope="global",
            updated_by="seed",
        )
    )
    await db.commit()

    token = await _login(client, admin_user)
    auth = {"authorization": f"Bearer {token}"}

    listing = await client.get("/admin/flags", headers=auth)
    assert listing.status_code == 200
    payload = listing.json()
    assert any(f["key"] == "execution.kill_switch" for f in payload["flags"])

    patch = await client.patch(
        "/admin/flags/execution.kill_switch",
        headers=auth,
        json={"enabled": False, "description": "Temporarily disengaged."},
    )
    assert patch.status_code == 200
    assert patch.json()["enabled"] is False
    assert patch.json()["description"] == "Temporarily disengaged."


@pytest.mark.asyncio
async def test_flag_patch_unknown_key_returns_404(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user)
    res = await client.patch(
        "/admin/flags/does.not.exist",
        headers={"authorization": f"Bearer {token}"},
        json={"enabled": True},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "not_found"
