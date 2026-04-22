/**
 * symbol_brain_unit.test.ts — Phase 60
 *
 * Unit tests for lib/symbol_brain.ts pure scoring functions:
 *
 *   computeBrainScore — weighted composite of component scores
 *
 * computeSymbolBrainState is an integration function that calls many
 * engine modules; it is covered indirectly via the brain_route tests.
 *
 * Dependencies mocked:
 *   All engine imports (smc_engine, regime_engine, orderflow_engine,
 *   stress_engine) — only needed for computeSymbolBrainState, not tested here.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks — prevent engine imports from loading ───────────────────────────────

vi.mock("../lib/smc_engine",        () => ({ computeSMCState: vi.fn() }));
vi.mock("../lib/regime_engine",     () => ({ computeFullRegime: vi.fn() }));
vi.mock("../lib/orderflow_engine",  () => ({
  computeOrderflowState:  vi.fn(),
  computeLiquidityMapState: vi.fn(),
  detectAbsorption:       vi.fn(() => []),
  detectSweepEvent:       vi.fn(() => []),
}));
vi.mock("../lib/stress_engine",     () => ({ computeVolatilityState: vi.fn() }));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { computeBrainScore, type BrainScoreInputs } from "../lib/symbol_brain";

// ─────────────────────────────────────────────────────────────────────────────
// computeBrainScore
// ─────────────────────────────────────────────────────────────────────────────

const BASELINE: BrainScoreInputs = {
  structureScore:  0.75,
  regimeScore:     0.70,
  orderflowScore:  0.65,
  liquidityScore:  0.60,
  volScore:        0.55,
  stressPenalty:   0.80,
};

describe("computeBrainScore", () => {
  it("returns a number between 0 and 1", () => {
    const score = computeBrainScore(BASELINE);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  it("returns a finite number", () => {
    const score = computeBrainScore(BASELINE);
    expect(Number.isFinite(score)).toBe(true);
  });

  it("all-zero inputs returns 0", () => {
    const score = computeBrainScore({
      structureScore: 0, regimeScore: 0, orderflowScore: 0,
      liquidityScore: 0, volScore: 0, stressPenalty: 0,
    });
    expect(score).toBe(0);
  });

  it("all-one inputs returns 1", () => {
    const score = computeBrainScore({
      structureScore: 1, regimeScore: 1, orderflowScore: 1,
      liquidityScore: 1, volScore: 1, stressPenalty: 1,
    });
    expect(score).toBe(1);
  });

  it("structureScore has the highest weight (0.28)", () => {
    // Bump only structureScore — delta should exceed bumping any other single score
    const baseScore = computeBrainScore({ ...BASELINE, structureScore: 0 });
    const highStruct = computeBrainScore({ ...BASELINE, structureScore: 1 });
    const highOrderflow = computeBrainScore({ ...BASELINE, orderflowScore: 1 });
    // structureScore diff (0→1, weight 0.28) > orderflowScore diff (0.65→1, weight 0.22)
    expect(highStruct - baseScore).toBeGreaterThan(highOrderflow - computeBrainScore(BASELINE));
  });

  it("higher orderflowScore gives higher score", () => {
    const low  = computeBrainScore({ ...BASELINE, orderflowScore: 0.2 });
    const high = computeBrainScore({ ...BASELINE, orderflowScore: 0.9 });
    expect(high).toBeGreaterThan(low);
  });

  it("higher stressPenalty gives higher score", () => {
    const low  = computeBrainScore({ ...BASELINE, stressPenalty: 0.1 });
    const high = computeBrainScore({ ...BASELINE, stressPenalty: 1.0 });
    expect(high).toBeGreaterThan(low);
  });

  it("is deterministic for identical inputs", () => {
    const a = computeBrainScore(BASELINE);
    const b = computeBrainScore({ ...BASELINE });
    expect(a).toBe(b);
  });

  it("weights sum to 1 (verified via all-ones = 1)", () => {
    // The weighted sum with all 1.0 inputs = 0.28+0.14+0.22+0.12+0.10+0.14 = 1.00
    const score = computeBrainScore({
      structureScore: 1, regimeScore: 1, orderflowScore: 1,
      liquidityScore: 1, volScore: 1, stressPenalty: 1,
    });
    expect(score).toBeCloseTo(1.0, 5);
  });

  it("clamps overflowing inputs to 1", () => {
    const score = computeBrainScore({
      structureScore: 2, regimeScore: 2, orderflowScore: 2,
      liquidityScore: 2, volScore: 2, stressPenalty: 2,
    });
    expect(score).toBeLessThanOrEqual(1);
  });
});
