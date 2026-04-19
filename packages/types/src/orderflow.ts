/**
 * Order-flow primitives — depth snapshots, delta, imbalance, absorption,
 * exhaustion, liquidity walls, volume clusters.
 *
 * These types describe the *book-level* and *tape-level* view of a
 * symbol that sits alongside the bar-series market view in `market.ts`.
 * They feed the Phase 3 detectors (`app.detectors.orderflow`) and the
 * setup library (`app.detectors.setups`).
 *
 * Wire-shape notes:
 *   * All timestamps are ISO-8601 UTC strings so JSON round-trips cleanly.
 *   * All price / size values are `number` (doubles). For futures tick
 *     sizes below 1e-8 a separate fixed-point envelope will be layered
 *     on top in Phase 9+; the current precision is sufficient for
 *     equities + crypto + FX majors.
 *   * Each detector event carries a deterministic `id` so downstream
 *     systems (recall, execution gate, audit) can reference it without
 *     re-hashing the payload.
 */
import { z } from "zod";
import { DirectionSchema, TimeframeSchema } from "./market.js";

// ───────────────────────────── depth snapshot ───────────────────────────

/** One side of the order book at a point in time. Ordered best→worst. */
export const DepthLevelSchema = z.object({
  price: z.number(),
  size: z.number().nonnegative(),
  /** Optional order count if the feed exposes it. */
  orders: z.number().int().nonnegative().optional(),
});
export type DepthLevel = z.infer<typeof DepthLevelSchema>;

export const DepthSnapshotSchema = z.object({
  symbolId: z.string().min(1),
  t: z.string().datetime(),
  /** Bids ordered best (highest) → worst. */
  bids: z.array(DepthLevelSchema),
  /** Asks ordered best (lowest) → worst. */
  asks: z.array(DepthLevelSchema),
  /** Cumulative traded size between this and the previous snapshot. */
  delta: z.number(),
  /** Last-printed trade price at snapshot time. */
  last: z.number(),
  source: z
    .enum(["bookmap", "databento", "alpaca", "replay", "synthetic"])
    .default("synthetic"),
});
export type DepthSnapshot = z.infer<typeof DepthSnapshotSchema>;

// ─────────────────────────── aggregated delta bar ───────────────────────

/** Bucketed order-flow for a single bar — buy vs sell pressure. */
export const DeltaBarSchema = z.object({
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  t: z.string().datetime(),
  buyVolume: z.number().nonnegative(),
  sellVolume: z.number().nonnegative(),
  /** `buyVolume - sellVolume`. */
  delta: z.number(),
  /** Cumulative delta from the session open. */
  cumulativeDelta: z.number(),
});
export type DeltaBar = z.infer<typeof DeltaBarSchema>;

// ─────────────────────────── event classifications ──────────────────────

export const ImbalanceSideSchema = z.enum(["buy", "sell"]);
export type ImbalanceSide = z.infer<typeof ImbalanceSideSchema>;

export const ImbalanceStrengthSchema = z.enum(["weak", "medium", "strong"]);
export type ImbalanceStrength = z.infer<typeof ImbalanceStrengthSchema>;

export const ImbalanceEventSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  t: z.string().datetime(),
  side: ImbalanceSideSchema,
  /** Ratio of aggressor size to passive size on the imbalanced side. */
  ratio: z.number().positive(),
  strength: ImbalanceStrengthSchema,
  /** Raw buy/sell volumes that produced this classification. */
  buyVolume: z.number().nonnegative(),
  sellVolume: z.number().nonnegative(),
});
export type ImbalanceEvent = z.infer<typeof ImbalanceEventSchema>;

/**
 * Absorption — aggressive market orders eaten by resting liquidity
 * without moving price. High absorption on the bid → bullish
 * continuation signal; high absorption on the ask → bearish.
 */
export const AbsorptionEventSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  t: z.string().datetime(),
  side: ImbalanceSideSchema,
  /** Price at which absorption occurred. */
  price: z.number(),
  /** Aggregate aggressor size absorbed. */
  absorbedSize: z.number().positive(),
  /** Max price movement during absorption window (tick units). */
  priceMovementTicks: z.number().nonnegative(),
  confidence: z.number().min(0).max(1),
});
export type AbsorptionEvent = z.infer<typeof AbsorptionEventSchema>;

/**
 * Exhaustion — the flip side of absorption. Aggressive flow fails to
 * produce follow-through and momentum stalls.
 */
export const ExhaustionEventSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  t: z.string().datetime(),
  side: ImbalanceSideSchema,
  price: z.number(),
  /** Delta in the failed-push window. */
  delta: z.number(),
  /** Follow-through price movement in ticks — near-zero implies exhaustion. */
  followThroughTicks: z.number(),
  confidence: z.number().min(0).max(1),
});
export type ExhaustionEvent = z.infer<typeof ExhaustionEventSchema>;

// ─────────────────────────── book structures ────────────────────────────

/** A resting passive order large enough to matter for setup logic. */
export const LiquidityWallSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  t: z.string().datetime(),
  side: ImbalanceSideSchema,
  price: z.number(),
  size: z.number().positive(),
  /** Multiple of median book size at the same tick depth. */
  sizeMultiple: z.number().positive(),
  /** Distance from mid in ticks. */
  distanceFromMidTicks: z.number().nonnegative(),
});
export type LiquidityWall = z.infer<typeof LiquidityWallSchema>;

/**
 * Volume cluster — a price band where a disproportionate amount of
 * traded volume has accumulated over a lookback window. Analogous to
 * a volume profile "high-volume node".
 */
export const VolumeClusterSchema = z.object({
  id: z.string().min(1),
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  priceLow: z.number(),
  priceHigh: z.number(),
  volume: z.number().nonnegative(),
  /** Ratio of cluster volume to mean bucket volume in the window. */
  volumeMultiple: z.number().positive(),
});
export type VolumeCluster = z.infer<typeof VolumeClusterSchema>;

// ─────────────────────────── ingest envelope ────────────────────────────

/**
 * Wire envelope for the `/v1/orderflow/ingest` admin endpoint. A single
 * payload can carry a depth snapshot, a rolled-up delta bar, or both.
 */
export const OrderFlowIngestSchema = z.object({
  snapshot: DepthSnapshotSchema.optional(),
  deltaBar: DeltaBarSchema.optional(),
});
export type OrderFlowIngest = z.infer<typeof OrderFlowIngestSchema>;

// ─────────────────────────── derived pipe shape ─────────────────────────

/**
 * The aggregated order-flow view consumed by the setup library. All
 * detector outputs keyed off a symbol roll up into this struct.
 */
export const OrderFlowStateSchema = z.object({
  symbolId: z.string().min(1),
  asOf: z.string().datetime(),
  lastDelta: z.number(),
  cumulativeDelta: z.number(),
  activeImbalance: ImbalanceEventSchema.nullable(),
  recentAbsorption: z.array(AbsorptionEventSchema),
  recentExhaustion: z.array(ExhaustionEventSchema),
  walls: z.array(LiquidityWallSchema),
  clusters: z.array(VolumeClusterSchema),
  /** Net bias derived from the above — consumed by the setup scorer. */
  netBias: DirectionSchema,
});
export type OrderFlowState = z.infer<typeof OrderFlowStateSchema>;
