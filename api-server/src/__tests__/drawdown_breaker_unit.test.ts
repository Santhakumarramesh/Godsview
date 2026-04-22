/**
 * drawdown_breaker_unit.test.ts — Phase 61
 *
 * Unit tests for lib/drawdown_breaker.ts:
 *
 *   getBreakerSnapshot       — shape and invariants
 *   getPositionSizeMultiplier — returns the current multiplier
 *   isCooldownActive         — default false
 *   setPeakEquity            — monotonic setter
 *   resetBreaker             — resets level/multiplier/cooldown
 *   recordRealizedPnl        — increments trade counters (delta assertions)
 *   updateUnrealizedPnl      — reflected in snapshot
 *
 * Dependencies mocked:
 *   ../lib/risk_engine          — setKillSwitchActive, getRiskEngineSnapshot
 *   ../lib/alerts               — alertDailyLossBreach, alertConsecutiveLosses, fireAlert
 *   ../lib/logger               — logger (child-less, flat mock)
 *   ../lib/emergency_liquidator — emergencyLiquidateAll (dynamic import via engageHalt)
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/risk_engine", () => ({
  setKillSwitchActive:    vi.fn(),
  getRiskEngineSnapshot:  vi.fn(() => ({ config: { maxRiskPerTradePct: 0.01 } })),
}));

vi.mock("../lib/alerts", () => ({
  alertDailyLossBreach:      vi.fn(),
  alertConsecutiveLosses:    vi.fn(),
  fireAlert:                 vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("../lib/emergency_liquidator", () => ({
  emergencyLiquidateAll: vi.fn(async () => undefined),
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import {
  getBreakerSnapshot,
  getPositionSizeMultiplier,
  isCooldownActive,
  setPeakEquity,
  resetBreaker,
  recordRealizedPnl,
  updateUnrealizedPnl,
} from "../lib/drawdown_breaker";

// ─────────────────────────────────────────────────────────────────────────────
// getBreakerSnapshot — structural shape
// ─────────────────────────────────────────────────────────────────────────────

describe("getBreakerSnapshot", () => {
  it("returns an object with all required fields", () => {
    const snap = getBreakerSnapshot();
    const fields = [
      "level", "realized_pnl_today", "unrealized_pnl", "total_pnl",
      "daily_loss_limit", "warning_threshold", "throttle_threshold",
      "consecutive_losses", "max_consecutive_before_cooldown",
      "cooldown_active", "cooldown_until",
      "peak_equity", "drawdown_from_peak", "max_drawdown_pct",
      "hourly_pnl_velocity", "position_size_multiplier",
      "trades_today", "wins_today", "losses_today", "last_updated",
    ];
    for (const f of fields) {
      expect(snap).toHaveProperty(f);
    }
  });

  it("level is a valid BreakerLevel string", () => {
    const snap = getBreakerSnapshot();
    expect(["NORMAL", "WARNING", "THROTTLE", "HALT"]).toContain(snap.level);
  });

  it("wins_today + losses_today ≤ trades_today", () => {
    const snap = getBreakerSnapshot();
    expect(snap.wins_today + snap.losses_today).toBeLessThanOrEqual(snap.trades_today);
  });

  it("last_updated is an ISO string", () => {
    const snap = getBreakerSnapshot();
    expect(() => new Date(snap.last_updated)).not.toThrow();
    expect(new Date(snap.last_updated).toISOString()).toBe(snap.last_updated);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPositionSizeMultiplier
// ─────────────────────────────────────────────────────────────────────────────

describe("getPositionSizeMultiplier", () => {
  it("returns a number", () => {
    expect(typeof getPositionSizeMultiplier()).toBe("number");
  });

  it("is between 0 and 1 (inclusive)", () => {
    const m = getPositionSizeMultiplier();
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isCooldownActive
// ─────────────────────────────────────────────────────────────────────────────

describe("isCooldownActive", () => {
  it("returns a boolean", () => {
    expect(typeof isCooldownActive()).toBe("boolean");
  });

  it("is false initially (no losses recorded yet)", () => {
    // Fresh module — cooldown should not be active at start
    resetBreaker();
    expect(isCooldownActive()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setPeakEquity
// ─────────────────────────────────────────────────────────────────────────────

describe("setPeakEquity", () => {
  it("updates peak_equity in snapshot", () => {
    setPeakEquity(50_000);
    expect(getBreakerSnapshot().peak_equity).toBeGreaterThanOrEqual(50_000);
  });

  it("is monotonically increasing (lower value does not replace higher)", () => {
    setPeakEquity(100_000);
    const before = getBreakerSnapshot().peak_equity;
    setPeakEquity(before - 10_000);
    expect(getBreakerSnapshot().peak_equity).toBe(before);
  });

  it("accepts fractional equity values", () => {
    setPeakEquity(12_345.67);
    expect(getBreakerSnapshot().peak_equity).toBeGreaterThanOrEqual(12_345.67);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resetBreaker
// ─────────────────────────────────────────────────────────────────────────────

describe("resetBreaker", () => {
  it("returns a snapshot", () => {
    const snap = resetBreaker();
    expect(snap).toHaveProperty("level");
    expect(snap).toHaveProperty("position_size_multiplier");
  });

  it("sets level to NORMAL", () => {
    const snap = resetBreaker();
    expect(snap.level).toBe("NORMAL");
  });

  it("sets position_size_multiplier to 1.0", () => {
    const snap = resetBreaker();
    expect(snap.position_size_multiplier).toBe(1.0);
  });

  it("clears cooldown (isCooldownActive → false)", () => {
    resetBreaker();
    expect(isCooldownActive()).toBe(false);
  });

  it("consecutive_losses is 0 after reset", () => {
    const snap = resetBreaker();
    expect(snap.consecutive_losses).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordRealizedPnl — delta-based (order-independent)
// ─────────────────────────────────────────────────────────────────────────────

describe("recordRealizedPnl", () => {
  it("increments trades_today by 1", () => {
    const before = getBreakerSnapshot().trades_today;
    recordRealizedPnl(20, "BTCUSD");
    expect(getBreakerSnapshot().trades_today).toBe(before + 1);
  });

  it("win increments wins_today by 1", () => {
    const before = getBreakerSnapshot().wins_today;
    recordRealizedPnl(50, "ETHUSD");
    expect(getBreakerSnapshot().wins_today).toBe(before + 1);
  });

  it("loss increments losses_today by 1", () => {
    const before = getBreakerSnapshot().losses_today;
    recordRealizedPnl(-20, "BTCUSD");
    expect(getBreakerSnapshot().losses_today).toBe(before + 1);
  });

  it("adds to realized_pnl_today", () => {
    const before = getBreakerSnapshot().realized_pnl_today;
    recordRealizedPnl(100, "SOLUSD");
    expect(getBreakerSnapshot().realized_pnl_today).toBeCloseTo(before + 100, 4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateUnrealizedPnl
// ─────────────────────────────────────────────────────────────────────────────

describe("updateUnrealizedPnl", () => {
  it("is reflected in snapshot unrealized_pnl", () => {
    updateUnrealizedPnl(250);
    expect(getBreakerSnapshot().unrealized_pnl).toBeCloseTo(250, 4);
  });

  it("total_pnl = realized + unrealized", () => {
    updateUnrealizedPnl(0); // clear unrealized first
    const snap0 = getBreakerSnapshot();
    updateUnrealizedPnl(777);
    const snap1 = getBreakerSnapshot();
    expect(snap1.total_pnl).toBeCloseTo(snap1.realized_pnl_today + 777, 4);
  });
});
