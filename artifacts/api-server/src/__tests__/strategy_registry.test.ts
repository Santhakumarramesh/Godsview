import { describe, it, expect, beforeEach } from "vitest";
import {
  registerStrategy,
  promoteStrategy,
  updateStrategyVersion,
  updateStrategyPerformance,
  getStrategy,
  listStrategies,
  getLiveStrategies,
  getRegistrySnapshot,
  resetRegistry,
} from "../lib/strategy_registry.js";

describe("Strategy Registry", () => {
  beforeEach(() => {
    resetRegistry();
  });

  it("registers a new strategy in draft state", () => {
    const s = registerStrategy({ name: "MeanRevert_v1", author: "god", tags: ["mean-reversion"] });
    expect(s.state).toBe("draft");
    expect(s.currentVersion).toBe(1);
    expect(s.tags).toContain("mean-reversion");
    expect(s.versions).toHaveLength(1);
  });

  it("promotes through the full lifecycle", () => {
    const s = registerStrategy({ name: "Trend_v1" });
    const states = ["parsed", "backtested", "stress_tested", "paper_approved",
      "live_assisted_approved", "autonomous_approved", "retired"] as const;
    for (const target of states) {
      const promoted = promoteStrategy(s.id, target);
      expect(promoted.state).toBe(target);
    }
    expect(s.retiredAt).not.toBeNull();
  });

  it("rejects invalid state transitions", () => {
    const s = registerStrategy({ name: "Bad_v1" });
    expect(() => promoteStrategy(s.id, "autonomous_approved")).toThrow("Invalid transition");
    expect(() => promoteStrategy(s.id, "retired")).toThrow("Invalid transition");
  });

  it("versions a strategy", () => {
    const s = registerStrategy({ name: "Versioned_v1", parameters: { period: 14 } });
    updateStrategyVersion(s.id, { parameters: { period: 21 }, changelog: "Tuned period" });
    const updated = getStrategy(s.id)!;
    expect(updated.currentVersion).toBe(2);
    expect(updated.parameters.period).toBe(21);
    expect(updated.versions).toHaveLength(2);
    expect(updated.versions[1].changelog).toBe("Tuned period");
  });

  it("updates performance metrics", () => {
    const s = registerStrategy({ name: "Perf_v1" });
    updateStrategyPerformance(s.id, {
      sharpe: 2.1, winRate: 0.65, profitFactor: 1.8,
      maxDrawdown: 0.12, totalTrades: 200, netPnl: 15000,
      lastUpdated: new Date().toISOString(),
    });
    const updated = getStrategy(s.id)!;
    expect(updated.performance?.sharpe).toBe(2.1);
    expect(updated.performance?.winRate).toBe(0.65);
  });

  it("filters strategies by state and tag", () => {
    const s1 = registerStrategy({ name: "A", tags: ["trend"] });
    const s2 = registerStrategy({ name: "B", tags: ["mean-reversion"] });
    promoteStrategy(s1.id, "parsed");

    expect(listStrategies({ state: "parsed" })).toHaveLength(1);
    expect(listStrategies({ state: "draft" })).toHaveLength(1);
    expect(listStrategies({ tag: "trend" })).toHaveLength(1);
  });

  it("returns only live strategies", () => {
    const s = registerStrategy({ name: "LiveOne" });
    promoteStrategy(s.id, "parsed");
    promoteStrategy(s.id, "backtested");
    promoteStrategy(s.id, "stress_tested");
    promoteStrategy(s.id, "paper_approved");
    promoteStrategy(s.id, "live_assisted_approved");
    expect(getLiveStrategies()).toHaveLength(1);
    expect(getLiveStrategies()[0].id).toBe(s.id);
  });

  it("snapshot tracks state distribution and promotions", () => {
    registerStrategy({ name: "X" });
    const s2 = registerStrategy({ name: "Y" });
    promoteStrategy(s2.id, "parsed");

    const snap = getRegistrySnapshot();
    expect(snap.totalStrategies).toBe(2);
    expect(snap.byState.draft).toBe(1);
    expect(snap.byState.parsed).toBe(1);
    expect(snap.recentPromotions).toHaveLength(1);
  });

  it("resets cleanly", () => {
    registerStrategy({ name: "Gone" });
    resetRegistry();
    expect(getRegistrySnapshot().totalStrategies).toBe(0);
  });
});
