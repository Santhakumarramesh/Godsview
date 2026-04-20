"""Integration tests for Phase 4 PR6 — /v1/live-trades surface.

Covers:

* ``GET    /v1/live-trades``                — list, filters, pagination
* ``GET    /v1/live-trades/{id}``           — detail + 404
* ``POST   /v1/live-trades/{id}/cancel``    — admin-only broker cancel +
  503 on broker outage + 409 when already terminal
* ``PATCH  /v1/live-trades/{id}/status``    — admin-only lifecycle FSM
  with closure + recall hook on terminal transitions

Tests re-use the shared :class:`FakeAdapter` pattern from PR5 so the
broker cancel path can be poked with ``next_cancel_raises``.
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

from app.broker import FakeAdapter, broker_registry
from app.broker.base import BrokerUnavailable
from app.models import (
    AuditEvent,
    BrokerAccount,
    LiveTrade,
    Setup,
    Symbol,
    User,
)
from app.security import hash_password

UTC = timezone.utc

ACCOUNT_ID = "acc_live_pr6"
OTHER_ACCOUNT_ID = "acc_live_pr6_other"


# ─────────────────────────── helpers ──────────────────────────────


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


def _ticker_id() -> str:
    return f"sym_{uuid.uuid4().hex}"


def _seed_setup(*, symbol_id: str) -> Setup:
    detected = datetime.now(UTC) - timedelta(seconds=5)
    return Setup(
        id=f"stp_{uuid.uuid4().hex}",
        symbol_id=symbol_id,
        tf="5m",
        type="ob_retest",
        direction="long",
        status="approved_live",
        detected_at=detected,
        expires_at=detected + timedelta(minutes=30),
        entry_low=99.9,
        entry_high=100.1,
        entry_ref=100.0,
        stop_loss=99.5,
        take_profit=101.5,
        rr=3.0,
        confidence_score=0.75,
        structure_score=0.7,
        order_flow_score=0.6,
        regime_score=0.5,
        session_score=0.5,
        history_score=0.5,
        history_count=0,
        reasoning="seeded for PR6 live-trades tests",
        structure_event_ids=[],
        order_flow_event_ids=[],
    )


def _seed_live_trade(
    *,
    setup_id: str,
    symbol_id: str,
    account_id: str = ACCOUNT_ID,
    status_: str = "submitted",
    qty: float = 1000.0,
    approved_by: str = "usr_placeholder",
    approved_at: datetime | None = None,
    direction: str = "long",
) -> LiveTrade:
    now = approved_at or datetime.now(UTC)
    return LiveTrade(
        setup_id=setup_id,
        symbol_id=symbol_id,
        account_id=account_id,
        direction=direction,
        entry_ref=100.0,
        stop_loss=99.5,
        take_profit=101.5,
        size_multiplier=1.0,
        qty=qty,
        status=status_,
        client_order_id=f"gv_{setup_id}_{int(now.timestamp() * 1000)}",
        broker_order_id=f"brk_{uuid.uuid4().hex[:12]}",
        approved_by_user_id=approved_by,
        approved_at=now,
        submitted_at=now if status_ != "pending_submit" else None,
    )


# ─────────────────────────── fixtures ─────────────────────────────


@pytest_asyncio.fixture()
async def admin_token(client: AsyncClient, admin_user: dict[str, Any]) -> str:
    return await _login(client, admin_user["email"], admin_user["password"])


@pytest_asyncio.fixture()
async def viewer_token(client: AsyncClient, db: AsyncSession) -> str:
    password = "viewer-pr6-pw"
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer-pr6@godsview.io",
        display_name="Live Trades Viewer",
        password_hash=hash_password(password),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(user)
    await db.commit()
    return await _login(client, user.email, password)


@pytest_asyncio.fixture()
async def seeded_symbol(db: AsyncSession) -> Symbol:
    sym = Symbol(
        id=_ticker_id(),
        ticker="AAPL",
        exchange="NASDAQ",
        asset_class="equity",
        display_name="Apple Inc.",
        tick_size=0.01,
        lot_size=1.0,
        quote_currency="USD",
        session_tz="America/New_York",
        active=True,
    )
    db.add(sym)
    await db.commit()
    await db.refresh(sym)
    return sym


@pytest_asyncio.fixture()
async def broker_account(db: AsyncSession) -> BrokerAccount:
    row = BrokerAccount(
        id=ACCOUNT_ID,
        provider="alpaca",
        display_name="Live PR6",
        mode="paper",
        api_key_ref="secret://paper/key",
        api_secret_ref="secret://paper/secret",
        base_url="https://paper-api.alpaca.markets",
        enabled=True,
    )
    db.add(row)
    await db.commit()
    return row


@pytest.fixture()
def registered_adapter():
    broker_registry.clear()
    adapter = FakeAdapter(account_id=ACCOUNT_ID, mode="paper")
    broker_registry.register(ACCOUNT_ID, adapter)
    yield adapter
    broker_registry.clear()


# ────────────────────── GET /v1/live-trades ───────────────────────


@pytest.mark.asyncio
async def test_list_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/live-trades")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_list_returns_empty_for_fresh_db(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.get(
        "/live-trades",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["trades"] == []
    assert body["total"] == 0
    assert body["offset"] == 0
    assert body["limit"] == 100


@pytest.mark.asyncio
async def test_list_returns_rows_ordered_by_approved_at_desc(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    now = datetime.now(UTC)
    s1 = _seed_setup(symbol_id=seeded_symbol.id)
    s2 = _seed_setup(symbol_id=seeded_symbol.id)
    s3 = _seed_setup(symbol_id=seeded_symbol.id)
    db.add_all([s1, s2, s3])
    await db.flush()
    db.add_all([
        _seed_live_trade(
            setup_id=s1.id,
            symbol_id=seeded_symbol.id,
            approved_by=admin_user["id"],
            approved_at=now - timedelta(minutes=5),
        ),
        _seed_live_trade(
            setup_id=s2.id,
            symbol_id=seeded_symbol.id,
            approved_by=admin_user["id"],
            approved_at=now - timedelta(minutes=1),
        ),
        _seed_live_trade(
            setup_id=s3.id,
            symbol_id=seeded_symbol.id,
            approved_by=admin_user["id"],
            approved_at=now - timedelta(minutes=3),
        ),
    ])
    await db.commit()

    res = await client.get(
        "/live-trades",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 3
    # Newest first.
    assert body["trades"][0]["setupId"] == s2.id
    assert body["trades"][1]["setupId"] == s3.id
    assert body["trades"][2]["setupId"] == s1.id


@pytest.mark.asyncio
async def test_list_filters_by_status(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s1 = _seed_setup(symbol_id=seeded_symbol.id)
    s2 = _seed_setup(symbol_id=seeded_symbol.id)
    db.add_all([s1, s2])
    await db.flush()
    db.add_all([
        _seed_live_trade(
            setup_id=s1.id, symbol_id=seeded_symbol.id,
            approved_by=admin_user["id"], status_="submitted",
        ),
        _seed_live_trade(
            setup_id=s2.id, symbol_id=seeded_symbol.id,
            approved_by=admin_user["id"], status_="filled",
        ),
    ])
    await db.commit()

    res = await client.get(
        "/live-trades",
        params={"status": "filled"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    body = res.json()
    assert body["total"] == 1
    assert body["trades"][0]["setupId"] == s2.id
    assert body["trades"][0]["status"] == "filled"


@pytest.mark.asyncio
async def test_list_400_on_bogus_status_filter(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.get(
        "/live-trades",
        params={"status": "bogus"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "invalid_live_trade_status"


@pytest.mark.asyncio
async def test_list_filters_by_symbol_setup_account_direction(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    other_sym = Symbol(
        id=_ticker_id(),
        ticker="MSFT",
        exchange="NASDAQ",
        asset_class="equity",
        display_name="Microsoft",
        tick_size=0.01,
        lot_size=1.0,
        quote_currency="USD",
        session_tz="America/New_York",
        active=True,
    )
    other_acct = BrokerAccount(
        id=OTHER_ACCOUNT_ID,
        provider="alpaca",
        display_name="Other",
        mode="paper",
        api_key_ref="x",
        api_secret_ref="y",
        base_url="https://paper-api.alpaca.markets",
        enabled=True,
    )
    s1 = _seed_setup(symbol_id=seeded_symbol.id)
    s2 = _seed_setup(symbol_id=seeded_symbol.id)
    db.add_all([other_sym, other_acct, s1, s2])
    await db.flush()
    db.add_all([
        _seed_live_trade(
            setup_id=s1.id, symbol_id=seeded_symbol.id,
            account_id=ACCOUNT_ID, direction="long",
            approved_by=admin_user["id"],
        ),
        _seed_live_trade(
            setup_id=s2.id, symbol_id=other_sym.id,
            account_id=OTHER_ACCOUNT_ID, direction="short",
            approved_by=admin_user["id"],
        ),
    ])
    await db.commit()

    # symbolId filter.
    res = await client.get(
        "/live-trades",
        params={"symbolId": seeded_symbol.id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.json()["total"] == 1

    # setupId filter.
    res = await client.get(
        "/live-trades",
        params={"setupId": s2.id},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.json()["total"] == 1
    assert res.json()["trades"][0]["setupId"] == s2.id

    # accountId filter.
    res = await client.get(
        "/live-trades",
        params={"accountId": OTHER_ACCOUNT_ID},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.json()["total"] == 1
    assert res.json()["trades"][0]["accountId"] == OTHER_ACCOUNT_ID

    # direction filter.
    res = await client.get(
        "/live-trades",
        params={"direction": "short"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.json()["total"] == 1
    assert res.json()["trades"][0]["direction"] == "short"


@pytest.mark.asyncio
async def test_list_respects_limit_and_offset(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    for _ in range(5):
        s = _seed_setup(symbol_id=seeded_symbol.id)
        db.add(s)
        await db.flush()
        db.add(
            _seed_live_trade(
                setup_id=s.id,
                symbol_id=seeded_symbol.id,
                approved_by=admin_user["id"],
            )
        )
    await db.commit()

    res = await client.get(
        "/live-trades",
        params={"limit": 2, "offset": 1},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    body = res.json()
    assert body["total"] == 5
    assert body["limit"] == 2
    assert body["offset"] == 1
    assert len(body["trades"]) == 2


# ────────────────────── GET /v1/live-trades/{id} ──────────────────


@pytest.mark.asyncio
async def test_get_detail_returns_trade(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.get(
        f"/live-trades/{trade.id}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == trade.id
    assert body["setupId"] == s.id
    assert body["status"] == "submitted"


@pytest.mark.asyncio
async def test_get_detail_404_when_missing(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.get(
        "/live-trades/lt_nonexistent",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "live_trade_not_found"


@pytest.mark.asyncio
async def test_get_detail_accessible_to_viewer(
    client: AsyncClient,
    viewer_token: str,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.get(
        f"/live-trades/{trade.id}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 200, res.text


# ────────────────────── POST /v1/live-trades/{id}/cancel ──────────


@pytest.mark.asyncio
async def test_cancel_requires_auth(client: AsyncClient) -> None:
    res = await client.post("/live-trades/lt_x/cancel")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_cancel_requires_admin(
    client: AsyncClient,
    viewer_token: str,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_cancel_404_when_missing(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.post(
        "/live-trades/lt_nonexistent/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "live_trade_not_found"


@pytest.mark.asyncio
async def test_cancel_happy_path_flips_to_cancelled(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        json={"reason": "operator abort"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "cancelled"
    assert body["closedAt"] is not None
    assert body["note"] is not None
    assert "[cancel] operator abort" in body["note"]

    # Broker adapter was asked to cancel via client_order_id.
    cancel_calls = [
        c for c in registered_adapter.calls if c.method == "cancel_order"
    ]
    assert len(cancel_calls) == 1
    assert (
        cancel_calls[0].kwargs["client_order_id"]
        == trade.client_order_id
    )

    # Audit event written.
    await db.commit()
    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.action == "live_trade.cancel")
        .where(AuditEvent.resource_id == trade.id)
    )
    assert audit is not None
    assert audit.outcome == "success"

    # Setup transitions to closed.
    await db.refresh(s)
    assert s.status == "closed"


@pytest.mark.asyncio
async def test_cancel_409_on_terminal_state(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="won",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "live_trade_not_cancellable"

    # Broker adapter MUST NOT have been called.
    assert not [c for c in registered_adapter.calls if c.method == "cancel_order"]


@pytest.mark.asyncio
async def test_cancel_503_on_no_adapter(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    """No adapter registered → 503 + audit event, row stays put."""
    broker_registry.clear()
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503, res.text
    assert res.json()["error"]["code"] == "broker_unavailable"

    # Row still shows as submitted — retry is safe.
    await db.refresh(trade)
    assert trade.status == "submitted"

    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.action == "live_trade.cancel_broker_unavailable")
        .where(AuditEvent.resource_id == trade.id)
    )
    assert audit is not None


@pytest.mark.asyncio
async def test_cancel_503_on_broker_outage(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.next_cancel_raises = BrokerUnavailable(
        provider="fake", reason="dns_fail"
    )
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503, res.text
    assert res.json()["error"]["code"] == "broker_unavailable"

    await db.refresh(trade)
    assert trade.status == "submitted"  # unchanged — retry is safe

    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.action == "live_trade.cancel_broker_unavailable")
        .where(AuditEvent.resource_id == trade.id)
    )
    assert audit is not None


@pytest.mark.asyncio
async def test_cancel_allowed_on_pending_submit(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="pending_submit",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled"


@pytest.mark.asyncio
async def test_cancel_allowed_on_partially_filled(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="partially_filled",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.post(
        f"/live-trades/{trade.id}/cancel",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "cancelled"


# ────────────────────── PATCH /v1/live-trades/{id}/status ─────────


@pytest.mark.asyncio
async def test_patch_status_requires_auth(client: AsyncClient) -> None:
    res = await client.patch(
        "/live-trades/lt_x/status", json={"status": "filled"}
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_patch_status_requires_admin(
    client: AsyncClient,
    viewer_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={"status": "filled"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403, res.text


@pytest.mark.asyncio
async def test_patch_status_404_when_missing(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.patch(
        "/live-trades/lt_nope/status",
        json={"status": "filled"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "live_trade_not_found"


@pytest.mark.asyncio
async def test_patch_status_submitted_to_filled_stamps_fill_fields(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={
            "status": "filled",
            "avgFillPrice": 100.05,
            "filledQty": 1000.0,
            "commission": 1.25,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "filled"
    assert body["avgFillPrice"] == 100.05
    assert body["filledQty"] == 1000.0
    assert body["commission"] == 1.25
    assert body["filledAt"] is not None


@pytest.mark.asyncio
async def test_patch_status_filled_to_won_closes_setup_and_sets_pnl(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="filled",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={
            "status": "won",
            "pnlR": 2.1,
            "realizedPnLDollars": 1050.0,
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "won"
    assert body["pnlR"] == 2.1
    assert body["realizedPnLDollars"] == 1050.0
    assert body["closedAt"] is not None

    await db.commit()
    await db.refresh(s)
    assert s.status == "closed"
    assert s.closed_at is not None
    assert s.closed_pnl_r == 2.1


@pytest.mark.asyncio
async def test_patch_status_409_on_invalid_transition(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    # submitted → won is illegal; must pass through filled first.
    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={"status": "won", "pnlR": 1.0},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "live_trade_invalid_transition"


@pytest.mark.asyncio
async def test_patch_status_409_when_already_terminal(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="cancelled",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={"status": "won", "pnlR": 1.0},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "live_trade_terminal"


@pytest.mark.asyncio
async def test_patch_status_same_state_is_noop(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={"status": "submitted"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "submitted"


@pytest.mark.asyncio
async def test_patch_status_writes_audit_event(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    s = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(s)
    await db.flush()
    trade = _seed_live_trade(
        setup_id=s.id,
        symbol_id=seeded_symbol.id,
        approved_by=admin_user["id"],
        status_="submitted",
    )
    db.add(trade)
    await db.commit()
    await db.refresh(trade)

    res = await client.patch(
        f"/live-trades/{trade.id}/status",
        json={"status": "filled", "filledQty": 1000.0, "avgFillPrice": 100.0},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text

    await db.commit()
    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.action == "live_trade.status_patched")
        .where(AuditEvent.resource_id == trade.id)
    )
    assert audit is not None
    assert audit.outcome == "success"
    assert audit.details["from"] == "submitted"
    assert audit.details["to"] == "filled"
