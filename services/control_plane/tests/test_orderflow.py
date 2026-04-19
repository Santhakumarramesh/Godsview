"""Tests for /v1/orderflow — Phase 3 PR3 ingest + read surface.

Covers:
  * POST /orderflow/ingest — admin gate, empty payload 400, mismatched
    symbolId 400, unknown symbol 404, snapshot-only / deltaBar-only /
    both-together happy paths.
  * GET  /orderflow/symbols/{id}/depth — auth gate, time-window filter.
  * GET  /orderflow/symbols/{id}/delta — auth gate, tf filter, invalid
    tf 400.
  * GET  /orderflow/symbols/{id}/{events,book,state} — empty-envelope
    PR3 stubs (PR4 wires the detector output).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DeltaBar, DepthSnapshot, Symbol

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


def _snapshot_payload(symbol_id: str, t: datetime) -> dict[str, Any]:
    return {
        "symbolId": symbol_id,
        "t": t.isoformat(),
        "bids": [
            {"price": 1.0848, "size": 12.0, "orders": 3},
            {"price": 1.0847, "size": 8.0},
        ],
        "asks": [
            {"price": 1.0852, "size": 11.0},
            {"price": 1.0853, "size": 6.0},
        ],
        "delta": -2.0,
        "last": 1.0850,
        "source": "synthetic",
    }


def _delta_bar_payload(symbol_id: str, t: datetime) -> dict[str, Any]:
    return {
        "symbolId": symbol_id,
        "tf": "1m",
        "t": t.isoformat(),
        "buyVolume": 12.0,
        "sellVolume": 9.0,
        "delta": 3.0,
        "cumulativeDelta": 18.0,
    }


# ─────────────────────────── ingest ────────────────────────────────────


@pytest.mark.asyncio
async def test_ingest_unauthenticated_rejected(
    client: AsyncClient,
    seeded_symbol: Symbol,
) -> None:
    res = await client.post(
        "/orderflow/ingest",
        json={
            "snapshot": _snapshot_payload(
                seeded_symbol.id, datetime.now(UTC)
            )
        },
    )
    assert res.status_code == 401
    assert res.json()["error"]["code"] == "unauthenticated"


@pytest.mark.asyncio
async def test_ingest_empty_payload_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "empty_payload"


@pytest.mark.asyncio
async def test_ingest_mismatched_symbol_id_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    other_id = _ticker_id()
    now = datetime.now(UTC)
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={
            "snapshot": _snapshot_payload(seeded_symbol.id, now),
            "deltaBar": _delta_bar_payload(other_id, now),
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "symbol_id_mismatch"


@pytest.mark.asyncio
async def test_ingest_unknown_symbol_404(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={
            "snapshot": _snapshot_payload(
                "sym_does_not_exist", datetime.now(UTC)
            )
        },
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "symbol_not_found"


@pytest.mark.asyncio
async def test_ingest_snapshot_only_persists(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    t = datetime(2026, 4, 19, 10, 0, 0, tzinfo=UTC)
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={"snapshot": _snapshot_payload(seeded_symbol.id, t)},
    )
    assert res.status_code == 202, res.text
    body = res.json()
    assert body["delivered"] == 0
    assert body["symbolId"] == seeded_symbol.id
    assert body["acceptedAt"]

    from sqlalchemy import select

    rows = (
        await db.scalars(
            select(DepthSnapshot).where(
                DepthSnapshot.symbol_id == seeded_symbol.id
            )
        )
    ).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.last == 1.0850
    assert row.delta == -2.0
    assert row.source == "synthetic"
    assert len(row.bids) == 2
    assert len(row.asks) == 2

    # No delta bar was inserted.
    delta_rows = (
        await db.scalars(
            select(DeltaBar).where(DeltaBar.symbol_id == seeded_symbol.id)
        )
    ).all()
    assert delta_rows == []


@pytest.mark.asyncio
async def test_ingest_delta_bar_only_persists(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    t = datetime(2026, 4, 19, 10, 1, 0, tzinfo=UTC)
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={"deltaBar": _delta_bar_payload(seeded_symbol.id, t)},
    )
    assert res.status_code == 202

    from sqlalchemy import select

    rows = (
        await db.scalars(
            select(DeltaBar).where(DeltaBar.symbol_id == seeded_symbol.id)
        )
    ).all()
    assert len(rows) == 1
    row = rows[0]
    assert row.tf == "1m"
    assert row.buy_volume == 12.0
    assert row.sell_volume == 9.0
    assert row.delta == 3.0
    assert row.cumulative_delta == 18.0


@pytest.mark.asyncio
async def test_ingest_delta_bar_invalid_tf_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    t = datetime(2026, 4, 19, 10, 2, 0, tzinfo=UTC)
    payload = _delta_bar_payload(seeded_symbol.id, t)
    payload["tf"] = "99h"
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={"deltaBar": payload},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_timeframe"


@pytest.mark.asyncio
async def test_ingest_both_payloads_persists(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    t = datetime(2026, 4, 19, 10, 3, 0, tzinfo=UTC)
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {token}"},
        json={
            "snapshot": _snapshot_payload(seeded_symbol.id, t),
            "deltaBar": _delta_bar_payload(seeded_symbol.id, t),
        },
    )
    assert res.status_code == 202

    from sqlalchemy import func, select

    snap_count = await db.scalar(
        select(func.count()).select_from(DepthSnapshot)
    )
    dbar_count = await db.scalar(
        select(func.count()).select_from(DeltaBar)
    )
    assert snap_count == 1
    assert dbar_count == 1


@pytest.mark.asyncio
async def test_ingest_viewer_forbidden(
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
            "email": "viewer-of@godsview.io",
            "displayName": "Viewer Only",
            "password": "viewer-pass-9876",
            "roles": ["viewer"],
        },
    )
    viewer_token = await _login(
        client, "viewer-of@godsview.io", "viewer-pass-9876"
    )
    res = await client.post(
        "/orderflow/ingest",
        headers={"authorization": f"Bearer {viewer_token}"},
        json={
            "snapshot": _snapshot_payload(
                seeded_symbol.id, datetime.now(UTC)
            )
        },
    )
    assert res.status_code == 403


# ───────────────────────── reads ────────────────────────────────────────


@pytest_asyncio.fixture()
async def seeded_depth(
    db: AsyncSession, seeded_symbol: Symbol
) -> list[DepthSnapshot]:
    base = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    rows = [
        DepthSnapshot(
            id=f"dep_{i}_{uuid.uuid4().hex}",
            symbol_id=seeded_symbol.id,
            t=base + timedelta(minutes=i),
            bids=[{"price": 1.084 + 0.0001 * i, "size": 10.0}],
            asks=[{"price": 1.085 + 0.0001 * i, "size": 10.0}],
            delta=float(i),
            last=1.0845 + 0.0001 * i,
            source="synthetic",
        )
        for i in range(5)
    ]
    db.add_all(rows)
    await db.commit()
    return rows


@pytest.mark.asyncio
async def test_get_depth_returns_desc_by_t(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_depth: list[DepthSnapshot],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/depth",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["symbolId"] == seeded_symbol.id
    assert body["total"] == 5
    ts = [s["t"] for s in body["snapshots"]]
    assert ts == sorted(ts, reverse=True)


@pytest.mark.asyncio
async def test_get_depth_time_window_filter(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_depth: list[DepthSnapshot],
) -> None:
    from urllib.parse import quote

    token = await _login(client, admin_user["email"], admin_user["password"])
    base = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    cutoff = quote((base + timedelta(minutes=2)).isoformat(), safe="")
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/depth?fromTs={cutoff}",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 3  # i=2,3,4


@pytest.mark.asyncio
async def test_get_depth_unknown_symbol_404(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/orderflow/symbols/sym_missing/depth",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "symbol_not_found"


@pytest_asyncio.fixture()
async def seeded_delta_bars(
    db: AsyncSession, seeded_symbol: Symbol
) -> list[DeltaBar]:
    base = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    rows = [
        DeltaBar(
            symbol_id=seeded_symbol.id,
            tf="1m",
            t=base + timedelta(minutes=i),
            buy_volume=10.0 + i,
            sell_volume=8.0 + i,
            delta=2.0,
            cumulative_delta=2.0 * (i + 1),
        )
        for i in range(4)
    ]
    db.add_all(rows)
    await db.commit()
    return rows


@pytest.mark.asyncio
async def test_get_delta_bars_returns_asc_by_t(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_delta_bars: list[DeltaBar],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/delta?tf=1m",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["symbolId"] == seeded_symbol.id
    assert body["tf"] == "1m"
    assert len(body["bars"]) == 4
    ts = [b["t"] for b in body["bars"]]
    assert ts == sorted(ts)


@pytest.mark.asyncio
async def test_get_delta_bars_invalid_tf_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/delta?tf=99h",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_timeframe"


@pytest.mark.asyncio
async def test_get_delta_bars_other_tf_filtered_out(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    seeded_delta_bars: list[DeltaBar],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/delta?tf=15m",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["bars"] == []


# ─────────────────────── PR3 stub envelopes ─────────────────────────────


@pytest.mark.asyncio
async def test_events_empty_when_no_bars(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/events",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body == {
        "symbolId": seeded_symbol.id,
        "imbalances": [],
        "absorptions": [],
        "exhaustions": [],
    }


@pytest.mark.asyncio
async def test_events_surfaces_imbalances_from_delta_bars(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    """Seeding a buy-skewed delta-bar run should produce a buy imbalance."""

    base = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    rows = [
        DeltaBar(
            symbol_id=seeded_symbol.id,
            tf="1m",
            t=base + timedelta(minutes=i),
            buy_volume=10.0,
            sell_volume=1.0,
            delta=9.0,
            cumulative_delta=9.0 * (i + 1),
        )
        for i in range(3)
    ]
    db.add_all(rows)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/events?tf=1m",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["imbalances"]) == 1
    ev = body["imbalances"][0]
    assert ev["side"] == "buy"
    assert ev["barCount"] == 3
    assert ev["totalDelta"] == 27.0
    assert 0.0 < ev["confidence"] <= 1.0


@pytest.mark.asyncio
async def test_events_invalid_tf_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/events?tf=99h",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_timeframe"


@pytest.mark.asyncio
async def test_book_stub_returns_empty_walls_clusters(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/book",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["symbolId"] == seeded_symbol.id
    assert body["walls"] == []
    assert body["clusters"] == []
    assert body["asOf"]


@pytest.mark.asyncio
async def test_state_zero_valued_when_no_bars(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/state",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["symbolId"] == seeded_symbol.id
    assert body["lastDelta"] == 0.0
    assert body["cumulativeDelta"] == 0.0
    assert body["activeImbalance"] is None
    assert body["recentAbsorption"] == []
    assert body["recentExhaustion"] == []
    assert body["walls"] == []
    assert body["clusters"] == []
    assert body["netBias"] == "neutral"


@pytest.mark.asyncio
async def test_state_reflects_recent_delta_bars(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    """State endpoint surfaces last_delta + cum_delta + net_bias from rows."""

    base = datetime(2026, 4, 18, 12, 0, 0, tzinfo=UTC)
    rows = [
        DeltaBar(
            symbol_id=seeded_symbol.id,
            tf="1m",
            t=base + timedelta(minutes=i),
            buy_volume=10.0,
            sell_volume=1.0,
            delta=9.0,
            cumulative_delta=9.0 * (i + 1),
        )
        for i in range(3)
    ]
    db.add_all(rows)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/state?tf=1m",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["lastDelta"] == 9.0
    assert body["cumulativeDelta"] == 27.0
    assert body["netBias"] == "long"
    assert body["activeImbalance"] is not None
    assert body["activeImbalance"]["side"] == "buy"


@pytest.mark.asyncio
async def test_state_invalid_tf_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/orderflow/symbols/{seeded_symbol.id}/state?tf=99h",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_timeframe"


@pytest.mark.asyncio
async def test_unknown_symbol_404_for_detector_endpoints(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    for path in ("events", "book", "state"):
        res = await client.get(
            f"/orderflow/symbols/sym_does_not_exist/{path}",
            headers={"authorization": f"Bearer {token}"},
        )
        assert res.status_code == 404, path
        assert res.json()["error"]["code"] == "symbol_not_found"
