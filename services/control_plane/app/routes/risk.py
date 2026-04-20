"""Authenticated /v1/risk surface — budget + equity read/write.

Phase 4 PR4 scope
-----------------
  * ``GET   /v1/risk/budget?accountId=...``   — current operator-pinned budget.
  * ``PATCH /v1/risk/budget?accountId=...``   — upsert budget (admin).
    Validates every cap is a positive float / int and that
    ``max_risk_per_trade_r`` < ``max_daily_drawdown_r`` (otherwise the
    account gets locked out by one bad trade).
  * ``GET   /v1/risk/equity?accountId=...``   — latest persisted equity
    snapshot; falls through to a live broker pull when ``refresh=true``.
    Admin only because it surfaces broker-side dollars.

Both mutate paths audit via :func:`app.audit.log_event`. Everything
that reads from the broker fans outages into typed 503s the same way
``/v1/broker/*`` does in PR3.
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select

from app.audit import log_event
from app.broker import BrokerUnavailable
from app.broker.base import broker_registry
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import (
    AccountEquitySnapshot,
    BrokerAccount,
    RiskBudget as RiskBudgetRow,
)

router = APIRouter(prefix="/risk", tags=["risk"])


# ─────────────────────────── DTOs ────────────────────────────────────


class RiskBudgetDto(BaseModel):
    """Mirrors ``packages/types/src/execution.ts::RiskBudgetSchema``."""

    model_config = {"populate_by_name": True}

    accountId: str
    maxRiskPerTradeR: float = Field(gt=0.0, le=0.1)
    maxDailyDrawdownR: float = Field(gt=0.0, le=0.5)
    maxOpenPositions: int = Field(ge=1, le=100)
    maxCorrelatedExposure: float = Field(gt=0.0, le=10.0)
    maxGrossExposure: float = Field(gt=0.0, le=10.0)
    updatedAt: datetime


class RiskBudgetPatchIn(BaseModel):
    model_config = {"populate_by_name": True}

    # Partial — every field optional. Absent keys preserve the prior
    # value. A fully-empty payload is a no-op (returns the current row).
    maxRiskPerTradeR: float | None = Field(default=None, gt=0.0, le=0.1)
    maxDailyDrawdownR: float | None = Field(default=None, gt=0.0, le=0.5)
    maxOpenPositions: int | None = Field(default=None, ge=1, le=100)
    maxCorrelatedExposure: float | None = Field(default=None, gt=0.0, le=10.0)
    maxGrossExposure: float | None = Field(default=None, gt=0.0, le=10.0)


class AccountEquityDto(BaseModel):
    """Mirrors ``packages/types/src/execution.ts::AccountEquitySchema``."""

    model_config = {"populate_by_name": True}

    accountId: str
    totalEquity: float
    startOfDayEquity: float
    realizedPnl: float
    unrealizedPnl: float
    marginUsed: float
    buyingPower: float
    observedAt: datetime


# ─────────────────────────── helpers ────────────────────────────────


async def _ensure_account(db: DbSession, account_id: str) -> BrokerAccount:
    row = await db.scalar(
        select(BrokerAccount).where(BrokerAccount.id == account_id)
    )
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="broker_account_not_found",
            message=f"broker account {account_id} does not exist",
        )
    return row


def _row_to_budget_dto(row: RiskBudgetRow) -> RiskBudgetDto:
    return RiskBudgetDto(
        accountId=row.account_id,
        maxRiskPerTradeR=row.max_risk_per_trade_r,
        maxDailyDrawdownR=row.max_daily_drawdown_r,
        maxOpenPositions=row.max_open_positions,
        maxCorrelatedExposure=row.max_correlated_exposure,
        maxGrossExposure=row.max_gross_exposure,
        updatedAt=row.updated_at,
    )


def _row_to_equity_dto(
    row: AccountEquitySnapshot,
) -> AccountEquityDto:
    return AccountEquityDto(
        accountId=row.account_id,
        totalEquity=row.total_equity,
        startOfDayEquity=row.start_of_day_equity,
        realizedPnl=row.realized_pnl,
        unrealizedPnl=row.unrealized_pnl,
        marginUsed=row.margin_used,
        buyingPower=row.buying_power,
        observedAt=row.observed_at,
    )


# ─────────────────────────── routes ─────────────────────────────────


@router.get("/budget", response_model=RiskBudgetDto)
async def get_budget(
    user: CurrentUser,
    db: DbSession,
    account_id: str = Query(..., alias="accountId"),
) -> RiskBudgetDto:
    await _ensure_account(db, account_id)
    row = await db.scalar(
        select(RiskBudgetRow).where(RiskBudgetRow.account_id == account_id)
    )
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="risk_budget_not_found",
            message=(
                f"no risk budget configured for account {account_id} — "
                "PATCH /risk/budget to create one"
            ),
        )
    return _row_to_budget_dto(row)


@router.patch("/budget", response_model=RiskBudgetDto)
async def patch_budget(
    body: RiskBudgetPatchIn,
    user: AdminUser,
    db: DbSession,
    request: Request,
    account_id: str = Query(..., alias="accountId"),
) -> RiskBudgetDto:
    await _ensure_account(db, account_id)
    row = await db.scalar(
        select(RiskBudgetRow).where(RiskBudgetRow.account_id == account_id)
    )
    created = False
    if row is None:
        created = True
        row = RiskBudgetRow(account_id=account_id)
        db.add(row)

    if body.maxRiskPerTradeR is not None:
        row.max_risk_per_trade_r = body.maxRiskPerTradeR
    if body.maxDailyDrawdownR is not None:
        row.max_daily_drawdown_r = body.maxDailyDrawdownR
    if body.maxOpenPositions is not None:
        row.max_open_positions = body.maxOpenPositions
    if body.maxCorrelatedExposure is not None:
        row.max_correlated_exposure = body.maxCorrelatedExposure
    if body.maxGrossExposure is not None:
        row.max_gross_exposure = body.maxGrossExposure

    # Sanity check — a single trade's max risk cannot exceed the entire
    # daily drawdown budget; otherwise the account is one trade away
    # from being locked out for the day.
    if row.max_risk_per_trade_r >= row.max_daily_drawdown_r:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="risk_budget_inconsistent",
            message=(
                f"maxRiskPerTradeR ({row.max_risk_per_trade_r}) must be "
                f"strictly less than maxDailyDrawdownR "
                f"({row.max_daily_drawdown_r})"
            ),
        )

    await db.commit()
    await db.refresh(row)

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="risk.budget.updated" if not created else "risk.budget.created",
        resource_type="broker_account",
        resource_id=account_id,
        outcome="success",
        details={
            "maxRiskPerTradeR": row.max_risk_per_trade_r,
            "maxDailyDrawdownR": row.max_daily_drawdown_r,
            "maxOpenPositions": row.max_open_positions,
            "maxCorrelatedExposure": row.max_correlated_exposure,
            "maxGrossExposure": row.max_gross_exposure,
        },
    )
    await db.commit()

    return _row_to_budget_dto(row)


@router.get("/equity", response_model=AccountEquityDto)
async def get_equity(
    user: AdminUser,
    db: DbSession,
    account_id: str = Query(..., alias="accountId"),
    refresh: bool = Query(False),
) -> AccountEquityDto:
    """Return the most recent equity snapshot for ``accountId``.

    When ``refresh=true`` the route first pulls a fresh snapshot from
    the broker adapter, persists it, then returns it. That's the
    preferred path before opening a live trade — the risk gate refuses
    stale snapshots.
    """

    await _ensure_account(db, account_id)

    if refresh:
        adapter = broker_registry.get_or_none(account_id)
        if adapter is None:
            raise ApiError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="broker_unavailable",
                message=(
                    f"no broker adapter registered for account {account_id}"
                ),
            )
        try:
            snap = await adapter.get_equity()
        except BrokerUnavailable as exc:
            raise ApiError(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                code="broker_unavailable",
                message=exc.reason,
            ) from exc

        row = AccountEquitySnapshot(
            account_id=account_id,
            observed_at=snap.observed_at,
            total_equity=snap.total_equity,
            start_of_day_equity=snap.start_of_day_equity,
            realized_pnl=snap.realized_pnl,
            unrealized_pnl=snap.unrealized_pnl,
            margin_used=snap.margin_used,
            buying_power=snap.buying_power,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return _row_to_equity_dto(row)

    stmt = (
        select(AccountEquitySnapshot)
        .where(AccountEquitySnapshot.account_id == account_id)
        .order_by(desc(AccountEquitySnapshot.observed_at))
        .limit(1)
    )
    row = await db.scalar(stmt)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="equity_snapshot_not_found",
            message=(
                f"no equity snapshot for account {account_id} — "
                "call /risk/equity?refresh=true to pull one"
            ),
        )
    return _row_to_equity_dto(row)
