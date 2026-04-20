/**
 * Recall + Memory primitives — Phase 5 surface.
 *
 * The Recall Engine gives GodsView trader-like memory. Every setup +
 * trade + chart screenshot becomes a row in the recall store, indexed
 * by a deterministic feature vector. Similarity search powers:
 *
 *   * "Setups like this have historically won X%" (SetupRecallMatch lives
 *     in ./setups.ts; this module is the superset + admin view).
 *   * "What did we miss?" — setups that fit the active strategy DNA but
 *     were filtered out or skipped.
 *   * Chart-annotated memory for operator review.
 *
 * Similarity is a deterministic dot-product on a fixed 64-dim feature
 * envelope (see RecallFeatureVectorSchema below). No external LLM.
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 *   * Vectors are `number[]` over the wire for portability; the backend
 *     packs them into a pgvector column for ANN search.
 */
import { z } from "zod";
import { DirectionSchema, TimeframeSchema } from "./market.js";
import { SetupTypeSchema } from "./setups.js";

// ──────────────────────────── feature envelope ──────────────────────────

/**
 * Canonical 64-dim feature vector. Deterministic across backend + tests.
 * The exact packing order is frozen in
 * services/control_plane/app/recall/features.py.
 */
export const RECALL_FEATURE_DIMS = 64;

export const RecallFeatureVectorSchema = z
  .array(z.number())
  .length(RECALL_FEATURE_DIMS);
export type RecallFeatureVector = z.infer<typeof RecallFeatureVectorSchema>;

/**
 * Structured projection of the feature vector so UIs can render the
 * inputs that drove a match. Always matches the packed vector bit-for-bit.
 */
export const RecallFeaturesSchema = z.object({
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  direction: DirectionSchema,
  setupType: SetupTypeSchema,
  /** Trend state at detection: 1 bullish, 0 neutral, -1 bearish. */
  trendSign: z.number().int().min(-1).max(1),
  /** 1 if BOS just fired within the setup's bar, 0 otherwise. */
  bosFlag: z.number().int().min(0).max(1),
  /** 1 if CHOCH just fired within the setup's bar. */
  chochFlag: z.number().int().min(0).max(1),
  /** 1 if there was a liquidity sweep immediately prior. */
  sweepFlag: z.number().int().min(0).max(1),
  /** Normalised volatility bucket (0..1). */
  volatilityBucket: z.number().min(0).max(1),
  /** Session of the day: 0 asia, 1 london, 2 ny_am, 3 ny_pm, 4 off-hours. */
  session: z.number().int().min(0).max(4),
  /** Order-flow posture encoded: -1 sell, 0 balanced, 1 buy. */
  orderFlowSign: z.number().int().min(-1).max(1),
  /** Composite regime bucket (see RegimeKind in ./learning.ts). */
  regimeBucket: z.number().int().min(0).max(3),
  /** Signed confidence (0..1) delivered by the detector. */
  confidenceAtDetection: z.number().min(0).max(1),
});
export type RecallFeatures = z.infer<typeof RecallFeaturesSchema>;

// ──────────────────────────── recall rows ───────────────────────────────

export const RecallOutcomeSchema = z.enum(["win", "loss", "scratch", "open"]);
export type RecallOutcome = z.infer<typeof RecallOutcomeSchema>;

/**
 * A single row in the recall-trade memory. One per setup that reached at
 * least approved_paper. Holds features + frozen outcome.
 */
export const RecallTradeSchema = z.object({
  id: z.string().min(1),
  setupId: z.string().min(1),
  /** Optional back-link to the paper OR live trade that realised outcome. */
  paperTradeId: z.string().nullable(),
  liveTradeId: z.string().nullable(),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  setupType: SetupTypeSchema,
  direction: DirectionSchema,
  detectedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  features: RecallFeaturesSchema,
  /** Dense embedding packing of `features`. */
  vector: RecallFeatureVectorSchema,
  outcome: RecallOutcomeSchema,
  /** Realised R (null while open). */
  pnlR: z.number().nullable(),
  /** Short rationale (copied from setup at close). */
  reasoning: z.string().max(2000).default(""),
});
export type RecallTrade = z.infer<typeof RecallTradeSchema>;

