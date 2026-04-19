"""Authenticated /v1/broker surface — positions + fills read-only.

Phase 4 PR3 scope
-----------------
  * ``GET /v1/broker/positions`` — broker-reported open positions for an
    operator-pinned account. The route resolves the adapter via
    :data:`app.broker.broker_registry` and folds in the DB mirror (if
    any) so the caller sees the fused truth.
  * ``GET /v1/broker/fills`` — broker-reported execution reports, with
    optional symbol + time-window filters + a hard ``limit`` cap.

Both endpoints are admin-only — they expose broker-side state that
leaks positions and commission. The PR4 risk endpoints consume the
same registry so this route and the live gate stay consistent on
which adapter is canonical.

Write paths (order submission, cancellation) land in PR5 alongside the
live gate — no route in this PR accepts a body.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query, status
from pydantic import BaseModel, Field

from app.broker import BrokerProtocol, BrokerUnavailable
from app.broker.base import broker_registry
from app.deps import AdminUser
from app.errors import ApiError

router = APIRouter(prefix="/broker", tags=["broker"])


# ─────────────────────────── DTOs ────────────────────────────────────


class BrokerPositionDto(BaseModel):
    """Mirrors ``packages/types/src/execution.ts::PositionSchema``."""

    model_config = {"populate_by_name": True}

    symbol: str
    direction: Literal["long", "short"]
    qty: float
    avgEntryPrice: float
    markPrice: float
    unrealizedPnl: float


class BrokerPositionsOut(BaseModel):
    model_config = {"populate_by_name": True}

    accountId: str
    provider: str
    mode: Literal["paper", "live"]
    positions: list[BrokerPositionDto]
    observedAt: datetime


class BrokerFillDto(BaseModel):
    """Mirrors ``packages/types/src/execution.ts::BrokerFillSchema``."""

    model_config = {"populate_by_name": True}

    clientOrderId: str
    brokerOrderId: str
    symbol: str
    direction: Literal["long", "short"]
    filledQty: float
    avgFillPrice: float | None = None
    status: Literal[
        "accepted",
        "rejected",
        "submitted",
        "partially_filled",
        "filled",
        "cancelled",
        "expired",
    ]
    commission: float
    slippage: float | None = None
    observedAt: datetime
    errorCode: str | None = None
    errorMessage: str | None = None


class BrokerFillsOut(BaseModel):
    model_config = {"populate_by_name": True}

    accountId: str
    provider: str
    mode: Literal["paper", "live"]
    fills: list[BrokerFillDto]
    total: int
    limit: int


# ─────────────────────────── helpers ────────────────────────────────


def _resolve_adapter(account_id: str) -> BrokerProtocol:
    """Look up a registered adapter or surface a typed 503."""

    adapter = broker_registry.get_or_none(account_id)
    if adapter is None:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=(
                f"no broker adapter registered for account {account_id} — "
                "start the adapter bootstrap or pick a different account"
            ),
        )
    return adapter


# ─────────────────────────── routes ─────────────────────────────────


@router.get("/positions", response_model=BrokerPositionsOut)
async def list_positions(
    user: AdminUser,
    account_id: str = Query(..., alias="accountId"),
    symbol: str | None = Query(None),
) -> BrokerPositionsOut:
    """Return live broker-reported open positions."""

    adapter = _resolve_adapter(account_id)
    try:
        rows = await adapter.list_positions(symbol=symbol)
    except BrokerUnavailable as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=exc.reason,
        ) from exc

    return BrokerPositionsOut(
        accountId=account_id,
        provider=adapter.provider,
        mode=adapter.mode,
        positions=[
            BrokerPositionDto(
                symbol=p.symbol,
                direction=p.direction,
                qty=p.qty,
                avgEntryPrice=p.avg_entry_price,
                markPrice=p.mark_price,
                unrealizedPnl=p.unrealized_pnl,
            )
            for p in rows
        ],
        observedAt=datetime.utcnow(),
    )


@router.get("/fills", response_model=BrokerFillsOut)
async def list_fills(
    user: AdminUser,
    account_id: str = Query(..., alias="accountId"),
    symbol: str | None = Query(None),
    from_ts: datetime | None = Query(None, alias="fromTs"),
    to_ts: datetime | None = Query(None, alias="toTs"),
    limit: int = Query(100, ge=1, le=500),
) -> BrokerFillsOut:
    """Return broker-reported fills, newest-first, capped at ``limit``."""

    if from_ts is not None and to_ts is not None and from_ts >= to_ts:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_time_window",
            message="fromTs must be strictly before toTs",
        )

    adapter = _resolve_adapter(account_id)
    try:
        rows = await adapter.list_fills(
            symbol=symbol,
            since=from_ts,
            until=to_ts,
            limit=limit,
        )
    except BrokerUnavailable as exc:
        raise ApiError(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            code="broker_unavailable",
            message=exc.reason,
        ) from exc

    out = [
        BrokerFillDto(
            clientOrderId=r.client_order_id,
            brokerOrderId=r.broker_order_id,
            symbol=r.symbol,
            direction=r.direction,
            filledQty=r.filled_qty,
            avgFillPrice=r.avg_fill_price,
            status=r.status,
            commission=r.commission,
            slippage=r.slippage,
            observedAt=r.observed_at,
            errorCode=r.error_code,
            errorMessage=r.error_message,
        )
        for r in rows
    ]

    return BrokerFillsOut(
        accountId=account_id,
        provider=adapter.provider,
        mode=adapter.mode,
        fills=out,
        total=len(out),
        limit=limit,
    )
