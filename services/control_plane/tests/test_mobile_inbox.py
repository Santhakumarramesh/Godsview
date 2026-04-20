"""Integration tests for Phase 7 PR6 — mobile operator inbox.

Covers the four surfaces exposed by ``app/routes/mobile.py``:

  * ``GET /v1/mobile/inbox``           — cursor-paginated feed.
  * ``GET /v1/mobile/inbox/summary``   — header counts + throttled flag.
  * ``GET /v1/mobile/inbox/{id}``      — single projected row.
  * ``POST /v1/mobile/inbox/{id}/ack`` — append-only ack audit.

Plus the aggregator itself via ``app.mobile.inbox.build_inbox_page``.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mobile.cursor import (
    InboxCursor,
    decode_cursor,
    encode_cursor,
)
from app.mobile.dto import MobileInboxFilterDto
from app.mobile.inbox import (
    acknowledge_inbox_item,
    build_inbox_page,
    build_inbox_summary,
    fetch_inbox_item,
)
from app.models import (
    AnomalyAlertRow,
    GovernanceApprovalRow,
    KillSwitchEventRow,
    MobileInboxAckEventRow,
    RebalancePlanRow,
)

UTC = timezone.utc


# ──────────────────────────── fixtures ─────────────────────────────────


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest_asyncio.fixture()
async def admin_token(
    client: AsyncClient, admin_user: dict[str, Any]
) -> str:
    return await _login(client, admin_user["email"], admin_user["password"])


# ──────────────────────────── helpers ──────────────────────────────────


def _mk_anomaly(
    *,
    source: str = "drawdown_spike",
    severity: str = "critical",
    status: str = "open",
    subject_key: str | None = "strat_demo",
    message: str = "drawdown breached",
    detected_at: datetime | None = None,
    resolved_at: datetime | None = None,
    acknowledged_at: datetime | None = None,
) -> AnomalyAlertRow:
    return AnomalyAlertRow(
        id=f"ano_{uuid.uuid4().hex[:10]}",
        source=source,
        severity=severity,
        status=status,
        subject_key=subject_key,
        message=message,
        evidence={},
        detected_at=detected_at or datetime.now(UTC),
        resolved_at=resolved_at,
        acknowledged_at=acknowledged_at,
    )


def _mk_approval(
    *,
    action: str = "live_mode_enable",
    reason: str = "ship it",
    state: str = "pending",
    subject_key: str | None = "acct_demo",
    requested_at: datetime | None = None,
) -> GovernanceApprovalRow:
    return GovernanceApprovalRow(
        id=f"apr_{uuid.uuid4().hex[:10]}",
        action=action,
        subject_key=subject_key,
        payload={},
        reason=reason,
        state=state,
        requested_by_user_id="usr_requester",
        requested_at=requested_at or datetime.now(UTC),
    )


def _mk_killswitch(
    *,
    scope: str = "global",
    subject_key: str | None = None,
    action: str = "trip",
    trigger: str = "operator",
    reason: str = "smoke test",
    occurred_at: datetime | None = None,
) -> KillSwitchEventRow:
    return KillSwitchEventRow(
        id=f"ksw_{uuid.uuid4().hex[:10]}",
        scope=scope,
        subject_key=subject_key,
        action=action,
        trigger=trigger,
        actor_user_id=None,
        reason=reason,
        approval_id=None,
        evidence={},
        occurred_at=occurred_at or datetime.now(UTC),
    )


def _mk_rebalance_plan(
    account_id: str,
    *,
    status: str = "proposed",
    intent_count: int = 5,
    gross: float = 12000.0,
    proposed_at: datetime | None = None,
    updated_at: datetime | None = None,
    completed_at: datetime | None = None,
) -> RebalancePlanRow:
    now = datetime.now(UTC)
    return RebalancePlanRow(
        id=f"reb_{uuid.uuid4().hex[:10]}",
        account_id=account_id,
        status=status,
        trigger="scheduled",
        intent_count=intent_count,
        gross_delta_notional=gross,
        net_delta_notional=0.0,
        estimated_r=0.5,
        warnings=[],
        reason="periodic",
        proposed_at=proposed_at or now,
        updated_at=updated_at or now,
        completed_at=completed_at,
    )


async def _seed_broker_account(db: AsyncSession) -> str:
    """Seed a BrokerAccount so RebalancePlanRow FKs resolve."""
    from app.models import BrokerAccount

    account = BrokerAccount(
        id=f"acct_{uuid.uuid4().hex[:10]}",
        provider="alpaca",
        display_name=f"paper-{uuid.uuid4().hex[:6]}",
        mode="paper",
        api_key_ref="secret://alpaca/paper/key",
        api_secret_ref="secret://alpaca/paper/secret",
        base_url="https://paper-api.alpaca.markets",
        enabled=True,
    )
    db.add(account)
    await db.flush()
    return account.id


# ──────────────────────────── cursor round-trip ────────────────────────


def test_cursor_round_trip() -> None:
    cursor = InboxCursor(
        updated_at=datetime(2026, 4, 20, 9, 15, tzinfo=UTC),
        item_id="anomaly:ano_abc",
    )
    token = encode_cursor(cursor)
    parsed = decode_cursor(token)
    assert parsed.updated_at == cursor.updated_at
    assert parsed.item_id == cursor.item_id


# ──────────────────────────── aggregator ───────────────────────────────


@pytest.mark.asyncio
async def test_empty_inbox_returns_empty_page(db: AsyncSession) -> None:
    page = await build_inbox_page(db, MobileInboxFilterDto())
    assert page.items == []
    assert page.total == 0
    assert page.unread == 0
    assert page.next_cursor is None


@pytest.mark.asyncio
async def test_anomalies_and_approvals_project_into_feed(
    db: AsyncSession,
) -> None:
    db.add(_mk_anomaly(source="drawdown_spike", severity="critical"))
    db.add(_mk_approval(action="live_mode_enable"))
    await db.commit()

    page = await build_inbox_page(db, MobileInboxFilterDto())
    kinds = {it.kind for it in page.items}
    assert "anomaly" in kinds
    assert "approval" in kinds
    assert page.unread >= 2


@pytest.mark.asyncio
async def test_broker_outage_source_maps_to_dedicated_kind(
    db: AsyncSession,
) -> None:
    db.add(
        _mk_anomaly(
            source="broker_outage",
            severity="critical",
            message="broker primary offline",
        )
    )
    db.add(
        _mk_anomaly(
            source="venue_latency_breach",
            severity="warn",
            message="p99 breach",
        )
    )
    await db.commit()

    page = await build_inbox_page(db, MobileInboxFilterDto())
    kinds = {it.kind for it in page.items}
    assert "broker_outage" in kinds
    assert "venue_outage" in kinds


@pytest.mark.asyncio
async def test_kill_switch_only_active_trip_projects(
    db: AsyncSession,
) -> None:
    now = datetime.now(UTC)
    # Older trip + newer reset → resolved, should NOT appear.
    db.add(
        _mk_killswitch(
            scope="strategy",
            subject_key="strat_old",
            action="trip",
            occurred_at=now - timedelta(hours=2),
        )
    )
    db.add(
        _mk_killswitch(
            scope="strategy",
            subject_key="strat_old",
            action="reset",
            occurred_at=now - timedelta(hours=1),
        )
    )
    # Single active trip.
    db.add(
        _mk_killswitch(
            scope="global",
            subject_key=None,
            action="trip",
            occurred_at=now,
        )
    )
    await db.commit()

    page = await build_inbox_page(db, MobileInboxFilterDto())
    ks_items = [it for it in page.items if it.kind == "kill_switch"]
    assert len(ks_items) == 1
    assert ks_items[0].severity == "critical"


@pytest.mark.asyncio
async def test_rebalance_plans_project_with_status(
    db: AsyncSession,
) -> None:
    account_id = await _seed_broker_account(db)
    db.add(
        _mk_rebalance_plan(
            account_id=account_id, status="proposed", intent_count=3
        )
    )
    db.add(
        _mk_rebalance_plan(
            account_id=account_id, status="approved", intent_count=5
        )
    )
    await db.commit()

    page = await build_inbox_page(db, MobileInboxFilterDto())
    rb_items = [it for it in page.items if it.kind == "rebalance"]
    assert len(rb_items) == 2
    statuses = {tuple(it.badges)[0] for it in rb_items}
    assert statuses == {"proposed", "approved"}


@pytest.mark.asyncio
async def test_filter_by_kind_only_returns_matching(
    db: AsyncSession,
) -> None:
    db.add(_mk_anomaly())
    db.add(_mk_approval())
    await db.commit()

    page = await build_inbox_page(
        db, MobileInboxFilterDto(kind="approval")
    )
    assert all(it.kind == "approval" for it in page.items)
    assert len(page.items) == 1


@pytest.mark.asyncio
async def test_filter_by_severity(db: AsyncSession) -> None:
    db.add(_mk_anomaly(severity="critical"))
    db.add(_mk_anomaly(severity="warn"))
    await db.commit()

    page = await build_inbox_page(
        db, MobileInboxFilterDto(severity="critical")
    )
    assert all(it.severity == "critical" for it in page.items)
    assert len(page.items) == 1


@pytest.mark.asyncio
async def test_resolved_anomaly_becomes_resolved_projection(
    db: AsyncSession,
) -> None:
    resolved_at = datetime.now(UTC)
    db.add(
        _mk_anomaly(
            status="acknowledged",
            resolved_at=resolved_at,
        )
    )
    await db.commit()

    page = await build_inbox_page(db, MobileInboxFilterDto())
    assert any(it.status == "resolved" for it in page.items)


@pytest.mark.asyncio
async def test_pagination_cursor_advances_page(
    db: AsyncSession,
) -> None:
    now = datetime.now(UTC)
    for i in range(4):
        db.add(
            _mk_anomaly(
                source="drawdown_spike",
                severity="warn",
                message=f"msg-{i}",
                detected_at=now - timedelta(minutes=i),
            )
        )
    await db.commit()

    first = await build_inbox_page(
        db, MobileInboxFilterDto(limit=2)
    )
    assert len(first.items) == 2
    assert first.next_cursor is not None

    second = await build_inbox_page(
        db,
        MobileInboxFilterDto(limit=2, cursor=first.next_cursor),
    )
    assert len(second.items) == 2
    # The two pages should not overlap.
    first_ids = {it.id for it in first.items}
    second_ids = {it.id for it in second.items}
    assert first_ids.isdisjoint(second_ids)


# ──────────────────────────── acknowledgement ──────────────────────────


@pytest.mark.asyncio
async def test_ack_inbox_item_appends_event_and_flips_status(
    db: AsyncSession, admin_user: dict[str, Any]
) -> None:
    anomaly = _mk_anomaly()
    db.add(anomaly)
    await db.commit()

    item_id = f"anomaly:{anomaly.id}"
    result = await acknowledge_inbox_item(
        db,
        item_id=item_id,
        user_id=admin_user["id"],
        note="seen on mobile",
    )
    await db.commit()

    assert result.status == "acknowledged"
    assert result.acknowledged_at is not None

    rows = (
        await db.execute(
            select(MobileInboxAckEventRow).where(
                MobileInboxAckEventRow.inbox_item_id == item_id
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].note == "seen on mobile"
    assert rows[0].user_id == admin_user["id"]


@pytest.mark.asyncio
async def test_ack_resolved_item_rejected(
    db: AsyncSession, admin_user: dict[str, Any]
) -> None:
    from app.errors import ApiError

    resolved_at = datetime.now(UTC)
    anomaly = _mk_anomaly(status="acknowledged", resolved_at=resolved_at)
    db.add(anomaly)
    await db.commit()

    with pytest.raises(ApiError) as exc:
        await acknowledge_inbox_item(
            db,
            item_id=f"anomaly:{anomaly.id}",
            user_id=admin_user["id"],
            note=None,
        )
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_fetch_inbox_item_404_on_unknown_id(
    db: AsyncSession,
) -> None:
    from app.errors import ApiError

    with pytest.raises(ApiError) as exc:
        await fetch_inbox_item(db, "anomaly:does-not-exist")
    assert exc.value.status_code == 404


# ──────────────────────────── summary card ─────────────────────────────


@pytest.mark.asyncio
async def test_summary_counts_by_severity(db: AsyncSession) -> None:
    db.add(_mk_anomaly(severity="critical"))
    db.add(_mk_anomaly(severity="warn"))
    db.add(_mk_anomaly(severity="warn"))
    db.add(_mk_approval())
    await db.commit()

    summary = await build_inbox_summary(db)
    assert summary.open >= 3
    assert summary.critical >= 1
    assert summary.warn >= 2
    assert summary.throttled is False


# ──────────────────────────── HTTP routes ──────────────────────────────


@pytest.mark.asyncio
async def test_inbox_route_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/mobile/inbox")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_inbox_list_route_returns_projection(
    client: AsyncClient,
    db: AsyncSession,
    admin_token: str,
) -> None:
    db.add(_mk_anomaly(severity="critical"))
    db.add(_mk_approval())
    await db.commit()

    res = await client.get(
        "/mobile/inbox",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    kinds = {it["kind"] for it in body["items"]}
    assert "approval" in kinds or "anomaly" in kinds
    assert body["unread"] >= 1
    assert "observedAt" in body


@pytest.mark.asyncio
async def test_inbox_summary_route_returns_counts(
    client: AsyncClient,
    db: AsyncSession,
    admin_token: str,
) -> None:
    db.add(_mk_anomaly(severity="critical"))
    await db.commit()

    res = await client.get(
        "/mobile/inbox/summary",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["open"] >= 1
    assert body["critical"] >= 1
    assert body["throttled"] is False


@pytest.mark.asyncio
async def test_inbox_ack_route_writes_audit(
    client: AsyncClient,
    db: AsyncSession,
    admin_token: str,
) -> None:
    anomaly = _mk_anomaly()
    db.add(anomaly)
    await db.commit()

    item_id = f"anomaly:{anomaly.id}"
    res = await client.post(
        f"/mobile/inbox/{item_id}/ack",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"note": "ack'd from phone"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "acknowledged"
    assert body["acknowledgedAt"] is not None

    rows = (
        await db.execute(
            select(MobileInboxAckEventRow).where(
                MobileInboxAckEventRow.inbox_item_id == item_id
            )
        )
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].note == "ack'd from phone"


@pytest.mark.asyncio
async def test_inbox_item_route_returns_single(
    client: AsyncClient,
    db: AsyncSession,
    admin_token: str,
) -> None:
    anomaly = _mk_anomaly()
    db.add(anomaly)
    await db.commit()

    item_id = f"anomaly:{anomaly.id}"
    res = await client.get(
        f"/mobile/inbox/{item_id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == item_id
    assert body["kind"] == "anomaly"


@pytest.mark.asyncio
async def test_inbox_item_route_404_on_unknown(
    client: AsyncClient,
    admin_token: str,
) -> None:
    res = await client.get(
        "/mobile/inbox/anomaly:nope",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404


@pytest.mark.asyncio
async def test_inbox_bad_cursor_returns_400(
    client: AsyncClient,
    admin_token: str,
) -> None:
    res = await client.get(
        "/mobile/inbox?cursor=not-a-valid-cursor",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400
