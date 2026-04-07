/**
 * Structure Pipeline — detects market structure (BOS, CHoCH, OB, FVG, sweeps).
 *
 * Outputs a single StructureState per symbol/timeframe that feeds the brain.
 */
import type { CandleEvent, StructureState } from "@workspace/common-types";

interface SwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

/** Detect swing highs and lows using a simple lookback */
function detectSwings(candles: CandleEvent[], lookback = 3): SwingPoint[] {
  const swings: SwingPoint[] = [];

  for (let i = lookback; i < candles.length - lookback; i++) {
    const windowHighs = candles.slice(i - lookback, i + lookback + 1).map(c => c.high);
    const windowLows = candles.slice(i - lookback, i + lookback + 1).map(c => c.low);

    if (candles[i].high === Math.max(...windowHighs)) {
      swings.push({ index: i, price: candles[i].high, type: "high" });
    }
    if (candles[i].low === Math.min(...windowLows)) {
      swings.push({ index: i, price: candles[i].low, type: "low" });
    }
  }

  return swings;
}

/** Detect Break of Structure (BOS) — price breaks the last swing in trend direction */
function detectBOS(candles: CandleEvent[], swings: SwingPoint[]): boolean {
  if (candles.length < 2 || swings.length < 2) return false;

  const last = candles[candles.length - 1];
  const lastHigh = swings.filter(s => s.type === "high").slice(-1)[0];
  const lastLow = swings.filter(s => s.type === "low").slice(-1)[0];

  if (lastHigh && last.close > lastHigh.price) return true; // Bullish BOS
  if (lastLow && last.close < lastLow.price) return true;   // Bearish BOS

  return false;
}

/** Detect Change of Character (CHoCH) — break against the prevailing trend */
function detectCHoCH(candles: CandleEvent[], swings: SwingPoint[]): boolean {
  if (swings.length < 4) return false;

  const highs = swings.filter(s => s.type === "high").slice(-3);
  const lows = swings.filter(s => s.type === "low").slice(-3);

  if (highs.length < 2 || lows.length < 2) return false;

  const last = candles[candles.length - 1];

  // Uptrend CHoCH: making higher highs then suddenly breaks a higher low
  const isUptrend = highs[highs.length - 1].price > highs[highs.length - 2].price;
  if (isUptrend && lows.length >= 2 && last.close < lows[lows.length - 1].price) return true;

  // Downtrend CHoCH: making lower lows then suddenly breaks a lower high
  const isDowntrend = lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (isDowntrend && highs.length >= 2 && last.close > highs[highs.length - 1].price) return true;

  return false;
}

/** Detect active Order Block (last strong candle before BOS) */
function detectOrderBlock(candles: CandleEvent[]): boolean {
  if (candles.length < 10) return false;

  const last5 = candles.slice(-5);
  // Simple: look for a strong impulse candle followed by reversal zone
  for (const c of last5) {
    const bodyPct = Math.abs(c.close - c.open) / Math.max(c.high - c.low, 1e-9);
    if (bodyPct > 0.7) return true; // Strong body = potential OB
  }
  return false;
}

/** Detect Fair Value Gap (3-candle gap where c1.low > c3.high or vice versa) */
function detectFVG(candles: CandleEvent[]): boolean {
  if (candles.length < 3) return false;

  const [c1, , c3] = candles.slice(-3);
  // Bullish FVG: gap up
  if (c1.high < c3.low) return true;
  // Bearish FVG: gap down
  if (c1.low > c3.high) return true;

  return false;
}

/** Detect liquidity sweep at a key level */
function detectLiquiditySweep(candles: CandleEvent[], swings: SwingPoint[]): boolean {
  if (candles.length < 2 || swings.length < 2) return false;

  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const recentLows = swings.filter(s => s.type === "low").slice(-3);
  const recentHighs = swings.filter(s => s.type === "high").slice(-3);

  // Sweep low and recover
  for (const swing of recentLows) {
    if (last.low < swing.price && last.close > swing.price && prev.low >= swing.price) return true;
  }
  // Sweep high and recover
  for (const swing of recentHighs) {
    if (last.high > swing.price && last.close < swing.price && prev.high <= swing.price) return true;
  }

  return false;
}

/**
 * Run the full structure pipeline on a candle series.
 * Returns a normalized StructureState.
 */
export function analyzeStructure(candles: CandleEvent[]): StructureState | null {
  if (candles.length < 10) return null;

  const last = candles[candles.length - 1];
  const swings = detectSwings(candles);

  const bos = detectBOS(candles, swings);
  const choch = detectCHoCH(candles, swings);
  const activeOB = detectOrderBlock(candles);
  const activeFVG = detectFVG(candles);
  const liquiditySweep = detectLiquiditySweep(candles, swings);

  // Structure score: weighted combination
  let score = 0;
  if (bos) score += 0.25;
  if (choch) score += 0.15;
  if (activeOB) score += 0.25;
  if (activeFVG) score += 0.15;
  if (liquiditySweep) score += 0.20;

  return {
    symbol: last.symbol,
    ts: last.ts,
    bos,
    choch,
    activeOB,
    activeFVG,
    liquiditySweep,
    structureScore: Math.min(1, score),
  };
}
