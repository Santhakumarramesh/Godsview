"""Phase 6 autonomy + kill-switch domain package.

Layout:

  * ``dto``          — Pydantic v2 DTOs mirroring ``autonomy.ts``.
  * ``fsm``          — Transition matrix + FSM validation.
  * ``gates``        — Gate-snapshot readers (DNA + calibration + sample).
  * ``records``      — Record/history CRUD + transition writer.
  * ``kill_switch``  — Trip/reset + derived state + live-gate query.
"""

from app.autonomy.dto import (
    AutonomyGateSnapshotDto,
    AutonomyGateStatus,
    AutonomyHistoryEventDto,
    AutonomyHistoryListDto,
    AutonomyReason,
    AutonomyRecordDto,
    AutonomyRecordsListDto,
    AutonomyState,
    AutonomyTransitionAction,
    AutonomyTransitionRequestDto,
    KillSwitchAction,
    KillSwitchEventDto,
    KillSwitchEventsListDto,
    KillSwitchResetRequestDto,
    KillSwitchScope,
    KillSwitchStateDto,
    KillSwitchStatesListDto,
    KillSwitchTripRequestDto,
    KillSwitchTrigger,
)
from app.autonomy.fsm import (
    AutonomyFSMError,
    apply_action,
    requires_governance_approval,
    valid_actions_for,
)

__all__ = [
    "AutonomyFSMError",
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
    "apply_action",
    "requires_governance_approval",
    "valid_actions_for",
]
