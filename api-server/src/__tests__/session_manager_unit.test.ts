/**
 * session_manager_unit.test.ts — Phase 62
 *
 * Unit tests for lib/session_manager.ts:
 *
 *   startSession         — creates an ActiveSession, returns it
 *   endSession           — clears active session
 *   recordTradeExecuted  — increments trades_executed
 *   recordSignalGenerated — increments signals_generated
 *   getActiveSession     — returns null or the current session
 *   getSessionId         — returns session_id or null
 *
 * Dependencies mocked:
 *   @workspace/db         — db (insert/update chains), tradingSessionsTable
 *   drizzle-orm           — eq
 *   ../lib/drawdown_breaker — getBreakerSnapshot
 *   ../lib/risk_engine    — isKillSwitchActive
 *   ../lib/logger         — logger
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  eq:   vi.fn(() => null),
  and:  vi.fn((...args: unknown[]) => args),
  desc: vi.fn(() => null),
}));

vi.mock("@workspace/db", () => {
  // Shared chainable DB mock
  const updateChain: any = {};
  updateChain.set    = vi.fn().mockReturnValue(updateChain);
  updateChain.where  = vi.fn().mockResolvedValue([]);

  const insertChain: any = {};
  insertChain.values    = vi.fn().mockReturnValue(insertChain);
  insertChain.returning = vi.fn().mockResolvedValue([{ id: 1 }]);

  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "insert") return () => insertChain;
      if (key === "update") return () => updateChain;
      if (key === "execute") return vi.fn().mockResolvedValue(undefined);
      return undefined;
    },
  });

  return {
    db,
    tradingSessionsTable: new Proxy({ tableName: "trading_sessions" } as any, {
      get(t, p) { return t[p] ?? String(p); },
    }),
  };
});

vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: vi.fn(() => ({
    level:              "NORMAL",
    realized_pnl_today: 0,
    max_drawdown_pct:   0.05,
  })),
}));

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: vi.fn(() => false),
}));

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
  startSession,
  endSession,
  recordTradeExecuted,
  recordSignalGenerated,
  getActiveSession,
  getSessionId,
} from "../lib/session_manager";

// Reset between tests
beforeEach(async () => {
  // End any lingering session from a previous test
  if (getActiveSession()) {
    await endSession("test_cleanup");
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// getActiveSession / getSessionId — initial state
// ─────────────────────────────────────────────────────────────────────────────

describe("initial state (no session)", () => {
  it("getActiveSession returns null when no session is active", () => {
    expect(getActiveSession()).toBeNull();
  });

  it("getSessionId returns null when no session is active", () => {
    expect(getSessionId()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// startSession
// ─────────────────────────────────────────────────────────────────────────────

describe("startSession", () => {
  it("returns an ActiveSession object", async () => {
    const session = await startSession("paper");
    expect(session).toHaveProperty("session_id");
    expect(session).toHaveProperty("system_mode");
    expect(session).toHaveProperty("operator_id");
    expect(session).toHaveProperty("started_at");
    expect(session).toHaveProperty("trades_executed");
    expect(session).toHaveProperty("signals_generated");
  });

  it("session_id starts with 'gs-'", async () => {
    const session = await startSession("paper");
    expect(session.session_id).toMatch(/^gs-/);
  });

  it("system_mode matches the provided value", async () => {
    const session = await startSession("live");
    expect(session.system_mode).toBe("live");
  });

  it("trades_executed starts at 0", async () => {
    const session = await startSession("paper");
    expect(session.trades_executed).toBe(0);
  });

  it("signals_generated starts at 0", async () => {
    const session = await startSession("paper");
    expect(session.signals_generated).toBe(0);
  });

  it("operator_id is null when not provided", async () => {
    const session = await startSession("paper");
    expect(session.operator_id).toBeNull();
  });

  it("operator_id is set when provided", async () => {
    const session = await startSession("paper", "op-001");
    expect(session.operator_id).toBe("op-001");
  });

  it("getActiveSession returns the started session", async () => {
    const session = await startSession("dry_run");
    const active  = getActiveSession();
    expect(active).not.toBeNull();
    expect(active?.session_id).toBe(session.session_id);
  });

  it("getSessionId returns the session_id", async () => {
    const session = await startSession("paper");
    expect(getSessionId()).toBe(session.session_id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordTradeExecuted / recordSignalGenerated
// ─────────────────────────────────────────────────────────────────────────────

describe("recordTradeExecuted", () => {
  it("increments trades_executed by 1", async () => {
    await startSession("paper");
    recordTradeExecuted();
    expect(getActiveSession()?.trades_executed).toBe(1);
  });

  it("accumulates across multiple calls", async () => {
    await startSession("paper");
    recordTradeExecuted();
    recordTradeExecuted();
    recordTradeExecuted();
    expect(getActiveSession()?.trades_executed).toBe(3);
  });

  it("is a no-op when no session is active", () => {
    // beforeEach clears session — calling should not throw
    expect(() => recordTradeExecuted()).not.toThrow();
  });
});

describe("recordSignalGenerated", () => {
  it("increments signals_generated by 1", async () => {
    await startSession("paper");
    recordSignalGenerated();
    expect(getActiveSession()?.signals_generated).toBe(1);
  });

  it("accumulates across multiple calls", async () => {
    await startSession("paper");
    recordSignalGenerated();
    recordSignalGenerated();
    expect(getActiveSession()?.signals_generated).toBe(2);
  });

  it("is a no-op when no session is active", () => {
    expect(() => recordSignalGenerated()).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// endSession
// ─────────────────────────────────────────────────────────────────────────────

describe("endSession", () => {
  it("clears the active session", async () => {
    await startSession("paper");
    await endSession("manual");
    expect(getActiveSession()).toBeNull();
  });

  it("clears the session_id", async () => {
    await startSession("paper");
    await endSession("manual");
    expect(getSessionId()).toBeNull();
  });

  it("is a no-op when no session is active (no throw)", async () => {
    await expect(endSession("manual")).resolves.not.toThrow();
  });
});
