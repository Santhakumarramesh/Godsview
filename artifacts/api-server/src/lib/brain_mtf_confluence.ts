/**
 * brain_mtf_confluence.ts — Phase 12B
 *
 * Multi-Timeframe Confluence Layer (L2.5)
 *
 * Runs between L2 (structure) and L3 (context) in the brain pipeline.
 * Fetches bars across M1 / M5 / M15 / H1 / D1, computes trend alignment,
 * momentum convergence, and volume confirmation per timeframe, then returns
 * a composite alignment score (0–1) and a per-tf breakdown.
 *
 * A strong signal requires 3+ timeframes agreeing on direction.
 * The execution bridge uses this score as an additional gate (Gate 2.7).
 *
 * Results are cached for 60s per symbol to avoid hammering Alpaca.
 */

import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type Timeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day";

export interface TFAnalysis {
  tf: Timeframe;
  bars: number;
  trend: "bullish" | "bearish" | "neutral";
  momentum: number;          // -1 to +1 (RSI-normalized)
  volumeConfirmed: boolean;  // above 20-bar avg volume
  ema9AboveEma21: boolean;
  priceAboveEma21: boolean;
  rangeCompression: boolean; // ATR < 0.5× 20-period ATR average (squeeze)
  score: number;             // 0–1 contribution to total
}

export interface MTFConfluence {
  symbol: string;
  direction: "long" | "short";
  alignmentScore: number;    // 0–1 composite (≥0.65 is actionable)
  timeframes: TFAnalysis[];
  agreementCount: number;    // # of TFs aligned with direction
  strongTFs: Timeframe[];    // TFs with score > 0.7
  conflictTFs: Timeframe[];  // TFs opposing direction
  compressed: boolean;       // ≥2 TFs in range compression
  timestamp: number;
  cached: boolean;
}

// ── Cache ──────────────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { result: MTFConfluence; expiry: number }>();

function cacheKey(symbol: string, direction: "long" | "short"): string {
  return `${symbol}:${direction}`;
}

// ── Timeframe weights (higher TF = more weight) ────────────────────────────────

const TF_WEIGHT: Record<Timeframe, number> = {
  "1Min": 0.10,
  "5Min": 0.20,
  "15Min": 0.25,
  "1Hour": 0.30,
  "1Day": 0.15,
};

const TIMEFRAMES: Timeframe[] = ["1Min", "5Min", "15Min", "1Hour", "1Day"];
const TF_BAR_COUNTS: Record<Timeframe, number> = {
  "1Min": 30,
  "5Min": 24,
  "15Min": 20,
  "1Hour": 20,
  "1Day": 20,
};

// ── Technical helpers ──────────────────────────────────────────────────────────

function ema(prices: number[], period: number): number[] {
  if (prices.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [prices[0]!];
  for (let i = 1; i < prices.length; i++) {
    result.push(prices[i]! * k + result[i - 1]! * (1 - k));
  }
  return result;
}

function rsi(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = prices[i]! - prices[i - 1]!;
    if (d >= 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < prices.length; i++) {
    const d = prices[i]! - prices[i - 1]!;
    const g = d >= 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  if (closes.length < 2) return [];
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i] ?? 0, l = lows[i] ?? 0, prevC = closes[i - 1] ?? 0;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  if (trs.length === 0) return [];
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < Math.min(period, trs.length); i++) sum += trs[i]!;
  result.push(sum / Math.min(period, trs.length));
  for (let i = period; i < trs.length; i++) {
    result.push((result[result.length - 1]! * (period - 1) + trs[i]!) / period);
  }
  return result;
}

// ── Per-timeframe analysis ─────────────────────────────────────────────────────

