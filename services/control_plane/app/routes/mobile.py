"""Mobile operator-inbox HTTP surface — Phase 7 PR6.

Wire contract (camelCase JSON; snake_case aliases accepted):

  * ``GET  /v1/mobile/inbox``           — paginated feed (keyset cursor).
  * ``GET  /v1/mobile/inbox/summary``   — header counts + throttled flag.
  * ``GET  /v1/mobile/inbox/{item_id}`` — single projected row.
  * ``POST /v1/mobile/inbox/{item_id}/ack`` — append an ack-event row.

The inbox is a read-only aggregation over
:class:`AnomalyAlertRow`, :class:`GovernanceApprovalRow`,
:class:`KillSwitchEventRow` and :class:`RebalancePlanRow`. The only
persisted mutation is the append-only ``mobile_inbox_ack_events``
audit row the ack route writes — the underlying governance rows are
never mutated from here. Operators must still route to the desktop
governance surface via the row's ``deepLink`` to take a terminal
action.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Query, Request, status

from app.audit import log_event
from app.db import DbSession
from app.deps import CurrentUser
from app.mobile.dto import (
    MobileInboxAckRequestDto,
    MobileInboxFilterDto,
    MobileInboxItemDto,
    MobileInboxItemKind,
    MobileInboxListDto,
    MobileInboxSeverity,
    MobileInboxStatus,
    MobileInboxSummaryDto,
)
from app.mobile.inbox import (
    acknowledge_inbox_item,
    build_inbox_page,
    build_inbox_summary,
    fetch_inbox_item,
)

router = APIRouter(prefix="/mobile/inbox", tags=["mobile"])


@router.get(
    "",
    response_model=MobileInboxListDto,
    summary="Cursor-paginated mobile operator inbox feed",
    status_code=status.HTTP_200_OK,
)
async def list_inbox_route(
    db: DbSession,
    user: CurrentUser,  # noqa: ARG001 — auth gate only
    kind: Optional[MobileInboxItemKind] = Query(None),
    severity: Optional[MobileInboxSeverity] = Query(None),
    status_filter: Optional[MobileInboxStatus] = Query(
        None, alias="status"
    ),
    cursor: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=200),
) -> MobileInboxListDto:
    filt = MobileInboxFilterDto(
        kind=kind,
        severity=severity,
        status=status_filter,
        cursor=cursor,
        limit=limit,
    )
    return await build_inbox_page(db, filt)


@router.get(
    "/summary",
    response_model=MobileInboxSummaryDto,
    summary="Mobile inbox header counts + throttled flag",
    status_code=status.HTTP_200_OK,
)
async def inbox_summary_route(
    db: DbSession,
    user: CurrentUser,  # noqa: ARG001 — auth gate only
) -> MobileInboxSummaryDto:
    return await build_inbox_summary(db)


@router.get(
    "/{item_id}",
    response_model=MobileInboxItemDto,
    summary="Fetch a single projected mobile-inbox row by id",
    status_code=status.HTTP_200_OK,
)
async def inbox_item_route(
    item_id: str,
    db: DbSession,
    user: CurrentUser,  # noqa: ARG001 — auth gate only
) -> MobileInboxItemDto:
    return await fetch_inbox_item(db, item_id)


@router.post(
    "/{item_id}/ack",
    response_model=MobileInboxItemDto,
    summary="Acknowledge a mobile-inbox row — append-only audit event",
    status_code=status.HTTP_200_OK,
)
async def ack_inbox_item_route(
    item_id: str,
    payload: MobileInboxAckRequestDto,
    request: Request,
    db: DbSession,
    user: CurrentUser,
) -> MobileInboxItemDto:
    dto = await acknowledge_inbox_item(
        db,
        item_id=item_id,
        user_id=user.id,
        note=payload.note,
    )
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="mobile.inbox.acknowledge",
        resource_type="mobile.inbox_item",
        resource_id=item_id,
        outcome="success",
        details={
            "kind": dto.kind,
            "severity": dto.severity,
            "subjectKey": dto.subject_key,
            "subjectSecondaryKey": dto.subject_secondary_key,
            "note": payload.note,
        },
    )
    await db.commit()
    return dto


__all__ = ["router"]
