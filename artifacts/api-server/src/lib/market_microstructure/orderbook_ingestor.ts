import type { OrderBookSnapshot } from "../market/types";
import { orderBookManager } from "../market/orderbook";
import { isCryptoSymbol, normalizeMarketSymbol } from "../market/symbols";

export interface IngestOrderbookOptions {
  max_snapshot_age_ms?: number;
  force_fresh?: boolean;
}

export function normalizeMicrostructureSymbol(rawSymbol: string): string {
  const normalized = normalizeMarketSymbol(rawSymbol, "BTCUSD");
  return normalized.toUpperCase();
}

export function validateMicrostructureSymbol(rawSymbol: string): string {
  const symbol = normalizeMicrostructureSymbol(rawSymbol);
  if (!isCryptoSymbol(symbol)) {
    throw new Error(`unsupported_symbol:${symbol}:microstructure currently supports crypto symbols`);
  }
  return symbol;
}

export async function ingestOrderbookSnapshot(
  rawSymbol: string,
  options: IngestOrderbookOptions = {},
): Promise<OrderBookSnapshot> {
  const symbol = validateMicrostructureSymbol(rawSymbol);
  const maxAgeMs = Math.max(500, Math.min(60_000, options.max_snapshot_age_ms ?? 7_500));
  const forceFresh = options.force_fresh === true;

  const cached = orderBookManager.getSnapshot(symbol);
  const isCachedFresh = cached && Date.now() - cached.receivedAt <= maxAgeMs;

  if (!forceFresh && isCachedFresh && cached) {
    return cached;
  }

  try {
    return await orderBookManager.fetchSnapshot(symbol);
  } catch (err) {
    if (cached) return cached;
    throw err;
  }
}
