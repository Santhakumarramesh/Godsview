/**
 * Governance + Autonomy primitives — Phase 6 surface.
 *
 * Governance sits *above* every privileged mutation in GodsView. The
 * trust-tier model gates who can do what, the approval workflow gates
 * what requires a second signer, and the anomaly surface flags drift
 * before it becomes an incident.
 *
 *   operator action ──► GovernanceApprovalRequest
 *                          │
 *                          ├──► ApprovalPolicy lookup (tier × action)
 *                          │
 *                          ├──► required approvers resolved
 *                          │
 *                          └──► approval decisions audit-logged
 *
 *   AnomalyDetector ──► AnomalyAlert ──► operator acknowledgement
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Approval rows are append-only; decisions land as separate rows
 *     keyed on (approvalId, approverUserId).
 */
import { z } from "zod";

// ──────────────────────────── trust tiers ────────────────────────────

/**
 * Trust tier for an operator principal. Ordered weakest → strongest.
 * A principal can only take an action if their tier is ≥ the tier the
 * action requires in its `ApprovalPolicy` row.
 */
export const TrustTierSchema = z.enum([
  "readonly",
  "operator",
  "senior_operator",
  "admin",
  "owner",
]);
export type TrustTier = z.infer<typeof TrustTierSchema>;

/**
 * Canonical action type surface. Every admin-mutating route maps to one
 * of these — the policy engine keys on the action type, not the HTTP
 * path, so route renames don't reopen policy.
 */
export const GovernanceActionSchema = z.enum([
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
]);
export type GovernanceAction = z.infer<typeof GovernanceActionSchema>;

export const ApprovalStateSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
  "withdrawn",
]);
export type ApprovalState = z.infer<typeof ApprovalStateSchema>;

export const ApprovalDecisionSchema = z.enum([
  "approve",
  "reject",
  "abstain",
]);
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;

// ──────────────────────────── policy ────────────────────────────────

/**
 * Policy row — which actions require approval, minimum tier of requester,
 * approver set size, approver minimum tier, and TTL before auto-expiry.
 */
