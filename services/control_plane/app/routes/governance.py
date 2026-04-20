"""Governance HTTP surface — Phase 6 PR4.

Wire contract (all responses camelCase JSON, all inputs accept either
snake_case or camelCase):

  * ``GET  /v1/governance/approvals``              — list (filter + page).
  * ``GET  /v1/governance/approvals/{id}``         — single envelope.
  * ``POST /v1/governance/approvals``              — create request.
  * ``POST /v1/governance/approvals/{id}/decide``  — approver sign-off.
  * ``POST /v1/governance/approvals/{id}/withdraw``— requester withdraws.

  * ``GET   /v1/governance/policies``              — list policy rows.
  * ``GET   /v1/governance/policies/{action}``     — single policy.
  * ``PATCH /v1/governance/policies/{action}``     — admin patch.

  * ``GET  /v1/governance/anomalies``              — list + filter.
  * ``GET  /v1/governance/anomalies/{id}``         — single alert.
  * ``POST /v1/governance/anomalies/{id}/acknowledge``
  * ``POST /v1/governance/anomalies/{id}/resolve``

  * ``GET  /v1/governance/trust``                  — full tier registry.
  * ``GET  /v1/governance/trust/{userId}``         — per-user entry.
  * ``POST /v1/governance/trust``                  — admin-gated assign.

Reads are un-logged. Every mutation funnels through
:func:`app.audit.log_event` with ``resource_type="governance.*"``.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request, status
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError
from app.governance.anomaly import (
    AnomalyError,
    acknowledge_anomaly,
    get_anomaly,
    list_anomalies,
    resolve_anomaly,
)
from app.governance.approvals import (
    ApprovalError,
    create_approval,
    decide_approval,
    get_approval,
    list_approvals,
    withdraw_approval,
)
from app.governance.dto import (
    AcknowledgeAnomalyRequestDto,
    AnomalyAlertDto,
    AnomalyAlertsListDto,
    ApprovalPolicyDto,
    ApprovalPolicyListDto,
    ApprovalPolicyUpdateDto,
    AssignTrustTierRequestDto,
    CreateApprovalRequestDto,
    DecideApprovalRequestDto,
    GovernanceApprovalDto,
    GovernanceApprovalsListDto,
    ResolveAnomalyRequestDto,
    TrustRegistryEntryDto,
    TrustRegistryListDto,
    WithdrawApprovalRequestDto,
)
from app.governance.policy import (
    get_policy,
    list_policies,
    update_policy,
)
from app.governance.trust import (
    TrustError,
    assign_tier,
    get_registry_entry,
    list_registry,
)

router = APIRouter(prefix="/governance", tags=["governance"])


# ───────────────────────────── error helpers ────────────────────────────

_APPROVAL_ERROR_STATUS = {
    "approval_not_found": status.HTTP_404_NOT_FOUND,
    "approval_terminal": status.HTTP_409_CONFLICT,
    "action_not_gated": status.HTTP_400_BAD_REQUEST,
    "tier_too_low": status.HTTP_403_FORBIDDEN,
    "self_approval_forbidden": status.HTTP_403_FORBIDDEN,
    "duplicate_decision": status.HTTP_409_CONFLICT,
    "invalid_decision": status.HTTP_400_BAD_REQUEST,
    "forbidden": status.HTTP_403_FORBIDDEN,
}

_ANOMALY_ERROR_STATUS = {
    "anomaly_not_found": status.HTTP_404_NOT_FOUND,
    "anomaly_terminal": status.HTTP_409_CONFLICT,
}

_TRUST_ERROR_STATUS = {
    "user_not_found": status.HTTP_404_NOT_FOUND,
    "invalid_tier": status.HTTP_400_BAD_REQUEST,
    "forbidden": status.HTTP_403_FORBIDDEN,
    "tier_too_low": status.HTTP_403_FORBIDDEN,
    "self_downgrade_forbidden": status.HTTP_400_BAD_REQUEST,
}


def _raise_approval(err: ApprovalError) -> None:
    raise ApiError(
        status_code=_APPROVAL_ERROR_STATUS.get(
            err.code, status.HTTP_400_BAD_REQUEST
        ),
        code=err.code,
        message=err.message,
    )


def _raise_anomaly(err: AnomalyError) -> None:
    raise ApiError(
        status_code=_ANOMALY_ERROR_STATUS.get(
            err.code, status.HTTP_400_BAD_REQUEST
        ),
        code=err.code,
        message=err.message,
    )


def _raise_trust(err: TrustError) -> None:
    raise ApiError(
        status_code=_TRUST_ERROR_STATUS.get(
            err.code, status.HTTP_400_BAD_REQUEST
        ),
        code=err.code,
        message=err.message,
    )


# ───────────────────────────── approvals ────────────────────────────────


@router.get(
    "/approvals",
    response_model=GovernanceApprovalsListDto,
    summary="List governance approval requests with filters",
)
async def list_approvals_route(
    db: DbSession,
    user: CurrentUser,
    state: Optional[str] = Query(default=None),
    action: Optional[str] = Query(default=None),
    requested_by_user_id: Optional[str] = Query(
        default=None, alias="requestedByUserId"
    ),
    subject_key: Optional[str] = Query(default=None, alias="subjectKey"),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> GovernanceApprovalsListDto:
    return await list_approvals(
        db,
        state=state,
        action=action,
        requested_by_user_id=requested_by_user_id,
        subject_key=subject_key,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/approvals/{approval_id}",
    response_model=GovernanceApprovalDto,
    summary="Single governance approval envelope + decisions",
)
async def get_approval_route(
    approval_id: str,
    db: DbSession,
    user: CurrentUser,
) -> GovernanceApprovalDto:
    dto = await get_approval(db, approval_id)
    if dto is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="approval_not_found",
            message=f"no approval with id {approval_id!r}",
        )
    return dto


@router.post(
    "/approvals",
    response_model=GovernanceApprovalDto,
    summary="Create a new governance approval request",
    status_code=status.HTTP_201_CREATED,
)
async def create_approval_route(
    payload: CreateApprovalRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> GovernanceApprovalDto:
    try:
        dto = await create_approval(db, req=payload, actor_user=user)
    except ApprovalError as exc:
        _raise_approval(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.approval.create",
        resource_type="governance.approval",
        resource_id=dto.id,
        outcome="success",
        details={
            "action": dto.action,
            "subjectKey": dto.subject_key,
            "reason": dto.reason,
            "requiredApproverCount": dto.required_approver_count,
        },
    )
    await db.commit()
    return dto


@router.post(
    "/approvals/{approval_id}/decide",
    response_model=GovernanceApprovalDto,
    summary="Approver signs off or rejects a governance approval",
    status_code=status.HTTP_200_OK,
)
async def decide_approval_route(
    approval_id: str,
    payload: DecideApprovalRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> GovernanceApprovalDto:
    try:
        dto = await decide_approval(
            db,
            approval_id=approval_id,
            req=payload,
            actor_user=user,
        )
    except ApprovalError as exc:
        _raise_approval(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.approval.decide",
        resource_type="governance.approval",
        resource_id=dto.id,
        outcome="success",
        details={
            "decision": payload.decision,
            "comment": payload.comment,
            "state": dto.state,
        },
    )
    await db.commit()
    return dto


@router.post(
    "/approvals/{approval_id}/withdraw",
    response_model=GovernanceApprovalDto,
    summary="Requester (or admin) withdraws a governance approval",
    status_code=status.HTTP_200_OK,
)
async def withdraw_approval_route(
    approval_id: str,
    payload: WithdrawApprovalRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> GovernanceApprovalDto:
    try:
        dto = await withdraw_approval(
            db,
            approval_id=approval_id,
            reason=payload.reason,
            actor_user=user,
        )
    except ApprovalError as exc:
        _raise_approval(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.approval.withdraw",
        resource_type="governance.approval",
        resource_id=dto.id,
        outcome="success",
        details={"reason": payload.reason, "state": dto.state},
    )
    await db.commit()
    return dto


# ───────────────────────────── policies ─────────────────────────────────


@router.get(
    "/policies",
    response_model=ApprovalPolicyListDto,
    summary="List every approval policy row",
)
async def list_policies_route(
    db: DbSession,
    user: CurrentUser,
) -> ApprovalPolicyListDto:
    dto = await list_policies(db)
    # list_policies may seed defaults on first read; commit any inserts.
    await db.commit()
    return dto


@router.get(
    "/policies/{action}",
    response_model=ApprovalPolicyDto,
    summary="Single approval policy row",
)
async def get_policy_route(
    action: str,
    db: DbSession,
    user: CurrentUser,
) -> ApprovalPolicyDto:
    dto = await get_policy(db, action)
    if dto is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="policy_not_found",
            message=f"no policy for action {action!r}",
        )
    return dto


@router.patch(
    "/policies/{action}",
    response_model=ApprovalPolicyDto,
    summary="Patch a policy row (admin-gated)",
    status_code=status.HTTP_200_OK,
)
async def patch_policy_route(
    action: str,
    payload: ApprovalPolicyUpdateDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> ApprovalPolicyDto:
    try:
        dto = await update_policy(
            db, action=action, patch=payload, actor_user_id=user.id
        )
    except ValueError as exc:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="invalid_policy_update",
            message=str(exc),
        ) from exc
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.policy.update",
        resource_type="governance.policy",
        resource_id=dto.id,
        outcome="success",
        details={
            "action": action,
            "requiresApproval": dto.requires_approval,
            "minRequesterTier": dto.min_requester_tier,
            "minApproverTier": dto.min_approver_tier,
            "approverCount": dto.approver_count,
            "ttlSeconds": dto.ttl_seconds,
        },
    )
    await db.commit()
    return dto


# ───────────────────────────── anomalies ────────────────────────────────


@router.get(
    "/anomalies",
    response_model=AnomalyAlertsListDto,
    summary="List anomaly alerts with filter",
)
async def list_anomalies_route(
    db: DbSession,
    user: CurrentUser,
    status_filter: Optional[str] = Query(default=None, alias="status"),
    severity: Optional[str] = Query(default=None),
    source: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AnomalyAlertsListDto:
    return await list_anomalies(
        db,
        status=status_filter,
        severity=severity,
        source=source,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/anomalies/{anomaly_id}",
    response_model=AnomalyAlertDto,
    summary="Single anomaly alert",
)
async def get_anomaly_route(
    anomaly_id: str,
    db: DbSession,
    user: CurrentUser,
) -> AnomalyAlertDto:
    dto = await get_anomaly(db, anomaly_id)
    if dto is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="anomaly_not_found",
            message=f"no anomaly alert with id {anomaly_id!r}",
        )
    return dto


@router.post(
    "/anomalies/{anomaly_id}/acknowledge",
    response_model=AnomalyAlertDto,
    summary="Acknowledge an open or suppressed anomaly",
    status_code=status.HTTP_200_OK,
)
async def acknowledge_anomaly_route(
    anomaly_id: str,
    payload: AcknowledgeAnomalyRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> AnomalyAlertDto:
    try:
        dto = await acknowledge_anomaly(
            db, anomaly_id=anomaly_id, req=payload, actor_user=user
        )
    except AnomalyError as exc:
        _raise_anomaly(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.anomaly.acknowledge",
        resource_type="governance.anomaly",
        resource_id=dto.id,
        outcome="success",
        details={
            "comment": payload.comment,
            "suppressForSeconds": payload.suppress_for_seconds,
            "status": dto.status,
        },
    )
    await db.commit()
    return dto


@router.post(
    "/anomalies/{anomaly_id}/resolve",
    response_model=AnomalyAlertDto,
    summary="Resolve an anomaly alert",
    status_code=status.HTTP_200_OK,
)
async def resolve_anomaly_route(
    anomaly_id: str,
    payload: ResolveAnomalyRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> AnomalyAlertDto:
    try:
        dto = await resolve_anomaly(
            db, anomaly_id=anomaly_id, req=payload, actor_user=user
        )
    except AnomalyError as exc:
        _raise_anomaly(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.anomaly.resolve",
        resource_type="governance.anomaly",
        resource_id=dto.id,
        outcome="success",
        details={"comment": payload.comment, "status": dto.status},
    )
    await db.commit()
    return dto


# ───────────────────────────── trust ────────────────────────────────────


@router.get(
    "/trust",
    response_model=TrustRegistryListDto,
    summary="Full trust-tier registry with per-user history",
)
async def list_trust_route(
    db: DbSession,
    user: CurrentUser,
) -> TrustRegistryListDto:
    return await list_registry(db)


@router.get(
    "/trust/{user_id}",
    response_model=TrustRegistryEntryDto,
    summary="Trust-tier registry entry for a user",
)
async def get_trust_route(
    user_id: str,
    db: DbSession,
    user: CurrentUser,
) -> TrustRegistryEntryDto:
    dto = await get_registry_entry(db, user_id)
    if dto is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="user_not_found",
            message=f"no user with id {user_id!r}",
        )
    return dto


@router.post(
    "/trust",
    response_model=TrustRegistryEntryDto,
    summary="Assign a trust tier to a user (admin-gated)",
    status_code=status.HTTP_200_OK,
)
async def assign_trust_route(
    payload: AssignTrustTierRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> TrustRegistryEntryDto:
    try:
        dto = await assign_tier(db, req=payload, actor_user=user)
    except TrustError as exc:
        _raise_trust(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="governance.trust.assign",
        resource_type="governance.trust",
        resource_id=dto.user_id,
        outcome="success",
        details={
            "tier": dto.current_tier,
            "reason": payload.reason,
        },
    )
    await db.commit()
    return dto


__all__ = ["router"]
