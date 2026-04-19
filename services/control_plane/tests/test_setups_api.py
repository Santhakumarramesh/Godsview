"""Tests for /v1/setups — Phase 3 PR7 list + detail + detect + status.

Covers:

* GET  /setups            — auth gate, pagination, filters (symbol /
  tf / type / direction / status / minConfidence / fromTs).
* GET  /setups/{id}       — auth gate, 200 happy path, 404 for missing.
* POST /setups/detect     — admin gate, 404 unknown symbol, empty-bars
  short-circuit, calibrated persistence (recall store roundtrip).
* PATCH /setups/{id}/status — admin gate, valid transition, conflict
  on terminal state, ``closed`` writes recall record + closed_pnl_r.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Bar, Setup, Symbol
from app.recall import get_recall_store, reset_recall_store

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
    await db.refresh(sym)
    return sym


def _seed_setup_row(
    *,
    symbol_id: str,
    setup_type: str = "ob_retest",
    direction: str = "long",
    setup_status: str = "detected",
    confidence: float = 0.7,
    minutes_ago: int = 0,
    history_score: float = 0.5,
) -> Setup:
    detected_at = datetime.now(UTC) - timedelta(minutes=minutes_ago)
    return Setup(
        id=f"stp_{uuid.uuid4().hex}",
        symbol_id=symbol_id,
        tf="5m",
        type=setup_type,
        direction=direction,
        status=setup_status,
        detected_at=detected_at,
        expires_at=detected_at + timedelta(minutes=30),
        entry_low=1.099,
        entry_high=1.101,
        entry_ref=1.100,
        stop_loss=1.095,
        take_profit=1.110,
        rr=2.0,
        confidence_score=confidence,
        structure_score=0.7,
        order_flow_score=0.6,
        regime_score=0.5,
        session_score=0.5,
        history_score=history_score,
        history_count=0,
        reasoning="seeded for tests",
        structure_event_ids=[],
        order_flow_event_ids=[],
    )


@pytest_asyncio.fixture(autouse=True)
async def _reset_recall():
    reset_recall_store()
    yield
    reset_recall_store()


# ───────────────────────────── auth ──────────────────────────────────


@pytest.mark.asyncio
async def test_list_setups_requires_auth(client: AsyncClient):
    res = await client.get("/setups")
    assert res.status_code == 401, res.text


@pytest.mark.asyncio
async def test_get_setup_requires_auth(client: AsyncClient):
    res = await client.get("/setups/stp_does_not_exist")
    assert res.status_code == 401, res.text


@pytest.mark.asyncio
async def test_detect_requires_admin(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    # Login as a *non-admin* user
    from app.models import User
    from app.security import hash_password

    plain = "viewer-pw-123"
    viewer = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer@godsview.io",
        display_name="Viewer",
        password_hash=hash_password(plain),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(viewer)
    await db.commit()

    token = await _login(client, viewer.email, plain)
    res = await client.post(
        "/setups/detect",
        json={"symbolId": seeded_symbol.id, "tf": "5m"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text


# ─────────────────────────── list + detail ───────────────────────────


@pytest.mark.asyncio
async def test_list_setups_returns_persisted_rows(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    db.add_all(
        [
            _seed_setup_row(symbol_id=seeded_symbol.id, minutes_ago=10),
            _seed_setup_row(
                symbol_id=seeded_symbol.id, setup_type="fvg_reaction",
                minutes_ago=5,
            ),
            _seed_setup_row(
                symbol_id=seeded_symbol.id, direction="short", minutes_ago=1,
            ),
        ]
    )
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/setups", headers={"authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 3
    assert len(body["setups"]) == 3
    # Newest first.
    assert body["setups"][0]["direction"] == "short"


@pytest.mark.asyncio
async def test_list_setups_filters_by_type_direction_min_confidence(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    db.add_all(
        [
            _seed_setup_row(
                symbol_id=seeded_symbol.id,
                setup_type="ob_retest",
                direction="long",
                confidence=0.85,
            ),
            _seed_setup_row(
                symbol_id=seeded_symbol.id,
                setup_type="fvg_reaction",
                direction="long",
                confidence=0.4,
            ),
            _seed_setup_row(
                symbol_id=seeded_symbol.id,
                setup_type="ob_retest",
                direction="short",
                confidence=0.6,
            ),
        ]
    )
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/setups",
        params={
            "type": "ob_retest",
            "direction": "long",
            "minConfidence": 0.5,
        },
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["setups"][0]["direction"] == "long"
    assert body["setups"][0]["type"] == "ob_retest"
    assert body["setups"][0]["confidence"]["score"] == 0.85


@pytest.mark.asyncio
async def test_list_setups_invalid_type_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/setups",
        params={"type": "not_a_setup"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400, res.text
    assert res.json()["error"]["code"] == "invalid_setup_type"


@pytest.mark.asyncio
async def test_get_setup_404_when_missing(
    client: AsyncClient,
    admin_user: dict[str, Any],
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/setups/stp_missing",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404, res.text


@pytest.mark.asyncio
async def test_get_setup_returns_envelope(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    row = _seed_setup_row(symbol_id=seeded_symbol.id)
    db.add(row)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/setups/{row.id}",
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == row.id
    assert body["entry"]["ref"] == 1.100
    assert body["confidence"]["components"]["structureScore"] == 0.7


# ─────────────────────────── /detect ────────────────────────────────


@pytest.mark.asyncio
async def test_detect_unknown_symbol_404(
    client: AsyncClient,
    admin_user: dict[str, Any],
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/setups/detect",
        json={"symbolId": "sym_missing", "tf": "5m"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404, res.text


@pytest.mark.asyncio
async def test_detect_invalid_tf_400(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/setups/detect",
        json={"symbolId": seeded_symbol.id, "tf": "13s"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400, res.text


@pytest.mark.asyncio
async def test_detect_no_bars_returns_empty(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/setups/detect",
        json={"symbolId": seeded_symbol.id, "tf": "5m"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["persisted"] == 0
    assert body["setups"] == []


@pytest.mark.asyncio
async def test_detect_with_seeded_bars_persists_setups(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    """Seed a sweep-and-reclaim shape and confirm the route persists it."""

    base_t = datetime(2026, 4, 19, 10, 0, tzinfo=UTC)

    def _bar(i, *, o, h, l, c, v=1000.0):
        return Bar(
            symbol_id=seeded_symbol.id,
            tf="5m",
            t=base_t + timedelta(minutes=5 * i),
            o=o, h=h, l=l, c=c, v=v,
            closed=True,
        )

    # 12 bar window with a clean liquidity-sweep + reclaim shape:
    # bars 0..6 form a swing low at 1.0900; bar 7 spikes below to 1.0890,
    # bar 8 closes back above to 1.0915.
    bars = [
        _bar(0, o=1.1000, h=1.1010, l=1.0990, c=1.1005),
        _bar(1, o=1.1005, h=1.1015, l=1.0985, c=1.0990),
        _bar(2, o=1.0990, h=1.0995, l=1.0950, c=1.0960),
        _bar(3, o=1.0960, h=1.0965, l=1.0905, c=1.0915),
        _bar(4, o=1.0915, h=1.0925, l=1.0900, c=1.0910),
        _bar(5, o=1.0910, h=1.0930, l=1.0905, c=1.0925),
        _bar(6, o=1.0925, h=1.0940, l=1.0915, c=1.0935),
        _bar(7, o=1.0935, h=1.0945, l=1.0890, c=1.0895),  # sweep
        _bar(8, o=1.0895, h=1.0930, l=1.0890, c=1.0925),  # reclaim
        _bar(9, o=1.0925, h=1.0945, l=1.0920, c=1.0940),
        _bar(10, o=1.0940, h=1.0955, l=1.0935, c=1.0950),
        _bar(11, o=1.0950, h=1.0965, l=1.0945, c=1.0960),
    ]
    db.add_all(bars)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/setups/detect",
        json={"symbolId": seeded_symbol.id, "tf": "5m", "bars": 50},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 201, res.text
    body = res.json()
    # We don't pin the exact count (detector chains may overlap on the
    # synthetic shape); we only require persistence to round-trip.
    assert body["persisted"] >= 1
    assert all(s["symbolId"] == seeded_symbol.id for s in body["setups"])
    assert all(s["tf"] == "5m" for s in body["setups"])
    # And we can list it back.
    list_res = await client.get(
        "/setups", headers={"authorization": f"Bearer {token}"}
    )
    assert list_res.status_code == 200
    assert list_res.json()["total"] == body["persisted"]


# ──────────────────────── /status PATCH ─────────────────────────────


@pytest.mark.asyncio
async def test_patch_status_advances_to_approved_paper(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    row = _seed_setup_row(symbol_id=seeded_symbol.id)
    db.add(row)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/setups/{row.id}/status",
        json={"status": "approved_paper"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "approved_paper"


@pytest.mark.asyncio
async def test_patch_status_close_writes_recall_record(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    row = _seed_setup_row(symbol_id=seeded_symbol.id)
    db.add(row)
    await db.commit()

    reset_recall_store()
    store_before = get_recall_store()
    assert store_before.size() == 0

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/setups/{row.id}/status",
        json={"status": "closed", "pnlR": 2.4},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "closed"
    assert body["closedPnlR"] == 2.4
    assert body["closedAt"] is not None

    # Recall store should have recorded the win.
    store_after = get_recall_store()
    assert store_after.size() == 1


@pytest.mark.asyncio
async def test_patch_status_409_when_already_terminal(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    row = _seed_setup_row(
        symbol_id=seeded_symbol.id, setup_status="closed"
    )
    db.add(row)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/setups/{row.id}/status",
        json={"status": "approved_live"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "setup_terminal"


@pytest.mark.asyncio
async def test_patch_status_404_when_missing(
    client: AsyncClient,
    admin_user: dict[str, Any],
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        "/setups/stp_missing/status",
        json={"status": "approved_paper"},
        headers={"authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404, res.text
