/**
 * Tests for Phase 5: Memory Recall + Post-Trade Learning
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  processTradeOutcome,
  getTracker,
  getAllTrackers,
  getDriftAlerts,
  getCriticalDriftStrategies,
  _resetTrackers,
} from "../lib/learning/post_trade_loop";

describe("Post-Trade Learning Loop", () => {
  beforeEach(() => _resetTrackers());

  const makeRecord = (overrides = {}) => ({
    symbol: "AAPL",
    strategy: "momentum_v1",
    direction: "long" as const,
    entryPrice: 150,
    exitPrice: 155,
    pnl: 250,
    pnlPct: 0.033,
    exitReason: "tp",
    regime: "trend_up",
    session: "us_regular",
    holdBars: 12,
    ...overrides,
  });

  it("records a winning trade", async () => {
    const result = await processTradeOutcome(makeRecord());
    expect(result.recorded).toBe(true);
    expect(result.currentPerformance.totalTrades).toBe(1);
    expect(result.currentPerformance.wins).toBe(1);
    expect(result.currentPerformance.liveWinRate).toBe(1.0);
  });

  it("records a losing trade", async () => {
    const result = await processTradeOutcome(makeRecord({
      exitPrice: 145,
      pnl: -250,
      pnlPct: -0.033,
      exitReason: "sl",
    }));
    expect(result.currentPerformance.losses).toBe(1);
    expect(result.currentPerformance.liveWinRate).toBe(0);
  });

  it("tracks multiple trades and computes win rate", async () => {
    // 7 wins, 3 losses
    for (let i = 0; i < 7; i++) {
      await processTradeOutcome(makeRecord());
    }
    for (let i = 0; i < 3; i++) {
      await processTradeOutcome(makeRecord({ pnl: -100, pnlPct: -0.01, exitReason: "sl" }));
    }

    const tracker = getTracker("momentum_v1");
    expect(tracker).not.toBeNull();
    expect(tracker!.totalTrades).toBe(10);
    expect(tracker!.wins).toBe(7);
    expect(tracker!.liveWinRate).toBeCloseTo(0.7, 1);
  });

  it("detects calibration drift", async () => {
    // Backtest says 60% win rate, but we only win 30%
    for (let i = 0; i < 3; i++) {
      await processTradeOutcome(makeRecord(), 0.60);
    }
    for (let i = 0; i < 7; i++) {
      await processTradeOutcome(makeRecord({ pnl: -100, pnlPct: -0.01, exitReason: "sl" }), 0.60);
    }

    const tracker = getTracker("momentum_v1");
    expect(tracker!.calibrationDrift).toBeCloseTo(0.30, 1);

    // Should have a critical drift alert
    const alerts = getDriftAlerts();
    expect(alerts.length).toBeGreaterThan(0);
    expect(alerts.some(a => a.severity === "critical")).toBe(true);
  });

  it("identifies critical drift strategies", async () => {
    // Build 10 losing trades with 60% backtest expectation
    for (let i = 0; i < 2; i++) {
      await processTradeOutcome(makeRecord(), 0.60);
    }
    for (let i = 0; i < 8; i++) {
      await processTradeOutcome(makeRecord({ pnl: -100, pnlPct: -0.01, exitReason: "sl" }), 0.60);
    }

    const critical = getCriticalDriftStrategies();
    expect(critical.length).toBe(1);
    expect(critical[0].strategyId).toBe("momentum_v1");
  });

  it("maintains sliding window of recent trades", async () => {
    for (let i = 0; i < 25; i++) {
      await processTradeOutcome(makeRecord({ symbol: `SYM${i}` }));
    }
    const tracker = getTracker("momentum_v1");
    expect(tracker!.recentTrades.length).toBe(20); // max window size
    expect(tracker!.totalTrades).toBe(25);
  });

  it("getAllTrackers returns all strategies", async () => {
    await processTradeOutcome(makeRecord({ strategy: "strat_a" }));
    await processTradeOutcome(makeRecord({ strategy: "strat_b" }));
    const all = getAllTrackers();
    expect(all.length).toBe(2);
  });
});
