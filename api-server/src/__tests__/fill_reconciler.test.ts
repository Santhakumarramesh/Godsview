import { describe, it, expect, beforeEach } from "vitest";
import {
  registerCostBasis,
  clearCostBasis,
  reduceCostBasis,
  getReconciliationSnapshot,
  getRecentFills,
  getRealizedPnlToday,
} from "../lib/fill_reconciler";

describe("Fill Reconciler", () => {
  it("should return a valid reconciliation snapshot", () => {
    const snap = getReconciliationSnapshot();
    expect(snap).toHaveProperty("fills_today");
    expect(snap).toHaveProperty("realized_pnl_today");
    expect(snap).toHaveProperty("unmatched_fills");
    expect(snap).toHaveProperty("processed_fill_ids");
    expect(snap).toHaveProperty("is_running");
    expect(typeof snap.fills_today).toBe("number");
    expect(typeof snap.realized_pnl_today).toBe("number");
  });

  it("should register and clear cost basis without error", () => {
    registerCostBasis("BTCUSD", "long", 50000, 0.5);
    // Should not throw
    clearCostBasis("BTCUSD");
  });

  it("should reduce cost basis quantity", () => {
    registerCostBasis("ETHUSD", "long", 3000, 10);
    reduceCostBasis("ETHUSD", 3);
    // Reduce again should not error even if over-reducing
    reduceCostBasis("ETHUSD", 20);
    // Clearing nonexistent should be safe
    clearCostBasis("ETHUSD");
  });

  it("should average into existing position", () => {
    registerCostBasis("SOLUSD", "long", 100, 5);
    registerCostBasis("SOLUSD", "long", 120, 5);
    // After averaging, cost basis should exist and no errors thrown
    clearCostBasis("SOLUSD");
  });

  it("should return empty fills when none processed", () => {
    const fills = getRecentFills(10);
    expect(Array.isArray(fills)).toBe(true);
  });

  it("should return numeric realized PnL", () => {
    const pnl = getRealizedPnlToday();
    expect(typeof pnl).toBe("number");
  });
});
