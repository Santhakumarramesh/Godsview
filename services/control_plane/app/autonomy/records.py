"""Autonomy record + history CRUD and transition writer.

``autonomy_records`` holds one row per strategy, and is mutated only
through :func:`apply_transition` so the FSM + audit invariants are
preserved.

The history table ``autonomy_history_events`` is append-only; each
transition — including the initial seed — produces exactly one history
row and the record's ``last_transition_id`` is pinned to that row.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import List, Optional, Tuple

from sqlalchemy import and_, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.autonomy.dto import (
    AutonomyGateSnapshotDto,
    AutonomyHistoryEventDto,
    AutonomyHistoryListDto,
    AutonomyReason,
    AutonomyRecordDto,
    AutonomyRecordsListDto,
    AutonomyState,
    AutonomyTransitionAction,
)
from app.autonomy.fsm import (
    AutonomyFSMError,
    apply_action,
    requires_governance_approval,
)
from app.autonomy.gates import default_gate_snapshot
from app.models import (
    AutonomyHistoryEventRow,
    AutonomyRecordRow,
    GovernanceApprovalRow,
    Strategy,
    User,
)

UTC = timezone.utc

# Re-review the record this long after each transition. Operators and
# the periodic engine both fire off of this value.
DEFAULT_REVIEW_INTERVAL = timedelta(hours=12)


# ──────────────────────────── errors ───────────────────────────────────


class AutonomyRecordError(Exception):
    code: str = "autonomy_record_error"

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# ──────────────────────────── helpers ──────────────────────────────────


def _now() -> datetime:
    return datetime.now(UTC)


def _history_row_to_dto(row: AutonomyHistoryEventRow) -> AutonomyHistoryEventDto:
    snap: Optional[AutonomyGateSnapshotDto] = None
    if row.gate_snapshot:
        try:
            snap = AutonomyGateSnapshotDto.model_validate(row.gate_snapshot)
        except Exception:
            snap = None
    return AutonomyHistoryEventDto(
        id=row.id,
        strategyId=row.strategy_id,
        fromState=row.from_state,  # type: ignore[arg-type]
        toState=row.to_state,  # type: ignore[arg-type]
        reason=row.reason,  # type: ignore[arg-type]
        actorUserId=row.actor_user_id,
        approvalId=row.approval_id,
        note=row.note,
        gateSnapshot=snap,
        occurredAt=row.occurred_at,
    )


def _record_row_to_dto(
    row: AutonomyRecordRow,
) -> AutonomyRecordDto:
    raw_gates = row.gates or {}
    try:
        gates = AutonomyGateSnapshotDto.model_validate(raw_gates)
    except Exception:
        gates = default_gate_snapshot()
    return AutonomyRecordDto(
        strategyId=row.strategy_id,
        currentState=row.current_state,  # type: ignore[arg-type]
        enteredAt=row.entered_at,
        gates=gates,
        lockoutUntil=row.lockout_until,
        lastReason=row.last_reason,  # type: ignore[arg-type]
        lastTransitionId=row.last_transition_id,
        nextReviewAt=row.next_review_at,
        fillsInState=row.fills_in_state,
        rInState=row.r_in_state,
        updatedAt=row.updated_at,
    )


async def _get_record(
    session: AsyncSession, strategy_id: str
) -> Optional[AutonomyRecordRow]:
    stmt = select(AutonomyRecordRow).where(
        AutonomyRecordRow.strategy_id == strategy_id
    )
    return (await session.execute(stmt)).scalars().first()


async def _ensure_strategy_exists(
    session: AsyncSession, strategy_id: str
) -> None:
    stmt = select(Strategy.id).where(Strategy.id == strategy_id)
    if (await session.execute(stmt)).scalar_one_or_none() is None:
        raise AutonomyRecordError(
            "strategy_not_found", f"no strategy with id {strategy_id!r}"
        )


# ──────────────────────────── seed ─────────────────────────────────────


async def ensure_record(
    session: AsyncSession,
    *,
    strategy_id: str,
    gates: Optional[AutonomyGateSnapshotDto] = None,
) -> AutonomyRecordDto:
    """Idempotently create an ``assisted_live`` record for a strategy.

    Also writes the seed history row the first time. Returns the record
    DTO either way.
    """
    await _ensure_strategy_exists(session, strategy_id)

    existing = await _get_record(session, strategy_id)
    if existing is not None:
        return _record_row_to_dto(existing)

    snap = gates or default_gate_snapshot()
    now = _now()
    history = AutonomyHistoryEventRow(
        strategy_id=strategy_id,
        from_state=None,
        to_state="assisted_live",
        reason="initial_promotion",
        actor_user_id=None,
        approval_id=None,
        note="autonomy record seeded",
        gate_snapshot=snap.model_dump(mode="json", by_alias=True),
        occurred_at=now,
    )
    session.add(history)
    await session.flush()

    row = AutonomyRecordRow(
        strategy_id=strategy_id,
        current_state="assisted_live",
        entered_at=now,
        last_reason="initial_promotion",
        last_transition_id=history.id,
        next_review_at=now + DEFAULT_REVIEW_INTERVAL,
        lockout_until=None,
        fills_in_state=0,
        r_in_state=0.0,
        gates=snap.model_dump(mode="json", by_alias=True),
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    return _record_row_to_dto(row)


# ──────────────────────────── transitions ──────────────────────────────


async def _validate_governance(
    session: AsyncSession,
    *,
    from_state: AutonomyState,
    action: AutonomyTransitionAction,
    approval_id: Optional[str],
) -> Optional[GovernanceApprovalRow]:
    if not requires_governance_approval(from_state, action):
        return None
    if approval_id is None:
        raise AutonomyRecordError(
            "governance_required",
            "promote-to-autonomous requires an approval_id",
        )
    appr = await session.get(GovernanceApprovalRow, approval_id)
    if appr is None:
        raise AutonomyRecordError(
            "governance_not_found",
            f"no governance approval with id {approval_id!r}",
        )
    if appr.state != "approved":
        raise AutonomyRecordError(
            "governance_not_approved",
            f"approval {approval_id!r} state is {appr.state!r}; required 'approved'",
        )
    if appr.action != "strategy_autonomous_promote":
        raise AutonomyRecordError(
            "governance_wrong_action",
            f"approval {approval_id!r} is for {appr.action!r}; "
            "required 'strategy_autonomous_promote'",
        )
    return appr


async def apply_transition(
    session: AsyncSession,
    *,
    strategy_id: str,
    action: AutonomyTransitionAction,
    reason_note: str,
    actor_user: User,
    approval_id: Optional[str] = None,
    gates: Optional[AutonomyGateSnapshotDto] = None,
    reason_override: Optional[AutonomyReason] = None,
) -> Tuple[AutonomyRecordDto, AutonomyHistoryEventDto]:
    """Mutate the record via an FSM-valid transition.

    Returns ``(record_dto, history_dto)``. The history row is committed
    first (in the same session flush) so ``record.last_transition_id``
    can point at it.
    """
    await _ensure_strategy_exists(session, strategy_id)

    record = await _get_record(session, strategy_id)
    if record is None:
        # Seed-then-transition in one call so operator actions never
        # fail on a freshly-created strategy.
        seed = await ensure_record(session, strategy_id=strategy_id, gates=gates)
        record = await _get_record(session, strategy_id)
        assert record is not None

    from_state: AutonomyState = record.current_state  # type: ignore[assignment]

    try:
        to_state, default_reason = apply_action(from_state, action)
    except AutonomyFSMError as exc:
        raise AutonomyRecordError(exc.code, exc.message) from None

    await _validate_governance(
        session,
        from_state=from_state,
        action=action,
        approval_id=approval_id,
    )

    reason: AutonomyReason = reason_override or default_reason
    snap = gates
    snap_json = snap.model_dump(mode="json", by_alias=True) if snap is not None else None

    now = _now()
    history = AutonomyHistoryEventRow(
        strategy_id=strategy_id,
        from_state=from_state,
        to_state=to_state,
        reason=reason,
        actor_user_id=actor_user.id,
        approval_id=approval_id,
        note=reason_note,
        gate_snapshot=snap_json,
        occurred_at=now,
    )
    session.add(history)
    await session.flush()

    record.current_state = to_state
    record.entered_at = now
    record.last_reason = reason
    record.last_transition_id = history.id
    record.next_review_at = now + DEFAULT_REVIEW_INTERVAL
    # Reset per-state counters since we've entered a new state.
    record.fills_in_state = 0
    record.r_in_state = 0.0
    if snap is not None:
        record.gates = snap_json
    record.updated_at = now
    await session.flush()

    return _record_row_to_dto(record), _history_row_to_dto(history)


# ──────────────────────────── read ─────────────────────────────────────


async def list_records(
    session: AsyncSession,
    *,
    state: Optional[AutonomyState] = None,
    limit: int = 100,
    offset: int = 0,
) -> AutonomyRecordsListDto:
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    stmt = select(AutonomyRecordRow)
    if state is not None:
        stmt = stmt.where(AutonomyRecordRow.current_state == state)
    stmt = stmt.order_by(desc(AutonomyRecordRow.updated_at)).limit(limit).offset(offset)
    rows: List[AutonomyRecordRow] = list(
        (await session.execute(stmt)).scalars().all()
    )

    count_stmt = select(func.count(AutonomyRecordRow.id))
    if state is not None:
        count_stmt = count_stmt.where(AutonomyRecordRow.current_state == state)
    total = int((await session.execute(count_stmt)).scalar_one())

    return AutonomyRecordsListDto(
        records=[_record_row_to_dto(r) for r in rows], total=total
    )


async def get_record(
    session: AsyncSession, strategy_id: str
) -> Optional[AutonomyRecordDto]:
    row = await _get_record(session, strategy_id)
    if row is None:
        return None
    return _record_row_to_dto(row)


async def list_history(
    session: AsyncSession,
    *,
    strategy_id: Optional[str] = None,
    reason: Optional[AutonomyReason] = None,
    state: Optional[AutonomyState] = None,
    limit: int = 100,
    offset: int = 0,
) -> AutonomyHistoryListDto:
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    conds = []
    if strategy_id is not None:
        conds.append(AutonomyHistoryEventRow.strategy_id == strategy_id)
    if reason is not None:
        conds.append(AutonomyHistoryEventRow.reason == reason)
    if state is not None:
        conds.append(AutonomyHistoryEventRow.to_state == state)

    stmt = select(AutonomyHistoryEventRow)
    if conds:
        stmt = stmt.where(and_(*conds))
    stmt = (
        stmt.order_by(desc(AutonomyHistoryEventRow.occurred_at))
        .limit(limit)
        .offset(offset)
    )
    rows = list((await session.execute(stmt)).scalars().all())

    count_stmt = select(func.count(AutonomyHistoryEventRow.id))
    if conds:
        count_stmt = count_stmt.where(and_(*conds))
    total = int((await session.execute(count_stmt)).scalar_one())

    return AutonomyHistoryListDto(
        events=[_history_row_to_dto(r) for r in rows], total=total
    )


__all__ = [
    "AutonomyRecordError",
    "apply_transition",
    "ensure_record",
    "get_record",
    "list_history",
    "list_records",
]
