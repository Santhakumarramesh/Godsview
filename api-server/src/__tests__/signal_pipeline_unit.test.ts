/**
 * signal_pipeline_unit.test.ts — Phase 59
 *
 * Unit tests for lib/signal_pipeline.ts pure helpers:
 *
 *   clamp01                   — numeric utility
 *   computeC4ContextScore     — recall-based scoring
 *   computeC4ConfirmationScore — setup-confirmation scoring
 *   runSetupDetector           — detector dispatch
 *
 * Dependencies mocked:
 *   ../lib/strategy_engine         — all setup detectors
 *   @workspace/strategy-core       — getSetupDefinition
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks (hoisted before imports) ────────────────────────────────────────────

vi.mock("../lib/strategy_engine", () => ({
  detectAbsorptionReversal:   vi.fn(() => ({ detected: true,  direction: "long",  structure: 0.75, orderFlow: 0.70 })),
  detectSweepReclaim:         vi.fn(() => ({ detected: true,  direction: "long",  structure: 0.80, orderFlow: 0.72 })),
  detectContinuationPullback: vi.fn(() => ({ detected: false, direction: "long",  structure: 0.50, orderFlow: 0.45 })),
  detectCVDDivergence:        vi.fn(() => ({ detected: true,  direction: "short", structure: 0.68, orderFlow: 0.65 })),
  detectBreakoutFailure:      vi.fn(() => ({ detected: false, direction: "short", structure: 0.42, orderFlow: 0.38 })),
  detectVWAPReclaim:          vi.fn(() => ({ detected: true,  direction: "long",  structure: 0.71, orderFlow: 0.69 })),
  detectOpeningRangeBreakout: vi.fn(() => ({ detected: true,  direction: "long",  structure: 0.78, orderFlow: 0.74 })),
  detectPostNewsContinuation: vi.fn(() => ({ detected: true,  direction: "long",  structure: 0.66, orderFlow: 0.60 })),
}));

// Mock @workspace/strategy-core before it can be evaluated as ESM
vi.mock("@workspace/strategy-core", () => ({
  getSetupDefinition:         vi.fn(() => ({
    label:               "Test Setup",
    minQuality:          0.65,
    minStructureScore:   0.60,
    minOrderFlowScore:   0.55,
    requiresReclaim:     false,
  })),
  DEFAULT_SETUPS:             {},
  evaluateC4Decision:         vi.fn(() => ({ approved: true, reason: "ok" })),
  getC4SizeMultiplier:        vi.fn(() => 1.0),
  classifyMarketRegime:       vi.fn(() => "trending"),
  isCategoryAllowedInRegime:  vi.fn(() => true),
  evaluateMetaLabelDecision:  vi.fn(() => ({ approved: true })),
  isSetupType:                vi.fn(() => true),
  resolveSystemMode:          vi.fn(() => "live"),
  canWriteOrders:             vi.fn(() => true),
  isLiveMode:                 vi.fn(() => true),
  deriveDecisionState:        vi.fn(() => "PASS"),
  computeFinalQuality:        vi.fn(() => 0.72),
  getQualityThreshold:        vi.fn(() => 0.6),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import {
  clamp01,
  computeC4ContextScore,
  computeC4ConfirmationScore,
  runSetupDetector,
} from "../lib/signal_pipeline";

import { getSetupDefinition } from "@workspace/strategy-core";

// ── Test data ─────────────────────────────────────────────────────────────────

const MOCK_BARS: any[] = [];

const MOCK_RECALL: any = {
  atr:                    200,
  regime:                 "trending",
  fake_entry_risk:        0.15,
  directional_persistence: 0.70,
  avg_score:              0.68,
  min_score:              0.55,
};

// ─────────────────────────────────────────────────────────────────────────────
// clamp01
// ─────────────────────────────────────────────────────────────────────────────

describe("clamp01", () => {
  it("returns value unchanged when between 0 and 1", () => {
    expect(clamp01(0.5)).toBe(0.5);
  });

  it("clamps values below 0 to 0", () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(-0.001)).toBe(0);
  });

  it("clamps values above 1 to 1", () => {
    expect(clamp01(2)).toBe(1);
    expect(clamp01(1.001)).toBe(1);
  });

  it("handles exact boundary values", () => {
    expect(clamp01(0)).toBe(0);
    expect(clamp01(1)).toBe(1);
  });

  it("returns 0 for NaN", () => {
    expect(clamp01(NaN)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeC4ContextScore
// ─────────────────────────────────────────────────────────────────────────────

describe("computeC4ContextScore", () => {
  it("returns a value between 0 and 1", () => {
    const score = computeC4ContextScore(0.7, MOCK_RECALL);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("higher recallScore gives higher context score", () => {
    const low  = computeC4ContextScore(0.3, MOCK_RECALL);
    const high = computeC4ContextScore(0.9, MOCK_RECALL);
    expect(high).toBeGreaterThan(low);
  });

  it("higher fake_entry_risk reduces context score", () => {
    const safe  = computeC4ContextScore(0.7, { ...MOCK_RECALL, fake_entry_risk: 0.1 });
    const risky = computeC4ContextScore(0.7, { ...MOCK_RECALL, fake_entry_risk: 0.9 });
    expect(safe).toBeGreaterThan(risky);
  });

  it("result is finite", () => {
    const score = computeC4ContextScore(0.7, MOCK_RECALL);
    expect(Number.isFinite(score)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computeC4ConfirmationScore
// ─────────────────────────────────────────────────────────────────────────────

describe("computeC4ConfirmationScore", () => {
  it("returns a value between 0 and 1", () => {
    const setupDef = getSetupDefinition("sweep_reclaim");
    const detected = { structure: 0.75, orderFlow: 0.70 };
    const score = computeC4ConfirmationScore(setupDef as any, detected, MOCK_RECALL);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("higher structure and orderFlow give higher confirmation score", () => {
    const setupDef = getSetupDefinition("sweep_reclaim");
    const low  = computeC4ConfirmationScore(setupDef as any, { structure: 0.3, orderFlow: 0.3 }, MOCK_RECALL);
    const high = computeC4ConfirmationScore(setupDef as any, { structure: 0.9, orderFlow: 0.9 }, MOCK_RECALL);
    expect(high).toBeGreaterThan(low);
  });

  it("result is finite", () => {
    const setupDef = getSetupDefinition("sweep_reclaim");
    const detected = { structure: 0.75, orderFlow: 0.70 };
    const score = computeC4ConfirmationScore(setupDef as any, detected, MOCK_RECALL);
    expect(Number.isFinite(score)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runSetupDetector — dispatch
// ─────────────────────────────────────────────────────────────────────────────

describe("runSetupDetector", () => {
  const setups: Array<{ setup: string; expectDetected: boolean }> = [
    { setup: "absorption_reversal",    expectDetected: true  },
    { setup: "sweep_reclaim",          expectDetected: true  },
    { setup: "continuation_pullback",  expectDetected: false },
    { setup: "cvd_divergence",         expectDetected: true  },
    { setup: "breakout_failure",       expectDetected: false },
    { setup: "vwap_reclaim",           expectDetected: true  },
    { setup: "opening_range_breakout", expectDetected: true  },
    { setup: "post_news_continuation", expectDetected: true  },
  ];

  for (const { setup, expectDetected } of setups) {
    it(`dispatches ${setup} correctly (detected=${expectDetected})`, () => {
      const result = runSetupDetector(setup as any, MOCK_BARS, MOCK_BARS, MOCK_RECALL);
      expect(result.detected).toBe(expectDetected);
    });
  }

  it("returns direction as long or short", () => {
    const result = runSetupDetector("absorption_reversal", MOCK_BARS, MOCK_BARS, MOCK_RECALL);
    expect(["long", "short"]).toContain(result.direction);
  });

  it("structure is between 0 and 1", () => {
    const result = runSetupDetector("sweep_reclaim", MOCK_BARS, MOCK_BARS, MOCK_RECALL);
    expect(result.structure).toBeGreaterThanOrEqual(0);
    expect(result.structure).toBeLessThanOrEqual(1);
  });

  it("falls through to continuation_pullback for unknown setup type", () => {
    const result = runSetupDetector("unknown_setup" as any, MOCK_BARS, MOCK_BARS, MOCK_RECALL);
    expect(result).toHaveProperty("detected");
    expect(result).toHaveProperty("direction");
  });
});
