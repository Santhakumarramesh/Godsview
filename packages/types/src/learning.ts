/**
 * Learning + Governance primitives — Phase 5 surface.
 *
 * The learning loop closes the circuit:
 *
 *   Setup + Fill ──► LearningEvent ──► ConfidenceCalibration
 *                          │
 *                          ├──► RegimeSnapshot (per symbol, per tf)
 *                          │
 *                          ├──► SessionSnapshot (london/ny/asia)
 *                          │
 *                          └──► StrategyDNA (where it works / fails)
 *
 * A separate DataTruthCheck monitor watches the ingestion fabric for
 * bad feeds, latency, gaps, and trips the kill switch when any gate
 * fails. The learning agent only promotes strategies when data truth
 * is green.
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Calibration curves and DNA grids are dense numeric arrays; no
 *     sparse envelopes (the dimensions are small + fixed).
 */
import { z } from "zod";
import { TimeframeSchema } from "./market.js";
import { SetupTypeSchema } from "./setups.js";
import { StrategyTierSchema } from "./quant-lab.js";

// ──────────────────────────── learning events ──────────────────────────

/**
 * The canonical event types emitted to the learning bus. One row per
 * event. Events are immutable and the learning worker consumes them
 * in strict createdAt order.
 */
export const LearningEventKindSchema = z.enum([
  "setup_detected",
  "setup_approved",
  "setup_rejected",
  "trade_opened",
  "trade_closed_win",
  "trade_closed_loss",
  "trade_closed_scratch",
  "backtest_completed",
  "calibration_updated",
  "regime_flipped",
  "data_truth_breach",
  "promotion_auto_demote",
  "promotion_manual",
]);
export type LearningEventKind = z.infer<typeof LearningEventKindSchema>;

export const LearningEventSchema = z.object({
  id: z.string().min(1),
  kind: LearningEventKindSchema,
  /** Subject id — setupId | tradeId | backtestId | strategyId. */
  subjectId: z.string().min(1),
  subjectKind: z.enum([
    "setup",
    "paper_trade",
    "live_trade",
    "backtest",
    "strategy",
    "calibration",
    "regime",
    "data_truth",
  ]),
  strategyId: z.string().nullable(),
  /** Arbitrary JSON payload — kind-specific. */
  payload: z.record(z.string(), z.any()).default({}),
  /** Optional correlation id grouping related events. */
  correlationId: z.string().nullable(),
  occurredAt: z.string().datetime(),
  ingestedAt: z.string().datetime(),
});
export type LearningEvent = z.infer<typeof LearningEventSchema>;

export const LearningEventFilterSchema = z.object({
  kind: LearningEventKindSchema.optional(),
  subjectKind: LearningEventSchema.shape.subjectKind.optional(),
  strategyId: z.string().optional(),
  fromTs: z.string().datetime().optional(),
  toTs: z.string().datetime().optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(100),
});
export type LearningEventFilter = z.infer<typeof LearningEventFilterSchema>;

export const LearningEventsListOutSchema = z.object({
  events: z.array(LearningEventSchema),
  total: z.number().int().nonnegative(),
});
export type LearningEventsListOut = z.infer<typeof LearningEventsListOutSchema>;

// ──────────────────────────── confidence calibration ───────────────────

/**
 * Calibrator kind. `bucket` is the bit-stable default (isotonic buckets
 * over 10 bins of raw score). `platt` is a 2-parameter sigmoid fit for
 * strategies with enough samples (>= 200).
 */
export const CalibrationKindSchema = z.enum(["bucket", "platt"]);
export type CalibrationKind = z.infer<typeof CalibrationKindSchema>;

/**
 * One bin on a bucket calibrator. `rawLow..rawHigh` maps to a calibrated
 * probability `calibrated` with sample size `count`.
 */
export const CalibrationBinSchema = z.object({
  rawLow: z.number().min(0).max(1),
  rawHigh: z.number().min(0).max(1),
  calibrated: z.number().min(0).max(1),
  count: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
});
export type CalibrationBin = z.infer<typeof CalibrationBinSchema>;

/**
 * Calibrator snapshot for a given (strategyId, setupType, tf) key.
 * Recomputed hourly; the most recent row is canonical.
 */
export const ConfidenceCalibrationSchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().nullable(),
  setupType: SetupTypeSchema.nullable(),
  tf: TimeframeSchema.nullable(),
  kind: CalibrationKindSchema,
  /** Bucket kind only — 10 bins from 0..1. */
  bins: z.array(CalibrationBinSchema),
  /** Platt kind only — calibrated = 1 / (1 + exp(a*raw + b)). */
  plattA: z.number().nullable(),
  plattB: z.number().nullable(),
  /** Expected Calibration Error — lower is better. */
  ece: z.number().min(0).max(1),
  /** Brier score — lower is better. */
  brier: z.number().min(0).max(1),
  /** Sample size that fit this curve. */
  sampleSize: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
export type ConfidenceCalibration = z.infer<typeof ConfidenceCalibrationSchema>;

export const CalibrationCurvesOutSchema = z.object({
  curves: z.array(ConfidenceCalibrationSchema),
  generatedAt: z.string().datetime(),
});
export type CalibrationCurvesOut = z.infer<typeof CalibrationCurvesOutSchema>;

// ──────────────────────────── regime detection ─────────────────────────

export const RegimeKindSchema = z.enum([
  "trending",
  "ranging",
  "volatile",
  "news_driven",
]);
export type RegimeKind = z.infer<typeof RegimeKindSchema>;

