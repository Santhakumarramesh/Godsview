"""Integration tests for Phase 6 PR3 — portfolio intelligence routes.

Covers:

* ``GET  /v1/portfolio/accounts``                  — list broker accounts.
* ``GET  /v1/portfolio/exposure``                  — per-account exposure
                                                     projection with warnings.
* ``GET  /v1/portfolio/allocation``                — allocation plan with
                                                     inherited defaults.
* ``POST /v1/portfolio/allocation``                — admin-gated upsert.
* ``POST /v1/portfolio/allocation/rebalance``      — admin-gated snap to default.
* ``GET  /v1/portfolio/pnl``                       — daily PnL timeseries.

Every DB fixture seeds the minimum Phase 4 state needed to project a
portfolio view — broker account, risk budget, equity snapshot, symbol,
position, live trade.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    AccountEquitySnapshot,
    AllocationPlanRow,
    BrokerAccount,
    LiveTrade,
    Position,
    RiskBudget,
    Setup,
    Strategy,
    Symbol,
    User,
)
from app.security import hash_password

UTC = timezone.utc

ACCOUNT_ID = "acc_portfolio_test"


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


def _sid() -> str:
    return f"sym_{uuid.uuid4().hex}"


@pytest_asyncio.fixture()
async def admin_token(client: AsyncClient, admin_user: dict[str, Any]) -> str:
    return await _login(client, admin_user["email"], admin_user["password"])


@pytest_asyncio.fixture()
async def viewer_token(client: AsyncClient, db: AsyncSession) -> str:
    password = "viewer-portfolio-pw"
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer-portfolio@godsview.io",
        display_name="Portfolio Viewer",
        password_hash=hash_password(password),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(user)
    await db.commit()
    return await _login(client, user.email, password)


@pytest_asyncio.fixture()
async def broker_account(db: AsyncSession) -> BrokerAccount:
    row = BrokerAccount(
        id=ACCOUNT_ID,
        provider="alpaca",
        display_name="Portfolio Test",
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
) -> RiskBudget:
    row = RiskBudget(
        account_id=ACCOUNT_ID,
        max_risk_per_trade_r=0.005,
        max_daily_drawdown_r=0.03,
        max_open_positions=5,
        max_correlated_exposure=1.0,
        max_gross_exposure=2.0,
    )
    db.add(row)
    await db.commit()
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
    return snap


@pytest_asyncio.fixture()
async def seeded_symbol(db: AsyncSession) -> Symbol:
    sym = Symbol(
        id=_sid(),
        ticker="SPY",
        exchange="NYSE",
        asset_class="equity",
        display_name="SPDR S&P 500 ETF Trust",
        tick_size=0.01,
        lot_size=1.0,
        quote_currency="USD",
        session_tz="America/New_York",
        active=True,
    )
    db.add(sym)
    await db.commit()
    return sym


@pytest_asyncio.fixture()
async def seeded_position(
    db: AsyncSession,
    broker_account: BrokerAccount,
    seeded_symbol: Symbol,
) -> Position:
    pos = Position(
        account_id=ACCOUNT_ID,
        symbol_id=seeded_symbol.id,
        direction="long",
        qty=100.0,
        avg_entry_price=500.0,
        mark_price=510.0,
        unrealized_pnl=1000.0,
        status="open",
    )
    db.add(pos)
    await db.commit()
    return pos


@pytest_asyncio.fixture()
async def seeded_strategy(db: AsyncSession) -> Strategy:
    row = Strategy(
        name=f"strat_{uuid.uuid4().hex[:8]}",
        description="portfolio smoke strategy",
        setup_type="ob_retest",
        current_tier="B",
        current_state="paper",
    )
    db.add(row)
    await db.commit()
    return row


# ─────────────────────────── accounts ───────────────────────────────────


@pytest.mark.asyncio
async def test_accounts_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/portfolio/accounts")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_accounts_returns_configured(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.get(
        "/portfolio/accounts",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert "accounts" in body
    names = [a["displayName"] for a in body["accounts"]]
    assert "Portfolio Test" in names


# ─────────────────────────── exposure ───────────────────────────────────


@pytest.mark.asyncio
async def test_exposure_projects_open_positions(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
    risk_budget: RiskBudget,
    equity_snapshot: AccountEquitySnapshot,
    seeded_position: Position,
    seeded_symbol: Symbol,
) -> None:
    res = await client.get(
        f"/portfolio/exposure?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accountId"] == ACCOUNT_ID
    assert body["totalEquity"] == 100_000.0
    assert body["grossNotional"] == pytest.approx(510.0 * 100)
    assert body["bySymbol"][0]["symbolId"] == seeded_symbol.id
    assert body["bySymbol"][0]["correlationClass"] == "equity_index"
    assert body["byCorrelationClass"][0]["correlationClass"] == "equity_index"


@pytest.mark.asyncio
async def test_exposure_no_account_returns_404(
    client: AsyncClient,
    admin_token: str,
) -> None:
    res = await client.get(
        "/portfolio/exposure",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "no_broker_accounts"


@pytest.mark.asyncio
async def test_exposure_flags_single_symbol_concentration(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
    risk_budget: RiskBudget,
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    snap = AccountEquitySnapshot(
        account_id=ACCOUNT_ID,
        observed_at=datetime.now(UTC),
        total_equity=10_000.0,
        start_of_day_equity=10_000.0,
        realized_pnl=0.0,
        unrealized_pnl=0.0,
        margin_used=0.0,
        buying_power=40_000.0,
    )
    db.add(snap)
    pos = Position(
        account_id=ACCOUNT_ID,
        symbol_id=seeded_symbol.id,
        direction="long",
        qty=100.0,
        avg_entry_price=70.0,
        mark_price=70.0,
        unrealized_pnl=0.0,
        status="open",
    )
    db.add(pos)
    await db.commit()

    res = await client.get(
        f"/portfolio/exposure?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    codes = [w["code"] for w in res.json()["warnings"]]
    assert "single_symbol_concentration" in codes


# ─────────────────────────── allocation ─────────────────────────────────


@pytest.mark.asyncio
async def test_allocation_empty_plan(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
    equity_snapshot: AccountEquitySnapshot,
) -> None:
    res = await client.get(
        f"/portfolio/allocation?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accountId"] == ACCOUNT_ID
    assert body["strategies"] == []
    assert body["totalTargetPercent"] == 0.0
    assert body["inPolicy"] is True


@pytest.mark.asyncio
async def test_allocation_upsert_requires_admin(
    client: AsyncClient,
    viewer_token: str,
    broker_account: BrokerAccount,
    seeded_strategy: Strategy,
) -> None:
    res = await client.post(
        f"/portfolio/allocation?accountId={ACCOUNT_ID}",
        json={
            "strategyId": seeded_strategy.id,
            "targetPercent": 0.2,
            "reason": "smoke test",
        },
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_allocation_upsert_persists(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    broker_account: BrokerAccount,
    equity_snapshot: AccountEquitySnapshot,
    seeded_strategy: Strategy,
) -> None:
    res = await client.post(
        f"/portfolio/allocation?accountId={ACCOUNT_ID}",
        json={
            "strategyId": seeded_strategy.id,
            "targetPercent": 0.25,
            "reason": "initial allocation for smoke test",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["strategies"]) == 1
    row = body["strategies"][0]
    assert row["strategyId"] == seeded_strategy.id
    assert row["targetPercent"] == 0.25
    assert row["source"] == "operator"

    # row persisted
    stmt = select(AllocationPlanRow).where(
        AllocationPlanRow.account_id == ACCOUNT_ID,
        AllocationPlanRow.strategy_id == seeded_strategy.id,
    )
    rows = (await db.execute(stmt)).scalars().all()
    assert len(rows) == 1
    assert rows[0].target_percent == 0.25

    # idempotent upsert — same (account, strategy) pair updates in place
    res2 = await client.post(
        f"/portfolio/allocation?accountId={ACCOUNT_ID}",
        json={
            "strategyId": seeded_strategy.id,
            "targetPercent": 0.3,
            "reason": "bumped target",
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res2.status_code == 200, res2.text
    assert res2.json()["strategies"][0]["targetPercent"] == 0.3

    rows2 = (await db.execute(stmt)).scalars().all()
    assert len(rows2) == 1


@pytest.mark.asyncio
async def test_allocation_rebalance_admin_only(
    client: AsyncClient,
    viewer_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.post(
        f"/portfolio/allocation/rebalance?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


# ─────────────────────────── PnL ────────────────────────────────────────


@pytest.mark.asyncio
async def test_pnl_empty_range_returns_zero_summary(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    today = datetime.now(UTC).date()
    start = today - timedelta(days=5)
    res = await client.get(
        f"/portfolio/pnl?accountId={ACCOUNT_ID}"
        f"&startDate={start.isoformat()}&endDate={today.isoformat()}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["summary"]["accountId"] == ACCOUNT_ID
    assert body["summary"]["startDate"] == start.isoformat()
    assert body["summary"]["endDate"] == today.isoformat()
    assert len(body["points"]) == 6  # inclusive window


@pytest.mark.asyncio
async def test_pnl_rejects_wide_range(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    today = datetime.now(UTC).date()
    start = today - timedelta(days=400)
    res = await client.get(
        f"/portfolio/pnl?accountId={ACCOUNT_ID}"
        f"&startDate={start.isoformat()}&endDate={today.isoformat()}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "range_too_wide"


@pytest.mark.asyncio
async def test_pnl_rejects_bad_date(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.get(
        f"/portfolio/pnl?accountId={ACCOUNT_ID}&startDate=not-a-date",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_date"
