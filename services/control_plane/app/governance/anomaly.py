"""Anomaly alert lifecycle.

Detectors emit anomaly rows in ``open`` state. An operator can:

  * ``acknowledge``  — flip ``open`` → ``acknowledged``; optional
                       ``suppress_for_seconds`` mutes re-fires until
                       that wall-clock instant.
  * ``resolve``      — flip any non-resolved row → ``resolved``.

Re-fire suppression is checked by detectors via
:func:`is_suppressed` — this module does not auto-run detection.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.dto import (
    AcknowledgeAnomalyRequestDto,
    AnomalyAlertDto,
    AnomalyAlertsListDto,
    ResolveAnomalyRequestDto,
)
from app.models import AnomalyAlertRow, User

UTC = timezone.utc


# ──────────────────────────── errors ───────────────────────────────────


class AnomalyError(Exception):
    """Domain-level anomaly mutation failure."""

    code: str = "anomaly_error"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────── helpers ──────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


def _row_to_dto(row: AnomalyAlertRow) -> AnomalyAlertDto:
    return AnomalyAlertDto(
        id=row.id,
        detectedAt=row.detected_at,
        source=row.source,  # type: ignore[arg-type]
        severity=row.severity,  # type: ignore[arg-type]
        status=row.status,  # type: ignore[arg-type]
        subjectKey=row.subject_key,
        message=row.message,
        evidence=dict(row.evidence or {}),
        acknowledgedAt=row.acknowledged_at,
        acknowledgedByUserId=row.acknowledged_by_user_id,
        resolvedAt=row.resolved_at,
        resolvedByUserId=row.resolved_by_user_id,
        suppressedUntil=row.suppressed_until,
        relatedApprovalId=row.related_approval_id,
    )


# ──────────────────────────── list / get ───────────────────────────────


async def list_anomalies(
    session: AsyncSession,
    *,
    status: Optional[str] = None,
    severity: Optional[str] = None,
    source: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> AnomalyAlertsListDto:
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    conds = []
    if status is not None:
        conds.append(AnomalyAlertRow.status == status)
    if severity is not None:
        conds.append(AnomalyAlertRow.severity == severity)
    if source is not None:
        conds.append(AnomalyAlertRow.source == source)

    stmt = select(AnomalyAlertRow)
    if conds:
        stmt = stmt.where(and_(*conds))
    stmt = (
        stmt.order_by(AnomalyAlertRow.detected_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list((await session.execute(stmt)).scalars().all())

    count_stmt = select(func.count(AnomalyAlertRow.id))
    if conds:
        count_stmt = count_stmt.where(and_(*conds))
    total = int((await session.execute(count_stmt)).scalar_one())

    return AnomalyAlertsListDto(
        alerts=[_row_to_dto(r) for r in rows], total=total
    )


async def get_anomaly(
    session: AsyncSession, anomaly_id: str
) -> Optional[AnomalyAlertDto]:
    row = await session.get(AnomalyAlertRow, anomaly_id)
    if row is None:
        return None
    return _row_to_dto(row)


# ──────────────────────────── acknowledge ──────────────────────────────


async def acknowledge_anomaly(
    session: AsyncSession,
    *,
    anomaly_id: str,
    req: AcknowledgeAnomalyRequestDto,
    actor_user: User,
) -> AnomalyAlertDto:
    row = await session.get(AnomalyAlertRow, anomaly_id)
    if row is None:
        raise AnomalyError(
            "anomaly_not_found",
            f"no anomaly alert with id {anomaly_id!r}",
        )
    if row.status in {"resolved", "suppressed"}:
        raise AnomalyError(
            "anomaly_terminal",
            f"anomaly is {row.status!r}; cannot acknowledge",
        )

    now = _now()
    row.status = "acknowledged"
    row.acknowledged_at = now
    row.acknowledged_by_user_id = actor_user.id

    if req.suppress_for_seconds and req.suppress_for_seconds > 0:
        row.suppressed_until = now + timedelta(seconds=req.suppress_for_seconds)
        # Flag the alert as ``suppressed`` only if the suppression window
        # outlives typical ack-then-resolve cadence (> 5 minutes). Short
        # windows keep the row in ``acknowledged`` so the UI doesn't
        # silently drop it from open lists.
        if req.suppress_for_seconds > 300:
            row.status = "suppressed"

    if req.comment:
        evidence = dict(row.evidence or {})
        evidence.setdefault("comments", []).append(
            {"ackedAt": now.isoformat(), "author": actor_user.id, "comment": req.comment}
        )
        row.evidence = evidence

    await session.flush()
    return _row_to_dto(row)


# ──────────────────────────── resolve ──────────────────────────────────


async def resolve_anomaly(
    session: AsyncSession,
    *,
    anomaly_id: str,
    req: ResolveAnomalyRequestDto,
    actor_user: User,
) -> AnomalyAlertDto:
    row = await session.get(AnomalyAlertRow, anomaly_id)
    if row is None:
        raise AnomalyError(
            "anomaly_not_found",
            f"no anomaly alert with id {anomaly_id!r}",
        )
    if row.status == "resolved":
        raise AnomalyError(
            "anomaly_terminal",
            "anomaly already resolved",
        )

    now = _now()
    row.status = "resolved"
    row.resolved_at = now
    row.resolved_by_user_id = actor_user.id

    if req.comment:
        evidence = dict(row.evidence or {})
        evidence.setdefault("comments", []).append(
            {"resolvedAt": now.isoformat(), "author": actor_user.id, "comment": req.comment}
        )
        row.evidence = evidence

    await session.flush()
    return _row_to_dto(row)


# ──────────────────────────── detector-facing helpers ──────────────────


async def is_suppressed(
    session: AsyncSession, *, source: str, subject_key: Optional[str]
) -> bool:
    """Return True if a matching alert is still within its suppression window."""
    now = _now()
    stmt = select(AnomalyAlertRow.id).where(
        and_(
            AnomalyAlertRow.source == source,
            AnomalyAlertRow.subject_key == subject_key,
            AnomalyAlertRow.suppressed_until.is_not(None),
            AnomalyAlertRow.suppressed_until > now,
        )
    )
    return (await session.execute(stmt)).scalar_one_or_none() is not None


async def emit_anomaly(
    session: AsyncSession,
    *,
    source: str,
    severity: str,
    message: str,
    subject_key: Optional[str] = None,
    evidence: Optional[Dict[str, Any]] = None,
    related_approval_id: Optional[str] = None,
) -> AnomalyAlertDto:
    """Record a new anomaly. Skipped when a live suppression window exists."""
    if await is_suppressed(session, source=source, subject_key=subject_key):
        # Return a synthetic DTO reflecting the suppressed state; caller
        # can decide to ignore or log.
        now = _now()
        return AnomalyAlertDto(
            id="sup_" + source,
            detectedAt=now,
            source=source,  # type: ignore[arg-type]
            severity=severity,  # type: ignore[arg-type]
            status="suppressed",
            subjectKey=subject_key,
            message=message,
            evidence=evidence or {},
            acknowledgedAt=None,
            acknowledgedByUserId=None,
            resolvedAt=None,
            resolvedByUserId=None,
            suppressedUntil=None,
            relatedApprovalId=related_approval_id,
        )

    row = AnomalyAlertRow(
        source=source,
        severity=severity,
        status="open",
        subject_key=subject_key,
        message=message,
        evidence=dict(evidence or {}),
        related_approval_id=related_approval_id,
    )
    session.add(row)
    await session.flush()
    return _row_to_dto(row)


__all__ = [
    "AnomalyError",
    "list_anomalies",
    "get_anomaly",
    "acknowledge_anomaly",
    "resolve_anomaly",
    "is_suppressed",
    "emit_anomaly",
]
