import { z } from "zod";

export const TimeframeSchema = z.enum(["tick", "1m", "5m", "15m", "1h", "4h", "1d"]);
export const BiasSchema = z.enum(["bullish", "bearish", "neutral", "bullish_pullback", "bearish_pullback"]);
export const TradeStateSchema = z.enum(["allow", "watch", "block"]);
export const DirectionSchema = z.enum(["long", "short", "none"]);
export const SessionSchema = z.enum(["premarket", "open", "midday", "power_hour", "after_hours", "closed"]);
export const RegimeSchema = z.enum(["risk_on", "risk_off", "neutral", "high_vol", "low_vol"]);

export const TickFeatureNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  lastPrice: z.number(),
  bid: z.number(),
  ask: z.number(),
  spread: z.number(),
  tickVelocity: z.number(),
  aggressionScore: z.number(),
  burstProbability: z.number(),
  reversalProbability: z.number(),
  quoteImbalance: z.number(),
  microVolatility: z.number(),
});
export type TickFeatureNode = z.infer<typeof TickFeatureNodeSchema>;

export const TimeframeNodeSchema = z.object({
  symbol: z.string(),
  timeframe: TimeframeSchema,
  ts: z.string(),
  bias: BiasSchema,
  confidence: z.number(),
  trendStrength: z.number(),
  momentumScore: z.number(),
  structureScore: z.number(),
  volatilityScore: z.number(),
  invalidationLevel: z.number().nullable(),
  activeZone: z.string().nullable(),
  activeSetup: z.string().nullable(),
});
export type TimeframeNode = z.infer<typeof TimeframeNodeSchema>;

export const StructureNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  htfBias: BiasSchema,
  itfBias: BiasSchema,
  ltfBias: BiasSchema,
  bosCount: z.number().int(),
  chochDetected: z.boolean(),
  liquiditySweepDetected: z.boolean(),
  sweepSide: z.enum(["buy_side", "sell_side", "none"]),
  orderBlockType: z.enum(["bullish", "bearish", "none"]),
  orderBlockTimeframe: TimeframeSchema.nullable(),
  fairValueGapDetected: z.boolean(),
  premiumDiscountState: z.enum(["premium", "discount", "equilibrium"]),
  structureScore: z.number(),
  setupFamily: z.enum([
    "sweep_reclaim",
    "bos_retest",
    "ob_reaction",
    "fvg_fill",
    "breakout_continuation",
    "mean_reversion",
    "none",
  ]),
});
export type StructureNode = z.infer<typeof StructureNodeSchema>;

export const OrderflowNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  deltaScore: z.number(),
  cvdSlope: z.number(),
  cvdTrend: z.enum(["up", "down", "flat"]),
  aggressionBuyScore: z.number(),
  aggressionSellScore: z.number(),
  imbalanceScore: z.number(),
  absorptionScore: z.number(),
  exhaustionScore: z.number(),
  orderflowScore: z.number(),
  supportiveDirection: DirectionSchema,
});
export type OrderflowNode = z.infer<typeof OrderflowNodeSchema>;

export const ContextNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  session: SessionSchema,
  marketRegime: RegimeSchema,
  sectorStrength: z.number(),
  indexAlignmentScore: z.number(),
  earningsProximityMinutes: z.number().nullable(),
  macroPressure: z.enum(["supportive", "headwind", "neutral"]),
  newsHeatScore: z.number(),
  newsSentimentScore: z.number(),
  contextScore: z.number(),
});
export type ContextNode = z.infer<typeof ContextNodeSchema>;

export const MemoryNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  closestSetupCluster: z.string().nullable(),
  similarityScore: z.number(),
  historicalWinRate: z.number().nullable(),
  historicalProfitFactor: z.number().nullable(),
  avgMAE: z.number().nullable(),
  avgMFE: z.number().nullable(),
  sampleSize: z.number().int(),
  personalityTag: z.enum([
    "trendy",
    "mean_reverting",
    "news_sensitive",
    "open_volatile",
    "midday_noisy",
    "breakout_clean",
    "fakeout_prone",
    "unknown",
  ]),
  memoryScore: z.number(),
});
export type MemoryNode = z.infer<typeof MemoryNodeSchema>;

export const RiskNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  tradeAllowed: z.boolean(),
  blockReasons: z.array(z.string()),
  sizingMultiplier: z.number(),
  maxRiskDollars: z.number(),
  stopDistance: z.number().nullable(),
  targetDistance: z.number().nullable(),
  slippageRiskScore: z.number(),
  exposureRiskScore: z.number(),
  drawdownGuardActive: z.boolean(),
  riskScore: z.number(),
});
export type RiskNode = z.infer<typeof RiskNodeSchema>;

export const ReasoningNodeSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  verdict: z.enum(["strong_long", "watch_long", "strong_short", "watch_short", "wait", "block"]),
  confidence: z.number(),
  thesis: z.string(),
  contradictions: z.array(z.string()),
  triggerConditions: z.array(z.string()),
  blockConditions: z.array(z.string()),
  recommendedDirection: DirectionSchema,
  recommendedEntryType: z.enum(["breakout", "retest", "limit", "market", "none"]),
  reasoningScore: z.number(),
});
export type ReasoningNode = z.infer<typeof ReasoningNodeSchema>;

export const SignalDecisionSchema = z.object({
  signalId: z.string(),
  symbol: z.string(),
  ts: z.string(),
  direction: DirectionSchema,
  state: TradeStateSchema,
  setupFamily: z.string().nullable(),
  timeframe: TimeframeSchema,
  entryPrice: z.number().nullable(),
  stopPrice: z.number().nullable(),
  targetPrice: z.number().nullable(),
  confidence: z.number(),
  attentionScore: z.number(),
  layerScores: z.object({
    structure: z.number(),
    orderflow: z.number(),
    context: z.number(),
    memory: z.number(),
    reasoning: z.number(),
    risk: z.number(),
  }),
  explanation: z.string(),
  tags: z.array(z.string()),
});
export type SignalDecision = z.infer<typeof SignalDecisionSchema>;

export const TimeframeMapSchema = z.object({
  tick: TimeframeNodeSchema.optional(),
  "1m": TimeframeNodeSchema.optional(),
  "5m": TimeframeNodeSchema.optional(),
  "15m": TimeframeNodeSchema.optional(),
  "1h": TimeframeNodeSchema.optional(),
  "4h": TimeframeNodeSchema.optional(),
  "1d": TimeframeNodeSchema.optional(),
});

export const StockBrainStateSchema = z.object({
  symbol: z.string(),
  ts: z.string(),
  session: SessionSchema,
  timeframes: TimeframeMapSchema,
  tick: TickFeatureNodeSchema.nullable(),
  structure: StructureNodeSchema,
  orderflow: OrderflowNodeSchema,
  context: ContextNodeSchema,
  memory: MemoryNodeSchema,
  reasoning: ReasoningNodeSchema.nullable(),
  risk: RiskNodeSchema,
  finalDecision: SignalDecisionSchema.nullable(),
});
export type StockBrainState = z.infer<typeof StockBrainStateSchema>;

