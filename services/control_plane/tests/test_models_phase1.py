"""Smoke tests for Phase 1 ORM models.

The `engine` fixture from conftest already materializes every table via
``Base.metadata.create_all``. These tests just verify we can round-trip
a row of each new entity so nothing breaks if a future migration omits
a server default or a nullable flag.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Alert,
    AuditExport,
    Deployment,
    Incident,
    McpServer,
    Slo,
    UserPreference,
    Webhook,
)

pytestmark = pytest.mark.asyncio


async def test_webhook_roundtrip(db: AsyncSession) -> None:
    w = Webhook(
        id="whk_phase1_001",
        name="tradingview-primary",
        source="tradingview",
        secret_hash="argon2id$…",
        scopes=["market.signal.write"],
    )
    db.add(w)
    await db.commit()

    got = (await db.execute(select(Webhook).where(Webhook.id == "whk_phase1_001"))).scalar_one()
    assert got.name == "tradingview-primary"
    assert got.active is True
    assert got.scopes == ["market.signal.write"]


async def test_mcp_server_roundtrip(db: AsyncSession) -> None:
    m = McpServer(
        id="mcp_phase1_001",
        name="tradingview-mcp",
        transport="http",
        endpoint_url="https://mcp.local/tradingview",
        auth_mode="bearer",
        secret_ref="aws-sm:gv/mcp/tradingview",
        scopes=["tv.read"],
    )
    db.add(m)
    await db.commit()

    got = (await db.execute(select(McpServer).where(McpServer.name == "tradingview-mcp"))).scalar_one()
    assert got.transport == "http"
    assert got.active is True


async def test_slo_and_alert_roundtrip(db: AsyncSession) -> None:
    slo = Slo(
        id="slo_phase1_001",
        key="api.auth.availability",
        description="Auth login p95 below 300ms",
        target="99.9",
        window_seconds=2592000,
    )
    db.add(slo)
    await db.commit()

    alert = Alert(
        id="alt_phase1_001",
        slo_key="api.auth.availability",
        severity="high",
        title="Auth login p95 breach",
        description="p95=412ms over 1h window",
        runbook_url="https://runbooks.local/auth-p95",
    )
    db.add(alert)
    await db.commit()

    got_slo = (await db.execute(select(Slo).where(Slo.key == "api.auth.availability"))).scalar_one()
    got_alert = (await db.execute(select(Alert).where(Alert.id == "alt_phase1_001"))).scalar_one()
    assert got_slo.window_seconds == 2592000
    assert got_alert.status == "open"


async def test_incident_roundtrip(db: AsyncSession) -> None:
    inc = Incident(
        id="inc_phase1_001",
        code="INC-2026-0001",
        title="Control plane 5xx spike",
        severity="sev2",
        summary="Triggered by bad deploy v2.1.0-rc.3.",
    )
    db.add(inc)
    await db.commit()
    got = (await db.execute(select(Incident).where(Incident.code == "INC-2026-0001"))).scalar_one()
    assert got.status == "investigating"


async def test_deployment_roundtrip(db: AsyncSession) -> None:
    now = datetime.now(UTC)
    dep = Deployment(
        id="dep_phase1_001",
        service="control-plane",
        version="v2.1.0",
        environment="staging",
        started_at=now,
        finished_at=now + timedelta(minutes=3),
        initiator="ci",
        commit_sha="abcdef1",
    )
    db.add(dep)
    await db.commit()
    got = (await db.execute(select(Deployment).where(Deployment.id == "dep_phase1_001"))).scalar_one()
    assert got.status == "succeeded"


async def test_user_preference_roundtrip(db: AsyncSession, admin_user: dict) -> None:
    pref = UserPreference(user_id=admin_user["id"], preferences={"theme": "dark", "density": "comfy"})
    db.add(pref)
    await db.commit()
    got = (
        await db.execute(select(UserPreference).where(UserPreference.user_id == admin_user["id"]))
    ).scalar_one()
    assert got.preferences["theme"] == "dark"


async def test_audit_export_roundtrip(db: AsyncSession, admin_user: dict) -> None:
    exp = AuditExport(
        id="axp_phase1_001",
        requested_by=admin_user["id"],
        format="csv",
        filters={"action_prefix": "feature_flag."},
        status="pending",
    )
    db.add(exp)
    await db.commit()
    got = (
        await db.execute(select(AuditExport).where(AuditExport.id == "axp_phase1_001"))
    ).scalar_one()
    assert got.status == "pending"
    assert got.filters == {"action_prefix": "feature_flag."}
