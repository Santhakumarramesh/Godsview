"""Tests for the /market authenticated route surface.

Covers the public read endpoints (symbol list/detail, structure
events, structure zones, market context) and the admin-only create
endpoint. Each test uses the standard `client` + `admin_user`
fixtures and bootstraps a JWT via the auth route.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Fvg,
    MarketContext,
    OrderBlock,
    StructureEvent,
    Symbol,
)

UTC = timezone.utc


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


def _ticker_id() -> str:
    return f"sym_{uuid.uuid4().hex}"


@pytest_asyncio.fixture()
async def seeded_symbol(db: AsyncSession) -> Symbol:
    sym = Symbol(
        id=_ticker_id(),
        ticker="EURUSD",
        exchange="FX",
        asset_class="forex",
        display_name="Euro / US Dollar",
        tick_size=0.00001,
        lot_size=100000.0,
        quote_currency="USD",
        session_tz="Europe/London",
        active=True,
    )
    db.add(sym)
    await db.commit()
    return sym


@pytest_asyncio.fixture()
async def seeded_inactive_symbol(db: AsyncSession) -> Symbol:
    sym = Symbol(
        id=_ticker_id(),
        ticker="JPYUSD",
        exchange="FX",
        asset_class="forex",
        display_name="JPY / USD (legacy)",
        tick_size=0.0001,
        lot_size=100000.0,
        quote_currency="USD",
        session_tz="Asia/Tokyo",
        active=False,
    )
    db.add(sym)
    await db.commit()
    return sym


# ──────────────────────── symbol list / detail ─────────────────────────


@pytest.mark.asyncio
async def test_list_symbols_filters_inactive_by_default(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_inactive_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/market/symbols", headers={"authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    tickers = {s["ticker"] for s in body["symbols"]}
    assert "EURUSD" in tickers
    assert "JPYUSD" not in tickers
    assert body["total"] == 1


@pytest.mark.asyncio
async def test_list_symbols_includes_inactive_when_asked(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_inactive_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/market/symbols?activeOnly=false",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    tickers = {s["ticker"] for s in res.json()["symbols"]}
    assert tickers == {"EURUSD", "JPYUSD"}


@pytest.mark.asyncio
async def test_list_symbols_unauthenticated_rejected(
    client: AsyncClient, seeded_symbol: Symbol
) -> None:
    res = await client.get("/market/symbols")
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


@pytest.mark.asyncio
async def test_get_symbol_returns_full_dto(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["id"] == seeded_symbol.id
    assert body["assetClass"] == "forex"
    assert body["sessionTz"] == "Europe/London"


@pytest.mark.asyncio
async def test_get_symbol_unknown_id_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/market/symbols/sym_does_not_exist",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "symbol_not_found"


# ───────────────────────── admin create symbol ─────────────────────────


@pytest.mark.asyncio
async def test_admin_can_create_symbol(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/market/symbols",
        headers={"authorization": f"Bearer {token}"},
        json={
            "ticker": "BTCUSD",
            "exchange": "COINBASE",
            "assetClass": "crypto",
            "displayName": "Bitcoin / USD",
            "tickSize": 0.01,
            "quoteCurrency": "USD",
        },
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["ticker"] == "BTCUSD"
    assert body["assetClass"] == "crypto"
    assert body["lotSize"] == 1.0  # default
    assert body["sessionTz"] == "America/New_York"  # default


@pytest.mark.asyncio
async def test_create_symbol_duplicate_conflicts(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/market/symbols",
        headers={"authorization": f"Bearer {token}"},
        json={
            "ticker": seeded_symbol.ticker,
            "exchange": seeded_symbol.exchange,
            "assetClass": "forex",
            "displayName": "duplicate",
            "tickSize": 0.00001,
            "quoteCurrency": "USD",
        },
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "symbol_exists"


@pytest.mark.asyncio
async def test_non_admin_cannot_create_symbol(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    admin_token = await _login(
        client, admin_user["email"], admin_user["password"]
    )
    # provision a viewer
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer@godsview.io",
            "displayName": "Viewer Only",
            "password": "viewer-pass-9876",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer@godsview.io", "viewer-pass-9876"
    )
    res = await client.post(
        "/market/symbols",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={
            "ticker": "ETHUSD",
            "exchange": "COINBASE",
            "assetClass": "crypto",
            "displayName": "Ether / USD",
            "tickSize": 0.01,
            "quoteCurrency": "USD",
        },
    )
    assert res.status_code == 403


# ─────────────────────── structure events route ────────────────────────


@pytest_asyncio.fixture()
async def seeded_events(
    db: AsyncSession, seeded_symbol: Symbol
) -> list[StructureEvent]:
    base = datetime(2026, 4, 18, 10, 0, 0, tzinfo=UTC)
    rows = [
        StructureEvent(
            id=f"se_{i}_{uuid.uuid4().hex}",
            symbol_id=seeded_symbol.id,
            tf="15m",
            kind="bos" if i % 2 == 0 else "choch",
            direction="long",
            level=1.0850 + 0.0010 * i,
            broken_pivot_t=base + timedelta(minutes=15 * (i - 1)),
            broken_pivot_kind="swing_high",
            broken_pivot_price=1.0840 + 0.0010 * i,
            broken_pivot_bar_index=i,
            confirmation_t=base + timedelta(minutes=15 * i),
            confidence=0.6 + 0.05 * i,
        )
        for i in range(3)
    ]
    db.add_all(rows)
    await db.commit()
    return rows


@pytest.mark.asyncio
async def test_list_structure_events_returns_desc_by_confirmation(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_events: list[StructureEvent],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}/structure/events",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 3
    assert len(body["events"]) == 3
    # Newest first.
    confirms = [e["confirmationT"] for e in body["events"]]
    assert confirms == sorted(confirms, reverse=True)
    # Pivot is nested.
    assert body["events"][0]["brokenPivot"]["kind"] == "swing_high"


@pytest.mark.asyncio
async def test_list_structure_events_filters_by_kind(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_events: list[StructureEvent],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}/structure/events?kind=choch",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    kinds = {e["kind"] for e in res.json()["events"]}
    assert kinds == {"choch"}


@pytest.mark.asyncio
async def test_list_structure_events_invalid_tf_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}/structure/events?tf=99h",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_timeframe"


# ─────────────────────────── zones route ───────────────────────────────


@pytest_asyncio.fixture()
async def seeded_zones(
    db: AsyncSession, seeded_symbol: Symbol
) -> dict[str, Any]:
    base = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    active_ob = OrderBlock(
        id=f"ob_active_{uuid.uuid4().hex}",
        symbol_id=seeded_symbol.id,
        tf="15m",
        direction="long",
        high=1.0860,
        low=1.0852,
        t=base,
        strength=0.78,
        retested=False,
        violated=False,
        structure_event_id=None,
    )
    violated_ob = OrderBlock(
        id=f"ob_violated_{uuid.uuid4().hex}",
        symbol_id=seeded_symbol.id,
        tf="15m",
        direction="long",
        high=1.0820,
        low=1.0815,
        t=base - timedelta(hours=1),
        strength=0.61,
        retested=True,
        violated=True,
        structure_event_id=None,
    )
    active_fvg = Fvg(
        id=f"fvg_active_{uuid.uuid4().hex}",
        symbol_id=seeded_symbol.id,
        tf="15m",
        direction="long",
        top=1.0900,
        bottom=1.0890,
        t=base + timedelta(minutes=15),
        mitigated=False,
        mitigated_at=None,
    )
    mitigated_fvg = Fvg(
        id=f"fvg_mit_{uuid.uuid4().hex}",
        symbol_id=seeded_symbol.id,
        tf="15m",
        direction="short",
        top=1.0830,
        bottom=1.0825,
        t=base - timedelta(minutes=15),
        mitigated=True,
        mitigated_at=base,
    )
    db.add_all([active_ob, violated_ob, active_fvg, mitigated_fvg])
    await db.commit()
    return {
        "active_ob": active_ob.id,
        "violated_ob": violated_ob.id,
        "active_fvg": active_fvg.id,
        "mitigated_fvg": mitigated_fvg.id,
    }


@pytest.mark.asyncio
async def test_zones_default_excludes_inactive(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_zones: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}/structure/zones",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    ob_ids = {o["id"] for o in body["orderBlocks"]}
    fvg_ids = {g["id"] for g in body["fvgs"]}
    assert ob_ids == {seeded_zones["active_ob"]}
    assert fvg_ids == {seeded_zones["active_fvg"]}


@pytest.mark.asyncio
async def test_zones_include_inactive_returns_all(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_zones: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        (
            f"/market/symbols/{seeded_symbol.id}/structure/zones"
            "?includeInactive=true"
        ),
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert len(body["orderBlocks"]) == 2
    assert len(body["fvgs"]) == 2


# ─────────────────────── market context route ──────────────────────────


@pytest.mark.asyncio
async def test_context_404_when_no_snapshot(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}/context",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "context_not_found"


# ───────────────────── publish quote (admin) ───────────────────────────


@pytest.mark.asyncio
async def test_publish_quote_fans_out_through_hub(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    """POST /market/quotes hands the message to the hub. With no
    subscribers attached the delivered count is 0 and the request still
    returns 202."""

    from app.realtime import get_quote_hub
    from app.realtime.quotes import reset_quote_hub_for_tests

    reset_quote_hub_for_tests()
    hub = get_quote_hub()

    class _Sub:
        def __init__(self, cid: str) -> None:
            self.connection_id = cid
            self.received: list[dict[str, Any]] = []

        async def send_json(self, msg: dict[str, Any]) -> None:
            self.received.append(msg)

    sub = _Sub("test-ws")
    await hub.subscribe(sub, [seeded_symbol.id])

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/market/quotes",
        headers={"authorization": f"Bearer {token}"},
        json={
            "symbolId": seeded_symbol.id,
            "bid": 1.0849,
            "ask": 1.0851,
            "last": 1.0850,
            "bidSize": 10.0,
            "askSize": 10.0,
            "t": "2026-04-19T12:00:00+00:00",
        },
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["delivered"] == 1
    assert body["symbolId"] == seeded_symbol.id
    assert sub.received[0]["type"] == "quote"
    assert sub.received[0]["data"]["last"] == 1.0850
    reset_quote_hub_for_tests()


@pytest.mark.asyncio
async def test_publish_quote_unknown_symbol_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/market/quotes",
        headers={"authorization": f"Bearer {token}"},
        json={
            "symbolId": "sym_does_not_exist",
            "bid": 1.0,
            "ask": 1.0,
            "last": 1.0,
            "bidSize": 0.0,
            "askSize": 0.0,
            "t": "2026-04-19T12:00:00+00:00",
        },
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "symbol_not_found"


@pytest.mark.asyncio
async def test_publish_quote_viewer_forbidden(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    admin_token = await _login(
        client, admin_user["email"], admin_user["password"]
    )
    await client.post(
        "/admin/users",
        headers={"authorization": f"Bearer {admin_token}"},
        json={
            "email": "viewer-quote@godsview.io",
            "displayName": "Viewer Only",
            "password": "viewer-pass-9876",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer-quote@godsview.io", "viewer-pass-9876"
    )
    res = await client.post(
        "/market/quotes",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={
            "symbolId": seeded_symbol.id,
            "bid": 1.0,
            "ask": 1.0,
            "last": 1.0,
            "bidSize": 0.0,
            "askSize": 0.0,
            "t": "2026-04-19T12:00:00+00:00",
        },
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_context_returns_latest_snapshot(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    older = MarketContext(
        id=f"mc_{uuid.uuid4().hex}",
        symbol_id=seeded_symbol.id,
        htf_bias="long",
        ltf_bias="long",
        conflict=False,
        recent_events=[],
        active_order_blocks=[],
        active_fvgs=[],
        generated_at=datetime(2026, 4, 18, 10, 0, 0, tzinfo=UTC),
    )
    newer = MarketContext(
        id=f"mc_{uuid.uuid4().hex}",
        symbol_id=seeded_symbol.id,
        htf_bias="long",
        ltf_bias="short",
        conflict=True,
        recent_events=[{"id": "se_demo"}],
        active_order_blocks=[{"id": "ob_demo"}],
        active_fvgs=[],
        generated_at=datetime(2026, 4, 18, 11, 0, 0, tzinfo=UTC),
    )
    db.add_all([older, newer])
    await db.commit()

    res = await client.get(
        f"/market/symbols/{seeded_symbol.id}/context",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["htfBias"] == "long"
    assert body["ltfBias"] == "short"
    assert body["conflict"] is True
    assert body["recentEvents"][0]["id"] == "se_demo"
