"""Read-only audit log queries (Phase 0 surface)."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import select

from app.db import DbSession
from app.deps import AdminUser
from app.models import AuditEvent

router = APIRouter(prefix="/admin/audit", tags=["audit"])


class AuditEventOut(BaseModel):
    id: str
    occurredAt: datetime
    actorUserId: str | None
    actorEmail: str | None
    sourceIp: str | None
    userAgent: str | None
    action: str
    resourceType: str
    resourceId: str | None
    outcome: str
    correlationId: str
    details: dict[str, Any]


class AuditListOut(BaseModel):
    events: list[AuditEventOut]
    total: int


@router.get("", response_model=AuditListOut)
async def list_audit(
    user: AdminUser,
    db: DbSession,
    limit: int = Query(default=100, le=500, ge=1),
    action: str | None = Query(default=None),
) -> AuditListOut:
    stmt = select(AuditEvent).order_by(AuditEvent.occurred_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    rows = (await db.scalars(stmt)).all()
    return AuditListOut(
        events=[
            AuditEventOut(
                id=r.id,
                occurredAt=r.occurred_at,
                actorUserId=r.actor_user_id,
                actorEmail=r.actor_email,
                sourceIp=r.source_ip,
                userAgent=r.user_agent,
                action=r.action,
                resourceType=r.resource_type,
                resourceId=r.resource_id,
                outcome=r.outcome,
                correlationId=r.correlation_id,
                details=r.details or {},
            )
            for r in rows
        ],
        total=len(rows),
    )
