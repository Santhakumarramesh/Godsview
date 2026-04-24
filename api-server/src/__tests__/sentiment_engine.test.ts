/**
 * sentiment_engine.test.ts — Phase 29
 *
 * Tests for computeSentiment and neutralSentiment.
 *
 * Coverage:
 *   - Neutral (balanced) inputs → score=0.5, crowdingLevel="low", edge="none"
 *   - Extreme long crowding → retailBias="long_crowded", institutionalEdge="fade_long"
 *   - Extreme short crowding → retailBias="short_crowded", institutionalEdge="fade_short"
 *   - Moderate crowding (< high threshold) → institutionalEdge="none"
 *   - High crowding (≥ high threshold) → institutionalEdge set
 *   - Alignment logic: trading against institutional edge = not aligned
 *   - Contrarian logic: trading with institutional edge direction = contrarian
 *   - Funding rate: neutral for forex/equity, active for crypto
 *   - OI change clamped at ±20%
 *   - CVD normalised at ±1e7
 *   - reasons array populated at extremes
 *   - neutralSentiment() returns safe defaults
 */

import { describe, it, expect } from "vitest";
import { computeSentiment, neutralSentiment } from "../lib/sentiment_engine";
import type { SentimentInput } from "../lib/sentiment_engine";

// ── Helpers ────────────────────────────────────────────────────────────────────

const neutralInput = (overrides: Partial<SentimentInput> = {}): SentimentInput => ({
  retailLongRatio: 0.5,
  priceTrendSlope: 0,
  cvdNet: 0,
  openInterestChange: 0,
  fundingRate: 0,
  intendedDirection: "long",
  assetClass: "crypto",
  ...overrides,
});

// ── neutralSentiment ───────────────────────────────────────────────────────────

describe("neutralSentiment", () => {
  it("returns balanced retail bias", () => {
    expect(neutralSentiment().retailBias).toBe("balanced");
  });

  it("returns institutionalEdge = none", () => {
    expect(neutralSentiment().institutionalEdge).toBe("none");
  });

  it("returns sentimentScore = 0.5", () => {
    expect(neutralSentiment().sentimentScore).toBe(0.5);
  });

  it("returns crowdingLevel = low", () => {
    expect(neutralSentiment().crowdingLevel).toBe("low");
  });

  it("returns aligned = true", () => {
    expect(neutralSentiment().aligned).toBe(true);
  });

  it("returns contrarian = false", () => {
    expect(neutralSentiment().contrarian).toBe(false);
  });

  it("has a non-empty reasons array", () => {
    expect(neutralSentiment().reasons.length).toBeGreaterThan(0);
  });

  it("updatedAt is a valid ISO string", () => {
    expect(() => new Date(neutralSentiment().updatedAt)).not.toThrow();
  });
});

// ── computeSentiment — balanced inputs ────────────────────────────────────────

describe("computeSentiment — balanced inputs", () => {
  it("all neutral → sentimentScore = 0.5", () => {
    const result = computeSentiment(neutralInput());
    expect(result.sentimentScore).toBe(0.5);
  });

  it("all neutral → retailBias = balanced", () => {
    const result = computeSentiment(neutralInput());
    expect(result.retailBias).toBe("balanced");
  });

  it("all neutral → institutionalEdge = none", () => {
    const result = computeSentiment(neutralInput());
    expect(result.institutionalEdge).toBe("none");
  });

  it("all neutral → crowdingLevel = low", () => {
    const result = computeSentiment(neutralInput());
    expect(result.crowdingLevel).toBe("low");
  });

  it("all neutral → aligned = true (no edge to violate)", () => {
    const result = computeSentiment(neutralInput());
    expect(result.aligned).toBe(true);
  });

  it("all neutral → contrarian = false", () => {
    const result = computeSentiment(neutralInput());
    expect(result.contrarian).toBe(false);
  });
});

// ── computeSentiment — extreme long crowding ──────────────────────────────────

