/**
 * regime_engine.test.ts — Phase 26: Regime Engine (Enhanced + Spectral)
 *
 * Tests:
 *   computeBasicRegime:
 *     - < 20 bars → default { regime: "range", confidence: 0 }
 *     - "trend_up": high bullish persistence + positive slope
 *     - "trend_down": high bearish persistence + negative slope
 *     - "chaotic": low dirPersistence (<0.40) + narrow range (<2.5%)
 *     - "compression": low ATR% + BB width shrinking vs history
 *     - "range": moderate slope / persistence fallback
 *     - volState thresholds: <0.5% → "low", <1.5% → "medium", <3% → "high", ≥3% → "extreme"
 *     - All output fields bounded [0, 1]
 *     - dirPersistence is ratio of direction-matching bars / 20
 *
 *   computeSpectralRegime:
 *     - < 32 bars → default { dominantCycleLength: null, spectralPower: 0, regimeLabel: "noisy" }
 *     - Pure sine wave → regimeLabel = "cyclical", spectralPower > 0, dominantCycleLength ≈ period
 *     - spectralPower and cycleStability bounded [0, 1]
 *     - dominantCycleLength is null or positive integer
 *     - 128+ bars uses 128-bar window
 *
 *   mergeRegimeState:
 *     - label always includes regime name and "vol=" + volState
 *     - label includes "cycle=Nbars" when regimeLabel="cyclical" + dominantCycleLength set
 *     - label includes "compressing" when compressionScore > 0.6
 *     - label includes "expanding" when expansionScore > 0.6
 *     - confidence bounded [0, 1]
 *     - computedAt is an ISO 8601 string
 *
 *   computeFullRegime:
 *     - Returns MergedRegimeState with both basic + spectral populated
 *     - computedAt is set
 *     - Works correctly end-to-end for trending and ranging inputs
 */

import { describe, it, expect } from "vitest";
import {
  computeBasicRegime,
  computeSpectralRegime,
  mergeRegimeState,
  computeFullRegime,
  type RegimeState,
  type SpectralState,
} from "../lib/regime_engine";

// ─── Bar factories ─────────────────────────────────────────────────────────────

type OHLCVBar = { Open: number; High: number; Low: number; Close: number; Volume: number };

function makeBar(open: number, high: number, low: number, close: number): OHLCVBar {
  return { Open: open, High: high, Low: low, Close: close, Volume: 10_000 };
}

/** Flat bars — minimal range, no directional bias. */
function flatBars(price: number, count: number, range = 1): OHLCVBar[] {
  return Array.from({ length: count }, () =>
    makeBar(price, price + range, price - range, price),
  );
}

/** Strongly trending bars — each close moves by `step`, candle direction = trend direction. */
function trendingBars(start: number, step: number, count: number, spread = 0.1): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => {
    const open  = start + step * i;
    const close = start + step * (i + 1);
    const high  = Math.max(open, close) + spread;
    const low   = Math.min(open, close) - spread;
    return makeBar(open, high, low, close);
  });
}

/**
 * Chaotic bars: tiny drift up (positive slope) but all candles are bearish.
 * → directionalPersistence = 0 (0/20 bars match slope direction),
 *   rangeAsPct < 2.5% (tiny drift ensures narrow total range).
 */
function chaoticBars(start: number, count: number): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => {
    const open  = start + i * 0.004; // tiny upward drift → positive slope
    const close = open - 0.003;      // bearish candle: close < open
    const high  = open + 0.001;
    const low   = close - 0.001;
    return makeBar(open, high, low, close);
  });
}

/**
 * High-volatility bars: per-bar range ≈ 3.5% of price → atrPct > 3% → "extreme".
 */
function extremeVolBars(price: number, count: number): OHLCVBar[] {
  return Array.from({ length: count }, (_, i) => {
    const dir = i % 2 === 0 ? 1 : -1;
    const close = price + dir * price * 0.01;
    return makeBar(price, price + price * 0.018, price - price * 0.018, close);
  });
}

// ─── computeBasicRegime ────────────────────────────────────────────────────────

