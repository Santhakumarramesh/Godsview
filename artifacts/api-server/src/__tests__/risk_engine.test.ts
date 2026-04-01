/**
 * risk_engine.test.ts — Phase 26: Risk Engine
 *
 * Tests:
 *   getCurrentTradingSession:
 *     - UTC hours 13-21 → "NY"
 *     - UTC hours 7-12 → "London"
 *     - UTC hours 22-23, 0-6 → "Asian"
 *     - Exact boundary values: 7 → London, 13 → NY, 22 → Asian
 *
 *   isSessionAllowed:
 *     - Asian: controlled by allowAsianSession flag
 *     - London: controlled by allowLondonSession flag
 *     - NY: controlled by allowNySession flag
 *     - All true (default) → all sessions allowed
 *
 *   setKillSwitchActive / isKillSwitchActive:
 *     - Set true → isKillSwitchActive() returns true
 *     - Set false → isKillSwitchActive() returns false
 *     - Returns snapshot reflecting new state
 *
 *   updateRiskConfig:
 *     - Valid numeric patch applies correctly
 *     - maxRiskPerTradePct clamped to [0, 1]
 *     - maxDailyLossUsd clamped to [0, 5_000_000]
 *     - maxConcurrentPositions clamped to [1, 100] (integer)
 *     - maxTradesPerSession clamped to [1, 1000] (integer)
 *     - cooldownAfterLosses clamped to [1, 50]
 *     - cooldownMinutes clamped to [1, 1440]
 *     - NaN input ignored (existing value preserved)
 *     - Boolean fields coerced correctly
 *     - Returns updated snapshot
 *
 *   getRiskEngineSnapshot:
 *     - Returns object with `runtime` and `config` keys
 *     - Snapshot is a structural copy (mutations don't affect engine state)
 */

import { describe, it, expect, afterEach, beforeEach } from "vitest";
import {
  getCurrentTradingSession,
  isSessionAllowed,
  setKillSwitchActive,
  isKillSwitchActive,
  updateRiskConfig,
  getRiskEngineSnapshot,
  resetRiskEngineRuntime,
} from "../lib/risk_engine";

// ─── State isolation ───────────────────────────────────────────────────────────
// The risk engine uses module-level mutable state.  After each test, restore
// kill switch and any config changes to their defaults.

afterEach(() => {
  setKillSwitchActive(false);
  updateRiskConfig({
    maxRiskPerTradePct: 0.01,
    maxDailyLossUsd: 250,
    maxOpenExposurePct: 0.6,
    maxConcurrentPositions: 3,
    maxTradesPerSession: 10,
    cooldownAfterLosses: 3,
    cooldownMinutes: 30,
    blockOnDegradedData: true,
    allowAsianSession: true,
    allowLondonSession: true,
    allowNySession: true,
    newsLockoutActive: false,
  });
  resetRiskEngineRuntime();
});

// ─── getCurrentTradingSession ──────────────────────────────────────────────────

describe("getCurrentTradingSession", () => {

  function atHour(utcHour: number): Date {
    const d = new Date("2025-01-15T00:00:00Z");
    d.setUTCHours(utcHour, 0, 0, 0);
    return d;
  }

  it("UTC 13 → NY session starts", () => {
    expect(getCurrentTradingSession(atHour(13))).toBe("NY");
  });

  it("UTC 17 → NY session (mid)", () => {
    expect(getCurrentTradingSession(atHour(17))).toBe("NY");
  });

  it("UTC 21 → NY session (last hour)", () => {
    expect(getCurrentTradingSession(atHour(21))).toBe("NY");
  });

  it("UTC 22 → Asian session (NY ended)", () => {
    expect(getCurrentTradingSession(atHour(22))).toBe("Asian");
  });

  it("UTC 7 → London session starts", () => {
    expect(getCurrentTradingSession(atHour(7))).toBe("London");
  });

  it("UTC 10 → London session (mid)", () => {
    expect(getCurrentTradingSession(atHour(10))).toBe("London");
  });

  it("UTC 12 → London session (last hour)", () => {
    expect(getCurrentTradingSession(atHour(12))).toBe("London");
  });

  it("UTC 0 → Asian session (midnight)", () => {
    expect(getCurrentTradingSession(atHour(0))).toBe("Asian");
  });

  it("UTC 3 → Asian session", () => {
    expect(getCurrentTradingSession(atHour(3))).toBe("Asian");
  });

  it("UTC 6 → Asian session (last Asian hour before London)", () => {
    expect(getCurrentTradingSession(atHour(6))).toBe("Asian");
  });

  it("UTC 23 → Asian session (late night)", () => {
    expect(getCurrentTradingSession(atHour(23))).toBe("Asian");
  });
});

