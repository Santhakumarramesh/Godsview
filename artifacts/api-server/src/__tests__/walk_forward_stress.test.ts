import { describe, it, expect, beforeEach } from "vitest";
import {
  runWalkForward, runStressTest, runValidationGate,
  getWalkForwardStressSnapshot, resetWalkForwardStress,
} from "../lib/walk_forward_stress.js";

describe("Walk-Forward + Stress Testing", () => {
  beforeEach(() => { resetWalkForwardStress(); });

  it("runs walk-forward with correct window count", () => {
    const result = runWalkForward({ strategyId: "strat_1", baseSharpe: 1.8, windows: 4 });
    expect(result.totalWindows).toBe(4);
    expect(result.windows).toHaveLength(4);
    expect(["PASS", "FAIL", "MARGINAL"]).toContain(result.verdict);
    result.windows.forEach((w) => {
      expect(w.outOfSampleSharpe).toBeLessThanOrEqual(w.inSampleSharpe * 1.01);
      expect(w.degradation).toBeGreaterThanOrEqual(0);
    });
  });

  it("runs all 5 stress scenarios by default", () => {
    const result = runStressTest({ strategyId: "strat_2", baseSharpe: 2.0 });
    expect(result.scenarios).toHaveLength(5);
    result.scenarios.forEach((s) => {
      expect(s.stressedSharpe).toBeLessThanOrEqual(s.originalSharpe);
      expect(s.stressedMaxDD).toBeGreaterThanOrEqual(s.originalMaxDD);
    });
  });

  it("runs specific stress scenarios when requested", () => {
    const result = runStressTest({ strategyId: "strat_3", scenarios: ["MONTE_CARLO", "BLACK_SWAN"] });
    expect(result.scenarios).toHaveLength(2);
    expect(result.scenarios.map((s) => s.scenario)).toContain("MONTE_CARLO");
    expect(result.scenarios.map((s) => s.scenario)).toContain("BLACK_SWAN");
  });

  it("validation gate combines walk-forward and stress test", () => {
    const result = runValidationGate({ strategyId: "strat_4", baseSharpe: 1.5 });
    expect(result.walkForward).toBeDefined();
    expect(result.stressTest).toBeDefined();
    expect(["APPROVED", "REJECTED", "NEEDS_REVIEW"]).toContain(result.overallVerdict);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("high sharpe strategy more likely to pass", () => {
    // Run multiple times with high sharpe — at least some should pass
    let approvedCount = 0;
    for (let i = 0; i < 10; i++) {
      const r = runValidationGate({ strategyId: `high_${i}`, baseSharpe: 3.0, baseWinRate: 0.7, baseMaxDD: 0.05 });
      if (r.overallVerdict === "APPROVED") approvedCount++;
    }
    expect(approvedCount).toBeGreaterThanOrEqual(1);
  });

  it("snapshot tracks telemetry", () => {
    runValidationGate({ strategyId: "s1" });
    runValidationGate({ strategyId: "s2" });
    const snap = getWalkForwardStressSnapshot();
    expect(snap.totalValidations).toBe(2);
    expect(snap.totalWalkForwards).toBe(2);
    expect(snap.totalStressTests).toBe(2);
    expect(snap.recentValidations).toHaveLength(2);
  });

  it("resets cleanly", () => {
    runValidationGate({ strategyId: "x" });
    resetWalkForwardStress();
    const snap = getWalkForwardStressSnapshot();
    expect(snap.totalValidations).toBe(0);
    expect(snap.recentValidations).toHaveLength(0);
  });
});
