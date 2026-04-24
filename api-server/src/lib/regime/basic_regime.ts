/**
 * Basic Regime Detection — classifies market regime from candle data.
 *
 * Regimes: trend_up, trend_down, range, compression, expansion, chaotic
 */
import type { CandleEvent, RegimeState } from "@workspace/common-types";

/** Simple EMA calculation */
function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

/** ADX-like trend strength (simplified) */
function trendStrength(candles: CandleEvent[], period = 14): number {
  if (candles.length < period + 1) return 0;

  let plusDM = 0;
  let minusDM = 0;
  let tr = 0;

  for (let i = candles.length - period; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    const upMove = high - prevHigh;
    const downMove = prevLow - low;

    if (upMove > downMove && upMove > 0) plusDM += upMove;
    if (downMove > upMove && downMove > 0) minusDM += downMove;

    tr += Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
  }

  if (tr === 0) return 0;
  const plusDI = plusDM / tr;
  const minusDI = minusDM / tr;
  const diSum = plusDI + minusDI;

  return diSum > 0 ? Math.abs(plusDI - minusDI) / diSum : 0;
}

/** Detect compression (narrowing ranges) */
function isCompression(candles: CandleEvent[], window = 10): boolean {
  if (candles.length < window * 2) return false;

  const recent = candles.slice(-window).map(c => c.high - c.low);
  const earlier = candles.slice(-window * 2, -window).map(c => c.high - c.low);

  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;

  return avgRecent < avgEarlier * 0.6; // ranges compressed by 40%+
}

/** Detect expansion (widening ranges) */
function isExpansion(candles: CandleEvent[], window = 10): boolean {
  if (candles.length < window * 2) return false;

  const recent = candles.slice(-window).map(c => c.high - c.low);
  const earlier = candles.slice(-window * 2, -window).map(c => c.high - c.low);

  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgEarlier = earlier.reduce((a, b) => a + b, 0) / earlier.length;

  return avgRecent > avgEarlier * 1.6; // ranges expanded by 60%+
}

/** Volatility state from ATR percentage */
function volState(candles: CandleEvent[]): "low" | "medium" | "high" {
  if (candles.length < 15) return "medium";

  const closes = candles.slice(-14).map(c => c.close);
  const ranges = candles.slice(-14).map(c => c.high - c.low);
  const avgRange = ranges.reduce((a, b) => a + b, 0) / ranges.length;
  const lastClose = closes[closes.length - 1];
  const atrPct = lastClose > 0 ? avgRange / lastClose : 0;

  if (atrPct < 0.005) return "low";
  if (atrPct > 0.02) return "high";
  return "medium";
}

/**
 * Detect regime from candle series.
 */
export function detectRegime(candles: CandleEvent[]): RegimeState | null {
  if (candles.length < 20) return null;

  const last = candles[candles.length - 1];
  const closes = candles.map(c => c.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, Math.min(50, closes.length));
  const strength = trendStrength(candles);

  const lastEma20 = ema20[ema20.length - 1];
  const lastEma50 = ema50[ema50.length - 1];
  const emaDiff = lastEma20 - lastEma50;
  const emaDiffPct = lastEma50 > 0 ? emaDiff / lastEma50 : 0;

  let regime: RegimeState["regime"];
  let confidence: number;

  if (isCompression(candles)) {
    regime = "compression";
    confidence = 0.7;
  } else if (isExpansion(candles)) {
    regime = "expansion";
    confidence = 0.75;
  } else if (strength > 0.4 && emaDiffPct > 0.005) {
    regime = "trend_up";
    confidence = Math.min(1, 0.5 + strength);
  } else if (strength > 0.4 && emaDiffPct < -0.005) {
    regime = "trend_down";
    confidence = Math.min(1, 0.5 + strength);
  } else if (strength < 0.15) {
    regime = "range";
    confidence = 0.6;
  } else {
    regime = "chaotic";
    confidence = 0.3;
  }

  return {
    symbol: last.symbol,
    ts: last.ts,
    regime,
    trendStrength: strength,
    volState: volState(candles),
    confidence,
  };
}
