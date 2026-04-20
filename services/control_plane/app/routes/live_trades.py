"""Authenticated /v1/live-trades surface — read + lifecycle + cancel.

Phase 4 PR6 scope
-----------------
  * ``GET  /v1/live-trades`` — paginated list with filters (status,
    symbol_id, account_id, setup_id, direction, from/to). Orders by
    ``approved_at DESC``.
  * ``GET  /v1/live-trades/{id}`` — detail (authenticated; any role).
  * ``POST /v1/live-trades/{id}/cancel`` — admin-only. Asks the broker
    adapter to cancel the open order via ``client_order_id`` and rolls
    the row to ``cancelled``. Broker outages surface as 503 +
    ``live_trade.cancel_broker_unavailable`` audit event; the row
    stays in its prior status so an operator can retry.
  * ``PATCH /v1/live-trades/{id}/status`` — admin-only lifecycle
    transitions. Valid transitions (derived from the model docstring):

        pending_submit  → submitted | rejected | cancelled
        submitted       → partially_filled | filled | cancelled | rejected
        partially_filled → filled | cancelled
        filled          → won | lost | scratched | cancelled
        won / lost / scratched / cancelled / rejected → terminal

    On terminal transitions, mirrors the paper-trade path: closes the
    underlying :class:`Setup`, pushes an outcome record to the recall
    store so the calibrator can consume it on the *next* detection,
    and marks the trade's ``closed_at`` + ``realized_pnl_dollars`` +
    ``pnl_r``.

Every state-changing route writes a ``live_trade.*`` audit event so the
decision trail is reconstructable from the audit log alone.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Body, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, desc, func, select

from app.audit import log_event
from app.broker import BrokerUnavailable, broker_registry
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import (
    BrokerAccount,
    LiveTrade,
    Setup,
)
from app.recall import RecallRecord, get_recall_store
from app.recall.calibrator import feature_fingerprint
from app.routes.execution import LiveTradeDto, _live_trade_to_dto as _lt_to_dto

router = APIRouter(tags=["live-trades"])


# ── lifecycle constants ─────────────────────────────────────────────

_LIVE_STATUS_VALUES: frozenset[str] = frozenset(
    {
        "pending_submit",
        "submitted",
        "partially_filled",
        "filled",
        "won",
        "lost",
        "scratched",
        "cancelled",
        "rejected",
    }
)

_LIVE_TERMINAL: frozenset[str] = frozenset(
    {"won", "lost", "scratched", "cancelled", "rejected"}
)

_LIVE_CANCELLABLE: frozenset[str] = frozenset(
    {"pending_submit", "submitted", "partially_filled"}
)

#: Allowed operator-initiated lifecycle transitions. Broker adapters
#: drive the ``submitted → partially_filled → filled`` path via a
#: separate fill-tracker (future PR); this table is strictly for the
#: ops surface.
_ALLOWED_TRANSITIONS: dict[str, frozenset[str]] = {
    "pending_submit": frozenset({"submitted", "rejected", "cancelled"}),
    "submitted": frozenset(
        {"partially_filled", "filled", "cancelled", "rejected"}
    ),
    "partially_filled": frozenset({"filled", "cancelled"}),
    "filled": frozenset({"won", "lost", "scratched", "cancelled"}),
}


# ─────────────────────────── DTOs ────────────────────────────────────
#
# :class:`LiveTradeDto` + :func:`_lt_to_dto` are imported from
# :mod:`app.routes.execution` above — this keeps the OpenAPI schema
# ``$ref`` stable across the two routers and avoids a duplicate
# schema name collision in the generated spec.


class LiveTradesListOut(BaseModel):
    model_config = {"populate_by_name": True}

    trades: list[LiveTradeDto]
    total: int
    offset: int
    limit: int


class LiveTradeStatusPatchIn(BaseModel):
    """Body for PATCH /v1/live-trades/:id/status.

    ``avgFillPrice`` / ``filledQty`` / ``commission`` are optional
    inputs that only make sense on ``filled`` / ``partially_filled``
    transitions; on win/loss/scratch the caller supplies ``pnlR`` +
    ``realizedPnLDollars`` so the recall pipeline and P&L reporting
    get consistent numbers.
    """

    model_config = {"populate_by_name": True}

    status: Literal[
        "pending_submit",
        "submitted",
        "partially_filled",
        "filled",
        "won",
        "lost",
        "scratched",
        "cancelled",
        "rejected",
    ]
    pnlR: float | None = None
    realizedPnLDollars: float | None = None
    avgFillPrice: float | None = None
    filledQty: float | None = Field(default=None, ge=0.0)
    commission: float | None = Field(default=None, ge=0.0)
    note: str | None = Field(default=None, max_length=500)


class LiveTradeCancelIn(BaseModel):
    """Optional operator note for the cancel audit trail."""

    model_config = {"populate_by_name": True}

    reason: str | None = Field(default=None, max_length=200)


# ─────────────────────────── helpers ─────────────────────────────────


def _derive_outcome_from_live(status: str, pnl_r: float | None) -> str:
    if status == "won":
        return "win"
    if status == "lost":
        return "loss"
    if status in {"scratched", "cancelled", "rejected"}:
        return "scratch"
    if pnl_r is None:
        return "scratch"
    if pnl_r > 0:
        return "win"
    if pnl_r < 0:
        return "loss"
    return "scratch"


async def _record_recall_from_setup(
    db: DbSession, *, setup_id: str, outcome: str, pnl_r: float | None
) -> None:
    """Push a terminal outcome record to the recall store.

    Mirrors the paper-trade recall hook — keeps the recall corpus
    aware of live outcomes so the calibrator blends paper + live
    history on the next detection pass.
    """
    row = await db.scalar(select(Setup).where(Setup.id == setup_id))
    if row is None:
        return
    store = get_recall_store()
    features = feature_fingerprint(
        setup_type=row.type,
        direction=row.direction,
        tf=row.tf,
        rr=row.rr,
        entry_ref=row.entry_ref,
        of_score=row.order_flow_score,
        structure_score=row.structure_score,
        regime_score=row.regime_score,
        session_score=row.session_score,
    )
    store.add(
        RecallRecord(
            id=row.id,
            setup_type=row.type,
            direction=row.direction,
            tf=row.tf,
            symbol_id=row.symbol_id,
            features=features,
            outcome=outcome,  # type: ignore[arg-type]
            pnl_r=pnl_r,
            detected_at=row.detected_at,
            closed_at=datetime.now(timezone.utc),
        )
    )


# ─────────────────────────── routes ──────────────────────────────────


@router.get("/live-trades", response_model=LiveTradesListOut)
async def list_live_trades(
    user: CurrentUser,
    db: DbSession,
    symbol_id: str | None = Query(None, alias="symbolId"),
    setup_id: str | None = Query(None, alias="setupId"),
    account_id: str | None = Query(None, alias="accountId"),
    direction: str | None = Query(None, pattern="^(long|short)$"),
    trade_status: str | None = Query(None, alias="status"),
    from_ts: datetime | None = Query(None, alias="fromTs"),
    to_ts: datetime | None = Query(None, alias="toTs"),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> LiveTradesListOut:
    if trade_status is not None and trade_status not in _LIVE_STATUS_VALUES:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_live_trade_status",
            message=f"unknown live-trade status: {trade_status}",
        )

    conds: list[Any] = []
    if symbol_id is not None:
        conds.append(LiveTrade.symbol_id == symbol_id)
    if setup_id is not None:
        conds.append(LiveTrade.setup_id == setup_id)
    if account_id is not None:
        conds.append(LiveTrade.account_id == account_id)
    if direction is not None:
        conds.append(LiveTrade.direction == direction)
    if trade_status is not None:
        conds.append(LiveTrade.status == trade_status)
    if from_ts is not None:
        conds.append(LiveTrade.approved_at >= from_ts)
    if to_ts is not None:
        conds.append(LiveTrade.approved_at < to_ts)

    base = select(LiveTrade)
    if conds:
        base = base.where(and_(*conds))

    total_stmt = (
        select(func.count()).select_from(LiveTrade).where(and_(*conds))
        if conds
        else select(func.count()).select_from(LiveTrade)
    )
    total_val = await db.scalar(total_stmt)
    total = int(total_val or 0)

    stmt = (
        base.order_by(desc(LiveTrade.approved_at))
        .offset(offset)
        .limit(limit)
    )
    rows = list((await db.scalars(stmt)).all())
    return LiveTradesListOut(
        trades=[_lt_to_dto(r) for r in rows],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/live-trades/{trade_id}", response_model=LiveTradeDto)
async def get_live_trade(
    trade_id: str,
    user: CurrentUser,
    db: DbSession,
) -> LiveTradeDto:
    row = await db.scalar(select(LiveTrade).where(LiveTrade.id == trade_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="live_trade_not_found",
            message=f"live trade {trade_id} does not exist",
        )
    return _lt_to_dto(row)


@router.post(
    "/live-trades/{trade_id}/cancel",
    response_model=LiveTradeDto,
)
async def cancel_live_trade(
    trade_id: str,
    user: AdminUser,
    db: DbSession,
    request: Request,
    body: LiveTradeCancelIn = Body(default_factory=LiveTradeCancelIn),
) -> LiveTradeDto:
    """Cancel the open broker order for a live trade.

    * 404 if the trade id is unknown.
    * 409 if the trade is already terminal (``won``/``lost``/
      ``scratched``/``cancelled``/``rejected``).
    * 503 if the broker adapter isn't registered or raises
      :class:`BrokerUnavailable`. The row stays in its prior status so
      an operator can retry once the broker recovers; an
      ``live_trade.cancel_broker_unavailable`` audit event is written.
    * 200 + the updated trade row on success. The row flips to
      ``cancelled``, ``closed_at`` is stamped, and an
      ``live_trade.cancel`` audit event is written.
    """

    reason = body.reason

    row = await db.scalar(select(LiveTrade).where(LiveTrade.id == trade_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="live_trade_not_found",
            message=f"live trade {trade_id} does not exist",
        )

    if row.status not in _LIVE_CANCELLABLE:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="live_trade_not_cancellable",
            message=(
                f"live trade {trade_id} is in {row.status}, which cannot "
                f"be cancelled"
            ),
        )

    # Load the broker account so we can look up the registered adapter.
    account = await db.scalar(
        select(BrokerAccount).where(BrokerAccount.id == row.account_id)
    )
    if account is None:
        # Broker account row was removed out from under us — this is an
        # ops data-integrity bug. Surface it clearly rather than
        # silently succeed.
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="broker_account_not_found",
            message=(
                f"broker account {row.account_id} no longer exists for "
                f"live trade {trade_id}"
            ),
        )

    adapter = broker_registry.get_or_none(row.account_id)
    if adapter is None:
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="live_trade.cancel_broker_unavailable",
            resource_type="live_trade",
            resource_id=trade_id,
            outcome="failure",
            details={
                "clientOrderId": row.client_order_id,
                "brokerOrderId": row.broker_order_id,
                "accountId": row.account_id,
                "reason": "no_adapter_registered",
                "operatorReason": reason,
            },
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=f"no broker adapter registered for account {row.account_id}",
        )

    try:
        await adapter.cancel_order(client_order_id=row.client_order_id)
    except BrokerUnavailable as exc:
        await log_event(
            db,
            request=request,
            actor_user_id=user.id,
            actor_email=user.email,
            action="live_trade.cancel_broker_unavailable",
            resource_type="live_trade",
            resource_id=trade_id,
            outcome="failure",
            details={
                "clientOrderId": row.client_order_id,
                "brokerOrderId": row.broker_order_id,
                "accountId": row.account_id,
                "provider": exc.provider,
                "reason": exc.reason,
                "operatorReason": reason,
            },
        )
        await db.commit()
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=exc.reason,
        ) from exc

    now = datetime.now(timezone.utc)
    prev_status = row.status
    row.status = "cancelled"
    row.closed_at = now
    if reason is not None:
        appended = f"[cancel] {reason}"
        row.note = (
            f"{row.note}\n{appended}" if row.note else appended
        )

    # Close the setup + push a scratch outcome to recall if we had a fill.
    setup_row = await db.scalar(select(Setup).where(Setup.id == row.setup_id))
    if setup_row is not None and setup_row.status not in {
        "closed",
        "rejected",
        "expired",
    }:
        setup_row.status = "closed"
        setup_row.closed_at = now
        setup_row.closed_pnl_r = row.pnl_r

    await db.flush()
    if setup_row is not None:
        await _record_recall_from_setup(
            db,
            setup_id=row.setup_id,
            outcome=_derive_outcome_from_live("cancelled", row.pnl_r),
            pnl_r=row.pnl_r,
        )

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="live_trade.cancel",
        resource_type="live_trade",
        resource_id=trade_id,
        outcome="success",
        details={
            "clientOrderId": row.client_order_id,
            "brokerOrderId": row.broker_order_id,
            "accountId": row.account_id,
            "priorStatus": prev_status,
            "operatorReason": reason,
        },
    )
    await db.commit()
    await db.refresh(row)
    return _lt_to_dto(row)


@router.patch(
    "/live-trades/{trade_id}/status",
    response_model=LiveTradeDto,
)
async def patch_live_trade_status(
    trade_id: str,
    body: LiveTradeStatusPatchIn,
    user: AdminUser,
    db: DbSession,
    request: Request,
) -> LiveTradeDto:
    """Admin-only lifecycle transitions on a live trade.

    * 404 if the id is unknown.
    * 409 if the trade is already terminal or the transition isn't
      in :data:`_ALLOWED_TRANSITIONS`.
    * On terminal transitions, closes the setup + writes a recall
      record + stamps ``closed_at`` + ``pnl_r`` + ``realized_pnl_dollars``.
    * Writes a ``live_trade.status_patched`` audit event on every
      successful transition.
    """

    row = await db.scalar(select(LiveTrade).where(LiveTrade.id == trade_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="live_trade_not_found",
            message=f"live trade {trade_id} does not exist",
        )

    old = row.status
    new = body.status

    if old == new:
        return _lt_to_dto(row)
    if old in _LIVE_TERMINAL:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="live_trade_terminal",
            message=f"live trade already in terminal state: {old}",
        )
    allowed = _ALLOWED_TRANSITIONS.get(old, frozenset())
    if new not in allowed:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="live_trade_invalid_transition",
            message=f"cannot transition {old} → {new}",
        )

    now = datetime.now(timezone.utc)
    row.status = new
    if new == "submitted" and row.submitted_at is None:
        row.submitted_at = now
    if new in {"partially_filled", "filled"}:
        # Stamp filled_at the first time we see a fill.
        if row.filled_at is None:
            row.filled_at = now
        if body.avgFillPrice is not None:
            row.avg_fill_price = body.avgFillPrice
        if body.filledQty is not None:
            row.filled_qty = body.filledQty
        if body.commission is not None:
            row.commission = body.commission
    if body.note is not None:
        row.note = body.note

    if new in _LIVE_TERMINAL:
        row.closed_at = now
        if body.pnlR is not None:
            row.pnl_r = body.pnlR
        if body.realizedPnLDollars is not None:
            row.realized_pnl_dollars = body.realizedPnLDollars
        if body.avgFillPrice is not None:
            row.avg_fill_price = body.avgFillPrice
        if body.filledQty is not None:
            row.filled_qty = body.filledQty
        if body.commission is not None:
            row.commission = body.commission

        outcome = _derive_outcome_from_live(new, row.pnl_r)
        setup_row = await db.scalar(
            select(Setup).where(Setup.id == row.setup_id)
        )
        if setup_row is not None and setup_row.status not in {
            "closed",
            "rejected",
            "expired",
        }:
            setup_row.status = "closed"
            setup_row.closed_at = now
            setup_row.closed_pnl_r = row.pnl_r
        await db.flush()
        if setup_row is not None:
            await _record_recall_from_setup(
                db,
                setup_id=row.setup_id,
                outcome=outcome,
                pnl_r=row.pnl_r,
            )

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="live_trade.status_patched",
        resource_type="live_trade",
        resource_id=trade_id,
        outcome="success",
        details={
            "from": old,
            "to": new,
            "pnlR": body.pnlR,
            "realizedPnLDollars": body.realizedPnLDollars,
            "clientOrderId": row.client_order_id,
        },
    )

    await db.commit()
    await db.refresh(row)
    return _lt_to_dto(row)
