/**
 * Volatility Feature Extraction — ATR, Bollinger width, regime volatility.
 */
import type { CandleEvent } from "@workspace/common-types";

export interface VolatilityFeatures {
  symbol: string;
  ts: string;
  atr14: number;
  atrPct: number;           // ATR as % of close
  bollingerWidth: number;   // (upper - lower) / middle
  rangeExpansion: boolean;  // current range > 1.5x average
  volatilityState: "low" | "medium" | "high";
}

/**
 * Compute ATR (Average True Range) for a candle series.
 */
function computeATR(candles: CandleEvent[], period = 14): number {
  if (candles.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i - 1].close),
      Math.abs(candles[i].low - candles[i - 1].close),
    );
    trueRanges.push(tr);
  }

  const window = trueRanges.slice(-period);
  return window.reduce((sum, tr) => sum + tr, 0) / window.length;
}

/**
 * Compute Bollinger Band width.
 */
function computeBollingerWidth(candles: CandleEvent[], period = 20, mult = 2): number {
  const closes = candles.slice(-period).map(c => c.close);
  if (closes.length < period) return 0;

  const mean = closes.reduce((a, b) => a + b, 0) / closes.length;
  const variance = closes.reduce((sum, c) => sum + (c - mean) ** 2, 0) / closes.length;
  const stdDev = Math.sqrt(variance);

  const upper = mean + mult * stdDev;
  const lower = mean - mult * stdDev;

  return mean > 0 ? (upper - lower) / mean : 0;
}

export function computeVolatilityFeatures(
  candles: CandleEvent[],
): VolatilityFeatures | null {
  if (candles.length < 15) return null;

  const last = candles[candles.length - 1];
  const atr14 = computeATR(candles, 14);
  const atrPct = last.close > 0 ? atr14 / last.close : 0;
  const bollingerWidth = computeBollingerWidth(candles);

  // Average range for expansion check
  const recentRanges = candles.slice(-20).map(c => c.high - c.low);
  const avgRange = recentRanges.reduce((a, b) => a + b, 0) / recentRanges.length;
  const currentRange = last.high - last.low;
  const rangeExpansion = currentRange > avgRange * 1.5;

  // Classify volatility state
  let volatilityState: "low" | "medium" | "high" = "medium";
  if (atrPct < 0.005) volatilityState = "low";
  else if (atrPct > 0.02) volatilityState = "high";

  return {
    symbol: last.symbol,
    ts: last.ts,
    atr14,
    atrPct,
    bollingerWidth,
    rangeExpansion,
    volatilityState,
  };
}