/**
 * Per (symbolId, tf) regime verdict. Emitted by the regime detector on
 * the structure + order-flow stream. Updated on every fresh bar close;
 * canonical row is the latest per (symbolId, tf).
 */
export const RegimeSnapshotSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  kind: RegimeKindSchema,
  /** 0..1 — how strongly the detector is asserting this regime. */
  confidence: z.number().min(0).max(1),
  /** The signed trend strength (-1..1). */
  trendStrength: z.number().min(-1).max(1),
  /** 0..1 normalised volatility percentile. */
  volatility: z.number().min(0).max(1),
  /** Wall-clock age of the bar that produced this verdict. */
  barAgeMs: z.number().int().nonnegative(),
  observedAt: z.string().datetime(),
  /** Optional short narrative. */
  notes: z.string().max(2000).default(""),
});
export type RegimeSnapshot = z.infer<typeof RegimeSnapshotSchema>;

export const RegimeCurrentOutSchema = z.object({
  snapshots: z.array(RegimeSnapshotSchema),
  generatedAt: z.string().datetime(),
});
export type RegimeCurrentOut = z.infer<typeof RegimeCurrentOutSchema>;

export const RegimeHistoryFilterSchema = z.object({
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  fromTs: z.string().datetime().optional(),
  toTs: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(500).default(200),
});
export type RegimeHistoryFilter = z.infer<typeof RegimeHistoryFilterSchema>;

export const RegimeHistoryOutSchema = z.object({
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  snapshots: z.array(RegimeSnapshotSchema),
});
export type RegimeHistoryOut = z.infer<typeof RegimeHistoryOutSchema>;

// ──────────────────────────── session intelligence ─────────────────────

export const TradingSessionSchema = z.enum([
  "asia",
  "london",
  "ny_am",
  "ny_pm",
  "off_hours",
]);
export type TradingSession = z.infer<typeof TradingSessionSchema>;

export const SessionSnapshotSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  session: TradingSessionSchema,
  /** Mean realised volatility (normalised 0..1) in this session. */
  volatility: z.number().min(0).max(1),
  /** Historical win rate of our setups played in this session. */
  winRate: z.number().min(0).max(1).nullable(),
  /** Mean R across our setups played in this session. */
  meanR: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
  observedAt: z.string().datetime(),
});
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;

export const SessionIntelOutSchema = z.object({
  snapshots: z.array(SessionSnapshotSchema),
  generatedAt: z.string().datetime(),
});
export type SessionIntelOut = z.infer<typeof SessionIntelOutSchema>;

// ──────────────────────────── data truth + kill switch ─────────────────

export const DataTruthStatusSchema = z.enum(["green", "amber", "red"]);
export type DataTruthStatus = z.infer<typeof DataTruthStatusSchema>;

export const DataTruthCheckKindSchema = z.enum([
  "bar_latency",
  "bar_gap",
  "book_staleness",
  "feed_desync",
  "symbol_missing",
  "broker_heartbeat",
]);
export type DataTruthCheckKind = z.infer<typeof DataTruthCheckKindSchema>;

export const DataTruthCheckSchema = z.object({
  id: z.string().min(1),
  kind: DataTruthCheckKindSchema,
  status: DataTruthStatusSchema,
  /** Short narrative — what's failing + what it implies. */
  message: z.string().max(2000),
  /** Numeric measurement — latency ms, gap s, etc. */
  measurement: z.number(),
  /** Configured threshold for amber. */
  amberThreshold: z.number(),
  /** Configured threshold for red (kill-switch trip). */
  redThreshold: z.number(),
  symbolId: z.string().nullable(),
  observedAt: z.string().datetime(),
});
export type DataTruthCheck = z.infer<typeof DataTruthCheckSchema>;

export const DataTruthStatusOutSchema = z.object({
  /** Overall status = worst of any individual check. */
  status: DataTruthStatusSchema,
  checks: z.array(DataTruthCheckSchema),
  /** If true, live-gate is unconditionally rejecting new approvals. */
  killSwitchTripped: z.boolean(),
  /** Short reason the kill-switch is tripped (null if not tripped). */
  killSwitchReason: z.string().nullable(),
  generatedAt: z.string().datetime(),
});
export type DataTruthStatusOut = z.infer<typeof DataTruthStatusOutSchema>;

// ──────────────────────────── strategy DNA ─────────────────────────────

/**
 * Compact 2-D grid summarising where a strategy has worked historically.
 * Rows = regime, columns = session. Each cell carries win rate + mean R
 * + sample size. Updated as trades accumulate.
 */
export const DNACellSchema = z.object({
  regime: RegimeKindSchema,
  session: TradingSessionSchema,
  winRate: z.number().min(0).max(1).nullable(),
  meanR: z.number().nullable(),
  sampleSize: z.number().int().nonnegative(),
});
export type DNACell = z.infer<typeof DNACellSchema>;

export const StrategyDNASchema = z.object({
  id: z.string().min(1),
  strategyId: z.string().min(1),
  cells: z.array(DNACellSchema),
  /** Rollup of best + worst cells for quick rendering. */
  bestCell: DNACellSchema.nullable(),
  worstCell: DNACellSchema.nullable(),
  /** Tier snapshot at generation time (not authoritative — see Strategy). */
  tierAtGeneration: StrategyTierSchema,
  totalTrades: z.number().int().nonnegative(),
  generatedAt: z.string().datetime(),
});
export type StrategyDNA = z.infer<typeof StrategyDNASchema>;

export const StrategyDNAListOutSchema = z.object({
  dna: z.array(StrategyDNASchema),
  generatedAt: z.string().datetime(),
});
export type StrategyDNAListOut = z.infer<typeof StrategyDNAListOutSchema>;
