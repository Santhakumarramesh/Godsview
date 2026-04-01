import { describe, it, expect } from "vitest";
import {
  evaluateChecklist,
  autoEvaluateChecklist,
  clearChecklistCache,
} from "../lib/checklist_engine";

describe("Checklist Engine", () => {
  it("passes when all required items are true", () => {
    const result = evaluateChecklist({
      symbol: "BTCUSD",
      setup_type: "smc",
      session: "london",
      htf_bias_aligned: true,
      liquidity_swept: true,
      structure_shift: true,
      displacement_confirmed: true,
      entry_zone_touched: true,
      rr_minimum_met: true,
      session_valid: true,
      no_news_lockout: true,
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBe(1);
    expect(result.blocked_reasons).toHaveLength(0);
    expect(result.symbol).toBe("BTCUSD");
  });

  it("blocks when required items are false", () => {
    const result = evaluateChecklist({
      symbol: "ETHUSD",
      setup_type: "smc",
      session: "new_york",
      htf_bias_aligned: false,
      liquidity_swept: true,
      structure_shift: false,
      displacement_confirmed: true,
      entry_zone_touched: true,
      rr_minimum_met: true,
      session_valid: true,
      no_news_lockout: true,
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
  });

  it("returns correct score for partial pass", () => {
    const result = evaluateChecklist({
      symbol: "EURUSD",
      setup_type: "smc",
      session: "asia",
      htf_bias_aligned: true,
      liquidity_swept: false,
      structure_shift: true,
      displacement_confirmed: false,
      entry_zone_touched: true,
      rr_minimum_met: true,
      session_valid: false,
      no_news_lockout: true,
    });

    // 5 out of 8 true = 0.63
    expect(result.score).toBeCloseTo(0.63, 1);
  });
});
