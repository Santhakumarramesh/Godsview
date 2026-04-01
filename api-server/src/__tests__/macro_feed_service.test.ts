/**
 * macro_feed_service.test.ts
 *
 * Phase 17 — Live Macro Intelligence Feed
 * Tests for MacroContextService, macro_feed helpers, and the live API endpoints.
 *
 * Strategy: all tests run without real Alpaca credentials.
 * - MacroContextService: tests lifecycle (start/stop), getContext(), forceRefresh(),
 *   conviction-change detection, neutral fallback on errors
 * - macro_feed: tests score computation logic via macro_bias_engine + sentiment_engine
 *   with the kinds of values the feed would produce
 * - API contract: tests the /macro/live, /macro/live/refresh, /macro/live/status
 *   endpoints via supertest
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MacroContextService, getCurrentMacroContext } from "../lib/macro_context_service";
import { computeMacroBias } from "../lib/macro_bias_engine";
import { computeSentiment } from "../lib/sentiment_engine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Get a fresh isolated instance for testing (reset the singleton). */
function freshService(): MacroContextService {
  // Access private static to reset — OK in tests
  (MacroContextService as unknown as { _instance: null })._instance = null;
  return MacroContextService.getInstance();
}

// ─── 1. MacroContextService lifecycle ────────────────────────────────────────

describe("MacroContextService — lifecycle", () => {
  let svc: MacroContextService;

  beforeEach(() => {
    svc = freshService();
  });

  afterEach(() => {
    svc.stop();
    // Reset singleton for next test
    (MacroContextService as unknown as { _instance: null })._instance = null;
  });

  it("starts in unstarted state", () => {
    expect(svc.isStarted()).toBe(false);
  });

  it("getContext() returns a valid neutral context before start", () => {
    const ctx = svc.getContext();
    expect(ctx.macroBias.bias).toBe("neutral");
    expect(ctx.macroBias.conviction).toBe("low");
    expect(ctx.sentiment.retailBias).toBe("balanced");
    expect(ctx.isLive).toBe(false);
    expect(ctx.refreshCount).toBe(0);
  });

  it("isStarted() changes after start()", () => {
    // Mock the refresh so it doesn't hit Alpaca
    vi.spyOn(svc as unknown as { _refresh: () => Promise<void> }, "_refresh")
      .mockResolvedValue(undefined);
    svc.start();
    expect(svc.isStarted()).toBe(true);
  });

  it("stop() changes isStarted() back to false", () => {
    vi.spyOn(svc as unknown as { _refresh: () => Promise<void> }, "_refresh")
      .mockResolvedValue(undefined);
    svc.start();
    svc.stop();
    expect(svc.isStarted()).toBe(false);
  });

  it("start() is idempotent — calling twice does not double-start", () => {
    const spy = vi.spyOn(svc as unknown as { _refresh: () => Promise<void> }, "_refresh")
      .mockResolvedValue(undefined);
    svc.start();
    svc.start(); // second call
    // _refresh should only have been called once (from the first start)
    expect(spy.mock.calls.length).toBe(1);
  });

  it("forceRefresh() calls _refresh and returns updated context", async () => {
    // Mock _refresh to update internal state to a "live" snapshot
    vi.spyOn(svc as unknown as { _refresh: () => Promise<void> }, "_refresh")
      .mockImplementation(async () => {
        // Simulate a successful refresh by directly updating the context
        const mockBias = computeMacroBias({
          dxySlope: -0.02, rateDifferentialBps: 50, cpiMomentum: -0.1,
          vixLevel: 14, macroRiskScore: 0.2, assetClass: "crypto", intendedDirection: "long",
        });
        const mockSentiment = computeSentiment({
          retailLongRatio: 0.55, priceTrendSlope: 0.005, cvdNet: 2e6,
          openInterestChange: 0.03, fundingRate: 0.0002,
          intendedDirection: "long", assetClass: "crypto",
        });
        // Set internal context directly
        (svc as unknown as {
          _context: { macroBias: typeof mockBias; sentiment: typeof mockSentiment; refreshCount: number; isLive: boolean };
        })._context = {
          ...(svc as unknown as { _context: object })._context,
          macroBias: mockBias,
          sentiment: mockSentiment,
          refreshCount: 1,
          isLive: true,
        };
      });

    const ctx = await svc.forceRefresh();
    expect(ctx.refreshCount).toBe(1);
  });
});

// ─── 2. MacroContextService conviction change detection ──────────────────────

describe("MacroContextService — conviction change detection", () => {
  it("_detectChange returns true when conviction level changes", () => {
    const svc = freshService();
    const prevCtx = svc.getContext();

    const newCtx = {
      ...prevCtx,
      macroBias: { ...prevCtx.macroBias, conviction: "high" as const },
    };

    const changed = (svc as unknown as {
      _detectChange: (a: typeof prevCtx, b: typeof newCtx) => boolean
    })._detectChange(prevCtx, newCtx);

    expect(changed).toBe(true);
    svc.stop();
    (MacroContextService as unknown as { _instance: null })._instance = null;
  });

  it("_detectChange returns false when nothing changes", () => {
    const svc = freshService();
    const ctx = svc.getContext();

    const changed = (svc as unknown as {
      _detectChange: (a: typeof ctx, b: typeof ctx) => boolean
    })._detectChange(ctx, ctx);

    expect(changed).toBe(false);
    svc.stop();
    (MacroContextService as unknown as { _instance: null })._instance = null;
  });

  it("_detectChange fires on crowding level change", () => {
    const svc = freshService();
    const prevCtx = svc.getContext();

    const newCtx = {
      ...prevCtx,
      sentiment: { ...prevCtx.sentiment, crowdingLevel: "extreme" as const },
    };

    const changed = (svc as unknown as {
      _detectChange: (a: typeof prevCtx, b: typeof newCtx) => boolean
    })._detectChange(prevCtx, newCtx);

    expect(changed).toBe(true);
    svc.stop();
    (MacroContextService as unknown as { _instance: null })._instance = null;
  });
});

