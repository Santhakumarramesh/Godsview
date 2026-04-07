/**
 * Normalized Schema — Standardized market data types across providers.
 * Stub implementation for build compatibility.
 */
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────

export const DataSource = { ALPACA: "alpaca" as const, TIINGO: "tiingo" as const, POLYGON: "polygon" as const, UNKNOWN: "unknown" as const };
export type DataSource = (typeof DataSource)[keyof typeof DataSource];

export interface NormalizedBar {
  symbol: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
  source: DataSource;
  timeframe: string;
}

export interface NormalizedQuote {
  symbol: string;
  timestamp: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  source: DataSource;
}

export interface NormalizedTrade {
  symbol: string;
  timestamp: number;
  price: number;
  size: number;
  source: DataSource;
}

export type ValidatedBar = NormalizedBar & { _validated: true };
export type ValidatedQuote = NormalizedQuote & { _validated: true };
export type ValidatedTrade = NormalizedTrade & { _validated: true };

// ── Zod Schemas ────────────────────────────────────────────────────────

export const NormalizedBarSchema = z.object({
  symbol: z.string(),
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  vwap: z.number().optional(),
  source: z.enum(["alpaca", "tiingo", "polygon", "unknown"]),
  timeframe: z.string(),
});

export const NormalizedQuoteSchema = z.object({
  symbol: z.string(),
  timestamp: z.number(),
  bid: z.number(),
  ask: z.number(),
  bidSize: z.number(),
  askSize: z.number(),
  source: z.enum(["alpaca", "tiingo", "polygon", "unknown"]),
});

export const NormalizedTradeSchema = z.object({
  symbol: z.string(),
  timestamp: z.number(),
  price: z.number(),
  size: z.number(),
  source: z.enum(["alpaca", "tiingo", "polygon", "unknown"]),
});

// ── Validation Functions ───────────────────────────────────────────────

export function validateBar(bar: unknown): ValidatedBar {
  const parsed = NormalizedBarSchema.parse(bar);
  return { ...parsed, _validated: true } as ValidatedBar;
}

export function validateQuote(quote: unknown): ValidatedQuote {
  const parsed = NormalizedQuoteSchema.parse(quote);
  return { ...parsed, _validated: true } as ValidatedQuote;
}

export function validateTrade(trade: unknown): ValidatedTrade {
  const parsed = NormalizedTradeSchema.parse(trade);
  return { ...parsed, _validated: true } as ValidatedTrade;
}

export function isValidBar(bar: unknown): bar is NormalizedBar {
  return NormalizedBarSchema.safeParse(bar).success;
}

export function isValidQuote(quote: unknown): quote is NormalizedQuote {
  return NormalizedQuoteSchema.safeParse(quote).success;
}

export function isValidTrade(trade: unknown): trade is NormalizedTrade {
  return NormalizedTradeSchema.safeParse(trade).success;
}
