"""Tests for /v1/recall — Phase 5 PR7 recall engine HTTP surface.

The Phase 3 PR6 pure-math tests live in ``test_recall.py``; this module
covers the *new* DB-backed + HTTP surface:

* Feature packer determinism + 64-dim envelope
* Cosine similarity edge cases
* Trade memory list / get auth + filters
* Screenshot list / get / admin create
* Missed-trade log + hypothetical-R aggregate
* Similarity search by_features / by_setup / by_live_trade
* 404 paths: unknown trade id, unknown screenshot id
* Admin gate on POST /recall/screenshots
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
    MarketSymbol,
    MissedTrade,
    RecallEmbedding,
    RecallScreenshot,
    RecallTrade,
)
from app.recall.dto import (
    RecallFeaturesDto,
    RecallSearchByFeaturesRequestDto,
    RecallSearchByIdRequestDto,
    RecallSearchByTradeRequestDto,
)
from app.recall.features import (
    RECALL_FEATURE_DIMS,
    cosine_similarity,
    features_to_vector,
    pack_features,
)
from app.recall.repo import (
    ingest_missed_trade,
    ingest_recall_trade,
)


UTC = timezone.utc


async def _login(client: AsyncClient, email: str, password: str) -> str:
    res = await client.post(
        "/auth/login", json={"email": email, "password": password}
    )
    assert res.status_code == 200, res.text
    return res.json()["accessToken"]


async def _ensure_symbol(db: AsyncSession, symbol_id: str) -> None:
    existing = await db.get(MarketSymbol, symbol_id)
    if existing is not None:
        return
    db.add(
        MarketSymbol(
            id=symbol_id,
            broker_symbol=symbol_id,
            display_symbol=symbol_id,
            exchange="TEST",
            asset_class="crypto",
            status="active",
            price_decimals=2,
            tick_size=0.01,
            lot_size=1.0,
        )
    )
    await db.flush()


def _features(
    *,
    symbol_id: str = "BTCUSD",
    tf: str = "1h",
    direction: str = "long",
    setup_type: str = "liquidity_sweep_reclaim",
    trend_sign: int = 1,
    bos_flag: int = 1,
    choch_flag: int = 0,
    sweep_flag: int = 1,
    volatility_bucket: float = 0.5,
    session: str = "ny_am",
    order_flow_sign: int = 1,
    regime: str = "trending",
    confidence_at_detection: float = 0.7,
):
    return pack_features(
        symbol_id=symbol_id,
        tf=tf,
        direction=direction,
        setup_type=setup_type,
        trend_sign=trend_sign,
        bos_flag=bos_flag,
        choch_flag=choch_flag,
        sweep_flag=sweep_flag,
        volatility_bucket=volatility_bucket,
        session=session,
        order_flow_sign=order_flow_sign,
        regime=regime,
        confidence_at_detection=confidence_at_detection,
    )


async def _seed_recall_trade(
    db: AsyncSession,
    *,
    source_id: str,
    symbol_id: str = "BTCUSD",
    outcome: str = "win",
    pnl_r: float | None = 1.25,
    direction: str = "long",
    setup_type: str = "liquidity_sweep_reclaim",
    confidence: float = 0.7,
) -> tuple[RecallTrade, RecallEmbedding]:
    await _ensure_symbol(db, symbol_id)
    features = _features(
        symbol_id=symbol_id,
        direction=direction,
        setup_type=setup_type,
        confidence_at_detection=confidence,
    )
    bundle = await ingest_recall_trade(
        db,
        source_kind="setup",
        source_id=source_id,
        setup_id=source_id,
        symbol_id=symbol_id,
        tf="1h",
        setup_type=setup_type,
        direction=direction,
        detected_at=datetime.now(UTC) - timedelta(hours=2),
        closed_at=datetime.now(UTC) - timedelta(hours=1),
        entry_price=40000.0,
        exit_price=40500.0,
        stop_loss=39800.0,
        take_profit=40500.0,
        outcome=outcome,
        pnl_r=pnl_r,
        features=features,
    )
    return bundle.trade, bundle.embedding  # type: ignore[return-value]


# ─────────────────────────── pure feature tests ─────────────────────────


def test_features_to_vector_is_fixed_length() -> None:
    """Every packed vector is exactly :data:`RECALL_FEATURE_DIMS` long.

    The JSON column on ``RecallEmbedding`` is length-dependent, so a
    drift here would corrupt future reads silently.
    """

    features = _features()
    vec = features_to_vector(features)
    assert len(vec) == RECALL_FEATURE_DIMS
    # Padding slots (34..63) are zero.
    assert all(v == 0.0 for v in vec[34:])


def test_features_to_vector_is_deterministic() -> None:
    """Two packs of the same features produce bit-identical vectors."""

    f = _features()
    assert features_to_vector(f) == features_to_vector(f)


def test_cosine_similarity_self_is_one() -> None:
    f = _features()
    vec = features_to_vector(f)
    assert cosine_similarity(vec, vec) == pytest.approx(1.0)


def test_cosine_similarity_orthogonal_axes() -> None:
    """Long-trending vs short-ranging sit roughly orthogonal.

    The shared slots (tf, volatility bucket) keep the score positive
    but small — asserting ``< 0.5`` pins down the orthogonality
    without fighting the shared background.
    """

    a = _features(direction="long", regime="trending", trend_sign=1)
    b = _features(direction="short", regime="ranging", trend_sign=-1)
    sim = cosine_similarity(features_to_vector(a), features_to_vector(b))
    assert 0.0 <= sim < 0.5


def test_cosine_similarity_empty_returns_zero() -> None:
    assert cosine_similarity([], [1, 2, 3]) == 0.0
    assert cosine_similarity([1, 2, 3], []) == 0.0


def test_features_wire_projection_matches_dto() -> None:
    """The structured projection round-trips through :class:`RecallFeaturesDto`."""

    f = _features()
    dto = RecallFeaturesDto(**{k: v for k, v in f.to_dict().items()})
    assert dto.symbol_id == f.symbol_id
    assert dto.confidence_at_detection == pytest.approx(
        f.confidence_at_detection
    )


# ─────────────────────────── trade memory ──────────────────────────────


@pytest.mark.asyncio
async def test_list_trades_requires_auth(client: AsyncClient) -> None:
    res = await client.get("/recall/trades")
    assert res.status_code == 401, res.text


@pytest.mark.asyncio
async def test_list_trades_empty(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/trades", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body == {"trades": [], "total": 0}


@pytest.mark.asyncio
async def test_list_trades_returns_seeded_rows(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _seed_recall_trade(db, source_id="setup_A", outcome="win", pnl_r=1.5)
    await _seed_recall_trade(db, source_id="setup_B", outcome="loss", pnl_r=-1.0)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/trades", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    assert len(body["trades"]) == 2
    first = body["trades"][0]
    # Determinism: every row has a 64-length vector + structured features.
    assert len(first["vector"]) == RECALL_FEATURE_DIMS
    assert first["features"]["symbolId"] == "BTCUSD"


@pytest.mark.asyncio
async def test_list_trades_filters_by_outcome(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _seed_recall_trade(db, source_id="setup_W", outcome="win", pnl_r=1.2)
    await _seed_recall_trade(db, source_id="setup_L", outcome="loss", pnl_r=-1.0)
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/trades?outcome=win",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["trades"][0]["outcome"] == "win"


@pytest.mark.asyncio
async def test_list_trades_rejects_invalid_outcome(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/trades?outcome=draw",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    body = res.json()
    assert body["error"]["code"] == "invalid_outcome"


@pytest.mark.asyncio
async def test_get_trade_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/trades/does_not_exist",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    body = res.json()
    assert body["error"]["code"] == "recall_trade_not_found"


@pytest.mark.asyncio
async def test_get_trade_ok(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    trade, _ = await _seed_recall_trade(db, source_id="setup_single")
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        f"/recall/trades/{trade.id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["id"] == trade.id
    assert body["setupId"] == "setup_single"
    assert body["features"]["setupType"] == "liquidity_sweep_reclaim"
    assert len(body["vector"]) == RECALL_FEATURE_DIMS


# ─────────────────────────── similarity search ─────────────────────────


@pytest.mark.asyncio
async def test_search_rejects_invalid_kind(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/recall/search",
        headers={"Authorization": f"Bearer {token}"},
        json={"kind": "nonsense"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_search_kind"


@pytest.mark.asyncio
async def test_search_by_features_ranks_by_similarity(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    # Seed three memories. The long/trending row is the closest match
    # to our query envelope; the short/ranging row is the furthest.
    await _seed_recall_trade(
        db, source_id="setup_close", outcome="win", pnl_r=1.1, direction="long"
    )
    # Same symbol, different setup type — still close because most
    # slots are shared.
    await _ensure_symbol(db, "BTCUSD")
    bundle = await ingest_recall_trade(
        db,
        source_kind="setup",
        source_id="setup_mid",
        setup_id="setup_mid",
        symbol_id="BTCUSD",
        tf="1h",
        setup_type="fvg_reaction",
        direction="long",
        detected_at=datetime.now(UTC) - timedelta(hours=5),
        closed_at=datetime.now(UTC) - timedelta(hours=4),
        entry_price=40000.0,
        exit_price=40600.0,
        stop_loss=39800.0,
        take_profit=40600.0,
        outcome="win",
        pnl_r=0.8,
        features=_features(setup_type="fvg_reaction"),
    )
    assert bundle.trade.id
    # Very dissimilar row.
    bundle2 = await ingest_recall_trade(
        db,
        source_kind="setup",
        source_id="setup_far",
        setup_id="setup_far",
        symbol_id="BTCUSD",
        tf="1h",
        setup_type="fvg_reaction",
        direction="short",
        detected_at=datetime.now(UTC) - timedelta(hours=10),
        closed_at=datetime.now(UTC) - timedelta(hours=9),
        entry_price=40000.0,
        exit_price=39500.0,
        stop_loss=40200.0,
        take_profit=39500.0,
        outcome="loss",
        pnl_r=-1.0,
        features=_features(direction="short", regime="ranging", trend_sign=-1),
    )
    assert bundle2.trade.id
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    payload = {
        "kind": "by_features",
        "features": _features().to_dict(),
        "k": 10,
        "minSimilarity": 0.0,
    }
    res = await client.post(
        "/recall/search",
        headers={"Authorization": f"Bearer {token}"},
        json=payload,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # The long/trending seed should be the top hit; the short/ranging
    # row should be somewhere behind it.
    assert len(body["matches"]) >= 2
    assert body["matches"][0]["similarity"] >= body["matches"][1]["similarity"]
    # Summary aggregates across decided outcomes.
    assert body["summary"]["count"] >= 2
    assert body["summary"]["winRate"] is not None


@pytest.mark.asyncio
async def test_search_by_setup_uses_existing_vector(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    trade, _ = await _seed_recall_trade(db, source_id="setup_hero")
    # Seed a sibling so the top-k has someone to pick.
    await _seed_recall_trade(
        db, source_id="setup_sibling", outcome="win", pnl_r=0.9
    )
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/recall/search",
        headers={"Authorization": f"Bearer {token}"},
        json={"kind": "by_setup", "setupId": "setup_hero", "k": 5, "minSimilarity": 0.0},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    # The query row itself must not leak into the neighbours list.
    assert all(m["recallTradeId"] != trade.id for m in body["matches"])


@pytest.mark.asyncio
async def test_search_by_live_trade_unknown_returns_empty(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/recall/search",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "kind": "by_live_trade",
            "liveTradeId": "ltr_missing",
            "k": 10,
            "minSimilarity": 0.0,
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["matches"] == []
    assert body["summary"]["count"] == 0


# ─────────────────────────── screenshots ───────────────────────────────


@pytest.mark.asyncio
async def test_screenshot_create_requires_admin(
    client: AsyncClient,
    db: AsyncSession,
) -> None:
    # A non-admin user authenticates but must be 403.
    import uuid as _uuid

    from app.models import User
    from app.security import hash_password

    password = "user-password-123"
    user = User(
        id=f"usr_{_uuid.uuid4().hex}",
        email="user@godsview.io",
        display_name="Test User",
        password_hash=hash_password(password),
        roles=["viewer"],
        mfa_enabled=False,
        disabled=False,
    )
    db.add(user)
    await db.commit()
    token = await _login(client, user.email, password)

    await _ensure_symbol(db, "ETHUSD")
    await db.commit()

    res = await client.post(
        "/recall/screenshots",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "setupId": "setup_x",
            "symbolId": "ETHUSD",
            "tf": "1h",
            "storageKey": "s3://bucket/key.png",
            "mimeType": "image/png",
            "widthPx": 1280,
            "heightPx": 720,
            "annotations": [],
        },
    )
    assert res.status_code == 403


@pytest.mark.asyncio
async def test_screenshot_create_missing_anchor_400(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _ensure_symbol(db, "ETHUSD")
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.post(
        "/recall/screenshots",
        headers={"Authorization": f"Bearer {token}"},
        json={
            # No setupId / paperTradeId / liveTradeId
            "symbolId": "ETHUSD",
            "tf": "1h",
            "storageKey": "s3://bucket/key.png",
            "widthPx": 1280,
            "heightPx": 720,
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "missing_anchor"


@pytest.mark.asyncio
async def test_screenshot_create_and_list(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _ensure_symbol(db, "BTCUSD")
    await db.commit()
    token = await _login(client, admin_user["email"], admin_user["password"])

    res = await client.post(
        "/recall/screenshots",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "setupId": "setup_annotated",
            "symbolId": "BTCUSD",
            "tf": "1h",
            "storageKey": "s3://bucket/hero.png",
            "mimeType": "image/png",
            "widthPx": 1920,
            "heightPx": 1080,
            "annotations": [
                {"kind": "note", "text": "POI", "x": 0.2, "y": 0.3},
            ],
        },
    )
    assert res.status_code == 201, res.text
    created = res.json()
    assert created["storageKey"] == "s3://bucket/hero.png"
    assert created["capturedByUserId"] == admin_user["id"]
    screenshot_id = created["id"]

    # Listing picks it up.
    res = await client.get(
        "/recall/screenshots",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 1
    assert body["screenshots"][0]["id"] == screenshot_id

    # Get by id round-trips.
    res = await client.get(
        f"/recall/screenshots/{screenshot_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200, res.text
    assert res.json()["id"] == screenshot_id


@pytest.mark.asyncio
async def test_screenshot_get_404(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/screenshots/scr_missing",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "recall_screenshot_not_found"


# ─────────────────────────── missed trades ─────────────────────────────


@pytest.mark.asyncio
async def test_missed_trades_list_and_window_mean(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _ensure_symbol(db, "BTCUSD")
    features = _features()
    await ingest_missed_trade(
        db,
        setup_id="setup_miss_1",
        symbol_id="BTCUSD",
        tf="1h",
        setup_type="liquidity_sweep_reclaim",
        direction="long",
        reason="below_confidence",
        reason_detail="gate: 0.45 < 0.55",
        detected_at=datetime.now(UTC) - timedelta(hours=1),
        hypothetical_r=0.8,
        features=features,
    )
    await ingest_missed_trade(
        db,
        setup_id="setup_miss_2",
        symbol_id="BTCUSD",
        tf="1h",
        setup_type="breakout_retest",
        direction="long",
        reason="gate_rejected",
        reason_detail="risk cap",
        detected_at=datetime.now(UTC) - timedelta(hours=2),
        hypothetical_r=1.2,
        features=features,
    )
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/missed", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["total"] == 2
    # Mean hypothetical R = (0.8 + 1.2) / 2 = 1.0
    assert body["windowMeanR"] == pytest.approx(1.0)
    reasons = {t["reason"] for t in body["trades"]}
    assert reasons == {"below_confidence", "gate_rejected"}


@pytest.mark.asyncio
async def test_missed_trades_reason_filter(
    client: AsyncClient,
    db: AsyncSession,
    admin_user: dict[str, Any],
) -> None:
    await _ensure_symbol(db, "BTCUSD")
    features = _features()
    await ingest_missed_trade(
        db,
        setup_id="setup_f1",
        symbol_id="BTCUSD",
        tf="1h",
        setup_type="fvg_reaction",
        direction="long",
        reason="operator_skipped",
        reason_detail="manual skip",
        detected_at=datetime.now(UTC) - timedelta(hours=2),
        hypothetical_r=0.5,
        features=features,
    )
    await ingest_missed_trade(
        db,
        setup_id="setup_f2",
        symbol_id="BTCUSD",
        tf="1h",
        setup_type="fvg_reaction",
        direction="long",
        reason="duplicate",
        reason_detail="dedup",
        detected_at=datetime.now(UTC) - timedelta(hours=1),
        hypothetical_r=None,
        features=features,
    )
    await db.commit()

    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/missed?reason=duplicate",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["total"] == 1
    assert body["trades"][0]["reason"] == "duplicate"


@pytest.mark.asyncio
async def test_missed_trades_invalid_reason(
    client: AsyncClient, admin_user: dict[str, Any]
) -> None:
    token = await _login(client, admin_user["email"], admin_user["password"])
    res = await client.get(
        "/recall/missed?reason=not_a_reason",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "invalid_miss_reason"
