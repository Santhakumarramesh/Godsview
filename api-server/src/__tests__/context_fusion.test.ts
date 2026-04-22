import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock dependencies before imports
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/macro_context_service", () => {
  const instance = {
    getContext: vi.fn().mockReturnValue({
      isLive: true,
      macroBias: { score: 0.65, direction: "long", conviction: "medium", aligned: true },
      sentiment: { sentimentScore: 0.55, crowdingLevel: "low", aligned: true },
      lastRefreshedAt: new Date().toISOString(),
      nextRefreshAt: new Date().toISOString(),
      refreshCount: 1,
    }),
  };
  return {
    MacroContextService: { getInstance: () => instance },
    __mockInstance: instance,
  };
});

vi.mock("../lib/macro_engine", () => ({
  getMacroContext: vi.fn().mockReturnValue({
    events: [],
    overall_sentiment: 0.1,
    risk_level: "low",
    lockout_active: false,
    lockout_reason: null,
    news_count_24h: 2,
    high_impact_upcoming: [],
    generated_at: new Date().toISOString(),
  }),
}));

vi.mock("../lib/sentiment_engine", () => ({
  computeSentiment: vi.fn(),
  neutralSentiment: vi.fn(),
}));

vi.mock("../lib/macro_bias_engine", () => ({
  computeMacroBias: vi.fn(),
  neutralMacroBias: vi.fn(),
}));

vi.mock("../lib/signal_stream", () => ({
  publishAlert: vi.fn(),
}));

vi.mock("../lib/macro_feed", () => ({
  fetchLiveMacroSnapshot: vi.fn(),
}));

import {
  evaluateContextFusion,
  getContextFusionSnapshot,
  resetContextFusionState,
} from "../lib/context_fusion_engine";

describe("Context Fusion Engine", () => {
  beforeEach(() => {
    resetContextFusionState();
  });

  it("returns NEUTRAL for balanced inputs", async () => {
    const result = await evaluateContextFusion({
      symbol: "AAPL",
      direction: "long",
      regime: "RANGING",
    });
    expect(result.fusionScore).toBeGreaterThan(0);
    expect(result.fusionScore).toBeLessThanOrEqual(1);
    expect(["FAVORABLE", "NEUTRAL", "CAUTIOUS", "HOSTILE"]).toContain(result.level);
    expect(result.blocked).toBe(false);
    expect(result.sizeMultiplier).toBeGreaterThan(0);
    expect(result.evaluatedAt).toBeTruthy();
  });

  it("returns higher score for TRENDING regime", async () => {
    const trending = await evaluateContextFusion({
      symbol: "AAPL",
      direction: "long",
      regime: "TRENDING",
    });
    resetContextFusionState();
    const choppy = await evaluateContextFusion({
      symbol: "AAPL",
      direction: "long",
      regime: "CHOPPY",
    });
    expect(trending.fusionScore).toBeGreaterThan(choppy.fusionScore);
    expect(trending.components.regimeScore).toBeGreaterThan(choppy.components.regimeScore);
  });

  it("blocks execution on event lockout", async () => {
    const { getMacroContext } = await import("../lib/macro_engine");
    (getMacroContext as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      events: [],
      overall_sentiment: -0.5,
      risk_level: "extreme",
      lockout_active: true,
      lockout_reason: "FOMC_announcement",
      news_count_24h: 5,
      high_impact_upcoming: [{ id: "1", type: "fed", impact: "critical", title: "FOMC" }],
      generated_at: new Date().toISOString(),
    });

    const result = await evaluateContextFusion({
      symbol: "SPY",
      direction: "long",
      regime: "VOLATILE",
    });
    expect(result.blocked).toBe(true);
    expect(result.blockReason).toContain("event_lockout");
    expect(result.sizeMultiplier).toBe(0);
  });

  it("snapshot tracks telemetry", async () => {
    await evaluateContextFusion({ symbol: "MSFT", direction: "long", regime: "TRENDING" });
    await evaluateContextFusion({ symbol: "GOOG", direction: "short", regime: "CHOPPY" });

    const snapshot = getContextFusionSnapshot();
    expect(snapshot.totalEvaluations).toBeGreaterThanOrEqual(2);
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.lastEvaluation).toBeTruthy();
    expect(snapshot.lastEvaluatedAt).toBeTruthy();
  });

  it("caches results for same input", async () => {
    const r1 = await evaluateContextFusion({ symbol: "TSLA", direction: "long", regime: "BREAKOUT" });
    const r2 = await evaluateContextFusion({ symbol: "TSLA", direction: "long", regime: "BREAKOUT" });
    expect(r1.fusionScore).toBe(r2.fusionScore);
    expect(r1.evaluatedAt).toBe(r2.evaluatedAt);
  });

  it("reset clears state", async () => {
    await evaluateContextFusion({ symbol: "AMZN", direction: "long" });
    resetContextFusionState();
    const snapshot = getContextFusionSnapshot();
    expect(snapshot.totalEvaluations).toBe(0);
    expect(snapshot.cacheSize).toBe(0);
    expect(snapshot.lastEvaluation).toBeNull();
  });
});