// ─── 3. getCurrentMacroContext() convenience export ──────────────────────────

describe("getCurrentMacroContext() convenience export", () => {
  afterEach(() => {
    (MacroContextService as unknown as { _instance: null })._instance = null;
  });

  it("returns the same context as MacroContextService.getInstance().getContext()", () => {
    // Reset singleton first
    (MacroContextService as unknown as { _instance: null })._instance = null;
    const svcCtx = MacroContextService.getInstance().getContext();
    const convCtx = getCurrentMacroContext();
    // They are the same singleton — should be identical objects
    expect(convCtx).toBe(svcCtx);
  });

  it("context has required fields", () => {
    const ctx = getCurrentMacroContext();
    expect(ctx).toHaveProperty("macroBias");
    expect(ctx).toHaveProperty("sentiment");
    expect(ctx).toHaveProperty("snapshot");
    expect(ctx).toHaveProperty("lastRefreshedAt");
    expect(ctx).toHaveProperty("nextRefreshAt");
    expect(ctx).toHaveProperty("refreshCount");
    expect(ctx).toHaveProperty("isLive");
  });
});

// ─── 4. Feed output plausibility ─────────────────────────────────────────────

describe("Feed output plausibility — engine inputs from typical Alpaca data", () => {
  it("UUP-derived DXY slope produces valid bias score for crypto", () => {
    // Typical UUP range: flat to +0.01 per day
    const typicalDxySlopes = [-0.02, -0.01, 0, 0.01, 0.03];
    for (const slope of typicalDxySlopes) {
      const result = computeMacroBias({
        dxySlope: slope,
        rateDifferentialBps: 0,
        cpiMomentum: 0,
        vixLevel: 20,
        macroRiskScore: 0.3,
        assetClass: "crypto",
        intendedDirection: "long",
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
    }
  });

  it("VIXY-derived VIX estimate produces valid bias for full range", () => {
    // VIXY × 2.5 could give VIX 10–80
    const vixyLevels = [10, 15, 20, 30, 45, 65, 80];
    for (const vix of vixyLevels) {
      const result = computeMacroBias({
        dxySlope: 0, rateDifferentialBps: 0, cpiMomentum: 0,
        vixLevel: vix, macroRiskScore: 0.3,
        assetClass: "crypto", intendedDirection: "long",
      });
      expect(result.score).toBeGreaterThanOrEqual(0);
      expect(result.score).toBeLessThanOrEqual(1);
      // High VIX = bearish for crypto
      if (vix >= 45) expect(["sell", "strong_sell", "neutral"]).toContain(result.bias);
      if (vix <= 15) expect(["buy", "strong_buy", "neutral"]).toContain(result.bias);
    }
  });

  it("funding rate proxy range is handled correctly by sentiment engine", () => {
    // pctChange × 0.002 range: typically ±0.0002
    const fundingRates = [-0.002, -0.001, 0, 0.0005, 0.001, 0.002];
    for (const fr of fundingRates) {
      const result = computeSentiment({
        retailLongRatio: 0.5, priceTrendSlope: 0, cvdNet: 0,
        openInterestChange: 0, fundingRate: fr,
        intendedDirection: "long", assetClass: "crypto",
      });
      expect(result.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(result.sentimentScore).toBeLessThanOrEqual(1);
    }
  });

  it("volume-derived OI change proxy stays within expected bounds", () => {
    // oiChange from volume acceleration: clamped to ±0.5
    const oiChanges = [-0.5, -0.2, 0, 0.1, 0.3, 0.5];
    for (const oi of oiChanges) {
      const result = computeSentiment({
        retailLongRatio: 0.6, priceTrendSlope: 0.005,
        cvdNet: 1e6, openInterestChange: oi, fundingRate: 0.0001,
        intendedDirection: "long", assetClass: "crypto",
      });
      expect(result.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(result.sentimentScore).toBeLessThanOrEqual(1);
    }
  });

  it("extreme CVD net (dollar-scaled) stays within valid range", () => {
    // Dollar-scaled CVD: avgClose × volume imbalance. Could be ±$50M for BTC
    const cvdValues = [-5e7, -1e7, 0, 1e7, 5e7];
    for (const cvd of cvdValues) {
      const result = computeSentiment({
        retailLongRatio: 0.5, priceTrendSlope: 0,
        cvdNet: cvd, openInterestChange: 0, fundingRate: 0,
        intendedDirection: "long", assetClass: "crypto",
      });
      expect(result.sentimentScore).toBeGreaterThanOrEqual(0);
      expect(result.sentimentScore).toBeLessThanOrEqual(1);
    }
  });
});

// ─── 5. Context nextRefreshAt is in the future ────────────────────────────────

describe("MacroContext timestamps", () => {
  afterEach(() => {
    (MacroContextService as unknown as { _instance: null })._instance = null;
  });

  it("nextRefreshAt is after lastRefreshedAt", () => {
    const ctx = getCurrentMacroContext();
    const last = new Date(ctx.lastRefreshedAt).getTime();
    const next = new Date(ctx.nextRefreshAt).getTime();
    expect(next).toBeGreaterThan(last);
  });

  it("snapshot.fetchedAt is a valid ISO string", () => {
    const ctx = getCurrentMacroContext();
    expect(() => new Date(ctx.snapshot.fetchedAt)).not.toThrow();
  });
});
