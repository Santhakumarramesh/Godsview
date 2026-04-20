"""Tests for /v1/quant/replay — Phase 5 PR5 replay surface.

Covers:

* POST /quant/replay                       — admin gate, validations, happy path.
* GET  /quant/replay + /quant/replay/:id   — list + detail.
* GET  /quant/replay/:id/frames            — paginated frame read.
* GET  /quant/replay/:id/stream            — SSE headers + event prefix.
* POST /quant/replay/:id/cancel            — admin + terminal-state guard.
* Engine determinism                       — identical frame stream across reruns.

The replay engine is pure + deterministic (same inputs → identical
frame sequence). We seed a synthetic uptrend bar window, run two
replays on the same range, and assert frame counts + decision actions
match byte-for-byte.
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
        ticker="REPLAYUSD",
        exchange="FX",
        asset_class="forex",
        display_name="Replay / US Dollar",
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
    count: int = 60,
    start_price: float = 1.20,
) -> tuple[datetime, datetime]:
    """Seed deterministic bars with a clear uptrend drift.

    Returns ``(start_ts, end_ts)`` covering the seeded window.
    """

    start_ts = datetime(2026, 3, 1, 0, 0, tzinfo=UTC)
    price = start_price
    for i in range(count):
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
            v=1000.0 + (i % 10) * 50.0,
            closed=True,
        )
        db.add(bar)
        price = c
    await db.commit()
    return start_ts, start_ts + timedelta(hours=count - 1)


def _replay_payload(
    symbol_id: str,
    *,
    start_at: datetime,
    end_at: datetime,
    tf: str = "1h",
    step_ms: int = 0,
) -> dict[str, Any]:
    return {
        "symbolId": symbol_id,
        "startAt": start_at.isoformat(),
        "endAt": end_at.isoformat(),
        "tf": tf,
        "stepMs": step_ms,
        "withLiveGate": False,
    }


# ─────────────────────────── auth / validation ──────────────────────────


@pytest.mark.asyncio
async def test_create_replay_requires_admin(
    client: AsyncClient,
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id)
    res = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
    )
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_create_replay_invalid_window(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    end = datetime(2026, 3, 1, tzinfo=UTC)
    start = end + timedelta(hours=1)  # end < start
    res = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_window"


@pytest.mark.asyncio
async def test_create_replay_requires_target(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start = datetime(2026, 3, 1, tzinfo=UTC)
    end = start + timedelta(hours=24)
    # neither setupId nor symbolId
    payload = {
        "startAt": start.isoformat(),
        "endAt": end.isoformat(),
        "tf": "1h",
        "stepMs": 0,
        "withLiveGate": False,
    }
    res = await client.post("/quant/replay", json=payload, headers=headers)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_target"


@pytest.mark.asyncio
async def test_create_replay_rejects_both_targets(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start = datetime(2026, 3, 1, tzinfo=UTC)
    end = start + timedelta(hours=24)
    payload = {
        "setupId": "stp_fake",
        "symbolId": seeded_symbol.id,
        "startAt": start.isoformat(),
        "endAt": end.isoformat(),
        "tf": "1h",
        "stepMs": 0,
        "withLiveGate": False,
    }
    res = await client.post("/quant/replay", json=payload, headers=headers)
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_target"


@pytest.mark.asyncio
async def test_create_replay_unknown_symbol(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start = datetime(2026, 3, 1, tzinfo=UTC)
    end = start + timedelta(hours=24)
    res = await client.post(
        "/quant/replay",
        json=_replay_payload(
            "sym_does_not_exist", start_at=start, end_at=end
        ),
        headers=headers,
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "symbol_not_found"


@pytest.mark.asyncio
async def test_create_replay_empty_window_rejected(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    # Symbol exists but no bars seeded → no_bars
    start = datetime(2026, 3, 1, tzinfo=UTC)
    end = start + timedelta(hours=24)
    res = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "no_bars"


# ─────────────────────────── happy path ────────────────────────────────


@pytest.mark.asyncio
async def test_create_replay_happy_path(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id, count=60)
    res = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    assert res.status_code == 201, res.text
    body = res.json()
    assert body["status"] == "completed"
    assert body["totalFrames"] == 60
    assert body["completedAt"] is not None
    assert body["error"] is None
    run_id = body["id"]

    # detail
    detail = await client.get(f"/quant/replay/{run_id}", headers=headers)
    assert detail.status_code == 200
    assert detail.json()["id"] == run_id
    assert detail.json()["totalFrames"] == 60

    # frames list
    frames = await client.get(
        f"/quant/replay/{run_id}/frames?offset=0&limit=10", headers=headers
    )
    assert frames.status_code == 200
    frames_body = frames.json()
    assert frames_body["replayRunId"] == run_id
    assert frames_body["total"] == 60
    assert len(frames_body["frames"]) == 10
    # First frame should have structure/orderFlow/decision envelopes
    frame0 = frames_body["frames"][0]
    assert "structure" in frame0
    assert "orderFlow" in frame0
    assert "decision" in frame0
    assert frame0["symbolId"] == seeded_symbol.id
    assert frame0["tf"] == "1h"
    # hypotheticalPnLR should be populated on every *entry* frame after
    # the back-fill pass; the first few frames are pre-history so they
    # are usually action=none.
    assert frame0["decision"]["action"] in (
        "none",
        "enter_long",
        "enter_short",
        "exit",
    )


# ─────────────────────────── determinism ───────────────────────────────


@pytest.mark.asyncio
async def test_replay_is_deterministic(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    """Two replays over the same window must produce identical frame
    streams — that's the contract the learning loop (PR8) depends on."""

    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id, count=60)

    res1 = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    res2 = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    assert res1.status_code == 201 and res2.status_code == 201

    async def _all_frames(run_id: str) -> list[dict[str, Any]]:
        r = await client.get(
            f"/quant/replay/{run_id}/frames?offset=0&limit=5000",
            headers=headers,
        )
        assert r.status_code == 200
        return r.json()["frames"]

    f1 = await _all_frames(res1.json()["id"])
    f2 = await _all_frames(res2.json()["id"])
    assert len(f1) == len(f2) == 60

    actions1 = [f["decision"]["action"] for f in f1]
    actions2 = [f["decision"]["action"] for f in f2]
    assert actions1 == actions2

    # Confidence values on decision frames should also match exactly
    conf1 = [f["decision"].get("confidence") for f in f1]
    conf2 = [f["decision"].get("confidence") for f in f2]
    assert conf1 == conf2

    # At least some frames should have produced real decisions on the
    # uptrending synthetic window.
    assert any(a in ("enter_long", "enter_short") for a in actions1)


