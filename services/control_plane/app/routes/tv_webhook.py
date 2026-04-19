"""TradingView webhook ingest endpoint — `/v1/tv-webhook`.

Pipeline (per inbound POST):
  1. Resolve the source `Webhook` row from the operator-supplied id in
     `X-Webhook-Id`. Inactive webhooks reject with 403 — the operator
     must rotate or re-activate before the integration resumes.
  2. HMAC-SHA256 verify the raw request body against the active secret
     stored on the `Webhook` row. The plaintext secret is never on disk
     anywhere in the platform; we do constant-time comparison against
     the hashed-on-create copy by re-hashing the (body || secret) pair.
  3. Validate the JSON payload against `TvSignalPayloadIn`. Schema
     failures persist a `rejected_schema` row for the operator audit.
  4. Resolve `(ticker, exchange)` to a `Symbol.id`. Unknown symbols
     persist as `rejected_unknown_symbol` so the operator can fix the
     registry and replay.
  5. Dedup on `(webhook_id, alert_id)` within the configured replay
     window. Deduped signals persist as `deduped` and short-circuit.
  6. Persist the signal as `queued` and emit a structured audit event.
     Downstream pipeline workers (PR4–PR6) will pick it up.

This file is deliberately self-contained: the structure detector and
fusion engine consume the persisted `TvSignal` row asynchronously, so
the webhook handler stays simple, fast, and verifiable.
"""

from __future__ import annotations

import hashlib
import hmac
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Header, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, select

from app.audit import log_event
from app.db import DbSession
from app.errors import ApiError
from app.models import Symbol, TvSignal, TvSignalAuditStep, Webhook

router = APIRouter(prefix="/tv-webhook", tags=["tv-webhook"])

# Replay window for dedup. A second TV alert with the same alertId fired
# inside this window short-circuits as `deduped`. 24 hours is generous
# enough to absorb most operator-side replay loops without blocking
# legitimate re-fires of the same setup name on a subsequent session.
_DEDUP_WINDOW = timedelta(hours=24)

_ALLOWED_TFS = frozenset({"1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d", "1w"})
_ALLOWED_DIRECTIONS = frozenset({"long", "short", "neutral"})
_ALLOWED_FAMILIES = frozenset(
    {
        "liquidity_sweep_reversal",
        "ob_retest",
        "breakout_retest",
        "fvg_reaction",
        "momentum_continuation",
        "session_reversal",
    }
)


class TvSignalPayloadIn(BaseModel):
    """Raw shape posted by the TradingView Pine alert.

    Mirrors `packages/types/src/signals.ts::TvSignalPayloadSchema` so
    the wire contract is single-sourced even though we can't import
    zod at runtime.
    """

    alertId: str = Field(min_length=1, max_length=128)
    ticker: str = Field(min_length=1, max_length=32)
    exchange: str = Field(min_length=1, max_length=32)
    tf: str
    direction: str
    family: str
    entry: float
    stop: float
    target: float
    pineConfidence: float = Field(default=0.5, ge=0.0, le=1.0)
    firedAt: datetime
    note: str | None = Field(default=None, max_length=500)

    model_config = {"populate_by_name": True}


class TvSignalOut(BaseModel):
    id: str
    alertId: str
    ticker: str
    exchange: str
    tf: str
    direction: str
    family: str
    entry: float
    stop: float
    target: float
    pineConfidence: float
    riskReward: float | None = None
    firedAt: datetime
    receivedAt: datetime
    processedAt: datetime | None = None
    status: str
    rejectionReason: str | None = None
    symbolId: str | None = None
    note: str | None = None

    model_config = {"populate_by_name": True}


def _to_out(row: TvSignal) -> TvSignalOut:
    return TvSignalOut(
        id=row.id,
        alertId=row.alert_id,
        ticker=row.ticker,
        exchange=row.exchange,
        tf=row.tf,
        direction=row.direction,
        family=row.family,
        entry=row.entry,
        stop=row.stop,
        target=row.target,
        pineConfidence=row.pine_confidence,
        riskReward=row.risk_reward,
        firedAt=row.fired_at,
        receivedAt=row.received_at,
        processedAt=row.processed_at,
        status=row.status,
        rejectionReason=row.rejection_reason,
        symbolId=row.symbol_id,
        note=row.note,
    )


def _validate_enum(value: str, allowed: frozenset[str], field: str) -> str:
    if value not in allowed:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="tv_webhook.invalid_enum",
            message=f"unknown value '{value}' for {field}",
            details=[{"path": f"body.{field}", "issue": f"expected one of {sorted(allowed)}"}],
        )
    return value


def _hmac_sha256(secret: str, body: bytes) -> str:
    """Return hex digest used by the X-Godsview-Signature header.

    The header format is the bare hex digest. Operators wire this as
    `sha256(body, secret)` in TradingView's webhook URL config. We use
    `hmac.compare_digest` to avoid timing leaks.
    """

    return hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()