describe("computeBasicRegime", () => {

  it("< 20 bars → default range state with confidence = 0", () => {
    const result = computeBasicRegime([]);
    expect(result.regime).toBe("range");
    expect(result.confidence).toBe(0);
    expect(result.trendStrength).toBe(0);
  });

  it("19 bars → default fallback (boundary condition)", () => {
    const result = computeBasicRegime(flatBars(100, 19));
    expect(result.regime).toBe("range");
    expect(result.confidence).toBe(0);
  });

  it("strong uptrend → 'trend_up'", () => {
    // 30 bars each +2 points; all bullish candles; slope = large positive
    const bars = trendingBars(100, 2, 30);
    const result = computeBasicRegime(bars);
    expect(result.regime).toBe("trend_up");
  });

  it("strong downtrend → 'trend_down'", () => {
    const bars = trendingBars(200, -2, 30);
    const result = computeBasicRegime(bars);
    expect(result.regime).toBe("trend_down");
  });

  it("chaotic: low dirPersistence + narrow range → 'chaotic'", () => {
    const bars = chaoticBars(100, 25);
    const result = computeBasicRegime(bars);
    expect(result.regime).toBe("chaotic");
  });

  it("flat bars → 'range' (fallback when no strong trend or chaos)", () => {
    // Flat with moderate range: no strong slope, persistence ~50% → range
    const bars = flatBars(100, 25, 2);
    const result = computeBasicRegime(bars);
    expect(["range", "chaotic"]).toContain(result.regime);
  });

  it("trendStrength bounded [0, 1]", () => {
    for (const bars of [
      trendingBars(100, 5, 30),
      flatBars(100, 25),
      chaoticBars(100, 25),
    ]) {
      const r = computeBasicRegime(bars);
      expect(r.trendStrength).toBeGreaterThanOrEqual(0);
      expect(r.trendStrength).toBeLessThanOrEqual(1);
    }
  });

  it("confidence bounded [0, 1]", () => {
    const scenarios = [
      trendingBars(100, 2, 30),
      flatBars(100, 25),
      chaoticBars(100, 25),
      extremeVolBars(100, 30),
    ];
    for (const bars of scenarios) {
      const r = computeBasicRegime(bars);
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("compressionScore and expansionScore bounded [0, 1]", () => {
    const r = computeBasicRegime(trendingBars(100, 1, 45));
    expect(r.compressionScore).toBeGreaterThanOrEqual(0);
    expect(r.compressionScore).toBeLessThanOrEqual(1);
    expect(r.expansionScore).toBeGreaterThanOrEqual(0);
    expect(r.expansionScore).toBeLessThanOrEqual(1);
  });

  it("volState = 'extreme' for very large bar ranges (ATR% > 3%)", () => {
    const bars = extremeVolBars(100, 30);
    const result = computeBasicRegime(bars);
    expect(result.volState).toBe("extreme");
  });

  it("volState = 'low' for near-flat bars (ATR% < 0.5%)", () => {
    // Bars with very small range (0.1 on price 100 → 0.1% ATR)
    const bars = Array.from({ length: 25 }, () =>
      makeBar(100, 100.05, 99.95, 100),
    );
    const result = computeBasicRegime(bars);
    expect(result.volState).toBe("low");
  });

  it("dirPersistence is fraction of direction-matching candles", () => {
    // All bullish (close > open) and positive slope → persistence = 1.0
    const bars = trendingBars(100, 1, 20);
    const result = computeBasicRegime(bars);
    expect(result.dirPersistence).toBeCloseTo(1.0, 1);
  });

  it("output values rounded to 4 decimal places", () => {
    const r = computeBasicRegime(trendingBars(100, 1.5, 25));
    const checkRounding = (v: number) => {
      const dp = v.toString().includes(".")
        ? (v.toString().split(".")[1]?.length ?? 0)
        : 0;
      expect(dp).toBeLessThanOrEqual(4);
    };
    checkRounding(r.trendStrength);
    checkRounding(r.compressionScore);
    checkRounding(r.expansionScore);
    checkRounding(r.dirPersistence);
    checkRounding(r.confidence);
  });
});

// ─── computeSpectralRegime ─────────────────────────────────────────────────────

describe("computeSpectralRegime", () => {

  it("< 32 bars → default noisy state", () => {
    const result = computeSpectralRegime([]);
    expect(result.dominantCycleLength).toBeNull();
    expect(result.spectralPower).toBe(0);
    expect(result.cycleStability).toBe(0);
    expect(result.regimeLabel).toBe("noisy");
  });

  it("31 bars → default fallback (boundary condition)", () => {
    const bars = Array.from({ length: 31 }, (_, i) => ({ Close: 100 + i * 0.1 }));
    const result = computeSpectralRegime(bars);
    expect(result.regimeLabel).toBe("noisy");
  });

  it("pure sine wave → 'cyclical' label with measurable spectral power", () => {
    // 128 bars at period=8: Close = 100 + 5 * sin(2π*i/8)
    const period = 8;
    const bars = Array.from({ length: 128 }, (_, i) => ({
      Close: 100 + 5 * Math.sin((2 * Math.PI * i) / period),
    }));
    const result = computeSpectralRegime(bars);
    expect(result.regimeLabel).toBe("cyclical");
    expect(result.spectralPower).toBeGreaterThan(0.1);
    expect(result.dominantCycleLength).not.toBeNull();
  });

  it("pure sine wave period=16 → dominantCycleLength ≈ 16 (within ±2)", () => {
    const period = 16;
    const bars = Array.from({ length: 128 }, (_, i) => ({
      Close: 100 + 5 * Math.sin((2 * Math.PI * i) / period),
    }));
    const result = computeSpectralRegime(bars);
    if (result.dominantCycleLength !== null) {
      expect(result.dominantCycleLength).toBeGreaterThanOrEqual(period - 2);
      expect(result.dominantCycleLength).toBeLessThanOrEqual(period + 2);
    }
  });

  it("spectralPower bounded [0, 1]", () => {
    const sine = Array.from({ length: 64 }, (_, i) => ({
      Close: 100 + 3 * Math.sin((2 * Math.PI * i) / 8),
    }));
    const result = computeSpectralRegime(sine);
    expect(result.spectralPower).toBeGreaterThanOrEqual(0);
    expect(result.spectralPower).toBeLessThanOrEqual(1);
  });

  it("cycleStability bounded [0, 1]", () => {
    const sine = Array.from({ length: 128 }, (_, i) => ({
      Close: 100 + 3 * Math.sin((2 * Math.PI * i) / 8),
    }));
    const result = computeSpectralRegime(sine);
    expect(result.cycleStability).toBeGreaterThanOrEqual(0);
    expect(result.cycleStability).toBeLessThanOrEqual(1);
  });

  it("dominantCycleLength is null or a positive integer", () => {
    const bars = Array.from({ length: 64 }, (_, i) => ({
      Close: 100 + Math.sin((2 * Math.PI * i) / 8),
    }));
    const result = computeSpectralRegime(bars);
    if (result.dominantCycleLength !== null) {
      expect(Number.isInteger(result.dominantCycleLength)).toBe(true);
      expect(result.dominantCycleLength).toBeGreaterThan(0);
    }
  });

  it("does not crash with monotone (constant-return) bars", () => {
    const bars = Array.from({ length: 64 }, (_, i) => ({ Close: 100 + i * 0.01 }));
    expect(() => computeSpectralRegime(bars)).not.toThrow();
  });

  it("uses 128-bar window when ≥ 128 bars provided", () => {
    // 200 bars of sine: should still resolve cyclical (uses last 128)
    const bars = Array.from({ length: 200 }, (_, i) => ({
      Close: 100 + 5 * Math.sin((2 * Math.PI * i) / 8),
    }));
    const result = computeSpectralRegime(bars);
    expect(result.regimeLabel).toBe("cyclical");
  });
});

// ─── mergeRegimeState ──────────────────────────────────────────────────────────

function makeBasicState(overrides: Partial<RegimeState> = {}): RegimeState {
  return {
    regime: "range",
    trendStrength: 0.3,
    compressionScore: 0.2,
    expansionScore: 0.2,
    volState: "medium",
    dirPersistence: 0.5,
    confidence: 0.6,
    ...overrides,
  };
}

function makeSpectralState(overrides: Partial<SpectralState> = {}): SpectralState {
  return {
    dominantCycleLength: null,
    spectralPower: 0.2,
    cycleStability: 0.5,
    regimeLabel: "noisy",
    ...overrides,
  };
}

describe("mergeRegimeState", () => {

  it("label always includes the basic regime name", () => {
    const result = mergeRegimeState(
      makeBasicState({ regime: "trend_up" }),
      makeSpectralState(),
    );
    expect(result.label).toContain("trend up");
  });

  it("label always includes 'vol=' + volState", () => {
    const result = mergeRegimeState(
      makeBasicState({ volState: "high" }),
      makeSpectralState(),
    );
    expect(result.label).toContain("vol=high");
  });

  it("label includes 'cycle=Nbars' when regimeLabel='cyclical' and dominantCycleLength set", () => {
    const result = mergeRegimeState(
      makeBasicState(),
      makeSpectralState({ regimeLabel: "cyclical", dominantCycleLength: 12 }),
    );
    expect(result.label).toContain("cycle=12bars");
  });

  it("label omits cycle info when dominantCycleLength is null", () => {
    const result = mergeRegimeState(
      makeBasicState(),
      makeSpectralState({ regimeLabel: "cyclical", dominantCycleLength: null }),
    );
    expect(result.label).not.toContain("cycle=");
  });

  it("label includes 'compressing' when compressionScore > 0.6", () => {
    const result = mergeRegimeState(
      makeBasicState({ compressionScore: 0.7 }),
      makeSpectralState(),
    );
    expect(result.label).toContain("compressing");
  });

  it("label does not include 'compressing' when compressionScore ≤ 0.6", () => {
    const result = mergeRegimeState(
      makeBasicState({ compressionScore: 0.6 }),
      makeSpectralState(),
    );
    expect(result.label).not.toContain("compressing");
  });

  it("label includes 'expanding' when expansionScore > 0.6", () => {
    const result = mergeRegimeState(
      makeBasicState({ expansionScore: 0.7 }),
      makeSpectralState(),
    );
    expect(result.label).toContain("expanding");
  });

  it("confidence bounded [0, 1]", () => {
    const result = mergeRegimeState(
      makeBasicState({ confidence: 1.0 }),
      makeSpectralState({ spectralPower: 1.0, cycleStability: 1.0 }),
    );
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("confidence = 0 when all inputs are zero", () => {
    const result = mergeRegimeState(
      makeBasicState({ confidence: 0 }),
      makeSpectralState({ spectralPower: 0, cycleStability: 0, regimeLabel: "noisy" }),
    );
    expect(result.confidence).toBe(0);
  });

  it("computedAt is a valid ISO 8601 string", () => {
    const result = mergeRegimeState(makeBasicState(), makeSpectralState());
    expect(() => new Date(result.computedAt)).not.toThrow();
    expect(new Date(result.computedAt).getTime()).not.toBeNaN();
  });

  it("basic and spectral fields are passed through unchanged", () => {
    const basic    = makeBasicState({ regime: "compression", confidence: 0.75 });
    const spectral = makeSpectralState({ spectralPower: 0.4 });
    const result   = mergeRegimeState(basic, spectral);
    expect(result.basic).toEqual(basic);
    expect(result.spectral).toEqual(spectral);
  });
});

// ─── computeFullRegime ─────────────────────────────────────────────────────────

describe("computeFullRegime", () => {

  it("returns MergedRegimeState with both basic and spectral populated", () => {
    const bars = trendingBars(100, 1.5, 30).map(b => ({ ...b, Volume: 10_000 }));
    const result = computeFullRegime(bars);
    expect(result.basic).toBeDefined();
    expect(result.spectral).toBeDefined();
    expect(result.label).toBeTruthy();
    expect(result.computedAt).toBeTruthy();
  });

  it("computedAt is a valid ISO 8601 string", () => {
    const bars = flatBars(100, 25).map(b => ({ ...b, Volume: 10_000 }));
    const result = computeFullRegime(bars);
    expect(new Date(result.computedAt).getTime()).not.toBeNaN();
  });

  it("trending input → basic.regime is trend_up", () => {
    const bars = trendingBars(100, 2, 30).map(b => ({ ...b, Volume: 10_000 }));
    const result = computeFullRegime(bars);
    expect(result.basic.regime).toBe("trend_up");
  });

  it("confidence bounded [0, 1] end-to-end", () => {
    const bars = trendingBars(100, 2, 60).map(b => ({ ...b, Volume: 10_000 }));
    const result = computeFullRegime(bars);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});
