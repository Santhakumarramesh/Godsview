/**
 * production_hardening_unit.test.ts — Phase 76
 *
 * Edge-case and boundary tests for the three production-safety systems:
 *
 *   degradation.ts:
 *     - Circuit breaker opens after CIRCUIT_OPEN_AFTER_FAILURES (5) failures
 *     - markHealthy resets circuit state
 *     - isAvailable returns false while circuit is open
 *     - heuristicClaudeScore range clamping
 *     - getDegradationSnapshot shape
 *     - shouldBypassClaude logic
 *
 *   auto_trade_config.ts:
 *     - getAutoTradeConfig returns frozen-style config snapshot
 *     - updateAutoTradeConfig clamps qualityFloor to [0, 1]
 *     - checkAutoTradeGate: disabled → rejected
 *     - checkAutoTradeGate: quality below floor → rejected
 *     - checkAutoTradeGate: session cap → rejected
 *     - checkAutoTradeGate: setup not in allowlist → rejected
 *     - recordAutoTradeAttempt increments session counter on accepted
 *     - recordAutoTradeAttempt does NOT increment on rejected
 *     - resetAutoTradeSession resets counters
 *     - getAutoTradeLog returns records in reverse insertion order
 *
 *   circuit_breaker.ts (through mocked dependencies):
 *     - getCircuitBreakerStatus returns valid shape
 *     - isCircuitBreakerArmed returns boolean
 *     - manualTrip arms the breaker and sets lastTripReason = 'manual'
 *     - resetCircuitBreaker disarms after manual trip
 *     - getTripHistory grows after each trip
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// ── Degradation ──────────────────────────────────────────────────────────────

import {
  markHealthy,
  markFailed,
  isAvailable,
  getDegradationSnapshot,
  shouldBypassClaude,
  heuristicClaudeScore,
} from "../lib/degradation";

describe("degradation — markHealthy / markFailed", () => {
  beforeEach(() => {
    // Reset each subsystem to healthy state before every test
    markHealthy("alpaca");
    markHealthy("claude");
    markHealthy("database");
    markHealthy("stream");
  });

  it("isAvailable returns true when subsystem is healthy", () => {
    markHealthy("alpaca");
    expect(isAvailable("alpaca")).toBe(true);
  });

  it("one markFailed transitions state to degraded (not down yet)", () => {
    markFailed("alpaca", "timeout");
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.alpaca.state).toBe("degraded");
    expect(snap.subsystems.alpaca.consecutive_failures).toBe(1);
  });

  it("5 consecutive markFailed opens the circuit (state = down)", () => {
    for (let i = 0; i < 5; i++) markFailed("claude", "503");
    expect(isAvailable("claude")).toBe(false);
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.claude.circuit_open).toBe(true);
    expect(snap.subsystems.claude.state).toBe("down");
  });

  it("markHealthy after failures resets circuit and restores availability", () => {
    for (let i = 0; i < 5; i++) markFailed("database", "ECONNREFUSED");
    expect(isAvailable("database")).toBe(false);
    markHealthy("database");
    expect(isAvailable("database")).toBe(true);
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.database.circuit_open).toBe(false);
    expect(snap.subsystems.database.consecutive_failures).toBe(0);
  });

  it("error_count is cumulative even after markHealthy", () => {
    markFailed("stream", "err1");
    markFailed("stream", "err2");
    markHealthy("stream");
    markFailed("stream", "err3");
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.stream.error_count).toBeGreaterThanOrEqual(3);
  });

  it("last_error records the most recent error string", () => {
    markFailed("alpaca", "network_timeout");
    const snap = getDegradationSnapshot();
    expect(snap.subsystems.alpaca.last_error).toBe("network_timeout");
  });

  it("getDegradationSnapshot has required top-level fields", () => {
    const snap = getDegradationSnapshot();
    expect(snap).toHaveProperty("overall");
    expect(snap).toHaveProperty("subsystems");
    expect(snap).toHaveProperty("degraded_capabilities");
    expect(snap).toHaveProperty("timestamp");
  });

  it("overall is 'healthy' when all subsystems healthy", () => {
    const snap = getDegradationSnapshot();
    expect(snap.overall).toBe("healthy");
  });

  it("overall becomes 'degraded' when one subsystem fails", () => {
    markFailed("stream", "error");
    const snap = getDegradationSnapshot();
    expect(["degraded", "down"]).toContain(snap.overall);
  });
});

describe("degradation — shouldBypassClaude / heuristicClaudeScore", () => {
  beforeEach(() => {
    markHealthy("claude");
  });

  it("shouldBypassClaude is false when claude is healthy", () => {
    expect(shouldBypassClaude()).toBe(false);
  });

  it("shouldBypassClaude is true when claude circuit is open", () => {
    for (let i = 0; i < 5; i++) markFailed("claude", "err");
    expect(shouldBypassClaude()).toBe(true);
    markHealthy("claude"); // cleanup
  });

  it("heuristicClaudeScore returns an object with claude_score in [0, 1]", () => {
    const result = heuristicClaudeScore(0.8, 0.7, 0.6);
    expect(result).toHaveProperty("claude_score");
    expect(result).toHaveProperty("claude_verdict");
    expect(result).toHaveProperty("claude_reasoning");
    expect(result.claude_score).toBeGreaterThanOrEqual(0);
    expect(result.claude_score).toBeLessThanOrEqual(1);
  });

  it("heuristicClaudeScore with all inputs = 1.0 returns high score and APPROVED verdict", () => {
    const high = heuristicClaudeScore(1.0, 1.0, 1.0);
    const low  = heuristicClaudeScore(0.1, 0.1, 0.1);
    expect(high.claude_score).toBeGreaterThan(low.claude_score);
    expect(high.claude_verdict).toBe("APPROVED");
  });

  it("heuristicClaudeScore with all inputs = 0 returns BLOCKED verdict", () => {
    const result = heuristicClaudeScore(0, 0, 0);
    expect(result.claude_verdict).toBe("BLOCKED");
    expect(result.claude_score).toBe(0);
  });
});

// ── auto_trade_config ─────────────────────────────────────────────────────────

import {
  getAutoTradeConfig,
  updateAutoTradeConfig,
  checkAutoTradeGate,
  recordAutoTradeAttempt,
  getAutoTradeLog,
  resetAutoTradeSession,
  getAutoTradeStatus,
} from "../lib/auto_trade_config";

describe("auto_trade_config — getAutoTradeConfig", () => {
  it("returns an object with required fields", () => {
    const cfg = getAutoTradeConfig();
    expect(cfg).toHaveProperty("enabled");
    expect(cfg).toHaveProperty("qualityFloor");
    expect(cfg).toHaveProperty("maxExecutionsPerSession");
    expect(cfg).toHaveProperty("cooldownPerSymbolSec");
    expect(cfg).toHaveProperty("globalCooldownSec");
    expect(cfg).toHaveProperty("sizingMethod");
    expect(cfg).toHaveProperty("allowedSetups");
  });

  it("modifying the returned object does not mutate internal state", () => {
    const cfg = getAutoTradeConfig();
    const prevEnabled = cfg.enabled;
    (cfg as any).enabled = !prevEnabled;
    expect(getAutoTradeConfig().enabled).toBe(prevEnabled);
  });
});

describe("auto_trade_config — updateAutoTradeConfig", () => {
  afterEach(() => {
    // Restore to enabled state for other tests
    updateAutoTradeConfig({ enabled: true, qualityFloor: 0.5, maxExecutionsPerSession: 10, allowedSetups: [] });
    resetAutoTradeSession();
  });

  it("updates enabled flag", () => {
    updateAutoTradeConfig({ enabled: false });
    expect(getAutoTradeConfig().enabled).toBe(false);
    updateAutoTradeConfig({ enabled: true });
    expect(getAutoTradeConfig().enabled).toBe(true);
  });

  it("clamps qualityFloor below 0 to 0", () => {
    updateAutoTradeConfig({ qualityFloor: -0.5 });
    expect(getAutoTradeConfig().qualityFloor).toBe(0);
  });

  it("clamps qualityFloor above 1 to 1", () => {
    updateAutoTradeConfig({ qualityFloor: 1.5 });
    expect(getAutoTradeConfig().qualityFloor).toBe(1);
  });

  it("sets maxExecutionsPerSession (min 1)", () => {
    updateAutoTradeConfig({ maxExecutionsPerSession: 0 }); // below min
    expect(getAutoTradeConfig().maxExecutionsPerSession).toBeGreaterThanOrEqual(1);
  });

  it("sets allowedSetups array", () => {
    updateAutoTradeConfig({ allowedSetups: ["BOS_UP", "CHoCH_UP"] });
    expect(getAutoTradeConfig().allowedSetups).toEqual(["BOS_UP", "CHoCH_UP"]);
  });
});

describe("auto_trade_config — checkAutoTradeGate", () => {
  beforeEach(() => {
    resetAutoTradeSession();
    updateAutoTradeConfig({ enabled: true, qualityFloor: 0.5, maxExecutionsPerSession: 10, allowedSetups: [], globalCooldownSec: 0, cooldownPerSymbolSec: 0 });
  });

  it("returns null when all gates pass", () => {
    const result = checkAutoTradeGate({ symbol: "BTCUSD", quality: 0.8, setupType: "BOS_UP" });
    expect(result).toBeNull();
  });

  it("returns rejection string when auto_trade is disabled", () => {
    updateAutoTradeConfig({ enabled: false });
    const result = checkAutoTradeGate({ symbol: "BTCUSD", quality: 0.8, setupType: "BOS_UP" });
    expect(result).toBeTruthy();
    expect(result).toContain("disabled");
  });

  it("returns rejection when quality is below qualityFloor", () => {
    updateAutoTradeConfig({ qualityFloor: 0.8 });
    const result = checkAutoTradeGate({ symbol: "BTCUSD", quality: 0.5, setupType: "BOS_UP" });
    expect(result).toBeTruthy();
    expect(result).toContain("quality_below_floor");
  });

  it("returns null when quality equals qualityFloor exactly", () => {
    updateAutoTradeConfig({ qualityFloor: 0.6 });
    const result = checkAutoTradeGate({ symbol: "BTCUSD", quality: 0.6, setupType: "BOS_UP" });
    expect(result).toBeNull();
  });

  it("returns rejection when setup not in allowlist", () => {
    updateAutoTradeConfig({ allowedSetups: ["BOS_UP"] });
    const result = checkAutoTradeGate({ symbol: "BTCUSD", quality: 0.8, setupType: "CHoCH_UP" });
    expect(result).toBeTruthy();
    expect(result).toContain("not_in_allowlist");
  });

  it("returns null when setup IS in allowlist", () => {
    updateAutoTradeConfig({ allowedSetups: ["BOS_UP", "CHoCH_UP"] });
    const result = checkAutoTradeGate({ symbol: "BTCUSD", quality: 0.8, setupType: "CHoCH_UP" });
    expect(result).toBeNull();
  });

  it("returns rejection when session cap is reached", () => {
    updateAutoTradeConfig({ maxExecutionsPerSession: 2 });
    // Record 2 accepted executions
    const base = { symbol: "BTCUSD", quality: 0.8, setupType: "BOS_UP", direction: "long" as const, accepted: true, rejectionReason: null, executedAt: new Date().toISOString() };
    recordAutoTradeAttempt(base);
    recordAutoTradeAttempt({ ...base, symbol: "ETHUSD" });
    const result = checkAutoTradeGate({ symbol: "SOLUSD", quality: 0.9, setupType: "BOS_UP" });
    expect(result).toBeTruthy();
    expect(result).toContain("session_cap_reached");
  });
});

describe("auto_trade_config — recordAutoTradeAttempt", () => {
  beforeEach(() => {
    resetAutoTradeSession();
    updateAutoTradeConfig({ enabled: true, qualityFloor: 0.5, maxExecutionsPerSession: 100, cooldownPerSymbolSec: 0, globalCooldownSec: 0 });
  });

  const makeAttempt = (accepted: boolean, symbol = "BTCUSD") => ({
    symbol,
    quality: 0.8,
    setupType: "BOS_UP",
    direction: "long" as const,
    accepted,
    rejectionReason: accepted ? null : "quality_below_floor",
    executedAt: new Date().toISOString(),
  });

  it("increments executionsThisSession on accepted attempt", () => {
    const before = getAutoTradeStatus().executionsThisSession;
    recordAutoTradeAttempt(makeAttempt(true));
    expect(getAutoTradeStatus().executionsThisSession).toBe(before + 1);
  });

  it("does NOT increment executionsThisSession on rejected attempt", () => {
    const before = getAutoTradeStatus().executionsThisSession;
    recordAutoTradeAttempt(makeAttempt(false));
    expect(getAutoTradeStatus().executionsThisSession).toBe(before);
  });

  it("returns record with auto-assigned id", () => {
    const rec = recordAutoTradeAttempt(makeAttempt(true));
    expect(rec.id).toBeDefined();
    expect(typeof rec.id).toBe("string");
    expect(rec.id.length).toBeGreaterThan(0);
  });

  it("getAutoTradeLog returns recent records (newest first)", () => {
    recordAutoTradeAttempt(makeAttempt(true, "BTCUSD"));
    recordAutoTradeAttempt(makeAttempt(true, "ETHUSD"));
    const log = getAutoTradeLog();
    expect(log.length).toBeGreaterThanOrEqual(2);
    // Most recent symbol should be first
    expect(log[0]!.symbol).toBe("ETHUSD");
  });
});

describe("auto_trade_config — resetAutoTradeSession", () => {
  it("resets executionsThisSession to 0", () => {
    updateAutoTradeConfig({ maxExecutionsPerSession: 100, cooldownPerSymbolSec: 0, globalCooldownSec: 0 });
    recordAutoTradeAttempt({
      symbol: "BTCUSD", quality: 0.8, setupType: "BOS_UP",
      direction: "long", accepted: true, rejectionReason: null,
      executedAt: new Date().toISOString(),
    });
    expect(getAutoTradeStatus().executionsThisSession).toBeGreaterThan(0);
    resetAutoTradeSession();
    expect(getAutoTradeStatus().executionsThisSession).toBe(0);
  });

  it("clears lastExecutedAt after reset", () => {
    recordAutoTradeAttempt({
      symbol: "BTCUSD", quality: 0.8, setupType: "BOS_UP",
      direction: "long", accepted: true, rejectionReason: null,
      executedAt: new Date().toISOString(),
    });
    expect(getAutoTradeStatus().lastExecutedAt).not.toBeNull();
    resetAutoTradeSession();
    expect(getAutoTradeStatus().lastExecutedAt).toBeNull();
  });

  it("allows gate to pass again after cap was reached and session was reset", () => {
    updateAutoTradeConfig({ maxExecutionsPerSession: 1, cooldownPerSymbolSec: 0, globalCooldownSec: 0 });
    recordAutoTradeAttempt({
      symbol: "BTCUSD", quality: 0.8, setupType: "BOS_UP",
      direction: "long", accepted: true, rejectionReason: null,
      executedAt: new Date().toISOString(),
    });
    expect(checkAutoTradeGate({ symbol: "ETHUSD", quality: 0.9, setupType: "BOS_UP" })).not.toBeNull();
    resetAutoTradeSession();
    updateAutoTradeConfig({ maxExecutionsPerSession: 10 });
    expect(checkAutoTradeGate({ symbol: "ETHUSD", quality: 0.9, setupType: "BOS_UP" })).toBeNull();
  });
});

// ── circuit_breaker (mocked deps) ─────────────────────────────────────────────

vi.mock("../lib/trade_journal", () => ({
  listJournalEntries: vi.fn().mockReturnValue([]),
}));
vi.mock("../lib/risk_engine", () => ({
  setKillSwitchActive: vi.fn(),
  getKillSwitchActive: vi.fn().mockReturnValue(false),
}));
vi.mock("../lib/signal_stream", () => ({
  publishAlert: vi.fn(),
}));

import {
  checkCircuitBreaker,
  getCircuitBreakerStatus,
  isCircuitBreakerArmed,
  resetCircuitBreaker,
  getTripHistory,
  manualTrip,
} from "../lib/circuit_breaker";

describe("circuit_breaker — basic state", () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it("getCircuitBreakerStatus returns shape with required fields", () => {
    const status = getCircuitBreakerStatus();
    expect(status).toHaveProperty("armed");
    expect(status).toHaveProperty("trippedAt");
    expect(status).toHaveProperty("lastTripReason");
    expect(status).toHaveProperty("lastTripDetail");
    expect(status).toHaveProperty("autoResetAt");
    expect(status).toHaveProperty("tripCount");
    expect(status).toHaveProperty("lastCheckedAt");
    expect(status).toHaveProperty("config");
    expect(status).toHaveProperty("todayStats");
  });

  it("isCircuitBreakerArmed returns false initially (no trips)", () => {
    expect(isCircuitBreakerArmed()).toBe(false);
  });

  it("config has numeric thresholds", () => {
    const { config } = getCircuitBreakerStatus();
    expect(typeof config.maxDailyLossPct).toBe("number");
    expect(typeof config.maxConsecutiveLosses).toBe("number");
    expect(typeof config.maxDrawdownPct).toBe("number");
    expect(typeof config.autoResetHours).toBe("number");
  });

  it("checkCircuitBreaker returns status without throwing (empty journal)", () => {
    expect(() => checkCircuitBreaker()).not.toThrow();
    const status = checkCircuitBreaker();
    expect(status).toHaveProperty("armed");
  });
});

describe("circuit_breaker — manualTrip / reset", () => {
  beforeEach(() => {
    resetCircuitBreaker();
  });

  it("manualTrip arms the circuit breaker", () => {
    manualTrip("testing manual trip");
    expect(isCircuitBreakerArmed()).toBe(true);
  });

  it("manualTrip sets lastTripReason to manual", () => {
    manualTrip("test");
    expect(getCircuitBreakerStatus().lastTripReason).toBe("manual");
  });

  it("manualTrip increments tripCount", () => {
    const before = getCircuitBreakerStatus().tripCount;
    manualTrip("trip 1");
    expect(getCircuitBreakerStatus().tripCount).toBe(before + 1);
  });

  it("resetCircuitBreaker disarms after manualTrip", () => {
    manualTrip("test");
    expect(isCircuitBreakerArmed()).toBe(true);
    resetCircuitBreaker();
    expect(isCircuitBreakerArmed()).toBe(false);
  });

  it("resetCircuitBreaker clears trippedAt", () => {
    manualTrip("test");
    resetCircuitBreaker();
    expect(getCircuitBreakerStatus().trippedAt).toBeNull();
  });

  it("getTripHistory grows after each manualTrip", () => {
    resetCircuitBreaker();
    const before = getTripHistory().length;
    manualTrip("trip A");
    resetCircuitBreaker();
    manualTrip("trip B");
    expect(getTripHistory().length).toBe(before + 2);
  });

  it("getTripHistory entries have reason and triggeredAt fields", () => {
    manualTrip("test");
    const history = getTripHistory();
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toHaveProperty("reason");
    expect(history[0]).toHaveProperty("triggeredAt");
    expect(history[0]!.reason).toBe("manual");
  });
});
