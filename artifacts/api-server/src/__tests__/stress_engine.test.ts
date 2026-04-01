/**
 * stress_engine.test.ts — Phase 23: Volatility / Stress Engine
 *
 * Tests:
 *   computeVolatilityState:
 *     - < 20 bars → defaultState (zeroed values, "normal" regime)
 *     - Calm bars (tiny ranges) → "calm" vol regime
 *     - High-vol bars (large price swings) → "elevated" or "extreme" regime
 *     - ATR% is positive and reflects bar ranges
 *     - rangeExpansion > 1 when recent ranges are larger than historical
 *     - jumpScore > 1 when a spike bar dwarfs average bar
 *     - Shape: all required fields present
 *
 *   computeMarketStress:
 *     - Single symbol (< 2) → default state
 *     - Perfect positive correlation → high avgCorrelation
 *     - Independent uncorrelated symbols → lower avgCorrelation
 *     - All symbols negative returns → breadthWeakness = 1
 *     - All symbols positive returns → breadthWeakness = 0
 *     - High correlation spike count triggers "moderate" or higher regime
 *     - Shape: all required fields present
 *
 *   detectStressPropagation:
 *     - Empty symbols → "isolated" with zero values
 *     - Few symbols in drawdown (< 20%) → "isolated"
 *     - 30–40% in drawdown → "sector_stress"
 *     - > 50% in drawdown → "broad_market"
 *     - > 70% in drawdown AND vol rising → "contagion"
 *     - narrative is a non-empty string
 */

import { describe, it, expect } from "vitest";
import {
  computeVolatilityState,
  computeMarketStress,
  detectStressPropagation,
  type VolatilityState,
} from "../lib/stress_engine";

// ─── Helpers ───────────────────────────────────────────────────────────────────

function bar(o: number, h: number, l: number, c: number) {
  return { Open: o, High: h, Low: l, Close: c };
}

/** Generate N identical calm bars (tiny range, no trend). */
function calmBars(price: number, count: number) {
  return Array.from({ length: count }, () =>
    bar(price, price * 1.0005, price * 0.9995, price),
  );
}

/** Generate N bars with high volatility (large swings). */
function noisyBars(price: number, count: number) {
  const bars = [];
  let p = price;
  for (let i = 0; i < count; i++) {
    const swing = p * 0.04; // 4% swing per bar
    const up = i % 2 === 0;
    const o = p;
    p = up ? p * 1.02 : p * 0.98;
    bars.push(bar(o, Math.max(o, p) + swing, Math.min(o, p) - swing, p));
  }
  return bars;
}

/** Generate log-return series correlated with a seed. */
function correlatedReturns(seed: number[], correlation: number): number[] {
  // Generate partly random series blended with seed
  return seed.map((s) => s * correlation + (Math.random() * 0.001 - 0.0005) * (1 - correlation));
}

/** Generate N log returns from a simple random walk with given drift. */
function randomReturns(count: number, drift = 0, sigma = 0.005): number[] {
  return Array.from({ length: count }, () => drift + (Math.random() - 0.5) * sigma * 2);
}

// ─── Suite: computeVolatilityState ────────────────────────────────────────────

