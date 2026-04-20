/**
 * Portfolio rebalance primitives — Phase 7 surface.
 *
 * Phase 6 captured allocation *targets* (`StrategyAllocation.targetPercent`).
 * Phase 7 closes the loop: the rebalancer cron compares each strategy's
 * `targetPercent` against the current ledger notional, emits a
 * `RebalancePlan` row per account + tick, and breaks it down into one
 * `RebalanceIntent` per symbol:
 *
 *   AllocationPlan (Phase 6)
 *         │
 *         ▼
 *   RebalancePlan ──►  RebalanceIntent[] (symbol, side, notional, target)
 *         │                     │
 *         │                     └──►  ExecutionIntent (Phase 4) on approval
 *         │
 *         └──►  governance approval `rebalance_execute` (admin + operator)
 *
 * A plan is inert until an operator approves it. Approval triggers a
 * single atomic batch that drains the intents into the Phase 4 execution
 * bus; partial failures halt the batch and flip the plan to `rejected`
 * with a captured reason. The governance approval authority mirrors the
 * kill-switch reset path (quorum of 2 admins + 1 operator).
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * `notional` is USD dollars; `deltaPercent` is a fraction of equity.
 *   * Intent ids are stable across retries; the execution bus uses
 *     `clientOrderId = intent.id` for idempotent routing.
 */
import { z } from "zod";
import { DirectionSchema } from "./market.js";
import { CorrelationClassSchema } from "./portfolio.js";

// ──────────────────────────── plan lifecycle ─────────────────────────

/**
 * Lifecycle of a rebalance plan. A plan lives through this FSM:
 *
 *   proposed ─► approved ─► executing ─► complete
 *         │         │            │
 *         ▼         ▼            ▼
 *      rejected  cancelled    failed
 *
 *   proposed    Emitted by the cron; awaiting operator review.
 *   approved    Governance quorum reached; queued for batch execution.
 *   executing   Batch actively draining intents into the execution bus.
 *   complete    Every intent terminated (filled, cancelled, or failed).
 *   rejected    Operator declined or a gate check failed pre-execution.
 *   cancelled   Operator cancelled after approval but before execute start.
 *   failed      Execution batch aborted mid-flight; captured for retry.
 */
export const RebalancePlanStatusSchema = z.enum([
  "proposed",
  "approved",
  "executing",
  "complete",
  "rejected",
  "cancelled",
  "failed",
]);
export type RebalancePlanStatus = z.infer<typeof RebalancePlanStatusSchema>;

/**
 * Why the cron emitted this plan. Operator-triggered plans carry
 * `manual`; scheduled passes carry `scheduled`; reactive plans triggered
 * by a drift or anomaly carry `drift` or `anomaly` respectively.
 */
export const RebalanceTriggerSchema = z.enum([
  "scheduled",
  "manual",
  "drift",
  "anomaly",
  "allocation_change",
]);
export type RebalanceTrigger = z.infer<typeof RebalanceTriggerSchema>;

// ──────────────────────────── intent lifecycle ───────────────────────

export const RebalanceIntentStatusSchema = z.enum([
  "queued",
  "submitted",
  "filled",
  "partial",
  "cancelled",
  "failed",
]);
export type RebalanceIntentStatus = z.infer<
  typeof RebalanceIntentStatusSchema
>;

// ──────────────────────────── intent rows ────────────────────────────

/**
 * One row per symbol the plan needs to adjust. `deltaNotional > 0` means
 * the plan will add exposure; `deltaNotional < 0` means it will close
 * exposure. The execution bus translates `side + deltaNotional` into a
 * bracket order sized to the current mark.
 */
