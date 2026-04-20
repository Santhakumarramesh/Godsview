"""Mobile inbox aggregator.

The aggregator merges four first-class streams into a single
``MobileInboxItemDto`` feed:

  * :class:`GovernanceApprovalRow` — ``kind='approval'`` rows pending a
    decision (``state='pending'``).
  * :class:`AnomalyAlertRow`       — ``kind='anomaly'`` rows whose
    ``source`` maps to a mobile-visible category. Broker outage /
    venue latency anomalies project to dedicated ``kind`` values for
    clearer mobile rendering.
  * :class:`KillSwitchEventRow`    — active (most-recent-per-scope)
    trip events, ``kind='kill_switch'``.
  * :class:`RebalancePlanRow`      — plans in ``status='proposed'`` or
    ``'approved'``, ``kind='rebalance'``.

On top of the projected rows the aggregator overlays
:class:`MobileInboxAckEventRow`: whenever the most recent ack for a
given ``inbox_item_id`` postdates the underlying row's own
last-touched timestamp, the inbox flips that row from ``open`` to
``acknowledged``. Resolved/closed underlying rows surface as
``resolved``.

The shape of the projection is deliberate — the mobile client never
touches the governance tables directly. Every mutation still routes
through the desktop governance surface via the ``deepLink``.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Iterable, List, Optional, Sequence, Tuple

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.errors import ApiError
from app.mobile.cursor import (
    InboxCursor,
    before_pivot,
    decode_cursor,
    encode_cursor,
)
from app.mobile.dto import (
    MobileInboxFilterDto,
    MobileInboxItemDto,
    MobileInboxItemKind,
    MobileInboxListDto,
    MobileInboxSeverity,
    MobileInboxStatus,
    MobileInboxSummaryDto,
)
from app.models import (
    AnomalyAlertRow,
    GovernanceApprovalRow,
    KillSwitchEventRow,
    MobileInboxAckEventRow,
    RebalancePlanRow,
)

UTC = timezone.utc

# A hard cap on how many rows per source we pull before merging. With at
# most four sources this bounds the aggregator at 4 * _SOURCE_CAP rows
# per page assembly. Operators with more than this backlog hit the
# ``throttled=True`` path on the summary card.
_SOURCE_CAP = 500


# ──────────────────────────── projections ──────────────────────────────


@dataclass(frozen=True)
class _Projection:
    """In-memory projected inbox row, pre-ack overlay."""

    id: str
    kind: MobileInboxItemKind
    severity: MobileInboxSeverity
    title: str
    summary: str
    subject_key: str
    subject_secondary_key: Optional[str]
    deep_link: str
    badges: Tuple[str, ...]
    created_at: datetime
    updated_at: datetime
    # Terminal resolution from the underlying row, if any.
    resolved_at: Optional[datetime]


# ──────────────────────────── sourcing ─────────────────────────────────


def _severity_from_anomaly(anomaly: AnomalyAlertRow) -> MobileInboxSeverity:
    if anomaly.severity in ("warn", "critical"):
        return anomaly.severity  # type: ignore[return-value]
    return "info"


def _anomaly_kind(anomaly: AnomalyAlertRow) -> MobileInboxItemKind:
    if anomaly.source == "broker_outage":
        return "broker_outage"
    if anomaly.source == "venue_latency_breach":
        return "venue_outage"
    return "anomaly"


async def _project_anomalies(
    session: AsyncSession,
) -> List[_Projection]:
    stmt = (
        select(AnomalyAlertRow)
        .where(AnomalyAlertRow.status.in_(("open", "acknowledged")))
        .order_by(AnomalyAlertRow.detected_at.desc())
        .limit(_SOURCE_CAP)
    )
    rows: Sequence[AnomalyAlertRow] = (
        await session.execute(stmt)
    ).scalars().all()
    out: List[_Projection] = []
    for row in rows:
        touched = row.acknowledged_at or row.detected_at
        badges: List[str] = [row.source]
        if row.suppressed_until is not None:
            badges.append("suppressed")
        out.append(
            _Projection(
                id=f"anomaly:{row.id}",
                kind=_anomaly_kind(row),
                severity=_severity_from_anomaly(row),
                title=f"{row.source.replace('_', ' ').title()}",
                summary=row.message,
                subject_key=row.id,
                subject_secondary_key=row.subject_key,
                deep_link=f"/governance/anomalies/{row.id}",
                badges=tuple(badges),
                created_at=row.detected_at,
                updated_at=touched,
                resolved_at=row.resolved_at,
            )
        )
    return out


async def _project_approvals(
    session: AsyncSession,
) -> List[_Projection]:
    stmt = (
        select(GovernanceApprovalRow)
        .where(GovernanceApprovalRow.state == "pending")
        .order_by(GovernanceApprovalRow.requested_at.desc())
        .limit(_SOURCE_CAP)
    )
    rows: Sequence[GovernanceApprovalRow] = (
        await session.execute(stmt)
    ).scalars().all()
    out: List[_Projection] = []
    for row in rows:
        out.append(
            _Projection(
                id=f"approval:{row.id}",
                kind="approval",
                severity="warn",
                title=f"Approval needed: {row.action.replace('_', ' ')}",
                summary=row.reason or f"{row.action} requires sign-off.",
                subject_key=row.id,
                subject_secondary_key=row.subject_key,
                deep_link=f"/governance/approvals/{row.id}",
                badges=(row.action,),
                created_at=row.requested_at,
                updated_at=row.requested_at,
                resolved_at=row.resolved_at,
            )
        )
    return out


async def _project_kill_switches(
    session: AsyncSession,
) -> List[_Projection]:
    """Fold a stream of trip/reset events into the currently-active set."""
    stmt = (
        select(KillSwitchEventRow)
        .order_by(KillSwitchEventRow.occurred_at.desc())
        .limit(_SOURCE_CAP)
    )
    rows: Sequence[KillSwitchEventRow] = (
        await session.execute(stmt)
    ).scalars().all()

    # The latest event per (scope, subject_key) determines the active state.
    seen: dict[Tuple[str, Optional[str]], KillSwitchEventRow] = {}
    for row in rows:
        key = (row.scope, row.subject_key)
        if key not in seen:
            seen[key] = row

    out: List[_Projection] = []
    for (scope, subject_key), latest in seen.items():
        if latest.action != "trip":
            continue
        label = subject_key or "global"
        out.append(
            _Projection(
                id=f"kill_switch:{scope}:{subject_key or '-'}",
                kind="kill_switch",
                severity="critical",
                title=f"Kill switch tripped: {scope}",
                summary=(
                    f"{scope}:{label} tripped — {latest.reason or latest.trigger}"
                ),
                subject_key=latest.id,
                subject_secondary_key=subject_key,
                deep_link="/execution/killswitch",
                badges=(scope, latest.trigger),
                created_at=latest.occurred_at,
                updated_at=latest.occurred_at,
                resolved_at=None,
            )
        )
    return out


async def _project_rebalance_plans(
    session: AsyncSession,
) -> List[_Projection]:
    stmt = (
        select(RebalancePlanRow)
        .where(RebalancePlanRow.status.in_(("proposed", "approved")))
        .order_by(RebalancePlanRow.updated_at.desc())
        .limit(_SOURCE_CAP)
    )
    rows: Sequence[RebalancePlanRow] = (
        await session.execute(stmt)
    ).scalars().all()
    out: List[_Projection] = []
    for row in rows:
        severity: MobileInboxSeverity = (
            "warn" if row.status == "proposed" else "info"
        )
        out.append(
            _Projection(
                id=f"rebalance:{row.id}",
                kind="rebalance",
                severity=severity,
                title=f"Rebalance {row.status}",
                summary=(
                    f"{row.intent_count} intents · "
                    f"|Δ|={row.gross_delta_notional:,.0f}"
                ),
                subject_key=row.id,
                subject_secondary_key=row.account_id,
                deep_link=f"/portfolio/rebalance/{row.id}",
                badges=(row.status, row.trigger),
                created_at=row.proposed_at,
                updated_at=row.updated_at,
                resolved_at=row.completed_at,
            )
        )
    return out


# ──────────────────────────── ack overlay ──────────────────────────────


async def _latest_ack_by_item(
    session: AsyncSession,
) -> dict[str, MobileInboxAckEventRow]:
    """Return a map of ``inbox_item_id → most recent ack event row``.

    The unique constraint on ``(inbox_item_id, user_id, acknowledged_at)``
    allows multiple acks from different users; we pick the newest by
    ``acknowledged_at``. The mobile feed only needs the fact of an ack
    and its timestamp — the per-user history is exposed via the audit
    surface.
    """
    stmt = (
        select(MobileInboxAckEventRow)
        .order_by(MobileInboxAckEventRow.acknowledged_at.desc())
        .limit(_SOURCE_CAP * 2)
    )
    rows: Sequence[MobileInboxAckEventRow] = (
        await session.execute(stmt)
    ).scalars().all()
    out: dict[str, MobileInboxAckEventRow] = {}
    for row in rows:
        existing = out.get(row.inbox_item_id)
        if existing is None or row.acknowledged_at > existing.acknowledged_at:
            out[row.inbox_item_id] = row
    return out


def _apply_ack_overlay(
    projection: _Projection,
    acks: dict[str, MobileInboxAckEventRow],
) -> MobileInboxItemDto:
    ack = acks.get(projection.id)
    status: MobileInboxStatus
    acknowledged_at: Optional[datetime] = None
    updated_at = projection.updated_at

    if projection.resolved_at is not None:
        status = "resolved"
    elif ack is not None and ack.acknowledged_at >= projection.updated_at:
        status = "acknowledged"
        acknowledged_at = ack.acknowledged_at
        updated_at = max(updated_at, ack.acknowledged_at)
    else:
        status = "open"

    return MobileInboxItemDto.model_validate(
        {
            "id": projection.id,
            "kind": projection.kind,
            "severity": projection.severity,
            "status": status,
            "title": projection.title,
            "summary": projection.summary,
            "subjectKey": projection.subject_key,
            "subjectSecondaryKey": projection.subject_secondary_key,
            "deepLink": projection.deep_link,
            "badges": list(projection.badges),
            "createdAt": projection.created_at,
            "updatedAt": updated_at,
            "acknowledgedAt": acknowledged_at,
            "resolvedAt": projection.resolved_at,
        }
    )


# ──────────────────────────── public API ───────────────────────────────


async def _gather_projections(
    session: AsyncSession,
) -> List[_Projection]:
    anomalies = await _project_anomalies(session)
    approvals = await _project_approvals(session)
    kill_switches = await _project_kill_switches(session)
    rebalance = await _project_rebalance_plans(session)
    return anomalies + approvals + kill_switches + rebalance


def _filter_items(
    items: Iterable[MobileInboxItemDto],
    filt: MobileInboxFilterDto,
) -> List[MobileInboxItemDto]:
    out: List[MobileInboxItemDto] = []
    for it in items:
        if filt.kind is not None and it.kind != filt.kind:
            continue
        if filt.severity is not None and it.severity != filt.severity:
            continue
        if filt.status is not None and it.status != filt.status:
            continue
        out.append(it)
    return out


def _sorted_items(
    items: Iterable[MobileInboxItemDto],
) -> List[MobileInboxItemDto]:
    """Sort (updated_at DESC, id DESC). ``id`` ties stay deterministic."""
    return sorted(
        items, key=lambda it: (it.updated_at, it.id), reverse=True
    )


async def build_inbox_page(
    session: AsyncSession,
    filt: MobileInboxFilterDto,
) -> MobileInboxListDto:
    """Return a paginated, filtered page of the mobile inbox."""
    limit = filt.limit or 50

    pivot: Optional[InboxCursor] = None
    if filt.cursor is not None:
        pivot = decode_cursor(filt.cursor)

    projections = await _gather_projections(session)
    acks = await _latest_ack_by_item(session)
    items = [_apply_ack_overlay(p, acks) for p in projections]
    filtered = _filter_items(items, filt)
    sorted_items = _sorted_items(filtered)

    # Resume from pivot
    if pivot is not None:
        sorted_items = [
            it
            for it in sorted_items
            if before_pivot(it.updated_at, it.id, pivot)
        ]

    unread = sum(1 for it in sorted_items if it.status == "open")
    total = len(sorted_items)
    page = sorted_items[:limit]
    next_cursor: Optional[str] = None
    if len(sorted_items) > limit and page:
        tail = page[-1]
        next_cursor = encode_cursor(
            InboxCursor(updated_at=tail.updated_at, item_id=tail.id)
        )

    return MobileInboxListDto.model_validate(
        {
            "items": [it.model_dump(by_alias=True) for it in page],
            "nextCursor": next_cursor,
            "total": total,
            "unread": unread,
            "observedAt": datetime.now(UTC),
        }
    )


async def build_inbox_summary(
    session: AsyncSession,
) -> MobileInboxSummaryDto:
    """Return the header summary card (open + severity counts)."""
    projections = await _gather_projections(session)
    acks = await _latest_ack_by_item(session)
    items = [_apply_ack_overlay(p, acks) for p in projections]

    open_items = [it for it in items if it.status == "open"]
    severities = {"info": 0, "warn": 0, "critical": 0}
    for it in open_items:
        severities[it.severity] += 1

    # Throttled flag — if any source individually hit its cap, the feed
    # is truncated and the operator should drill in on desktop.
    total_rows = len(items)
    throttled = total_rows >= _SOURCE_CAP  # conservative

    observed_at = datetime.now(UTC)
    latest_updated_at = max(
        (it.updated_at for it in items),
        default=observed_at,
    )

    return MobileInboxSummaryDto.model_validate(
        {
            "open": len(open_items),
            "critical": severities["critical"],
            "warn": severities["warn"],
            "info": severities["info"],
            "observedAt": latest_updated_at,
            "throttled": throttled,
        }
    )


async def fetch_inbox_item(
    session: AsyncSession,
    item_id: str,
) -> MobileInboxItemDto:
    """Return a single projected row by id; 404 if unknown."""
    projections = await _gather_projections(session)
    acks = await _latest_ack_by_item(session)
    for projection in projections:
        if projection.id == item_id:
            return _apply_ack_overlay(projection, acks)
    raise ApiError(
        status_code=404,
        code="mobile_inbox_item_not_found",
        message=f"inbox item not found: {item_id}",
    )


async def acknowledge_inbox_item(
    session: AsyncSession,
    *,
    item_id: str,
    user_id: str,
    note: Optional[str],
) -> MobileInboxItemDto:
    """Append an ack-event row and return the updated projection.

    The underlying first-class row is **not** mutated. The feed picks up
    the new ack via the overlay on the next read.
    """
    projections = await _gather_projections(session)
    target: Optional[_Projection] = next(
        (p for p in projections if p.id == item_id), None
    )
    if target is None:
        raise ApiError(
            status_code=404,
            code="mobile_inbox_item_not_found",
            message=f"inbox item not found: {item_id}",
        )
    if target.resolved_at is not None:
        raise ApiError(
            status_code=409,
            code="mobile_inbox_item_resolved",
            message="cannot ack a resolved item",
        )

    # Insert the audit row. The unique constraint absorbs duplicate acks
    # inside the same wall-clock second; anything past that second is a
    # fresh audit row.
    event = MobileInboxAckEventRow(
        id=f"mba_{uuid.uuid4().hex}",
        inbox_item_id=item_id,
        kind=target.kind,
        subject_key=target.subject_secondary_key or target.subject_key,
        user_id=user_id,
        note=note,
        acknowledged_at=datetime.now(UTC),
    )
    session.add(event)
    await session.flush()

    # Re-read the ack map so the caller sees the ack reflected.
    acks = await _latest_ack_by_item(session)
    return _apply_ack_overlay(target, acks)


__all__ = [
    "acknowledge_inbox_item",
    "build_inbox_page",
    "build_inbox_summary",
    "fetch_inbox_item",
]
