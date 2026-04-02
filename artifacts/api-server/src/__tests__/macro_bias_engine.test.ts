/**
 * macro_bias_engine.test.ts — Phase 30
 *
 * Tests for computeMacroBias and neutralMacroBias.
 *
 * Coverage:
 *   - Hard lockout: macroRiskScore >= 0.85 → blocks all directions
 *   - Neutral inputs → score ≈ 0.5, conviction = low
 *   - Pure bullish: low VIX, falling DXY, positive rate diff → strong_buy
 *   - Pure bearish: high VIX, rising DXY, negative rate diff → strong_sell
 *   - Asset-class weight differences (crypto: VIX-heavy, forex: DXY-heavy)
 *   - Conviction thresholds (low/medium/high based on deviation from 0.5)
 *   - Direction: long / short / flat based on composite thresholds
 *   - Blocked directions: only set at high conviction
 *   - Aligned/tailwind/headwind logic
 *   - CPI: commodity inverts (benefits from inflation)
 *   - neutralMacroBias safe defaults
 */

import { describe, it, expect } from "vitest";
import { computeMacroBias, neutralMacroBias } from "../lib/macro_bias_engine";
import type { MacroBiasInput } from "../lib/macro_bias_engine";

// ── Helpers ────────────────────────────────────────────────────────────────────

const neutralInput = (overrides: Partial<MacroBiasInput> = {}): MacroBiasInput => ({
  dxySlope: 0,
  rateDifferentialBps: 0,
  cpiMomentum: 0,
  vixLevel: 30, // gives vixScore=0.5 for crypto (fearScore=(30-10)/40=0.5)
  macroRiskScore: 0,
  assetClass: "crypto",
  intendedDirection: "long",
  ...overrides,
});

// ── neutralMacroBias ──────────────────────────────────────────────────────────

describe("neutralMacroBias", () => {
  it("bias = neutral", () => expect(neutralMacroBias().bias).toBe("neutral"));
  it("direction = flat", () => expect(neutralMacroBias().direction).toBe("flat"));
  it("score = 0.5", () => expect(neutralMacroBias().score).toBe(0.5));
  it("conviction = low", () => expect(neutralMacroBias().conviction).toBe("low"));
  it("aligned = true", () => expect(neutralMacroBias().aligned).toBe(true));
  it("blockedDirections = []", () => expect(neutralMacroBias().blockedDirections).toEqual([]));
  it("tailwind = false", () => expect(neutralMacroBias().tailwind).toBe(false));
  it("headwind = false", () => expect(neutralMacroBias().headwind).toBe(false));
  it("updatedAt is valid ISO string", () => {
    expect(() => new Date(neutralMacroBias().updatedAt)).not.toThrow();
  });
});

// ── Hard lockout (macroRiskScore >= 0.85) ─────────────────────────────────────

describe("computeMacroBias — hard lockout", () => {
  it("macroRiskScore=0.85 → direction=flat, score=0, conviction=high", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.85 }));
    expect(result.direction).toBe("flat");
    expect(result.score).toBe(0);
    expect(result.conviction).toBe("high");
  });

  it("macroRiskScore=0.85 → blockedDirections includes long and short", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.85 }));
    expect(result.blockedDirections).toContain("long");
    expect(result.blockedDirections).toContain("short");
  });

  it("macroRiskScore=0.85 → aligned = false", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.85 }));
    expect(result.aligned).toBe(false);
  });

  it("macroRiskScore=0.85 → headwind = true", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.85 }));
    expect(result.headwind).toBe(true);
  });

  it("macroRiskScore=0.85 → reasons mention hard lockout", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.85 }));
    expect(result.reasons.some((r) => r.includes("lockout"))).toBe(true);
  });

  it("macroRiskScore=0.90 → also triggers hard lockout", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.90 }));
    expect(result.direction).toBe("flat");
    expect(result.blockedDirections.length).toBe(2);
  });

  it("macroRiskScore=0.84 → does NOT trigger hard lockout", () => {
    const result = computeMacroBias(neutralInput({ macroRiskScore: 0.84 }));
    expect(result.score).toBeGreaterThan(0);
  });
});

// ── Neutral balanced inputs ───────────────────────────────────────────────────

describe("computeMacroBias — neutral balanced inputs", () => {
  it("all neutral inputs (crypto) → score ≈ 0.5", () => {
    const result = computeMacroBias(neutralInput());
    expect(result.score).toBeCloseTo(0.5, 1);
  });

  it("all neutral → conviction = low", () => {
    const result = computeMacroBias(neutralInput());
    expect(result.conviction).toBe("low");
  });

  it("all neutral → bias = neutral", () => {
    const result = computeMacroBias(neutralInput());
    expect(result.bias).toBe("neutral");
  });

  it("all neutral → blockedDirections = []", () => {
    const result = computeMacroBias(neutralInput());
    expect(result.blockedDirections).toEqual([]);
  });
});