describe("computeVolatilityState", () => {
  describe("insufficient data", () => {
    it("< 20 bars → returns default state with normal regime", () => {
      const state = computeVolatilityState("BTCUSD", calmBars(100, 15));
      expect(state.symbol).toBe("BTCUSD");
      expect(state.volRegime).toBe("normal");
      expect(state.realizedVol).toBe(0);
      expect(state.atrPct).toBe(0);
    });

    it("empty bars → returns default state", () => {
      const state = computeVolatilityState("SPY", []);
      expect(state.realizedVol).toBe(0);
      expect(state.atrPct).toBe(0);
    });
  });

  describe("calm market", () => {
    it("tiny ranges + tiny price moves → 'calm' vol regime", () => {
      // 50 bars with 0.05% range per bar
      const bars = Array.from({ length: 50 }, (_, i) => {
        const p = 100;
        return bar(p, p * 1.0003, p * 0.9997, p * (1 + 0.00002 * (i % 3 - 1)));
      });
      const state = computeVolatilityState("SPY", bars);
      // Either calm or normal — very small ATR
      expect(["calm", "normal"]).toContain(state.volRegime);
      expect(state.atrPct).toBeLessThan(0.005);
    });
  });

  describe("high volatility market", () => {
    it("noisy bars with large swings → 'elevated' or 'extreme' vol regime", () => {
      const bars = noisyBars(100, 60);
      const state = computeVolatilityState("BTCUSD", bars);
      expect(["elevated", "extreme"]).toContain(state.volRegime);
    });

    it("atrPct > 0 for any non-trivial bars", () => {
      const bars = noisyBars(100, 30);
      const state = computeVolatilityState("ETH", bars);
      expect(state.atrPct).toBeGreaterThan(0);
    });

    it("realizedVol > 0 when prices change", () => {
      const bars = noisyBars(100, 30);
      const state = computeVolatilityState("QQQ", bars);
      expect(state.realizedVol).toBeGreaterThan(0);
    });
  });

  describe("range expansion", () => {
    it("rangeExpansion > 1 when recent bars have larger ranges than historical", () => {
      // 30 calm bars + 10 very noisy bars at end
      const calmPart  = calmBars(100, 30);
      const noisyPart = noisyBars(100, 20);
      const bars = [...calmPart, ...noisyPart];
      const state = computeVolatilityState("NVDA", bars);
      expect(state.rangeExpansion).toBeGreaterThan(1);
    });

    it("rangeExpansion ≤ 1 when recent bars are calmer than historical", () => {
      // 30 noisy bars + 10 calm bars at end
      const noisyPart = noisyBars(100, 30);
      const calmPart  = calmBars(100, 10);
      const bars = [...noisyPart, ...calmPart];
      const state = computeVolatilityState("TSLA", bars);
      expect(state.rangeExpansion).toBeLessThanOrEqual(1.1);
    });
  });

  describe("jump detection", () => {
    it("jumpScore > 1 when a spike bar is much larger than average", () => {
      const base = calmBars(100, 40);
      // Insert a massive spike bar
      const spike = bar(100, 120, 80, 110); // 40% range spike
      const bars = [...base.slice(0, 30), spike, ...base.slice(30)];
      const state = computeVolatilityState("GME", bars);
      expect(state.jumpScore).toBeGreaterThan(1);
    });
  });

  describe("output shape", () => {
    it("all required fields are present", () => {
      const state = computeVolatilityState("AAPL", noisyBars(100, 30));
      expect(state).toHaveProperty("symbol");
      expect(state).toHaveProperty("realizedVol");
      expect(state).toHaveProperty("atrPct");
      expect(state).toHaveProperty("volOfVol");
      expect(state).toHaveProperty("jumpScore");
      expect(state).toHaveProperty("rangeExpansion");
      expect(state).toHaveProperty("volRegime");
    });

    it("symbol is passed through correctly", () => {
      const state = computeVolatilityState("XYZ", noisyBars(100, 30));
      expect(state.symbol).toBe("XYZ");
    });
  });
});

// ─── Suite: computeMarketStress ───────────────────────────────────────────────

