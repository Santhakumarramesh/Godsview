"""/admin/ops SLOs + alerts + incidents + deployments + latency + logs.

Covers the six sub-surfaces the dashboard hits after login. Every write
path is also audit-logged — coverage of that invariant lives in
test_audit.py.
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post("/auth/login", json={"email": email, "password": password})
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


async def _promote_operator(
    client: AsyncClient, admin_token: str, email: str, password: str
) -> str:
    h = {"authorization": f"Bearer {admin_token}"}
    r = await client.post(
        "/admin/users",
        headers=h,
        json={
            "email": email,
            "displayName": "Ops Person",
            "password": password,
            "roles": ["operator"],
        },
    )
    assert r.status_code == 201, r.text
    return await _login(client, email, password)


# ─────────────────────────────────────────────────────────────────────
# SLOs
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_slo_create_list_patch(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}

    created = await client.post(
        "/admin/ops/slos",
        headers=h,
        json={
            "key": "api.availability",
            "description": "Control plane uptime",
            "target": "99.9",
            "windowSeconds": 2592000,
            "ownerTeam": "platform",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["key"] == "api.availability"
    assert body["windowSeconds"] == 2592000

    listing = await client.get("/admin/ops/slos", headers=h)
    assert listing.status_code == 200
    assert listing.json()["total"] == 1

    patched = await client.patch(
        f"/admin/ops/slos/{body['id']}",
        headers=h,
        json={"target": "99.95", "description": "tightened"},
    )
    assert patched.status_code == 200
    assert patched.json()["target"] == "99.95"
    assert patched.json()["description"] == "tightened"


@pytest.mark.asyncio
async def test_slo_duplicate_key_conflicts(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {
        "key": "dup.slo",
        "target": "99.0",
        "windowSeconds": 3600,
    }
    first = await client.post("/admin/ops/slos", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/admin/ops/slos", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "ops.slo.key_exists"


@pytest.mark.asyncio
async def test_slo_patch_unknown_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        "/admin/ops/slos/slo_nope",
        headers={"authorization": f"Bearer {token}"},
        json={"target": "99.0"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "ops.slo.not_found"


# ─────────────────────────────────────────────────────────────────────
# Alerts
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_alert_create_ack_resolve(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = await client.post(
        "/admin/ops/alerts",
        headers=h,
        json={
            "severity": "high",
            "title": "api p95 > 300ms",
            "description": "burn rate triggered",
            "sloKey": "api.availability",
        },
    )
    assert created.status_code == 201, created.text
    alert = created.json()
    assert alert["status"] == "open"
    assert alert["severity"] == "high"

    ack = await client.post(
        f"/admin/ops/alerts/{alert['id']}/acknowledge", headers=h
    )
    assert ack.status_code == 200
    assert ack.json()["status"] == "acknowledged"
    assert ack.json()["acknowledgedBy"] is not None

    # cannot ack again — it's not 'open'
    ack_twice = await client.post(
        f"/admin/ops/alerts/{alert['id']}/acknowledge", headers=h
    )
    assert ack_twice.status_code == 409
    assert ack_twice.json()["error"]["code"] == "ops.alert.invalid_transition"

    resolved = await client.post(
        f"/admin/ops/alerts/{alert['id']}/resolve", headers=h
    )
    assert resolved.status_code == 200
    assert resolved.json()["status"] == "resolved"

    again = await client.post(
        f"/admin/ops/alerts/{alert['id']}/resolve", headers=h
    )
    assert again.status_code == 409


@pytest.mark.asyncio
async def test_alert_invalid_severity(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/ops/alerts",
        headers={"authorization": f"Bearer {token}"},
        json={"severity": "spicy", "title": "x"},
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "ops.alert.invalid_severity"


@pytest.mark.asyncio
async def test_alert_list_filters(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    await client.post(
        "/admin/ops/alerts",
        headers=h,
        json={"severity": "low", "title": "noise"},
    )
    await client.post(
        "/admin/ops/alerts",
        headers=h,
        json={"severity": "critical", "title": "page"},
    )
    high_only = await client.get(
        "/admin/ops/alerts?severity=critical", headers=h
    )
    assert high_only.status_code == 200
    assert all(a["severity"] == "critical" for a in high_only.json()["alerts"])

    bad = await client.get("/admin/ops/alerts?status=nowhere", headers=h)
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "ops.alert.invalid_status"


@pytest.mark.asyncio
async def test_alert_ack_unknown_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/ops/alerts/alr_nope/acknowledge",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "ops.alert.not_found"


# ─────────────────────────────────────────────────────────────────────
# Incidents
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_incident_create_and_transition(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = await client.post(
        "/admin/ops/incidents",
        headers=h,
        json={
            "code": "INC-001",
            "title": "trading halt investigation",
            "severity": "high",
            "summary": "broker returned 5xx spike",
        },
    )
    assert created.status_code == 201, created.text
    inc = created.json()
    assert inc["status"] == "investigating"

    moved = await client.patch(
        f"/admin/ops/incidents/{inc['id']}",
        headers=h,
        json={"status": "resolved", "postmortemUrl": "https://notion/pm/1"},
    )
    assert moved.status_code == 200
    assert moved.json()["status"] == "resolved"
    assert moved.json()["resolvedAt"] is not None

    listing = await client.get("/admin/ops/incidents", headers=h)
    assert listing.status_code == 200
    assert listing.json()["total"] == 1


@pytest.mark.asyncio
async def test_incident_code_conflict_and_bad_status(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    payload = {"code": "INC-DUP", "title": "a", "severity": "medium"}
    first = await client.post("/admin/ops/incidents", headers=h, json=payload)
    assert first.status_code == 201
    second = await client.post("/admin/ops/incidents", headers=h, json=payload)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "ops.incident.code_exists"

    bad_status = await client.patch(
        f"/admin/ops/incidents/{first.json()['id']}",
        headers=h,
        json={"status": "whatever"},
    )
    assert bad_status.status_code == 422
    assert bad_status.json()["error"]["code"] == "ops.incident.invalid_status"


# ─────────────────────────────────────────────────────────────────────
# Deployments
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_deployment_create_and_list(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    created = await client.post(
        "/admin/ops/deployments",
        headers=h,
        json={
            "service": "control_plane",
            "version": "v2.1.0",
            "environment": "staging",
            "status": "succeeded",
            "commitSha": "abc1234",
        },
    )
    assert created.status_code == 201, created.text
    dep = created.json()
    assert dep["environment"] == "staging"
    assert dep["status"] == "succeeded"
    assert dep["finishedAt"] is not None

    listing = await client.get(
        "/admin/ops/deployments?service=control_plane", headers=h
    )
    assert listing.status_code == 200
    assert listing.json()["total"] == 1


@pytest.mark.asyncio
async def test_deployment_invalid_environment(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/admin/ops/deployments",
        headers={"authorization": f"Bearer {token}"},
        json={
            "service": "api",
            "version": "v1",
            "environment": "mars",
        },
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "ops.deployment.invalid_environment"


# ─────────────────────────────────────────────────────────────────────
# Latency (synthetic, deterministic)
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_latency_deterministic(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}
    first = await client.get(
        "/admin/ops/latency?service=control_plane&operation=auth.login"
        "&windowSeconds=3600&buckets=12",
        headers=h,
    )
    assert first.status_code == 200
    body = first.json()
    assert body["service"] == "control_plane"
    assert body["operation"] == "auth.login"
    assert len(body["buckets"]) == 12
    assert all(b["p95Ms"] >= b["p50Ms"] for b in body["buckets"])

    second = await client.get(
        "/admin/ops/latency?service=control_plane&operation=auth.login"
        "&windowSeconds=3600&buckets=12",
        headers=h,
    )
    p50s_first = [b["p50Ms"] for b in body["buckets"]]
    p50s_second = [b["p50Ms"] for b in second.json()["buckets"]]
    assert p50s_first == p50s_second  # deterministic by (service, operation)


# ─────────────────────────────────────────────────────────────────────
# Logs (audit tail)
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_logs_tail_audit(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    h = {"authorization": f"Bearer {token}"}

    # generate a handful of audit rows
    await client.post(
        "/admin/ops/slos",
        headers=h,
        json={
            "key": "ops.log.test",
            "target": "99.0",
            "windowSeconds": 3600,
        },
    )
    await client.post(
        "/admin/ops/alerts",
        headers=h,
        json={"severity": "low", "title": "log-test alert"},
    )

    tail = await client.get("/admin/ops/logs?limit=50", headers=h)
    assert tail.status_code == 200
    body = tail.json()
    assert body["total"] >= 2
    assert all(line["level"] in {"debug", "info", "warning", "error"} for line in body["lines"])

    info_only = await client.get(
        "/admin/ops/logs?limit=50&level=info", headers=h
    )
    assert info_only.status_code == 200
    assert all(line["level"] == "info" for line in info_only.json()["lines"])

    bad = await client.get("/admin/ops/logs?level=shouting", headers=h)
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "ops.logs.invalid_level"


# ─────────────────────────────────────────────────────────────────────
# Role guards
# ─────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_operator_can_create_alert_but_not_slo(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    operator_token = await _promote_operator(
        client, admin_token, "ops-ops@godsview.io", "operator-pass-12345"
    )
    h = {"authorization": f"Bearer {operator_token}"}

    slo = await client.post(
        "/admin/ops/slos",
        headers=h,
        json={"key": "ops.should.fail", "target": "99.0", "windowSeconds": 3600},
    )
    assert slo.status_code == 403

    alert = await client.post(
        "/admin/ops/alerts",
        headers=h,
        json={"severity": "medium", "title": "op-created"},
    )
    assert alert.status_code == 201


@pytest.mark.asyncio
async def test_viewer_fully_forbidden(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(client, admin_user["email"], admin_user["password"])
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer-ops@godsview.io",
            "displayName": "Peep",
            "password": "viewer-pass-1234567",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer-ops@godsview.io", "viewer-pass-1234567"
    )
    h = {"authorization": f"Bearer {viewer_token}"}

    assert (await client.get("/admin/ops/slos", headers=h)).status_code == 403
    assert (await client.get("/admin/ops/alerts", headers=h)).status_code == 403
    assert (
        await client.get("/admin/ops/incidents", headers=h)
    ).status_code == 403
    assert (
        await client.get("/admin/ops/deployments", headers=h)
    ).status_code == 403
    assert (
        await client.get(
            "/admin/ops/latency?service=cp&operation=x", headers=h
        )
    ).status_code == 403
    assert (await client.get("/admin/ops/logs", headers=h)).status_code == 403
