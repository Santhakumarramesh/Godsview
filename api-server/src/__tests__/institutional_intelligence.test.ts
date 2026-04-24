/**
 * institutional_intelligence.test.ts
 *
 * Unit tests for Phase 16: Macro Bias Engine + Retail Sentiment Engine
 * (Elliot Hewitt / YoungTraderWealth 3-layer method)
 */

import { describe, it, expect } from "vitest";
import { computeMacroBias, neutralMacroBias } from "../lib/macro_bias_engine";
import { computeSentiment, neutralSentiment } from "../lib/sentiment_engine";

// ─────────────────────────────────────────────────────────────────────────────
// Macro Bias Engine
// ─────────────────────────────────────────────────────────────────────────────

describe("MacroBiasEngine", () => {
  const base = {
    dxySlope: 0,
    rateDifferentialBps: 0,
    cpiMomentum: 0,
    vixLevel: 30,
    macroRiskScore: 0,
    assetClass: "forex" as const,
    intendedDirection: "long" as const,
  };

  it("returns neutral when all inputs are zero", () => {
    const result = computeMacroBias(base);
    expect(result.bias).toBe("neutral");
    expect(result.direction).toBe("flat");
    expect(result.score).toBeCloseTo(0.5, 2);
    expect(result.conviction).toBe("low");
    expect(result.aligned).toBe(true);
  });

  it("returns strong_buy for bullish DXY + hawkish rates + falling VIX", () => {
    const result = computeMacroBias({
      ...base,
      dxySlope: 0.05,
      rateDifferentialBps: 200,
      cpiMomentum: -0.5,
      vixLevel: 10,
    });
    expect(result.bias).toBe("strong_buy");
    expect(result.direction).toBe("long");
    expect(result.conviction).toBe("high");
    expect(result.score).toBeGreaterThan(0.7);
    expect(result.tailwind).toBe(true);
  });

  it("returns strong_sell for bearish DXY + dovish rates + high VIX (forex)", () => {
    const result = computeMacroBias({
      ...base,
      dxySlope: -0.05,
      rateDifferentialBps: -200,
      cpiMomentum: 0.5,
      vixLevel: 50,
      intendedDirection: "long",
    });
    expect(result.bias).toBe("strong_sell");
    expect(result.direction).toBe("short");
    expect(result.headwind).toBe(true);
    expect(result.blockedDirections).toContain("long");
  });

  it("blocks counter-macro long when high conviction bear", () => {
    const result = computeMacroBias({
      ...base,
      dxySlope: -0.05,
      rateDifferentialBps: -200,
      cpiMomentum: 0.5,
      vixLevel: 50,
      intendedDirection: "long",
    });
    expect(result.blockedDirections).toContain("long");
    expect(result.aligned).toBe(false);
  });

  it("returns flat and blocks both directions on macro lockout", () => {
    const result = computeMacroBias({ ...base, macroRiskScore: 0.9 });
    expect(result.direction).toBe("flat");
    expect(result.bias).toBe("neutral");
    expect(result.blockedDirections).toContain("long");
    expect(result.blockedDirections).toContain("short");
  });

  it("applies correct weights for crypto (VIX-dominant)", () => {
    // For crypto, VIX has 65% weight
    const high_vix = computeMacroBias({
      ...base, assetClass: "crypto", vixLevel: 45,
      dxySlope: 0.001, rateDifferentialBps: 10, cpiMomentum: 0.05,
    });
    const low_vix = computeMacroBias({
      ...base, assetClass: "crypto", vixLevel: 10,
      dxySlope: 0.001, rateDifferentialBps: 10, cpiMomentum: 0.05,
    });
    // High VIX = bearish for crypto; low VIX = bullish for crypto
    expect(high_vix.score).toBeLessThan(low_vix.score);
    expect(high_vix.direction).toBe("short");
    expect(low_vix.direction).toBe("long");
  });

  it("neutralMacroBias returns safe defaults", () => {
    const result = neutralMacroBias();
    expect(result.bias).toBe("neutral");
    expect(result.blockedDirections).toHaveLength(0);
    expect(result.aligned).toBe(true);
  });

  it("populates reasons with human-readable strings", () => {
    const result = computeMacroBias({
      ...base, dxySlope: 0.007, rateDifferentialBps: 80, vixLevel: 32,
    });
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.reasons.every((r) => typeof r === "string")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retail Sentiment Engine
// ─────────────────────────────────────────────────────────────────────────────

describe("SentimentEngine", () => {
  const base = {
    retailLongRatio: 0.5,
    priceTrendSlope: 0,
    cvdNet: 0,
    openInterestChange: 0,
    fundingRate: 0,
    intendedDirection: "long" as const,
    assetClass: "crypto" as const,
  };

  it("returns balanced/none edge when retail is 50/50", () => {
    const result = computeSentiment(base);
    expect(result.retailBias).toBe("balanced");
    expect(result.institutionalEdge).toBe("none");
    expect(result.crowdingLevel).toBe("low");
    expect(result.contrarian).toBe(false);
  });

  it("detects extreme crowding and fade_long edge at 80% retail long", () => {
    const result = computeSentiment({
      ...base,
      retailLongRatio: 0.82,
      priceTrendSlope: 0.03,
      fundingRate: 0.0015,
      openInterestChange: 0.1,
      cvdNet: 8e6,
      intendedDirection: "long",
    });
    expect(result.retailBias).toBe("long_crowded");
    expect(result.crowdingLevel).toBe("extreme");
    expect(result.institutionalEdge).toBe("fade_long");
    expect(result.contrarian).toBe(false); // long is WITH the crowd
  });

  it("detects extreme crowding and fade_short edge at 80% retail short", () => {
    const result = computeSentiment({
      ...base,
      retailLongRatio: 0.18, // 82% short
      priceTrendSlope: -0.03,
      fundingRate: -0.0015,
      openInterestChange: -0.1,
      cvdNet: -8e6,
      intendedDirection: "short",
    });
    expect(result.retailBias).toBe("short_crowded");
    expect(result.crowdingLevel).toBe("extreme");
    expect(result.institutionalEdge).toBe("fade_short");
    expect(result.contrarian).toBe(false); // short is WITH the retail crowd
  });

  it("marks aligned=true when trading against the crowd (contrarian play)", () => {
    // 80% retail long → institutional short → short is aligned
    const result = computeSentiment({
      ...base,
      retailLongRatio: 0.82,
      intendedDirection: "short", // going against retail longs
    });
    expect(result.aligned).toBe(true);
    expect(result.contrarian).toBe(false);
  });

  it("positive funding rate increases bearish signal for crypto", () => {
    const low_funding  = computeSentiment({ ...base, retailLongRatio: 0.65, fundingRate: 0.00005 });
    const high_funding = computeSentiment({ ...base, retailLongRatio: 0.65, fundingRate: 0.0008 });
    // Higher funding → stronger long-crowding score
    expect(high_funding.sentimentScore).toBeGreaterThan(low_funding.sentimentScore);
  });

  it("detects institutional accumulation pattern (price up, retail still short)", () => {
    const result = computeSentiment({
      ...base,
      retailLongRatio: 0.35, // retail mostly short
      priceTrendSlope: 0.03, // but price is rising
      intendedDirection: "long",
    });
    expect(result.reasons.some((r) => r.toLowerCase().includes("momentum"))).toBe(true);
    expect(result.sentimentScore).toBeGreaterThan(0);
  });

  it("OI rising with price raises bullish institutional score", () => {
    const no_oi = computeSentiment({ ...base, retailLongRatio: 0.65, openInterestChange: 0,     priceTrendSlope: 0.003 });
    const oi    = computeSentiment({ ...base, retailLongRatio: 0.65, openInterestChange: 5000,   priceTrendSlope: 0.003 });
    // OI confirms institutional longs → less negative (or more positive) score
    expect(oi.sentimentScore).toBeGreaterThanOrEqual(no_oi.sentimentScore);
  });

  it("sentimentScore is clamped to [-1, 1]", () => {
    const extreme = computeSentiment({
      ...base,
      retailLongRatio: 0.99,
      fundingRate: 0.01,
      priceTrendSlope: -0.02,
      openInterestChange: 100_000,
    });
    expect(extreme.sentimentScore).toBeGreaterThanOrEqual(-1);
    expect(extreme.sentimentScore).toBeLessThanOrEqual(1);
  });

  it("neutralSentiment returns safe defaults", () => {
    const result = neutralSentiment();
    expect(result.retailBias).toBe("balanced");
    expect(result.institutionalEdge).toBe("none");
    expect(result.aligned).toBe(true);
    expect(result.contrarian).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Integration: strategy_engine no-trade filters
// ─────────────────────────────────────────────────────────────────────────────

describe("Strategy pipeline macro/sentiment gates", () => {
  // Import here so the test uses the real strategy_engine
  it("applyNoTradeFilters accepts macroBias and sentiment options without crashing", async () => {
    const { applyNoTradeFilters } = await import("../lib/strategy_engine");
    const { computeMacroBias }    = await import("../lib/macro_bias_engine");
    const { computeSentiment }    = await import("../lib/sentiment_engine");

    const dummyRecall = {
      atr_pct: 0.01, avg_range_1m: 5,
      regime: "trending_bull" as const,
      trend_slope_5m: 0.005,
      momentum_1m: 0.002,
      sk: { zone_distance_pct: 0.1, bias: "bull" as const, correction_complete: true },
      cvd: { cvd_divergence: true },
    } as any;

    const macroBias = computeMacroBias({
      dxySlope: 0.005, rateDifferentialBps: 80, cpiMomentum: 0.2,
      vixLevel: 16, macroRiskScore: 0, assetClass: "crypto", intendedDirection: "long",
    });

    const sentiment = computeSentiment({
      retailLongRatio: 0.55, priceTrendSlope: 0.003, cvdNet: 3000,
      openInterestChange: 500, fundingRate: 0.0001,
      intendedDirection: "long", assetClass: "crypto",
    });

    const result = applyNoTradeFilters([], dummyRecall, "absorption_reversal", {
      replayMode: false,
      sessionAllowed: true,
      newsLockoutActive: false,
      macroBias,
      sentiment,
    });

    // With bullish macro + balanced sentiment, should not block
    expect(typeof result.blocked).toBe("boolean");
    expect(typeof result.reason).toBe("string");
  });

  it("macro_bias_block fires when high-conviction bear macro and setup is long", async () => {
    const { applyNoTradeFilters } = await import("../lib/strategy_engine");
    const { computeMacroBias }    = await import("../lib/macro_bias_engine");

    const bearMacro = computeMacroBias({
      dxySlope: -0.05, rateDifferentialBps: -200, cpiMomentum: 0.5,
      vixLevel: 50, macroRiskScore: 0, assetClass: "forex", intendedDirection: "long",
    });
    expect(bearMacro.conviction).toBe("high");
    expect(bearMacro.blockedDirections).toContain("long");

    const dummyRecall = {
      atr_pct: 0.01, avg_range_1m: 5,
      regime: "trending_bull" as const,
      trend_slope_5m: 0.005, // uptrend → setupDir = "long"
      momentum_1m: 0.002,
      sk: { zone_distance_pct: 0.1, bias: "neutral" as const, correction_complete: true },
      cvd: { cvd_divergence: true },
    } as any;

    const result = applyNoTradeFilters([], dummyRecall, "continuation_pullback", {
      replayMode: false,
      sessionAllowed: true,
      newsLockoutActive: false,
      macroBias: bearMacro,
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("macro_bias_block");
  });

  it("sentiment_crowding_block fires when extreme retail crowding with trade", async () => {
    const { applyNoTradeFilters } = await import("../lib/strategy_engine");
    const { computeSentiment }    = await import("../lib/sentiment_engine");

    const crowdedSentiment = computeSentiment({
      retailLongRatio: 0.85, // 85% retail long = extreme
      priceTrendSlope: 0, cvdNet: 0, openInterestChange: 0, fundingRate: 0.001,
      intendedDirection: "long", assetClass: "crypto",
    });
    expect(crowdedSentiment.crowdingLevel).toBe("extreme");
    expect(crowdedSentiment.institutionalEdge).toBe("fade_long");

    const dummyRecall = {
      atr_pct: 0.01, avg_range_1m: 5,
      regime: "ranging" as const,
      trend_slope_5m: 0.004, // uptrend → setupDir = "long"
      momentum_1m: 0.001,
      sk: { zone_distance_pct: 0.3, bias: "neutral" as const, correction_complete: true },
      cvd: { cvd_divergence: false },
    } as any;

    const result = applyNoTradeFilters([], dummyRecall, "sk_bounce", {
      replayMode: false,
      sessionAllowed: true,
      newsLockoutActive: false,
      sentiment: crowdedSentiment,
    });

    expect(result.blocked).toBe(true);
    expect(result.reason).toBe("sentiment_crowding_block");
  });

  it("macro and sentiment gates are bypassed in replayMode", async () => {
    const { applyNoTradeFilters } = await import("../lib/strategy_engine");
    const { computeMacroBias }    = await import("../lib/macro_bias_engine");
    const { computeSentiment }    = await import("../lib/sentiment_engine");

    const bearMacro = computeMacroBias({
      dxySlope: -0.01, rateDifferentialBps: -150, cpiMomentum: -0.5,
      vixLevel: 40, macroRiskScore: 0, assetClass: "forex", intendedDirection: "long",
    });
    const crowdedSentiment = computeSentiment({
      retailLongRatio: 0.90, priceTrendSlope: 0, cvdNet: 0,
      openInterestChange: 0, fundingRate: 0.002,
      intendedDirection: "long", assetClass: "crypto",
    });

    const dummyRecall = {
      atr_pct: 0.02, avg_range_1m: 5,
      regime: "ranging" as const,
      trend_slope_5m: 0.005,
      momentum_1m: 0.002,
      sk: { zone_distance_pct: 0.2, bias: "neutral" as const, correction_complete: true },
      cvd: { cvd_divergence: true },
    } as any;

    const result = applyNoTradeFilters([], dummyRecall, "sk_bounce", {
      replayMode: true, // gates disabled in replay
      macroBias: bearMacro,
      sentiment: crowdedSentiment,
    });

    // Should NOT be blocked by macro or sentiment in replay mode
    expect(result.reason).not.toBe("macro_bias_block");
    expect(result.reason).not.toBe("sentiment_crowding_block");
  });
});
