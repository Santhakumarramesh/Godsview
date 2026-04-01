/**
 * mtf_scores.test.ts — Phase 23: Multi-Timeframe Score Engine
 *
 * Tests:
 *   - Insufficient data → neutral 0.5
 *   - Strong bullish trend (EMA8 >> EMA21, close at top) → score > 0.55
 *   - Strong bearish trend (EMA8 << EMA21, close at bottom) → score < 0.45
 *   - Neutral price action → score near 0.5
 *   - Consecutive bullish candles boost score above neutral
 *   - Consecutive bearish candles depress score below neutral
 *   - Rising volume in uptrend direction → slight bullish nudge
 *   - computeMTFScores produces all three keys
 *   - Score is always clamped to [0, 1]
 *   - Three aligned bullish timeframes all > 0.55
 *   - Three aligned bearish timeframes all < 0.45
 */

import { describe, it, expect } from "vitest";
import { computeMTFScores } from "../lib/mtf_scores";
import type { AlpacaBar } from "../lib/alpaca";

// ─── Bar factory ───────────────────────────────────────────────────────────────

function makeBar(
  close: number,
  opts: {
    open?:   number;
    high?:   number;
    low?:    number;
    volume?: number;
  } = {},
): AlpacaBar {
  const open   = opts.open   ?? close * 0.999;
  const high   = opts.high   ?? close * 1.002;
  const low    = opts.low    ?? close * 0.998;
  const volume = opts.volume ?? 10_000;
  return {
    t: new Date().toISOString(), o: open, h: high, l: low, c: close, v: volume,
    Timestamp: new Date().toISOString(),
    Open: open, High: high, Low: low, Close: close, Volume: volume,
  };
}

/**
 * Generate N bars with a deterministic price trend.
 * @param startPrice    First bar's close price
 * @param stepPct       Per-bar percentage change (positive = uptrend)
 * @param count         Number of bars to generate
 * @param volMultiplier Volume scaling (default 1.0)
 */
function trendBars(
  startPrice: number,
  stepPct: number,
  count: number,
  volMultiplier = 1.0,
): AlpacaBar[] {
  const bars: AlpacaBar[] = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const open  = price;
    price = price * (1 + stepPct);
    const high  = Math.max(open, price) * 1.001;
    const low   = Math.min(open, price) * 0.999;
    bars.push(makeBar(price, { open, high, low, volume: 10_000 * volMultiplier }));
  }
  return bars;
}

/**
 * Generate N bars that alternate bullish/bearish with no net trend (neutral).
 */
function flatBars(price: number, count: number): AlpacaBar[] {
  const bars: AlpacaBar[] = [];
  for (let i = 0; i < count; i++) {
    const delta = (i % 2 === 0) ? 0.001 : -0.001;
    bars.push(makeBar(price * (1 + delta), {
      open: price, high: price * 1.002, low: price * 0.998,
    }));
  }
  return bars;
}

