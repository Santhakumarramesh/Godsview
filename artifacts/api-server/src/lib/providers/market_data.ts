/**
 * Real market data provider — Centralized fetcher for bars, quotes, snapshots
 *
 * Integrates with:
 * - Alpaca API (via alpaca.ts client)
 * - Python market_data_service for historical bars
 */

import { fetchAlpacaQuote, fetchAlpacaBars, AlpacaBar, AlpacaQuote } from "../alpaca";
import { Logger } from "pino";

export interface MarketSnapshot {
  symbol: string;
  price: number;
  change: number;
  changePct: number;
  volume: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  open: number;
  marketCap?: string;
  pe?: number;
  timestamp: string;
}

export interface QuoteData {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  lastTrade: string;
  timestamp: string;
}

/**
 * Fetch real market snapshots from Alpaca
 */
export async function fetchMarketSnapshots(
  symbols: string[],
  logger?: Logger
): Promise<MarketSnapshot[]> {
  const results: MarketSnapshot[] = [];

  for (const symbol of symbols) {
    try {
      const quote = await fetchAlpacaQuote(symbol);
      if (quote) {
        results.push({
          symbol,
          price: quote.ap || quote.c || 0,
          change: (quote.c || 0) - (quote.o || 0),
          changePct: quote.c && quote.o ? ((quote.c - quote.o) / quote.o) * 100 : 0,
          volume: quote.v || 0,
          bid: quote.bp || quote.ap || 0,
          ask: quote.ap || quote.bp || 0,
          high: quote.h || quote.c || 0,
          low: quote.l || quote.c || 0,
          open: quote.o || 0,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (err) {
      logger?.warn({ symbol, error: String(err) }, "Failed to fetch quote");
      // Continue with next symbol
    }
  }

  return results;
}

/**
 * Fetch real quote data from Alpaca
 */
export async function fetchQuotes(symbols: string[], logger?: Logger): Promise<QuoteData[]> {
  const results: QuoteData[] = [];

  for (const symbol of symbols) {
    try {
      const quote = await fetchAlpacaQuote(symbol);
      if (quote) {
        results.push({
          symbol,
          price: quote.ap || quote.c || 0,
          bid: quote.bp || 0,
          ask: quote.ap || 0,
          bidSize: quote.bs || 0,
          askSize: quote.as || 0,
          lastTrade: quote.t || new Date().toISOString(),
          timestamp: quote.t || new Date().toISOString(),
        });
      }
    } catch (err) {
      logger?.warn({ symbol, error: String(err) }, "Failed to fetch quote");
    }
  }

  return results;
}

/**
 * Fetch historical bars for technical analysis
 */
export async function fetchBars(
  symbol: string,
  timeframe: string = "15min",
  limit: number = 200,
  logger?: Logger
): Promise<AlpacaBar[]> {
  try {
    const bars = await fetchAlpacaBars(symbol, timeframe, limit);
    return bars || [];
  } catch (err) {
    logger?.warn({ symbol, timeframe, error: String(err) }, "Failed to fetch bars");
    return [];
  }
}

/**
 * Compute simple statistics from bars
 */
export function computeBarStats(bars: AlpacaBar[]) {
  if (bars.length === 0) {
    return {
      avgVolume: 0,
      highestClose: 0,
      lowestClose: 0,
      volatility: 0,
      averageClose: 0,
    };
  }

  const closes = bars.map(b => b.c);
  const volumes = bars.map(b => b.v);

  const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;
  const highestClose = Math.max(...closes);
  const lowestClose = Math.min(...closes);
  const averageClose = closes.reduce((a, b) => a + b, 0) / closes.length;

  // Simple volatility: standard deviation of daily returns
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - meanReturn, 2), 0) / returns.length;
  const volatility = Math.sqrt(variance) * 100; // As percentage

  return {
    avgVolume,
    highestClose,
    lowestClose,
    volatility,
    averageClose,
  };
}