# ─────────────────────────── list filters ─────────────────────────────


@pytest.mark.asyncio
async def test_list_replays_filters_by_status(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id, count=40)
    created = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    assert created.status_code == 201
    run_id = created.json()["id"]

    listed = await client.get("/quant/replay?status=completed", headers=headers)
    assert listed.status_code == 200
    ids = [r["id"] for r in listed.json()["runs"]]
    assert run_id in ids
    for run in listed.json()["runs"]:
        assert run["status"] == "completed"

    invalid = await client.get("/quant/replay?status=bogus", headers=headers)
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_status"


# ─────────────────────────── SSE stream ───────────────────────────────


@pytest.mark.asyncio
async def test_replay_stream_emits_sse(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id, count=30)
    created = await client.post(
        "/quant/replay",
        json=_replay_payload(
            seeded_symbol.id,
            start_at=start,
            end_at=end,
            step_ms=0,  # no artificial delay for the test
        ),
        headers=headers,
    )
    assert created.status_code == 201
    run_id = created.json()["id"]

    res = await client.get(f"/quant/replay/{run_id}/stream", headers=headers)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    text = res.text
    # Header + footer bookends + at least one frame event
    assert "event: replay.start" in text
    assert "event: replay.frame" in text
    assert "event: replay.end" in text


# ─────────────────────────── cancel ────────────────────────────────────


@pytest.mark.asyncio
async def test_cancel_replay_requires_admin(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id, count=30)
    created = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    run_id = created.json()["id"]

    # Anonymous cancel → 401
    res = await client.post(f"/quant/replay/{run_id}/cancel")
    assert res.status_code == 401


@pytest.mark.asyncio
async def test_cancel_replay_terminal_state_conflict(
    client: AsyncClient,
    admin_user: dict[str, Any],
    seeded_symbol: Symbol,
    db: AsyncSession,
) -> None:
    """Synchronous replays finish ``completed`` before returning, so a
    follow-up cancel must 409."""

    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    start, end = await _seed_bars(db, symbol_id=seeded_symbol.id, count=30)
    created = await client.post(
        "/quant/replay",
        json=_replay_payload(seeded_symbol.id, start_at=start, end_at=end),
        headers=headers,
    )
    run_id = created.json()["id"]

    res = await client.post(f"/quant/replay/{run_id}/cancel", headers=headers)
    assert res.status_code == 409
    assert res.json()["error"]["code"] == "replay_terminal"


@pytest.mark.asyncio
async def test_cancel_replay_unknown(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.post(
        "/quant/replay/rp_does_not_exist/cancel", headers=headers
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "replay_not_found"


# ─────────────────────────── frames 404 ───────────────────────────────


@pytest.mark.asyncio
async def test_list_frames_unknown_replay(
    client: AsyncClient,
    admin_user: dict[str, Any],
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    headers = {"Authorization": f"Bearer {token}"}
    res = await client.get(
        "/quant/replay/rp_does_not_exist/frames", headers=headers
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "replay_not_found"