// ─── isSessionAllowed ──────────────────────────────────────────────────────────

describe("isSessionAllowed", () => {

  it("Asian: true when allowAsianSession=true", () => {
    expect(isSessionAllowed("Asian", {
      allowAsianSession: true, allowLondonSession: true, allowNySession: true,
    })).toBe(true);
  });

  it("Asian: false when allowAsianSession=false", () => {
    expect(isSessionAllowed("Asian", {
      allowAsianSession: false, allowLondonSession: true, allowNySession: true,
    })).toBe(false);
  });

  it("London: true when allowLondonSession=true", () => {
    expect(isSessionAllowed("London", {
      allowAsianSession: true, allowLondonSession: true, allowNySession: true,
    })).toBe(true);
  });

  it("London: false when allowLondonSession=false", () => {
    expect(isSessionAllowed("London", {
      allowAsianSession: true, allowLondonSession: false, allowNySession: true,
    })).toBe(false);
  });

  it("NY: true when allowNySession=true", () => {
    expect(isSessionAllowed("NY", {
      allowAsianSession: true, allowLondonSession: true, allowNySession: true,
    })).toBe(true);
  });

  it("NY: false when allowNySession=false", () => {
    expect(isSessionAllowed("NY", {
      allowAsianSession: true, allowLondonSession: true, allowNySession: false,
    })).toBe(false);
  });

  it("uses live engine config when no source provided (defaults: all sessions allowed)", () => {
    // Default config allows all sessions
    expect(isSessionAllowed("Asian")).toBe(true);
    expect(isSessionAllowed("London")).toBe(true);
    expect(isSessionAllowed("NY")).toBe(true);
  });
});

// ─── setKillSwitchActive / isKillSwitchActive ──────────────────────────────────

describe("kill switch", () => {

  it("isKillSwitchActive starts false (default config)", () => {
    expect(isKillSwitchActive()).toBe(false);
  });

  it("setKillSwitchActive(true) → isKillSwitchActive() = true", () => {
    setKillSwitchActive(true);
    expect(isKillSwitchActive()).toBe(true);
  });

  it("setKillSwitchActive(false) after true → isKillSwitchActive() = false", () => {
    setKillSwitchActive(true);
    setKillSwitchActive(false);
    expect(isKillSwitchActive()).toBe(false);
  });

  it("setKillSwitchActive returns snapshot with updated kill switch state", () => {
    const snap = setKillSwitchActive(true);
    expect(snap.runtime.killSwitchActive).toBe(true);
    expect(snap.runtime.updatedAt).toBeTruthy();
  });

  it("snapshot.runtime.killSwitchActive reflects current value", () => {
    setKillSwitchActive(true);
    const snap = getRiskEngineSnapshot();
    expect(snap.runtime.killSwitchActive).toBe(true);
  });
});

// ─── updateRiskConfig ──────────────────────────────────────────────────────────

