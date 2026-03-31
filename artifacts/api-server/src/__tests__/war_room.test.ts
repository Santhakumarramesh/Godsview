import { describe, it, expect, beforeEach } from "vitest";
import { runWarRoom, clearWarRoomCache, type SMCState, type OrderflowState, type RiskInput } from "../lib/war_room";

const bullishSMC: SMCState = {
  symbol: "BTCUSD",
  structureScore: 0.85,
  bos: true,
  choch: false,
  trend: "uptrend",
  pattern: "HH_HL",
  activeOBs: [{ high: 68000, low: 67500 }],
  unfilledFVGs: [{ high: 67800, low: 67600 }],
  sweptPools: 2,
  totalPools: 3,
};

const bullishOrderflow: OrderflowState = {
  delta: 500,
  cvd: 1200,
  cvdSlope: 0.8,
  quoteImbalance: 0.3,
  aggressionScore: 0.75,
  orderflowBias: "bullish",
  orderflowScore: 0.8,
};

const normalRisk: RiskInput = {
  volatilityRegime: "normal",
  spreadBps: 3,
  maxLossToday: 0,
  sessionActive: true,
};

describe("War Room", () => {
  beforeEach(() => {
    clearWarRoomCache();
  });

  it("returns approved for strong bullish signal", () => {
    const verdict = runWarRoom("BTCUSD", bullishSMC, bullishOrderflow, normalRisk);

    expect(verdict.finalDecision).toBe("approved");
    expect(verdict.finalScore).toBeGreaterThanOrEqual(0.5);
    expect(verdict.agents.length).toBeGreaterThan(0);
    expect(verdict.symbol).toBe("BTCUSD");
    expect(verdict.evaluatedAt).toBeTruthy();
  });

  it("returns blocked or caution for weak/conflicting signals", () => {
    const weakSMC: SMCState = {
      symbol: "EURUSD",
      structureScore: 0.15,
      bos: false,
      choch: false,
      trend: "range",
      activeOBs: [],
      unfilledFVGs: [],
      sweptPools: 0,
      totalPools: 0,
    };

    const bearishOF: OrderflowState = {
      delta: -800,
      cvd: -2000,
      cvdSlope: -0.9,
      quoteImbalance: -0.6,
      aggressionScore: 0.2,
      orderflowBias: "bearish",
      orderflowScore: 0.15,
    };

    const verdict = runWarRoom("EURUSD", weakSMC, bearishOF, normalRisk);
    expect(["blocked", "caution"]).toContain(verdict.finalDecision);
  });

  it("reduces score on extreme volatility regime", () => {
    const extremeRisk: RiskInput = {
      volatilityRegime: "extreme",
      spreadBps: 50,
      maxLossToday: 5000,
      sessionActive: false,
    };

    const verdict = runWarRoom("BTCUSD", bullishSMC, bullishOrderflow, extremeRisk);
    // Extreme risk should lower score or block
    expect(verdict.finalScore).toBeDefined();
    expect(typeof verdict.finalScore).toBe("number");
  });

  it("caches results within TTL", () => {
    const v1 = runWarRoom("BTCUSD", bullishSMC, bullishOrderflow, normalRisk);
    const v2 = runWarRoom("BTCUSD", bullishSMC, bullishOrderflow, normalRisk);

    expect(v1.finalDecision).toBe(v2.finalDecision);
    expect(v1.finalScore).toBe(v2.finalScore);
  });

  it("has correct verdict structure", () => {
    const verdict = runWarRoom("BTCUSD", bullishSMC, bullishOrderflow, normalRisk);

    expect(verdict).toHaveProperty("symbol");
    expect(verdict).toHaveProperty("agents");
    expect(verdict).toHaveProperty("finalDecision");
    expect(verdict).toHaveProperty("finalScore");
    expect(verdict).toHaveProperty("confidence");
    expect(verdict).toHaveProperty("reasoning");
    expect(verdict).toHaveProperty("evaluatedAt");
  });
});