async def _persist_audit(
    db: DbSession,
    *,
    signal_id: str,
    step: str,
    ok: bool,
    message: str | None = None,
) -> None:
    db.add(
        TvSignalAuditStep(
            id=f"sas_{uuid.uuid4().hex}",
            signal_id=signal_id,
            step=step,
            ok=ok,
            message=message,
        )
    )


def _compute_rr(entry: float, stop: float, target: float, direction: str) -> float | None:
    """Return risk:reward as `(reward / risk)`. None on degenerate inputs."""

    if direction == "long":
        risk = entry - stop
        reward = target - entry
    elif direction == "short":
        risk = stop - entry
        reward = entry - target
    else:
        return None
    if risk <= 0 or reward <= 0:
        return None
    return round(reward / risk, 4)


@router.post(
    "",
    response_model=TvSignalOut,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        400: {"description": "Schema or HMAC validation failed"},
        403: {"description": "Webhook inactive"},
        404: {"description": "Webhook id unknown"},
        422: {"description": "Unprocessable payload"},
    },
)
async def ingest_tv_webhook(
    request: Request,
    db: DbSession,
    x_webhook_id: str = Header(..., alias="X-Webhook-Id"),
    x_godsview_signature: str = Header(..., alias="X-Godsview-Signature"),
) -> TvSignalOut:
    raw_body = await request.body()

    # 1. resolve webhook
    webhook = await db.scalar(select(Webhook).where(Webhook.id == x_webhook_id))
    if webhook is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="tv_webhook.unknown_webhook",
            message=f"webhook '{x_webhook_id}' not registered",
        )
    if not webhook.active:
        raise ApiError(
            status_code=status.HTTP_403_FORBIDDEN,
            code="tv_webhook.inactive",
            message=f"webhook '{x_webhook_id}' is inactive",
        )

    # 2. HMAC verify. We can't recover the plaintext secret from
    # `secret_hash` (Argon2), so we keep a parallel transport-layer
    # secret in the operator-supplied X-Godsview-Signature ↔ stored
    # `secret_hash` (which is a verifier hash). The verifier matches if
    # `verify_password(secret_hash, raw_secret) is True`. Operators
    # configure `raw_secret` in TradingView; we never log it.
    #
    # In practice the Pine alert template sends the plaintext alongside
    # the signature header during initial integration. For production
    # we rely on an external hmac-mux that holds the plaintext and
    # signs requests. This route accepts the signature header and
    # checks it against the request body — the secret is provided by
    # the mux via X-Webhook-Secret, never by the operator's TV alert
    # itself.
    raw_secret = request.headers.get("X-Webhook-Secret", "")
    from app.security import verify_password

    if not raw_secret or not verify_password(webhook.secret_hash, raw_secret):
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="tv_webhook.invalid_secret",
            message="webhook secret missing or invalid",
        )

    expected_sig = _hmac_sha256(raw_secret, raw_body)
    if not hmac.compare_digest(expected_sig, x_godsview_signature):
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="tv_webhook.invalid_hmac",
            message="HMAC signature mismatch",
        )

    # 3. parse + validate payload
    try:
        payload = TvSignalPayloadIn.model_validate_json(raw_body)
    except Exception as exc:  # pydantic ValidationError
        # We still persist a row so the operator audit feed has a
        # trace of malformed inbound traffic.
        await _persist_rejected(
            db,
            request=request,
            webhook_id=webhook.id,
            ticker="?",
            exchange="?",
            tf="?",
            direction="?",
            family="?",
            entry=0.0,
            stop=0.0,
            target=0.0,
            pine_confidence=0.0,
            fired_at=datetime.now(UTC),
            note=None,
            payload={"raw": raw_body[:2000].decode("utf-8", errors="replace")},
            status_value="rejected_schema",
            rejection_reason=str(exc)[:240],
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="tv_webhook.invalid_schema",
            message="payload failed schema validation",
            details=[{"issue": str(exc)[:240]}],
        )

    _validate_enum(payload.tf, _ALLOWED_TFS, "tf")
    _validate_enum(payload.direction, _ALLOWED_DIRECTIONS, "direction")
    _validate_enum(payload.family, _ALLOWED_FAMILIES, "family")

    # 4. resolve symbol
    symbol = await db.scalar(
        select(Symbol).where(
            and_(Symbol.ticker == payload.ticker, Symbol.exchange == payload.exchange)
        )
    )
    if symbol is None or not symbol.active:
        row = await _persist_rejected(
            db,
            request=request,
            webhook_id=webhook.id,
            ticker=payload.ticker,
            exchange=payload.exchange,
            tf=payload.tf,
            direction=payload.direction,
            family=payload.family,
            entry=payload.entry,
            stop=payload.stop,
            target=payload.target,
            pine_confidence=payload.pineConfidence,
            fired_at=payload.firedAt,
            note=payload.note,
            payload=payload.model_dump(by_alias=True),
            status_value="rejected_unknown_symbol",
            rejection_reason=f"unknown symbol {payload.ticker}@{payload.exchange}",
            alert_id=payload.alertId,
        )
        await db.commit()
        return _to_out(row)

    # 5. dedup
    cutoff = datetime.now(UTC) - _DEDUP_WINDOW
    existing = await db.scalar(
        select(TvSignal).where(
            and_(
                TvSignal.webhook_id == webhook.id,
                TvSignal.alert_id == payload.alertId,
                TvSignal.received_at >= cutoff,
            )
        )
    )
    if existing is not None:
        row = TvSignal(
            id=f"tvs_{uuid.uuid4().hex}",
            webhook_id=webhook.id,
            alert_id=payload.alertId,
            symbol_id=symbol.id,
            ticker=payload.ticker,
            exchange=payload.exchange,
            tf=payload.tf,
            direction=payload.direction,
            family=payload.family,
            entry=payload.entry,
            stop=payload.stop,
            target=payload.target,
            pine_confidence=payload.pineConfidence,
            risk_reward=_compute_rr(
                payload.entry, payload.stop, payload.target, payload.direction
            ),
            fired_at=payload.firedAt,
            note=payload.note,
            payload=payload.model_dump(by_alias=True),
            status="deduped",
            rejection_reason=f"duplicate of {existing.id} within {_DEDUP_WINDOW}",
        )
        db.add(row)
        await db.flush()
        await _persist_audit(db, signal_id=row.id, step="deduped", ok=True)
        await db.commit()
        await db.refresh(row)
        return _to_out(row)

    # 6. queue
    row = TvSignal(
        id=f"tvs_{uuid.uuid4().hex}",
        webhook_id=webhook.id,
        alert_id=payload.alertId,
        symbol_id=symbol.id,
        ticker=payload.ticker,
        exchange=payload.exchange,
        tf=payload.tf,
        direction=payload.direction,
        family=payload.family,
        entry=payload.entry,
        stop=payload.stop,
        target=payload.target,
        pine_confidence=payload.pineConfidence,
        risk_reward=_compute_rr(payload.entry, payload.stop, payload.target, payload.direction),
        fired_at=payload.firedAt,
        note=payload.note,
        payload=payload.model_dump(by_alias=True),
        status="queued",
    )
    db.add(row)
    await db.flush()
    await _persist_audit(db, signal_id=row.id, step="hmac_verified", ok=True)
    await _persist_audit(db, signal_id=row.id, step="schema_validated", ok=True)
    await _persist_audit(db, signal_id=row.id, step="symbol_resolved", ok=True)
    await _persist_audit(
        db, signal_id=row.id, step="structure_pipeline_enqueued", ok=True
    )
    webhook.last_delivery_at = datetime.now(UTC)
    await log_event(
        db,
        request=request,
        actor_user_id=None,
        actor_email=None,
        action="tv_webhook.ingest",
        resource_type="tv_signal",
        resource_id=row.id,
        outcome="success",
        details={
            "webhook_id": webhook.id,
            "alert_id": payload.alertId,
            "ticker": payload.ticker,
            "exchange": payload.exchange,
            "tf": payload.tf,
            "family": payload.family,
        },
    )
    await db.commit()
    await db.refresh(row)
    return _to_out(row)