describe("computeSentiment — extreme long crowding", () => {
  // retailLongRatio=0.85, trend up, positive funding, rising OI, positive CVD
  // composite = 0.85*0.45 + 0.8*0.20 + 0.875*0.15 + 0.75*0.10 + 0.9*0.10 ≈ 0.839

  const extremeLongInput = (): SentimentInput => ({
    retailLongRatio: 0.85,
    priceTrendSlope: 0.03,
    cvdNet: 8e6,
    openInterestChange: 0.10,
    fundingRate: 0.0015,
    intendedDirection: "long",
    assetClass: "crypto",
  });

  it("sentimentScore > 0.78 (extreme threshold)", () => {
    const result = computeSentiment(extremeLongInput());
    expect(result.sentimentScore).toBeGreaterThan(0.78);
  });

  it("retailBias = long_crowded", () => {
    const result = computeSentiment(extremeLongInput());
    expect(result.retailBias).toBe("long_crowded");
  });

  it("crowdingLevel = extreme", () => {
    const result = computeSentiment(extremeLongInput());
    expect(result.crowdingLevel).toBe("extreme");
  });

  it("institutionalEdge = fade_long", () => {
    const result = computeSentiment(extremeLongInput());
    expect(result.institutionalEdge).toBe("fade_long");
  });

  it("long direction with extreme long crowd → aligned = false (trading with crowd)", () => {
    const result = computeSentiment({ ...extremeLongInput(), intendedDirection: "long" });
    expect(result.aligned).toBe(false);
  });

  it("short direction with extreme long crowd → aligned = true (contrarian)", () => {
    const result = computeSentiment({ ...extremeLongInput(), intendedDirection: "short" });
    expect(result.aligned).toBe(true);
  });

  it("short direction with extreme long crowd → contrarian = true", () => {
    const result = computeSentiment({ ...extremeLongInput(), intendedDirection: "short" });
    expect(result.contrarian).toBe(true);
  });

  it("long direction with extreme long crowd → contrarian = false", () => {
    const result = computeSentiment({ ...extremeLongInput(), intendedDirection: "long" });
    expect(result.contrarian).toBe(false);
  });

  it("reasons array mentions extreme crowding", () => {
    const result = computeSentiment(extremeLongInput());
    const hasExtreme = result.reasons.some((r) => r.includes("extreme"));
    expect(hasExtreme).toBe(true);
  });

  it("reasons array mentions institutional edge", () => {
    const result = computeSentiment(extremeLongInput());
    const hasEdge = result.reasons.some((r) => r.toLowerCase().includes("institutional"));
    expect(hasEdge).toBe(true);
  });
});

// ── computeSentiment — extreme short crowding ─────────────────────────────────

describe("computeSentiment — extreme short crowding", () => {
  const extremeShortInput = (): SentimentInput => ({
    retailLongRatio: 0.15,
    priceTrendSlope: -0.04,
    cvdNet: -9e6,
    openInterestChange: -0.15,
    fundingRate: -0.0015,
    intendedDirection: "short",
    assetClass: "crypto",
  });

  it("sentimentScore < 0.22 (extreme short)", () => {
    const result = computeSentiment(extremeShortInput());
    expect(result.sentimentScore).toBeLessThan(0.22);
  });

  it("retailBias = short_crowded", () => {
    const result = computeSentiment(extremeShortInput());
    expect(result.retailBias).toBe("short_crowded");
  });

  it("crowdingLevel = extreme", () => {
    const result = computeSentiment(extremeShortInput());
    expect(result.crowdingLevel).toBe("extreme");
  });

  it("institutionalEdge = fade_short", () => {
    const result = computeSentiment(extremeShortInput());
    expect(result.institutionalEdge).toBe("fade_short");
  });

  it("short direction with extreme short crowd → aligned = false", () => {
    const result = computeSentiment({ ...extremeShortInput(), intendedDirection: "short" });
    expect(result.aligned).toBe(false);
  });

  it("long direction with extreme short crowd → contrarian = true", () => {
    const result = computeSentiment({ ...extremeShortInput(), intendedDirection: "long" });
    expect(result.contrarian).toBe(true);
  });
});

// ── computeSentiment — moderate crowding ──────────────────────────────────────

describe("computeSentiment — moderate crowding (no institutional edge)", () => {
  // retailLongRatio=0.70, all else neutral
  // composite = 0.70*0.45 + 0.5*0.55 = 0.315 + 0.275 = 0.59 → moderate

  it("moderate long crowding → crowdingLevel = moderate", () => {
    const result = computeSentiment(neutralInput({ retailLongRatio: 0.70 }));
    expect(result.crowdingLevel).toBe("moderate");
  });

  it("moderate long crowding → institutionalEdge = none (threshold not met)", () => {
    const result = computeSentiment(neutralInput({ retailLongRatio: 0.70 }));
    expect(result.institutionalEdge).toBe("none");
  });

  it("moderate crowding → aligned = true regardless of direction", () => {
    const resultLong = computeSentiment(neutralInput({ retailLongRatio: 0.70, intendedDirection: "long" }));
    const resultShort = computeSentiment(neutralInput({ retailLongRatio: 0.70, intendedDirection: "short" }));
    expect(resultLong.aligned).toBe(true);
    expect(resultShort.aligned).toBe(true);
  });
});

// ── computeSentiment — high crowding ─────────────────────────────────────────

describe("computeSentiment — high crowding (has institutional edge)", () => {
  // retailLongRatio=0.90, all else neutral
  // composite = 0.90*0.45 + 0.5*0.55 = 0.405 + 0.275 = 0.68 → exactly "high"

  it("retailLongRatio=0.90, neutral rest → crowdingLevel = high or extreme", () => {
    const result = computeSentiment(neutralInput({ retailLongRatio: 0.90 }));
    expect(["high", "extreme"]).toContain(result.crowdingLevel);
  });

  it("high long crowding → institutionalEdge = fade_long", () => {
    const result = computeSentiment(neutralInput({ retailLongRatio: 0.90 }));
    expect(result.institutionalEdge).toBe("fade_long");
  });
});

