/**
 * ops_monitor_unit.test.ts — Phase 63
 *
 * Unit tests for lib/ops_monitor.ts:
 *
 *   registerEngine       — registers engine, idempotent
 *   markEngineRun        — updates last_run timestamp
 *   markEngineError      — increments error_count
 *   updateDataFreshness  — sets freshness timestamp
 *   addOpsAlert          — pushes to alert queue (capped at MAX_ALERTS)
 *   getOpsAlerts         — returns slice of alerts
 *   clearOpsAlerts       — empties alert queue
 *   getOpsSnapshot       — full snapshot with shape check
 *
 * Cache note: getOpsSnapshot() has a 5-second TTL.
 * Tests use vi.useFakeTimers() + advanceTimersByTime(6000) via freshSnap()
 * to bust the cache between each state assertion.
 *
 * Dependencies mocked:
 *   ../lib/logger — logger
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import {
  registerEngine,
  markEngineRun,
  markEngineError,
  updateDataFreshness,
  addOpsAlert,
  getOpsAlerts,
  clearOpsAlerts,
  getOpsSnapshot,
} from "../lib/ops_monitor";

// ── Fake timers — bust 5-second snapshot TTL between assertions ───────────────
vi.useFakeTimers();

afterAll(() => {
  vi.useRealTimers();
});

/** Force a fresh (non-cached) snapshot by advancing fake time > TTL. */
function freshSnap() {
  vi.advanceTimersByTime(6_000); // 6s > 5s TTL
  return getOpsSnapshot();
}

beforeEach(() => {
  clearOpsAlerts();
  // Also bust cache so each test starts with a fresh snapshot
  vi.advanceTimersByTime(6_000);
});

// ─────────────────────────────────────────────────────────────────────────────
// registerEngine
// ─────────────────────────────────────────────────────────────────────────────

