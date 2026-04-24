/**
 * Alpaca Ingestor — normalizes Alpaca bar data into CandleEvent contracts.
 *
 * This is the canonical entry point for converting raw Alpaca responses
 * into the GodsView event format. All consumers should use this instead
 * of importing alpaca.ts directly.
 */
import type { CandleEvent, CandleTimeframe } from "@workspace/common-types";
import { logger } from "../logger";
import { isLiveMode } from "../data_safety_guard";

const TF_MAP: Record<CandleTimeframe, string> = {
  "1m": "1Min",
  "5m": "5Min",
  "15m": "15Min",
  "30m": "30Min",
  "1h": "1Hour",
  "4h": "1Hour", // fetch 4x and aggregate
  "1d": "1Day",
  "1w": "1Day",  // fetch 5x and aggregate
};

const LIMIT_MAP: Record<CandleTimeframe, number> = {
  "1m": 200,
  "5m": 200,
  "15m": 200,
  "30m": 200,
  "1h": 200,
  "4h": 800,
  "1d": 200,
  "1w": 1000,
};

export async function ingestBars(
  symbol: string,
  timeframe: CandleTimeframe,
  limit?: number,
): Promise<CandleEvent[]> {
  const { getBars } = await import("../alpaca.js");

  const alpacaTf = TF_MAP[timeframe];
  const fetchLimit = limit ?? LIMIT_MAP[timeframe];

  const rawBars = await getBars(symbol, alpacaTf as any, fetchLimit);

  if (!rawBars || !Array.isArray(rawBars) || rawBars.length === 0) {
    if (isLiveMode()) {
      throw new Error(`No bars returned from Alpaca for ${symbol}/${timeframe} — cannot proceed in live mode`);
    }
    logger.warn({ symbol, timeframe }, "No bars returned from Alpaca");
    return [];
  }

  const candles: CandleEvent[] = rawBars.map((b: any, idx: number) => ({
    eventId: `${symbol}-${timeframe}-${idx}-${b.t ?? Date.now()}`,
    kind: "candle" as const,
    symbol,
    timeframe,
    ts: new Date(b.t ?? b.Timestamp ?? Date.now()).toISOString(),
    source: "alpaca" as const,
    open: Number(b.o ?? b.Open ?? 0),
    high: Number(b.h ?? b.High ?? 0),
    low: Number(b.l ?? b.Low ?? 0),
    close: Number(b.c ?? b.Close ?? 0),
    volume: Number(b.v ?? b.Volume ?? 0),
  }));

  // Aggregate for higher timeframes
  if (timeframe === "4h") return aggregateCandles(candles, 4, timeframe);
  if (timeframe === "1w") return aggregateCandles(candles, 5, timeframe);

  return candles;
}

function aggregateCandles(
  candles: CandleEvent[],
  period: number,
  targetTf: CandleTimeframe,
): CandleEvent[] {
  const result: CandleEvent[] = [];
  for (let i = 0; i < candles.length; i += period) {
    const chunk = candles.slice(i, i + period);
    if (chunk.length === 0) continue;
    result.push({
      eventId: `agg-${chunk[0].symbol}-${targetTf}-${i}`,
      kind: "candle",
      symbol: chunk[0].symbol,
      timeframe: targetTf,
      ts: chunk[0].ts,
      source: chunk[0].source,
      open: chunk[0].open,
      high: Math.max(...chunk.map(c => c.high)),
      low: Math.min(...chunk.map(c => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return result;
}
