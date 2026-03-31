import { describe, it, expect } from "vitest";
import {
  recordRealizedPnl,
  getBreakerSnapshot,
  getPositionSizeMultiplier,
  isCooldownActive,
  resetBreaker,
  updateUnrealizedPnl,
  setPeakEquity,
} from "../lib/drawdown_breaker";

/**
 * NOTE: The drawdown breaker uses module-level state that persists
 * across tests within a single vitest run. Tests are ordered to
 * account for cumulative PnL (daily PnL only resets on day change).
 * resetBreaker() resets level/multiplier but NOT daily PnL (by design).
 */

describe("Drawdown Circuit Breaker", () => {
  it("should start in a known state after reset", () => {
    resetBreaker();
    const snap = getBreakerSnapshot();
    expect(snap.level).toBe("NORMAL");
    expect(snap.position_size_multiplier).toBe(1.0);
    expect(typeof snap.realized_pnl_today).toBe("number");
  });

  it("should have full structure in snapshot", () => {
    const snap = getBreakerSnapshot();
    expect(snap).toHaveProperty("level");
    expect(snap).toHaveProperty("realized_pnl_today");
    expect(snap).toHaveProperty("unrealized_pnl");
    expect(snap).toHaveProperty("total_pnl");
    expect(snap).toHaveProperty("daily_loss_limit");
    expect(snap).toHaveProperty("consecutive_losses");
    expect(snap).toHaveProperty("cooldown_active");
    expect(snap).toHaveProperty("peak_equity");
    expect(snap).toHaveProperty("hourly_pnl_velocity");
    expect(snap).toHaveProperty("position_size_multiplier");
    expect(snap).toHaveProperty("trades_today");
    expect(snap).toHaveProperty("wins_today");
    expect(snap).toHaveProperty("losses_today");
  });

  it("should track winning trades and reset consecutive losses", () => {
    resetBreaker();
    const before = getBreakerSnapshot().realized_pnl_today;
    recordRealizedPnl(50, "BTCUSD");
    const snap = getBreakerSnapshot();
    expect(snap.realized_pnl_today).toBe(before + 50);
    expect(snap.consecutive_losses).toBe(0);
  });

  it("should increment consecutive losses on losing trades", () => {
    resetBreaker();
    recordRealizedPnl(-10, "BTCUSD");
    recordRealizedPnl(-10, "ETHUSD");
    const snap = getBreakerSnapshot();
    expect(snap.consecutive_losses).toBe(2);
    expect(snap.losses_today).toBeGreaterThanOrEqual(2);
  });

  it("should return numeric position size multiplier", () => {
    resetBreaker();
    const m = getPositionSizeMultiplier();
    expect(typeof m).toBe("number");
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(1);
  });

  it("should update unrealized PnL in snapshot", () => {
    resetBreaker();
    updateUnrealizedPnl(-50);
    const snap = getBreakerSnapshot();
    expect(snap.unrealized_pnl).toBe(-50);
  });

  it("should set peak equity", () => {
    setPeakEquity(10000);
    const snap = getBreakerSnapshot();
    expect(snap.peak_equity).toBe(10000);
  });

  it("should not be in cooldown after reset", () => {
    resetBreaker();
    expect(isCooldownActive()).toBe(false);
  });

  it("should return to NORMAL level after resetBreaker", () => {
    resetBreaker();
    expect(getBreakerSnapshot().level).toBe("NORMAL");
    expect(getPositionSizeMultiplier()).toBe(1.0);
  });
});
