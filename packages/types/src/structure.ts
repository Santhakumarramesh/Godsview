import { z } from "zod";

export const OrderBlockSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  type: z.enum(["bullish", "bearish"]),
  priceHigh: z.number(),
  priceLow: z.number(),
  fresh: z.boolean(),
  mitigated: z.boolean(),
  strength: z.number().min(0).max(1),
  timestamp: z.string().datetime(),
});
export type OrderBlock = z.infer<typeof OrderBlockSchema>;

export const StructureBreakSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  type: z.enum(["BOS", "CHOCH"]),
  direction: z.enum(["bullish", "bearish"]),
  price: z.number(),
  confirmed: z.boolean(),
  timestamp: z.string().datetime(),
});
export type StructureBreak = z.infer<typeof StructureBreakSchema>;

export const LiquiditySweepSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  type: z.enum(["buy_side", "sell_side"]),
  sweptLevel: z.number(),
  recapture: z.boolean(),
  timestamp: z.string().datetime(),
});
export type LiquiditySweep = z.infer<typeof LiquiditySweepSchema>;

export const TradePlanSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  direction: z.enum(["long", "short"]),
  entry: z.number(),
  stop: z.number(),
  targets: z.array(z.number()),
  riskReward: z.number(),
  confluenceFactors: z.array(z.string()),
  status: z.enum(["draft", "active", "executed", "cancelled"]),
  createdAt: z.string().datetime(),
});
export type TradePlan = z.infer<typeof TradePlanSchema>;
