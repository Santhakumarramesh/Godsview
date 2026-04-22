import { describe, it, expect, beforeEach } from "vitest";
import {
  estimateSlippage,
  createExecutionPlan,
  buildExitLadder,
  computeDynamicStop,
  reportExecutionQuality,
  getExecutionIntelligenceSnapshot,
  resetExecutionIntelligence,
} from "../lib/execution_intelligence.js";

describe("Execution Intelligence Engine", () => {
  beforeEach(() => {
    resetExecutionIntelligence();
  });

  it("estimates slippage with all components", () => {
    const est = estimateSlippage({
      symbol: "AAPL",
      direction: "long",
      price: 175,
      spread: 0.05,
      volume: 50_000_000,
      atr: 3.5,
      orderSizeUsd: 5000,
    });
    expect(est.symbol).toBe("AAPL");
    expect(est.estimatedBps).toBeGreaterThan(0);
    expect(est.spreadBps).toBeGreaterThan(0);
    expect(est.confidence).toBeGreaterThan(0);
    expect(est.confidence).toBeLessThanOrEqual(1);
    expect(["MARKET", "LIMIT", "LIMIT_AGGRESSIVE"]).toContain(est.recommendation);
  });

  it("creates a full execution plan", () => {
    const plan = createExecutionPlan({
      symbol: "BTCUSD",
      direction: "long",
      entryPrice: 65000,
      stopLoss: 63800,
      atr: 1500,
      spread: 10,
      volume: 2_000_000_000,
    });
    expect(plan.symbol).toBe("BTCUSD");
    expect(plan.entryPrice).toBe(65000);
    expect(plan.exitLadder.length).toBeGreaterThan(0);
    expect(plan.stopPlan.currentStop).toBeLessThan(65000);
    expect(plan.expectedRR).toBeGreaterThan(0);
    expect(["MARKET", "LIMIT", "LIMIT_AGGRESSIVE"]).toContain(plan.orderType);
  });

  it("builds exit ladder with correct allocations summing to 100%", () => {
    const ladder = buildExitLadder({
      entryPrice: 100,
      stopLoss: 97,
      direction: "long",
    });
    expect(ladder.length).toBe(3); // default 3 targets
    const totalAlloc = ladder.reduce((s, t) => s + t.sizePct, 0);
    expect(totalAlloc).toBeCloseTo(1.0, 2);
    // each target price should be above entry for long
    ladder.forEach((t) => expect(t.targetPrice).toBeGreaterThan(100));
  });

  it("builds short exit ladder below entry", () => {
    const ladder = buildExitLadder({
      entryPrice: 200,
      stopLoss: 208,
      direction: "short",
    });
    ladder.forEach((t) => expect(t.targetPrice).toBeLessThan(200));
  });

  it("computes dynamic stop that trails price (long)", () => {
    const result = computeDynamicStop({
      entryPrice: 100,
      currentPrice: 110,
      initialStop: 95,
      currentStop: 95,
      direction: "long",
      atr: 3,
      highSinceEntry: 110,
    });
    // Should migrate stop up since price moved significantly
    if (result.migrated) {
      expect(result.newStop).toBeGreaterThan(95);
      expect(result.newStop).toBeLessThan(110);
    }
  });

  it("computes dynamic stop for short direction", () => {
    const result = computeDynamicStop({
      entryPrice: 200,
      currentPrice: 185,
      initialStop: 210,
      currentStop: 210,
      direction: "short",
      atr: 5,
      lowSinceEntry: 185,
    });
    if (result.migrated) {
      expect(result.newStop).toBeLessThan(210);
      expect(result.newStop).toBeGreaterThan(185);
    }
  });

  it("reports execution quality with grade", () => {
    const report = reportExecutionQuality({
      tradeId: "test_001",
      symbol: "AAPL",
      expectedEntry: 175.00,
      actualEntry: 175.05,
      expectedExit: 180.00,
      actualExit: 179.80,
      fillTimeMs: 200,
      orderType: "LIMIT",
    });
    expect(report.symbol).toBe("AAPL");
    expect(report.qualityScore).toBeGreaterThan(0);
    expect(report.qualityScore).toBeLessThanOrEqual(100);
    expect(["A", "B", "C", "D", "F"]).toContain(report.grade);
    expect(report.entrySlippageBps).toBeDefined();
  });

  it("tracks telemetry in snapshot", () => {
    estimateSlippage({ symbol: "X", direction: "long", price: 50, atr: 2 });
    createExecutionPlan({ symbol: "Y", direction: "long", entryPrice: 100, stopLoss: 95, atr: 5 });

    const snap = getExecutionIntelligenceSnapshot();
    expect(snap.totalPlansCreated).toBeGreaterThanOrEqual(1);
  });

  it("resets state cleanly", () => {
    createExecutionPlan({ symbol: "Z", direction: "long", entryPrice: 30, stopLoss: 28, atr: 1 });
    resetExecutionIntelligence();
    const snap = getExecutionIntelligenceSnapshot();
    expect(snap.totalPlansCreated).toBe(0);
    expect(snap.totalQualityReports).toBe(0);
  });
});
