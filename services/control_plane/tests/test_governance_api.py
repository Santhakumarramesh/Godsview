"""Integration tests for Phase 6 PR4 — governance routes.

Covers:

* ``GET   /v1/governance/policies``            — auto-bootstraps defaults.
* ``GET   /v1/governance/policies/{action}``   — single policy row.
* ``PATCH /v1/governance/policies/{action}``   — admin-gated; invariant check.
* ``POST  /v1/governance/approvals``           — create request under policy.
* ``POST  /v1/governance/approvals/{id}/decide`` — quorum, reject, dup, self.
* ``POST  /v1/governance/approvals/{id}/withdraw`` — requester or admin.
* ``GET   /v1/governance/anomalies``           — list + filter.
* ``POST  /v1/governance/anomalies/{id}/acknowledge`` — suppression window.
* ``POST  /v1/governance/anomalies/{id}/resolve``     — terminal state.
* ``GET   /v1/governance/trust``               — per-user registry + history.
* ``POST  /v1/governance/trust``               — admin-gated assign.

Uses the shared ``client`` / ``admin_user`` / ``db`` fixtures from
``conftest.py`` — aiosqlite in-memory so the whole suite is hermetic.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AnomalyAlertRow, User
from app.security import hash_password


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


async def _mk_user(
    db: AsyncSession,
    *,
    email: str,
    trust_tier: str,
    roles: list[str] | None = None,
    password: str = "governance-test-pw",
) -> dict[str, Any]:
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email=email,
        display_name=email.split("@", 1)[0].title(),
        password_hash=hash_password(password),
        roles=roles or ["viewer"],
        mfa_enabled=False,
        disabled=False,
        trust_tier=trust_tier,
    )
    db.add(user)
    await db.commit()
    return {"id": user.id, "email": email, "password": password}


@pytest_asyncio.fixture()
async def admin_token(
    client: AsyncClient, admin_user: dict[str, Any], db: AsyncSession
) -> str:
    # Promote the shared admin fixture to owner-tier so it can assign any
    # tier and patch any policy for the test scenarios below.
    row = await db.get(User, admin_user["id"])
    assert row is not None
    row.trust_tier = "owner"
    await db.commit()
    return await _login(client, admin_user["email"], admin_user["password"])


@pytest_asyncio.fixture()
async def operator_user(db: AsyncSession) -> dict[str, Any]:
    return await _mk_user(
        db, email="gov-operator@godsview.io", trust_tier="operator"
    )


@pytest_asyncio.fixture()
async def operator_token(
    client: AsyncClient, operator_user: dict[str, Any]
) -> str:
    return await _login(
        client, operator_user["email"], operator_user["password"]
    )


@pytest_asyncio.fixture()
async def senior_user(db: AsyncSession) -> dict[str, Any]:
    return await _mk_user(
        db,
        email="gov-senior@godsview.io",
        trust_tier="senior_operator",
    )


@pytest_asyncio.fixture()
async def senior_token(
    client: AsyncClient, senior_user: dict[str, Any]
) -> str:
    return await _login(client, senior_user["email"], senior_user["password"])


@pytest_asyncio.fixture()
async def admin_alt_user(db: AsyncSession) -> dict[str, Any]:
    """Second admin-tier account (distinct from the owner fixture)."""
    return await _mk_user(
        db,
        email="gov-admin-2@godsview.io",
        trust_tier="admin",
        roles=["admin"],
    )


@pytest_asyncio.fixture()
async def admin_alt_token(
    client: AsyncClient, admin_alt_user: dict[str, Any]
) -> str:
    return await _login(
        client, admin_alt_user["email"], admin_alt_user["password"]
    )


# ─────────────────────────────── policies ───────────────────────────────


@pytest.mark.asyncio
async def test_policies_require_auth(client: AsyncClient) -> None:
    res = await client.get("/governance/policies")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_policies_auto_bootstrap_defaults(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.get(
        "/governance/policies",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    actions = {p["action"] for p in body["policies"]}
    # Every GovernanceAction literal must have a row after bootstrap.
    for needed in (
        "live_mode_enable",
        "kill_switch_toggle",
        "strategy_promote",
        "strategy_autonomous_promote",
        "trust_tier_change",
        "approval_policy_edit",
        "data_truth_override",
    ):
        assert needed in actions
    # The bootstrap row for ``approval_policy_edit`` must be strict:
    # owner approver + 2-of-n quorum.
    pol = next(p for p in body["policies"] if p["action"] == "approval_policy_edit")
    assert pol["minApproverTier"] == "owner"
    assert pol["approverCount"] >= 2


@pytest.mark.asyncio
async def test_get_policy_single(
    client: AsyncClient, admin_token: str
) -> None:
    # Warm up bootstrap.
    await client.get(
        "/governance/policies",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    res = await client.get(
        "/governance/policies/live_mode_enable",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200
    assert res.json()["action"] == "live_mode_enable"


@pytest.mark.asyncio
async def test_patch_policy_admin_gated(
    client: AsyncClient,
    operator_token: str,
) -> None:
    res = await client.patch(
        "/governance/policies/strategy_promote",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={"ttlSeconds": 3600},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_patch_policy_enforces_tier_ordering(
    client: AsyncClient, admin_token: str
) -> None:
    # Warm up bootstrap so the row exists.
    await client.get(
        "/governance/policies",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # Approver tier < requester tier must be rejected.
    res = await client.patch(
        "/governance/policies/strategy_promote",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "minRequesterTier": "admin",
            "minApproverTier": "operator",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_policy_update"


@pytest.mark.asyncio
async def test_patch_policy_round_trip(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.patch(
        "/governance/policies/strategy_promote",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"ttlSeconds": 7200, "approverCount": 2},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ttlSeconds"] == 7200
    assert body["approverCount"] == 2


# ─────────────────────────────── approvals ──────────────────────────────


@pytest.mark.asyncio
async def test_create_approval_requires_tier(
    client: AsyncClient,
    operator_token: str,
) -> None:
    # ``trust_tier_change`` requires admin+ as requester.
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={
            "action": "trust_tier_change",
            "reason": "operator should not be allowed to request this",
        },
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "tier_too_low"


@pytest.mark.asyncio
async def test_create_approval_rejects_ungated_action(
    client: AsyncClient,
    senior_token: str,
) -> None:
    # ``kill_switch_toggle`` has requires_approval=False by default.
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "kill_switch_toggle",
            "reason": "policy should refuse this",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "action_not_gated"


@pytest.mark.asyncio
async def test_approval_full_approve_flow(
    client: AsyncClient,
    senior_token: str,
    admin_token: str,
) -> None:
    # Senior operator requests a strategy promote (requires_approval=True,
    # approver tier=senior_operator). Owner (admin_token) approves.
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "subjectKey": "strat_demo",
            "reason": "promote strat_demo from paper to assisted",
            "payload": {"fromState": "paper", "toState": "assisted_live"},
        },
    )
    assert res.status_code == 201, res.text
    approval = res.json()
    approval_id = approval["id"]
    assert approval["state"] == "pending"

    # Approve with the owner account.
    res = await client.post(
        f"/governance/approvals/{approval_id}/decide",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "approve", "comment": "LGTM"},
    )
    assert res.status_code == 200, res.text
    decided = res.json()
    assert decided["state"] == "approved"
    assert len(decided["decisions"]) == 1


@pytest.mark.asyncio
async def test_approval_self_approval_blocked(
    client: AsyncClient,
    senior_token: str,
) -> None:
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "reason": "self-approval test",
        },
    )
    assert res.status_code == 201, res.text
    approval_id = res.json()["id"]

    res = await client.post(
        f"/governance/approvals/{approval_id}/decide",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={"decision": "approve"},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "self_approval_forbidden"


@pytest.mark.asyncio
async def test_approval_duplicate_decision_blocked(
    client: AsyncClient,
    senior_token: str,
    admin_token: str,
) -> None:
    # Make it need 2 approvers so a single approve does not flip state.
    await client.patch(
        "/governance/policies/strategy_promote",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"approverCount": 2},
    )
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "reason": "dup decision test",
        },
    )
    assert res.status_code == 201, res.text
    approval_id = res.json()["id"]

    res = await client.post(
        f"/governance/approvals/{approval_id}/decide",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "abstain", "comment": "first"},
    )
    assert res.status_code == 200, res.text

    # Same approver cannot sign a second time.
    res = await client.post(
        f"/governance/approvals/{approval_id}/decide",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "approve", "comment": "second"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "duplicate_decision"


@pytest.mark.asyncio
async def test_approval_reject_is_terminal(
    client: AsyncClient,
    senior_token: str,
    admin_token: str,
) -> None:
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "reason": "reject path",
        },
    )
    approval_id = res.json()["id"]

    res = await client.post(
        f"/governance/approvals/{approval_id}/decide",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "reject", "comment": "no"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["state"] == "rejected"

    # Terminal → further decisions refused.
    res = await client.post(
        f"/governance/approvals/{approval_id}/decide",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"decision": "approve"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "approval_terminal"


@pytest.mark.asyncio
async def test_approval_withdraw_by_requester(
    client: AsyncClient,
    senior_token: str,
) -> None:
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "reason": "withdraw by requester",
        },
    )
    approval_id = res.json()["id"]

    res = await client.post(
        f"/governance/approvals/{approval_id}/withdraw",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={"reason": "changed my mind"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["state"] == "withdrawn"
    assert body["payload"].get("withdrawn_reason") == "changed my mind"


@pytest.mark.asyncio
async def test_approval_withdraw_forbidden_for_stranger(
    client: AsyncClient,
    senior_token: str,
    operator_token: str,
) -> None:
    res = await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "reason": "withdraw forbidden",
        },
    )
    approval_id = res.json()["id"]

    res = await client.post(
        f"/governance/approvals/{approval_id}/withdraw",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={"reason": "not mine to withdraw"},
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "forbidden"


@pytest.mark.asyncio
async def test_approval_list_filters(
    client: AsyncClient,
    senior_token: str,
) -> None:
    await client.post(
        "/governance/approvals",
        headers={"Authorization": f"Bearer {senior_token}"},
        json={
            "action": "strategy_promote",
            "subjectKey": "strat_alpha",
            "reason": "list filter subject",
        },
    )
    res = await client.get(
        "/governance/approvals?subjectKey=strat_alpha",
        headers={"Authorization": f"Bearer {senior_token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    for appr in body["approvals"]:
        assert appr["subjectKey"] == "strat_alpha"


# ─────────────────────────────── anomalies ──────────────────────────────


@pytest_asyncio.fixture()
async def seeded_anomaly(db: AsyncSession) -> AnomalyAlertRow:
    row = AnomalyAlertRow(
        source="drawdown_spike",
        severity="warn",
        status="open",
        subject_key="acc_demo",
        message="equity down 4% intraday",
        evidence={"equityDeltaPct": -4.1},
    )
    db.add(row)
    await db.commit()
    return row


@pytest.mark.asyncio
async def test_anomalies_list_filter_by_status(
    client: AsyncClient,
    admin_token: str,
    seeded_anomaly: AnomalyAlertRow,
) -> None:
    res = await client.get(
        "/governance/anomalies?status=open",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    ids = [a["id"] for a in body["alerts"]]
    assert seeded_anomaly.id in ids


@pytest.mark.asyncio
async def test_anomaly_acknowledge_and_suppression(
    client: AsyncClient,
    admin_token: str,
    seeded_anomaly: AnomalyAlertRow,
) -> None:
    res = await client.post(
        f"/governance/anomalies/{seeded_anomaly.id}/acknowledge",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"comment": "investigating", "suppressForSeconds": 3600},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "suppressed"  # > 300s → status=suppressed
    assert body["suppressedUntil"] is not None


@pytest.mark.asyncio
async def test_anomaly_resolve(
    client: AsyncClient,
    admin_token: str,
    seeded_anomaly: AnomalyAlertRow,
) -> None:
    res = await client.post(
        f"/governance/anomalies/{seeded_anomaly.id}/resolve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"comment": "false positive"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "resolved"

    # Second resolve is terminal-refused.
    res = await client.post(
        f"/governance/anomalies/{seeded_anomaly.id}/resolve",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"comment": "dup"},
    )
    assert res.status_code == 409


# ─────────────────────────────── trust registry ─────────────────────────


@pytest.mark.asyncio
async def test_trust_list_admin_gated_for_assign(
    client: AsyncClient,
    operator_token: str,
    senior_user: dict[str, Any],
) -> None:
    # Operator can still READ the registry.
    res = await client.get(
        "/governance/trust",
        headers={"Authorization": f"Bearer {operator_token}"},
    )
    assert res.status_code == 200
    # But WRITING requires admin role.
    res = await client.post(
        "/governance/trust",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={
            "userId": senior_user["id"],
            "tier": "admin",
            "reason": "operator cannot assign",
        },
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_trust_assign_and_history(
    client: AsyncClient,
    admin_token: str,
    senior_user: dict[str, Any],
) -> None:
    res = await client.post(
        "/governance/trust",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "userId": senior_user["id"],
            "tier": "admin",
            "reason": "promote to admin for oncall",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["currentTier"] == "admin"
    assert len(body["history"]) == 1
    assert body["history"][0]["tier"] == "admin"


@pytest.mark.asyncio
async def test_trust_cannot_exceed_actor_tier(
    client: AsyncClient,
    admin_alt_token: str,
    senior_user: dict[str, Any],
) -> None:
    # admin_alt_user is admin-tier; cannot mint owner.
    res = await client.post(
        "/governance/trust",
        headers={"Authorization": f"Bearer {admin_alt_token}"},
        json={
            "userId": senior_user["id"],
            "tier": "owner",
            "reason": "admin should not be able to mint owner",
        },
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "tier_too_low"


@pytest.mark.asyncio
async def test_trust_self_downgrade_blocked(
    client: AsyncClient,
    admin_token: str,
    admin_user: dict[str, Any],
) -> None:
    res = await client.post(
        "/governance/trust",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "userId": admin_user["id"],
            "tier": "operator",
            "reason": "accidental self-downgrade",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "self_downgrade_forbidden"


@pytest.mark.asyncio
async def test_trust_unknown_user_404(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.post(
        "/governance/trust",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={
            "userId": "usr_does_not_exist",
            "tier": "operator",
            "reason": "should 404",
        },
    )
    assert res.status_code == 404
