"""Integration tests for Phase 4 PR5 — live execution gate routes.

Covers both:

* ``POST /v1/execution/live/preview`` — admin-only dry run. Loads setup
  + account + budget + equity + positions, runs :func:`evaluate_live_gate`
  and returns the verdict + sizing projection. No side effects.
* ``POST /v1/setups/{setup_id}/approve-live`` — admin-only. Same gate
  path as /preview; on green-light sizes via :func:`size_for_trade`,
  mints a ``LiveTrade`` at ``pending_submit`` with a unique
  ``client_order_id``, calls :meth:`BrokerProtocol.submit_order`
  through the registered adapter, maps the broker status back onto
  the trade row, flips the setup to ``approved_live`` and writes a
  ``setup.live_approved`` audit event.

Tests use the shared :class:`FakeAdapter` fixture pattern — register
the adapter in :data:`broker_registry`, seed equity + submit knobs,
then hit the route via the shared :data:`client` fixture.
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
    AccountEquitySnapshot,
    AuditEvent,
    BrokerAccount,
    FeatureFlag,
    LiveTrade,
    Position,
    RiskBudget as RiskBudgetRow,
    Setup,
    Symbol,
    User,
)
from app.security import hash_password

UTC = timezone.utc

ACCOUNT_ID = "acc_live_paper_1"


# ─────────────────────────── helpers ──────────────────────────────


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


def _ticker_id() -> str:
    return f"sym_{uuid.uuid4().hex}"


def _seed_setup(
    *,
    symbol_id: str,
    status: str = "detected",
    confidence: float = 0.72,
    expires_in: timedelta = timedelta(minutes=30),
    direction: str = "long",
    entry: float = 100.0,
    stop: float = 99.5,
    target: float = 101.5,
) -> Setup:
    detected = datetime.now(UTC) - timedelta(seconds=5)
    return Setup(
        id=f"stp_{uuid.uuid4().hex}",
        symbol_id=symbol_id,
        tf="5m",
        type="ob_retest",
        direction=direction,
        status=status,
        detected_at=detected,
        expires_at=detected + expires_in,
        entry_low=entry - 0.1,
        entry_high=entry + 0.1,
        entry_ref=entry,
        stop_loss=stop,
        take_profit=target,
        rr=abs((target - entry) / max(abs(entry - stop), 1e-9)),
        confidence_score=confidence,
        structure_score=0.7,
        order_flow_score=0.6,
        regime_score=0.5,
        session_score=0.5,
        history_score=0.5,
        history_count=0,
        reasoning="seeded for PR5 live-gate tests",
        structure_event_ids=[],
        order_flow_event_ids=[],
    )


# ─────────────────────────── fixtures ───────────────────────────────


@pytest_asyncio.fixture()
async def admin_token(client: AsyncClient, admin_user: dict[str, Any]) -> str:
    return await _login(client, admin_user["email"], admin_user["password"])


@pytest_asyncio.fixture()
async def viewer_token(client: AsyncClient, db: AsyncSession) -> str:
    password = "viewer-live-pw-pr5"
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer-live@godsview.io",
        display_name="Live Viewer",
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
        display_name="Paper Live Gate",
        mode="paper",
        api_key_ref="secret://paper/key",
        api_secret_ref="secret://paper/secret",
        base_url="https://paper-api.alpaca.markets",
        enabled=True,
    )
    db.add(row)
    await db.commit()
    return row


@pytest_asyncio.fixture()
async def risk_budget(
    db: AsyncSession, broker_account: BrokerAccount
) -> RiskBudgetRow:
    row = RiskBudgetRow(
        account_id=ACCOUNT_ID,
        max_risk_per_trade_r=0.005,
        max_daily_drawdown_r=0.03,
        max_open_positions=5,
        max_correlated_exposure=1.0,
        max_gross_exposure=2.0,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@pytest_asyncio.fixture()
async def equity_snapshot(
    db: AsyncSession, broker_account: BrokerAccount
) -> AccountEquitySnapshot:
    snap = AccountEquitySnapshot(
        account_id=ACCOUNT_ID,
        observed_at=datetime.now(UTC),
        total_equity=100_000.0,
        start_of_day_equity=100_000.0,
        realized_pnl=0.0,
        unrealized_pnl=0.0,
        margin_used=0.0,
        buying_power=400_000.0,
    )
    db.add(snap)
    await db.commit()
    await db.refresh(snap)
    return snap


@pytest.fixture()
def registered_adapter() -> FakeAdapter:
    broker_registry.clear()
    adapter = FakeAdapter(account_id=ACCOUNT_ID, mode="paper")
    broker_registry.register(ACCOUNT_ID, adapter)
    yield adapter
    broker_registry.clear()


# ────────────────────────── /execution/live/preview ────────────────


@pytest.mark.asyncio
async def test_preview_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/execution/live/preview",
        json={"setupId": "stp_x", "accountId": ACCOUNT_ID, "mode": "live"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_preview_requires_admin(
    client: AsyncClient, viewer_token: str
) -> None:
    res = await client.post(
        "/execution/live/preview",
        json={"setupId": "stp_x", "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_preview_404_when_setup_missing(
    client: AsyncClient, admin_token: str, broker_account: BrokerAccount
) -> None:
    res = await client.post(
        "/execution/live/preview",
        json={"setupId": "stp_missing", "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "setup_not_found"


@pytest.mark.asyncio
async def test_preview_404_when_account_missing(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(setup)
    await db.commit()
    res = await client.post(
        "/execution/live/preview",
        json={
            "setupId": setup.id,
            "accountId": "acc_does_not_exist",
            "mode": "live",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "broker_account_not_found"


@pytest.mark.asyncio
async def test_preview_happy_path_approves_and_returns_sizing(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is True
    assert body["reason"] == "approved"
    # Sizing: $500 risk budget (0.5% of $100k), $0.50 stop distance → 1000 qty.
    sizing = body["sizing"]
    assert sizing["qty"] == 1000.0
    assert sizing["dollarRisk"] == 500.0
    assert sizing["rRisk"] == 0.005
    # 1000 qty × $100 entry = $100k notional == 1.0x equity.
    assert sizing["notional"] == 100_000.0
    risk = body["risk"]
    assert risk["projectedGross"] == 1.0
    assert risk["drawdownR"] == 0.0


@pytest.mark.asyncio
async def test_preview_rejects_when_live_disabled(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    db.add(
        FeatureFlag(
            key="execution.live_enabled",
            enabled=False,
            description="live disabled for test",
            scope="global",
            scope_ref=None,
            updated_by="test",
        )
    )
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # /preview is non-destructive — always returns 200 with the verdict.
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is False
    assert body["reason"] == "live_disabled"


@pytest.mark.asyncio
async def test_preview_rejects_when_kill_switch_active(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    db.add(
        FeatureFlag(
            key="execution.kill_switch",
            enabled=True,
            description="kill switch on",
            scope="global",
            scope_ref=None,
            updated_by="test",
        )
    )
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is False
    assert body["reason"] == "kill_switch_active"


@pytest.mark.asyncio
async def test_preview_rejects_when_risk_budget_missing(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    # No RiskBudget row exists for this account → gate rejects.
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is False
    assert body["reason"] == "risk_budget_missing"
    # No sizing preview without a budget.
    assert body["sizing"] is None


@pytest.mark.asyncio
async def test_preview_rejects_when_equity_stale(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    registered_adapter: FakeAdapter,
) -> None:
    # Seed a stale equity snapshot (>60s old by default).
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    db.add(
        AccountEquitySnapshot(
            account_id=ACCOUNT_ID,
            observed_at=datetime.now(UTC) - timedelta(minutes=5),
            total_equity=100_000.0,
            start_of_day_equity=100_000.0,
            realized_pnl=0.0,
            unrealized_pnl=0.0,
            margin_used=0.0,
            buying_power=400_000.0,
        )
    )
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is False
    assert body["reason"] == "stale_equity_snapshot"


@pytest.mark.asyncio
async def test_preview_rejects_low_confidence(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.1)
    db.add(setup)
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is False
    assert body["reason"] == "confidence_below_threshold"


@pytest.mark.asyncio
async def test_preview_rejects_broker_unavailable(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
) -> None:
    """No adapter registered → gate sees broker_available=False."""
    broker_registry.clear()
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    res = await client.post(
        "/execution/live/preview",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is False
    assert body["reason"] == "broker_unavailable"


# ────────────────────────── /setups/:id/approve-live ───────────────


@pytest.mark.asyncio
async def test_approve_live_requires_auth(client: AsyncClient) -> None:
    res = await client.post(
        "/setups/stp_x/approve-live",
        json={"setupId": "stp_x", "accountId": ACCOUNT_ID, "mode": "live"},
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_approve_live_requires_admin(
    client: AsyncClient, viewer_token: str, broker_account: BrokerAccount
) -> None:
    res = await client.post(
        "/setups/stp_x/approve-live",
        json={"setupId": "stp_x", "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_approve_live_404_when_setup_missing(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.post(
        "/setups/stp_missing/approve-live",
        json={
            "setupId": "stp_missing",
            "accountId": ACCOUNT_ID,
            "mode": "live",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "setup_not_found"


@pytest.mark.asyncio
async def test_approve_live_400_on_setup_id_mismatch(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(setup)
    await db.commit()
    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={
            "setupId": "stp_different_id",
            "accountId": ACCOUNT_ID,
            "mode": "live",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "setup_id_mismatch"


@pytest.mark.asyncio
async def test_approve_live_happy_path_submits_and_persists(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is True
    assert body["reason"] == "approved"
    lt = body["liveTrade"]
    assert lt["setupId"] == setup.id
    assert lt["accountId"] == ACCOUNT_ID
    assert lt["symbolId"] == seeded_symbol.id
    assert lt["status"] == "submitted"  # FakeAdapter default = "accepted" → submitted
    assert lt["qty"] == 1000.0
    assert lt["sizeMultiplier"] == 1.0
    assert lt["clientOrderId"].startswith(f"gv_{setup.id}_")
    assert lt["brokerOrderId"] is not None
    assert lt["approvedByUserId"] == admin_user["id"]

    # Broker was called with a bracket order carrying TP/SL legs.
    submit_calls = [c for c in registered_adapter.calls if c.method == "submit_order"]
    assert len(submit_calls) == 1
    req = submit_calls[0].kwargs["request"]
    assert req.symbol == "AAPL"
    assert req.qty == 1000.0
    assert req.direction == "long"
    assert req.order_type == "bracket"
    assert req.take_profit == 101.5
    assert req.stop_loss == 99.5

    # DB state — Setup flipped, LiveTrade row exists, audit event written.
    await db.commit()
    await db.refresh(setup)
    assert setup.status == "approved_live"

    live = await db.scalar(
        select(LiveTrade).where(LiveTrade.setup_id == setup.id)
    )
    assert live is not None
    assert live.status == "submitted"
    assert live.broker_order_id == lt["brokerOrderId"]
    assert live.client_order_id == lt["clientOrderId"]
    assert live.submitted_at is not None

    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.resource_id == setup.id)
        .where(AuditEvent.action == "setup.live_approved")
    )
    assert audit is not None
    assert audit.outcome == "success"


@pytest.mark.asyncio
async def test_approve_live_409_on_gate_reject(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    # Low confidence → gate rejects with confidence_below_threshold.
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.1)
    db.add(setup)
    await db.commit()
    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_confidence_below_threshold"

    # No LiveTrade row persisted on reject.
    rows = list(
        (await db.scalars(select(LiveTrade).where(LiveTrade.setup_id == setup.id))).all()
    )
    assert rows == []

    # Audit event was written with "denied" outcome.
    await db.commit()
    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.resource_id == setup.id)
        .where(AuditEvent.action == "setup.live_rejected")
    )
    assert audit is not None
    assert audit.outcome == "denied"


@pytest.mark.asyncio
async def test_approve_live_409_on_kill_switch(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    db.add(
        FeatureFlag(
            key="execution.kill_switch",
            enabled=True,
            description="kill switch on",
            scope="global",
            scope_ref=None,
            updated_by="test",
        )
    )
    await db.commit()
    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_kill_switch_active"


@pytest.mark.asyncio
async def test_approve_live_409_on_duplicate_active_trade(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.flush()
    db.add(
        LiveTrade(
            setup_id=setup.id,
            symbol_id=seeded_symbol.id,
            account_id=ACCOUNT_ID,
            direction="long",
            entry_ref=setup.entry_ref,
            stop_loss=setup.stop_loss,
            take_profit=setup.take_profit,
            size_multiplier=1.0,
            qty=10.0,
            status="submitted",
            client_order_id=f"gv_existing_{uuid.uuid4().hex[:8]}",
            approved_by_user_id=admin_user["id"],
        )
    )
    await db.commit()
    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_duplicate_active_trade"


@pytest.mark.asyncio
async def test_approve_live_503_on_broker_outage(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.next_submit_raises = BrokerUnavailable(
        provider="fake", reason="circuit breaker tripped"
    )
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503, res.text
    assert res.json()["error"]["code"] == "broker_unavailable"

    # Trade row should exist with status=rejected so the audit trail
    # preserves the attempt; setup.status stays at approved_live because
    # the gate already cleared — this is a broker-side failure, not a
    # gate rejection.
    await db.commit()
    live = await db.scalar(
        select(LiveTrade).where(LiveTrade.setup_id == setup.id)
    )
    assert live is not None
    assert live.status == "rejected"

    # Audit event: setup.live_broker_unavailable.
    audit = await db.scalar(
        select(AuditEvent)
        .where(AuditEvent.resource_id == setup.id)
        .where(AuditEvent.action == "setup.live_broker_unavailable")
    )
    assert audit is not None


@pytest.mark.asyncio
async def test_approve_live_503_when_no_adapter_registered(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
) -> None:
    """Preview sees broker_available=False; /approve-live short-circuits same way."""
    broker_registry.clear()
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={"setupId": setup.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    # Gate sees broker_available=False and rejects with broker_unavailable
    # → 409 gate_broker_unavailable.
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_broker_unavailable"


@pytest.mark.asyncio
async def test_approve_live_404_on_account_missing(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(setup)
    await db.commit()
    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={
            "setupId": setup.id,
            "accountId": "acc_does_not_exist",
            "mode": "live",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404, res.text
    assert res.json()["error"]["code"] == "broker_account_not_found"


@pytest.mark.asyncio
async def test_approve_live_honours_size_override(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()
    res = await client.post(
        f"/setups/{setup.id}/approve-live",
        json={
            "setupId": setup.id,
            "accountId": ACCOUNT_ID,
            "mode": "live",
            "overrideRisk": {"sizeMultiplier": 0.5, "note": "half size"},
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    lt = body["liveTrade"]
    # Half size budget → 0.25% R, $250 risk, $0.50 stop → 500 qty.
    assert lt["qty"] == 500.0
    assert lt["sizeMultiplier"] == 0.5
    assert lt["note"] == "half size"


@pytest.mark.asyncio
async def test_approve_live_client_order_id_is_unique_per_call(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    seeded_symbol: Symbol,
    broker_account: BrokerAccount,
    risk_budget: RiskBudgetRow,
    equity_snapshot: AccountEquitySnapshot,
    registered_adapter: FakeAdapter,
) -> None:
    """Two separate setups produce distinct client_order_ids."""
    s1 = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    s2 = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add_all([s1, s2])
    await db.commit()

    r1 = await client.post(
        f"/setups/{s1.id}/approve-live",
        json={"setupId": s1.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    r2 = await client.post(
        f"/setups/{s2.id}/approve-live",
        json={"setupId": s2.id, "accountId": ACCOUNT_ID, "mode": "live"},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert r1.status_code == 200, r1.text
    assert r2.status_code == 200, r2.text
    coid1 = r1.json()["liveTrade"]["clientOrderId"]
    coid2 = r2.json()["liveTrade"]["clientOrderId"]
    assert coid1 != coid2
    assert coid1.startswith(f"gv_{s1.id}_")
    assert coid2.startswith(f"gv_{s2.id}_")