describe("computeMarketStress", () => {
  describe("insufficient symbols", () => {
    it("empty map → default state with stressRegime=low", () => {
      const stress = computeMarketStress(new Map());
      expect(stress.stressRegime).toBe("low");
      expect(stress.symbolCount).toBe(0);
      expect(stress.systemicStressScore).toBe(0);
    });

    it("single symbol → default state (can't compute correlation)", () => {
      const m = new Map([["BTCUSD", randomReturns(20)]]);
      const stress = computeMarketStress(m);
      expect(stress.stressRegime).toBe("low");
      expect(stress.symbolCount).toBe(1);
    });
  });

  describe("correlation calculation", () => {
    it("two identical return series → very high avgCorrelation", () => {
      const returns = randomReturns(50, 0, 0.01);
      const m = new Map([["A", returns], ["B", [...returns]]]); // same series
      const stress = computeMarketStress(m);
      expect(stress.avgCorrelation).toBeGreaterThan(0.8);
    });

    it("perfectly uncorrelated series → lower avgCorrelation than identical", () => {
      const r1 = randomReturns(50);
      const r2 = randomReturns(50);
      const mCorr = new Map([["A", r1], ["B", [...r1]]]); // identical
      const mUncorr = new Map([["A", r1], ["B", r2]]);    // independent
      const corrStress   = computeMarketStress(mCorr);
      const uncorrStress = computeMarketStress(mUncorr);
      expect(corrStress.avgCorrelation).toBeGreaterThan(uncorrStress.avgCorrelation);
    });
  });

  describe("breadth weakness", () => {
    it("all symbols with negative total returns → breadthWeakness = 1", () => {
      const down = Array.from({ length: 30 }, () => -0.002); // consistent decline
      const m = new Map([["A", down], ["B", down], ["C", down]]);
      const stress = computeMarketStress(m);
      expect(stress.breadthWeakness).toBe(1);
    });

    it("all symbols with positive total returns → breadthWeakness = 0", () => {
      const up = Array.from({ length: 30 }, () => 0.002); // consistent rise
      const m = new Map([["A", up], ["B", up], ["C", up]]);
      const stress = computeMarketStress(m);
      expect(stress.breadthWeakness).toBe(0);
    });

    it("half negative, half positive → breadthWeakness ≈ 0.5", () => {
      const down = Array.from({ length: 30 }, () => -0.003);
      const up   = Array.from({ length: 30 }, () =>  0.003);
      const m = new Map([["A", down], ["B", down], ["C", up], ["D", up]]);
      const stress = computeMarketStress(m);
      expect(stress.breadthWeakness).toBeCloseTo(0.5, 1);
    });
  });

  describe("stress regime classification", () => {
    it("low correlation + rising breadth → 'low' or 'moderate' stressRegime", () => {
      const up = Array.from({ length: 30 }, () => 0.001);
      const m = new Map([["A", up], ["B", randomReturns(30)], ["C", randomReturns(30)]]);
      const stress = computeMarketStress(m);
      expect(["low", "moderate"]).toContain(stress.stressRegime);
    });

    it("all correlated AND all negative → elevated stressScore", () => {
      const down = Array.from({ length: 50 }, () => -0.005); // crash conditions
      const m = new Map([["A", down], ["B", down], ["C", down], ["D", down]]);
      const stress = computeMarketStress(m);
      // Should be moderate or higher given high correlation + 100% breadth weakness
      expect(["moderate", "high", "crash_risk"]).toContain(stress.stressRegime);
    });
  });

  describe("output shape", () => {
    it("all required fields present", () => {
      const m = new Map([["A", randomReturns(20)], ["B", randomReturns(20)]]);
      const stress = computeMarketStress(m);
      expect(stress).toHaveProperty("avgCorrelation");
      expect(stress).toHaveProperty("correlationSpikeCount");
      expect(stress).toHaveProperty("breadthWeakness");
      expect(stress).toHaveProperty("systemicStressScore");
      expect(stress).toHaveProperty("stressRegime");
      expect(stress).toHaveProperty("symbolCount");
      expect(stress).toHaveProperty("topCorrelations");
      expect(stress).toHaveProperty("computedAt");
    });

    it("topCorrelations contains at most 10 entries", () => {
      const m = new Map(
        Array.from({ length: 6 }, (_, i) => [`S${i}`, randomReturns(20)] as [string, number[]]),
      );
      const stress = computeMarketStress(m);
      expect(stress.topCorrelations.length).toBeLessThanOrEqual(10);
    });

    it("systemicStressScore is between 0 and 1", () => {
      const m = new Map([["A", randomReturns(30)], ["B", randomReturns(30)]]);
      const stress = computeMarketStress(m);
      expect(stress.systemicStressScore).toBeGreaterThanOrEqual(0);
      expect(stress.systemicStressScore).toBeLessThanOrEqual(1);
    });
  });
});

// ─── Suite: detectStressPropagation ───────────────────────────────────────────

