import { describe, it, expect, beforeEach } from "vitest";
import { calculatePositionSize, getSizingOracleSnapshot, resetSizingOracle } from "../lib/position_sizing_oracle.js";

describe("Position Sizing Oracle", () => {
  beforeEach(() => { resetSizingOracle(); });

  it("fixed fractional sizing", () => {
    const r = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, method: "FIXED_FRACTIONAL" });
    expect(r.shares).toBe(400); // $2000 risk / $5 per share
    expect(r.dollarRisk).toBeCloseTo(2000, 0);
    expect(r.riskPctActual).toBeCloseTo(0.02, 2);
  });

  it("kelly criterion sizing", () => {
    const r = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 50, stopLoss: 48, winRate: 0.6, avgWinLossRatio: 2.0, method: "KELLY" });
    expect(r.shares).toBeGreaterThan(0);
    expect(r.kellyFraction).toBeDefined();
    expect(r.kellyFraction!).toBeGreaterThan(0);
  });

  it("volatility-scaled reduces size for volatile assets", () => {
    const base = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, method: "FIXED_FRACTIONAL" });
    const vol = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, atr: 8, method: "VOLATILITY_SCALED" });
    // High ATR relative to price should reduce position
    expect(vol.shares).toBeLessThanOrEqual(base.shares);
  });

  it("regime-adjusted scales down in crisis", () => {
    const normal = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, method: "FIXED_FRACTIONAL" });
    const crisis = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, regime: "CRISIS", method: "REGIME_ADJUSTED" });
    expect(crisis.shares).toBeLessThan(normal.shares);
  });

  it("context score adjusts sizing", () => {
    const high = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, contextScore: 0.9 });
    const low = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 95, contextScore: 0.2 });
    expect(high.shares).toBeGreaterThan(low.shares);
  });

  it("returns 0 shares when stop = entry", () => {
    const r = calculatePositionSize({ equity: 100000, riskPct: 0.02, entryPrice: 100, stopLoss: 100 });
    expect(r.shares).toBe(0);
  });

  it("snapshot tracks telemetry", () => {
    calculatePositionSize({ equity: 50000, riskPct: 0.01, entryPrice: 200, stopLoss: 195 });
    calculatePositionSize({ equity: 50000, riskPct: 0.01, entryPrice: 200, stopLoss: 195, method: "KELLY" });
    const snap = getSizingOracleSnapshot();
    expect(snap.totalCalculations).toBe(2);
    expect(snap.methodDistribution.FIXED_FRACTIONAL).toBe(1);
    expect(snap.methodDistribution.KELLY).toBe(1);
  });
});
