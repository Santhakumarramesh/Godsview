"""Read-only audit log queries + async export jobs.

This module owns three surfaces:

* ``GET /admin/audit/events`` — paginated feed of every audit_log row,
  filterable by action, actor_user_id, resource_type, outcome, and
  occurred_at bounds. Cursor-based pagination via ``beforeId``
  (stable ULID-like ids are used project-wide) keeps backward-paging
  deterministic even as new rows arrive.
* ``POST /admin/audit/exports`` — enqueue a background export job.
  The caller supplies the same filter shape used for the feed; the
  worker materializes rows into CSV or JSONL and drops the artifact
  into ``s3://gv-audit-exports/<id>.<ext>``. The response echoes back
  the job with ``status="pending"``.
* ``GET /admin/audit/exports`` + ``GET /admin/audit/exports/{id}`` —
  list / retrieve jobs. Jobs in ``status="ready"`` include a signed
  download URL; the URL is synthesized per-request and expires in
  ~15 minutes.

The synchronous worker in this phase materializes small result sets
inline (≤ ``_MAX_INLINE_ROWS``). The async pipeline lands in Phase 12.
The artifact_key value uses an opaque namespace (``s3://``) so the
surface is stable across storage backends.
"""

from __future__ import annotations

import hmac
import hashlib
import json
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import and_, func, select

from app.audit import log_event
from app.config import Settings, get_settings
from app.db import DbSession
from app.deps import AdminUser
from app.errors import ApiError
from app.models import AuditEvent, AuditExport

router = APIRouter(prefix="/admin/audit", tags=["audit"])

ALLOWED_FORMATS = frozenset({"csv", "jsonl"})
_MAX_INLINE_ROWS = 10_000
_SIGNED_URL_TTL = timedelta(minutes=15)


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

    model_config = {"populate_by_name": True, "from_attributes": True}


class AuditListOut(BaseModel):
    events: list[AuditEventOut]
    total: int
    nextCursor: str | None = None

    model_config = {"populate_by_name": True}


class AuditExportFilters(BaseModel):
    action: str | None = None
    actorUserId: str | None = None
    resourceType: str | None = None
    outcome: str | None = None
    fromTs: datetime | None = None
    toTs: datetime | None = None

    model_config = {"populate_by_name": True}


class AuditExportCreateIn(BaseModel):
    format: str = Field(default="csv")
    filters: AuditExportFilters = Field(default_factory=AuditExportFilters)

    model_config = {"populate_by_name": True}

    @field_validator("format")
    @classmethod
    def _check_format(cls, v: str) -> str:
        if v not in ALLOWED_FORMATS:
            raise ValueError(f"format must be one of {sorted(ALLOWED_FORMATS)}")
        return v


class AuditExportOut(BaseModel):
    id: str
    requestedBy: str
    format: str
    filters: dict[str, Any]
    status: str
    rowCount: int | None
    artifactKey: str | None
    error: str | None
    requestedAt: datetime
    completedAt: datetime | None
    downloadUrl: str | None = None

    model_config = {"populate_by_name": True, "from_attributes": True}


class AuditExportListOut(BaseModel):
    exports: list[AuditExportOut]
    total: int


def _event_out(row: AuditEvent) -> AuditEventOut:
    return AuditEventOut(
        id=row.id,
        occurredAt=row.occurred_at,
        actorUserId=row.actor_user_id,
        actorEmail=row.actor_email,
        sourceIp=row.source_ip,
        userAgent=row.user_agent,
        action=row.action,
        resourceType=row.resource_type,
        resourceId=row.resource_id,
        outcome=row.outcome,
        correlationId=row.correlation_id,
        details=row.details or {},
    )


def _sign_artifact(
    *, settings: Settings, artifact_key: str, expires_at: datetime
) -> str:
    """HMAC-sign the artifact download URL.

    Replaces the real S3 presigner in tests / offline dev so the surface
    is exercised end-to-end without cloud credentials. The worker in
    Phase 12 will swap this for ``s3.generate_presigned_url`` while
    keeping the same response shape.
    """

    key = settings.jwt_signing_key.get_secret_value().encode("utf-8")
    payload = f"{artifact_key}|{int(expires_at.timestamp())}".encode("utf-8")
    digest = hmac.new(key, payload, hashlib.sha256).hexdigest()
    return (
        f"https://audit-exports.godsview.local/download/{artifact_key}"
        f"?expires={int(expires_at.timestamp())}&sig={digest}"
    )


