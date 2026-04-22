/**
 * position_sizer_unit.test.ts — Phase 61
 *
 * Unit tests for lib/position_sizer.ts:
 *
 *   estimateRiskUsd    — pure math helper
 *   computePositionSize — fixed-fractional sizing with exposure cap
 *
 * Dependencies mocked:
 *   ../lib/risk_engine   — getRiskEngineSnapshot (config)
 *   ../lib/equity_engine — generateEquityReport (Kelly metrics)
 *   ../lib/logger        — logger + logger.child
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => {
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: {
      info:  vi.fn(),
      warn:  vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => child),
    },
  };
});

vi.mock("../lib/risk_engine", () => ({
  getRiskEngineSnapshot: vi.fn(() => ({
    config: {
      maxRiskPerTradePct:  0.01,  // 1% per trade
      maxOpenExposurePct:  0.20,  // 20% total exposure
    },
  })),
}));

vi.mock("../lib/equity_engine", () => ({
  generateEquityReport: vi.fn(() => ({
    metrics: {
      totalTrades: 15,
      winRate:     0.60,
      avgWinPct:   0.025,
      avgLossPct:  0.015,
    },
  })),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import { estimateRiskUsd, computePositionSize } from "../lib/position_sizer";

// ─────────────────────────────────────────────────────────────────────────────
// estimateRiskUsd — pure math
// ─────────────────────────────────────────────────────────────────────────────

describe("estimateRiskUsd", () => {
  it("computes risk correctly for a standard trade", () => {
    // 0.1 units × |42000 − 41500| = 0.1 × 500 = 50
    expect(estimateRiskUsd(0.1, 42000, 41500)).toBeCloseTo(50, 5);
  });

  it("handles reversed entry/stop (absolute value)", () => {
    // stop above entry (short trade)
    expect(estimateRiskUsd(1, 100, 105)).toBeCloseTo(5, 5);
  });

  it("returns 0 when qty is 0", () => {
    expect(estimateRiskUsd(0, 42000, 41500)).toBe(0);
  });

  it("returns 0 when entry equals stop", () => {
    expect(estimateRiskUsd(1, 42000, 42000)).toBe(0);
  });

  it("scales linearly with qty", () => {
    const r1 = estimateRiskUsd(1, 100, 95);
    const r2 = estimateRiskUsd(2, 100, 95);
    expect(r2).toBeCloseTo(r1 * 2, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computePositionSize — shape and validity
// ─────────────────────────────────────────────────────────────────────────────

const BASE_REQ = {
  entryPrice:    100,   // $100 asset — precision 4
  stopLossPrice:  95,   // $5 risk per unit
  accountEquity: 10_000,
  method:        "fixed_fractional" as const,
};

describe("computePositionSize — shape", () => {
  it("returns a result with all required fields", () => {
    const r = computePositionSize(BASE_REQ);
    expect(r).toHaveProperty("qty");
    expect(r).toHaveProperty("notional");
    expect(r).toHaveProperty("riskPerUnit");
    expect(r).toHaveProperty("riskDollars");
    expect(r).toHaveProperty("effectiveRiskPct");
    expect(r).toHaveProperty("kellyFraction");
    expect(r).toHaveProperty("method");
    expect(r).toHaveProperty("wasCapped");
    expect(r).toHaveProperty("capReason");
  });

  it("method field matches the requested method", () => {
    const r = computePositionSize(BASE_REQ);
    expect(r.method).toBe("fixed_fractional");
  });

  it("qty is a non-negative number", () => {
    const r = computePositionSize(BASE_REQ);
    expect(r.qty).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.qty)).toBe(true);
  });

  it("riskPerUnit equals |entry − stop|", () => {
    const r = computePositionSize(BASE_REQ);
    expect(r.riskPerUnit).toBeCloseTo(5, 5);
  });

  it("notional equals qty × entryPrice", () => {
    const r = computePositionSize(BASE_REQ);
    expect(r.notional).toBeCloseTo(r.qty * BASE_REQ.entryPrice, 4);
  });

  it("effectiveRiskPct is between 0 and 1", () => {
    const r = computePositionSize(BASE_REQ);
    expect(r.effectiveRiskPct).toBeGreaterThanOrEqual(0);
    expect(r.effectiveRiskPct).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computePositionSize — invalid inputs → zero result
// ─────────────────────────────────────────────────────────────────────────────

describe("computePositionSize — invalid inputs", () => {
  it("returns qty=0 when entry equals stop (riskPerUnit=0)", () => {
    const r = computePositionSize({ ...BASE_REQ, stopLossPrice: BASE_REQ.entryPrice });
    expect(r.qty).toBe(0);
    expect(r.wasCapped).toBe(true);
  });

  it("returns qty=0 when accountEquity=0", () => {
    const r = computePositionSize({ ...BASE_REQ, accountEquity: 0 });
    expect(r.qty).toBe(0);
    expect(r.wasCapped).toBe(true);
  });

  it("zero result has capReason set", () => {
    const r = computePositionSize({ ...BASE_REQ, accountEquity: 0 });
    expect(typeof r.capReason).toBe("string");
    expect(r.capReason.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computePositionSize — exposure cap
// ─────────────────────────────────────────────────────────────────────────────

describe("computePositionSize — exposure cap", () => {
  it("caps notional at maxOpenExposurePct × equity", () => {
    // Large equity + tiny stop → huge raw qty → should hit exposure cap
    const r = computePositionSize({
      entryPrice:    1000,
      stopLossPrice:  999,   // $1 risk per unit → raw qty = 100 units = $100k notional
      accountEquity: 10_000,
      method:        "fixed_fractional",
    });
    const maxNotional = 10_000 * 0.20; // $2000
    expect(r.notional).toBeLessThanOrEqual(maxNotional + 0.01);
  });

  it("wasCapped=true when exposure cap is hit", () => {
    const r = computePositionSize({
      entryPrice:    1000,
      stopLossPrice:  999,
      accountEquity: 10_000,
    });
    expect(r.wasCapped).toBe(true);
  });

  it("riskPctOverride is respected", () => {
    const low  = computePositionSize({ ...BASE_REQ, riskPctOverride: 0.001 });
    const high = computePositionSize({ ...BASE_REQ, riskPctOverride: 0.02  });
    // Both should produce a result; high override → more risk dollars
    expect(high.riskDollars).toBeGreaterThan(low.riskDollars);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// computePositionSize — half_kelly method
// ─────────────────────────────────────────────────────────────────────────────

describe("computePositionSize — half_kelly method", () => {
  it("method field is half_kelly", () => {
    const r = computePositionSize({ ...BASE_REQ, method: "half_kelly" });
    expect(r.method).toBe("half_kelly");
  });

  it("returns a valid result with qty ≥ 0", () => {
    const r = computePositionSize({ ...BASE_REQ, method: "half_kelly" });
    expect(r.qty).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.qty)).toBe(true);
  });
});
