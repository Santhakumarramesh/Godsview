/**
 * Autonomy + Kill-Switch primitives — Phase 6 surface.
 *
 * Autonomy is the *promotion-ceiling* layer that sits directly above the
 * Phase 5 strategy FSM and below the governance approval engine:
 *
 *   strategy FSM (Phase 5)            autonomy FSM (Phase 6)
 *   ──────────────────────            ───────────────────────
 *   experimental ─► paper             assisted_live ─► autonomous_candidate
 *          │                                 │
 *          ▼                                 ▼
 *      assisted_live ──────────────────►  autonomous
 *          │                                 │
 *          ▼                                 ▼
 *      retired                           overridden / suspended
 *
 * Promotion to `autonomous_candidate` is automated once the DNA + calibration
 * + sample-size gates are green; promotion to `autonomous` always requires a
 * governance approval (`strategy_autonomous_promote`). Demotion is
 * instant: an anomaly trip or operator action pushes the record into
 * `overridden` (reversible) or `suspended` (reversible, but halts the
 * live gate pre-flight for that strategy).
 *
 * The kill switch is the global circuit-breaker that overrides every
 * autonomy tier. A tripped kill switch blocks all live execution regardless
 * of strategy state. Scope can be `global` (all accounts, all strategies),
 * `account` (single broker account), or `strategy` (single strategy id).
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Autonomy history is append-only; each transition writes one row.
 *   * Kill-switch events are append-only; the `active` state of a scope is
 *     derived from the most recent event row per scope key.
 */
import { z } from "zod";

// ──────────────────────────── autonomy state ────────────────────────

/**
 * Canonical autonomy tier for a strategy. Ordered weakest → strongest.
 *
 *   assisted_live           Gate-approved; operator must confirm each fill.
 *   autonomous_candidate    Gates green; queued for governance approval.
 *   autonomous              Full autonomy; live gate fires without confirm.
 *   overridden              Operator-forced pause; reversible.
 *   suspended               System-forced pause (anomaly or gate regression).
 */
export const AutonomyStateSchema = z.enum([
  "assisted_live",
  "autonomous_candidate",
  "autonomous",
  "overridden",
  "suspended",
]);
export type AutonomyState = z.infer<typeof AutonomyStateSchema>;

/**
 * Reason the record landed in its current state. Emitted by the
 * autonomy engine and persisted on every transition for audit.
 */
export const AutonomyReasonSchema = z.enum([
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
]);
export type AutonomyReason = z.infer<typeof AutonomyReasonSchema>;

// ──────────────────────────── promotion gates ────────────────────────

/**
 * Per-gate readiness snapshot. All three must be `passing` for the engine
 * to auto-advance a strategy from `assisted_live` to `autonomous_candidate`.
 *
 *   dnaAllClear       Strategy DNA rollups are all in the green band.
 *   calibrationPass   Phase 8 calibration drift detector is ≤ tolerance.
 *   sampleSizeMet     Live fill count ≥ configured floor for this tier.
 */
export const AutonomyGateStatusSchema = z.enum([
  "passing",
  "watch",
  "failing",
  "unknown",
]);
export type AutonomyGateStatus = z.infer<typeof AutonomyGateStatusSchema>;

export const AutonomyGateSnapshotSchema = z.object({
  dnaAllClear: AutonomyGateStatusSchema,
  calibrationPass: AutonomyGateStatusSchema,
  sampleSizeMet: AutonomyGateStatusSchema,
  /** Live fill count that backed `sampleSizeMet`. */
  lastSampleSize: z.number().int().nonnegative(),
  /** Sample-size floor required for the next tier. */
  requiredSampleSize: z.number().int().nonnegative(),
  /** Calibration drift (Brier delta) observed; null if not yet measured. */
  calibrationDrift: z.number().nullable(),
  /** DNA tier at generation, if a snapshot is available. */
  dnaTier: z.enum(["A", "B", "C"]).nullable(),
  observedAt: z.string().datetime(),
});
export type AutonomyGateSnapshot = z.infer<typeof AutonomyGateSnapshotSchema>;

