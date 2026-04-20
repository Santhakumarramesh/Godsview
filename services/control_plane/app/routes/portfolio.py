"""Portfolio Intelligence HTTP surface — Phase 6 PR3.

Wire contract (all responses camelCase JSON, all inputs accept either
snake_case or camelCase):

  * ``GET  /v1/portfolio/accounts``                 — broker accounts list.
  * ``GET  /v1/portfolio/exposure``                 — exposure report.
  * ``GET  /v1/portfolio/allocation``               — allocation plan.
  * ``POST /v1/portfolio/allocation``               — upsert allocation target.
  * ``POST /v1/portfolio/allocation/rebalance``     — reset targets to default.
  * ``GET  /v1/portfolio/pnl``                      — daily PnL timeseries +
                                                      summary.

Reads are un-logged (operators refresh these often, we don't want
audit-tail noise). Writes go through :func:`app.audit.log_event` with
``resource_type="portfolio.allocation"``.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.models import BrokerAccount
from app.portfolio.allocation import (
    build_allocation_plan,
    rebalance_plan,
    set_allocation,
)
from app.portfolio.dto import (
    AllocationPlanDto,
    AllocationUpdateRequestDto,
    PortfolioAccountDto,
    PortfolioAccountsListOut,
    PortfolioExposureReportDto,
    PortfolioPnlReportDto,
)
from app.portfolio.exposure import (
    build_exposure_report,
    list_broker_accounts,
    load_all_open_positions,
)
from app.portfolio.pnl import build_pnl_report

UTC = timezone.utc

router = APIRouter(prefix="/portfolio", tags=["portfolio"])


async def _resolve_account_id(db, account_id: Optional[str]) -> str:
    """Resolve the target account — explicit id wins, else newest enabled."""
    if account_id:
        stmt = select(BrokerAccount).where(BrokerAccount.id == account_id)
        row = (await db.execute(stmt)).scalar_one_or_none()
        if row is None:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="broker_account_not_found",
                message=f"no broker account with id {account_id!r}",
            )
        return row.id
    accounts = await list_broker_accounts(db)
    if not accounts:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="no_broker_accounts",
            message="no broker account is configured; create one via /v1/broker/accounts",
        )
    return accounts[0].id


# ─────────────────────────── accounts ───────────────────────────────────


@router.get(
    "/accounts",
    response_model=PortfolioAccountsListOut,
    summary="List broker accounts with portfolio surface enabled",
)
async def list_accounts(
    db: DbSession,
    user: CurrentUser,
) -> PortfolioAccountsListOut:
    rows = await list_broker_accounts(db)
    out = [
        PortfolioAccountDto(
            accountId=row.id,
            displayName=row.display_name,
            provider=row.provider,
            liveEnabled=row.mode == "live" and row.enabled,
        )
        for row in rows
    ]
    return PortfolioAccountsListOut(accounts=out)


# ─────────────────────────── exposure ───────────────────────────────────


@router.get(
    "/exposure",
    response_model=PortfolioExposureReportDto,
    summary="Per-account portfolio exposure report",
)
async def get_exposure(
    db: DbSession,
    user: CurrentUser,
    account_id: Optional[str] = Query(default=None, alias="accountId"),
    include_cross_account: bool = Query(
        default=True, alias="includeCrossAccount"
    ),
) -> PortfolioExposureReportDto:
    target = await _resolve_account_id(db, account_id)
    cross = await load_all_open_positions(db) if include_cross_account else None
    return await build_exposure_report(
        db,
        account_id=target,
        cross_account_positions=cross,
    )


# ─────────────────────────── allocation ─────────────────────────────────


@router.get(
    "/allocation",
    response_model=AllocationPlanDto,
    summary="Allocation plan for an account",
)
async def get_allocation(
    db: DbSession,
    user: CurrentUser,
    account_id: Optional[str] = Query(default=None, alias="accountId"),
) -> AllocationPlanDto:
    target = await _resolve_account_id(db, account_id)
    return await build_allocation_plan(db, account_id=target)


@router.post(
    "/allocation",
    response_model=AllocationPlanDto,
    summary="Upsert an allocation target for a single strategy",
    status_code=status.HTTP_200_OK,
)
async def upsert_allocation(
    payload: AllocationUpdateRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
    account_id: Optional[str] = Query(default=None, alias="accountId"),
) -> AllocationPlanDto:
    target = await _resolve_account_id(db, account_id)
    row = await set_allocation(
        db,
        account_id=target,
        req=payload,
        actor_user_id=user.id,
    )
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="portfolio.allocation.upsert",
        resource_type="portfolio.allocation",
        resource_id=row.id,
        outcome="success",
        details={
            "accountId": target,
            "strategyId": payload.strategy_id,
            "targetPercent": payload.target_percent,
            "reason": payload.reason,
        },
    )
    await db.commit()
    return await build_allocation_plan(db, account_id=target)


@router.post(
    "/allocation/rebalance",
    response_model=AllocationPlanDto,
    summary="Snap every strategy target on an account to the configured default",
    status_code=status.HTTP_200_OK,
)
async def rebalance_allocation(
    request: Request,
    db: DbSession,
    user: AdminUser,
    account_id: Optional[str] = Query(default=None, alias="accountId"),
) -> AllocationPlanDto:
    target = await _resolve_account_id(db, account_id)
    plan = await rebalance_plan(
        db, account_id=target, actor_user_id=user.id
    )
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="portfolio.allocation.rebalance",
        resource_type="portfolio.allocation",
        resource_id=target,
        outcome="success",
        details={"accountId": target, "strategyCount": len(plan.strategies)},
    )
    await db.commit()
    return plan


# ─────────────────────────── PnL ────────────────────────────────────────


@router.get(
    "/pnl",
    response_model=PortfolioPnlReportDto,
    summary="Daily PnL timeseries + aggregate summary",
)
async def get_pnl(
    db: DbSession,
    user: CurrentUser,
    account_id: Optional[str] = Query(default=None, alias="accountId"),
    start_date: Optional[str] = Query(default=None, alias="startDate"),
    end_date: Optional[str] = Query(default=None, alias="endDate"),
) -> PortfolioPnlReportDto:
    target = await _resolve_account_id(db, account_id)
    today = datetime.now(UTC).date()

    try:
        start = date.fromisoformat(start_date) if start_date else today.replace(day=1)
        end = date.fromisoformat(end_date) if end_date else today
    except ValueError as exc:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_date",
            message="startDate and endDate must be ISO-8601 yyyy-mm-dd",
        ) from exc

    if (end - start).days > 366:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="range_too_wide",
            message="PnL range cannot exceed 366 days",
        )

    return await build_pnl_report(
        db,
        account_id=target,
        start_date=start,
        end_date=end,
    )


__all__ = ["router"]