describe("updateRiskConfig", () => {

  it("applies valid numeric patch", () => {
    updateRiskConfig({ maxRiskPerTradePct: 0.02 });
    const snap = getRiskEngineSnapshot();
    expect(snap.config.maxRiskPerTradePct).toBe(0.02);
  });

  it("maxRiskPerTradePct clamped to [0, 1] (over-limit → 1)", () => {
    updateRiskConfig({ maxRiskPerTradePct: 5 });
    expect(getRiskEngineSnapshot().config.maxRiskPerTradePct).toBe(1);
  });

  it("maxRiskPerTradePct clamped to [0, 1] (negative → 0)", () => {
    updateRiskConfig({ maxRiskPerTradePct: -0.5 });
    expect(getRiskEngineSnapshot().config.maxRiskPerTradePct).toBe(0);
  });

  it("maxDailyLossUsd clamped to [0, 5_000_000]", () => {
    updateRiskConfig({ maxDailyLossUsd: 9_999_999 });
    expect(getRiskEngineSnapshot().config.maxDailyLossUsd).toBe(5_000_000);
  });

  it("maxConcurrentPositions clamped to [1, 100] and truncated to integer", () => {
    updateRiskConfig({ maxConcurrentPositions: 200 });
    expect(getRiskEngineSnapshot().config.maxConcurrentPositions).toBe(100);
    updateRiskConfig({ maxConcurrentPositions: 0 });
    expect(getRiskEngineSnapshot().config.maxConcurrentPositions).toBe(1);
  });

  it("maxConcurrentPositions truncates floating-point to integer", () => {
    updateRiskConfig({ maxConcurrentPositions: 5.9 });
    expect(getRiskEngineSnapshot().config.maxConcurrentPositions).toBe(5);
  });

  it("maxTradesPerSession clamped to [1, 1000]", () => {
    updateRiskConfig({ maxTradesPerSession: 5000 });
    expect(getRiskEngineSnapshot().config.maxTradesPerSession).toBe(1000);
  });

  it("cooldownAfterLosses clamped to [1, 50]", () => {
    updateRiskConfig({ cooldownAfterLosses: 100 });
    expect(getRiskEngineSnapshot().config.cooldownAfterLosses).toBe(50);
    updateRiskConfig({ cooldownAfterLosses: 0 });
    expect(getRiskEngineSnapshot().config.cooldownAfterLosses).toBe(1);
  });

  it("cooldownMinutes clamped to [1, 1440]", () => {
    updateRiskConfig({ cooldownMinutes: 2000 });
    expect(getRiskEngineSnapshot().config.cooldownMinutes).toBe(1440);
  });

  it("NaN value is ignored — original value preserved", () => {
    const before = getRiskEngineSnapshot().config.maxDailyLossUsd;
    updateRiskConfig({ maxDailyLossUsd: NaN });
    expect(getRiskEngineSnapshot().config.maxDailyLossUsd).toBe(before);
  });

  it("boolean fields coerced: truthy value → true", () => {
    updateRiskConfig({ newsLockoutActive: true });
    expect(getRiskEngineSnapshot().config.newsLockoutActive).toBe(true);
  });

  it("boolean fields coerced: falsy value → false", () => {
    updateRiskConfig({ allowAsianSession: false });
    expect(getRiskEngineSnapshot().config.allowAsianSession).toBe(false);
  });

  it("returns updated snapshot immediately", () => {
    const snap = updateRiskConfig({ maxRiskPerTradePct: 0.03 });
    expect(snap.config.maxRiskPerTradePct).toBe(0.03);
  });

  it("only specified keys are changed; unspecified keys unchanged", () => {
    const before = getRiskEngineSnapshot().config;
    updateRiskConfig({ maxRiskPerTradePct: 0.05 });
    const after = getRiskEngineSnapshot().config;
    expect(after.maxRiskPerTradePct).toBe(0.05);
    expect(after.maxDailyLossUsd).toBe(before.maxDailyLossUsd);
    expect(after.maxConcurrentPositions).toBe(before.maxConcurrentPositions);
  });
});

// ─── getRiskEngineSnapshot ─────────────────────────────────────────────────────

describe("getRiskEngineSnapshot", () => {

  it("returns object with runtime and config keys", () => {
    const snap = getRiskEngineSnapshot();
    expect(snap).toHaveProperty("runtime");
    expect(snap).toHaveProperty("config");
  });

  it("runtime has killSwitchActive and updatedAt", () => {
    const snap = getRiskEngineSnapshot();
    expect(snap.runtime).toHaveProperty("killSwitchActive");
    expect(snap.runtime).toHaveProperty("updatedAt");
    expect(typeof snap.runtime.updatedAt).toBe("string");
  });

  it("config has all expected risk fields", () => {
    const snap = getRiskEngineSnapshot();
    expect(snap.config).toHaveProperty("maxRiskPerTradePct");
    expect(snap.config).toHaveProperty("maxDailyLossUsd");
    expect(snap.config).toHaveProperty("maxConcurrentPositions");
    expect(snap.config).toHaveProperty("maxTradesPerSession");
    expect(snap.config).toHaveProperty("newsLockoutActive");
  });

  it("snapshot config is a structural copy (mutating it doesn't change engine state)", () => {
    const snap = getRiskEngineSnapshot();
    const originalMax = snap.config.maxRiskPerTradePct;
    (snap.config as any).maxRiskPerTradePct = 999;
    // Engine state should be unchanged
    expect(getRiskEngineSnapshot().config.maxRiskPerTradePct).toBe(originalMax);
  });
});
