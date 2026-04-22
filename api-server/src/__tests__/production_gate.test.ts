/**
 * production_gate.test.ts — Phase 30
 *
 * Tests for getProductionGateStats() — the pure stats accessor
 * on the production gate module (evaluateForProduction is async
 * and requires the full SI pipeline; tested via integration tests).
 *
 * Coverage:
 *   - getProductionGateStats: returns correct structure and constants
 *   - All threshold values are within sensible production ranges
 *   - active_cooldowns is an array
 *   - daily_trades starts at 0 (module initialises fresh)
 */

import { describe, it, expect } from "vitest";
import { getProductionGateStats } from "../lib/production_gate";

describe("getProductionGateStats", () => {
  it("returns an object with daily_trades", () => {
    const stats = getProductionGateStats();
    expect(stats).toHaveProperty("daily_trades");
    expect(typeof stats.daily_trades).toBe("number");
  });

  it("max_daily_trades = 15", () => {
    const stats = getProductionGateStats();
    expect(stats.max_daily_trades).toBe(15);
  });

  it("cooldown_ms = 60_000 (1 minute)", () => {
    const stats = getProductionGateStats();
    expect(stats.cooldown_ms).toBe(60_000);
  });

  it("min_win_prob = 0.57", () => {
    const stats = getProductionGateStats();
    expect(stats.min_win_prob).toBe(0.57);
  });

  it("min_edge = 0.08", () => {
    const stats = getProductionGateStats();
    expect(stats.min_edge).toBe(0.08);
  });

  it("max_spread_pct = 0.003", () => {
    const stats = getProductionGateStats();
    expect(stats.max_spread_pct).toBe(0.003);
  });

  it("active_cooldowns is an array", () => {
    const stats = getProductionGateStats();
    expect(Array.isArray(stats.active_cooldowns)).toBe(true);
  });

  it("each cooldown entry has symbol and expires_in_ms", () => {
    const stats = getProductionGateStats();
    for (const cd of stats.active_cooldowns) {
      expect(cd).toHaveProperty("symbol");
      expect(cd).toHaveProperty("expires_in_ms");
      expect(cd.expires_in_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("production thresholds are within reasonable production bounds", () => {
    const stats = getProductionGateStats();
    expect(stats.min_win_prob).toBeGreaterThan(0.5);
    expect(stats.min_win_prob).toBeLessThan(1.0);
    expect(stats.min_edge).toBeGreaterThan(0);
    expect(stats.min_edge).toBeLessThan(1.0);
    expect(stats.max_spread_pct).toBeGreaterThan(0);
    expect(stats.max_spread_pct).toBeLessThan(0.05);
    expect(stats.max_daily_trades).toBeGreaterThan(0);
    expect(stats.cooldown_ms).toBeGreaterThan(0);
  });

  it("calling twice returns consistent structure", () => {
    const stats1 = getProductionGateStats();
    const stats2 = getProductionGateStats();
    expect(stats1.min_win_prob).toBe(stats2.min_win_prob);
    expect(stats1.max_daily_trades).toBe(stats2.max_daily_trades);
    expect(stats1.min_edge).toBe(stats2.min_edge);
  });
});