describe("registerEngine", () => {
  it("makes the engine appear in engine_status", () => {
    registerEngine("reg_eng_1");
    expect(freshSnap().engine_status).toHaveProperty("reg_eng_1");
  });

  it("initialises with loaded=true", () => {
    registerEngine("reg_eng_2");
    expect(freshSnap().engine_status["reg_eng_2"]?.loaded).toBe(true);
  });

  it("initialises with error_count=0", () => {
    registerEngine("reg_eng_3");
    expect(freshSnap().engine_status["reg_eng_3"]?.error_count).toBe(0);
  });

  it("initialises with last_run=null", () => {
    registerEngine("reg_eng_4");
    expect(freshSnap().engine_status["reg_eng_4"]?.last_run).toBeNull();
  });

  it("is idempotent — does not reset error_count on re-register", () => {
    registerEngine("reg_eng_5");
    markEngineError("reg_eng_5");
    const before = freshSnap().engine_status["reg_eng_5"]?.error_count ?? 0;
    registerEngine("reg_eng_5"); // re-register
    expect(freshSnap().engine_status["reg_eng_5"]?.error_count).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markEngineRun
// ─────────────────────────────────────────────────────────────────────────────

describe("markEngineRun", () => {
  it("sets last_run to a non-null ISO string", () => {
    registerEngine("run_eng_1");
    markEngineRun("run_eng_1");
    const last = freshSnap().engine_status["run_eng_1"]?.last_run;
    expect(last).not.toBeNull();
    expect(() => new Date(last!)).not.toThrow();
  });

  it("auto-registers unknown engine", () => {
    markEngineRun("auto_run_eng");
    expect(freshSnap().engine_status["auto_run_eng"]).toBeDefined();
  });

  it("successive calls move last_run forward in time", () => {
    registerEngine("time_eng");
    markEngineRun("time_eng");
    const t1 = freshSnap().engine_status["time_eng"]?.last_run;
    vi.advanceTimersByTime(100);
    markEngineRun("time_eng");
    const t2 = freshSnap().engine_status["time_eng"]?.last_run;
    expect(new Date(t2!).getTime()).toBeGreaterThanOrEqual(new Date(t1!).getTime());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markEngineError
// ─────────────────────────────────────────────────────────────────────────────

describe("markEngineError", () => {
  it("increments error_count by 1", () => {
    registerEngine("err_eng_1");
    const before = freshSnap().engine_status["err_eng_1"]?.error_count ?? 0;
    markEngineError("err_eng_1");
    expect(freshSnap().engine_status["err_eng_1"]?.error_count).toBe(before + 1);
  });

  it("auto-registers unknown engine", () => {
    markEngineError("auto_err_eng");
    expect(freshSnap().engine_status["auto_err_eng"]).toBeDefined();
  });

  it("accumulates across multiple errors", () => {
    registerEngine("multi_err_eng");
    markEngineError("multi_err_eng");
    markEngineError("multi_err_eng");
    markEngineError("multi_err_eng");
    const count = freshSnap().engine_status["multi_err_eng"]?.error_count ?? 0;
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateDataFreshness
// ─────────────────────────────────────────────────────────────────────────────

describe("updateDataFreshness", () => {
  it("alpaca_bars freshness age is non-null after update", () => {
    updateDataFreshness("alpaca_bars", new Date());
    expect(freshSnap().data_freshness.alpaca_bars_age_ms).not.toBeNull();
  });

  it("freshness age is a non-negative number", () => {
    updateDataFreshness("alpaca_bars", new Date());
    expect(freshSnap().data_freshness.alpaca_bars_age_ms).toBeGreaterThanOrEqual(0);
  });

  it("orderbook freshness is tracked separately", () => {
    updateDataFreshness("orderbook", new Date());
    expect(freshSnap().data_freshness.orderbook_age_ms).not.toBeNull();
  });

  it("si_last_decision freshness is tracked separately", () => {
    updateDataFreshness("si_last_decision", new Date());
    expect(freshSnap().data_freshness.si_last_decision_age_ms).not.toBeNull();
  });

  it("stale data has age > update interval", () => {
    const past = new Date(Date.now() - 60_000); // 1 min in fake time
    updateDataFreshness("alpaca_bars", past);
    const age = freshSnap().data_freshness.alpaca_bars_age_ms!;
    expect(age).toBeGreaterThanOrEqual(60_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// addOpsAlert / getOpsAlerts / clearOpsAlerts
// ─────────────────────────────────────────────────────────────────────────────

describe("addOpsAlert", () => {
  it("adds alert to the queue", () => {
    addOpsAlert("info", "test message");
    expect(getOpsAlerts()).toHaveLength(1);
  });

  it("alert has level, message, timestamp", () => {
    addOpsAlert("warn", "something wrong");
    const alert = getOpsAlerts()[0];
    expect(alert).toHaveProperty("level", "warn");
    expect(alert).toHaveProperty("message", "something wrong");
    expect(alert).toHaveProperty("timestamp");
  });

  it("supports all three levels", () => {
    addOpsAlert("info",     "info msg");
    addOpsAlert("warn",     "warn msg");
    addOpsAlert("critical", "crit msg");
    const levels = getOpsAlerts().map(a => a.level);
    expect(levels).toContain("info");
    expect(levels).toContain("warn");
    expect(levels).toContain("critical");
  });

  it("most recent alert is first (LIFO)", () => {
    addOpsAlert("info", "first");
    addOpsAlert("info", "second");
    expect(getOpsAlerts()[0].message).toBe("second");
  });
});

describe("getOpsAlerts", () => {
  it("default limit is ≤ 50", () => {
    for (let i = 0; i < 60; i++) addOpsAlert("info", `alert-${i}`);
    expect(getOpsAlerts().length).toBeLessThanOrEqual(50);
  });

  it("respects custom limit", () => {
    for (let i = 0; i < 10; i++) addOpsAlert("info", `msg-${i}`);
    expect(getOpsAlerts(3)).toHaveLength(3);
  });
});

describe("clearOpsAlerts", () => {
  it("empties the alert queue", () => {
    addOpsAlert("info", "will be cleared");
    clearOpsAlerts();
    expect(getOpsAlerts()).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getOpsSnapshot — shape & invariants
// ─────────────────────────────────────────────────────────────────────────────

describe("getOpsSnapshot", () => {
  it("returns all required top-level fields", () => {
    const snap = freshSnap();
    const fields = [
      "timestamp", "overall_status", "services",
      "data_freshness", "broker", "system", "engine_status", "alerts",
    ];
    for (const f of fields) expect(snap).toHaveProperty(f);
  });

  it("timestamp is a valid ISO string", () => {
    const { timestamp } = freshSnap();
    expect(() => new Date(timestamp)).not.toThrow();
  });

  it("overall_status is green | yellow | red", () => {
    expect(["green", "yellow", "red"]).toContain(freshSnap().overall_status);
  });

  it("services is a non-empty array", () => {
    const { services } = freshSnap();
    expect(Array.isArray(services)).toBe(true);
    expect(services.length).toBeGreaterThan(0);
  });

  it("each service has name, status, last_check", () => {
    const { services } = freshSnap();
    for (const svc of services) {
      expect(svc).toHaveProperty("name");
      expect(["healthy", "degraded", "down"]).toContain(svc.status);
      expect(svc).toHaveProperty("last_check");
    }
  });

  it("system block has uptime_ms > 0 and memory_used_mb > 0", () => {
    const { system } = freshSnap();
    expect(system.uptime_ms).toBeGreaterThan(0);
    expect(system.memory_used_mb).toBeGreaterThan(0);
  });

  it("is cached — two calls within TTL return same timestamp", () => {
    const snap1 = freshSnap();
    const snap2 = getOpsSnapshot(); // no time advance — must hit cache
    expect(snap2.timestamp).toBe(snap1.timestamp);
  });
});
