"""/v1/tv-webhook ingest — HMAC, schema, symbol, dedup, audit trail.

The route is unauthenticated at the user-JWT layer but gated by:
  * X-Webhook-Id  — identifies the registered source webhook
  * X-Webhook-Secret — plaintext rotated secret (supplied by hmac-mux)
  * X-Godsview-Signature — `sha256(body, secret)` hex digest

Each test constructs a minimal Webhook + Symbol registry entry, signs
a payload, and asserts both the HTTP response *and* the persisted
TvSignal / TvSignalAuditStep rows. Persistence assertions matter —
the rejected-branch coverage is what keeps the operator audit feed
trustworthy in production.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
import pytest_asyncio
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Symbol, TvSignal, TvSignalAuditStep, Webhook
from app.security import hash_password


def _sign(body: bytes, secret: str) -> str:
    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


def _payload(
    *,
    alert_id: str = "tv-alert-001",
    ticker: str = "EURUSD",
    exchange: str = "FX",
    tf: str = "15m",
    direction: str = "long",
    family: str = "ob_retest",
    entry: float = 1.0850,
    stop: float = 1.0820,
    target: float = 1.0920,
    pine_confidence: float = 0.72,
    fired_at: datetime | None = None,
    note: str | None = None,
) -> dict[str, Any]:
    return {
        "alertId": alert_id,
        "ticker": ticker,
        "exchange": exchange,
        "tf": tf,
        "direction": direction,
        "family": family,
        "entry": entry,
        "stop": stop,
        "target": target,
        "pineConfidence": pine_confidence,
        "firedAt": (fired_at or datetime.now(UTC)).isoformat(),
        "note": note,
    }


@pytest_asyncio.fixture()
async def seeded(db: AsyncSession) -> dict[str, Any]:
    """Seed a Webhook row and a Symbol for EURUSD@FX."""

    secret = "tvsec_" + uuid.uuid4().hex
    wh = Webhook(
        id=f"wh_{uuid.uuid4().hex}",
        name="tv-eurusd",
        source="tradingview",
        target_url=None,
        secret_hash=hash_password(secret),
        scopes=["signals:ingest"],
        active=True,
        created_by=None,
    )
    sym = Symbol(
        id=f"sym_{uuid.uuid4().hex}",
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
    db.add_all([wh, sym])
    await db.commit()
    return {"webhook_id": wh.id, "secret": secret, "symbol_id": sym.id}


# ─────────────────────────────── happy path ──────────────────────────


@pytest.mark.asyncio
async def test_ingest_success(
    client: AsyncClient, db: AsyncSession, seeded: dict[str, Any]
) -> None:
    body = json.dumps(_payload()).encode()
    sig = _sign(body, seeded["secret"])
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": sig,
            "content-type": "application/json",
        },
    )
    assert res.status_code == 202, res.text
    j = res.json()
    assert j["status"] == "queued"
    assert j["ticker"] == "EURUSD"
    assert j["exchange"] == "FX"
    assert j["tf"] == "15m"
    assert j["direction"] == "long"
    assert j["family"] == "ob_retest"
    assert j["symbolId"] == seeded["symbol_id"]
    assert j["riskReward"] is not None
    # RR ≈ (1.0920 - 1.0850) / (1.0850 - 1.0820) = 0.007 / 0.003 ≈ 2.3333
    assert abs(j["riskReward"] - 2.3333) < 0.01

    # Persisted row + audit trail
    row = await db.scalar(select(TvSignal).where(TvSignal.id == j["id"]))
    assert row is not None
    assert row.status == "queued"
    assert row.webhook_id == seeded["webhook_id"]
    steps = (
        await db.scalars(
            select(TvSignalAuditStep).where(
                TvSignalAuditStep.signal_id == row.id
            )
        )
    ).all()
    step_names = {s.step for s in steps}
    assert "hmac_verified" in step_names
    assert "schema_validated" in step_names
    assert "symbol_resolved" in step_names
    assert "structure_pipeline_enqueued" in step_names
    assert all(s.ok for s in steps)


# ─────────────────────────────── rejects ─────────────────────────────


@pytest.mark.asyncio
async def test_missing_webhook_id_header(client: AsyncClient) -> None:
    res = await client.post(
        "/tv-webhook",
        content=b"{}",
        headers={"X-Godsview-Signature": "deadbeef"},
    )
    # FastAPI emits 422 for missing required header params.
    assert res.status_code == 422


@pytest.mark.asyncio
async def test_unknown_webhook_returns_404(client: AsyncClient) -> None:
    body = b"{}"
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": "wh_nope_does_not_exist",
            "X-Webhook-Secret": "x",
            "X-Godsview-Signature": "00",
        },
    )
    assert res.status_code == 404
    assert res.json()["error"]["code"] == "tv_webhook.unknown_webhook"


@pytest.mark.asyncio
async def test_inactive_webhook_returns_403(
    client: AsyncClient, db: AsyncSession, seeded: dict[str, Any]
) -> None:
    wh = await db.scalar(
        select(Webhook).where(Webhook.id == seeded["webhook_id"])
    )
    assert wh is not None
    wh.active = False
    await db.commit()
    res = await client.post(
        "/tv-webhook",
        content=b"{}",
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": "00",
        },
    )
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "tv_webhook.inactive"


@pytest.mark.asyncio
async def test_missing_secret_rejects(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    res = await client.post(
        "/tv-webhook",
        content=b"{}",
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Godsview-Signature": "00",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "tv_webhook.invalid_secret"


@pytest.mark.asyncio
async def test_bad_secret_rejects(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    res = await client.post(
        "/tv-webhook",
        content=b"{}",
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": "tvsec_wrong",
            "X-Godsview-Signature": "00",
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "tv_webhook.invalid_secret"


@pytest.mark.asyncio
async def test_bad_hmac_rejects(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    body = json.dumps(_payload()).encode()
    # Sign a *different* body so the signature no longer matches.
    wrong_sig = _sign(b"tampered", seeded["secret"])
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": wrong_sig,
        },
    )
    assert res.status_code == 400
    assert res.json()["error"]["code"] == "tv_webhook.invalid_hmac"


@pytest.mark.asyncio
async def test_schema_rejection_persists_audit(
    client: AsyncClient, db: AsyncSession, seeded: dict[str, Any]
) -> None:
    body = b'{"oops": "this is not a tv payload"}'
    sig = _sign(body, seeded["secret"])
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": sig,
        },
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "tv_webhook.invalid_schema"

    # A rejected_schema TvSignal row must exist for the operator audit.
    rows = (
        await db.scalars(
            select(TvSignal).where(TvSignal.status == "rejected_schema")
        )
    ).all()
    assert len(rows) == 1
    assert rows[0].rejection_reason
    steps = (
        await db.scalars(
            select(TvSignalAuditStep).where(
                TvSignalAuditStep.signal_id == rows[0].id
            )
        )
    ).all()
    assert any(s.step == "rejected_schema" and not s.ok for s in steps)


@pytest.mark.asyncio
async def test_unknown_symbol_persists_and_returns_202(
    client: AsyncClient, db: AsyncSession, seeded: dict[str, Any]
) -> None:
    body = json.dumps(_payload(ticker="BOGUS", exchange="NASDAQ")).encode()
    sig = _sign(body, seeded["secret"])
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": sig,
        },
    )
    # Unknown-symbol is an operator-fixable registry gap. The ingest
    # handler persists the rejection + returns 202 so the mux does not
    # retry forever on a state that will not change until the operator
    # adds the symbol.
    assert res.status_code == 202, res.text
    j = res.json()
    assert j["status"] == "rejected_unknown_symbol"
    assert j["symbolId"] is None
    assert "unknown symbol BOGUS@NASDAQ" in (j["rejectionReason"] or "")

    rows = (
        await db.scalars(
            select(TvSignal).where(TvSignal.status == "rejected_unknown_symbol")
        )
    ).all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_dedup_short_circuits(
    client: AsyncClient, db: AsyncSession, seeded: dict[str, Any]
) -> None:
    body = json.dumps(_payload(alert_id="dupe-me")).encode()
    sig = _sign(body, seeded["secret"])
    headers = {
        "X-Webhook-Id": seeded["webhook_id"],
        "X-Webhook-Secret": seeded["secret"],
        "X-Godsview-Signature": sig,
    }
    first = await client.post("/tv-webhook", content=body, headers=headers)
    assert first.status_code == 202
    assert first.json()["status"] == "queued"

    second = await client.post("/tv-webhook", content=body, headers=headers)
    assert second.status_code == 202
    j = second.json()
    assert j["status"] == "deduped"
    assert "duplicate of" in (j["rejectionReason"] or "")

    queued = (
        await db.scalars(
            select(TvSignal).where(TvSignal.status == "queued")
        )
    ).all()
    deduped = (
        await db.scalars(
            select(TvSignal).where(TvSignal.status == "deduped")
        )
    ).all()
    assert len(queued) == 1
    assert len(deduped) == 1


@pytest.mark.asyncio
async def test_invalid_enum_rejects(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    body = json.dumps(_payload(tf="77m")).encode()
    sig = _sign(body, seeded["secret"])
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": sig,
        },
    )
    assert res.status_code == 422
    assert res.json()["error"]["code"] == "tv_webhook.invalid_enum"


@pytest.mark.asyncio
async def test_neutral_direction_has_no_rr(
    client: AsyncClient, seeded: dict[str, Any]
) -> None:
    body = json.dumps(
        _payload(direction="neutral", entry=1.08, stop=1.08, target=1.08)
    ).encode()
    sig = _sign(body, seeded["secret"])
    res = await client.post(
        "/tv-webhook",
        content=body,
        headers={
            "X-Webhook-Id": seeded["webhook_id"],
            "X-Webhook-Secret": seeded["secret"],
            "X-Godsview-Signature": sig,
        },
    )
    assert res.status_code == 202
    assert res.json()["riskReward"] is None
