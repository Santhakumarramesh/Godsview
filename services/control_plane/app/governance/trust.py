"""Trust-tier registry read + assign.

Reads join the User row with its ``trust_tier_assignments`` history so
the UI can display both the current tier and the provenance.

Writes land one row in ``trust_tier_assignments`` and flip
``users.trust_tier`` to match. Both writes happen inside the same
session so they commit atomically.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.governance.dto import (
    AssignTrustTierRequestDto,
    TrustRegistryEntryDto,
    TrustRegistryListDto,
    TrustTierAssignmentDto,
)
from app.governance.tiers import at_least, is_valid_tier
from app.models import TrustTierAssignmentRow, User

UTC = timezone.utc


# ──────────────────────────── errors ───────────────────────────────────


class TrustError(Exception):
    code: str = "trust_error"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────── helpers ──────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


async def _history_for(
    session: AsyncSession, user_id: str
) -> List[TrustTierAssignmentRow]:
    stmt = (
        select(TrustTierAssignmentRow)
        .where(TrustTierAssignmentRow.user_id == user_id)
        .order_by(TrustTierAssignmentRow.assigned_at.desc())
    )
    return list((await session.execute(stmt)).scalars().all())


def _history_to_dtos(
    rows: List[TrustTierAssignmentRow],
) -> List[TrustTierAssignmentDto]:
    return [
        TrustTierAssignmentDto(
            userId=r.user_id,
            tier=r.tier,  # type: ignore[arg-type]
            assignedAt=r.assigned_at,
            assignedByUserId=r.assigned_by_user_id,
            reason=r.reason,
        )
        for r in rows
    ]


async def _entry_for_user(
    session: AsyncSession, user: User
) -> TrustRegistryEntryDto:
    history = await _history_for(session, user.id)
    latest = history[0].assigned_at if history else user.created_at
    return TrustRegistryEntryDto(
        userId=user.id,
        email=user.email,
        currentTier=user.trust_tier,  # type: ignore[arg-type]
        history=_history_to_dtos(history),
        updatedAt=latest,
    )


# ──────────────────────────── list / get ───────────────────────────────


async def list_registry(session: AsyncSession) -> TrustRegistryListDto:
    stmt = (
        select(User)
        .where(User.disabled.is_(False))
        .order_by(User.email)
    )
    users = list((await session.execute(stmt)).scalars().all())
    entries = [await _entry_for_user(session, u) for u in users]
    return TrustRegistryListDto(entries=entries)


async def get_registry_entry(
    session: AsyncSession, user_id: str
) -> Optional[TrustRegistryEntryDto]:
    user = await session.get(User, user_id)
    if user is None:
        return None
    return await _entry_for_user(session, user)


# ──────────────────────────── assign ───────────────────────────────────


async def assign_tier(
    session: AsyncSession,
    *,
    req: AssignTrustTierRequestDto,
    actor_user: User,
) -> TrustRegistryEntryDto:
    """Assign ``req.tier`` to ``req.user_id``.

    Invariants:
      * tier must be a known literal.
      * actor must be ``admin`` tier or above AND must be at least as
        strong as the tier being assigned (you cannot mint a tier above
        your own).
      * a user cannot downgrade themselves below ``admin`` via this
        route (prevents soft-bricking the last admin).
    """
    if not is_valid_tier(req.tier):
        raise TrustError("invalid_tier", f"unknown tier: {req.tier!r}")

    target = await session.get(User, req.user_id)
    if target is None:
        raise TrustError(
            "user_not_found",
            f"no user with id {req.user_id!r}",
        )

    if not at_least(actor_user.trust_tier, "admin"):
        raise TrustError(
            "forbidden",
            "assign-tier requires admin or owner trust",
        )

    if not at_least(actor_user.trust_tier, req.tier):
        raise TrustError(
            "tier_too_low",
            f"actor tier {actor_user.trust_tier!r} cannot grant higher tier {req.tier!r}",
        )

    if target.id == actor_user.id and not at_least(req.tier, "admin"):
        raise TrustError(
            "self_downgrade_forbidden",
            "cannot downgrade yourself below admin via this route",
        )

    if target.trust_tier == req.tier:
        # No-op: still return the entry for idempotency.
        return await _entry_for_user(session, target)

    now = _now()
    row = TrustTierAssignmentRow(
        user_id=target.id,
        tier=req.tier,
        assigned_at=now,
        assigned_by_user_id=actor_user.id,
        reason=req.reason,
    )
    session.add(row)
    target.trust_tier = req.tier
    await session.flush()

    return await _entry_for_user(session, target)


__all__ = [
    "TrustError",
    "list_registry",
    "get_registry_entry",
    "assign_tier",
]
