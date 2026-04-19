/**
 * Market primitives — symbols, bars, timeframes, quotes.
 *
 * These are the lowest-level market-data shapes. Structure / order block /
 * FVG / signal types live in `structure.ts` and `signals.ts` respectively
 * and compose over these.
 */
import { z } from "zod";

export const TimeframeSchema = z.enum([
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "1d",
  "1w",
]);
export type Timeframe = z.infer<typeof TimeframeSchema>;

export const AssetClassSchema = z.enum([
  "equity",
  "crypto",
  "forex",
  "futures",
  "index",
]);
export type AssetClass = z.infer<typeof AssetClassSchema>;

/** Full symbol descriptor — one row per tradable instrument. */
export const SymbolSchema = z.object({
  id: z.string().min(1),
  ticker: z.string().min(1),
  exchange: z.string().min(1),
  assetClass: AssetClassSchema,
  displayName: z.string().min(1),
  tickSize: z.number().positive(),
  lotSize: z.number().positive().default(1),
  quoteCurrency: z.string().length(3),
  sessionTz: z.string().default("America/New_York"),
  active: z.boolean().default(true),
  createdAt: z.string().datetime(),
});
export type Symbol = z.infer<typeof SymbolSchema>;

/** OHLCV bar. `t` is the bar open time in ISO-8601. */
export const BarSchema = z.object({
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  t: z.string().datetime(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  v: z.number().nonnegative(),
  // Optional flag — present for partially-formed bars from a live feed.
  closed: z.boolean().default(true),
});
export type Bar = z.infer<typeof BarSchema>;

export const BarSeriesSchema = z.object({
  symbolId: z.string().min(1),
  tf: TimeframeSchema,
  bars: z.array(BarSchema),
  source: z.enum(["alpaca", "tradingview", "replay", "synthetic"]),
  generatedAt: z.string().datetime(),
});
export type BarSeries = z.infer<typeof BarSeriesSchema>;

/** Lightweight real-time quote snapshot for nav chips + detail chart. */
export const QuoteSchema = z.object({
  symbolId: z.string().min(1),
  bid: z.number(),
  ask: z.number(),
  last: z.number(),
  bidSize: z.number().nonnegative(),
  askSize: z.number().nonnegative(),
  t: z.string().datetime(),
});
export type Quote = z.infer<typeof QuoteSchema>;

/** Bias direction — used by structure, order blocks, FVGs and signals. */
export const DirectionSchema = z.enum(["long", "short", "neutral"]);
export type Direction = z.infer<typeof DirectionSchema>;