export const RebalanceIntentSchema = z.object({
  id: z.string(),
  planId: z.string(),
  strategyId: z.string(),
  symbolId: z.string(),
  correlationClass: CorrelationClassSchema,
  side: DirectionSchema,
  /** Current notional exposure for this (strategy, symbol) pair. */
  currentNotional: z.number(),
  /** Target notional after the plan executes. */
  targetNotional: z.number(),
  /** Signed delta: target - current. */
  deltaNotional: z.number(),
  /** Current percent-of-equity for this leg. */
  currentPercent: z.number(),
  /** Target percent-of-equity after the plan executes. */
  targetPercent: z.number(),
  /** Signed percent-of-equity delta. */
  deltaPercent: z.number(),
  status: RebalanceIntentStatusSchema,
  /** Optional execution intent id the bus minted (null until submitted). */
  executionIntentId: z.string().nullable(),
  /** Optional broker adapter id chosen at routing time. */
  adapterId: z.string().nullable(),
  /** Filled notional at the time of the last status update. */
  filledNotional: z.number(),
  /** Reason captured on `failed` or `cancelled`. */
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type RebalanceIntent = z.infer<typeof RebalanceIntentSchema>;

export const RebalanceIntentsListSchema = z.object({
  intents: z.array(RebalanceIntentSchema),
  total: z.number().int().nonnegative(),
});
export type RebalanceIntentsList = z.infer<typeof RebalanceIntentsListSchema>;

// ──────────────────────────── plan rows ──────────────────────────────

/**
 * Rollup row for a rebalance pass. `intents` is the ordered list the
 * execution batch will drain; `warnings` carries any allocation policy
 * breaches the allocator caught during plan synthesis.
 */
export const RebalancePlanWarningSchema = z.object({
  code: z.enum([
    "target_sum_out_of_band",
    "correlated_exposure_breach",
    "single_symbol_concentration",
    "liquidity_warning",
    "venue_latency_degraded",
    "broker_quorum_insufficient",
    "kill_switch_active",
  ]),
  severity: z.enum(["info", "warn", "critical"]),
  message: z.string(),
  subjectKey: z.string().nullable(),
});
export type RebalancePlanWarning = z.infer<typeof RebalancePlanWarningSchema>;

export const RebalancePlanSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  status: RebalancePlanStatusSchema,
  trigger: RebalanceTriggerSchema,
  /** Operator who ran `manual` or `drift` plans; null for scheduled. */
  initiatedByUserId: z.string().nullable(),
  /** Governance approval id gating `approved` → `executing`. */
  approvalId: z.string().nullable(),
  /** Count of intent rows this plan will emit. */
  intentCount: z.number().int().nonnegative(),
  /** Gross notional (absolute value sum of `deltaNotional`). */
  grossDeltaNotional: z.number().nonnegative(),
  /** Net notional (signed sum of `deltaNotional`). */
  netDeltaNotional: z.number(),
  /** Total R swing the plan represents, if DNA data is available. */
  estimatedR: z.number().nullable(),
  warnings: z.array(RebalancePlanWarningSchema),
  reason: z.string().nullable(),
  proposedAt: z.string().datetime(),
  approvedAt: z.string().datetime().nullable(),
  executedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
});
export type RebalancePlan = z.infer<typeof RebalancePlanSchema>;

export const RebalancePlansListSchema = z.object({
  plans: z.array(RebalancePlanSchema),
  total: z.number().int().nonnegative(),
});
export type RebalancePlansList = z.infer<typeof RebalancePlansListSchema>;

/**
 * Plan + intents envelope for the detail drawer.
 */
export const RebalancePlanDetailSchema = z.object({
  plan: RebalancePlanSchema,
  intents: z.array(RebalanceIntentSchema),
});
export type RebalancePlanDetail = z.infer<typeof RebalancePlanDetailSchema>;

// ──────────────────────────── request surface ────────────────────────

export const RebalancePlanRequestSchema = z.object({
  accountId: z.string(),
  trigger: RebalanceTriggerSchema.optional(),
  /** Optional operator reason captured on manual triggers. */
  reason: z.string().min(3).max(280).optional(),
});
export type RebalancePlanRequest = z.infer<typeof RebalancePlanRequestSchema>;

export const RebalancePlanApproveRequestSchema = z.object({
  approvalId: z.string(),
  reason: z.string().min(3).max(280),
});
export type RebalancePlanApproveRequest = z.infer<
  typeof RebalancePlanApproveRequestSchema
>;

export const RebalancePlanRejectRequestSchema = z.object({
  reason: z.string().min(3).max(280),
});
export type RebalancePlanRejectRequest = z.infer<
  typeof RebalancePlanRejectRequestSchema
>;

export const RebalancePlanCancelRequestSchema = z.object({
  reason: z.string().min(3).max(280),
});
export type RebalancePlanCancelRequest = z.infer<
  typeof RebalancePlanCancelRequestSchema
>;

export const RebalancePlanFilterSchema = z.object({
  accountId: z.string().optional(),
  status: RebalancePlanStatusSchema.optional(),
  trigger: RebalanceTriggerSchema.optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type RebalancePlanFilter = z.infer<typeof RebalancePlanFilterSchema>;

export const RebalanceIntentFilterSchema = z.object({
  planId: z.string().optional(),
  strategyId: z.string().optional(),
  symbolId: z.string().optional(),
  status: RebalanceIntentStatusSchema.optional(),
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().nonnegative().optional(),
});
export type RebalanceIntentFilter = z.infer<typeof RebalanceIntentFilterSchema>;
