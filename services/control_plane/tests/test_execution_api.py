"""Tests for the Phase 3 PR8 execution gate routes.

Covers:
* POST /setups/{id}/approve — auth gate, gate rejections (live mode,
  low confidence, capacity caps, kill-switch flag, expired setup,
  duplicate active trade), happy path creates PaperTrade + flips
  Setup.status to 'approved_paper'.
* GET  /paper-trades         — auth, filters (symbol, setupId,
  status, fromTs/toTs), pagination.
* GET  /paper-trades/{id}    — auth, 404, 200.
* PATCH /paper-trades/{id}/status — admin gate, valid transitions,
  409 on bad transition, terminal close writes Setup + recall record.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FeatureFlag, PaperTrade, Setup, Symbol
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


def _seed_setup(
    *,
    symbol_id: str,
    status: str = "detected",
    confidence: float = 0.7,
    expires_in: timedelta = timedelta(minutes=30),
    direction: str = "long",
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
        history_score=0.5,
        history_count=0,
        reasoning="seeded for PR8 tests",
        structure_event_ids=[],
        order_flow_event_ids=[],
    )


@pytest_asyncio.fixture(autouse=True)
async def _reset_recall():
    reset_recall_store()
    yield
    reset_recall_store()


# ─────────────────────────────── auth ───────────────────────────────


@pytest.mark.asyncio
async def test_approve_requires_auth(client: AsyncClient):
    res = await client.post("/setups/stp_x/approve", json={"mode": "paper"})
    assert res.status_code == 401, res.text


@pytest.mark.asyncio
async def test_list_paper_trades_requires_auth(client: AsyncClient):
    res = await client.get("/paper-trades")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_get_paper_trade_requires_auth(client: AsyncClient):
    res = await client.get("/paper-trades/pap_does_not_exist")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_patch_paper_trade_requires_admin(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
):
    from app.models import User
    from app.security import hash_password

    plain = "viewer-pw-pr8"
    viewer = User(
        id=f"usr_{uuid.uuid4().hex}",
        email="viewer-pr8@godsview.io",
        display_name="Viewer",
        password_hash=hash_password(plain),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(viewer)
    await db.commit()
    token = await _login(client, viewer.email, plain)
    res = await client.patch(
        "/paper-trades/pap_x/status",
        json={"status": "filled"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 403, res.text


# ─────────────────────────────── approve flow ────────────────────────


@pytest.mark.asyncio
async def test_approve_setup_creates_paper_trade(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.8)
    db.add(setup)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{setup.id}/approve",
        json={"mode": "paper"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["approved"] is True
    assert body["reason"] == "approved"
    pt = body["paperTrade"]
    assert pt["setupId"] == setup.id
    assert pt["status"] == "pending_fill"
    assert pt["sizeMultiplier"] == 1.0
    assert pt["approvedByUserId"] == admin_user["id"]
    # Setup row flipped
    await db.refresh(setup)
    assert setup.status == "approved_paper"


@pytest.mark.asyncio
async def test_approve_with_size_override(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id)
    db.add(setup)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{setup.id}/approve",
        json={
            "mode": "paper",
            "overrideRisk": {"sizeMultiplier": 0.5, "note": "half-size"},
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["paperTrade"]["sizeMultiplier"] == 0.5


@pytest.mark.asyncio
async def test_approve_404_when_setup_missing(
    client: AsyncClient,
    admin_user: dict[str, Any],
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/setups/stp_missing/approve",
        json={"mode": "paper"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404, res.text


@pytest.mark.asyncio
async def test_approve_live_mode_blocked(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.9)
    db.add(setup)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{setup.id}/approve",
        json={"mode": "live"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_live_disallowed"


@pytest.mark.asyncio
async def test_approve_blocked_by_kill_switch(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.9)
    db.add(setup)
    db.add(
        FeatureFlag(
            key="execution.kill_switch",
            enabled=True,
            description="kill switch on for tests",
            scope="global",
            scope_ref=None,
            updated_by="test",
        )
    )
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{setup.id}/approve",
        json={"mode": "paper"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_kill_switch_active"


@pytest.mark.asyncio
async def test_approve_blocked_by_low_confidence(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.10)
    db.add(setup)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{setup.id}/approve",
        json={"mode": "paper"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_confidence_below_threshold"


@pytest.mark.asyncio
async def test_approve_blocked_by_per_symbol_cap(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    # Pre-load 3 active paper trades for this symbol on *other* setups,
    # which is the per-symbol cap.
    other_setups = [
        _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
        for _ in range(3)
    ]
    for s in other_setups:
        db.add(s)
    await db.flush()
    for s in other_setups:
        db.add(
            PaperTrade(
                setup_id=s.id,
                symbol_id=seeded_symbol.id,
                direction="long",
                entry_ref=s.entry_ref,
                stop_loss=s.stop_loss,
                take_profit=s.take_profit,
                size_multiplier=1.0,
                status="pending_fill",
                approved_by_user_id=admin_user["id"],
            )
        )
    fresh = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.9)
    db.add(fresh)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{fresh.id}/approve",
        json={"mode": "paper"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_per_symbol_cap_exceeded"


@pytest.mark.asyncio
async def test_approve_blocked_by_duplicate_active_trade(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, confidence=0.9)
    db.add(setup)
    await db.flush()
    db.add(
        PaperTrade(
            setup_id=setup.id,
            symbol_id=seeded_symbol.id,
            direction="long",
            entry_ref=setup.entry_ref,
            stop_loss=setup.stop_loss,
            take_profit=setup.take_profit,
            size_multiplier=1.0,
            status="pending_fill",
            approved_by_user_id=admin_user["id"],
        )
    )
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        f"/setups/{setup.id}/approve",
        json={"mode": "paper"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "gate_duplicate_active_trade"


# ───────────────────────── list / detail ────────────────────────────


@pytest.mark.asyncio
async def test_list_paper_trades_paginates(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    # Seed 4 paper trades across 2 setups
    rows: list[PaperTrade] = []
    for i in range(4):
        s = _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
        db.add(s)
        await db.flush()
        rows.append(
            PaperTrade(
                setup_id=s.id,
                symbol_id=seeded_symbol.id,
                direction="long",
                entry_ref=1.1,
                stop_loss=1.09,
                take_profit=1.12,
                size_multiplier=1.0,
                status="pending_fill",
                approved_by_user_id=admin_user["id"],
                approved_at=datetime.now(UTC) - timedelta(minutes=i),
            )
        )
    for pt in rows:
        db.add(pt)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])

    res = await client.get(
        "/paper-trades?limit=2",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 4
    assert body["limit"] == 2
    assert len(body["trades"]) == 2


@pytest.mark.asyncio
async def test_list_paper_trades_filters_by_status(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    s_open = _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
    s_done = _seed_setup(symbol_id=seeded_symbol.id, status="closed")
    db.add_all([s_open, s_done])
    await db.flush()
    db.add(
        PaperTrade(
            setup_id=s_open.id,
            symbol_id=seeded_symbol.id,
            direction="long",
            entry_ref=1.1,
            stop_loss=1.0,
            take_profit=1.2,
            size_multiplier=1.0,
            status="pending_fill",
            approved_by_user_id=admin_user["id"],
        )
    )
    db.add(
        PaperTrade(
            setup_id=s_done.id,
            symbol_id=seeded_symbol.id,
            direction="long",
            entry_ref=1.1,
            stop_loss=1.0,
            take_profit=1.2,
            size_multiplier=1.0,
            status="won",
            approved_by_user_id=admin_user["id"],
            closed_at=datetime.now(UTC),
            pnl_r=1.5,
        )
    )
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/paper-trades?status=won",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["trades"][0]["status"] == "won"


@pytest.mark.asyncio
async def test_get_paper_trade_404(
    client: AsyncClient,
    admin_user: dict[str, Any],
):
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/paper-trades/pap_missing",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404


# ───────────────────────── status PATCH ─────────────────────────────


@pytest.mark.asyncio
async def test_patch_paper_trade_pending_to_filled(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
    db.add(setup)
    await db.flush()
    pt = PaperTrade(
        setup_id=setup.id,
        symbol_id=seeded_symbol.id,
        direction="long",
        entry_ref=1.1,
        stop_loss=1.0,
        take_profit=1.2,
        size_multiplier=1.0,
        status="pending_fill",
        approved_by_user_id=admin_user["id"],
    )
    db.add(pt)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/paper-trades/{pt.id}/status",
        json={"status": "filled"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "filled"
    await db.refresh(pt)
    assert pt.filled_at is not None


@pytest.mark.asyncio
async def test_patch_paper_trade_invalid_transition(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
    db.add(setup)
    await db.flush()
    pt = PaperTrade(
        setup_id=setup.id,
        symbol_id=seeded_symbol.id,
        direction="long",
        entry_ref=1.1,
        stop_loss=1.0,
        take_profit=1.2,
        size_multiplier=1.0,
        status="pending_fill",
        approved_by_user_id=admin_user["id"],
    )
    db.add(pt)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    # pending_fill → won is illegal — must go pending_fill → filled → won
    res = await client.patch(
        f"/paper-trades/{pt.id}/status",
        json={"status": "won", "pnlR": 1.0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409, res.text
    assert res.json()["error"]["code"] == "paper_trade_invalid_transition"


@pytest.mark.asyncio
async def test_patch_paper_trade_terminal_already(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, status="closed")
    db.add(setup)
    await db.flush()
    pt = PaperTrade(
        setup_id=setup.id,
        symbol_id=seeded_symbol.id,
        direction="long",
        entry_ref=1.1,
        stop_loss=1.0,
        take_profit=1.2,
        size_multiplier=1.0,
        status="won",
        approved_by_user_id=admin_user["id"],
        closed_at=datetime.now(UTC),
        pnl_r=2.0,
    )
    db.add(pt)
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/paper-trades/{pt.id}/status",
        json={"status": "lost", "pnlR": -1.0},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "paper_trade_terminal"


@pytest.mark.asyncio
async def test_patch_paper_trade_close_writes_recall_and_setup(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
    db.add(setup)
    await db.flush()
    pt = PaperTrade(
        setup_id=setup.id,
        symbol_id=seeded_symbol.id,
        direction="long",
        entry_ref=1.1,
        stop_loss=1.0,
        take_profit=1.2,
        size_multiplier=1.0,
        status="filled",
        approved_by_user_id=admin_user["id"],
    )
    db.add(pt)
    await db.commit()

    store = get_recall_store()
    assert store.size() == 0

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/paper-trades/{pt.id}/status",
        json={"status": "won", "pnlR": 1.5},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "won"
    assert body["pnlR"] == 1.5
    assert body["closedAt"] is not None

    # Setup row closed out
    await db.refresh(setup)
    assert setup.status == "closed"
    assert setup.closed_pnl_r == 1.5
    # Recall store now has a memory row
    assert store.size() == 1


@pytest.mark.asyncio
async def test_patch_paper_trade_cancel_does_not_write_recall_win(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
):
    setup = _seed_setup(symbol_id=seeded_symbol.id, status="approved_paper")
    db.add(setup)
    await db.flush()
    pt = PaperTrade(
        setup_id=setup.id,
        symbol_id=seeded_symbol.id,
        direction="long",
        entry_ref=1.1,
        stop_loss=1.0,
        take_profit=1.2,
        size_multiplier=1.0,
        status="pending_fill",
        approved_by_user_id=admin_user["id"],
    )
    db.add(pt)
    await db.commit()
    store = get_recall_store()
    assert store.size() == 0
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.patch(
        f"/paper-trades/{pt.id}/status",
        json={"status": "cancelled"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    # Cancellation still writes a recall record but with scratch outcome.
    assert store.size() == 1