export const ApprovalPolicySchema = z.object({
  id: z.string(),
  action: GovernanceActionSchema,
  requiresApproval: z.boolean(),
  minRequesterTier: TrustTierSchema,
  minApproverTier: TrustTierSchema,
  approverCount: z.number().int().min(1).max(5),
  /** Approval request TTL in seconds. 0 = no expiry. */
  ttlSeconds: z.number().int().min(0).max(30 * 24 * 3600),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ApprovalPolicy = z.infer<typeof ApprovalPolicySchema>;

export const ApprovalPolicyListSchema = z.object({
  policies: z.array(ApprovalPolicySchema),
});
export type ApprovalPolicyList = z.infer<typeof ApprovalPolicyListSchema>;

export const ApprovalPolicyUpdateSchema = z.object({
  requiresApproval: z.boolean().optional(),
  minRequesterTier: TrustTierSchema.optional(),
  minApproverTier: TrustTierSchema.optional(),
  approverCount: z.number().int().min(1).max(5).optional(),
  ttlSeconds: z.number().int().min(0).max(30 * 24 * 3600).optional(),
});
export type ApprovalPolicyUpdate = z.infer<typeof ApprovalPolicyUpdateSchema>;

// ──────────────────────────── approvals ─────────────────────────────

/**
 * Per-approver decision row. One row per (approvalId, approverUserId).
 */
export const ApprovalDecisionRecordSchema = z.object({
  approverUserId: z.string(),
  decision: ApprovalDecisionSchema,
  decidedAt: z.string().datetime(),
  comment: z.string().nullable(),
});
export type ApprovalDecisionRecord = z.infer<
  typeof ApprovalDecisionRecordSchema
>;

export const GovernanceApprovalSchema = z.object({
  id: z.string(),
  action: GovernanceActionSchema,
  /** Opaque domain-object identifier the action targets (strategy id, account id, etc.). */
  subjectKey: z.string().nullable(),
  /** Arbitrary payload the policy engine re-validates post-approval. */
  payload: z.record(z.unknown()),
  requestedByUserId: z.string(),
  requestedAt: z.string().datetime(),
  reason: z.string(),
  state: ApprovalStateSchema,
  expiresAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().nullable(),
  requiredApproverCount: z.number().int().min(1).max(5),
  decisions: z.array(ApprovalDecisionRecordSchema),
});
export type GovernanceApproval = z.infer<typeof GovernanceApprovalSchema>;

export const GovernanceApprovalsListSchema = z.object({
  approvals: z.array(GovernanceApprovalSchema),
  total: z.number().int().nonnegative(),
});
export type GovernanceApprovalsList = z.infer<
  typeof GovernanceApprovalsListSchema
>;

export const GovernanceApprovalFilterSchema = z.object({
  state: ApprovalStateSchema.optional(),
  action: GovernanceActionSchema.optional(),
  requestedByUserId: z.string().optional(),
  subjectKey: z.string().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type GovernanceApprovalFilter = z.infer<
  typeof GovernanceApprovalFilterSchema
>;

export const CreateApprovalRequestSchema = z.object({
  action: GovernanceActionSchema,
  subjectKey: z.string().nullable(),
  payload: z.record(z.unknown()),
  reason: z.string().min(3).max(280),
});
export type CreateApprovalRequest = z.infer<typeof CreateApprovalRequestSchema>;

export const DecideApprovalRequestSchema = z.object({
  decision: ApprovalDecisionSchema,
  comment: z.string().max(280).optional(),
});
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequestSchema>;

// ──────────────────────────── anomaly surface ────────────────────────

/**
 * Canonical anomaly source. The detector emits a row; the operator
 * acknowledges or suppresses; the governance policy may require
 * approval-gated mutations while unacknowledged critical anomalies
 * exist.
 */
export const AnomalySourceSchema = z.enum([
  "drawdown_spike",
  "win_rate_regression",
  "latency_spike",
  "data_truth_fail",
  "broker_reject_cluster",
  "strategy_drift",
  "kill_switch_tripped",
  "allocation_breach",
  "auth_anomaly",
  "other",
]);
export type AnomalySource = z.infer<typeof AnomalySourceSchema>;

export const AnomalySeveritySchema = z.enum([
  "info",
  "warn",
  "error",
  "critical",
]);
export type AnomalySeverity = z.infer<typeof AnomalySeveritySchema>;

export const AnomalyStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
  "suppressed",
]);
export type AnomalyStatus = z.infer<typeof AnomalyStatusSchema>;

export const AnomalyAlertSchema = z.object({
  id: z.string(),
  detectedAt: z.string().datetime(),
  source: AnomalySourceSchema,
  severity: AnomalySeveritySchema,
  status: AnomalyStatusSchema,
  subjectKey: z.string().nullable(),
  message: z.string(),
  evidence: z.record(z.unknown()),
  acknowledgedAt: z.string().datetime().nullable(),
  acknowledgedByUserId: z.string().nullable(),
  resolvedAt: z.string().datetime().nullable(),
  resolvedByUserId: z.string().nullable(),
  suppressedUntil: z.string().datetime().nullable(),
  relatedApprovalId: z.string().nullable(),
});
export type AnomalyAlert = z.infer<typeof AnomalyAlertSchema>;

export const AnomalyAlertsListSchema = z.object({
  alerts: z.array(AnomalyAlertSchema),
  total: z.number().int().nonnegative(),
});
export type AnomalyAlertsList = z.infer<typeof AnomalyAlertsListSchema>;

export const AnomalyFilterSchema = z.object({
  status: AnomalyStatusSchema.optional(),
  severity: AnomalySeveritySchema.optional(),
  source: AnomalySourceSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type AnomalyFilter = z.infer<typeof AnomalyFilterSchema>;

export const AcknowledgeAnomalyRequestSchema = z.object({
  comment: z.string().max(280).optional(),
  suppressForSeconds: z.number().int().min(0).max(30 * 24 * 3600).optional(),
});
export type AcknowledgeAnomalyRequest = z.infer<
  typeof AcknowledgeAnomalyRequestSchema
>;

export const ResolveAnomalyRequestSchema = z.object({
  comment: z.string().max(280).optional(),
});
export type ResolveAnomalyRequest = z.infer<typeof ResolveAnomalyRequestSchema>;

// ──────────────────────────── trust registry ────────────────────────

/**
 * Per-user trust tier record. The auth subsystem (Phase 1) holds the
 * User row; this schema is the governance projection with tier history.
 */
export const TrustTierAssignmentSchema = z.object({
  userId: z.string(),
  tier: TrustTierSchema,
  assignedAt: z.string().datetime(),
  assignedByUserId: z.string(),
  reason: z.string(),
});
export type TrustTierAssignment = z.infer<typeof TrustTierAssignmentSchema>;

export const TrustRegistryEntrySchema = z.object({
  userId: z.string(),
  email: z.string().nullable(),
  currentTier: TrustTierSchema,
  history: z.array(TrustTierAssignmentSchema),
  updatedAt: z.string().datetime(),
});
export type TrustRegistryEntry = z.infer<typeof TrustRegistryEntrySchema>;

export const TrustRegistryListSchema = z.object({
  entries: z.array(TrustRegistryEntrySchema),
});
export type TrustRegistryList = z.infer<typeof TrustRegistryListSchema>;

export const AssignTrustTierRequestSchema = z.object({
  userId: z.string(),
  tier: TrustTierSchema,
  reason: z.string().min(3).max(280),
});
export type AssignTrustTierRequest = z.infer<
  typeof AssignTrustTierRequestSchema
>;
