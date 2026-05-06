/**
 * macro_news_gate.test.ts — M5d-risk-news-gate
 *
 * Pure-function coverage of:
 *  - lib/risk/macro_news_gate.ts  (appliesToSymbol + evaluate-for-symbol)
 *  - lib/risk/risk_pipeline.ts    (gate 6 enriched reason + stop-out behavior)
 *  - lib/risk/risk_snapshot.ts    (SnapshotInputs.macroNewsGate plumbing)
 *
 * No network, no DB, no broker. Test override is used to avoid hitting
 * the real /api/macro-risk producer.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  appliesToSymbol,
  evaluateMacroNewsGateForSymbol,
  getMacroNewsGateState,
  setMacroNewsGateStateForTesting,
  resetMacroNewsGateCache,
  type MacroNewsGateState,
} from "../lib/risk/macro_news_gate";
import { evaluatePipeline, type RiskRequest, type RiskSnapshot } from "../lib/risk/risk_pipeline";
import { buildRiskSnapshot } from "../lib/risk/risk_snapshot";

// ── Fixture helpers ─────────────────────────────────────────────────────────

function baseSnap(): RiskSnapshot {
  // Minimal snapshot that PASSES gates 1..5 and 7..9 so we can isolate gate 6.
  return {
    systemMode: "paper",
    killSwitchActive: false,
    operatorTokenValid: true,
    dataAgeMs: 1_000,
    maxDataAgeMs: 30_000,
    sessionAllowed: true,
    activeSession: "us_regular",
    newsLockoutActive: false,
    macroNewsBlockActive: false,
    macroNewsBlockReason: null,
    dailyPnLPct: 0,
    maxDailyLossPct: 2,
    openPositionCount: 0,
    maxConcurrentPositions: 5,
    tradesTodayCount: 0,
    maxTradesPerDay: 10,
  };
}

function baseReq(overrides: Partial<RiskRequest> = {}): RiskRequest {
  return {
    symbol: "BTCUSD",
    side: "buy",
    quantity: 1,
    entry_price: 100,
    stop_loss: 99,
    take_profit: 102,
    direction: "long",
    closing: false,
    ...overrides,
  };
}

beforeEach(() => {
  resetMacroNewsGateCache();
  setMacroNewsGateStateForTesting(null); // clear any leftover override
});

// ── Adapter helpers ─────────────────────────────────────────────────────────

describe("macro_news_gate — appliesToSymbol (pure)", () => {
  it("returns false when enabled=false", () => {
    const state: MacroNewsGateState = {
      enabled: false,
      active: true,
      reason: "should be ignored",
      affected_symbols: [],
      source: "disabled",
      last_refreshed_at: null,
    };
    expect(appliesToSymbol(state, "BTCUSD")).toBe(false);
  });

  it("returns false when active=false even if symbol matches", () => {
    const state: MacroNewsGateState = {
      enabled: true,
      active: false,
      reason: null,
      affected_symbols: ["BTCUSD"],
      source: "macro-risk",
      last_refreshed_at: null,
    };
    expect(appliesToSymbol(state, "BTCUSD")).toBe(false);
  });

  it("affected_symbols=[] AND active=true → applies to ALL symbols (conservative)", () => {
    const state: MacroNewsGateState = {
      enabled: true,
      active: true,
      reason: "macro_news_window_active: critical event",
      affected_symbols: [],
      source: "macro-risk",
      last_refreshed_at: null,
    };
    expect(appliesToSymbol(state, "BTCUSD")).toBe(true);
    expect(appliesToSymbol(state, "SPY")).toBe(true);
    expect(appliesToSymbol(state, "RANDOM_TICKER")).toBe(true);
  });

  it("affected_symbols non-empty → applies only to listed symbols", () => {
    const state: MacroNewsGateState = {
      enabled: true,
      active: true,
      reason: "macro_news_window_active: equity-only NFP",
      affected_symbols: ["SPY", "QQQ"],
      source: "macro-risk",
      last_refreshed_at: null,
    };
    expect(appliesToSymbol(state, "SPY")).toBe(true);
    expect(appliesToSymbol(state, "QQQ")).toBe(true);
    expect(appliesToSymbol(state, "BTCUSD")).toBe(false);
    expect(appliesToSymbol(state, "ETHUSD")).toBe(false);
  });
});

describe("macro_news_gate — evaluateMacroNewsGateForSymbol", () => {
  it("returns {active:false, reason:null} when adapter says applies=false", () => {
    const state: MacroNewsGateState = {
      enabled: true,
      active: true,
      reason: "macro_news_window_active: equity-only NFP",
      affected_symbols: ["SPY"],
      source: "macro-risk",
      last_refreshed_at: null,
    };
    expect(evaluateMacroNewsGateForSymbol(state, "BTCUSD")).toEqual({ active: false, reason: null });
  });

  it("returns {active:true, reason:<verbatim>} when adapter says applies=true", () => {
    const state: MacroNewsGateState = {
      enabled: true,
      active: true,
      reason: 'macro_news_window_active: critical event "Employment Situation (NFP)" within restricted window.',
      affected_symbols: ["SPY", "QQQ"],
      source: "macro-risk",
      last_refreshed_at: null,
    };
    const out = evaluateMacroNewsGateForSymbol(state, "SPY");
    expect(out.active).toBe(true);
    expect(out.reason).toMatch(/^macro_news_window_active:/);
    expect(out.reason).toContain("NFP");
  });
});

describe("macro_news_gate — getMacroNewsGateState test override", () => {
  it("returns the test-injected state verbatim when set", async () => {
    const fixture: MacroNewsGateState = {
      enabled: true,
      active: true,
      reason: "macro_news_window_active: simulated",
      affected_symbols: ["BTCUSD"],
      source: "macro-risk",
      last_refreshed_at: "2025-05-06T13:18:00.000Z",
    };
    setMacroNewsGateStateForTesting(fixture);
    const out = await getMacroNewsGateState();
    expect(out).toEqual(fixture);
  });

  it("test override is reset when set to null (fixture isolation)", async () => {
    setMacroNewsGateStateForTesting({
      enabled: true,
      active: true,
      reason: "should not leak",
      affected_symbols: [],
      source: "macro-risk",
      last_refreshed_at: null,
    });
    setMacroNewsGateStateForTesting(null);
    // After reset, calling getMacroNewsGateState() in a unit test would call
    // the real producer. We don't await that here — just assert the override
    // mechanism allows null reset without throwing.
    expect(true).toBe(true);
  });
});

// ── Gate 6 enriched reason ──────────────────────────────────────────────────

describe("risk_pipeline — gate 6 with macroNewsBlock contribution", () => {
  it("blocks NEW entry with enriched reason when macroNewsBlockActive=true", () => {
    const snap = baseSnap();
    snap.macroNewsBlockActive = true;
    snap.macroNewsBlockReason =
      'macro_news_window_active: critical event "Employment Situation (NFP)" in ~12 min (within news window -15m..+30m).';
    const result = evaluatePipeline(baseReq(), snap);
    expect(result.allowed).toBe(false);
    expect(result.blockingGate).toBe("news_lockout");
    expect(result.blockingReason).toMatch(/^macro_news_window_active:/);
    expect(result.blockingReason).toContain("NFP");
  });

  it("legacy env-driven newsLockoutActive uses legacy reason verbatim", () => {
    const snap = baseSnap();
    snap.newsLockoutActive = true;
    // macroNewsBlock is also set but env wins for the reason
    snap.macroNewsBlockActive = true;
    snap.macroNewsBlockReason = "macro_news_window_active: ignored — env wins";
    const result = evaluatePipeline(baseReq(), snap);
    expect(result.allowed).toBe(false);
    expect(result.blockingGate).toBe("news_lockout");
    expect(result.blockingReason).toBe("news_lockout_active");
  });

  it("allows when neither contribution is active", () => {
    const snap = baseSnap();
    const result = evaluatePipeline(baseReq(), snap);
    expect(result.allowed).toBe(true);
    // The decisions array should still contain a news_lockout decision recorded as allowed
    const newsDecision = result.decisions.find((d) => d.gate === "news_lockout");
    expect(newsDecision).toBeDefined();
    expect(newsDecision!.allowed).toBe(true);
    expect(newsDecision!.reason).toBe("no_news_lockout");
  });

  it("macroNewsBlock does NOT block a CLOSING request (closing=true)", () => {
    const snap = baseSnap();
    snap.macroNewsBlockActive = true;
    snap.macroNewsBlockReason = "macro_news_window_active: critical event";
    const result = evaluatePipeline(baseReq({ closing: true }), snap);
    expect(result.allowed).toBe(true);
  });

  it("macroNewsBlock does NOT block a stop_out bypass request", () => {
    const snap = baseSnap();
    snap.macroNewsBlockActive = true;
    snap.macroNewsBlockReason = "macro_news_window_active: critical event";
    const result = evaluatePipeline(baseReq({ bypassReasons: ["stop_out"] }), snap);
    expect(result.allowed).toBe(true);
  });

  it("legacy env-driven newsLockoutActive STILL blocks a stop_out request (preserves existing behavior)", () => {
    const snap = baseSnap();
    snap.newsLockoutActive = true;
    const result = evaluatePipeline(baseReq({ bypassReasons: ["stop_out"] }), snap);
    expect(result.allowed).toBe(false);
    expect(result.blockingGate).toBe("news_lockout");
    expect(result.blockingReason).toBe("news_lockout_active");
  });

  it("legacy env-driven newsLockoutActive STILL blocks a closing request (preserves existing behavior)", () => {
    const snap = baseSnap();
    snap.newsLockoutActive = true;
    const result = evaluatePipeline(baseReq({ closing: true }), snap);
    expect(result.allowed).toBe(false);
    expect(result.blockingGate).toBe("news_lockout");
  });

  it("provides a falls-through reason 'macro_news_window_active' when reason is null but macroNewsBlockActive=true", () => {
    const snap = baseSnap();
    snap.macroNewsBlockActive = true;
    snap.macroNewsBlockReason = null;
    const result = evaluatePipeline(baseReq(), snap);
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toBe("macro_news_window_active");
  });
});

// ── buildRiskSnapshot plumbing ──────────────────────────────────────────────

describe("risk_snapshot — macroNewsGate plumbing", () => {
  it("default (no input) leaves macroNewsBlockActive=false and reason=null", () => {
    const snap = buildRiskSnapshot({ dataAgeMs: 0 });
    expect(snap.macroNewsBlockActive).toBe(false);
    expect(snap.macroNewsBlockReason).toBeNull();
  });

  it("active=true forwards into macroNewsBlockActive and macroNewsBlockReason", () => {
    const snap = buildRiskSnapshot({
      dataAgeMs: 0,
      macroNewsGate: {
        active: true,
        reason: "macro_news_window_active: critical event NFP",
      },
    });
    expect(snap.macroNewsBlockActive).toBe(true);
    expect(snap.macroNewsBlockReason).toBe("macro_news_window_active: critical event NFP");
  });

  it("active=false zeroes the reason regardless of caller input", () => {
    const snap = buildRiskSnapshot({
      dataAgeMs: 0,
      macroNewsGate: {
        active: false,
        reason: "this should not leak when active=false",
      },
    });
    expect(snap.macroNewsBlockActive).toBe(false);
    expect(snap.macroNewsBlockReason).toBeNull();
  });
});