// ──────────────────────────── history rows ──────────────────────────

/**
 * Append-only history row. One row per transition; the `currentState` on
 * the record-of-truth is always the latest row's `toState`.
 */
export const AutonomyHistoryEventSchema = z.object({
  id: z.string(),
  strategyId: z.string(),
  fromState: AutonomyStateSchema.nullable(),
  toState: AutonomyStateSchema,
  reason: AutonomyReasonSchema,
  actorUserId: z.string().nullable(),
  /** Optional governance approval row that authorised the transition. */
  approvalId: z.string().nullable(),
  /** Free-text operator note; required on manual overrides. */
  note: z.string().nullable(),
  gateSnapshot: AutonomyGateSnapshotSchema.nullable(),
  occurredAt: z.string().datetime(),
});
export type AutonomyHistoryEvent = z.infer<typeof AutonomyHistoryEventSchema>;

// ──────────────────────────── record ────────────────────────────────

/**
 * Record-of-truth row for a strategy's autonomy state. One row per
 * strategy; the history table holds the transition trail.
 */
export const AutonomyRecordSchema = z.object({
  strategyId: z.string(),
  currentState: AutonomyStateSchema,
  enteredAt: z.string().datetime(),
  gates: AutonomyGateSnapshotSchema,
  /** Anomaly-trip lockout expiry; null if no lockout is active. */
  lockoutUntil: z.string().datetime().nullable(),
  /** Most-recent reason the engine transitioned into `currentState`. */
  lastReason: AutonomyReasonSchema,
  lastTransitionId: z.string(),
  /** Next scheduled engine review; the gate snapshot is re-evaluated then. */
  nextReviewAt: z.string().datetime(),
  /** Count of autonomous fills since entering the current state. */
  fillsInState: z.number().int().nonnegative(),
  /** Realised R accrued since entering the current state. */
  rInState: z.number(),
  updatedAt: z.string().datetime(),
});
export type AutonomyRecord = z.infer<typeof AutonomyRecordSchema>;

export const AutonomyRecordsListSchema = z.object({
  records: z.array(AutonomyRecordSchema),
  total: z.number().int().nonnegative(),
});
export type AutonomyRecordsList = z.infer<typeof AutonomyRecordsListSchema>;

export const AutonomyHistoryListSchema = z.object({
  events: z.array(AutonomyHistoryEventSchema),
  total: z.number().int().nonnegative(),
});
export type AutonomyHistoryList = z.infer<typeof AutonomyHistoryListSchema>;