function analyzeTF(
  tf: Timeframe,
  direction: "long" | "short",
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[],
): TFAnalysis {
  const n = closes.length;
  const noData: TFAnalysis = {
    tf, bars: 0, trend: "neutral", momentum: 0, volumeConfirmed: false,
    ema9AboveEma21: false, priceAboveEma21: false, rangeCompression: false, score: 0,
  };
  if (n < 5) return noData;

  const ema9vals = ema(closes, 9);
  const ema21vals = ema(closes, Math.min(21, n));
  const ema9 = ema9vals[ema9vals.length - 1] ?? closes[n - 1]!;
  const ema21 = ema21vals[ema21vals.length - 1] ?? closes[n - 1]!;
  const price = closes[n - 1]!;

  const ema9AboveEma21 = ema9 > ema21;
  const priceAboveEma21 = price > ema21;

  // Trend
  const trend: "bullish" | "bearish" | "neutral" =
    ema9AboveEma21 && priceAboveEma21 ? "bullish"
    : !ema9AboveEma21 && !priceAboveEma21 ? "bearish"
    : "neutral";

  // RSI momentum
  const rsiVal = rsi(closes, Math.min(14, n - 1));
  const momentum = (rsiVal - 50) / 50; // -1 to +1

  // Volume confirmation (vs 20-bar SMA)
  const volAvg = volumes.length >= 5
    ? volumes.slice(-Math.min(20, volumes.length)).reduce((a, b) => a + b, 0) / Math.min(20, volumes.length)
    : 0;
  const lastVol = volumes[volumes.length - 1] ?? 0;
  const volumeConfirmed = volAvg > 0 && lastVol > volAvg * 0.8;

  // Range compression (current ATR vs 20-bar avg)
  const atrVals = atr(highs, lows, closes, 14);
  const lastATR = atrVals[atrVals.length - 1] ?? 0;
  const avgATR = atrVals.slice(-20).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(20, atrVals.length));
  const rangeCompression = avgATR > 0 && lastATR < avgATR * 0.6;

  // Score for this timeframe
  const aligned = direction === "long" ? trend === "bullish" : trend === "bearish";
  const momentumAligned = direction === "long" ? momentum > 0 : momentum < 0;

  let score = 0;
  if (aligned) score += 0.5;
  if (momentumAligned) score += 0.25;
  if (volumeConfirmed) score += 0.15;
  if (!rangeCompression) score += 0.10; // reward expansion (trending market)

  return { tf, bars: n, trend, momentum, volumeConfirmed, ema9AboveEma21, priceAboveEma21, rangeCompression, score };
}

// ── Main confluence function ───────────────────────────────────────────────────

export async function computeMTFConfluence(
  symbol: string,
  direction: "long" | "short",
): Promise<MTFConfluence> {
  // Serve from cache if fresh
  const key = cacheKey(symbol, direction);
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) {
    return { ...cached.result, cached: true };
  }

  const tfResults: TFAnalysis[] = [];
  let weightedScore = 0;
  let totalWeight = 0;

  for (const tf of TIMEFRAMES) {
    const barsNeeded = TF_BAR_COUNTS[tf];
    try {
      const { getBars } = await import("./alpaca.js");
      const bars = await getBars(symbol, tf, barsNeeded);

      if (!bars || bars.length < 3) {
        // Neutral contribution
        tfResults.push({ tf, bars: 0, trend: "neutral", momentum: 0, volumeConfirmed: false, ema9AboveEma21: false, priceAboveEma21: false, rangeCompression: false, score: 0 });
        continue;
      }

      const closes = bars.map((b: any) => Number(b.c ?? b.close ?? 0)).filter(Boolean);
      const highs  = bars.map((b: any) => Number(b.h ?? b.high ?? 0)).filter(Boolean);
      const lows   = bars.map((b: any) => Number(b.l ?? b.low ?? 0)).filter(Boolean);
      const vols   = bars.map((b: any) => Number(b.v ?? b.volume ?? 0));

      const analysis = analyzeTF(tf, direction, closes, highs, lows, vols);
      tfResults.push(analysis);

      const w = TF_WEIGHT[tf];
      weightedScore += analysis.score * w;
      totalWeight += w;

    } catch (err) {
      logger.debug({ err, symbol, tf }, "[MTF] Bar fetch error — skipping timeframe");
      tfResults.push({ tf, bars: 0, trend: "neutral", momentum: 0, volumeConfirmed: false, ema9AboveEma21: false, priceAboveEma21: false, rangeCompression: false, score: 0 });
    }
  }

  const alignmentScore = totalWeight > 0 ? weightedScore / totalWeight : 0;

  const agreementCount = tfResults.filter(t =>
    t.trend === (direction === "long" ? "bullish" : "bearish")
  ).length;

  const strongTFs: Timeframe[] = tfResults.filter(t => t.score > 0.7).map(t => t.tf);
  const conflictTFs: Timeframe[] = tfResults.filter(t =>
    t.trend === (direction === "long" ? "bearish" : "bullish")
  ).map(t => t.tf);
  const compressed = tfResults.filter(t => t.rangeCompression).length >= 2;

  const result: MTFConfluence = {
    symbol,
    direction,
    alignmentScore: Number(alignmentScore.toFixed(4)),
    timeframes: tfResults,
    agreementCount,
    strongTFs,
    conflictTFs,
    compressed,
    timestamp: Date.now(),
    cached: false,
  };

  cache.set(key, { result, expiry: Date.now() + CACHE_TTL_MS });
  return result;
}

/** Clear cached result for a symbol (call on regime change) */
export function clearMTFCache(symbol: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${symbol}:`)) cache.delete(key);
  }
}

/** Minimum alignment score required to approve execution */
export const MTF_MIN_ALIGNMENT = Number(process.env.BRAIN_MTF_MIN_ALIGNMENT ?? "0.55");
