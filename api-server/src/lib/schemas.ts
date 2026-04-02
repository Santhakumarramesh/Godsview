import { z } from "zod";

/**
 * ── Market Data Schemas ──────────────────────────────────────────────────────
 */

export const SMCBarSchema = z.object({
  Timestamp: z.string(),
  Open: z.number(),
  High: z.number(),
  Low: z.number(),
  Close: z.number(),
  Volume: z.number(),
});

/**
 * ── SMC Sub-Schemas ──────────────────────────────────────────────────────────
 */

export const SwingPointSchema = z.object({
  index: z.number(),
  ts: z.string(),
  price: z.number(),
  kind: z.enum(["high", "low"]),
});

export const StructureStateSchema = z.object({
  trend: z.enum(["bullish", "bearish", "range"]),
  trendReturn20: z.number(),
  bos: z.boolean(),
  choch: z.boolean(),
  bosDirection: z.enum(["bullish", "bearish", "none"]),
  swingHighs: z.array(SwingPointSchema),
  swingLows: z.array(SwingPointSchema),
  invalidation: z.number().nullable(),
  structureScore: z.number().min(0).max(1),
  pattern: z.enum(["HH_HL", "LH_LL", "mixed", "insufficient"]),
});

export const OrderBlockSchema = z.object({
  index: z.number(),
  ts: z.string(),
  side: z.enum(["bullish", "bearish"]),
  low: z.number(),
  high: z.number(),
  mid: z.number(),
  strength: z.number(),
  tested: z.boolean(),
  broken: z.boolean(),
});

export const FairValueGapSchema = z.object({
  index: z.number(),
  ts: z.string(),
  side: z.enum(["bullish", "bearish"]),
  low: z.number(),
  high: z.number(),
  sizePct: z.number(),
  filled: z.boolean(),
  fillPct: z.number(),
});

export const DisplacementEventSchema = z.object({
  startIndex: z.number(),
  endIndex: z.number(),
  direction: z.enum(["up", "down"]),
  magnitude: z.number(),
  magnitudePct: z.number(),
  barCount: z.number(),
  rangeMultiple: z.number(),
});

export const LiquidityPoolSchema = z.object({
  price: z.number(),
  kind: z.enum(["equal_highs", "equal_lows"]),
  touches: z.number(),
  firstIndex: z.number(),
  lastIndex: z.number(),
  swept: z.boolean(),
});

/**
 * ── Intelligence Engine Schemas ──────────────────────────────────────────────
 */

export const SMCSchema = z.object({
  symbol: z.string(),
  structure: StructureStateSchema,
  activeOBs: z.array(OrderBlockSchema),
  unfilledFVGs: z.array(FairValueGapSchema),
  liquidityPools: z.array(LiquidityPoolSchema),
  confluenceScore: z.number().min(0).max(1),
  computedAt: z.string(),
});

export type SMCState = z.infer<typeof SMCSchema>;

export const OrderflowSchema = z.object({
  delta: z.number(),
  cvd: z.number(),
  cvdSlope: z.number(),
  quoteImbalance: z.number(),
  spreadBps: z.number(),
  aggressionScore: z.number().min(0).max(1),
  orderflowBias: z.enum(["bullish", "bearish", "neutral"]),
  orderflowScore: z.number().min(0).max(1),
  buyVolumeRatio: z.number(),
  largeDeltaBar: z.boolean(),
  divergence: z.boolean(),
});

export type OrderflowState = z.infer<typeof OrderflowSchema>;

/**
 * ── Brain & SI Decision Schemas ──────────────────────────────────────────────
 */

export const BrainStateSchema = z.object({
  symbol: z.string(),
  readinessScore: z.number().min(0).max(100),
  attentionScore: z.number().min(0).max(100),
  regime: z.string(),
  reasoning: z.string().optional(),
  lastUpdated: z.string(),
});

export type BrainState = z.infer<typeof BrainStateSchema>;

export const DecisionContractSchema = z.object({
  signalId: z.number(),
  symbol: z.string(),
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
  quality: z.number().min(0).max(1),
  winProbability: z.number().min(0).max(1),
  kellyFraction: z.number().min(0).max(1),
  suggestedQty: z.number().nonnegative(),
  reasonSource: z.enum(["claude", "heuristic", "ml"]),
});

export type DecisionContract = z.infer<typeof DecisionContractSchema>;
