"""Integration tests for /v1/risk/{budget,equity}.

The routes proxy SQLAlchemy rows on our side and a broker adapter on
the other. Tests register a FakeAdapter in the process-global
``broker_registry`` and seed a ``broker_accounts`` row first, then hit
the API via the shared ``client`` fixture.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.broker import FakeAdapter, broker_registry
from app.broker.base import BrokerEquityDto, BrokerUnavailable
from app.models import (
    AccountEquitySnapshot,
    BrokerAccount,
    RiskBudget as RiskBudgetRow,
    User,
)
from app.security import hash_password

UTC = timezone.utc

ACCOUNT_ID = "acc_paper_risk"


# ─────────────────────────── fixtures ───────────────────────────────


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


@pytest_asyncio.fixture()
async def admin_token(client: AsyncClient, admin_user: dict) -> str:
    return await _login(client, admin_user["email"], admin_user["password"])


@pytest_asyncio.fixture()
async def viewer_token(client: AsyncClient, db: AsyncSession) -> str:
    password = "viewer-password-123"
    user = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer-risk@godsview.io",
        display_name="Risk Viewer",
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
        display_name="Paper Risk",
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
def registered_adapter() -> FakeAdapter:
    broker_registry.clear()
    adapter = FakeAdapter(account_id=ACCOUNT_ID, mode="paper")
    broker_registry.register(ACCOUNT_ID, adapter)
    yield adapter
    broker_registry.clear()


# ─────────────────────────── budget ────────────────────────────────


@pytest.mark.asyncio
async def test_get_budget_requires_auth(
    client: AsyncClient, broker_account: BrokerAccount
) -> None:
    res = await client.get(f"/risk/budget?accountId={ACCOUNT_ID}")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_budget_404_when_account_missing(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.get(
        "/risk/budget?accountId=acc_does_not_exist",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "broker_account_not_found"


@pytest.mark.asyncio
async def test_get_budget_404_when_no_budget_row(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.get(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "risk_budget_not_found"


@pytest.mark.asyncio
async def test_get_budget_200_returns_row(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    broker_account: BrokerAccount,
) -> None:
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

    res = await client.get(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accountId"] == ACCOUNT_ID
    assert body["maxRiskPerTradeR"] == 0.005
    assert body["maxDailyDrawdownR"] == 0.03
    assert body["maxOpenPositions"] == 5
    assert body["maxCorrelatedExposure"] == 1.0
    assert body["maxGrossExposure"] == 2.0
    assert "updatedAt" in body


@pytest.mark.asyncio
async def test_patch_budget_requires_admin(
    client: AsyncClient,
    viewer_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.patch(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        json={"maxRiskPerTradeR": 0.01},
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_patch_budget_creates_row_when_missing(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    payload = {
        "maxRiskPerTradeR": 0.0075,
        "maxDailyDrawdownR": 0.04,
        "maxOpenPositions": 6,
        "maxCorrelatedExposure": 1.5,
        "maxGrossExposure": 2.5,
    }
    res = await client.patch(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        json=payload,
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["maxRiskPerTradeR"] == 0.0075
    assert body["maxDailyDrawdownR"] == 0.04
    assert body["maxOpenPositions"] == 6
    assert body["maxCorrelatedExposure"] == 1.5
    assert body["maxGrossExposure"] == 2.5


@pytest.mark.asyncio
async def test_patch_budget_partial_preserves_other_fields(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    broker_account: BrokerAccount,
) -> None:
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

    res = await client.patch(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        json={"maxOpenPositions": 7},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["maxOpenPositions"] == 7
    # untouched fields preserved
    assert body["maxRiskPerTradeR"] == 0.005
    assert body["maxDailyDrawdownR"] == 0.03
    assert body["maxCorrelatedExposure"] == 1.0
    assert body["maxGrossExposure"] == 2.0


@pytest.mark.asyncio
async def test_patch_budget_rejects_inconsistent_caps(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    # max_risk_per_trade_r must be strictly less than max_daily_drawdown_r.
    res = await client.patch(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        json={"maxRiskPerTradeR": 0.05, "maxDailyDrawdownR": 0.04},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "risk_budget_inconsistent"


@pytest.mark.asyncio
async def test_patch_budget_rejects_negative_values(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    # Pydantic gt=0.0 on maxRiskPerTradeR → 422 from request validation.
    res = await client.patch(
        f"/risk/budget?accountId={ACCOUNT_ID}",
        json={"maxRiskPerTradeR": -0.01},
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 422


# ─────────────────────────── equity ────────────────────────────────


@pytest.mark.asyncio
async def test_get_equity_requires_admin(
    client: AsyncClient,
    viewer_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_get_equity_404_when_no_snapshot(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    res = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "equity_snapshot_not_found"


@pytest.mark.asyncio
async def test_get_equity_200_returns_latest_snapshot(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    broker_account: BrokerAccount,
) -> None:
    t_old = datetime(2026, 4, 19, 13, 0, tzinfo=UTC)
    t_new = datetime(2026, 4, 19, 14, 0, tzinfo=UTC)
    db.add(
        AccountEquitySnapshot(
            account_id=ACCOUNT_ID,
            observed_at=t_old,
            total_equity=90_000.0,
            start_of_day_equity=90_000.0,
            realized_pnl=0.0,
            unrealized_pnl=0.0,
            margin_used=0.0,
            buying_power=360_000.0,
        )
    )
    db.add(
        AccountEquitySnapshot(
            account_id=ACCOUNT_ID,
            observed_at=t_new,
            total_equity=100_000.0,
            start_of_day_equity=98_000.0,
            realized_pnl=500.0,
            unrealized_pnl=1_500.0,
            margin_used=1_000.0,
            buying_power=400_000.0,
        )
    )
    await db.commit()

    res = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accountId"] == ACCOUNT_ID
    # newest row wins
    assert body["totalEquity"] == 100_000.0
    assert body["startOfDayEquity"] == 98_000.0
    assert body["realizedPnl"] == 500.0
    assert body["unrealizedPnl"] == 1_500.0
    assert body["marginUsed"] == 1_000.0
    assert body["buyingPower"] == 400_000.0


@pytest.mark.asyncio
async def test_get_equity_refresh_pulls_from_adapter_and_persists(
    client: AsyncClient,
    admin_token: str,
    db: AsyncSession,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    snap_time = datetime(2026, 4, 19, 15, 30, tzinfo=UTC)
    registered_adapter.seed_equity(
        BrokerEquityDto(
            total_equity=105_000.0,
            start_of_day_equity=100_000.0,
            realized_pnl=2_000.0,
            unrealized_pnl=3_000.0,
            margin_used=500.0,
            buying_power=420_000.0,
            observed_at=snap_time,
        )
    )

    res = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}&refresh=true",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accountId"] == ACCOUNT_ID
    assert body["totalEquity"] == 105_000.0
    assert body["buyingPower"] == 420_000.0

    # A row should have been persisted — a follow-up non-refresh GET returns it.
    await db.commit()  # isolate session from the route's own commit
    res2 = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res2.status_code == 200, res2.text
    assert res2.json()["totalEquity"] == 105_000.0


@pytest.mark.asyncio
async def test_get_equity_refresh_503_when_no_adapter(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
) -> None:
    broker_registry.clear()  # no adapter registered
    res = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}&refresh=true",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "broker_unavailable"


@pytest.mark.asyncio
async def test_get_equity_refresh_503_on_broker_outage(
    client: AsyncClient,
    admin_token: str,
    broker_account: BrokerAccount,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.next_equity_raises = BrokerUnavailable(
        provider="fake",
        reason="circuit breaker tripped",
    )
    res = await client.get(
        f"/risk/equity?accountId={ACCOUNT_ID}&refresh=true",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503
    assert res.json()["error"]["code"] == "broker_unavailable"


@pytest.mark.asyncio
async def test_get_equity_404_when_account_missing(
    client: AsyncClient, admin_token: str
) -> None:
    res = await client.get(
        "/risk/equity?accountId=acc_does_not_exist",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "broker_account_not_found"
