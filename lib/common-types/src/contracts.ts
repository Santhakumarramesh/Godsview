/**
 * GodsView Market Event Contracts
 *
 * Canonical types for all market data flowing through the system.
 * Every data pipeline, backtester, replay engine, and decision loop
 * MUST use these contracts — no ad-hoc bar/candle types.
 */
import { z } from "zod";

// ── Base Event ───────────────────────────────────────────────────────────────

export const BaseEventSchema = z.object({
  eventId: z.string(),
  symbol: z.string(),
  ts: z.string().datetime(),
  source: z.enum(["alpaca", "tiingo", "alphavantage", "finnhub", "tradingview", "bookmap", "synthetic", "replay"]),
});

export type BaseEvent = z.infer<typeof BaseEventSchema>;

// ── Candle / OHLCV Event ─────────────────────────────────────────────────────

export const CandleTimeframeSchema = z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]);
export type CandleTimeframe = z.infer<typeof CandleTimeframeSchema>;

export const CandleEventSchema = BaseEventSchema.extend({
  kind: z.literal("candle"),
  timeframe: CandleTimeframeSchema,
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

export type CandleEvent = z.infer<typeof CandleEventSchema>;

// ── Quote Event ──────────────────────────────────────────────────────────────

export const QuoteEventSchema = BaseEventSchema.extend({
  kind: z.literal("quote"),
  bid: z.number(),
  ask: z.number(),
  bidSize: z.number(),
  askSize: z.number(),
});

export type QuoteEvent = z.infer<typeof QuoteEventSchema>;

// ── Trade Print Event ────────────────────────────────────────────────────────

export const TradePrintEventSchema = BaseEventSchema.extend({
  kind: z.literal("trade"),
  price: z.number(),
  size: z.number(),
  side: z.enum(["buy", "sell", "unknown"]),
});

export type TradePrintEvent = z.infer<typeof TradePrintEventSchema>;

// ── Orderbook Snapshot ───────────────────────────────────────────────────────

export const OrderbookSnapshotSchema = BaseEventSchema.extend({
  kind: z.literal("orderbook"),
  bids: z.array(z.tuple([z.number(), z.number()])), // [price, size][]
  asks: z.array(z.tuple([z.number(), z.number()])),
});

export type OrderbookSnapshotEvent = z.infer<typeof OrderbookSnapshotSchema>;

// ── Context Event (macro, regime, etc.) ──────────────────────────────────────

export const ContextEventSchema = BaseEventSchema.extend({
  kind: z.literal("context"),
  regime: z.string().optional(),
  earningsProximityMinutes: z.number().nullable().optional(),
  macroRisk: z.number().nullable().optional(),
  volatilityState: z.enum(["low", "medium", "high"]).optional(),
});

export type ContextEvent = z.infer<typeof ContextEventSchema>;

// ── Union type ───────────────────────────────────────────────────────────────

export const MarketEventSchema = z.discriminatedUnion("kind", [
  CandleEventSchema,
  QuoteEventSchema,
  TradePrintEventSchema,
  OrderbookSnapshotSchema,
  ContextEventSchema,
]);

export type MarketEvent = z.infer<typeof MarketEventSchema>;

// ── Decision Contracts ───────────────────────────────────────────────────────

export const DecisionDirectionSchema = z.enum(["long", "short", "flat"]);
export type DecisionDirection = z.infer<typeof DecisionDirectionSchema>;

export const DecisionConfidenceSchema = z.object({
  structureScore: z.number().min(0).max(1),
  regimeScore: z.number().min(0).max(1),
  orderflowScore: z.number().min(0).max(1),
  memoryScore: z.number().min(0).max(1),
  stressPenalty: z.number().min(0).max(1),
  overallReadiness: z.number().min(0).max(1),
});

export type DecisionConfidence = z.infer<typeof DecisionConfidenceSchema>;

export const TradeDecisionSchema = z.object({
  symbol: z.string(),
  direction: DecisionDirectionSchema,
  confidence: DecisionConfidenceSchema,
  entry: z.number().optional(),
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
  positionSizePct: z.number().optional(),
  reasoning: z.string(),
  dataSource: z.enum(["real", "synthetic", "replay"]),
  timestamp: z.string().datetime(),
  approved: z.boolean(),
  rejectionReason: z.string().optional(),
});

export type TradeDecision = z.infer<typeof TradeDecisionSchema>;

// ── Structure State (market structure analysis output) ────────────────────────

export const StructureStateSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  bos: z.boolean(),
  choch: z.boolean(),
  activeOB: z.boolean(),
  activeFVG: z.boolean(),
  liquiditySweep: z.boolean(),
  structureScore: z.number().min(0).max(1),
});

export type StructureState = z.infer<typeof StructureStateSchema>;

// ── Regime State ─────────────────────────────────────────────────────────────

export const ContractRegimeSchema = z.enum([
  "trend_up", "trend_down", "range", "compression", "expansion", "chaotic",
]);

export const RegimeStateSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  regime: ContractRegimeSchema,
  trendStrength: z.number().min(0).max(1),
  volState: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
});

export type RegimeState = z.infer<typeof RegimeStateSchema>;

// ── Orderflow Candle Packet ──────────────────────────────────────────────────

export const CandleOrderflowPacketSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  delta: z.number(),
  cvd: z.number(),
  spreadAvg: z.number(),
  spreadMax: z.number(),
  topBid: z.number().nullable(),
  topAsk: z.number().nullable(),
  liquidityAbove: z.number(),
  liquidityBelow: z.number(),
  absorptionBid: z.boolean(),
  absorptionAsk: z.boolean(),
  sweepFlag: z.boolean(),
  imbalance: z.number(),
});

export type CandleOrderflowPacket = z.infer<typeof CandleOrderflowPacketSchema>;

// ── Symbol Brain State (per-symbol intelligence summary) ─────────────────────

export const SymbolBrainStateSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  structureScore: z.number(),
  regimeScore: z.number(),
  orderflowScore: z.number(),
  stressPenalty: z.number(),
  memoryScore: z.number(),
  readinessScore: z.number(),
});

export type SymbolBrainState = z.infer<typeof SymbolBrainStateSchema>;

// ── Live Mode Gate ───────────────────────────────────────────────────────────

export const LiveModeGateResultSchema = z.object({
  allowed: z.boolean(),
  reasons: z.array(z.string()),
});

export type LiveModeGateResult = z.infer<typeof LiveModeGateResultSchema>;

export function evaluateLiveModeGate(input: {
  syntheticDataDetected: boolean;
  fallbackReasoningDetected: boolean;
  replayValidated: boolean;
  killSwitchHealthy: boolean;
}): LiveModeGateResult {
  const reasons: string[] = [];
  if (input.syntheticDataDetected) reasons.push("synthetic data path active");
  if (input.fallbackReasoningDetected) reasons.push("heuristic reasoning fallback active");
  if (!input.replayValidated) reasons.push("strategy not replay-validated");
  if (!input.killSwitchHealthy) reasons.push("kill switch unhealthy");
  return { allowed: reasons.length === 0, reasons };
}

// ── Reasoning Mode (Claude fallback policy) ──────────────────────────────────

export type ReasoningMode = "strict_live" | "paper" | "demo";

export function allowHeuristicFallback(mode: ReasoningMode): boolean {
  return mode !== "strict_live";
}
