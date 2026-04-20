"""Kill-switch trip/reset + derived state.

Domain rules:

  * Every trip or reset lands exactly one row in ``kill_switch_events``.
  * The *active* state of a (scope, subject_key) pair is the ``action``
    of the latest row — ``trip`` → active; ``reset`` (or no rows) → idle.
  * Global scope uses ``subject_key=NULL``.
  * ``is_blocked`` checks scopes in precedence: global ▸ account ▸
    strategy. An active row at any broader scope blocks narrower ones
    automatically.
  * Resetting ``global`` requires a governance approval of action
    ``kill_switch_global_reset``; narrower scopes can be reset by any
    admin-tier operator with a reason.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.autonomy.dto import (
    KillSwitchEventDto,
    KillSwitchEventsListDto,
    KillSwitchResetRequestDto,
    KillSwitchScope,
    KillSwitchStateDto,
    KillSwitchStatesListDto,
    KillSwitchTripRequestDto,
    KillSwitchTrigger,
)
from app.models import GovernanceApprovalRow, KillSwitchEventRow, User

UTC = timezone.utc


# ──────────────────────────── errors ───────────────────────────────────


class KillSwitchError(Exception):
    code: str = "kill_switch_error"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────── helpers ──────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


def _row_to_dto(row: KillSwitchEventRow) -> KillSwitchEventDto:
    return KillSwitchEventDto(
        id=row.id,
        scope=row.scope,  # type: ignore[arg-type]
        subjectKey=row.subject_key,
        action=row.action,  # type: ignore[arg-type]
        trigger=row.trigger,  # type: ignore[arg-type]
        actorUserId=row.actor_user_id,
        reason=row.reason,
        approvalId=row.approval_id,
        evidence=dict(row.evidence or {}),
        occurredAt=row.occurred_at,
    )


async def _latest_event_for(
    session: AsyncSession,
    *,
    scope: KillSwitchScope,
    subject_key: Optional[str],
) -> Optional[KillSwitchEventRow]:
    conds = [KillSwitchEventRow.scope == scope]
    if subject_key is None:
        conds.append(KillSwitchEventRow.subject_key.is_(None))
    else:
        conds.append(KillSwitchEventRow.subject_key == subject_key)
    stmt = (
        select(KillSwitchEventRow)
        .where(and_(*conds))
        .order_by(desc(KillSwitchEventRow.occurred_at))
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


def _state_from_row(
    scope: KillSwitchScope,
    subject_key: Optional[str],
    row: Optional[KillSwitchEventRow],
    default_ts: datetime,
) -> KillSwitchStateDto:
    if row is None or row.action == "reset":
        return KillSwitchStateDto(
            scope=scope,
            subjectKey=subject_key,
            active=False,
            trippedAt=None,
            trippedByUserId=None,
            trigger=None,
            reason=None,
            lastEventId=row.id if row else None,
            updatedAt=row.occurred_at if row else default_ts,
        )
    return KillSwitchStateDto(
        scope=scope,
        subjectKey=subject_key,
        active=True,
        trippedAt=row.occurred_at,
        trippedByUserId=row.actor_user_id,
        trigger=row.trigger,  # type: ignore[arg-type]
        reason=row.reason,
        lastEventId=row.id,
        updatedAt=row.occurred_at,
    )


# ──────────────────────────── list / get ───────────────────────────────


async def list_states(session: AsyncSession) -> KillSwitchStatesListDto:
    """Return the derived state for every distinct (scope, subject_key).

    Global scope is always included, even if no events have fired yet.
    """
    subq = (
        select(
            KillSwitchEventRow.scope,
            KillSwitchEventRow.subject_key,
            func.max(KillSwitchEventRow.occurred_at).label("latest_ts"),
        )
        .group_by(KillSwitchEventRow.scope, KillSwitchEventRow.subject_key)
        .subquery()
    )
    stmt = select(KillSwitchEventRow).join(
        subq,
        and_(
            KillSwitchEventRow.scope == subq.c.scope,
            (
                (KillSwitchEventRow.subject_key == subq.c.subject_key)
                | (
                    KillSwitchEventRow.subject_key.is_(None)
                    & subq.c.subject_key.is_(None)
                )
            ),
            KillSwitchEventRow.occurred_at == subq.c.latest_ts,
        ),
    )
    rows: List[KillSwitchEventRow] = list(
        (await session.execute(stmt)).scalars().all()
    )

    now = _now()
    by_key: Dict[Tuple[str, Optional[str]], KillSwitchEventRow] = {}
    for r in rows:
        by_key[(r.scope, r.subject_key)] = r

    states: List[KillSwitchStateDto] = []
    # Ensure global row is always present.
    global_row = by_key.get(("global", None))
    states.append(_state_from_row("global", None, global_row, now))
    for (scope, subject_key), row in by_key.items():
        if scope == "global" and subject_key is None:
            continue
        states.append(
            _state_from_row(scope, subject_key, row, now)  # type: ignore[arg-type]
        )
    return KillSwitchStatesListDto(states=states)


async def get_state(
    session: AsyncSession,
    *,
    scope: KillSwitchScope,
    subject_key: Optional[str],
) -> KillSwitchStateDto:
    row = await _latest_event_for(
        session, scope=scope, subject_key=subject_key
    )
    return _state_from_row(scope, subject_key, row, _now())


async def list_events(
    session: AsyncSession,
    *,
    scope: Optional[KillSwitchScope] = None,
    subject_key: Optional[str] = None,
    trigger: Optional[KillSwitchTrigger] = None,
    limit: int = 100,
    offset: int = 0,
) -> KillSwitchEventsListDto:
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    conds = []
    if scope is not None:
        conds.append(KillSwitchEventRow.scope == scope)
    if subject_key is not None:
        conds.append(KillSwitchEventRow.subject_key == subject_key)
    if trigger is not None:
        conds.append(KillSwitchEventRow.trigger == trigger)

    stmt = select(KillSwitchEventRow)
    if conds:
        stmt = stmt.where(and_(*conds))
    stmt = (
        stmt.order_by(desc(KillSwitchEventRow.occurred_at))
        .limit(limit)
        .offset(offset)
    )
    rows = list((await session.execute(stmt)).scalars().all())

    count_stmt = select(func.count(KillSwitchEventRow.id))
    if conds:
        count_stmt = count_stmt.where(and_(*conds))
    total = int((await session.execute(count_stmt)).scalar_one())

    return KillSwitchEventsListDto(
        events=[_row_to_dto(r) for r in rows], total=total
    )


# ──────────────────────────── trip ─────────────────────────────────────


async def trip(
    session: AsyncSession,
    *,
    req: KillSwitchTripRequestDto,
    actor_user: User,
    trigger: Optional[KillSwitchTrigger] = None,
    evidence: Optional[Dict[str, object]] = None,
) -> KillSwitchEventDto:
    scope = req.scope
    subject_key = None if scope == "global" else req.subject_key
    if scope != "global" and not subject_key:
        raise KillSwitchError(
            "subject_key_required",
            f"scope {scope!r} requires a subject_key",
        )

    latest = await _latest_event_for(
        session, scope=scope, subject_key=subject_key
    )
    if latest is not None and latest.action == "trip":
        # Already tripped — idempotent: return the existing event.
        return _row_to_dto(latest)

    eff_trigger: KillSwitchTrigger = trigger or req.trigger or "operator"
    row = KillSwitchEventRow(
        scope=scope,
        subject_key=subject_key,
        action="trip",
        trigger=eff_trigger,
        actor_user_id=actor_user.id,
        reason=req.reason,
        approval_id=None,
        evidence=dict(evidence or {}),
        occurred_at=_now(),
    )
    session.add(row)
    await session.flush()
    return _row_to_dto(row)


# ──────────────────────────── reset ────────────────────────────────────


async def _validate_reset_approval(
    session: AsyncSession,
    *,
    scope: KillSwitchScope,
    approval_id: Optional[str],
) -> Optional[GovernanceApprovalRow]:
    if scope != "global":
        return None
    if approval_id is None:
        raise KillSwitchError(
            "approval_required",
            "global kill-switch reset requires an approval_id",
        )
    appr = await session.get(GovernanceApprovalRow, approval_id)
    if appr is None:
        raise KillSwitchError(
            "approval_not_found",
            f"no governance approval with id {approval_id!r}",
        )
    if appr.state != "approved":
        raise KillSwitchError(
            "approval_not_approved",
            f"approval {approval_id!r} state is {appr.state!r}",
        )
    if appr.action != "kill_switch_global_reset":
        raise KillSwitchError(
            "approval_wrong_action",
            f"approval {approval_id!r} is for {appr.action!r}",
        )
    return appr


async def reset(
    session: AsyncSession,
    *,
    req: KillSwitchResetRequestDto,
    actor_user: User,
) -> KillSwitchEventDto:
    scope = req.scope
    subject_key = None if scope == "global" else req.subject_key
    if scope != "global" and not subject_key:
        raise KillSwitchError(
            "subject_key_required",
            f"scope {scope!r} requires a subject_key",
        )

    latest = await _latest_event_for(
        session, scope=scope, subject_key=subject_key
    )
    if latest is None or latest.action == "reset":
        # Already reset — idempotent. Return the last event (or a
        # synthetic idle marker if none).
        if latest is not None:
            return _row_to_dto(latest)
        raise KillSwitchError(
            "not_tripped",
            f"scope {scope!r} with subject {subject_key!r} is not tripped",
        )

    await _validate_reset_approval(
        session, scope=scope, approval_id=req.approval_id
    )

    row = KillSwitchEventRow(
        scope=scope,
        subject_key=subject_key,
        action="reset",
        trigger="operator",
        actor_user_id=actor_user.id,
        reason=req.reason,
        approval_id=req.approval_id,
        evidence={},
        occurred_at=_now(),
    )
    session.add(row)
    await session.flush()
    return _row_to_dto(row)


# ──────────────────────────── live-gate query ──────────────────────────


async def is_blocked(
    session: AsyncSession,
    *,
    account_id: Optional[str] = None,
    strategy_id: Optional[str] = None,
) -> Tuple[bool, Optional[KillSwitchStateDto]]:
    """Return ``(blocked, reason_state)`` for an outbound intent.

    Precedence: global ▸ account ▸ strategy. The first active scope
    wins; the corresponding :class:`KillSwitchStateDto` is returned so
    the caller can surface the reason to the operator.
    """
    # global
    st = await get_state(session, scope="global", subject_key=None)
    if st.active:
        return True, st
    # account
    if account_id is not None:
        st = await get_state(session, scope="account", subject_key=account_id)
        if st.active:
            return True, st
    # strategy
    if strategy_id is not None:
        st = await get_state(session, scope="strategy", subject_key=strategy_id)
        if st.active:
            return True, st
    return False, None


__all__ = [
    "KillSwitchError",
    "get_state",
    "is_blocked",
    "list_events",
    "list_states",
    "reset",
    "trip",
]