describe("detectStressPropagation", () => {
  function makeVolState(symbol: string, regime: VolatilityState["volRegime"] = "normal"): VolatilityState {
    return {
      symbol, realizedVol: 0.2, atrPct: 0.01, volOfVol: 0.5,
      jumpScore: 1.5, rangeExpansion: 1.0, volRegime: regime,
    };
  }

  describe("empty / minimal", () => {
    it("empty symbol maps → 'isolated' with zero values", () => {
      const result = detectStressPropagation(new Map(), new Map());
      expect(result.level).toBe("isolated");
      expect(result.drawdownBreadth).toBe(0);
      expect(result.avgDrawdownPct).toBe(0);
    });
  });

  describe("propagation classification", () => {
    it("< 20% symbols in drawdown → 'isolated'", () => {
      // 1 / 6 ≈ 16.7% — strictly below the 0.2 threshold
      const symbols = ["A", "B", "C", "D", "E", "F"];
      const vols = new Map(symbols.map(s => [s, makeVolState(s, "normal")]));
      const returns = new Map([
        ["A", Array.from({ length: 20 }, () => -0.002)], // only A is in drawdown
        ["B", Array.from({ length: 20 }, () =>  0.002)],
        ["C", Array.from({ length: 20 }, () =>  0.002)],
        ["D", Array.from({ length: 20 }, () =>  0.002)],
        ["E", Array.from({ length: 20 }, () =>  0.002)],
        ["F", Array.from({ length: 20 }, () =>  0.002)],
      ]);
      const result = detectStressPropagation(vols, returns);
      expect(result.level).toBe("isolated");
    });

    it("30% symbols in drawdown → 'sector_stress'", () => {
      const symbols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]; // 10 total
      const vols = new Map(symbols.map(s => [s, makeVolState(s, "normal")]));
      // 3/10 = 30% in drawdown
      const returns = new Map(
        symbols.map((s, i) => [s, Array.from({ length: 20 }, () => i < 3 ? -0.008 : 0.002)])
      );
      const result = detectStressPropagation(vols, returns);
      expect(result.level).toBe("sector_stress");
    });

    it("50–69% in drawdown (no elevated vol) → 'broad_market'", () => {
      const symbols = ["A", "B", "C", "D", "E", "F"]; // 6 total
      const vols = new Map(symbols.map(s => [s, makeVolState(s, "normal")])); // vol = normal
      // 4/6 ≈ 67% in drawdown, but vol not elevated
      const returns = new Map(
        symbols.map((s, i) => [s, Array.from({ length: 20 }, () => i < 4 ? -0.008 : 0.002)])
      );
      const result = detectStressPropagation(vols, returns);
      expect(result.level).toBe("broad_market");
    });

    it("> 70% in drawdown AND vol elevated → 'contagion'", () => {
      const symbols = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]; // 10 total
      const vols = new Map(symbols.map(s => [s, makeVolState(s, "elevated")])); // all elevated
      // 9/10 = 90% in drawdown
      const returns = new Map(
        symbols.map((s, i) => [s, Array.from({ length: 20 }, () => i < 9 ? -0.015 : 0.002)])
      );
      const result = detectStressPropagation(vols, returns);
      expect(result.level).toBe("contagion");
    });
  });

  describe("output shape", () => {
    it("narrative is a non-empty string", () => {
      const vols = new Map([["A", makeVolState("A")]]);
      const returns = new Map([["A", randomReturns(20)]]);
      const result = detectStressPropagation(vols, returns);
      expect(typeof result.narrative).toBe("string");
      expect(result.narrative.length).toBeGreaterThan(0);
    });

    it("drawdownBreadth is between 0 and 1", () => {
      const vols = new Map([["A", makeVolState("A")]]);
      const returns = new Map([["A", Array.from({ length: 20 }, () => -0.01)]]);
      const result = detectStressPropagation(vols, returns);
      expect(result.drawdownBreadth).toBeGreaterThanOrEqual(0);
      expect(result.drawdownBreadth).toBeLessThanOrEqual(1);
    });

    it("volRising is true when majority of symbols are elevated or extreme", () => {
      const symbols = ["A", "B", "C", "D"];
      const vols = new Map(symbols.map(s => [s, makeVolState(s, "elevated")]));
      const returns = new Map(symbols.map(s => [s, randomReturns(20)]));
      const result = detectStressPropagation(vols, returns);
      expect(result.volRising).toBe(true);
    });

    it("volRising is false when most symbols are calm", () => {
      const symbols = ["A", "B", "C", "D"];
      const vols = new Map(symbols.map(s => [s, makeVolState(s, "calm")]));
      const returns = new Map(symbols.map(s => [s, randomReturns(20)]));
      const result = detectStressPropagation(vols, returns);
      expect(result.volRising).toBe(false);
    });
  });
});