export const AutonomyFilterSchema = z.object({
  strategyId: z.string().optional(),
  state: AutonomyStateSchema.optional(),
  reason: AutonomyReasonSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type AutonomyFilter = z.infer<typeof AutonomyFilterSchema>;

// ──────────────────────────── transition requests ───────────────────

/**
 * Operator-initiated transition surface. The engine validates the request
 * against the FSM + governance policy before mutating the record.
 *
 *   promote   assisted_live → autonomous_candidate → autonomous
 *   demote    autonomous → assisted_live
 *   override  * → overridden  (operator pause, reversible)
 *   suspend   * → suspended  (system halt, reversible)
 *   resume    overridden | suspended → assisted_live
 */
export const AutonomyTransitionActionSchema = z.enum([
  "promote",
  "demote",
  "override",
  "suspend",
  "resume",
]);
export type AutonomyTransitionAction = z.infer<
  typeof AutonomyTransitionActionSchema
>;

export const AutonomyTransitionRequestSchema = z.object({
  strategyId: z.string(),
  action: AutonomyTransitionActionSchema,
  reason: z.string().min(3).max(280),
  /** Optional governance approval id that authorised the transition. */
  approvalId: z.string().nullable().optional(),
});
export type AutonomyTransitionRequest = z.infer<
  typeof AutonomyTransitionRequestSchema
>;

// ──────────────────────────── kill switch ────────────────────────────

/**
 * Scope that a kill-switch event applies to. The live gate checks scopes
 * in precedence order: global ▸ account ▸ strategy. A `global` trip blocks
 * every outbound broker intent; a narrower scope only blocks intents that
 * match the `subjectKey`.
 */
export const KillSwitchScopeSchema = z.enum([
  "global",
  "account",
  "strategy",
]);
export type KillSwitchScope = z.infer<typeof KillSwitchScopeSchema>;

export const KillSwitchTriggerSchema = z.enum([
  "operator",
  "anomaly",
  "governance",
  "automated_drawdown",
  "automated_data_truth",
  "automated_broker_health",
]);
export type KillSwitchTrigger = z.infer<typeof KillSwitchTriggerSchema>;

export const KillSwitchActionSchema = z.enum(["trip", "reset"]);
export type KillSwitchAction = z.infer<typeof KillSwitchActionSchema>;

/**
 * Append-only kill-switch event. One row per trip or reset. The current
 * state of a scope is the most recent event row with that (scope,
 * subjectKey) pair.
 */
export const KillSwitchEventSchema = z.object({
  id: z.string(),
  scope: KillSwitchScopeSchema,
  subjectKey: z.string().nullable(),
  action: KillSwitchActionSchema,
  trigger: KillSwitchTriggerSchema,
  actorUserId: z.string().nullable(),
  reason: z.string(),
  /** Optional governance approval id required for reset on critical scopes. */
  approvalId: z.string().nullable(),
  /** Snapshot of system state at trip time, for incident reconstruction. */
  evidence: z.record(z.unknown()),
  occurredAt: z.string().datetime(),
});
export type KillSwitchEvent = z.infer<typeof KillSwitchEventSchema>;

export const KillSwitchStateSchema = z.object({
  scope: KillSwitchScopeSchema,
  subjectKey: z.string().nullable(),
  active: z.boolean(),
  trippedAt: z.string().datetime().nullable(),
  trippedByUserId: z.string().nullable(),
  trigger: KillSwitchTriggerSchema.nullable(),
  reason: z.string().nullable(),
  lastEventId: z.string().nullable(),
  updatedAt: z.string().datetime(),
});
export type KillSwitchState = z.infer<typeof KillSwitchStateSchema>;

export const KillSwitchStatesListSchema = z.object({
  states: z.array(KillSwitchStateSchema),
});
export type KillSwitchStatesList = z.infer<typeof KillSwitchStatesListSchema>;

export const KillSwitchEventsListSchema = z.object({
  events: z.array(KillSwitchEventSchema),
  total: z.number().int().nonnegative(),
});
export type KillSwitchEventsList = z.infer<typeof KillSwitchEventsListSchema>;

export const KillSwitchTripRequestSchema = z.object({
  scope: KillSwitchScopeSchema,
  subjectKey: z.string().nullable(),
  reason: z.string().min(3).max(280),
  trigger: KillSwitchTriggerSchema.optional(),
});
export type KillSwitchTripRequest = z.infer<typeof KillSwitchTripRequestSchema>;

export const KillSwitchResetRequestSchema = z.object({
  scope: KillSwitchScopeSchema,
  subjectKey: z.string().nullable(),
  reason: z.string().min(3).max(280),
  approvalId: z.string().nullable().optional(),
});
export type KillSwitchResetRequest = z.infer<
  typeof KillSwitchResetRequestSchema
>;

export const KillSwitchFilterSchema = z.object({
  scope: KillSwitchScopeSchema.optional(),
  subjectKey: z.string().optional(),
  trigger: KillSwitchTriggerSchema.optional(),
  action: KillSwitchActionSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type KillSwitchFilter = z.infer<typeof KillSwitchFilterSchema>;
