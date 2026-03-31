/**
 * Multi-Timeframe Score Extractor
 *
 * Computes directional bias scores per timeframe from bar data.
 * These feed into Super Intelligence's confluence check, which
 * requires 2/3 timeframes aligned before approving a signal.
 *
 * Each timeframe produces a 0-1 score:
 *   > 0.55 = bullish bias
 *   < 0.45 = bearish bias
 *   0.45-0.55 = neutral / no clear bias
 *
 * Factors per timeframe:
 * 1. Trend slope (EMA-based)
 * 2. Close position within range (near high = bullish)
 * 3. Momentum (consecutive candle direction)
 * 4. Volume trend (rising volume in direction = confirms)
 */

import type { AlpacaBar } from "./alpaca";

export interface MTFScores {
  [key: string]: number;
  "1m": number;
  "5m": number;
  "15m": number;
}

/**
 * Compute directional bias scores for all three timeframes.
 */
export function computeMTFScores(  bars1m: AlpacaBar[],
  bars5m: AlpacaBar[],
  bars15m: AlpacaBar[],
): MTFScores {
  return {
    "1m": computeTimeframeBias(bars1m),
    "5m": computeTimeframeBias(bars5m),
    "15m": computeTimeframeBias(bars15m),
  };
}

/**
 * Compute directional bias for a single timeframe.
 * Returns 0-1 where > 0.55 = bullish, < 0.45 = bearish.
 */
function computeTimeframeBias(bars: AlpacaBar[]): number {
  if (bars.length < 10) return 0.5; // Not enough data

  const recent = bars.slice(-20); // Last 20 bars

  // 1. Trend slope via simple EMA comparison
  const ema8 = computeEMA(recent.map(b => b.Close), 8);
  const ema21 = computeEMA(recent.map(b => b.Close), 21);
  const trendScore = ema8 > ema21
    ? 0.5 + Math.min(0.3, ((ema8 - ema21) / ema21) * 50)
    : 0.5 - Math.min(0.3, ((ema21 - ema8) / ema21) * 50);

  // 2. Close position within recent range
  const highs = recent.map(b => b.High);
  const lows = recent.map(b => b.Low);
  const rangeHigh = Math.max(...highs);
  const rangeLow = Math.min(...lows);  const lastClose = recent[recent.length - 1].Close;
  const rangeWidth = rangeHigh - rangeLow;
  const rangeScore = rangeWidth > 0
    ? (lastClose - rangeLow) / rangeWidth  // 0 = at low, 1 = at high
    : 0.5;

  // 3. Momentum: count consecutive bullish/bearish candles
  let consecutiveBull = 0;
  let consecutiveBear = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    const bar = recent[i];
    if (bar.Close > bar.Open) {
      if (consecutiveBear > 0) break;
      consecutiveBull++;
    } else if (bar.Close < bar.Open) {
      if (consecutiveBull > 0) break;
      consecutiveBear++;
    } else {
      break;
    }
  }
  const maxConsec = 5; // Cap at 5 to prevent outlier influence
  const momentumScore = consecutiveBull > 0
    ? 0.5 + Math.min(consecutiveBull, maxConsec) / (maxConsec * 2) * 0.3
    : consecutiveBear > 0
      ? 0.5 - Math.min(consecutiveBear, maxConsec) / (maxConsec * 2) * 0.3
      : 0.5;

  // 4. Volume trend: is volume increasing in recent bars?
  const recentVols = recent.slice(-5).map(b => b.Volume);
  const olderVols = recent.slice(-10, -5).map(b => b.Volume);  const avgRecent = recentVols.reduce((s, v) => s + v, 0) / recentVols.length;
  const avgOlder = olderVols.length > 0
    ? olderVols.reduce((s, v) => s + v, 0) / olderVols.length
    : avgRecent;
  // Rising volume in trend direction is confirming
  const volRising = avgOlder > 0 ? avgRecent / avgOlder : 1;
  const lastBullish = lastClose > recent[recent.length - 1].Open;
  const volScore = volRising > 1.2
    ? (lastBullish ? 0.55 : 0.45) // Volume confirms direction
    : 0.5; // Neutral

  // Weighted composite
  const composite = (
    trendScore * 0.35 +
    rangeScore * 0.25 +
    momentumScore * 0.25 +
    volScore * 0.15
  );

  return Math.max(0, Math.min(1, composite));
}

/** Simple EMA calculation */
function computeEMA(values: number[], period: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (period + 1);
  let ema = values[0];
  for (let i = 1; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
  }
  return ema;
}