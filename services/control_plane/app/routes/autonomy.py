"""Autonomy + kill-switch HTTP surface — Phase 6 PR5.

Wire contract (all responses camelCase JSON, all inputs accept either
snake_case or camelCase):

Autonomy records
  * ``GET   /v1/autonomy/records``                  — list (filter + page).
  * ``GET   /v1/autonomy/records/{strategyId}``     — single record.
  * ``GET   /v1/autonomy/history``                  — paginated transition log.
  * ``POST  /v1/autonomy/records/{strategyId}/transition`` — FSM mutation.

Kill switch
  * ``GET   /v1/autonomy/kill-switch``              — all derived states.
  * ``GET   /v1/autonomy/kill-switch/events``       — event log + filters.
  * ``POST  /v1/autonomy/kill-switch/trip``         — admin-gated.
  * ``POST  /v1/autonomy/kill-switch/reset``        — admin-gated; global
    requires a ``kill_switch_global_reset`` governance approval.

Reads are un-logged. Every mutation funnels through
:func:`app.audit.log_event` with ``resource_type="autonomy.*"`` or
``resource_type="kill_switch.*"``.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request, status

from app.audit import log_event
from app.autonomy.dto import (
    AutonomyHistoryListDto,
    AutonomyRecordDto,
    AutonomyRecordsListDto,
    AutonomyReason,
    AutonomyState,
    AutonomyTransitionAction,
    AutonomyTransitionRequestDto,
    KillSwitchEventDto,
    KillSwitchEventsListDto,
    KillSwitchResetRequestDto,
    KillSwitchScope,
    KillSwitchStatesListDto,
    KillSwitchTripRequestDto,
    KillSwitchTrigger,
)
from app.autonomy.gates import compute_gate_snapshot
from app.autonomy.kill_switch import (
    KillSwitchError,
    list_events as list_kill_switch_events,
    list_states as list_kill_switch_states,
    reset as reset_kill_switch,
    trip as trip_kill_switch,
)
from app.autonomy.records import (
    AutonomyRecordError,
    apply_transition,
    get_record,
    list_history,
    list_records,
)
from app.db import DbSession
from app.deps import AdminUser, CurrentUser
from app.errors import ApiError

router = APIRouter(prefix="/autonomy", tags=["autonomy"])


# ───────────────────────────── error helpers ────────────────────────────

_AUTONOMY_ERROR_STATUS = {
    "strategy_not_found": status.HTTP_404_NOT_FOUND,
    "invalid_transition": status.HTTP_409_CONFLICT,
    "governance_required": status.HTTP_400_BAD_REQUEST,
    "governance_not_found": status.HTTP_404_NOT_FOUND,
    "governance_not_approved": status.HTTP_409_CONFLICT,
    "governance_wrong_action": status.HTTP_400_BAD_REQUEST,
    "autonomy_fsm_error": status.HTTP_400_BAD_REQUEST,
    "autonomy_record_error": status.HTTP_400_BAD_REQUEST,
}

_KILL_SWITCH_ERROR_STATUS = {
    "subject_key_required": status.HTTP_400_BAD_REQUEST,
    "not_tripped": status.HTTP_409_CONFLICT,
    "approval_required": status.HTTP_400_BAD_REQUEST,
    "approval_not_found": status.HTTP_404_NOT_FOUND,
    "approval_not_approved": status.HTTP_409_CONFLICT,
    "approval_wrong_action": status.HTTP_400_BAD_REQUEST,
}


def _raise_autonomy(err: AutonomyRecordError) -> None:
    raise ApiError(
        status_code=_AUTONOMY_ERROR_STATUS.get(
            err.code, status.HTTP_400_BAD_REQUEST
        ),
        code=err.code,
        message=err.message,
    )


def _raise_kill_switch(err: KillSwitchError) -> None:
    raise ApiError(
        status_code=_KILL_SWITCH_ERROR_STATUS.get(
            err.code, status.HTTP_400_BAD_REQUEST
        ),
        code=err.code,
        message=err.message,
    )


# ───────────────────────────── autonomy records ─────────────────────────


@router.get(
    "/records",
    response_model=AutonomyRecordsListDto,
    summary="List autonomy records (one per strategy) with optional state filter",
)
async def list_records_route(
    db: DbSession,
    user: CurrentUser,
    state: Optional[AutonomyState] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AutonomyRecordsListDto:
    return await list_records(db, state=state, limit=limit, offset=offset)


@router.get(
    "/records/{strategy_id}",
    response_model=AutonomyRecordDto,
    summary="Single autonomy record for a strategy",
)
async def get_record_route(
    strategy_id: str,
    db: DbSession,
    user: CurrentUser,
) -> AutonomyRecordDto:
    dto = await get_record(db, strategy_id)
    if dto is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="autonomy_record_not_found",
            message=f"no autonomy record for strategy {strategy_id!r}",
        )
    return dto


@router.get(
    "/history",
    response_model=AutonomyHistoryListDto,
    summary="Paginated autonomy transition history with filters",
)
async def list_history_route(
    db: DbSession,
    user: CurrentUser,
    strategy_id: Optional[str] = Query(default=None, alias="strategyId"),
    reason: Optional[AutonomyReason] = Query(default=None),
    state: Optional[AutonomyState] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> AutonomyHistoryListDto:
    return await list_history(
        db,
        strategy_id=strategy_id,
        reason=reason,
        state=state,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/records/{strategy_id}/transition",
    response_model=AutonomyRecordDto,
    summary="Apply an FSM-valid transition to a strategy's autonomy record",
    status_code=status.HTTP_200_OK,
)
async def transition_record_route(
    strategy_id: str,
    payload: AutonomyTransitionRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> AutonomyRecordDto:
    # If the request body and path disagree, the path wins — defensive.
    effective_strategy_id = payload.strategy_id or strategy_id
    if effective_strategy_id != strategy_id:
        raise ApiError(
            status_code=status.HTTP_400_BAD_REQUEST,
            code="strategy_id_mismatch",
            message=(
                f"path strategy_id {strategy_id!r} does not match "
                f"body strategy_id {payload.strategy_id!r}"
            ),
        )

    # Best-effort fresh gate snapshot so the history row captures the
    # live readiness at the moment of transition.
    try:
        snap = await compute_gate_snapshot(db, strategy_id=strategy_id)
    except Exception:
        snap = None

    action: AutonomyTransitionAction = payload.action
    try:
        record, history = await apply_transition(
            db,
            strategy_id=strategy_id,
            action=action,
            reason_note=payload.reason,
            actor_user=user,
            approval_id=payload.approval_id,
            gates=snap,
        )
    except AutonomyRecordError as exc:
        _raise_autonomy(exc)
        raise

    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action=f"autonomy.transition.{action}",
        resource_type="autonomy.record",
        resource_id=strategy_id,
        outcome="success",
        details={
            "action": action,
            "fromState": history.from_state,
            "toState": history.to_state,
            "reason": history.reason,
            "note": payload.reason,
            "approvalId": payload.approval_id,
            "historyEventId": history.id,
        },
    )
    await db.commit()
    return record


# ───────────────────────────── kill switch ──────────────────────────────


@router.get(
    "/kill-switch",
    response_model=KillSwitchStatesListDto,
    summary="All derived kill-switch states (global + per-scope).",
)
async def list_kill_switch_states_route(
    db: DbSession,
    user: CurrentUser,
) -> KillSwitchStatesListDto:
    return await list_kill_switch_states(db)


@router.get(
    "/kill-switch/events",
    response_model=KillSwitchEventsListDto,
    summary="Kill-switch event log with filters",
)
async def list_kill_switch_events_route(
    db: DbSession,
    user: CurrentUser,
    scope: Optional[KillSwitchScope] = Query(default=None),
    subject_key: Optional[str] = Query(default=None, alias="subjectKey"),
    trigger: Optional[KillSwitchTrigger] = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
) -> KillSwitchEventsListDto:
    return await list_kill_switch_events(
        db,
        scope=scope,
        subject_key=subject_key,
        trigger=trigger,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/kill-switch/trip",
    response_model=KillSwitchEventDto,
    summary="Trip the kill switch (global / account / strategy) — admin-gated.",
    status_code=status.HTTP_201_CREATED,
)
async def trip_kill_switch_route(
    payload: KillSwitchTripRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> KillSwitchEventDto:
    try:
        dto = await trip_kill_switch(db, req=payload, actor_user=user)
    except KillSwitchError as exc:
        _raise_kill_switch(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="kill_switch.trip",
        resource_type="kill_switch.event",
        resource_id=dto.id,
        outcome="success",
        details={
            "scope": dto.scope,
            "subjectKey": dto.subject_key,
            "trigger": dto.trigger,
            "reason": dto.reason,
        },
    )
    await db.commit()
    return dto


@router.post(
    "/kill-switch/reset",
    response_model=KillSwitchEventDto,
    summary="Reset the kill switch — global scope requires a governance approval.",
    status_code=status.HTTP_200_OK,
)
async def reset_kill_switch_route(
    payload: KillSwitchResetRequestDto,
    request: Request,
    db: DbSession,
    user: AdminUser,
) -> KillSwitchEventDto:
    try:
        dto = await reset_kill_switch(db, req=payload, actor_user=user)
    except KillSwitchError as exc:
        _raise_kill_switch(exc)
        raise
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="kill_switch.reset",
        resource_type="kill_switch.event",
        resource_id=dto.id,
        outcome="success",
        details={
            "scope": dto.scope,
            "subjectKey": dto.subject_key,
            "reason": dto.reason,
            "approvalId": dto.approval_id,
        },
    )
    await db.commit()
    return dto


__all__ = ["router"]
