/**
 * Setup primitives — the six canonical setup types emitted by the
 * Phase 3 setup library, plus the confidence envelope and the
 * execution-gate approval record.
 *
 * A Setup composes a Market Structure verdict (from Phase 2) with an
 * Order-Flow state (`orderflow.ts`) and emits an actionable trade plan:
 * entry zone, stop-loss, take-profit, risk:reward, and a calibrated
 * confidence score.
 *
 * Setups flow through these states:
 *   detected → approved_paper → approved_live → filled → closed
 *
 * Phase 3 ships detected + approved_paper; approved_live + fill tracking
 * land in Phase 4 (execution + risk engine).
 */
import { z } from "zod";
import { DirectionSchema, TimeframeSchema } from "./market.js";

export const SetupTypeSchema = z.enum([
  "liquidity_sweep_reclaim",
  "ob_retest",
  "breakout_retest",
  "fvg_reaction",
  "momentum_continuation",
  "session_reversal",
]);
export type SetupType = z.infer<typeof SetupTypeSchema>;

export const SetupStatusSchema = z.enum([
  "detected",
  "approved_paper",
  "approved_live",
  "filled",
  "closed",
  "expired",
  "rejected",
]);
export type SetupStatus = z.infer<typeof SetupStatusSchema>;

/** Price + tolerance envelope for an entry / SL / TP. */
export const PriceZoneSchema = z.object({
  low: z.number(),
  high: z.number(),
  ref: z.number(),
});
export type PriceZone = z.infer<typeof PriceZoneSchema>;

/** Calibrated probability of a positive outcome for this setup. */
export const SetupConfidenceSchema = z.object({
  /** 0..1 calibrated win-rate estimate. */
  score: z.number().min(0).max(1),
  /** Inputs used by the calibrator. */
  components: z.object({
    structureScore: z.number().min(0).max(1),
    orderFlowScore: z.number().min(0).max(1),
    regimeScore: z.number().min(0).max(1),
    sessionScore: z.number().min(0).max(1),
    historyScore: z.number().min(0).max(1),
  }),
  /** Number of similar historical setups the calibrator drew from. */
  historyCount: z.number().int().nonnegative(),
});
export type SetupConfidence = z.infer<typeof SetupConfidenceSchema>;

/**
 * Core Setup envelope. Every canonical setup rolls up into this shape so
 * the UI + execution gate + recall engine can treat them uniformly.
 */
export const SetupSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  type: SetupTypeSchema,
  direction: DirectionSchema,
  status: SetupStatusSchema,
  detectedAt: z.string().datetime(),
  entry: PriceZoneSchema,
  stopLoss: z.number(),
  takeProfit: z.number(),
  /** Risk:reward ratio = |TP - entryRef| / |entryRef - SL|. */
  rr: z.number().positive(),
  confidence: SetupConfidenceSchema,
  /** Human-readable rationale from the setup detector. */
  reasoning: z.string(),
  /** IDs of structure events that contributed to this setup. */
  structureEventIds: z.array(z.string()).default([]),
  /** IDs of order-flow events that contributed to this setup. */
  orderFlowEventIds: z.array(z.string()).default([]),
  /** Expiry timestamp — setup auto-rejects if not actioned. */
  expiresAt: z.string().datetime(),
});
export type Setup = z.infer<typeof SetupSchema>;

/** Compact list-row projection served to the /setups index page. */
export const SetupListItemSchema = SetupSchema.pick({
  id: true,
  symbolId: true,
  tf: true,
  type: true,
  direction: true,
  status: true,
  detectedAt: true,
  rr: true,
  expiresAt: true,
}).extend({
  confidenceScore: z.number().min(0).max(1),
  ticker: z.string().min(1),
});
export type SetupListItem = z.infer<typeof SetupListItemSchema>;

export const SetupFilterSchema = z.object({
  symbolId: z.string().optional(),
  type: SetupTypeSchema.optional(),
  direction: DirectionSchema.optional(),
  status: SetupStatusSchema.optional(),
  tf: TimeframeSchema.optional(),
  minConfidence: z.number().min(0).max(1).optional(),
  /** Pagination: ISO-8601 cursor on `detectedAt` desc. */
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type SetupFilter = z.infer<typeof SetupFilterSchema>;

// ─────────────────────────── recall + approval ──────────────────────────

/**
 * One neighbour returned by the recall engine's similarity search for
 * a given setup. Used by the Setup Detail page to render
 * "setups like this have historically won X% of the time".
 */
export const SetupRecallMatchSchema = z.object({
  setupId: z.string().min(1),
  similarity: z.number().min(0).max(1),
  outcome: z.enum(["win", "loss", "scratch", "open"]),
  pnlR: z.number().nullable(),
  detectedAt: z.string().datetime(),
});
export type SetupRecallMatch = z.infer<typeof SetupRecallMatchSchema>;

export const SetupApprovalRequestSchema = z.object({
  /** Must be "paper" in Phase 3. "live" lands in Phase 4. */
  mode: z.enum(["paper", "live"]).default("paper"),
  /** Optional operator override of the detector's risk envelope. */
  overrideRisk: z
    .object({
      sizeMultiplier: z.number().positive().max(5).default(1),
      note: z.string().max(500).optional(),
    })
    .optional(),
});
export type SetupApprovalRequest = z.infer<typeof SetupApprovalRequestSchema>;

export const PaperTradeSchema = z.object({
  id: z.string().min(1),
  setupId: z.string().min(1),
  symbolId: z.string().min(1),
  direction: DirectionSchema,
  entryRef: z.number(),
  stopLoss: z.number(),
  takeProfit: z.number(),
  sizeMultiplier: z.number().positive(),
  status: z.enum(["pending_fill", "filled", "won", "lost", "scratched", "cancelled"]),
  approvedAt: z.string().datetime(),
  approvedByUserId: z.string().min(1),
  closedAt: z.string().datetime().nullable(),
  pnlR: z.number().nullable(),
});
export type PaperTrade = z.infer<typeof PaperTradeSchema>;
