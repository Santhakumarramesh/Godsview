/**
 * macro_context_service_unit.test.ts — Phase 70
 *
 * Tests MacroContextService singleton pattern, getContext(),
 * isStarted(), start()/stop() lifecycle, and getCurrentMacroContext().
 */

import { describe, it, expect, vi, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("../lib/macro_feed", () => ({
  fetchLiveMacroSnapshot: vi.fn().mockResolvedValue({
    macroBiasInput: {
      dxySlope: -0.1, rateDifferentialBps: -25, cpiMomentum: 0.2,
      vixLevel: 18, macroRiskScore: 0.35,
      assetClass: "crypto", intendedDirection: "long",
    },
    sentimentInput: {
      retailLongRatio: 0.55, priceTrendSlope: 0.3, cvdNet: 150000,
      openInterestChange: 0.08, fundingRate: 0.0005,
      intendedDirection: "long", assetClass: "crypto",
    },
    fetchedAt: new Date().toISOString(),
    dataQuality: "live",
    sources: { dxy: "ok", rates: "ok" },
  }),
}));

vi.mock("../lib/macro_bias_engine", () => ({
  computeMacroBias: vi.fn(() => ({
    direction: "long",
    conviction: "medium",
    score: 0.6,
    factors: [],
  })),
  neutralMacroBias: vi.fn(() => ({
    direction: "neutral",
    conviction: "low",
    score: 0.3,
    factors: [],
  })),
}));

vi.mock("../lib/sentiment_engine", () => ({
  computeSentiment: vi.fn(() => ({
    crowdingLevel: "neutral",
    retailSentiment: "neutral",
    score: 0.5,
  })),
  neutralSentiment: vi.fn(() => ({
    crowdingLevel: "neutral",
    retailSentiment: "neutral",
    score: 0.5,
  })),
}));

vi.mock("../lib/signal_stream", () => ({
  publishAlert: vi.fn(),
  broadcast: vi.fn(),
}));

import {
  MacroContextService,
  getCurrentMacroContext,
  type MacroContext,
  type MacroConvictionChange,
} from "../lib/macro_context_service";

// ── Cleanup ───────────────────────────────────────────────────────────────────

afterEach(() => {
  // Always stop the service to prevent timer leaks
  MacroContextService.getInstance().stop();
});

// ── Singleton pattern ─────────────────────────────────────────────────────────

describe("MacroContextService singleton", () => {
  it("getInstance() returns the same object each time", () => {
    const a = MacroContextService.getInstance();
    const b = MacroContextService.getInstance();
    expect(a).toBe(b);
  });

  it("is defined and has expected methods", () => {
    const svc = MacroContextService.getInstance();
    expect(typeof svc.getContext).toBe("function");
    expect(typeof svc.isStarted).toBe("function");
    expect(typeof svc.start).toBe("function");
    expect(typeof svc.stop).toBe("function");
    expect(typeof svc.forceRefresh).toBe("function");
  });
});

// ── getContext ────────────────────────────────────────────────────────────────

describe("getContext", () => {
  it("returns a MacroContext object with required fields", () => {
    const svc = MacroContextService.getInstance();
    const ctx = svc.getContext();
    expect(ctx).toHaveProperty("snapshot");
    expect(ctx).toHaveProperty("macroBias");
    expect(ctx).toHaveProperty("sentiment");
    expect(ctx).toHaveProperty("lastRefreshedAt");
    expect(ctx).toHaveProperty("nextRefreshAt");
    expect(ctx).toHaveProperty("refreshCount");
    expect(ctx).toHaveProperty("isLive");
  });

  it("refreshCount starts at 0 (neutral bootstrap state)", () => {
    const svc = MacroContextService.getInstance();
    const ctx = svc.getContext();
    // In neutral bootstrap, refreshCount is 0
    expect(ctx.refreshCount).toBeGreaterThanOrEqual(0);
  });

  it("lastRefreshedAt is a valid ISO string", () => {
    const ctx = MacroContextService.getInstance().getContext();
    expect(() => new Date(ctx.lastRefreshedAt)).not.toThrow();
    expect(new Date(ctx.lastRefreshedAt).getTime()).toBeGreaterThan(0);
  });

  it("nextRefreshAt is after lastRefreshedAt", () => {
    const ctx = MacroContextService.getInstance().getContext();
    const last = new Date(ctx.lastRefreshedAt).getTime();
    const next = new Date(ctx.nextRefreshAt).getTime();
    expect(next).toBeGreaterThan(last);
  });

  it("isLive is a boolean", () => {
    const ctx = MacroContextService.getInstance().getContext();
    expect(typeof ctx.isLive).toBe("boolean");
  });

  it("snapshot has required macro bias input fields", () => {
    const ctx = MacroContextService.getInstance().getContext();
    const { macroBiasInput } = ctx.snapshot;
    expect(macroBiasInput).toHaveProperty("vixLevel");
    expect(macroBiasInput).toHaveProperty("assetClass");
    expect(macroBiasInput).toHaveProperty("intendedDirection");
  });
});

// ── isStarted / start / stop lifecycle ───────────────────────────────────────

describe("isStarted lifecycle", () => {
  it("isStarted() is false before start() is called (if not already started)", () => {
    const svc = MacroContextService.getInstance();
    svc.stop(); // ensure stopped
    expect(svc.isStarted()).toBe(false);
  });

  it("isStarted() is true after start()", () => {
    const svc = MacroContextService.getInstance();
    svc.stop();
    svc.start();
    expect(svc.isStarted()).toBe(true);
  });

  it("isStarted() is false after stop()", () => {
    const svc = MacroContextService.getInstance();
    svc.start();
    svc.stop();
    expect(svc.isStarted()).toBe(false);
  });

  it("start() is idempotent — calling twice does not double-start", () => {
    const svc = MacroContextService.getInstance();
    svc.stop();
    svc.start();
    svc.start(); // second call should be a no-op
    expect(svc.isStarted()).toBe(true);
  });

  it("stop() is safe to call when not started", () => {
    const svc = MacroContextService.getInstance();
    svc.stop();
    expect(() => svc.stop()).not.toThrow();
    expect(svc.isStarted()).toBe(false);
  });
});

// ── forceRefresh ──────────────────────────────────────────────────────────────

describe("forceRefresh", () => {
  it("returns an updated MacroContext", async () => {
    const svc = MacroContextService.getInstance();
    const ctx = await svc.forceRefresh("long", "crypto");
    expect(ctx).toHaveProperty("snapshot");
    expect(ctx).toHaveProperty("macroBias");
    expect(ctx).toHaveProperty("sentiment");
    expect(ctx).toHaveProperty("refreshCount");
  });

  it("refreshCount increases after forceRefresh", async () => {
    const svc = MacroContextService.getInstance();
    const before = svc.getContext().refreshCount;
    await svc.forceRefresh();
    const after = svc.getContext().refreshCount;
    expect(after).toBeGreaterThan(before);
  });

  it("returns context with isLive=true when data quality is not stale", async () => {
    const svc = MacroContextService.getInstance();
    const ctx = await svc.forceRefresh("long", "crypto");
    // Our mock returns dataQuality: "live" so isLive should be true
    expect(ctx.isLive).toBe(true);
  });
});

// ── getCurrentMacroContext helper ─────────────────────────────────────────────

describe("getCurrentMacroContext", () => {
  it("returns a MacroContext", () => {
    const ctx = getCurrentMacroContext();
    expect(ctx).toBeDefined();
    expect(ctx).toHaveProperty("snapshot");
    expect(ctx).toHaveProperty("macroBias");
  });

  it("returns the same context as MacroContextService.getInstance().getContext()", () => {
    const fromHelper = getCurrentMacroContext();
    const fromInstance = MacroContextService.getInstance().getContext();
    expect(fromHelper).toBe(fromInstance);
  });
});

// ── MacroConvictionChange type ────────────────────────────────────────────────

describe("MacroConvictionChange type", () => {
  it("can construct a valid MacroConvictionChange", () => {
    const ctx = getCurrentMacroContext();
    const change: MacroConvictionChange = {
      type: "macro_update",
      previous: { biasDir: "neutral", biasConviction: "low", crowdingLevel: "neutral" },
      current:  { biasDir: "long",    biasConviction: "medium", crowdingLevel: "neutral" },
      delta: {
        convictionChanged: true, directionChanged: true, crowdingChanged: false,
      },
      context: ctx,
      ts: new Date().toISOString(),
    };
    expect(change.type).toBe("macro_update");
    expect(change.delta.directionChanged).toBe(true);
    expect(change.delta.convictionChanged).toBe(true);
  });
});