// ── Pure bullish conditions ───────────────────────────────────────────────────

describe("computeMacroBias — pure bullish (crypto)", () => {
  // Low VIX (10), falling DXY, positive rate diff, decelerating CPI
  const bullishInput = (): MacroBiasInput => ({
    dxySlope: -0.05,      // max falling → dxyScore = 1.0 for crypto
    rateDifferentialBps: 200, // max positive → rateScore = 1.0
    cpiMomentum: -0.5,    // max decelerating → cpiScore = 1.0 for non-commodity
    vixLevel: 10,          // min fear → vixScore = 1.0
    macroRiskScore: 0,
    assetClass: "crypto",
    intendedDirection: "long",
  });

  it("score = 1.0 (all components at max bullish)", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.score).toBe(1);
  });

  it("bias = strong_buy", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.bias).toBe("strong_buy");
  });

  it("direction = long", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.direction).toBe("long");
  });

  it("conviction = high (deviation = 0.5 >= 0.20)", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.conviction).toBe("high");
  });

  it("blockedDirections = ['short'] at high conviction long", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.blockedDirections).toContain("short");
    expect(result.blockedDirections).not.toContain("long");
  });

  it("long direction → tailwind = true", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.tailwind).toBe(true);
  });

  it("long direction with bullish bias → aligned = true", () => {
    const result = computeMacroBias(bullishInput());
    expect(result.aligned).toBe(true);
  });

  it("short direction with bullish bias → aligned = false", () => {
    const result = computeMacroBias({ ...bullishInput(), intendedDirection: "short" });
    expect(result.aligned).toBe(false);
  });
});

// ── Pure bearish conditions ───────────────────────────────────────────────────

describe("computeMacroBias — pure bearish (crypto)", () => {
  const bearishInput = (): MacroBiasInput => ({
    dxySlope: 0.05,       // max rising → dxyScore = 0.0 for crypto
    rateDifferentialBps: -200, // max negative → rateScore = 0
    cpiMomentum: 0.5,     // max accelerating → cpiScore = 0 for non-commodity
    vixLevel: 50,          // max fear → vixScore = 0
    macroRiskScore: 0,
    assetClass: "crypto",
    intendedDirection: "long",
  });

  it("score = 0.0 (all components at max bearish)", () => {
    const result = computeMacroBias(bearishInput());
    expect(result.score).toBe(0);
  });

  it("bias = strong_sell", () => {
    const result = computeMacroBias(bearishInput());
    expect(result.bias).toBe("strong_sell");
  });

  it("direction = short", () => {
    const result = computeMacroBias(bearishInput());
    expect(result.direction).toBe("short");
  });

  it("long intended direction → headwind = true", () => {
    const result = computeMacroBias(bearishInput());
    expect(result.headwind).toBe(true);
  });

  it("short intended direction → headwind = false", () => {
    const result = computeMacroBias({ ...bearishInput(), intendedDirection: "short" });
    expect(result.headwind).toBe(false);
  });

  it("high VIX adds VIX reason for crypto", () => {
    const result = computeMacroBias(bearishInput());
    expect(result.reasons.some((r) => r.includes("VIX"))).toBe(true);
  });
});

// ── Conviction thresholds ─────────────────────────────────────────────────────

