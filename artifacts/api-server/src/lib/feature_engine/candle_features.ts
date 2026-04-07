/**
 * Candle Feature Extraction — computes derived features from raw OHLCV data.
 */
import type { CandleEvent } from "@workspace/common-types";

export interface CandleFeatures {
  symbol: string;
  ts: string;
  bodyPct: number;
  upperWickPct: number;
  lowerWickPct: number;
  range: number;
  closeLocation: number;    // 0 = at low, 1 = at high
  relativeVolume: number | null;
  isBullish: boolean;
  bodyToRangeRatio: number; // high = trend candle, low = indecision
}

export function computeCandleFeatures(
  candle: CandleEvent,
  avgVolume?: number,
): CandleFeatures {
  const range = Math.max(candle.high - candle.low, 1e-9);
  const body = Math.abs(candle.close - candle.open);
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;

  return {
    symbol: candle.symbol,
    ts: candle.ts,
    bodyPct: body / range,
    upperWickPct: upperWick / range,
    lowerWickPct: lowerWick / range,
    range,
    closeLocation: (candle.close - candle.low) / range,
    relativeVolume: avgVolume && avgVolume > 0 ? candle.volume / avgVolume : null,
    isBullish: candle.close > candle.open,
    bodyToRangeRatio: body / range,
  };
}

/**
 * Compute features for a series of candles with rolling averages.
 */
export function computeCandleSeriesFeatures(
  candles: CandleEvent[],
  volumeWindow = 20,
): CandleFeatures[] {
  const features: CandleFeatures[] = [];

  for (let i = 0; i < candles.length; i++) {
    // Rolling average volume
    const volWindow = candles.slice(Math.max(0, i - volumeWindow), i);
    const avgVolume = volWindow.length > 0
      ? volWindow.reduce((sum, c) => sum + c.volume, 0) / volWindow.length
      : undefined;

    features.push(computeCandleFeatures(candles[i], avgVolume));
  }

  return features;
}