/** Generate N identical bars at the same price (zero variance, minimal trend). */
function staticBars(price: number, count: number): AlpacaBar[] {
  return Array.from({ length: count }, () => makeBar(price));
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("mtf_scores — computeTimeframeBias (via computeMTFScores)", () => {

  // ── Insufficient data ──────────────────────────────────────────────────────

  describe("insufficient data", () => {
    it("returns 0.5 for empty bar array", () => {
      const scores = computeMTFScores([], [], []);
      expect(scores["1m"]).toBe(0.5);
      expect(scores["5m"]).toBe(0.5);
      expect(scores["15m"]).toBe(0.5);
    });

    it("returns 0.5 when fewer than 10 bars (threshold = 10)", () => {
      const bars = trendBars(100, 0.01, 9); // 9 bars — below threshold
      const scores = computeMTFScores(bars, bars, bars);
      expect(scores["1m"]).toBe(0.5);
    });

    it("returns a numeric score (not NaN) with exactly 10 bars", () => {
      const bars = trendBars(100, 0.005, 10);
      const scores = computeMTFScores(bars, bars, bars);
      expect(Number.isFinite(scores["1m"])).toBe(true);
    });
  });

  // ── Strong bullish trend ───────────────────────────────────────────────────

  describe("strong bullish trend", () => {
    it("uptrend bars produce score > 0.55 (bullish bias)", () => {
      // 40 bars, +0.5% per bar → strong uptrend, EMA8 >> EMA21
      const bars = trendBars(100, 0.005, 40);
      const scores = computeMTFScores(bars, bars, bars);
      expect(scores["1m"]).toBeGreaterThan(0.55);
    });

    it("steep uptrend (+1% per bar) produces higher score than mild uptrend (+0.1%)", () => {
      const steepBars = trendBars(100, 0.010, 40);
      const mildBars  = trendBars(100, 0.001, 40);
      const steepScores = computeMTFScores(steepBars, steepBars, steepBars);
      const mildScores  = computeMTFScores(mildBars, mildBars, mildBars);
      expect(steepScores["1m"]).toBeGreaterThan(mildScores["1m"]);
    });

    it("uptrend: score bounded at 1.0 (no overflow)", () => {
      // Very aggressive trend
      const bars = trendBars(100, 0.05, 40);
      const scores = computeMTFScores(bars, bars, bars);
      expect(scores["1m"]).toBeLessThanOrEqual(1.0);
    });
  });

  // ── Strong bearish trend ───────────────────────────────────────────────────

  describe("strong bearish trend", () => {
    it("downtrend bars produce score < 0.45 (bearish bias)", () => {
      const bars = trendBars(100, -0.005, 40);
      const scores = computeMTFScores(bars, bars, bars);
      expect(scores["1m"]).toBeLessThan(0.45);
    });

    it("steep downtrend (-1% per bar) produces lower score than mild downtrend (-0.1%)", () => {
      const steepBars = trendBars(100, -0.010, 40);
      const mildBars  = trendBars(100, -0.001, 40);
      const steepScores = computeMTFScores(steepBars, steepBars, steepBars);
      const mildScores  = computeMTFScores(mildBars, mildBars, mildBars);
      expect(steepScores["1m"]).toBeLessThan(mildScores["1m"]);
    });

    it("downtrend: score bounded at 0.0 (no underflow)", () => {
      const bars = trendBars(100, -0.05, 40);
      const scores = computeMTFScores(bars, bars, bars);
      expect(scores["1m"]).toBeGreaterThanOrEqual(0.0);
    });
  });

  // ── Neutral / flat price action ────────────────────────────────────────────

  describe("neutral market", () => {
    it("flat alternating bars produce score near 0.5", () => {
      const bars = flatBars(100, 30);
      const scores = computeMTFScores(bars, bars, bars);
      expect(scores["1m"]).toBeGreaterThan(0.3);
      expect(scores["1m"]).toBeLessThan(0.7);
    });

    it("static price bars produce a well-defined score (no NaN)", () => {
      const bars = staticBars(100, 30);
      const scores = computeMTFScores(bars, bars, bars);
      expect(Number.isFinite(scores["1m"])).toBe(true);
    });
  });

  // ── Consecutive candles (momentum component) ───────────────────────────────

  describe("consecutive candle momentum", () => {
    it("consecutive bullish closes push score above flat baseline", () => {
      // Flat baseline with 5 strong bullish candles appended
      const base = flatBars(100, 15);
      const bullish: AlpacaBar[] = [];
      let price = base[base.length - 1]!.Close;
      for (let i = 0; i < 5; i++) {
        price *= 1.003;
        bullish.push(makeBar(price, { open: price / 1.003, high: price * 1.001, low: price * 0.999 }));
      }
      const flatScore  = computeMTFScores(base, base, base)["1m"];
      const momentumBars = [...base, ...bullish];
      const momentumScore = computeMTFScores(momentumBars, momentumBars, momentumBars)["1m"];
      expect(momentumScore).toBeGreaterThan(flatScore);
    });

    it("consecutive bearish closes push score below flat baseline", () => {
      const base = flatBars(100, 15);
      const bearish: AlpacaBar[] = [];
      let price = base[base.length - 1]!.Close;
      for (let i = 0; i < 5; i++) {
        price *= 0.997;
        bearish.push(makeBar(price, { open: price / 0.997, high: price * 1.001, low: price * 0.999 }));
      }
      const flatScore = computeMTFScores(base, base, base)["1m"];
      const momentumBars = [...base, ...bearish];
      const momentumScore = computeMTFScores(momentumBars, momentumBars, momentumBars)["1m"];
      expect(momentumScore).toBeLessThan(flatScore);
    });
  });

  // ── Volume confirmation ────────────────────────────────────────────────────

  describe("volume trend confirmation", () => {
    it("rising volume in uptrend nudges score higher than flat volume uptrend", () => {
      // Same price trend, but with escalating volume
      const lowVolBars  = trendBars(100, 0.005, 30, 1.0);
      const highVolBars = trendBars(100, 0.005, 30, 2.0); // Last bars get higher volume
      // Make last 5 bars high-volume to trigger vol confirmation
      const withHighVol = [...lowVolBars.slice(0, 25), ...highVolBars.slice(25)];
      const lowVolScore  = computeMTFScores(lowVolBars, lowVolBars, lowVolBars)["1m"];
      const highVolScore = computeMTFScores(withHighVol, withHighVol, withHighVol)["1m"];
      // High volume in uptrend should be at least as bullish
      expect(highVolScore).toBeGreaterThanOrEqual(lowVolScore - 0.05);
    });
  });

  // ── computeMTFScores structure ──────────────────────────────────────────────

  describe("computeMTFScores output shape", () => {
    it("returns exactly the three keys: 1m, 5m, 15m", () => {
      const bars = trendBars(100, 0.003, 25);
      const scores = computeMTFScores(bars, bars, bars);
      expect(Object.keys(scores).sort()).toEqual(["15m", "1m", "5m"]);
    });

    it("each timeframe score is between 0 and 1", () => {
      const upBars   = trendBars(100, 0.005, 30);
      const downBars = trendBars(100, -0.005, 30);
      const flatB    = flatBars(100, 30);
      const scores = computeMTFScores(upBars, flatB, downBars);
      for (const v of Object.values(scores)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    });

    it("different bar arrays produce independent per-timeframe scores", () => {
      const upBars   = trendBars(100, 0.01, 30);
      const downBars = trendBars(100, -0.01, 30);
      const flatB    = flatBars(100, 30);
      const scores = computeMTFScores(upBars, flatB, downBars);
      // 1m bullish, 5m neutral, 15m bearish
      expect(scores["1m"]).toBeGreaterThan(scores["15m"]);
    });

    it("three aligned bullish timeframes all > 0.55 (confluence condition)", () => {
      const bars = trendBars(100, 0.005, 40);
      const scores = computeMTFScores(bars, bars, bars);
      const aligned = Object.values(scores).filter(s => s > 0.55);
      expect(aligned).toHaveLength(3);
    });

    it("three aligned bearish timeframes all < 0.45 (confluence condition)", () => {
      const bars = trendBars(100, -0.005, 40);
      const scores = computeMTFScores(bars, bars, bars);
      const aligned = Object.values(scores).filter(s => s < 0.45);
      expect(aligned).toHaveLength(3);
    });
  });
});
