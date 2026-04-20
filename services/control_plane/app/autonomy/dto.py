"""Pydantic v2 DTOs for the autonomy + kill-switch surface.

Mirrors ``packages/types/src/autonomy.ts`` exactly — camelCase over the
wire, snake_case inside Python. All DTOs inherit ``_CamelBase`` which
sets ``populate_by_name=True`` so ORM rows map cleanly by alias.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ──────────────────────────── literals ─────────────────────────────────

AutonomyState = Literal[
    "assisted_live",
    "autonomous_candidate",
    "autonomous",
    "overridden",
    "suspended",
]

AutonomyReason = Literal[
    "initial_promotion",
    "gates_green",
    "governance_approved",
    "governance_rejected",
    "operator_override",
    "operator_suspend",
    "operator_resume",
    "anomaly_trip",
    "calibration_regression",
    "dna_regression",
    "sample_size_regression",
    "manual_demote",
    "kill_switch_active",
]

AutonomyGateStatus = Literal["passing", "watch", "failing", "unknown"]

AutonomyTransitionAction = Literal[
    "promote", "demote", "override", "suspend", "resume"
]

KillSwitchScope = Literal["global", "account", "strategy"]

KillSwitchTrigger = Literal[
    "operator",
    "anomaly",
    "governance",
    "automated_drawdown",
    "automated_data_truth",
    "automated_broker_health",
]

KillSwitchAction = Literal["trip", "reset"]


# ──────────────────────────── camelCase base ───────────────────────────


def _to_camel(name: str) -> str:
    head, *tail = name.split("_")
    return head + "".join(part.title() for part in tail)


class _CamelBase(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
        from_attributes=True,
        alias_generator=_to_camel,
    )


# ──────────────────────────── gate snapshot ────────────────────────────


class AutonomyGateSnapshotDto(_CamelBase):
    """Readiness of the three autonomous-promotion gates."""

    dna_all_clear: AutonomyGateStatus = Field(alias="dnaAllClear")
    calibration_pass: AutonomyGateStatus = Field(alias="calibrationPass")
    sample_size_met: AutonomyGateStatus = Field(alias="sampleSizeMet")
    last_sample_size: int = Field(alias="lastSampleSize", ge=0)
    required_sample_size: int = Field(alias="requiredSampleSize", ge=0)
    calibration_drift: Optional[float] = Field(alias="calibrationDrift", default=None)
    dna_tier: Optional[Literal["A", "B", "C"]] = Field(alias="dnaTier", default=None)
    observed_at: datetime = Field(alias="observedAt")


# ──────────────────────────── history event ────────────────────────────


class AutonomyHistoryEventDto(_CamelBase):
    id: str
    strategy_id: str = Field(alias="strategyId")
    from_state: Optional[AutonomyState] = Field(alias="fromState", default=None)
    to_state: AutonomyState = Field(alias="toState")
    reason: AutonomyReason
    actor_user_id: Optional[str] = Field(alias="actorUserId", default=None)
    approval_id: Optional[str] = Field(alias="approvalId", default=None)
    note: Optional[str] = None
    gate_snapshot: Optional[AutonomyGateSnapshotDto] = Field(
        alias="gateSnapshot", default=None
    )
    occurred_at: datetime = Field(alias="occurredAt")


class AutonomyHistoryListDto(_CamelBase):
    events: List[AutonomyHistoryEventDto]
    total: int = 0


# ──────────────────────────── record-of-truth ──────────────────────────


class AutonomyRecordDto(_CamelBase):
    strategy_id: str = Field(alias="strategyId")
    current_state: AutonomyState = Field(alias="currentState")
    entered_at: datetime = Field(alias="enteredAt")
    gates: AutonomyGateSnapshotDto
    lockout_until: Optional[datetime] = Field(alias="lockoutUntil", default=None)
    last_reason: AutonomyReason = Field(alias="lastReason")
    last_transition_id: str = Field(alias="lastTransitionId")
    next_review_at: datetime = Field(alias="nextReviewAt")
    fills_in_state: int = Field(alias="fillsInState", ge=0)
    r_in_state: float = Field(alias="rInState")
    updated_at: datetime = Field(alias="updatedAt")


class AutonomyRecordsListDto(_CamelBase):
    records: List[AutonomyRecordDto]
    total: int = 0


# ──────────────────────────── transition request ───────────────────────


class AutonomyTransitionRequestDto(_CamelBase):
    strategy_id: str = Field(alias="strategyId")
    action: AutonomyTransitionAction
    reason: str = Field(min_length=3, max_length=280)
    approval_id: Optional[str] = Field(alias="approvalId", default=None)


# ──────────────────────────── kill switch ──────────────────────────────


class KillSwitchEventDto(_CamelBase):
    id: str
    scope: KillSwitchScope
    subject_key: Optional[str] = Field(alias="subjectKey", default=None)
    action: KillSwitchAction
    trigger: KillSwitchTrigger
    actor_user_id: Optional[str] = Field(alias="actorUserId", default=None)
    reason: str
    approval_id: Optional[str] = Field(alias="approvalId", default=None)
    evidence: Dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime = Field(alias="occurredAt")


class KillSwitchStateDto(_CamelBase):
    scope: KillSwitchScope
    subject_key: Optional[str] = Field(alias="subjectKey", default=None)
    active: bool
    tripped_at: Optional[datetime] = Field(alias="trippedAt", default=None)
    tripped_by_user_id: Optional[str] = Field(
        alias="trippedByUserId", default=None
    )
    trigger: Optional[KillSwitchTrigger] = None
    reason: Optional[str] = None
    last_event_id: Optional[str] = Field(alias="lastEventId", default=None)
    updated_at: datetime = Field(alias="updatedAt")


class KillSwitchStatesListDto(_CamelBase):
    states: List[KillSwitchStateDto]


class KillSwitchEventsListDto(_CamelBase):
    events: List[KillSwitchEventDto]
    total: int = 0


class KillSwitchTripRequestDto(_CamelBase):
    scope: KillSwitchScope
    subject_key: Optional[str] = Field(alias="subjectKey", default=None)
    reason: str = Field(min_length=3, max_length=280)
    trigger: Optional[KillSwitchTrigger] = None


class KillSwitchResetRequestDto(_CamelBase):
    scope: KillSwitchScope
    subject_key: Optional[str] = Field(alias="subjectKey", default=None)
    reason: str = Field(min_length=3, max_length=280)
    approval_id: Optional[str] = Field(alias="approvalId", default=None)


__all__ = [
    "AutonomyGateSnapshotDto",
    "AutonomyGateStatus",
    "AutonomyHistoryEventDto",
    "AutonomyHistoryListDto",
    "AutonomyReason",
    "AutonomyRecordDto",
    "AutonomyRecordsListDto",
    "AutonomyState",
    "AutonomyTransitionAction",
    "AutonomyTransitionRequestDto",
    "KillSwitchAction",
    "KillSwitchEventDto",
    "KillSwitchEventsListDto",
    "KillSwitchResetRequestDto",
    "KillSwitchScope",
    "KillSwitchStateDto",
    "KillSwitchStatesListDto",
    "KillSwitchTripRequestDto",
    "KillSwitchTrigger",
]
