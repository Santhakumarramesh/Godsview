"""Thin audit logger used by every state-changing route."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.models import AuditEvent


async def log_event(
    session: AsyncSession,
    *,
    request: Request | None,
    actor_user_id: str | None,
    actor_email: str | None,
    action: str,
    resource_type: str,
    resource_id: str | None,
    outcome: str,
    details: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        id=f"aud_{uuid.uuid4().hex}",
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        source_ip=(request.client.host if request and request.client else None),
        user_agent=(request.headers.get("user-agent") if request else None),
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        outcome=outcome,
        correlation_id=(
            getattr(request.state, "correlation_id", "unknown") if request else "system"
        ),
        details=details or {},
    )
    session.add(event)
    await session.flush()
    return event
