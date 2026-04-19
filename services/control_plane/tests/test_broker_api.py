"""Integration tests for /v1/broker/{positions,fills}.

The tests register a :class:`FakeAdapter` in the process-global
:data:`broker_registry`, seed it with fixtures, then hit the API via
the existing ``client`` fixture. Admin auth is asserted via the
``AUTH_ERROR_RESPONSES`` contract (401 unauthenticated, 403 non-admin).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.broker import FakeAdapter, broker_registry
from app.broker.base import (
    BrokerEquityDto,
    BrokerFillDto,
    BrokerPositionDto,
    BrokerUnavailable,
)
from app.models import User
from app.security import hash_password

UTC = timezone.utc


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
        email="viewer@godsview.io",
        display_name="Viewer",
        password_hash=hash_password(password),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(user)
    await db.commit()
    return await _login(client, user.email, password)


@pytest.fixture()
def registered_adapter() -> FakeAdapter:
    broker_registry.clear()
    adapter = FakeAdapter(account_id="acc_paper_1", mode="paper")
    broker_registry.register("acc_paper_1", adapter)
    yield adapter
    broker_registry.clear()


# ─────────────────────────── positions ─────────────────────────────


@pytest.mark.asyncio
async def test_positions_requires_auth(
    client: AsyncClient, registered_adapter: FakeAdapter
) -> None:
    res = await client.get("/broker/positions?accountId=acc_paper_1")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_positions_requires_admin(
    client: AsyncClient,
    registered_adapter: FakeAdapter,
    viewer_token: str,
) -> None:
    res = await client.get(
        "/broker/positions?accountId=acc_paper_1",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_positions_missing_adapter_returns_503(
    client: AsyncClient,
    admin_token: str,
) -> None:
    # no adapter registered — clear just to be safe
    broker_registry.clear()
    res = await client.get(
        "/broker/positions?accountId=does_not_exist",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503
    body = res.json()
    assert body["error"]["code"] == "broker_unavailable"


@pytest.mark.asyncio
async def test_positions_200_returns_seeded_rows(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.seed_position(
        BrokerPositionDto(
            symbol="AAPL",
            direction="long",
            qty=10.0,
            avg_entry_price=175.25,
            mark_price=180.00,
            unrealized_pnl=47.50,
        )
    )
    registered_adapter.seed_position(
        BrokerPositionDto(
            symbol="TSLA",
            direction="short",
            qty=5.0,
            avg_entry_price=250.00,
            mark_price=245.00,
            unrealized_pnl=25.00,
        )
    )

    res = await client.get(
        "/broker/positions?accountId=acc_paper_1",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["accountId"] == "acc_paper_1"
    assert body["provider"] == "fake"
    assert body["mode"] == "paper"
    assert len(body["positions"]) == 2
    by_symbol = {p["symbol"]: p for p in body["positions"]}
    assert by_symbol["AAPL"]["direction"] == "long"
    assert by_symbol["AAPL"]["avgEntryPrice"] == 175.25
    assert by_symbol["TSLA"]["direction"] == "short"


@pytest.mark.asyncio
async def test_positions_filter_by_symbol(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.seed_position(
        BrokerPositionDto(
            symbol="AAPL",
            direction="long",
            qty=10.0,
            avg_entry_price=175.25,
            mark_price=180.00,
            unrealized_pnl=47.50,
        )
    )
    registered_adapter.seed_position(
        BrokerPositionDto(
            symbol="TSLA",
            direction="short",
            qty=5.0,
            avg_entry_price=250.00,
            mark_price=245.00,
            unrealized_pnl=25.00,
        )
    )

    res = await client.get(
        "/broker/positions?accountId=acc_paper_1&symbol=AAPL",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["positions"]) == 1
    assert body["positions"][0]["symbol"] == "AAPL"


@pytest.mark.asyncio
async def test_positions_broker_outage_returns_503(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.next_list_positions_raises = BrokerUnavailable(
        provider="fake",
        reason="downstream is on fire",
    )
    res = await client.get(
        "/broker/positions?accountId=acc_paper_1",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503, res.text
    assert res.json()["error"]["code"] == "broker_unavailable"


# ─────────────────────────── fills ─────────────────────────────────


@pytest.mark.asyncio
async def test_fills_requires_admin(
    client: AsyncClient,
    registered_adapter: FakeAdapter,
    viewer_token: str,
) -> None:
    res = await client.get(
        "/broker/fills?accountId=acc_paper_1",
        headers={"Authorization": f"Bearer {viewer_token}"},
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_fills_rejects_inverted_time_window(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    now = datetime.now(UTC)
    res = await client.get(
        "/broker/fills",
        params={
            "accountId": "acc_paper_1",
            "fromTs": now.isoformat(),
            "toTs": (now - timedelta(hours=1)).isoformat(),
        },
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_time_window"


@pytest.mark.asyncio
async def test_fills_200_returns_seeded_rows_newest_first(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    t0 = datetime(2026, 4, 19, 9, 30, tzinfo=UTC)
    registered_adapter.seed_fill(
        BrokerFillDto(
            client_order_id="cli_a",
            broker_order_id="ord_a",
            symbol="AAPL",
            direction="long",
            filled_qty=2.0,
            avg_fill_price=180.00,
            status="filled",
            commission=0.0,
            slippage=None,
            observed_at=t0,
        )
    )
    registered_adapter.seed_fill(
        BrokerFillDto(
            client_order_id="cli_b",
            broker_order_id="ord_b",
            symbol="MSFT",
            direction="long",
            filled_qty=1.0,
            avg_fill_price=410.00,
            status="filled",
            commission=0.0,
            slippage=None,
            observed_at=t0 + timedelta(minutes=1),
        )
    )

    res = await client.get(
        "/broker/fills?accountId=acc_paper_1&limit=10",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    assert body["limit"] == 10
    assert body["fills"][0]["clientOrderId"] == "cli_b"  # newer
    assert body["fills"][1]["clientOrderId"] == "cli_a"


@pytest.mark.asyncio
async def test_fills_filter_by_symbol(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    t0 = datetime(2026, 4, 19, 9, 30, tzinfo=UTC)
    registered_adapter.seed_fill(
        BrokerFillDto(
            client_order_id="cli_a",
            broker_order_id="ord_a",
            symbol="AAPL",
            direction="long",
            filled_qty=2.0,
            avg_fill_price=180.00,
            status="filled",
            commission=0.0,
            slippage=None,
            observed_at=t0,
        )
    )
    registered_adapter.seed_fill(
        BrokerFillDto(
            client_order_id="cli_b",
            broker_order_id="ord_b",
            symbol="MSFT",
            direction="long",
            filled_qty=1.0,
            avg_fill_price=410.00,
            status="filled",
            commission=0.0,
            slippage=None,
            observed_at=t0 + timedelta(minutes=1),
        )
    )

    res = await client.get(
        "/broker/fills?accountId=acc_paper_1&symbol=AAPL",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["fills"][0]["symbol"] == "AAPL"


@pytest.mark.asyncio
async def test_fills_broker_outage_returns_503(
    client: AsyncClient,
    admin_token: str,
    registered_adapter: FakeAdapter,
) -> None:
    registered_adapter.next_list_fills_raises = BrokerUnavailable(
        provider="fake",
        reason="feed paused",
    )
    res = await client.get(
        "/broker/fills?accountId=acc_paper_1",
        headers={"Authorization": f"Bearer {admin_token}"},
    )
    assert res.status_code == 503, res.text
    assert res.json()["error"]["code"] == "broker_unavailable"
