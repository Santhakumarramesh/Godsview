/**
 * Price feed for execution-time gates (slippage, kill-switch checks).
 *
 * Tries `alpaca.getLatestTrade(symbol)` first. If the broker call fails or
 * returns nothing, returns null so the caller can decide:
 *   - If a fallback price is available (e.g., `proposal.entry`), use it but
 *     log that the feed was unreachable so the slippage gate becomes a no-op
 *     for that single execution.
 *   - In live trading mode, missing price MUST hard-block the trade. Today
 *     this is paper-only so we degrade gracefully.
 *
 * Cached for 1s to avoid hammering the broker for repeated checks.
 */

import { systemMetrics } from "../system_metrics";

type CacheEntry = { price: number; ts: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000;

export type PriceQuote = { symbol: string; price: number; source: "alpaca" | "cache" | "fallback" | "none"; ts: number };

export async function getCurrentPrice(
  symbol: string,
  fallback?: number
): Promise<PriceQuote | null> {
  const upper = symbol.toUpperCase();

  // 1. Cache
  const cached = cache.get(upper);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { symbol: upper, price: cached.price, source: "cache", ts: cached.ts };
  }

  // 2. Live broker
  try {
    const mod = await import("../alpaca");
    const fn: any = (mod as any).getLatestTrade;
    if (typeof fn === "function") {
      const trade = await fn(upper);
      if (trade && typeof trade.price === "number" && trade.price > 0) {
        cache.set(upper, { price: trade.price, ts: Date.now() });
        systemMetrics.log("info", "price_feed.alpaca_hit", { symbol: upper, price: trade.price });
        return { symbol: upper, price: trade.price, source: "alpaca", ts: Date.now() };
      }
    }
  } catch (err: any) {
    systemMetrics.log("warn", "price_feed.alpaca_error", { symbol: upper, error: err?.message ?? String(err) });
  }

  // 3. Fallback (caller-supplied)
  if (typeof fallback === "number" && fallback > 0) {
    systemMetrics.log("warn", "price_feed.fallback_used", { symbol: upper, fallback });
    return { symbol: upper, price: fallback, source: "fallback", ts: Date.now() };
  }

  systemMetrics.log("error", "price_feed.unavailable", { symbol: upper });
  return null;
}
