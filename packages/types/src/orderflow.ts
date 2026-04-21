import { z } from "zod";

export const OrderFlowSnapshotSchema = z.object({
  symbol: z.string(),
  timestamp: z.string().datetime(),
  delta: z.number(),
  cumDelta: z.number(),
  buyVolume: z.number(),
  sellVolume: z.number(),
  imbalanceRatio: z.number(),
  absorptionScore: z.number().min(0).max(1),
  pressureBias: z.enum(["buy", "sell", "neutral"]),
});
export type OrderFlowSnapshot = z.infer<typeof OrderFlowSnapshotSchema>;

export const HeatmapLevelSchema = z.object({
  price: z.number(),
  bidSize: z.number(),
  askSize: z.number(),
  intensity: z.number().min(0).max(1),
  isWall: z.boolean(),
});
export type HeatmapLevel = z.infer<typeof HeatmapLevelSchema>;

export const FootprintBarSchema = z.object({
  timestamp: z.string().datetime(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  delta: z.number(),
  volumeAtPrice: z.record(z.string(), z.object({ bid: z.number(), ask: z.number() })),
});
export type FootprintBar = z.infer<typeof FootprintBarSchema>;

export const FlowConfluenceSchema = z.object({
  symbol: z.string(),
  structureSignal: z.string(),
  flowSignal: z.string(),
  confluenceScore: z.number().min(0).max(1),
  recommendation: z.enum(["strong_entry", "moderate_entry", "wait", "avoid"]),
  timestamp: z.string().datetime(),
});
export type FlowConfluence = z.infer<typeof FlowConfluenceSchema>;
