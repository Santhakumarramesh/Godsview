"""Operational read + lifecycle surface — /admin/ops/*.

Split into five sub-surfaces:

* SLOs        — CRUD on service-level objectives owned by ops/platform.
* Alerts      — list / acknowledge / resolve operational alerts.
* Incidents   — multi-alert investigation lifecycle.
* Deployments — CI/CD-fed release timeline.
* Latency     — synthetic histograms (Phase 12 swaps to live Prometheus).
* Logs        — recent audit_log + structured app-log surface for the
                ops sidebar; Phase 12 wires real CloudWatch tailing.

The ``latency`` and ``logs`` endpoints currently return deterministic
synthetic data so the dashboard widgets render with real shapes during
local dev + e2e CI. Phase 12 swaps these for live Prometheus + CW
integrations behind the same response shapes.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

from fastapi import APIRouter, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.audit import log_event
from app.db import DbSession
from app.deps import AdminUser, OperatorOrAdmin
from app.errors import ApiError
from app.models import Alert, AuditEvent, Deployment, Incident, Slo

router = APIRouter(prefix="/admin/ops", tags=["ops"])

ALLOWED_SEVERITIES = frozenset({"low", "medium", "high", "critical"})
ALLOWED_ALERT_STATUSES = frozenset({"open", "acknowledged", "resolved"})
ALLOWED_INCIDENT_STATUSES = frozenset(
    {"investigating", "identified", "monitoring", "resolved"}
)
ALLOWED_ENVIRONMENTS = frozenset({"local", "dev", "staging", "production"})
ALLOWED_DEPLOY_STATUSES = frozenset({"in_progress", "succeeded", "failed", "rolled_back"})


# ─────────────────────────────────────────────────────────────────────
# SLOs
# ─────────────────────────────────────────────────────────────────────


class SloOut(BaseModel):
    id: str
    key: str
    description: str
    target: str
    windowSeconds: int
    ownerTeam: str
    createdAt: datetime
    updatedAt: datetime

    model_config = {"populate_by_name": True, "from_attributes": True}


class SloListOut(BaseModel):
    slos: list[SloOut]
    total: int


class SloCreateIn(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    description: str = ""
    target: str = Field(min_length=1, max_length=32)
    windowSeconds: int = Field(gt=0, le=60 * 60 * 24 * 30)
    ownerTeam: str = "platform"

    model_config = {"populate_by_name": True}


class SloPatchIn(BaseModel):
    description: str | None = None
    target: str | None = Field(default=None, min_length=1, max_length=32)
    windowSeconds: int | None = Field(default=None, gt=0, le=60 * 60 * 24 * 30)
    ownerTeam: str | None = None

    model_config = {"populate_by_name": True}


def _slo_out(row: Slo) -> SloOut:
    return SloOut(
        id=row.id,
        key=row.key,
        description=row.description,
        target=row.target,
        windowSeconds=row.window_seconds,
        ownerTeam=row.owner_team,
        createdAt=row.created_at,
        updatedAt=row.updated_at,
    )


@router.get("/slos", response_model=SloListOut)
async def list_slos(user: OperatorOrAdmin, db: DbSession) -> SloListOut:
    rows = (await db.scalars(select(Slo).order_by(Slo.key))).all()
    return SloListOut(slos=[_slo_out(r) for r in rows], total=len(rows))


@router.post("/slos", response_model=SloOut, status_code=status.HTTP_201_CREATED)
async def create_slo(
    payload: SloCreateIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> SloOut:
    existing = await db.scalar(select(Slo).where(Slo.key == payload.key))
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="ops.slo.key_exists",
            message=f"SLO with key '{payload.key}' already exists",
        )
    row = Slo(
        id=f"slo_{uuid.uuid4().hex}",
        key=payload.key,
        description=payload.description,
        target=payload.target,
        window_seconds=payload.windowSeconds,
        owner_team=payload.ownerTeam,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="slo.create",
        resource_type="slo",
        resource_id=row.id,
        outcome="success",
        details={"key": payload.key, "target": payload.target},
    )
    await db.commit()
    await db.refresh(row)
    return _slo_out(row)


@router.patch("/slos/{slo_id}", response_model=SloOut)
async def update_slo(
    slo_id: str,
    payload: SloPatchIn,
    request: Request,
    admin: AdminUser,
    db: DbSession,
) -> SloOut:
    row = await db.scalar(select(Slo).where(Slo.id == slo_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ops.slo.not_found",
            message=f"slo '{slo_id}' not found",
        )
    if payload.description is not None:
        row.description = payload.description
    if payload.target is not None:
        row.target = payload.target
    if payload.windowSeconds is not None:
        row.window_seconds = payload.windowSeconds
    if payload.ownerTeam is not None:
        row.owner_team = payload.ownerTeam
    await log_event(
        db,
        request=request,
        actor_user_id=admin.id,
        actor_email=admin.email,
        action="slo.update",
        resource_type="slo",
        resource_id=row.id,
        outcome="success",
        details=payload.model_dump(exclude_none=True, by_alias=True),
    )
    await db.commit()
    await db.refresh(row)
    return _slo_out(row)


# ─────────────────────────────────────────────────────────────────────
# Alerts
# ─────────────────────────────────────────────────────────────────────


class AlertOut(BaseModel):
    id: str
    sloKey: str | None
    severity: str
    status: str
    title: str
    description: str
    runbookUrl: str | None
    openedAt: datetime
    acknowledgedAt: datetime | None
    acknowledgedBy: str | None
    resolvedAt: datetime | None
    details: dict[str, Any]

    model_config = {"populate_by_name": True, "from_attributes": True}


class AlertListOut(BaseModel):
    alerts: list[AlertOut]
    total: int


class AlertCreateIn(BaseModel):
    sloKey: str | None = None
    severity: str
    title: str = Field(min_length=1, max_length=255)
    description: str = ""
    runbookUrl: str | None = None
    details: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


def _alert_out(row: Alert) -> AlertOut:
    return AlertOut(
        id=row.id,
        sloKey=row.slo_key,
        severity=row.severity,
        status=row.status,
        title=row.title,
        description=row.description,
        runbookUrl=row.runbook_url,
        openedAt=row.opened_at,
        acknowledgedAt=row.acknowledged_at,
        acknowledgedBy=row.acknowledged_by,
        resolvedAt=row.resolved_at,
        details=row.details or {},
    )


def _check_severity(value: str) -> str:
    if value not in ALLOWED_SEVERITIES:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="ops.alert.invalid_severity",
            message=f"unknown severity '{value}'",
        )
    return value


@router.get("/alerts", response_model=AlertListOut)
async def list_alerts(
    user: OperatorOrAdmin,
    db: DbSession,
    status_filter: str | None = Query(default=None, alias="status"),
    severity: str | None = Query(default=None),
    limit: int = Query(default=200, le=500, ge=1),
) -> AlertListOut:
    stmt = select(Alert).order_by(Alert.opened_at.desc()).limit(limit)
    if status_filter:
        if status_filter not in ALLOWED_ALERT_STATUSES:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="ops.alert.invalid_status",
                message=f"unknown status '{status_filter}'",
            )
        stmt = stmt.where(Alert.status == status_filter)
    if severity:
        _check_severity(severity)
        stmt = stmt.where(Alert.severity == severity)
    rows = (await db.scalars(stmt)).all()
    return AlertListOut(alerts=[_alert_out(r) for r in rows], total=len(rows))


@router.post("/alerts", response_model=AlertOut, status_code=status.HTTP_201_CREATED)
async def create_alert(
    payload: AlertCreateIn,
    request: Request,
    user: OperatorOrAdmin,
    db: DbSession,
) -> AlertOut:
    severity = _check_severity(payload.severity)
    row = Alert(
        id=f"alr_{uuid.uuid4().hex}",
        slo_key=payload.sloKey,
        severity=severity,
        status="open",
        title=payload.title,
        description=payload.description,
        runbook_url=payload.runbookUrl,
        details=payload.details,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="alert.create",
        resource_type="alert",
        resource_id=row.id,
        outcome="success",
        details={"severity": severity, "title": payload.title, "sloKey": payload.sloKey},
    )
    await db.commit()
    await db.refresh(row)
    return _alert_out(row)


@router.post("/alerts/{alert_id}/acknowledge", response_model=AlertOut)
async def acknowledge_alert(
    alert_id: str,
    request: Request,
    user: OperatorOrAdmin,
    db: DbSession,
) -> AlertOut:
    row = await db.scalar(select(Alert).where(Alert.id == alert_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ops.alert.not_found",
            message=f"alert '{alert_id}' not found",
        )
    if row.status != "open":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="ops.alert.invalid_transition",
            message=f"cannot acknowledge alert in status '{row.status}'",
        )
    row.status = "acknowledged"
    row.acknowledged_at = datetime.now(timezone.utc)
    row.acknowledged_by = user.id
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="alert.acknowledge",
        resource_type="alert",
        resource_id=row.id,
        outcome="success",
    )
    await db.commit()
    await db.refresh(row)
    return _alert_out(row)


@router.post("/alerts/{alert_id}/resolve", response_model=AlertOut)
async def resolve_alert(
    alert_id: str,
    request: Request,
    user: OperatorOrAdmin,
    db: DbSession,
) -> AlertOut:
    row = await db.scalar(select(Alert).where(Alert.id == alert_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ops.alert.not_found",
            message=f"alert '{alert_id}' not found",
        )
    if row.status == "resolved":
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="ops.alert.invalid_transition",
            message="alert already resolved",
        )
    row.status = "resolved"
    row.resolved_at = datetime.now(timezone.utc)
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="alert.resolve",
        resource_type="alert",
        resource_id=row.id,
        outcome="success",
    )
    await db.commit()
    await db.refresh(row)
    return _alert_out(row)


# ─────────────────────────────────────────────────────────────────────
# Incidents
# ─────────────────────────────────────────────────────────────────────


class IncidentOut(BaseModel):
    id: str
    code: str
    title: str
    severity: str
    status: str
    summary: str
    postmortemUrl: str | None
    openedAt: datetime
    resolvedAt: datetime | None
    ownerUserId: str | None

    model_config = {"populate_by_name": True, "from_attributes": True}


class IncidentListOut(BaseModel):
    incidents: list[IncidentOut]
    total: int


class IncidentCreateIn(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    title: str = Field(min_length=1, max_length=255)
    severity: str
    summary: str = ""

    model_config = {"populate_by_name": True}


class IncidentPatchIn(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    severity: str | None = None
    status: str | None = None
    summary: str | None = None
    postmortemUrl: str | None = None
    ownerUserId: str | None = None

    model_config = {"populate_by_name": True}


def _incident_out(row: Incident) -> IncidentOut:
    return IncidentOut(
        id=row.id,
        code=row.code,
        title=row.title,
        severity=row.severity,
        status=row.status,
        summary=row.summary,
        postmortemUrl=row.postmortem_url,
        openedAt=row.opened_at,
        resolvedAt=row.resolved_at,
        ownerUserId=row.owner_user_id,
    )


@router.get("/incidents", response_model=IncidentListOut)
async def list_incidents(
    user: OperatorOrAdmin, db: DbSession
) -> IncidentListOut:
    rows = (
        await db.scalars(select(Incident).order_by(Incident.opened_at.desc()))
    ).all()
    return IncidentListOut(
        incidents=[_incident_out(r) for r in rows], total=len(rows)
    )


@router.post(
    "/incidents", response_model=IncidentOut, status_code=status.HTTP_201_CREATED
)
async def create_incident(
    payload: IncidentCreateIn,
    request: Request,
    user: OperatorOrAdmin,
    db: DbSession,
) -> IncidentOut:
    severity = _check_severity(payload.severity)
    existing = await db.scalar(select(Incident).where(Incident.code == payload.code))
    if existing is not None:
        raise ApiError(
            status_code=status.HTTP_409_CONFLICT,
            code="ops.incident.code_exists",
            message=f"incident with code '{payload.code}' already exists",
        )
    row = Incident(
        id=f"inc_{uuid.uuid4().hex}",
        code=payload.code,
        title=payload.title,
        severity=severity,
        status="investigating",
        summary=payload.summary,
        owner_user_id=user.id,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="incident.create",
        resource_type="incident",
        resource_id=row.id,
        outcome="success",
        details={"code": payload.code, "severity": severity},
    )
    await db.commit()
    await db.refresh(row)
    return _incident_out(row)


@router.patch("/incidents/{incident_id}", response_model=IncidentOut)
async def update_incident(
    incident_id: str,
    payload: IncidentPatchIn,
    request: Request,
    user: OperatorOrAdmin,
    db: DbSession,
) -> IncidentOut:
    row = await db.scalar(select(Incident).where(Incident.id == incident_id))
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="ops.incident.not_found",
            message=f"incident '{incident_id}' not found",
        )
    if payload.title is not None:
        row.title = payload.title
    if payload.severity is not None:
        row.severity = _check_severity(payload.severity)
    if payload.status is not None:
        if payload.status not in ALLOWED_INCIDENT_STATUSES:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="ops.incident.invalid_status",
                message=f"unknown status '{payload.status}'",
            )
        row.status = payload.status
        if payload.status == "resolved" and row.resolved_at is None:
            row.resolved_at = datetime.now(timezone.utc)
    if payload.summary is not None:
        row.summary = payload.summary
    if payload.postmortemUrl is not None:
        row.postmortem_url = payload.postmortemUrl
    if payload.ownerUserId is not None:
        row.owner_user_id = payload.ownerUserId
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="incident.update",
        resource_type="incident",
        resource_id=row.id,
        outcome="success",
        details=payload.model_dump(exclude_none=True, by_alias=True),
    )
    await db.commit()
    await db.refresh(row)
    return _incident_out(row)


# ─────────────────────────────────────────────────────────────────────
# Deployments
# ─────────────────────────────────────────────────────────────────────


class DeploymentOut(BaseModel):
    id: str
    service: str
    version: str
    environment: str
    startedAt: datetime
    finishedAt: datetime | None
    status: str
    initiator: str | None
    commitSha: str | None
    rollbackOf: str | None

    model_config = {"populate_by_name": True, "from_attributes": True}


class DeploymentListOut(BaseModel):
    deployments: list[DeploymentOut]
    total: int


class DeploymentCreateIn(BaseModel):
    service: str = Field(min_length=1, max_length=64)
    version: str = Field(min_length=1, max_length=80)
    environment: str
    status: str = "in_progress"
    initiator: str | None = None
    commitSha: str | None = Field(default=None, max_length=64)
    rollbackOf: str | None = None

    model_config = {"populate_by_name": True}


def _deployment_out(row: Deployment) -> DeploymentOut:
    return DeploymentOut(
        id=row.id,
        service=row.service,
        version=row.version,
        environment=row.environment,
        startedAt=row.started_at,
        finishedAt=row.finished_at,
        status=row.status,
        initiator=row.initiator,
        commitSha=row.commit_sha,
        rollbackOf=row.rollback_of,
    )


@router.get("/deployments", response_model=DeploymentListOut)
async def list_deployments(
    user: OperatorOrAdmin,
    db: DbSession,
    service: str | None = Query(default=None),
    environment: str | None = Query(default=None),
    limit: int = Query(default=200, le=500, ge=1),
) -> DeploymentListOut:
    stmt = select(Deployment).order_by(Deployment.started_at.desc()).limit(limit)
    if service:
        stmt = stmt.where(Deployment.service == service)
    if environment:
        if environment not in ALLOWED_ENVIRONMENTS:
            raise ApiError(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                code="ops.deployment.invalid_environment",
                message=f"unknown environment '{environment}'",
            )
        stmt = stmt.where(Deployment.environment == environment)
    rows = (await db.scalars(stmt)).all()
    return DeploymentListOut(
        deployments=[_deployment_out(r) for r in rows], total=len(rows)
    )


@router.post(
    "/deployments",
    response_model=DeploymentOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_deployment(
    payload: DeploymentCreateIn,
    request: Request,
    user: OperatorOrAdmin,
    db: DbSession,
) -> DeploymentOut:
    if payload.environment not in ALLOWED_ENVIRONMENTS:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="ops.deployment.invalid_environment",
            message=f"unknown environment '{payload.environment}'",
        )
    if payload.status not in ALLOWED_DEPLOY_STATUSES:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="ops.deployment.invalid_status",
            message=f"unknown status '{payload.status}'",
        )
    finished_at = (
        datetime.now(timezone.utc) if payload.status != "in_progress" else None
    )
    row = Deployment(
        id=f"dep_{uuid.uuid4().hex}",
        service=payload.service,
        version=payload.version,
        environment=payload.environment,
        status=payload.status,
        initiator=payload.initiator or user.email,
        commit_sha=payload.commitSha,
        rollback_of=payload.rollbackOf,
        finished_at=finished_at,
    )
    db.add(row)
    await db.flush()
    await log_event(
        db,
        request=request,
        actor_user_id=user.id,
        actor_email=user.email,
        action="deployment.create",
        resource_type="deployment",
        resource_id=row.id,
        outcome="success",
        details={
            "service": payload.service,
            "version": payload.version,
            "environment": payload.environment,
            "status": payload.status,
        },
    )
    await db.commit()
    await db.refresh(row)
    return _deployment_out(row)


# ─────────────────────────────────────────────────────────────────────
# Latency (synthetic until Phase 12 wires Prometheus)
# ─────────────────────────────────────────────────────────────────────


class LatencyBucket(BaseModel):
    p50Ms: float
    p95Ms: float
    p99Ms: float
    sampleCount: int
    bucketStart: datetime

    model_config = {"populate_by_name": True}


class LatencySeriesOut(BaseModel):
    service: str
    operation: str
    windowSeconds: int
    buckets: list[LatencyBucket]


def _synthesize_latency(
    *, service: str, operation: str, window_seconds: int, buckets: int
) -> LatencySeriesOut:
    """Deterministic shape derived from a hash of (service, operation).

    Real Prometheus integration takes over in Phase 12, but the
    response shape is locked here so the dashboard is stable.
    """

    seed = int.from_bytes(
        hashlib.sha256(f"{service}:{operation}".encode()).digest()[:4],
        "big",
    )
    base_p50 = 25 + (seed % 50)
    now = datetime.now(timezone.utc)
    out: list[LatencyBucket] = []
    bucket_size = window_seconds // max(buckets, 1)
    for i in range(buckets):
        jitter = ((seed + i) % 11) - 5
        p50 = max(1.0, base_p50 + jitter)
        p95 = p50 * 2.6
        p99 = p50 * 4.1
        out.append(
            LatencyBucket(
                p50Ms=round(p50, 2),
                p95Ms=round(p95, 2),
                p99Ms=round(p99, 2),
                sampleCount=300 + (seed + i) % 400,
                bucketStart=now - timedelta(seconds=bucket_size * (buckets - i)),
            )
        )
    return LatencySeriesOut(
        service=service,
        operation=operation,
        windowSeconds=window_seconds,
        buckets=out,
    )


@router.get("/latency", response_model=LatencySeriesOut)
async def get_latency(
    user: OperatorOrAdmin,
    service: str = Query(...),
    operation: str = Query(default="all"),
    window_seconds: int = Query(default=3600, ge=60, le=86400, alias="windowSeconds"),
    buckets: int = Query(default=12, ge=1, le=240),
) -> LatencySeriesOut:
    return _synthesize_latency(
        service=service,
        operation=operation,
        window_seconds=window_seconds,
        buckets=buckets,
    )


# ─────────────────────────────────────────────────────────────────────
# Logs (audit_log tail until Phase 12 wires CloudWatch)
# ─────────────────────────────────────────────────────────────────────


class LogLineOut(BaseModel):
    timestamp: datetime
    level: Literal["debug", "info", "warning", "error"]
    source: str
    message: str
    correlationId: str | None
    actorEmail: str | None

    model_config = {"populate_by_name": True}


class LogTailOut(BaseModel):
    lines: list[LogLineOut]
    total: int


@router.get("/logs", response_model=LogTailOut)
async def tail_logs(
    user: OperatorOrAdmin,
    db: DbSession,
    limit: int = Query(default=100, le=500, ge=1),
    level: str | None = Query(default=None),
) -> LogTailOut:
    """Tail of the audit_log surfaced as structured log lines.

    The real CloudWatch Logs integration lands in Phase 12 — this surface
    keeps the dashboard interactive in local + CI today.
    """

    if level and level not in {"debug", "info", "warning", "error"}:
        raise ApiError(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            code="ops.logs.invalid_level",
            message=f"unknown level '{level}'",
        )
    stmt = select(AuditEvent).order_by(AuditEvent.occurred_at.desc()).limit(limit)
    rows = (await db.scalars(stmt)).all()
    lines: list[LogLineOut] = []
    for r in rows:
        line_level: Literal["debug", "info", "warning", "error"] = (
            "error" if r.outcome == "failure" else "info"
        )
        if level and line_level != level:
            continue
        lines.append(
            LogLineOut(
                timestamp=r.occurred_at,
                level=line_level,
                source=f"audit.{r.resource_type}",
                message=f"{r.action} {r.outcome}",
                correlationId=r.correlation_id,
                actorEmail=r.actor_email,
            )
        )
    return LogTailOut(lines=lines, total=len(lines))
