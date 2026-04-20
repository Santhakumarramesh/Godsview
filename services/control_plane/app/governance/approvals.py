"""Governance approval lifecycle.

Every approval is an append-only envelope: the row is created in
``pending``, decisions accumulate as rows in ``approval_decisions``, and
the envelope transitions to a terminal state once a quorum is reached or
it is withdrawn/expired.

Transition matrix:

  pending ──► approved  (approver_count ``approve`` decisions collected)
  pending ──► rejected  (any ``reject`` decision from a valid approver)
  pending ──► withdrawn (requester triggers; terminal)
  pending ──► expired   (wall-clock > expires_at; read-time lazy sweep)

Terminal rows are never mutated — re-requesting an action produces a
fresh row.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.dto import (
    ApprovalDecisionRecordDto,
    CreateApprovalRequestDto,
    DecideApprovalRequestDto,
    GovernanceApprovalDto,
    GovernanceApprovalsListDto,
)
from app.governance.policy import resolve_policy
from app.governance.tiers import at_least, is_valid_tier
from app.models import (
    ApprovalDecisionRow,
    GovernanceApprovalRow,
    User,
)

UTC = timezone.utc


# ──────────────────────────── errors ───────────────────────────────────


class ApprovalError(Exception):
    """Marker base class for domain-level rejections."""

    code: str = "approval_error"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────── helpers ──────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


async def _decisions_for(
    session: AsyncSession, approval_id: str
) -> List[ApprovalDecisionRow]:
    stmt = (
        select(ApprovalDecisionRow)
        .where(ApprovalDecisionRow.approval_id == approval_id)
        .order_by(ApprovalDecisionRow.decided_at)
    )
    return list((await session.execute(stmt)).scalars().all())


def _is_terminal(state: str) -> bool:
    return state in {"approved", "rejected", "expired", "withdrawn"}


def _maybe_expire(row: GovernanceApprovalRow) -> bool:
    """Flip a pending row to ``expired`` if past its TTL.

    Returns True if the row was transitioned. Caller is responsible for
    flushing the session.
    """
    if row.state != "pending":
        return False
    if row.expires_at is None:
        return False
    if _now() < row.expires_at:
        return False
    row.state = "expired"
    row.resolved_at = _now()
    return True


def _row_to_dto(
    row: GovernanceApprovalRow, decisions: Sequence[ApprovalDecisionRow]
) -> GovernanceApprovalDto:
    return GovernanceApprovalDto(
        id=row.id,
        action=row.action,  # type: ignore[arg-type]
        subjectKey=row.subject_key,
        payload=row.payload or {},
        requestedByUserId=row.requested_by_user_id,
        requestedAt=row.requested_at,
        reason=row.reason,
        state=row.state,  # type: ignore[arg-type]
        expiresAt=row.expires_at,
        resolvedAt=row.resolved_at,
        resolvedByUserId=row.resolved_by_user_id,
        requiredApproverCount=row.required_approver_count,
        decisions=[
            ApprovalDecisionRecordDto(
                approverUserId=d.approver_user_id,
                decision=d.decision,  # type: ignore[arg-type]
                decidedAt=d.decided_at,
                comment=d.comment,
            )
            for d in decisions
        ],
    )


# ──────────────────────────── list / get ───────────────────────────────


async def list_approvals(
    session: AsyncSession,
    *,
    state: Optional[str] = None,
    action: Optional[str] = None,
    requested_by_user_id: Optional[str] = None,
    subject_key: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> GovernanceApprovalsListDto:
    limit = max(1, min(500, limit))
    offset = max(0, offset)

    conds = []
    if state is not None:
        conds.append(GovernanceApprovalRow.state == state)
    if action is not None:
        conds.append(GovernanceApprovalRow.action == action)
    if requested_by_user_id is not None:
        conds.append(
            GovernanceApprovalRow.requested_by_user_id == requested_by_user_id
        )
    if subject_key is not None:
        conds.append(GovernanceApprovalRow.subject_key == subject_key)

    stmt = select(GovernanceApprovalRow)
    if conds:
        stmt = stmt.where(and_(*conds))
    stmt = (
        stmt.order_by(GovernanceApprovalRow.requested_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = list((await session.execute(stmt)).scalars().all())

    # Lazy-expire any rows past their TTL before returning.
    expired_any = False
    for row in rows:
        if _maybe_expire(row):
            expired_any = True
    if expired_any:
        await session.flush()

    count_stmt = select(func.count(GovernanceApprovalRow.id))
    if conds:
        count_stmt = count_stmt.where(and_(*conds))
    total = int((await session.execute(count_stmt)).scalar_one())

    dtos: List[GovernanceApprovalDto] = []
    for row in rows:
        decisions = await _decisions_for(session, row.id)
        dtos.append(_row_to_dto(row, decisions))

    return GovernanceApprovalsListDto(approvals=dtos, total=total)


async def get_approval(
    session: AsyncSession, approval_id: str
) -> Optional[GovernanceApprovalDto]:
    row = await session.get(GovernanceApprovalRow, approval_id)
    if row is None:
        return None
    if _maybe_expire(row):
        await session.flush()
    decisions = await _decisions_for(session, row.id)
    return _row_to_dto(row, decisions)


# ──────────────────────────── create ───────────────────────────────────


async def create_approval(
    session: AsyncSession,
    *,
    req: CreateApprovalRequestDto,
    actor_user: User,
) -> GovernanceApprovalDto:
    """Create a new approval request.

    Fails with ``ApprovalError`` if:
      * actor tier < policy.min_requester_tier
      * policy.requires_approval is False (action doesn't need approval)
    """
    policy = await resolve_policy(session, req.action)
    if not policy["requires_approval"]:
        raise ApprovalError(
            "action_not_gated",
            f"action {req.action!r} does not require approval under the current policy",
        )
    if not at_least(actor_user.trust_tier, policy["min_requester_tier"]):  # type: ignore[arg-type]
        raise ApprovalError(
            "tier_too_low",
            f"requester tier {actor_user.trust_tier!r} below minimum "
            f"{policy['min_requester_tier']!r}",
        )

    ttl_seconds = int(policy["ttl_seconds"])
    now = _now()
    expires_at = now + timedelta(seconds=ttl_seconds) if ttl_seconds > 0 else None

    row = GovernanceApprovalRow(
        action=req.action,
        subject_key=req.subject_key,
        payload=dict(req.payload or {}),
        reason=req.reason,
        state="pending",
        requested_by_user_id=actor_user.id,
        requested_at=now,
        expires_at=expires_at,
        required_approver_count=int(policy["approver_count"]),
    )
    session.add(row)
    await session.flush()
    return _row_to_dto(row, [])


# ──────────────────────────── decide ───────────────────────────────────


async def decide_approval(
    session: AsyncSession,
    *,
    approval_id: str,
    req: DecideApprovalRequestDto,
    actor_user: User,
) -> GovernanceApprovalDto:
    """Record a decision from ``actor_user`` on an approval.

    Raises ``ApprovalError`` for:
      * approval not found
      * approval already in terminal state (including expired)
      * actor_user == requester (self-approval forbidden)
      * actor tier < policy.min_approver_tier
      * duplicate decision from same approver
    """
    row = await session.get(GovernanceApprovalRow, approval_id)
    if row is None:
        raise ApprovalError(
            "approval_not_found",
            f"no approval with id {approval_id!r}",
        )

    _maybe_expire(row)
    if _is_terminal(row.state):
        raise ApprovalError(
            "approval_terminal",
            f"approval is {row.state!r}; decisions are no longer accepted",
        )

    if row.requested_by_user_id == actor_user.id:
        raise ApprovalError(
            "self_approval_forbidden",
            "requester cannot sign their own approval",
        )

    policy = await resolve_policy(session, row.action)
    if not at_least(actor_user.trust_tier, policy["min_approver_tier"]):  # type: ignore[arg-type]
        raise ApprovalError(
            "tier_too_low",
            f"approver tier {actor_user.trust_tier!r} below minimum "
            f"{policy['min_approver_tier']!r}",
        )

    if req.decision not in {"approve", "reject", "abstain"}:
        raise ApprovalError(
            "invalid_decision",
            f"unknown decision {req.decision!r}",
        )

    # Duplicate check.
    existing_stmt = select(ApprovalDecisionRow).where(
        and_(
            ApprovalDecisionRow.approval_id == row.id,
            ApprovalDecisionRow.approver_user_id == actor_user.id,
        )
    )
    if (await session.execute(existing_stmt)).scalar_one_or_none() is not None:
        raise ApprovalError(
            "duplicate_decision",
            "approver has already signed this approval",
        )

    decision_row = ApprovalDecisionRow(
        approval_id=row.id,
        approver_user_id=actor_user.id,
        decision=req.decision,
        comment=(req.comment or None),
    )
    session.add(decision_row)

    # Immediate-reject semantics: any reject from a valid approver flips
    # the envelope to ``rejected``.
    if req.decision == "reject":
        row.state = "rejected"
        row.resolved_at = _now()
        row.resolved_by_user_id = actor_user.id

    # Approve-quorum: count approve decisions, including this new one
    # (session.flush() below makes it visible to the count query).
    await session.flush()

    if row.state == "pending" and req.decision == "approve":
        approves_stmt = select(func.count(ApprovalDecisionRow.id)).where(
            and_(
                ApprovalDecisionRow.approval_id == row.id,
                ApprovalDecisionRow.decision == "approve",
            )
        )
        approves = int((await session.execute(approves_stmt)).scalar_one())
        if approves >= row.required_approver_count:
            row.state = "approved"
            row.resolved_at = _now()
            row.resolved_by_user_id = actor_user.id
            await session.flush()

    decisions = await _decisions_for(session, row.id)
    return _row_to_dto(row, decisions)


# ──────────────────────────── withdraw ─────────────────────────────────


async def withdraw_approval(
    session: AsyncSession,
    *,
    approval_id: str,
    reason: str,
    actor_user: User,
) -> GovernanceApprovalDto:
    """Mark an approval as ``withdrawn``.

    Only the requester (or an admin+) can withdraw. Terminal approvals
    cannot be withdrawn.
    """
    row = await session.get(GovernanceApprovalRow, approval_id)
    if row is None:
        raise ApprovalError(
            "approval_not_found",
            f"no approval with id {approval_id!r}",
        )

    _maybe_expire(row)
    if _is_terminal(row.state):
        raise ApprovalError(
            "approval_terminal",
            f"approval is {row.state!r}; cannot withdraw",
        )

    is_admin = "admin" in (actor_user.roles or []) or at_least(
        actor_user.trust_tier, "admin"
    )
    if row.requested_by_user_id != actor_user.id and not is_admin:
        raise ApprovalError(
            "forbidden",
            "only the requester (or an admin) can withdraw this approval",
        )

    row.state = "withdrawn"
    row.resolved_at = _now()
    row.resolved_by_user_id = actor_user.id
    # Stash the withdrawal reason inside the payload so audit downstream
    # can reference it without a separate field.
    payload = dict(row.payload or {})
    payload["withdrawn_reason"] = reason
    row.payload = payload
    await session.flush()

    decisions = await _decisions_for(session, row.id)
    return _row_to_dto(row, decisions)


__all__ = [
    "ApprovalError",
    "list_approvals",
    "get_approval",
    "create_approval",
    "decide_approval",
    "withdraw_approval",
]