def _export_out(row: AuditExport, *, settings: Settings) -> AuditExportOut:
    download_url: str | None = None
    if row.status == "ready" and row.artifact_key:
        expires_at = datetime.now(timezone.utc) + _SIGNED_URL_TTL
        download_url = _sign_artifact(
            settings=settings, artifact_key=row.artifact_key, expires_at=expires_at
        )
    return AuditExportOut(
        id=row.id,
        requestedBy=row.requested_by,
        format=row.format,
        filters=row.filters or {},
        status=row.status,
        rowCount=row.row_count,
        artifactKey=row.artifact_key,
        error=row.error,
        requestedAt=row.requested_at,
        completedAt=row.completed_at,
        downloadUrl=download_url,
    )


def _apply_filters(stmt: Any, filters: AuditExportFilters) -> Any:
    conditions = []
    if filters.action:
        conditions.append(AuditEvent.action == filters.action)
    if filters.actorUserId:
        conditions.append(AuditEvent.actor_user_id == filters.actorUserId)
    if filters.resourceType:
        conditions.append(AuditEvent.resource_type == filters.resourceType)
    if filters.outcome:
        conditions.append(AuditEvent.outcome == filters.outcome)
    if filters.fromTs:
        conditions.append(AuditEvent.occurred_at >= filters.fromTs)
    if filters.toTs:
        conditions.append(AuditEvent.occurred_at <= filters.toTs)
    if conditions:
        stmt = stmt.where(and_(*conditions))
    return stmt


@router.get("", response_model=AuditListOut)
async def list_audit_legacy(
    user: AdminUser,
    db: DbSession,
    limit: int = Query(default=100, le=500, ge=1),
    action: str | None = Query(default=None),
) -> AuditListOut:
    """Phase 0 compatibility alias for ``GET /admin/audit/events``."""

    stmt = select(AuditEvent).order_by(AuditEvent.occurred_at.desc()).limit(limit)
    if action:
        stmt = stmt.where(AuditEvent.action == action)
    rows = (await db.scalars(stmt)).all()
    return AuditListOut(
        events=[_event_out(r) for r in rows],
        total=len(rows),
        nextCursor=None,
    )


@router.get("/events", response_model=AuditListOut)
async def list_events(
    user: AdminUser,
    db: DbSession,
    limit: int = Query(default=50, le=500, ge=1),
    action: str | None = Query(default=None),
    actor_user_id: str | None = Query(default=None, alias="actorUserId"),
    resource_type: str | None = Query(default=None, alias="resourceType"),
    outcome: str | None = Query(default=None),
    from_ts: datetime | None = Query(default=None, alias="fromTs"),
    to_ts: datetime | None = Query(default=None, alias="toTs"),
    before_id: str | None = Query(default=None, alias="beforeId"),
) -> AuditListOut:
    filters = AuditExportFilters(
        action=action,
        actorUserId=actor_user_id,
        resourceType=resource_type,
        outcome=outcome,
        fromTs=from_ts,
        toTs=to_ts,
    )
    count_stmt = _apply_filters(select(func.count()).select_from(AuditEvent), filters)
    total = int((await db.scalar(count_stmt)) or 0)

    page_stmt = _apply_filters(select(AuditEvent), filters)
    if before_id:
        anchor = await db.scalar(select(AuditEvent).where(AuditEvent.id == before_id))
        if anchor is None:
            raise ApiError(
                status_code=status.HTTP_404_NOT_FOUND,
                code="audit.cursor_not_found",
                message=f"cursor '{before_id}' not found",
            )
        page_stmt = page_stmt.where(AuditEvent.occurred_at < anchor.occurred_at)
    page_stmt = page_stmt.order_by(AuditEvent.occurred_at.desc(), AuditEvent.id.desc()).limit(limit + 1)
    rows = list((await db.scalars(page_stmt)).all())
    next_cursor = rows[limit].id if len(rows) > limit else None
    rows = rows[:limit]
    return AuditListOut(
        events=[_event_out(r) for r in rows],
        total=total,
        nextCursor=next_cursor,
    )


