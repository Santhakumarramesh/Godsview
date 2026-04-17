/**
 * auto_trade_config.test.ts — Phase 21: Autonomous Scanner Execution Config
 *
 * Tests:
 *   - Default state (disabled, not armed)
 *   - Enable / disable toggle
 *   - Config update (quality floor, session cap, cooldown)
 *   - Gate checks: disabled, quality floor, session cap, global cooldown, symbol cooldown
 *   - recordAutoTradeAttempt: accepted increments counters, rejected does not
 *   - resetAutoTradeSession resets counters
 *   - getAutoTradeLog returns most-recent-first
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getAutoTradeConfig,
  updateAutoTradeConfig,
  getAutoTradeStatus,
  checkAutoTradeGate,
  recordAutoTradeAttempt,
  getAutoTradeLog,
  resetAutoTradeSession,
} from "../lib/auto_trade_config";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function goodSignal(overrides: { symbol?: string; quality?: number; setupType?: string } = {}) {
  return {
    symbol:    overrides.symbol    ?? "BTCUSD",
    quality:   overrides.quality   ?? 0.80,
    setupType: overrides.setupType ?? "breakout_retest",
  };
}

function accepted(symbol = "BTCUSD"): Parameters<typeof recordAutoTradeAttempt>[0] {
  return {
    symbol, setupType: "breakout_retest", direction: "long",
    quality: 0.80, entryPrice: 50000, orderId: `ord_${Date.now()}`,
    accepted: true, rejectReason: null, executedAt: new Date().toISOString(),
  };
}

function rejected(symbol = "BTCUSD", reason = "zero_equity"): Parameters<typeof recordAutoTradeAttempt>[0] {
  return {
    symbol, setupType: "breakout_retest", direction: "long",
    quality: 0.80, entryPrice: 50000, orderId: null,
    accepted: false, rejectReason: reason, executedAt: new Date().toISOString(),
  };
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("auto_trade_config", () => {
  beforeEach(() => {
    // Reset to known state before each test
    resetAutoTradeSession();
    updateAutoTradeConfig({
      enabled:                  false,
      qualityFloor:             0.70,
      maxExecutionsPerSession:  5,
      cooldownPerSymbolSec:     300,
      globalCooldownSec:        60,
      sizingMethod:             "fixed_fractional",
      allowedSetups:            [],
    });
  });

  // ── Initial state ────────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("is disabled by default", () => {
      expect(getAutoTradeConfig().enabled).toBe(false);
    });

    it("has a sensible quality floor", () => {
      expect(getAutoTradeConfig().qualityFloor).toBeGreaterThan(0);
      expect(getAutoTradeConfig().qualityFloor).toBeLessThanOrEqual(1);
    });

    it("status shows 0 executions this session", () => {
      expect(getAutoTradeStatus().executionsThisSession).toBe(0);
    });

    it("status shows no last execution", () => {
      expect(getAutoTradeStatus().lastExecutedAt).toBeNull();
      expect(getAutoTradeStatus().lastSymbol).toBeNull();
    });
  });

  // ── Config updates ────────────────────────────────────────────────────────────

  describe("updateAutoTradeConfig", () => {
    it("enables auto-trade", () => {
      updateAutoTradeConfig({ enabled: true });
      expect(getAutoTradeConfig().enabled).toBe(true);
    });

    it("disables auto-trade", () => {
      updateAutoTradeConfig({ enabled: true });
      updateAutoTradeConfig({ enabled: false });
      expect(getAutoTradeConfig().enabled).toBe(false);
    });

    it("clamps qualityFloor to [0, 1]", () => {
      updateAutoTradeConfig({ qualityFloor: 1.5 });
      expect(getAutoTradeConfig().qualityFloor).toBe(1);

      updateAutoTradeConfig({ qualityFloor: -0.5 });
      expect(getAutoTradeConfig().qualityFloor).toBe(0);
    });

    it("sets sizingMethod to half_kelly", () => {
      updateAutoTradeConfig({ sizingMethod: "half_kelly" });
      expect(getAutoTradeConfig().sizingMethod).toBe("half_kelly");
    });

    it("stores allowedSetups array", () => {
      updateAutoTradeConfig({ allowedSetups: ["breakout_retest", "pullback_entry"] });
      expect(getAutoTradeConfig().allowedSetups).toContain("breakout_retest");
    });

    it("partial update leaves other fields unchanged", () => {
      const before = getAutoTradeConfig().maxExecutionsPerSession;
      updateAutoTradeConfig({ enabled: true });
      expect(getAutoTradeConfig().maxExecutionsPerSession).toBe(before);
    });
  });

  // ── Gate checks ───────────────────────────────────────────────────────────────

  describe("checkAutoTradeGate — auto_trade_disabled", () => {
    it("rejects when disabled", () => {
      updateAutoTradeConfig({ enabled: false });
      expect(checkAutoTradeGate(goodSignal())).toBe("auto_trade_disabled");
    });
  });

  describe("checkAutoTradeGate — enabled path", () => {
    beforeEach(() => {
      updateAutoTradeConfig({ enabled: true, globalCooldownSec: 0 });
    });

    it("passes a good signal", () => {
      expect(checkAutoTradeGate(goodSignal())).toBeNull();
    });

    it("rejects signal below quality floor", () => {
      updateAutoTradeConfig({ qualityFloor: 0.80 });
      const result = checkAutoTradeGate(goodSignal({ quality: 0.65 }));
      expect(result).not.toBeNull();
      expect(result).toContain("quality_below_floor");
    });

    it("passes signal exactly at quality floor", () => {
      updateAutoTradeConfig({ qualityFloor: 0.75 });
      expect(checkAutoTradeGate(goodSignal({ quality: 0.75 }))).toBeNull();
    });

    it("rejects when session cap is reached", () => {
      updateAutoTradeConfig({ maxExecutionsPerSession: 2, globalCooldownSec: 0 });
      recordAutoTradeAttempt(accepted("BTCUSD"));
      recordAutoTradeAttempt(accepted("ETHUSD"));
      const result = checkAutoTradeGate(goodSignal());
      expect(result).not.toBeNull();
      expect(result).toContain("session_cap_reached");
    });

    it("rejects setup not in allowlist", () => {
      updateAutoTradeConfig({ allowedSetups: ["pullback_entry"] });
      const result = checkAutoTradeGate(goodSignal({ setupType: "breakout_retest" }));
      expect(result).not.toBeNull();
      expect(result).toContain("setup_not_in_allowlist");
    });

    it("passes any setup when allowlist is empty", () => {
      updateAutoTradeConfig({ allowedSetups: [] });
      expect(checkAutoTradeGate(goodSignal({ setupType: "exotic_setup" }))).toBeNull();
    });

    it("respects per-symbol cooldown after accepted trade", () => {
      updateAutoTradeConfig({ cooldownPerSymbolSec: 3600, globalCooldownSec: 0 });
      recordAutoTradeAttempt(accepted("BTCUSD"));
      const result = checkAutoTradeGate(goodSignal({ symbol: "BTCUSD" }));
      expect(result).not.toBeNull();
      expect(result).toContain("symbol_cooldown_active");
    });

    it("allows different symbol during per-symbol cooldown", () => {
      updateAutoTradeConfig({ cooldownPerSymbolSec: 3600, globalCooldownSec: 0 });
      recordAutoTradeAttempt(accepted("BTCUSD"));
      // ETHUSD should not be in cooldown
      expect(checkAutoTradeGate(goodSignal({ symbol: "ETHUSD" }))).toBeNull();
    });

    it("respects global cooldown after accepted trade", () => {
      updateAutoTradeConfig({ globalCooldownSec: 3600 });
      recordAutoTradeAttempt(accepted("BTCUSD"));
      const result = checkAutoTradeGate(goodSignal({ symbol: "ETHUSD" }));
      expect(result).not.toBeNull();
      expect(result).toContain("global_cooldown_active");
    });
  });

  // ── recordAutoTradeAttempt ────────────────────────────────────────────────────

  describe("recordAutoTradeAttempt", () => {
    beforeEach(() => {
      updateAutoTradeConfig({ enabled: true, globalCooldownSec: 0 });
    });

    it("increments executionsThisSession on accepted", () => {
      const before = getAutoTradeStatus().executionsThisSession;
      recordAutoTradeAttempt(accepted());
      expect(getAutoTradeStatus().executionsThisSession).toBe(before + 1);
    });

    it("does NOT increment executionsThisSession on rejected", () => {
      const before = getAutoTradeStatus().executionsThisSession;
      recordAutoTradeAttempt(rejected());
      expect(getAutoTradeStatus().executionsThisSession).toBe(before);
    });

    it("updates lastExecutedAt and lastSymbol on accepted", () => {
      recordAutoTradeAttempt(accepted("XYZUSD"));
      expect(getAutoTradeStatus().lastSymbol).toBe("XYZUSD");
      expect(getAutoTradeStatus().lastExecutedAt).not.toBeNull();
    });

    it("does NOT update lastSymbol on rejected", () => {
      const before = getAutoTradeStatus().lastSymbol;
      recordAutoTradeAttempt(rejected("FAKEUSD"));
      expect(getAutoTradeStatus().lastSymbol).toBe(before);
    });

    it("appends to execution log", () => {
      const before = getAutoTradeLog().length;
      recordAutoTradeAttempt(accepted());
      expect(getAutoTradeLog().length).toBe(before + 1);
    });

    it("log entry has correct shape", () => {
      recordAutoTradeAttempt(accepted("BTCUSD"));
      const entry = getAutoTradeLog()[0];
      expect(entry).toHaveProperty("id");
      expect(entry).toHaveProperty("symbol", "BTCUSD");
      expect(entry).toHaveProperty("accepted", true);
    });
  });

  // ── resetAutoTradeSession ─────────────────────────────────────────────────────

  describe("resetAutoTradeSession", () => {
    it("resets executionsThisSession to 0", () => {
      recordAutoTradeAttempt(accepted());
      recordAutoTradeAttempt(accepted("ETHUSD"));
      resetAutoTradeSession();
      expect(getAutoTradeStatus().executionsThisSession).toBe(0);
    });

    it("resets lastExecutedAt to null", () => {
      recordAutoTradeAttempt(accepted());
      resetAutoTradeSession();
      expect(getAutoTradeStatus().lastExecutedAt).toBeNull();
    });

    it("clears symbol cooldowns", () => {
      updateAutoTradeConfig({ cooldownPerSymbolSec: 3600, globalCooldownSec: 0, enabled: true });
      recordAutoTradeAttempt(accepted("BTCUSD"));
      resetAutoTradeSession();
      // After reset, symbol should no longer be in cooldown
      expect(checkAutoTradeGate(goodSignal({ symbol: "BTCUSD" }))).toBeNull();
    });
  });

  // ── getAutoTradeStatus shape ──────────────────────────────────────────────────

  describe("getAutoTradeStatus", () => {
    it("returns all required fields", () => {
      const status = getAutoTradeStatus();
      expect(status).toHaveProperty("config");
      expect(status).toHaveProperty("executionsThisSession");
      expect(status).toHaveProperty("lastExecutedAt");
      expect(status).toHaveProperty("lastSymbol");
      expect(status).toHaveProperty("symbolCooldowns");
      expect(status).toHaveProperty("globalCooldownActive");
      expect(status).toHaveProperty("globalCooldownRemainingMs");
    });

    it("globalCooldownActive is false when no trades have been made", () => {
      expect(getAutoTradeStatus().globalCooldownActive).toBe(false);
    });

    it("globalCooldownRemainingMs is 0 when inactive", () => {
      expect(getAutoTradeStatus().globalCooldownRemainingMs).toBe(0);
    });
  });
});
