import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  recordStrategyPerformance,
  compareStrategies,
  evaluateRetrainTriggers,
  attributeTrade,
  getRegimePerformance,
  getRetirementCandidates,
  getAdaptiveLearningSnapshot,
  resetAdaptiveLearning,
} from "../lib/adaptive_learning_engine";

describe("Adaptive Learning Engine", () => {
  beforeEach(() => {
    resetAdaptiveLearning();
  });

  it("records and retrieves strategy performance", () => {
    recordStrategyPerformance({
      strategyId: "strat-1", version: 1, regime: "TRENDING",
      totalTrades: 50, winRate: 0.62, profitFactor: 1.8, sharpeRatio: 1.5,
      maxDrawdownPct: 8, expectancy: 0.15, avgWin: 0.3, avgLoss: 0.18,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const snap = getAdaptiveLearningSnapshot();
    const records = snap.strategies as Record<string, any[]>;
    expect(records["strat-1"]).toBeDefined();
    expect(records["strat-1"].length).toBe(1);
    expect(records["strat-1"][0].winRate).toBe(0.62);
  });

  it("compares champion vs challenger", () => {
    recordStrategyPerformance({
      strategyId: "champ", version: 1, regime: "ALL",
      totalTrades: 100, winRate: 0.58, profitFactor: 1.6, sharpeRatio: 1.3,
      maxDrawdownPct: 10, expectancy: 0.12, avgWin: 0.25, avgLoss: 0.18,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    recordStrategyPerformance({
      strategyId: "chall", version: 1, regime: "ALL",
      totalTrades: 80, winRate: 0.65, profitFactor: 2.0, sharpeRatio: 1.8,
      maxDrawdownPct: 6, expectancy: 0.20, avgWin: 0.30, avgLoss: 0.15,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const result = compareStrategies("champ", "chall");
    expect(["CHAMPION_WINS", "CHALLENGER_WINS", "INCONCLUSIVE"]).toContain(result.verdict);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("detects retrain triggers for weak strategy", () => {
    recordStrategyPerformance({
      strategyId: "weak", version: 1, regime: "ALL",
      totalTrades: 40, winRate: 0.28, profitFactor: 0.7, sharpeRatio: 0.3,
      maxDrawdownPct: 22, expectancy: -0.05, avgWin: 0.10, avgLoss: 0.20,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const triggers = evaluateRetrainTriggers("weak");
    expect(triggers.length).toBeGreaterThan(0);
    const types = triggers.map(t => t.triggerType);
    expect(types).toContain("WIN_RATE_DROP");
    expect(types).toContain("DRAWDOWN_BREACH");
  });

  it("attributes a winning trade", () => {
    const attr = attributeTrade({
      tradeId: "t1", strategyId: "strat-1", symbol: "NQ",
      direction: "long", pnl: 150, entryPrice: 18000, exitPrice: 18150,
      entryTime: new Date().toISOString(), exitTime: new Date().toISOString(),
      regime: "TRENDING", structureScore: 0.8, orderFlowScore: 0.7,
      contextFusionScore: 0.75, macroBiasAligned: true, sentimentAligned: true,
    });
    expect(attr.outcome).toBe("WIN");
    expect(attr.factors.length).toBeGreaterThan(0);
    expect(attr.summary).toContain("WIN");
    expect(attr.entryQuality).toBeGreaterThan(0.5);
  });

  it("identifies retirement candidates", () => {
    recordStrategyPerformance({
      strategyId: "dead-strat", version: 1, regime: "ALL",
      totalTrades: 50, winRate: 0.25, profitFactor: 0.5, sharpeRatio: -0.2,
      maxDrawdownPct: 30, expectancy: -0.10, avgWin: 0.08, avgLoss: 0.20,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const candidates = getRetirementCandidates();
    expect(candidates).toContain("dead-strat");
  });

  it("tracks regime performance", () => {
    recordStrategyPerformance({
      strategyId: "s1", version: 1, regime: "TRENDING",
      totalTrades: 30, winRate: 0.70, profitFactor: 2.5, sharpeRatio: 2.0,
      maxDrawdownPct: 5, expectancy: 0.25, avgWin: 0.35, avgLoss: 0.15,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    recordStrategyPerformance({
      strategyId: "s1", version: 1, regime: "CHOPPY",
      totalTrades: 20, winRate: 0.35, profitFactor: 0.8, sharpeRatio: 0.2,
      maxDrawdownPct: 12, expectancy: -0.03, avgWin: 0.10, avgLoss: 0.15,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const perf = getRegimePerformance("s1");
    expect(perf.length).toBe(2);
    const trending = perf.find(p => p.regime === "TRENDING");
    const choppy = perf.find(p => p.regime === "CHOPPY");
    expect(trending!.winRate).toBeGreaterThan(choppy!.winRate);
  });

  it("reset clears all state", () => {
    recordStrategyPerformance({
      strategyId: "x", version: 1, regime: "ALL",
      totalTrades: 10, winRate: 0.5, profitFactor: 1.0, sharpeRatio: 0.5,
      maxDrawdownPct: 5, expectancy: 0, avgWin: 0.1, avgLoss: 0.1,
      lastTradeAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    resetAdaptiveLearning();
    const snap = getAdaptiveLearningSnapshot();
    expect(Object.keys(snap.strategies).length).toBe(0);
    expect(snap.totalTradesAttributed).toBe(0);
  });
});