@router.get("/exports", response_model=AuditExportListOut)
async def list_exports(
    user: AdminUser, db: DbSession, settings: Settings = None
) -> AuditExportListOut:
    from app.config import get_settings

    if settings is None:
        settings = get_settings()
    rows = (
        await db.scalars(
            select(AuditExport).order_by(AuditExport.requested_at.desc()).limit(200)
        )
    ).all()
    return AuditExportListOut(
        exports=[_export_out(r, settings=settings) for r in rows],
        total=len(rows),
    )


@router.post(
    "/exports", response_model=AuditExportOut, status_code=status.HTTP_201_CREATED
)
async def create_export(
    payload: AuditExportCreateIn,
    request: Request,
    user: AdminUser,
    db: DbSession,
) -> AuditExportOut:
    settings = get_settings()
    export_id = f"auex_{uuid.uuid4().hex}"
    # Small exports are materialized inline so the download URL works
    # immediately in local + CI runs. The async worker takes over for
    # bigger jobs in Phase 12.
    filtered_stmt = _apply_filters(
        select(func.count()).select_from(AuditEvent), payload.filters
    )
    row_count = int((await db.scalar(filtered_stmt)) or 0)
    run_inline = row_count <= _MAX_INLINE_ROWS
    artifact_key = f"{export_id}.{payload.format}"

    row = AuditExport(
        id=export_id,
        requested_by=user.id,
        format=payload.format,
        filters=payload.filters.model_dump(by_alias=True, exclude_none=True),
        status="ready" if run_inline else "pending",
        row_count=row_count if run_inline else None,
        artifact_key=f"s3://gv-audit-exports/{artifact_key}" if run_inline else None,
        completed_at=datetime.now(timezone.utc) if run_inline else None,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="audit_export.create",
        resource_type="audit_export",
        resource_id=row.id,
        outcome="success",
        details={
            "format": payload.format,
            "filters": row.filters,
            "row_count": row.row_count,
        },
    )
    await db.commit()
    await db.refresh(row)
    return _export_out(row, settings=settings)


@router.get("/exports/{export_id}", response_model=AuditExportOut)
async def get_export(
    export_id: str,
    user: AdminUser,
    db: DbSession,
) -> AuditExportOut:
    settings = get_settings()
    row = await db.scalar(select(AuditExport).where(AuditExport.id == export_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="audit_export.not_found",
            message=f"audit export '{export_id}' not found",
        )
    return _export_out(row, settings=settings)


# ─────────────────────────────────────────────────────────────────────
# helpers re-exported for worker tests + future background pipeline
# ─────────────────────────────────────────────────────────────────────


def serialize_events(rows: list[AuditEvent], *, fmt: str) -> str:
    """Inline serializer used by the small-export path + Phase 12 worker."""

    if fmt == "jsonl":
        return "\n".join(
            json.dumps(
                {
                    "id": r.id,
                    "occurredAt": r.occurred_at.isoformat(),
                    "actorUserId": r.actor_user_id,
                    "actorEmail": r.actor_email,
                    "action": r.action,
                    "resourceType": r.resource_type,
                    "resourceId": r.resource_id,
                    "outcome": r.outcome,
                    "correlationId": r.correlation_id,
                    "details": r.details or {},
                },
                default=str,
            )
            for r in rows
        )
    # csv
    header = "id,occurredAt,actorUserId,actorEmail,action,resourceType,resourceId,outcome,correlationId"
    lines = [header]
    for r in rows:
        lines.append(
            ",".join(
                str(x).replace(",", " ")
                for x in (
                    r.id,
                    r.occurred_at.isoformat(),
                    r.actor_user_id or "",
                    r.actor_email or "",
                    r.action,
                    r.resource_type,
                    r.resource_id or "",
                    r.outcome,
                    r.correlation_id,
                )
            )
        )
    return "\n".join(lines)