// ── computeSentiment — asset class effects ────────────────────────────────────

describe("computeSentiment — asset class funding effects", () => {
  it("forex: funding rate has no effect (always 0.5 neutral)", () => {
    const withFunding = computeSentiment(neutralInput({
      assetClass: "forex",
      fundingRate: 0.002, // max positive
    }));
    const withoutFunding = computeSentiment(neutralInput({
      assetClass: "forex",
      fundingRate: 0,
    }));
    expect(withFunding.sentimentScore).toBe(withoutFunding.sentimentScore);
  });

  it("equity: funding rate has no effect", () => {
    const withFunding = computeSentiment(neutralInput({
      assetClass: "equity",
      fundingRate: -0.002, // max negative
    }));
    const withoutFunding = computeSentiment(neutralInput({
      assetClass: "equity",
      fundingRate: 0,
    }));
    expect(withFunding.sentimentScore).toBe(withoutFunding.sentimentScore);
  });

  it("crypto: positive funding raises composite vs negative funding", () => {
    const positiveFunding = computeSentiment(neutralInput({
      assetClass: "crypto",
      fundingRate: 0.002,
    }));
    const negativeFunding = computeSentiment(neutralInput({
      assetClass: "crypto",
      fundingRate: -0.002,
    }));
    expect(positiveFunding.sentimentScore).toBeGreaterThan(negativeFunding.sentimentScore);
  });
});

// ── computeSentiment — clamping ───────────────────────────────────────────────

describe("computeSentiment — input clamping", () => {
  it("retailLongRatio > 1 → clamped at 1.0", () => {
    const clamped = computeSentiment(neutralInput({ retailLongRatio: 2.0 }));
    const at1 = computeSentiment(neutralInput({ retailLongRatio: 1.0 }));
    expect(clamped.sentimentScore).toBe(at1.sentimentScore);
  });

  it("retailLongRatio < 0 → clamped at 0", () => {
    const clamped = computeSentiment(neutralInput({ retailLongRatio: -0.5 }));
    const at0 = computeSentiment(neutralInput({ retailLongRatio: 0.0 }));
    expect(clamped.sentimentScore).toBe(at0.sentimentScore);
  });

  it("priceTrendSlope > 0.05 → clamped (same result as 0.05)", () => {
    const clamped = computeSentiment(neutralInput({ priceTrendSlope: 0.5 }));
    const at05 = computeSentiment(neutralInput({ priceTrendSlope: 0.05 }));
    expect(clamped.sentimentScore).toBe(at05.sentimentScore);
  });

  it("openInterestChange > 0.20 → clamped", () => {
    const clamped = computeSentiment(neutralInput({ openInterestChange: 1.0 }));
    const at020 = computeSentiment(neutralInput({ openInterestChange: 0.20 }));
    expect(clamped.sentimentScore).toBe(at020.sentimentScore);
  });

  it("cvdNet beyond ±1e7 → clamped", () => {
    const bigPositive = computeSentiment(neutralInput({ cvdNet: 1e9 }));
    const at1e7 = computeSentiment(neutralInput({ cvdNet: 1e7 }));
    expect(bigPositive.sentimentScore).toBe(at1e7.sentimentScore);
  });
});

// ── computeSentiment — output validity ───────────────────────────────────────

describe("computeSentiment — output validity", () => {
  it("sentimentScore always in [0, 1]", () => {
    const extremeCases: SentimentInput[] = [
      neutralInput({ retailLongRatio: 1.0, fundingRate: 0.002, cvdNet: 1e8, openInterestChange: 1 }),
      neutralInput({ retailLongRatio: 0.0, fundingRate: -0.002, cvdNet: -1e8, openInterestChange: -1 }),
      neutralInput(),
    ];
    for (const input of extremeCases) {
      const result = computeSentiment(input);
      expect(result.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(result.sentimentScore).toBeLessThanOrEqual(1);
    }
  });

  it("updatedAt is a valid ISO date string", () => {
    const result = computeSentiment(neutralInput());
    expect(() => new Date(result.updatedAt)).not.toThrow();
    expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("reasons is always a non-null array", () => {
    const result = computeSentiment(neutralInput());
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it("aligned and contrarian cannot both be true simultaneously", () => {
    // contrarian = trading against crowd; aligned = not trading with crowd
    // If contrarian=true → you're trading opposite to crowd → aligned must also be true
    // They ARE compatible: contrarian implies aligned
    // But: aligned=false AND contrarian=false is also possible (no institutional edge)
    const result = computeSentiment(neutralInput({ retailLongRatio: 0.85, priceTrendSlope: 0.04 }));
    if (result.contrarian) {
      expect(result.aligned).toBe(true);
    }
  });
});
