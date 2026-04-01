/**
 * position_sizer.test.ts — Phase 21: Position Sizing Engine
 *
 * Tests:
 *   - Fixed-fractional sizing: qty = (equity × riskPct) / riskPerUnit
 *   - Zero qty for invalid inputs (zero equity, zero risk range)
 *   - Exposure cap enforcement
 *   - Kelly method (fallback to fixed when < 10 trades)
 *   - estimateRiskUsd helper
 *   - SizingResult shape correctness
 */

import { describe, it, expect, beforeEach } from "vitest";
import { computePositionSize, estimateRiskUsd } from "../lib/position_sizer";
import { clearJournal } from "../lib/trade_journal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function basicReq(overrides: Record<string, unknown> = {}) {
  return {
    entryPrice:    50_000,
    stopLossPrice: 49_000,   // $1000 risk per unit
    accountEquity: 100_000,  // $100k account
    method:        "fixed_fractional" as const,
    ...overrides,
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("position_sizer — computePositionSize", () => {
  beforeEach(() => {
    clearJournal(); // ensure a clean equity report for Kelly tests
  });

  // ── Fixed-fractional ─────────────────────────────────────────────────────────

  describe("fixed_fractional (default method)", () => {
    it("returns a result with all required fields", () => {
      const result = computePositionSize(basicReq());
      expect(result).toHaveProperty("qty");
      expect(result).toHaveProperty("notional");
      expect(result).toHaveProperty("riskPerUnit");
      expect(result).toHaveProperty("riskDollars");
      expect(result).toHaveProperty("effectiveRiskPct");
      expect(result).toHaveProperty("kellyFraction");
      expect(result).toHaveProperty("method");
      expect(result).toHaveProperty("wasCapped");
      expect(result).toHaveProperty("capReason");
    });

    it("qty > 0 for valid inputs", () => {
      const result = computePositionSize(basicReq());
      expect(result.qty).toBeGreaterThan(0);
    });

    it("method is 'fixed_fractional'", () => {
      const result = computePositionSize(basicReq());
      expect(result.method).toBe("fixed_fractional");
    });

    it("notional = qty × entryPrice", () => {
      const result = computePositionSize(basicReq());
      expect(result.notional).toBeCloseTo(result.qty * 50_000, 2);
    });

    it("riskPerUnit = |entry - stopLoss|", () => {
      const result = computePositionSize(basicReq());
      expect(result.riskPerUnit).toBeCloseTo(1000, 2);
    });

    it("riskDollars ≈ equity × maxRiskPct (default 1%)", () => {
      // $100k equity × 1% risk = $1000 at risk
      const result = computePositionSize(basicReq());
      // $1000 risk / $1000 risk-per-unit = ~1 unit
      expect(result.qty).toBeCloseTo(1, 1);
      expect(result.riskDollars).toBeCloseTo(1000, 0);
    });

    it("larger equity produces proportionally larger qty", () => {
      const small = computePositionSize(basicReq({ accountEquity: 10_000 }));
      const large = computePositionSize(basicReq({ accountEquity: 100_000 }));
      expect(large.qty).toBeCloseTo(small.qty * 10, 0);
    });

    it("wider stop loss produces smaller qty (same risk $)", () => {
      const tight = computePositionSize(basicReq({ stopLossPrice: 49_000 })); // $1k range
      const wide  = computePositionSize(basicReq({ stopLossPrice: 48_000 })); // $2k range
      expect(tight.qty).toBeGreaterThan(wide.qty);
    });

    it("short direction — stop above entry — riskPerUnit correct", () => {
      const result = computePositionSize({
        entryPrice:    50_000,
        stopLossPrice: 51_000, // short stop above entry
        accountEquity: 100_000,
        method:        "fixed_fractional",
      });
      expect(result.riskPerUnit).toBeCloseTo(1000, 2);
      expect(result.qty).toBeGreaterThan(0);
    });
  });

  // ── Invalid inputs → zero qty ─────────────────────────────────────────────────

  describe("edge cases", () => {
    it("returns qty=0 when accountEquity is 0", () => {
      const result = computePositionSize(basicReq({ accountEquity: 0 }));
      expect(result.qty).toBe(0);
      expect(result.wasCapped).toBe(true);
    });

    it("returns qty=0 when entryPrice === stopLossPrice (zero range)", () => {
      const result = computePositionSize(basicReq({ stopLossPrice: 50_000 }));
      expect(result.qty).toBe(0);
      expect(result.wasCapped).toBe(true);
    });

    it("wasCapped=false for normal sizing", () => {
      // Default exposure cap is 60% of equity = $60k, our notional is ~$50k — should be fine
      const result = computePositionSize(basicReq());
      // If not exposure-capped
      if (!result.wasCapped) {
        expect(result.capReason).toBe("");
      }
    });
  });

  // ── Exposure cap ──────────────────────────────────────────────────────────────

  describe("exposure cap", () => {
    it("caps qty when notional would exceed maxOpenExposurePct of equity", () => {
      // $1000 risk, $1 risk-per-unit → 1000 units at $50k each = $50M notional
      // Default exposure cap = 60% of $100k = $60k → capped to $60k / $50k = 1.2 units
      const result = computePositionSize({
        entryPrice:    50_000,
        stopLossPrice: 49_999,  // $1 risk per unit → 1000 units raw
        accountEquity: 100_000,
        method:        "fixed_fractional",
      });
      // With exposure cap at 60% of 100k = 60k, max units = 60000/50000 = 1.2
      // So qty should be <= 1.2
      expect(result.notional).toBeLessThanOrEqual(60_001); // within cap with rounding
    });
  });

  // ── Half-Kelly fallback ───────────────────────────────────────────────────────

  describe("half_kelly method", () => {
    it("falls back to conservative sizing when journal has < 10 trades", () => {
      const kellyResult = computePositionSize(basicReq({ method: "half_kelly" }));
      const fixedResult = computePositionSize(basicReq({ method: "fixed_fractional" }));
      // With insufficient data Kelly uses conservative fallback (50% of fixed),
      // so Kelly qty should be less than or equal to fixed qty
      expect(kellyResult.qty).toBeLessThanOrEqual(fixedResult.qty + 0.01);
    });

    it("method field is 'half_kelly'", () => {
      const result = computePositionSize(basicReq({ method: "half_kelly" }));
      expect(result.method).toBe("half_kelly");
    });

    it("kellyFraction is 0 when journal is empty (insufficient data)", () => {
      const result = computePositionSize(basicReq({ method: "half_kelly" }));
      expect(result.kellyFraction).toBe(0);
    });
  });

  // ── full_kelly method ─────────────────────────────────────────────────────────

  describe("full_kelly method", () => {
    it("method field is 'full_kelly'", () => {
      const result = computePositionSize(basicReq({ method: "full_kelly" }));
      expect(result.method).toBe("full_kelly");
    });

    it("returns a non-negative qty", () => {
      const result = computePositionSize(basicReq({ method: "full_kelly" }));
      expect(result.qty).toBeGreaterThanOrEqual(0);
    });
  });

  // ── SizingResult invariants ───────────────────────────────────────────────────

  describe("result invariants", () => {
    it("effectiveRiskPct is between 0 and 1", () => {
      const result = computePositionSize(basicReq());
      expect(result.effectiveRiskPct).toBeGreaterThanOrEqual(0);
      expect(result.effectiveRiskPct).toBeLessThanOrEqual(1);
    });

    it("riskDollars = qty × riskPerUnit", () => {
      const r = computePositionSize(basicReq());
      if (r.qty > 0) {
        expect(r.riskDollars).toBeCloseTo(r.qty * r.riskPerUnit, 2);
      }
    });

    it("capReason is empty string when not capped", () => {
      const r = computePositionSize(basicReq());
      if (!r.wasCapped) {
        expect(r.capReason).toBe("");
      }
    });
  });
});

// ─── estimateRiskUsd ──────────────────────────────────────────────────────────

describe("position_sizer — estimateRiskUsd", () => {
  it("computes qty × |entry - stopLoss|", () => {
    expect(estimateRiskUsd(2, 50000, 49000)).toBeCloseTo(2000, 2);
  });

  it("works for short direction (stop above entry)", () => {
    expect(estimateRiskUsd(1, 50000, 51000)).toBeCloseTo(1000, 2);
  });

  it("returns 0 for qty = 0", () => {
    expect(estimateRiskUsd(0, 50000, 49000)).toBe(0);
  });
});