/** A chart screenshot annotated and pinned to a setup / trade. */
export const RecallScreenshotSchema = z.object({
  id: z.string().min(1),
  setupId: z.string().nullable(),
  liveTradeId: z.string().nullable(),
  paperTradeId: z.string().nullable(),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  /** Content-addressable storage key (S3 object key or filesystem hash). */
  storageKey: z.string().min(1),
  /** Presigned fetch URL; rotated; not persisted. */
  url: z.string().url().nullable(),
  mimeType: z.string().default("image/png"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  /** Free-form annotations rendered over the chart. */
  annotations: z
    .array(
      z.object({
        kind: z.enum(["arrow", "note", "zone", "level"]),
        text: z.string().max(500).default(""),
        /** 0..1 normalised bbox. */
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        w: z.number().min(0).max(1).default(0),
        h: z.number().min(0).max(1).default(0),
      }),
    )
    .default([]),
  capturedAt: z.string().datetime(),
  capturedByUserId: z.string().min(1),
});
export type RecallScreenshot = z.infer<typeof RecallScreenshotSchema>;

/**
 * A "missed trade" — a setup the system detected but that we did not
 * action (filtered by gate, below confidence, manually skipped). Used
 * by the learning agent to flag systematic gaps.
 */
export const MissedTradeReasonSchema = z.enum([
  "below_confidence",
  "gate_rejected",
  "risk_capped",
  "operator_skipped",
  "data_quality",
  "duplicate",
  "expired",
  "other",
]);
export type MissedTradeReason = z.infer<typeof MissedTradeReasonSchema>;

export const MissedTradeSchema = z.object({
  id: z.string().min(1),
  setupId: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  setupType: SetupTypeSchema,
  direction: DirectionSchema,
  reason: MissedTradeReasonSchema,
  reasonDetail: z.string().max(2000).default(""),
  detectedAt: z.string().datetime(),
  /** What R would have been had we entered. Recomputed periodically. */
  hypotheticalR: z.number().nullable(),
  /** Closed window on the hypothetical — after this, hypotheticalR freezes. */
  evaluatedThrough: z.string().datetime().nullable(),
  features: RecallFeaturesSchema,
});
export type MissedTrade = z.infer<typeof MissedTradeSchema>;

// ──────────────────────────── similarity search ─────────────────────────

/**
 * A single neighbour returned by a similarity search. Richer than
 * SetupRecallMatch (see ./setups.ts) — used on the Recall page itself.
 */
export const RecallMatchSchema = z.object({
  recallTradeId: z.string().min(1),
  setupId: z.string().min(1),
  /** 0..1 cosine similarity. */
  similarity: z.number().min(0).max(1),
  outcome: RecallOutcomeSchema,
  pnlR: z.number().nullable(),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  setupType: SetupTypeSchema,
  direction: DirectionSchema,
  detectedAt: z.string().datetime(),
});
export type RecallMatch = z.infer<typeof RecallMatchSchema>;

export const RecallSearchByIdSchema = z.object({
  kind: z.literal("by_setup"),
  setupId: z.string().min(1),
  k: z.number().int().min(1).max(100).default(20),
  minSimilarity: z.number().min(0).max(1).default(0.3),
});

export const RecallSearchByTradeSchema = z.object({
  kind: z.literal("by_live_trade"),
  liveTradeId: z.string().min(1),
  k: z.number().int().min(1).max(100).default(20),
  minSimilarity: z.number().min(0).max(1).default(0.3),
});

export const RecallSearchByFeaturesSchema = z.object({
  kind: z.literal("by_features"),
  features: RecallFeaturesSchema,
  k: z.number().int().min(1).max(100).default(20),
  minSimilarity: z.number().min(0).max(1).default(0.3),
});

export const RecallSearchRequestSchema = z.discriminatedUnion("kind", [
  RecallSearchByIdSchema,
  RecallSearchByTradeSchema,
  RecallSearchByFeaturesSchema,
]);
export type RecallSearchRequest = z.infer<typeof RecallSearchRequestSchema>;

export const RecallSearchResultSchema = z.object({
  matches: z.array(RecallMatchSchema),
  /** Aggregate stats across the returned matches. */
  summary: z.object({
    count: z.number().int().nonnegative(),
    winRate: z.number().min(0).max(1).nullable(),
    meanPnlR: z.number().nullable(),
    bestOutcome: RecallOutcomeSchema.nullable(),
    worstOutcome: RecallOutcomeSchema.nullable(),
  }),
  generatedAt: z.string().datetime(),
});
export type RecallSearchResult = z.infer<typeof RecallSearchResultSchema>;

// ──────────────────────────── list + filter envelopes ──────────────────

export const RecallTradeFilterSchema = z.object({
  symbolId: z.string().optional(),
  setupType: SetupTypeSchema.optional(),
  direction: DirectionSchema.optional(),
  outcome: RecallOutcomeSchema.optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(200).default(50),
});
export type RecallTradeFilter = z.infer<typeof RecallTradeFilterSchema>;

export const RecallTradesListOutSchema = z.object({
  trades: z.array(RecallTradeSchema),
  total: z.number().int().nonnegative(),
});
export type RecallTradesListOut = z.infer<typeof RecallTradesListOutSchema>;

export const RecallScreenshotsListOutSchema = z.object({
  screenshots: z.array(RecallScreenshotSchema),
  total: z.number().int().nonnegative(),
});
export type RecallScreenshotsListOut = z.infer<
  typeof RecallScreenshotsListOutSchema
>;

export const MissedTradesListOutSchema = z.object({
  trades: z.array(MissedTradeSchema),
  total: z.number().int().nonnegative(),
  /** Aggregate hypothetical R over the window. */
  windowMeanR: z.number().nullable(),
});
export type MissedTradesListOut = z.infer<typeof MissedTradesListOutSchema>;

export const ScreenshotCreateRequestSchema = z.object({
  setupId: z.string().min(1).optional(),
  liveTradeId: z.string().min(1).optional(),
  paperTradeId: z.string().min(1).optional(),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  storageKey: z.string().min(1),
  mimeType: z.string().default("image/png"),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  annotations: RecallScreenshotSchema.shape.annotations.optional(),
});
export type ScreenshotCreateRequest = z.infer<typeof ScreenshotCreateRequestSchema>;