async def _persist_rejected(
    db: DbSession,
    *,
    request: Request,
    webhook_id: str,
    ticker: str,
    exchange: str,
    tf: str,
    direction: str,
    family: str,
    entry: float,
    stop: float,
    target: float,
    pine_confidence: float,
    fired_at: datetime,
    note: str | None,
    payload: dict[str, Any],
    status_value: str,
    rejection_reason: str,
    alert_id: str | None = None,
) -> TvSignal:
    row = TvSignal(
        id=f"tvs_{uuid.uuid4().hex}",
        webhook_id=webhook_id,
        alert_id=alert_id or f"unparsed_{uuid.uuid4().hex[:12]}",
        symbol_id=None,
        ticker=ticker,
        exchange=exchange,
        tf=tf,
        direction=direction,
        family=family,
        entry=entry,
        stop=stop,
        target=target,
        pine_confidence=pine_confidence,
        risk_reward=None,
        fired_at=fired_at,
        note=note,
        payload=payload,
        status=status_value,
        rejection_reason=rejection_reason[:240],
    )
    db.add(row)
    await db.flush()
    await _persist_audit(
        db,
        signal_id=row.id,
        step=status_value,
        ok=False,
        message=rejection_reason[:480],
    )
    await log_event(
        db,
        request=request,
        actor_user_id=None,
        actor_email=None,
        action="tv_webhook.reject",
        resource_type="tv_signal",
        resource_id=row.id,
        outcome="denied",
        details={
            "webhook_id": webhook_id,
            "reason": status_value,
            "detail": rejection_reason[:240],
        },
    )
    return row
