"""Phase 7 portfolio rebalancer HTTP surface.

Wire contract (all responses camelCase JSON, all inputs accept either
snake_case or camelCase):

Plans
  * ``GET  /v1/rebalance/plans``                   — list plans with filters.
  * ``GET  /v1/rebalance/plans/{id}``              — single plan.
  * ``GET  /v1/rebalance/plans/{id}/detail``       — plan + ordered intents.
  * ``POST /v1/rebalance/plans``                   — propose a new plan.
  * ``POST /v1/rebalance/plans/{id}/approve``      — flip proposed → approved.
    Paired ``rebalance_execute`` governance approval required.
  * ``POST /v1/rebalance/plans/{id}/reject``       — decline a proposed plan.
  * ``POST /v1/rebalance/plans/{id}/cancel``       — cancel an approved plan.
  * ``POST /v1/rebalance/plans/{id}/execute``      — flip approved → executing.

Intents
  * ``GET  /v1/rebalance/intents``                 — list intents with filters.
  * ``GET  /v1/rebalance/intents/{id}``            — single intent.
  * ``POST /v1/rebalance/intents/{id}/retry``      — re-route a failed intent.
  * ``POST /v1/rebalance/intents/{id}/cancel``     — cancel a queued intent.

Reads are un-logged. Every mutation funnels through
:func:`app.audit.log_event` with ``resource_type="portfolio.rebalance.plan"``
or ``resource_type="portfolio.rebalance.intent"``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import and_, desc, select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser, OperatorOrAdmin
from app.errors import ApiError
from app.models import (
    GovernanceApprovalRow,
    RebalanceIntentRow,
    RebalancePlanRow,
)
from app.rebalancer.loader import load_rebalancer_inputs
from app.rebalancer.planner import (
    draft_to_intent_rows,
    plan_to_row,
    synthesize_plan,
)

router = APIRouter(prefix="/rebalance", tags=["rebalance"])


# ───────────────────────────── DTOs ─────────────────────────────────────


class _CamelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


RebalancePlanStatus = Literal[
    "proposed",
    "approved",
    "executing",
    "complete",
    "rejected",
    "cancelled",
    "failed",
]
RebalanceTrigger = Literal[
    "scheduled", "manual", "drift", "anomaly", "allocation_change"
]
RebalanceIntentStatus = Literal[
    "queued", "submitted", "filled", "partial", "cancelled", "failed"
]
RebalanceDirection = Literal["long", "short", "flat"]


class RebalancePlanWarningDto(_CamelBase):
    code: Literal[
        "target_sum_out_of_band",
        "correlated_exposure_breach",
        "single_symbol_concentration",
        "liquidity_warning",
        "venue_latency_degraded",
        "broker_quorum_insufficient",
        "kill_switch_active",
    ]
    severity: Literal["info", "warn", "critical"]
    message: str
    subject_key: Optional[str] = Field(None, alias="subjectKey")


class RebalanceIntentDto(_CamelBase):
    id: str
    plan_id: str = Field(..., alias="planId")
    strategy_id: str = Field(..., alias="strategyId")
    symbol_id: str = Field(..., alias="symbolId")
    correlation_class: str = Field(..., alias="correlationClass")
    side: RebalanceDirection
    current_notional: float = Field(..., alias="currentNotional")
    target_notional: float = Field(..., alias="targetNotional")
    delta_notional: float = Field(..., alias="deltaNotional")
    current_percent: float = Field(..., alias="currentPercent")
    target_percent: float = Field(..., alias="targetPercent")
    delta_percent: float = Field(..., alias="deltaPercent")
    status: RebalanceIntentStatus
    execution_intent_id: Optional[str] = Field(None, alias="executionIntentId")
    adapter_id: Optional[str] = Field(None, alias="adapterId")
    filled_notional: float = Field(..., alias="filledNotional")
    reason: Optional[str] = None
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")


class RebalancePlanDto(_CamelBase):
    id: str
    account_id: str = Field(..., alias="accountId")
    status: RebalancePlanStatus
    trigger: RebalanceTrigger
    initiated_by_user_id: Optional[str] = Field(None, alias="initiatedByUserId")
    approval_id: Optional[str] = Field(None, alias="approvalId")
    intent_count: int = Field(..., alias="intentCount", ge=0)
    gross_delta_notional: float = Field(..., alias="grossDeltaNotional", ge=0)
    net_delta_notional: float = Field(..., alias="netDeltaNotional")
    estimated_r: Optional[float] = Field(None, alias="estimatedR")
    warnings: List[RebalancePlanWarningDto]
    reason: Optional[str] = None
    proposed_at: datetime = Field(..., alias="proposedAt")
    approved_at: Optional[datetime] = Field(None, alias="approvedAt")
    executed_at: Optional[datetime] = Field(None, alias="executedAt")
    completed_at: Optional[datetime] = Field(None, alias="completedAt")
    updated_at: datetime = Field(..., alias="updatedAt")


class RebalancePlansListDto(_CamelBase):
    plans: List[RebalancePlanDto]
    total: int


class RebalanceIntentsListDto(_CamelBase):
    intents: List[RebalanceIntentDto]
    total: int


class RebalancePlanDetailDto(_CamelBase):
    plan: RebalancePlanDto
    intents: List[RebalanceIntentDto]


class RebalancePlanRequestDto(_CamelBase):
    account_id: str = Field(..., alias="accountId")
    trigger: Optional[RebalanceTrigger] = None
    reason: Optional[str] = Field(None, min_length=3, max_length=280)


class RebalancePlanApproveRequestDto(_CamelBase):
    approval_id: str = Field(..., alias="approvalId")
    reason: str = Field(..., min_length=3, max_length=280)


class RebalancePlanReasonOnlyDto(_CamelBase):
    reason: str = Field(..., min_length=3, max_length=280)


# ───────────────────────────── helpers ──────────────────────────────────


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _plan_to_dto(row: RebalancePlanRow) -> RebalancePlanDto:
    warnings_raw = list(row.warnings or [])
    warnings: List[RebalancePlanWarningDto] = []
    for w in warnings_raw:
        if isinstance(w, dict):
            warnings.append(RebalancePlanWarningDto.model_validate(w))
    return RebalancePlanDto(
        id=row.id,
        accountId=row.account_id,
        status=row.status,  # type: ignore[arg-type]
        trigger=row.trigger,  # type: ignore[arg-type]
        initiatedByUserId=row.initiated_by_user_id,
        approvalId=row.approval_id,
        intentCount=row.intent_count,
        grossDeltaNotional=float(row.gross_delta_notional),
        netDeltaNotional=float(row.net_delta_notional),
        estimatedR=(
            None if row.estimated_r is None else float(row.estimated_r)
        ),
        warnings=warnings,
        reason=row.reason,
        proposedAt=row.proposed_at,
        approvedAt=row.approved_at,
        executedAt=row.executed_at,
        completedAt=row.completed_at,
        updatedAt=row.updated_at,
    )


def _intent_to_dto(row: RebalanceIntentRow) -> RebalanceIntentDto:
    return RebalanceIntentDto(
        id=row.id,
        planId=row.plan_id,
        strategyId=row.strategy_id,
        symbolId=row.symbol_id,
        correlationClass=row.correlation_class,
        side=row.side,  # type: ignore[arg-type]
        currentNotional=float(row.current_notional),
        targetNotional=float(row.target_notional),
        deltaNotional=float(row.delta_notional),
        currentPercent=float(row.current_percent),
        targetPercent=float(row.target_percent),
        deltaPercent=float(row.delta_percent),
        status=row.status,  # type: ignore[arg-type]
        executionIntentId=row.execution_intent_id,
        adapterId=row.adapter_id,
        filledNotional=float(row.filled_notional),
        reason=row.reason,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


async def _get_plan_or_404(
    db: DbSession, plan_id: str
) -> RebalancePlanRow:
    row = await db.get(RebalancePlanRow, plan_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="rebalance_plan_not_found",
            message=f"rebalance plan {plan_id!r} not found",
        )
    return row


async def _get_intent_or_404(
    db: DbSession, intent_id: str
) -> RebalanceIntentRow:
    row = await db.get(RebalanceIntentRow, intent_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="rebalance_intent_not_found",
            message=f"rebalance intent {intent_id!r} not found",
        )
    return row


async def _validate_governance_approval(
    db: DbSession, *, approval_id: str, plan_id: str
) -> GovernanceApprovalRow:
    """Cross-check the approval row pairs with ``plan_id`` and the
    ``rebalance_execute`` action and is in the ``approved`` state."""
    appr = await db.get(GovernanceApprovalRow, approval_id)
    if appr is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="governance_not_found",
            message=f"governance approval {approval_id!r} not found",
        )
    if appr.action != "rebalance_execute":
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="governance_wrong_action",
            message=(
                f"approval action is {appr.action!r}; expected "
                "'rebalance_execute'"
            ),
        )
    if appr.subject_key != plan_id:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="governance_subject_mismatch",
            message=(
                f"approval subjectKey is {appr.subject_key!r}; "
                f"expected plan id {plan_id!r}"
            ),
        )
    if appr.state != "approved":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="governance_not_approved",
            message=(
                f"approval is in state {appr.state!r}; expected 'approved'"
            ),
        )
    return appr


# ───────────────────────────── plans: read ──────────────────────────────


@router.get(
    "/plans",
    response_model=RebalancePlansListDto,
    summary="List rebalance plans with filters (account, status, trigger, since).",
)
async def list_plans_route(
    db: DbSession,
    user: CurrentUser,
    account_id: Optional[str] = Query(default=None, alias="accountId"),
    status_q: Optional[RebalancePlanStatus] = Query(default=None, alias="status"),
    trigger: Optional[RebalanceTrigger] = Query(default=None),
    since: Optional[datetime] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> RebalancePlansListDto:
    stmt = select(RebalancePlanRow)
    if account_id is not None:
        stmt = stmt.where(RebalancePlanRow.account_id == account_id)
    if status_q is not None:
        stmt = stmt.where(RebalancePlanRow.status == status_q)
    if trigger is not None:
        stmt = stmt.where(RebalancePlanRow.trigger == trigger)
    if since is not None:
        stmt = stmt.where(RebalancePlanRow.proposed_at >= since)
    stmt = stmt.order_by(desc(RebalancePlanRow.proposed_at))
    rows = list(
        (await db.scalars(stmt.offset(offset).limit(limit))).all()
    )
    # Count with the same filter but without pagination so the UI paginator
    # stays accurate across filter changes.
    count_stmt = select(RebalancePlanRow.id)
    if account_id is not None:
        count_stmt = count_stmt.where(
            RebalancePlanRow.account_id == account_id
        )
    if status_q is not None:
        count_stmt = count_stmt.where(RebalancePlanRow.status == status_q)
    if trigger is not None:
        count_stmt = count_stmt.where(RebalancePlanRow.trigger == trigger)
    if since is not None:
        count_stmt = count_stmt.where(
            RebalancePlanRow.proposed_at >= since
        )
    total = len(list((await db.execute(count_stmt)).all()))
    return RebalancePlansListDto(
        plans=[_plan_to_dto(r) for r in rows], total=total
    )


@router.get(
    "/plans/{plan_id}",
    response_model=RebalancePlanDto,
    summary="Single rebalance plan by id.",
)
async def get_plan_route(
    plan_id: str,
    db: DbSession,
    user: CurrentUser,
) -> RebalancePlanDto:
    row = await _get_plan_or_404(db, plan_id)
    return _plan_to_dto(row)


@router.get(
    "/plans/{plan_id}/detail",
    response_model=RebalancePlanDetailDto,
    summary="Plan + its ordered intent rows.",
)
async def get_plan_detail_route(
    plan_id: str,
    db: DbSession,
    user: CurrentUser,
) -> RebalancePlanDetailDto:
    plan_row = await _get_plan_or_404(db, plan_id)
    stmt = (
        select(RebalanceIntentRow)
        .where(RebalanceIntentRow.plan_id == plan_id)
        .order_by(RebalanceIntentRow.created_at)
    )
    intents = list((await db.scalars(stmt)).all())
    return RebalancePlanDetailDto(
        plan=_plan_to_dto(plan_row),
        intents=[_intent_to_dto(r) for r in intents],
    )


# ───────────────────────────── plans: mutate ────────────────────────────


@router.post(
    "/plans",
    response_model=RebalancePlanDto,
    summary="Propose a rebalance plan for an account.",
    status_code=status.HTTP_201_CREATED,
)
async def propose_plan_route(
    payload: RebalancePlanRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> RebalancePlanDto:
    inputs = await load_rebalancer_inputs(db, account_id=payload.account_id)
    draft = synthesize_plan(
        account_id=payload.account_id,
        trigger=payload.trigger or "manual",
        initiated_by_user_id=user.id,
        reason=payload.reason,
        total_equity=inputs.total_equity,
        targets_by_strategy=inputs.targets_by_strategy,
        legs=inputs.legs,
    )
    plan_row = plan_to_row(draft)
    db.add(plan_row)
    await db.flush()

    intent_rows = draft_to_intent_rows(draft, plan_id=plan_row.id)
    for ir in intent_rows:
        db.add(ir)
    if intent_rows:
        await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.plan.propose",
        resource_type="portfolio.rebalance.plan",
        resource_id=plan_row.id,
        outcome="success",
        details={
            "accountId": plan_row.account_id,
            "trigger": plan_row.trigger,
            "intentCount": plan_row.intent_count,
            "grossDeltaNotional": plan_row.gross_delta_notional,
            "netDeltaNotional": plan_row.net_delta_notional,
            "warningCount": len(plan_row.warnings or []),
        },
    )
    await db.commit()
    return _plan_to_dto(plan_row)


@router.post(
    "/plans/{plan_id}/approve",
    response_model=RebalancePlanDto,
    summary=(
        "Approve a proposed plan. Requires a paired `rebalance_execute` "
        "governance approval id scoped to the plan."
    ),
    status_code=status.HTTP_200_OK,
)
async def approve_plan_route(
    plan_id: str,
    payload: RebalancePlanApproveRequestDto,
    request: Request,
    db: DbSession,
    user: OperatorOrAdmin,
) -> RebalancePlanDto:
    plan = await _get_plan_or_404(db, plan_id)
    if plan.status != "proposed":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=(
                f"plan is in status {plan.status!r}; approve requires "
                "'proposed'"
            ),
        )
    await _validate_governance_approval(
        db, approval_id=payload.approval_id, plan_id=plan_id
    )

    now = _utcnow()
    plan.status = "approved"
    plan.approval_id = payload.approval_id
    plan.approved_at = now
    plan.reason = payload.reason
    plan.updated_at = now
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.plan.approve",
        resource_type="portfolio.rebalance.plan",
        resource_id=plan.id,
        outcome="success",
        details={
            "accountId": plan.account_id,
            "approvalId": plan.approval_id,
            "reason": plan.reason,
        },
    )
    await db.commit()
    return _plan_to_dto(plan)


@router.post(
    "/plans/{plan_id}/reject",
    response_model=RebalancePlanDto,
    summary="Reject a proposed plan.",
    status_code=status.HTTP_200_OK,
)
async def reject_plan_route(
    plan_id: str,
    payload: RebalancePlanReasonOnlyDto,
    request: Request,
    db: DbSession,
    user: OperatorOrAdmin,
) -> RebalancePlanDto:
    plan = await _get_plan_or_404(db, plan_id)
    if plan.status != "proposed":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=(
                f"plan is in status {plan.status!r}; reject requires "
                "'proposed'"
            ),
        )
    now = _utcnow()
    plan.status = "rejected"
    plan.reason = payload.reason
    plan.completed_at = now
    plan.updated_at = now
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.plan.reject",
        resource_type="portfolio.rebalance.plan",
        resource_id=plan.id,
        outcome="success",
        details={"accountId": plan.account_id, "reason": plan.reason},
    )
    await db.commit()
    return _plan_to_dto(plan)


@router.post(
    "/plans/{plan_id}/cancel",
    response_model=RebalancePlanDto,
    summary="Cancel an approved-but-not-executing plan.",
    status_code=status.HTTP_200_OK,
)
async def cancel_plan_route(
    plan_id: str,
    payload: RebalancePlanReasonOnlyDto,
    request: Request,
    db: DbSession,
    user: OperatorOrAdmin,
) -> RebalancePlanDto:
    plan = await _get_plan_or_404(db, plan_id)
    if plan.status != "approved":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=(
                f"plan is in status {plan.status!r}; cancel requires "
                "'approved'"
            ),
        )
    now = _utcnow()
    plan.status = "cancelled"
    plan.reason = payload.reason
    plan.completed_at = now
    plan.updated_at = now
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.plan.cancel",
        resource_type="portfolio.rebalance.plan",
        resource_id=plan.id,
        outcome="success",
        details={"accountId": plan.account_id, "reason": plan.reason},
    )
    await db.commit()
    return _plan_to_dto(plan)


@router.post(
    "/plans/{plan_id}/execute",
    response_model=RebalancePlanDto,
    summary=(
        "Flip an approved plan to executing. Drains intent rows into the "
        "Phase 4 execution bus."
    ),
    status_code=status.HTTP_200_OK,
)
async def execute_plan_route(
    plan_id: str,
    payload: RebalancePlanReasonOnlyDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> RebalancePlanDto:
    plan = await _get_plan_or_404(db, plan_id)
    if plan.status != "approved":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=(
                f"plan is in status {plan.status!r}; execute requires "
                "'approved'"
            ),
        )
    now = _utcnow()
    plan.status = "executing"
    plan.executed_at = now
    plan.updated_at = now
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.plan.execute",
        resource_type="portfolio.rebalance.plan",
        resource_id=plan.id,
        outcome="success",
        details={
            "accountId": plan.account_id,
            "approvalId": plan.approval_id,
            "reason": payload.reason,
        },
    )
    await db.commit()
    return _plan_to_dto(plan)


# ───────────────────────────── intents: read ────────────────────────────


@router.get(
    "/intents",
    response_model=RebalanceIntentsListDto,
    summary="List rebalance intents with filters.",
)
async def list_intents_route(
    db: DbSession,
    user: CurrentUser,
    plan_id: Optional[str] = Query(default=None, alias="planId"),
    strategy_id: Optional[str] = Query(default=None, alias="strategyId"),
    symbol_id: Optional[str] = Query(default=None, alias="symbolId"),
    status_q: Optional[RebalanceIntentStatus] = Query(
        default=None, alias="status"
    ),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> RebalanceIntentsListDto:
    stmt = select(RebalanceIntentRow)
    if plan_id is not None:
        stmt = stmt.where(RebalanceIntentRow.plan_id == plan_id)
    if strategy_id is not None:
        stmt = stmt.where(RebalanceIntentRow.strategy_id == strategy_id)
    if symbol_id is not None:
        stmt = stmt.where(RebalanceIntentRow.symbol_id == symbol_id)
    if status_q is not None:
        stmt = stmt.where(RebalanceIntentRow.status == status_q)
    stmt = stmt.order_by(desc(RebalanceIntentRow.created_at))
    rows = list(
        (await db.scalars(stmt.offset(offset).limit(limit))).all()
    )
    count_stmt = select(RebalanceIntentRow.id)
    if plan_id is not None:
        count_stmt = count_stmt.where(RebalanceIntentRow.plan_id == plan_id)
    if strategy_id is not None:
        count_stmt = count_stmt.where(
            RebalanceIntentRow.strategy_id == strategy_id
        )
    if symbol_id is not None:
        count_stmt = count_stmt.where(
            RebalanceIntentRow.symbol_id == symbol_id
        )
    if status_q is not None:
        count_stmt = count_stmt.where(RebalanceIntentRow.status == status_q)
    total = len(list((await db.execute(count_stmt)).all()))
    return RebalanceIntentsListDto(
        intents=[_intent_to_dto(r) for r in rows], total=total
    )


@router.get(
    "/intents/{intent_id}",
    response_model=RebalanceIntentDto,
    summary="Single rebalance intent by id.",
)
async def get_intent_route(
    intent_id: str,
    db: DbSession,
    user: CurrentUser,
) -> RebalanceIntentDto:
    row = await _get_intent_or_404(db, intent_id)
    return _intent_to_dto(row)


# ───────────────────────────── intents: mutate ──────────────────────────


_INTENT_TERMINAL: set[str] = {"filled", "cancelled"}


@router.post(
    "/intents/{intent_id}/retry",
    response_model=RebalanceIntentDto,
    summary="Retry a failed intent by requeuing it for the adapter registry.",
    status_code=status.HTTP_200_OK,
)
async def retry_intent_route(
    intent_id: str,
    payload: RebalancePlanReasonOnlyDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> RebalanceIntentDto:
    intent = await _get_intent_or_404(db, intent_id)
    if intent.status in _INTENT_TERMINAL:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=(
                f"intent is in status {intent.status!r}; retry requires a "
                "non-terminal state"
            ),
        )
    now = _utcnow()
    intent.status = "queued"
    intent.reason = payload.reason
    intent.execution_intent_id = None
    intent.adapter_id = None
    intent.updated_at = now
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.intent.retry",
        resource_type="portfolio.rebalance.intent",
        resource_id=intent.id,
        outcome="success",
        details={"planId": intent.plan_id, "reason": intent.reason},
    )
    await db.commit()
    return _intent_to_dto(intent)


@router.post(
    "/intents/{intent_id}/cancel",
    response_model=RebalanceIntentDto,
    summary="Cancel a queued intent. Intents already routed to the bus cannot be cancelled here.",
    status_code=status.HTTP_200_OK,
)
async def cancel_intent_route(
    intent_id: str,
    payload: RebalancePlanReasonOnlyDto,
    request: Request,
    db: DbSession,
    user: OperatorOrAdmin,
) -> RebalanceIntentDto:
    intent = await _get_intent_or_404(db, intent_id)
    if intent.status != "queued":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="invalid_transition",
            message=(
                f"intent is in status {intent.status!r}; cancel requires "
                "'queued'"
            ),
        )
    now = _utcnow()
    intent.status = "cancelled"
    intent.reason = payload.reason
    intent.updated_at = now
    await db.flush()

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="rebalance.intent.cancel",
        resource_type="portfolio.rebalance.intent",
        resource_id=intent.id,
        outcome="success",
        details={"planId": intent.plan_id, "reason": intent.reason},
    )
    await db.commit()
    return _intent_to_dto(intent)


__all__ = ["router"]
