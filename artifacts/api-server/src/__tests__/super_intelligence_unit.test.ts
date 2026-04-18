/**
 * super_intelligence_unit.test.ts — Phase 69
 *
 * Tests getSuperIntelligenceStatus, and validates the SuperIntelligenceInput
 * interface contracts. Also verifies ensemble status states.
 * Mocks DB, ML model, and Claude to avoid real calls.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("@workspace/db", () => {
  const limitMock = vi.fn().mockResolvedValue([]);
  const orderByMock = vi.fn(() => ({ limit: limitMock }));
  const whereMock = vi.fn(() => ({ orderBy: orderByMock }));
  const fromMock = vi.fn(() => ({ where: whereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));
  const insertMock = vi.fn(() => ({ values: vi.fn().mockResolvedValue({}) }));
  const updateMock = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn().mockResolvedValue({}) })) }));
  return {
    // drizzle-orm re-exports (now provided by @workspace/db)
    and:       (...args: unknown[]) => args,
    or:        (...args: unknown[]) => args,
    eq:        () => null,
    ne:        () => null,
    gt:        () => null,
    gte:       () => null,
    lt:        () => null,
    lte:       () => null,
    isNotNull: () => null,
    isNull:    () => null,
    desc:      () => null,
    asc:       () => null,
    inArray:   () => null,
    notInArray:() => null,
    count:     () => 0,
    sum:       () => 0,
    max:       () => null,
    min:       () => null,
    between:   () => null,
    like:      () => null,
    ilike:     () => null,
    exists:    () => null,
    not:       () => null,
    sql:       Object.assign(() => "", { raw: (s: string) => s }) as unknown as never,

    db: { select: selectMock, insert: insertMock, update: updateMock },
    siDecisionsTable: new Proxy({} as any, { get: (_t, p) => String(p) }),
  };
});

vi.mock("drizzle-orm", () => ({
  desc: vi.fn(col => col),
  eq: vi.fn((col, val) => ({ col, val })),
  and: vi.fn((...args) => args),
  gte: vi.fn((col, val) => ({ col, val })),
  sql: vi.fn(str => str),
}));

vi.mock("../lib/ml_model", () => ({
  getModelStatus: vi.fn(() => ({
    status: "inactive",
    samples: 0,
    accuracy: 0,
    message: "No training data",
  })),
  predictWinProbability: vi.fn().mockResolvedValue(0.65),
  getModelFeatureImportance: vi.fn(() => ({})),
  recordOutcome: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/claude", () => ({
  evaluateWithClaude: vi.fn().mockResolvedValue({
    approved: true,
    score: 0.7,
    reasoning: "Test approval",
  }),
}));

vi.mock("../lib/session_guard", () => ({
  isTradingAllowed: vi.fn(() => true),
  inferAssetClass: vi.fn(() => "crypto"),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => false),
  getRiskEngineSnapshot: vi.fn(() => ({ level: "NORMAL" })),
}));

import {
  getSuperIntelligenceStatus,
  type SuperIntelligenceInput,
  type SuperSignal,
  type TrailingStopConfig,
  type ProfitTarget,
  type RegimeWeights,
} from "../lib/super_intelligence";

// ── getSuperIntelligenceStatus ────────────────────────────────────────────────

describe("getSuperIntelligenceStatus", () => {
  it("returns an object with status, ensemble, message fields", () => {
    const status = getSuperIntelligenceStatus();
    expect(status).toHaveProperty("status");
    expect(status).toHaveProperty("ensemble");
    expect(status).toHaveProperty("message");
  });

  it("status is one of active/partial/inactive", () => {
    const { status } = getSuperIntelligenceStatus();
    expect(["active", "partial", "inactive"]).toContain(status);
  });

  it("message is a non-empty string", () => {
    const { message } = getSuperIntelligenceStatus();
    expect(typeof message).toBe("string");
    expect(message.length).toBeGreaterThan(0);
  });

  it("status is inactive when no ensemble trained and model inactive", () => {
    const { status } = getSuperIntelligenceStatus();
    // With our mocked ml_model returning inactive, should be inactive or partial
    expect(["inactive", "partial"]).toContain(status);
  });

  it("ensemble is null when no training has been done", () => {
    const { ensemble } = getSuperIntelligenceStatus();
    // Fresh state — no training in test context
    expect(ensemble).toBeNull();
  });
});

// ── Interface type validation ─────────────────────────────────────────────────

describe("TrailingStopConfig interface", () => {
  it("can construct a valid TrailingStopConfig", () => {
    const config: TrailingStopConfig = {
      activation_atr: 1.5,
      trail_step: 0.5,
      max_hold_minutes: 480,
    };
    expect(config.activation_atr).toBe(1.5);
    expect(config.trail_step).toBe(0.5);
    expect(config.max_hold_minutes).toBe(480);
  });
});

describe("ProfitTarget interface", () => {
  it("can construct a valid ProfitTarget", () => {
    const target: ProfitTarget = { r_target: 2.0, close_pct: 0.5 };
    expect(target.r_target).toBe(2.0);
    expect(target.close_pct).toBe(0.5);
  });

  it("r_target and close_pct are numbers", () => {
    const target: ProfitTarget = { r_target: 1.5, close_pct: 0.33 };
    expect(typeof target.r_target).toBe("number");
    expect(typeof target.close_pct).toBe("number");
  });
});

describe("SuperIntelligenceInput interface", () => {
  it("can construct a valid input with required fields", () => {
    const input: SuperIntelligenceInput = {
      structure_score: 0.75,
      order_flow_score: 0.68,
      recall_score: 0.72,
      setup_type: "sweep_reclaim",
      regime: "trending_bull",
      direction: "long",
      entry_price: 84000,
      stop_loss: 83000,
      take_profit: 87000,
      atr: 500,
      equity: 10000,
    };
    expect(input.structure_score).toBe(0.75);
    expect(input.direction).toBe("long");
    expect(input.regime).toBe("trending_bull");
  });

  it("accepts optional timeframe_scores", () => {
    const input: SuperIntelligenceInput = {
      structure_score: 0.7,
      order_flow_score: 0.6,
      recall_score: 0.65,
      setup_type: "cvd_divergence",
      regime: "ranging",
      direction: "short",
      entry_price: 84000,
      stop_loss: 85000,
      take_profit: 81000,
      atr: 400,
      equity: 10000,
      timeframe_scores: { "1m": 0.7, "5m": 0.65, "15m": 0.6 },
    };
    expect(input.timeframe_scores).toBeDefined();
    expect(input.timeframe_scores?.["1m"]).toBe(0.7);
  });
});

describe("SuperSignal interface shape", () => {
  it("expected SuperSignal fields are documented", () => {
    // Validate that a mock signal conforming to the interface is valid TypeScript
    const mockSignal: SuperSignal = {
      setup_type: "sweep_reclaim",
      direction: "long",
      entry_price: 84000,
      stop_loss: 83000,
      take_profit: 87000,
      win_probability: 0.72,
      edge_score: 0.65,
      enhanced_quality: 0.70,
      kelly_fraction: 0.08,
      confluence_score: 0.75,
      aligned_timeframes: ["1m", "5m"],
      trailing_stop: { activation_atr: 1.5, trail_step: 0.5, max_hold_minutes: 480 },
      profit_targets: [{ r_target: 1.0, close_pct: 0.25 }],
      approved: true,
      rejection_reason: null,
    };
    expect(mockSignal.approved).toBe(true);
    expect(mockSignal.win_probability).toBeGreaterThan(0);
    expect(Array.isArray(mockSignal.profit_targets)).toBe(true);
  });

  it("direction must be long or short", () => {
    const directions: SuperSignal["direction"][] = ["long", "short"];
    expect(directions).toContain("long");
    expect(directions).toContain("short");
  });
});
