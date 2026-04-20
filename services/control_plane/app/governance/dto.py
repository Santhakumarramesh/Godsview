"""Governance wire DTOs — Pydantic v2 mirror of ``packages/types/src/governance.ts``.

The wire contract is camelCase; ORM-internal attributes are
snake_case. Every DTO uses ``ConfigDict(populate_by_name=True,
from_attributes=True)`` so routes can build responses directly from
ORM rows without a manual mapper.

These DTOs are a 1:1 structural mirror of ``packages/types/src/governance.ts``
— any drift should surface in the contract-validation CI job.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class _CamelBase(BaseModel):
    model_config = ConfigDict(populate_by_name=True, from_attributes=True)


# ──────────────────────────── enums (string literals) ───────────────────

TrustTier = Literal[
    "readonly",
    "operator",
    "senior_operator",
    "admin",
    "owner",
]

GovernanceAction = Literal[
    "live_mode_enable",
    "kill_switch_toggle",
    "risk_budget_widen",
    "risk_budget_tighten",
    "strategy_promote",
    "strategy_demote",
    "strategy_retire",
    "strategy_autonomous_promote",
    "strategy_autonomous_demote",
    "allocation_set",
    "override_risk",
    "feature_flag_toggle",
    "trust_tier_change",
    "approval_policy_edit",
    "anomaly_acknowledge",
    "calibration_recompute",
    "dna_rebuild",
    "data_truth_override",
    "rebalance_execute",
]

ApprovalState = Literal[
    "pending",
    "approved",
    "rejected",
    "expired",
    "withdrawn",
]

ApprovalDecisionKind = Literal["approve", "reject", "abstain"]

AnomalySource = Literal[
    "drawdown_spike",
    "win_rate_regression",
    "latency_spike",
    "data_truth_fail",
    "broker_reject_cluster",
    "strategy_drift",
    "kill_switch_tripped",
    "allocation_breach",
    "auth_anomaly",
    "venue_latency_breach",
    "broker_outage",
    "calibration_brier_regression",
    "other",
]

AnomalySeverity = Literal["info", "warn", "error", "critical"]

AnomalyStatus = Literal["open", "acknowledged", "resolved", "suppressed"]


# ──────────────────────────── approval policies ─────────────────────────


class ApprovalPolicyDto(_CamelBase):
    id: str
    action: GovernanceAction
    requires_approval: bool = Field(..., alias="requiresApproval")
    min_requester_tier: TrustTier = Field(..., alias="minRequesterTier")
    min_approver_tier: TrustTier = Field(..., alias="minApproverTier")
    approver_count: int = Field(..., alias="approverCount", ge=1, le=5)
    ttl_seconds: int = Field(..., alias="ttlSeconds", ge=0, le=30 * 24 * 3600)
    created_at: datetime = Field(..., alias="createdAt")
    updated_at: datetime = Field(..., alias="updatedAt")


class ApprovalPolicyListDto(_CamelBase):
    policies: List[ApprovalPolicyDto]


class ApprovalPolicyUpdateDto(_CamelBase):
    requires_approval: Optional[bool] = Field(None, alias="requiresApproval")
    min_requester_tier: Optional[TrustTier] = Field(None, alias="minRequesterTier")
    min_approver_tier: Optional[TrustTier] = Field(None, alias="minApproverTier")
    approver_count: Optional[int] = Field(
        None, alias="approverCount", ge=1, le=5
    )
    ttl_seconds: Optional[int] = Field(
        None, alias="ttlSeconds", ge=0, le=30 * 24 * 3600
    )


# ──────────────────────────── approvals ─────────────────────────────────


class ApprovalDecisionRecordDto(_CamelBase):
    approver_user_id: str = Field(..., alias="approverUserId")
    decision: ApprovalDecisionKind
    decided_at: datetime = Field(..., alias="decidedAt")
    comment: Optional[str] = None


class GovernanceApprovalDto(_CamelBase):
    id: str
    action: GovernanceAction
    subject_key: Optional[str] = Field(None, alias="subjectKey")
    payload: Dict[str, Any]
    requested_by_user_id: str = Field(..., alias="requestedByUserId")
    requested_at: datetime = Field(..., alias="requestedAt")
    reason: str
    state: ApprovalState
    expires_at: Optional[datetime] = Field(None, alias="expiresAt")
    resolved_at: Optional[datetime] = Field(None, alias="resolvedAt")
    resolved_by_user_id: Optional[str] = Field(None, alias="resolvedByUserId")
    required_approver_count: int = Field(
        ..., alias="requiredApproverCount", ge=1, le=5
    )
    decisions: List[ApprovalDecisionRecordDto]


class GovernanceApprovalsListDto(_CamelBase):
    approvals: List[GovernanceApprovalDto]
    total: int


class CreateApprovalRequestDto(_CamelBase):
    action: GovernanceAction
    subject_key: Optional[str] = Field(None, alias="subjectKey")
    payload: Dict[str, Any] = Field(default_factory=dict)
    reason: str = Field(..., min_length=3, max_length=280)


class DecideApprovalRequestDto(_CamelBase):
    decision: ApprovalDecisionKind
    comment: Optional[str] = Field(None, max_length=280)


class WithdrawApprovalRequestDto(_CamelBase):
    reason: str = Field(..., min_length=3, max_length=280)


# ──────────────────────────── anomaly surface ────────────────────────────


class AnomalyAlertDto(_CamelBase):
    id: str
    detected_at: datetime = Field(..., alias="detectedAt")
    source: AnomalySource
    severity: AnomalySeverity
    status: AnomalyStatus
    subject_key: Optional[str] = Field(None, alias="subjectKey")
    message: str
    evidence: Dict[str, Any] = Field(default_factory=dict)
    acknowledged_at: Optional[datetime] = Field(None, alias="acknowledgedAt")
    acknowledged_by_user_id: Optional[str] = Field(
        None, alias="acknowledgedByUserId"
    )
    resolved_at: Optional[datetime] = Field(None, alias="resolvedAt")
    resolved_by_user_id: Optional[str] = Field(None, alias="resolvedByUserId")
    suppressed_until: Optional[datetime] = Field(None, alias="suppressedUntil")
    related_approval_id: Optional[str] = Field(None, alias="relatedApprovalId")


class AnomalyAlertsListDto(_CamelBase):
    alerts: List[AnomalyAlertDto]
    total: int


class AcknowledgeAnomalyRequestDto(_CamelBase):
    comment: Optional[str] = Field(None, max_length=280)
    suppress_for_seconds: Optional[int] = Field(
        None, alias="suppressForSeconds", ge=0, le=30 * 24 * 3600
    )


class ResolveAnomalyRequestDto(_CamelBase):
    comment: Optional[str] = Field(None, max_length=280)


# ──────────────────────────── detector run surface ─────────────────────


class DetectorRunSummaryDto(_CamelBase):
    """Per-detector summary inside a detector-pass response."""

    source: AnomalySource
    emitted: int = Field(..., ge=0)
    suppressed: int = Field(..., ge=0)
    samples_examined: int = Field(..., alias="samplesExamined", ge=0)
    notes: Optional[str] = None


class DetectorRunResultDto(_CamelBase):
    """Envelope returned by ``POST /v1/governance/detectors/run``."""

    ran_at: datetime = Field(..., alias="ranAt")
    total_emitted: int = Field(..., alias="totalEmitted", ge=0)
    total_suppressed: int = Field(..., alias="totalSuppressed", ge=0)
    detectors: List[DetectorRunSummaryDto]


# ──────────────────────────── trust registry ────────────────────────────


class TrustTierAssignmentDto(_CamelBase):
    user_id: str = Field(..., alias="userId")
    tier: TrustTier
    assigned_at: datetime = Field(..., alias="assignedAt")
    assigned_by_user_id: str = Field(..., alias="assignedByUserId")
    reason: str


class TrustRegistryEntryDto(_CamelBase):
    user_id: str = Field(..., alias="userId")
    email: Optional[str] = None
    current_tier: TrustTier = Field(..., alias="currentTier")
    history: List[TrustTierAssignmentDto]
    updated_at: datetime = Field(..., alias="updatedAt")


class TrustRegistryListDto(_CamelBase):
    entries: List[TrustRegistryEntryDto]


class AssignTrustTierRequestDto(_CamelBase):
    user_id: str = Field(..., alias="userId")
    tier: TrustTier
    reason: str = Field(..., min_length=3, max_length=280)


__all__ = [
    "TrustTier",
    "GovernanceAction",
    "ApprovalState",
    "ApprovalDecisionKind",
    "AnomalySource",
    "AnomalySeverity",
    "AnomalyStatus",
    "ApprovalPolicyDto",
    "ApprovalPolicyListDto",
    "ApprovalPolicyUpdateDto",
    "ApprovalDecisionRecordDto",
    "GovernanceApprovalDto",
    "GovernanceApprovalsListDto",
    "CreateApprovalRequestDto",
    "DecideApprovalRequestDto",
    "WithdrawApprovalRequestDto",
    "AnomalyAlertDto",
    "AnomalyAlertsListDto",
    "AcknowledgeAnomalyRequestDto",
    "ResolveAnomalyRequestDto",
    "DetectorRunSummaryDto",
    "DetectorRunResultDto",
    "TrustTierAssignmentDto",
    "TrustRegistryEntryDto",
    "TrustRegistryListDto",
    "AssignTrustTierRequestDto",
]
