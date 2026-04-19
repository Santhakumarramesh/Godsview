/**
 * TradingView signal envelope + downstream signal status.
 *
 * The TradingView Pine script emits webhooks against /v1/tv-webhook. The
 * payload is verified with HMAC-SHA256 then validated against
 * TvSignalPayloadSchema before being persisted as a TvSignal and routed
 * into the structure pipeline.
 */
import { z } from "zod";
import { DirectionSchema, TimeframeSchema } from "./market.js";

/** Setup family the TV alert claims to be. */
export const SetupFamilySchema = z.enum([
  "liquidity_sweep_reversal",
  "ob_retest",
  "breakout_retest",
  "fvg_reaction",
  "momentum_continuation",
  "session_reversal",
]);
export type SetupFamily = z.infer<typeof SetupFamilySchema>;

/** Raw payload as posted by TradingView. */
export const TvSignalPayloadSchema = z.object({
  /** Operator-supplied alert id; used for dedup. */
  alertId: z.string().min(1),
  ticker: z.string().min(1),
  exchange: z.string().min(1),
  tf: TimeframeSchema,
  direction: DirectionSchema,
  family: SetupFamilySchema,
  entry: z.number(),
  stop: z.number(),
  target: z.number(),
  /** Pine script's reported confidence in [0, 1]. */
  pineConfidence: z.number().min(0).max(1).default(0.5),
  /** Bar close time the alert fired on. */
  firedAt: z.string().datetime(),
  /** Optional free-form note from the script. */
  note: z.string().max(500).optional(),
});
export type TvSignalPayload = z.infer<typeof TvSignalPayloadSchema>;

/** Lifecycle state of a TV-originated signal. */
export const SignalStatusSchema = z.enum([
  "received",
  "verified",
  "deduped",
  "rejected_invalid_hmac",
  "rejected_unknown_symbol",
  "rejected_schema",
  "queued",
  "processed",
  "expired",
]);
export type SignalStatus = z.infer<typeof SignalStatusSchema>;

/** Persisted TV signal record. */
export const TvSignalSchema = z.object({
  id: z.string().min(1),
  /** Full source payload. */
  payload: TvSignalPayloadSchema,
  /** Resolved internal symbol id (null if unresolved). */
  symbolId: z.string().nullable(),
  status: SignalStatusSchema,
  /** Reason string when status is one of the rejected_* values. */
  rejectionReason: z.string().nullable().default(null),
  /** Computed risk:reward (target - entry) / (entry - stop). */
  riskReward: z.number().nullable().default(null),
  receivedAt: z.string().datetime(),
  processedAt: z.string().datetime().nullable().default(null),
});
export type TvSignal = z.infer<typeof TvSignalSchema>;

/** Per-signal audit step — used by the operator drill-down view. */
export const SignalAuditEventSchema = z.object({
  signalId: z.string().min(1),
  step: z.enum([
    "hmac_verified",
    "schema_validated",
    "symbol_resolved",
    "deduped",
    "structure_pipeline_enqueued",
    "structure_pipeline_completed",
    "fusion_completed",
    "setup_emitted",
    "expired",
  ]),
  ok: z.boolean(),
  message: z.string().nullable().default(null),
  t: z.string().datetime(),
});
export type SignalAuditEvent = z.infer<typeof SignalAuditEventSchema>;
