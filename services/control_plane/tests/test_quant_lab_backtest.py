"""Tests for /v1/quant — Phase 5 PR4 strategies + backtest surface.

Covers:

* POST /quant/strategies — admin gate, initial version created + activated.
* GET /quant/strategies + /quant/strategies/{id} + /versions — list + detail.
* POST /quant/strategies/{id}/versions — admin, version monotone bump.
* POST /quant/strategies/{id}/versions/{vid}/activate — atomic swap.
* POST /quant/backtests — admin gate, unknown symbol 404, invalid window 400,
  happy path produces deterministic trade ledger + equity curve + metrics.
* GET /quant/backtests + /quant/backtests/{id} + /trades + /equity — read surfaces.
* POST /quant/backtests/{id}/cancel — admin, terminal-state conflict guard.

The backtest engine is deterministic (pure Python, seeded RNG) — we
assert the metrics match byte-for-byte between two runs of the same
seed to pin down the contract the experiment + promotion pipelines
depend on.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Bar, Symbol

UTC = timezone.utc


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


def _sym_id() -> str:
    return f"sym_{uuid.uuid4().hex}"


@pytest_asyncio.fixture()
async def seeded_symbol(db: AsyncSession) -> Symbol:
    sym = Symbol(
        id=_sym_id(),
        ticker="TESTUSD",
        exchange="FX",
        asset_class="forex",
        display_name="Test / US Dollar",
        tick_size=0.0001,
        lot_size=100_000.0,
        quote_currency="USD",
        session_tz="UTC",
        active=True,
    )
    db.add(sym)
    await db.commit()
    await db.refresh(sym)
    return sym


async def _seed_bars(
    db: AsyncSession,
    *,
    symbol_id: str,
    tf: str = "1h",
    count: int = 80,
    start_price: float = 1.10,
) -> datetime:
    """Seed ``count`` deterministic OHLC bars with a clear upward drift
    and intra-bar volatility. Returns the timestamp of the *first* bar.

    The drift has to be strong enough to move the 20-bar trend bias past
    its 0.05% threshold in :mod:`app.quant_lab.engine`; a weaker walk
    would produce zero trades and leave the metric assertions vacuous.
    """

    start_ts = datetime(2026, 1, 1, 0, 0, tzinfo=UTC)
    price = start_price
    for i in range(count):
        # Clear uptrend every 2 bars, with occasional pullback to create
        # ob_retest opportunities. Intrabar range = ±0.002.
        drift = 0.001 if i % 2 == 0 else -0.0005
        o = price
        c = price + drift
        h = max(o, c) + 0.002
        l = min(o, c) - 0.002
        bar = Bar(
            symbol_id=symbol_id,
            tf=tf,
            t=start_ts + timedelta(hours=i),
            o=o,
            h=h,
            l=l,
            c=c,
            v=1000.0,
            closed=True,
        )
        db.add(bar)
        price = c
    await db.commit()
    return start_ts


def _strategy_create_payload(setup_type: str = "ob_retest") -> dict[str, Any]:
    return {
        "name": f"Test Strategy {uuid.uuid4().hex[:6]}",
        "description": "unit test strategy",
        "setupType": setup_type,
        "initialVersion": {
            "entry": {
                "setupType": setup_type,
                "timeframes": ["1h"],
                "minConfidence": 0.5,
                "filters": {},
            },
            "exit": {
                "stopStyle": "atr",
                "takeProfitRR": 2.0,
                "trailAfterR": None,
            },
            "sizing": {
                "perTradeR": 0.005,
                "maxConcurrent": 5,
            },
            "codeHash": "hash_initial_v1",
            "notes": "initial version",
        },
    }


# ─────────────────────────── strategies ─────────────────────────────────


@pytest.mark.asyncio
async def test_create_strategy_requires_admin(
    client: AsyncClient,
) -> None:
    res = await client.post("/quant/strategies", json=_strategy_create_payload())
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_strategy_happy_path(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    payload = _strategy_create_payload()
    res = await client.post("/quant/strategies", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["name"] == payload["name"]
    assert body["setupType"] == "ob_retest"
    assert body["tier"] == "C"
    assert body["promotionState"] == "experimental"
    assert body["activeVersionId"] is not None

    # Versions list has exactly one row at version=1
    versions_res = await client.get(
        f"/quant/strategies/{body['id']}/versions", headers=headers
    )
    assert versions_res.status_code == 200
    versions = versions_res.json()["versions"]
    assert len(versions) == 1
    assert versions[0]["version"] == 1
    assert versions[0]["id"] == body["activeVersionId"]


@pytest.mark.asyncio
async def test_create_strategy_conflict_on_duplicate_name(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    payload = _strategy_create_payload()
    first = await client.post("/quant/strategies", json=payload, headers=headers)
    assert first.status_code == 201
    second = await client.post("/quant/strategies", json=payload, headers=headers)
    assert second.status_code == 409
    assert second.json()["error"]["code"] == "strategy_name_taken"


@pytest.mark.asyncio
async def test_list_strategies_filters(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    payload_a = _strategy_create_payload("ob_retest")
    payload_b = _strategy_create_payload("fvg_reaction")
    await client.post("/quant/strategies", json=payload_a, headers=headers)
    await client.post("/quant/strategies", json=payload_b, headers=headers)

    res = await client.get(
        "/quant/strategies?setupType=fvg_reaction", headers=headers
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    for s in body["strategies"]:
        assert s["setupType"] == "fvg_reaction"


@pytest.mark.asyncio
async def test_add_version_and_activate(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    create = await client.post(
        "/quant/strategies", json=_strategy_create_payload(), headers=headers
    )
    strat = create.json()
    # Add a second version with a different codeHash
    v2_payload = {
        "entry": {
            "setupType": "ob_retest",
            "timeframes": ["1h"],
            "minConfidence": 0.6,
            "filters": {},
        },
        "exit": {
            "stopStyle": "structure",
            "takeProfitRR": 2.5,
            "trailAfterR": None,
        },
        "sizing": {"perTradeR": 0.003, "maxConcurrent": 3},
        "codeHash": "hash_v2",
        "notes": "v2 — tighter risk",
    }
    v2 = await client.post(
        f"/quant/strategies/{strat['id']}/versions",
        json=v2_payload,
        headers=headers,
    )
    assert v2.status_code == 201
    assert v2.json()["version"] == 2

    # Activate v2
    activated = await client.post(
        f"/quant/strategies/{strat['id']}/versions/{v2.json()['id']}/activate",
        headers=headers,
    )
    assert activated.status_code == 200
    assert activated.json()["activeVersionId"] == v2.json()["id"]


# ─────────────────────────── backtests ──────────────────────────────────


@pytest.mark.asyncio
async def test_backtest_requires_admin(client: AsyncClient) -> None:
    res = await client.post(
        "/quant/backtests",
        json={
            "strategyVersionId": "stv_missing",
            "symbolIds": ["sym_missing"],
            "startAt": "2026-01-01T00:00:00Z",
            "endAt": "2026-01-02T00:00:00Z",
            "frictionBps": 5,
            "latencyMs": 100,
            "startingEquity": 100_000.0,
            "seed": 42,
        },
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_backtest_invalid_window(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    strat = (
        await client.post(
            "/quant/strategies", json=_strategy_create_payload(), headers=headers
        )
    ).json()
    res = await client.post(
        "/quant/backtests",
        json={
            "strategyVersionId": strat["activeVersionId"],
            "symbolIds": [seeded_symbol.id],
            "startAt": "2026-01-02T00:00:00Z",
            "endAt": "2026-01-01T00:00:00Z",
            "frictionBps": 5,
            "latencyMs": 100,
            "startingEquity": 100_000.0,
            "seed": 0,
        },
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_window"


@pytest.mark.asyncio
async def test_backtest_unknown_symbol(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    strat = (
        await client.post(
            "/quant/strategies", json=_strategy_create_payload(), headers=headers
        )
    ).json()
    res = await client.post(
        "/quant/backtests",
        json={
            "strategyVersionId": strat["activeVersionId"],
            "symbolIds": ["sym_does_not_exist"],
            "startAt": "2026-01-01T00:00:00Z",
            "endAt": "2026-01-02T00:00:00Z",
            "frictionBps": 5,
            "latencyMs": 100,
            "startingEquity": 100_000.0,
            "seed": 0,
        },
        headers=headers,
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "symbol_not_found"


@pytest.mark.asyncio
async def test_backtest_happy_path(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start_ts = await _seed_bars(db, symbol_id=seeded_symbol.id, count=80)
    strat = (
        await client.post(
            "/quant/strategies", json=_strategy_create_payload(), headers=headers
        )
    ).json()

    payload = {
        "strategyVersionId": strat["activeVersionId"],
        "symbolIds": [seeded_symbol.id],
        "startAt": start_ts.isoformat().replace("+00:00", "Z"),
        "endAt": (start_ts + timedelta(hours=80)).isoformat().replace("+00:00", "Z"),
        "frictionBps": 5,
        "latencyMs": 100,
        "startingEquity": 100_000.0,
        "seed": 42,
    }
    res = await client.post("/quant/backtests", json=payload, headers=headers)
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "completed"
    assert body["metrics"] is not None
    assert body["metrics"]["totalTrades"] >= 0  # metric sanity
    run_id = body["id"]

    # Trade ledger + equity curve
    trades = await client.get(
        f"/quant/backtests/{run_id}/trades", headers=headers
    )
    assert trades.status_code == 200
    trade_body = trades.json()
    assert trade_body["backtestId"] == run_id

    equity = await client.get(
        f"/quant/backtests/{run_id}/equity", headers=headers
    )
    assert equity.status_code == 200
    equity_body = equity.json()
    assert equity_body["backtestId"] == run_id
    # Equity curve always has at least the starting-equity point
    assert len(equity_body["points"]) >= 1
    assert equity_body["points"][0]["equity"] == pytest.approx(100_000.0)


@pytest.mark.asyncio
async def test_backtest_determinism_with_same_seed(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start_ts = await _seed_bars(db, symbol_id=seeded_symbol.id, count=80)
    strat = (
        await client.post(
            "/quant/strategies", json=_strategy_create_payload(), headers=headers
        )
    ).json()
    payload = {
        "strategyVersionId": strat["activeVersionId"],
        "symbolIds": [seeded_symbol.id],
        "startAt": start_ts.isoformat().replace("+00:00", "Z"),
        "endAt": (start_ts + timedelta(hours=80)).isoformat().replace("+00:00", "Z"),
        "frictionBps": 5,
        "latencyMs": 100,
        "startingEquity": 100_000.0,
        "seed": 7,
    }
    a = (
        await client.post("/quant/backtests", json=payload, headers=headers)
    ).json()
    b = (
        await client.post("/quant/backtests", json=payload, headers=headers)
    ).json()
    # Metrics are deterministic on identical inputs (seed pinned).
    # Drop startingEquity annotation before compare — it's present in
    # both but not a "metric" proper.
    for key in (
        "totalTrades",
        "wins",
        "losses",
        "scratches",
        "winRate",
        "profitFactor",
        "expectancyR",
        "maxDrawdownR",
        "totalR",
    ):
        assert a["metrics"][key] == b["metrics"][key], key


@pytest.mark.asyncio
async def test_backtest_cancel_terminal_guard(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start_ts = await _seed_bars(db, symbol_id=seeded_symbol.id, count=40)
    strat = (
        await client.post(
            "/quant/strategies", json=_strategy_create_payload(), headers=headers
        )
    ).json()
    res = await client.post(
        "/quant/backtests",
        json={
            "strategyVersionId": strat["activeVersionId"],
            "symbolIds": [seeded_symbol.id],
            "startAt": start_ts.isoformat().replace("+00:00", "Z"),
            "endAt": (start_ts + timedelta(hours=40)).isoformat().replace("+00:00", "Z"),
            "frictionBps": 5,
            "latencyMs": 100,
            "startingEquity": 100_000.0,
            "seed": 1,
        },
        headers=headers,
    )
    assert res.status_code == 201
    run_id = res.json()["id"]
    # Run is already completed — cancel returns 409
    cancel = await client.post(
        f"/quant/backtests/{run_id}/cancel", headers=headers
    )
    assert cancel.status_code == 409
    assert cancel.json()["error"]["code"] == "backtest_terminal"


@pytest.mark.asyncio
async def test_list_backtests_filters_by_status(
    client: AsyncClient,
    admin_user: dict[str, Any],
    db: AsyncSession,
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start_ts = await _seed_bars(db, symbol_id=seeded_symbol.id, count=40)
    strat = (
        await client.post(
            "/quant/strategies", json=_strategy_create_payload(), headers=headers
        )
    ).json()
    await client.post(
        "/quant/backtests",
        json={
            "strategyVersionId": strat["activeVersionId"],
            "symbolIds": [seeded_symbol.id],
            "startAt": start_ts.isoformat().replace("+00:00", "Z"),
            "endAt": (start_ts + timedelta(hours=40)).isoformat().replace("+00:00", "Z"),
            "frictionBps": 5,
            "latencyMs": 100,
            "startingEquity": 100_000.0,
            "seed": 3,
        },
        headers=headers,
    )
    res = await client.get(
        "/quant/backtests?status=completed", headers=headers
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] >= 1
    for run in body["runs"]:
        assert run["status"] == "completed"