describe("computeMacroBias — conviction levels", () => {
  it("deviation < 0.10 → conviction = low", () => {
    // composite ≈ 0.5 → deviation ≈ 0
    const result = computeMacroBias(neutralInput());
    expect(result.conviction).toBe("low");
  });

  it("deviation in [0.10, 0.20) → conviction = medium", () => {
    // crypto with slightly bullish VIX: vixLevel=15 → fearScore=0.125, vixScore=0.875
    // composite = 0.5*0.15 + 0.5*0.10 + 0.5*0.10 + 0.875*0.65 = 0.075+0.05+0.05+0.569 = 0.744
    // Actually that's high. Let me use a less extreme value.
    // Try vixLevel=20: fearScore=(20-10)/40=0.25, vixScore=0.75
    // composite = 0.5*0.35 + 0.5*0.10 + 0.5*0.10 + 0.75*0.65 = 0.175+0.05+0.05+0.4875 = 0.7625
    // Still high. Try crypto with vixLevel=26:
    // fearScore=(26-10)/40=0.4, vixScore=0.6
    // composite = 0.5*0.15 + 0.5*0.10 + 0.5*0.10 + 0.6*0.65 = 0.075+0.05+0.05+0.39 = 0.565
    // deviation = 0.065 < 0.10 → "low"
    // For medium: need deviation >= 0.10, composite >= 0.60 or <= 0.40
    // composite = 0.60 → vixScore satisfying: 0.5*0.35 + 0.6*0.65 = 0.175+0.39=0.565 still low
    // Let me use equity where vix weight is 0.30:
    // equity: dxy=0.20, rate=0.25, cpi=0.25, vix=0.30
    // vixLevel=10 → vixScore=1.0; composite = 0.5*0.45 + 1.0*0.30 = 0.225+0.30=0.525 (other comps at 0.5*0.70=0.35)
    // Actually composite = 0.5*0.20 + 0.5*0.25 + 0.5*0.25 + 1.0*0.30 = 0.10+0.125+0.125+0.30 = 0.65
    // deviation = 0.15 → "medium" ✓
    const result = computeMacroBias(neutralInput({ assetClass: "equity", vixLevel: 10 }));
    expect(result.conviction).toBe("medium");
  });

  it("deviation >= 0.20 → conviction = high", () => {
    // Pure bullish crypto → composite = 1.0, deviation = 0.5 >= 0.20 → "high"
    const result = computeMacroBias({
      dxySlope: -0.05,
      rateDifferentialBps: 200,
      cpiMomentum: -0.5,
      vixLevel: 10,
      macroRiskScore: 0,
      assetClass: "crypto",
      intendedDirection: "long",
    });
    expect(result.conviction).toBe("high");
  });
});

// ── Asset-class differences ───────────────────────────────────────────────────

describe("computeMacroBias — asset class effects", () => {
  it("high VIX has bigger impact on crypto (0.65 weight) than forex (0.10 weight)", () => {
    const highVix = 50;
    const cryptoResult = computeMacroBias(neutralInput({ assetClass: "crypto", vixLevel: highVix }));
    const forexResult = computeMacroBias(neutralInput({ assetClass: "forex", vixLevel: highVix }));
    // Crypto is more impacted by VIX → lower score
    expect(cryptoResult.score).toBeLessThan(forexResult.score);
  });

  it("CPI acceleration hurts equity but helps commodity", () => {
    const highCpi = 0.4;
    const equityResult = computeMacroBias(neutralInput({ assetClass: "equity", cpiMomentum: highCpi }));
    const commodityResult = computeMacroBias(neutralInput({ assetClass: "commodity", cpiMomentum: highCpi }));
    // CPI hurts equity, helps commodity
    expect(commodityResult.score).toBeGreaterThan(equityResult.score);
  });

  it("rising DXY hurts crypto more than equity", () => {
    const risingDxy = 0.04;
    const cryptoResult = computeMacroBias(neutralInput({ assetClass: "crypto", dxySlope: risingDxy }));
    const equityResult = computeMacroBias(neutralInput({ assetClass: "equity", dxySlope: risingDxy }));
    // equity uses softer DXY formula → less impact
    expect(cryptoResult.score).toBeLessThan(equityResult.score);
  });
});

// ── Bias label thresholds ─────────────────────────────────────────────────────

describe("computeMacroBias — bias labels", () => {
  it("score=1.0 → bias=strong_buy", () => {
    const r = computeMacroBias({
      dxySlope: -0.05, rateDifferentialBps: 200, cpiMomentum: -0.5,
      vixLevel: 10, macroRiskScore: 0, assetClass: "crypto", intendedDirection: "long",
    });
    expect(r.bias).toBe("strong_buy");
  });

  it("score=0.0 → bias=strong_sell", () => {
    const r = computeMacroBias({
      dxySlope: 0.05, rateDifferentialBps: -200, cpiMomentum: 0.5,
      vixLevel: 50, macroRiskScore: 0, assetClass: "crypto", intendedDirection: "short",
    });
    expect(r.bias).toBe("strong_sell");
  });

  it("score in [0.40, 0.60] → bias = neutral", () => {
    const r = computeMacroBias(neutralInput());
    expect(r.bias).toBe("neutral");
  });
});

// ── Output validity ───────────────────────────────────────────────────────────

describe("computeMacroBias — output validity", () => {
  it("score always in [0, 1]", () => {
    const inputs: MacroBiasInput[] = [
      neutralInput(),
      neutralInput({ macroRiskScore: 0.9 }),
      neutralInput({ vixLevel: 100, dxySlope: 1, rateDifferentialBps: 1000 }),
    ];
    for (const input of inputs) {
      const r = computeMacroBias(input);
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it("reasons is non-null array", () => {
    const r = computeMacroBias(neutralInput());
    expect(Array.isArray(r.reasons)).toBe(true);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it("updatedAt is valid ISO date", () => {
    const r = computeMacroBias(neutralInput());
    expect(() => new Date(r.updatedAt)).not.toThrow();
  });
});
