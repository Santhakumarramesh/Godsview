/**
 * audit_logger_unit.test.ts — Phase 63
 *
 * Unit tests for lib/audit_logger.ts:
 *
 *   logAuditEvent            — writes to auditEventsTable, handles DB failures
 *   logBreakerEvent          — writes to breakerEventsTable, handles DB failures
 *   auditSignalGenerated     — convenience: event_type=signal_generated
 *   auditSignalRejected      — convenience: event_type=signal_rejected
 *   auditTradeExecuted       — convenience: event_type=trade_executed
 *   auditKillSwitch          — convenience: event_type=kill_switch_toggled
 *   auditEmergencyLiquidation — convenience: event_type=emergency_liquidation
 *   auditBreakerEscalation   — convenience: both audit + breaker events
 *
 * Mock pattern:
 *   db.insert is a vi.fn() that returns { values: vi.fn() }.
 *   Access spy via vi.mocked(db.insert) and inspect mock.results.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    insert: vi.fn().mockImplementation(() => ({
      values: vi.fn().mockResolvedValue(undefined),
    })),
  },
  auditEventsTable:   { tableName: "audit_events"   },
  breakerEventsTable: { tableName: "breaker_events" },
}));

vi.mock("../lib/session_manager", () => ({
  getSessionId: vi.fn(() => "sess-test-001"),
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
import { db } from "@workspace/db";
import {
  logAuditEvent,
  logBreakerEvent,
  auditSignalGenerated,
  auditSignalRejected,
  auditTradeExecuted,
  auditKillSwitch,
  auditEmergencyLiquidation,
  auditBreakerEscalation,
} from "../lib/audit_logger";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Number of db.insert() calls in this test. */
function insertCallCount(): number {
  return vi.mocked((db as any).insert).mock.calls.length;
}

/** The .values() arg for the n-th db.insert call (0-indexed). */
function insertCallArg(n = 0): Record<string, unknown> {
  const insertMock = vi.mocked((db as any).insert);
  const chain = insertMock.mock.results[n]?.value;
  return chain?.values?.mock?.calls?.[0]?.[0] ?? {};
}

beforeEach(() => {
  vi.clearAllMocks();
  // Re-attach implementation after clearAllMocks
  vi.mocked((db as any).insert).mockImplementation(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
});

// ─────────────────────────────────────────────────────────────────────────────
// logAuditEvent
// ─────────────────────────────────────────────────────────────────────────────

describe("logAuditEvent", () => {
  it("calls db.insert once", async () => {
    await logAuditEvent({ event_type: "signal_generated" });
    expect(insertCallCount()).toBe(1);
  });

  it("passes event_type to insert", async () => {
    await logAuditEvent({ event_type: "trade_executed" });
    expect(insertCallArg().event_type).toBe("trade_executed");
  });

  it("defaults actor to 'system'", async () => {
    await logAuditEvent({ event_type: "config_changed" });
    expect(insertCallArg().actor).toBe("system");
  });

  it("uses provided actor over default", async () => {
    await logAuditEvent({ event_type: "kill_switch_toggled", actor: "op-001" });
    expect(insertCallArg().actor).toBe("op-001");
  });

  it("serialises payload to JSON string", async () => {
    const payload = { qty: 0.5, price: 42000 };
    await logAuditEvent({ event_type: "trade_executed", payload });
    const json = insertCallArg().payload_json as string;
    expect(typeof json).toBe("string");
    expect(JSON.parse(json)).toMatchObject(payload);
  });

  it("sets payload_json to null when payload is absent", async () => {
    await logAuditEvent({ event_type: "session_started" });
    expect(insertCallArg().payload_json).toBeNull();
  });

  it("does not throw when db.insert rejects", async () => {
    vi.mocked((db as any).insert).mockImplementationOnce(() => ({
      values: vi.fn().mockRejectedValue(new Error("DB down")),
    }));
    await expect(logAuditEvent({ event_type: "session_started" })).resolves.toBeUndefined();
  });

  it("logs error on DB failure", async () => {
    const { logger } = await import("../lib/logger") as any;
    vi.mocked((db as any).insert).mockImplementationOnce(() => ({
      values: vi.fn().mockRejectedValue(new Error("disk full")),
    }));
    await logAuditEvent({ event_type: "config_changed" });
    expect(logger.error).toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// logBreakerEvent
// ─────────────────────────────────────────────────────────────────────────────

describe("logBreakerEvent", () => {
  it("calls db.insert once", async () => {
    await logBreakerEvent({ level: "HALT", trigger: "daily_loss" });
    expect(insertCallCount()).toBe(1);
  });

  it("passes level to insert", async () => {
    await logBreakerEvent({ level: "WARNING", trigger: "consecutive" });
    expect(insertCallArg().level).toBe("WARNING");
  });

  it("includes session_id from getSessionId()", async () => {
    await logBreakerEvent({ level: "NORMAL", trigger: "reset" });
    expect(insertCallArg().session_id).toBe("sess-test-001");
  });

  it("stringifies daily_pnl", async () => {
    await logBreakerEvent({ level: "THROTTLE", trigger: "velocity", daily_pnl: -180 });
    expect(insertCallArg().daily_pnl).toBe("-180");
  });

  it("preserves consecutive_losses as number", async () => {
    await logBreakerEvent({ level: "HALT", trigger: "losses", consecutive_losses: 4 });
    expect(insertCallArg().consecutive_losses).toBe(4);
  });

  it("does not throw when db.insert rejects", async () => {
    vi.mocked((db as any).insert).mockImplementationOnce(() => ({
      values: vi.fn().mockRejectedValue(new Error("locked")),
    }));
    await expect(logBreakerEvent({ level: "HALT", trigger: "test" })).resolves.toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Convenience functions
// ─────────────────────────────────────────────────────────────────────────────

describe("auditSignalGenerated", () => {
  it("inserts with event_type=signal_generated", async () => {
    await auditSignalGenerated("BTCUSD", "sweep_reclaim", 0.72, {});
    expect(insertCallArg().event_type).toBe("signal_generated");
  });

  it("passes instrument and setup_type", async () => {
    await auditSignalGenerated("ETHUSD", "absorption_reversal", 0.68, {});
    expect(insertCallArg()).toMatchObject({
      instrument: "ETHUSD",
      setup_type: "absorption_reversal",
    });
  });

  it("includes final_quality in payload", async () => {
    await auditSignalGenerated("BTCUSD", "sweep_reclaim", 0.73, { structure: 0.8 });
    const payload = JSON.parse(insertCallArg().payload_json as string);
    expect(payload.final_quality).toBe(0.73);
  });
});

describe("auditSignalRejected", () => {
  it("inserts with event_type=signal_rejected", async () => {
    await auditSignalRejected("BTCUSD", "cvd_divergence", "macro headwind", "macro_bias_block");
    expect(insertCallArg().event_type).toBe("signal_rejected");
  });

  it("passes reason", async () => {
    await auditSignalRejected("BTCUSD", "sweep_reclaim", "session closed", "bad_session");
    expect(insertCallArg().reason).toBe("session closed");
  });

  it("stores gate in payload", async () => {
    await auditSignalRejected("BTCUSD", "sweep_reclaim", "news lockout", "news_lockout");
    const payload = JSON.parse(insertCallArg().payload_json as string);
    expect(payload.gate).toBe("news_lockout");
  });
});

describe("auditTradeExecuted", () => {
  it("inserts with event_type=trade_executed", async () => {
    await auditTradeExecuted("BTCUSD", "long", 0.05, 42000, "ord-001");
    expect(insertCallArg().event_type).toBe("trade_executed");
  });

  it("payload has direction, quantity, entry_price, order_id", async () => {
    await auditTradeExecuted("ETHUSD", "short", 0.1, 2500, "ord-002");
    const payload = JSON.parse(insertCallArg().payload_json as string);
    expect(payload).toMatchObject({
      direction: "short",
      quantity: 0.1,
      entry_price: 2500,
      order_id: "ord-002",
    });
  });
});

describe("auditKillSwitch", () => {
  it("inserts with event_type=kill_switch_toggled", async () => {
    await auditKillSwitch(true, "operator");
    expect(insertCallArg().event_type).toBe("kill_switch_toggled");
  });

  it("decision_state=engaged when active=true", async () => {
    await auditKillSwitch(true, "system");
    expect(insertCallArg().decision_state).toBe("engaged");
  });

  it("decision_state=disengaged when active=false", async () => {
    await auditKillSwitch(false, "system");
    expect(insertCallArg().decision_state).toBe("disengaged");
  });
});

describe("auditEmergencyLiquidation", () => {
  it("inserts with event_type=emergency_liquidation", async () => {
    await auditEmergencyLiquidation("drawdown_breaker");
    expect(insertCallArg().event_type).toBe("emergency_liquidation");
  });

  it("reason mentions triggeredBy", async () => {
    await auditEmergencyLiquidation("circuit_breaker");
    expect(String(insertCallArg().reason)).toContain("circuit_breaker");
  });
});

describe("auditBreakerEscalation", () => {
  it("calls db.insert TWICE (audit + breaker_events)", async () => {
    await auditBreakerEscalation("NORMAL", "WARNING", "daily_loss", -120, 1);
    expect(insertCallCount()).toBe(2);
  });

  it("first insert has event_type=breaker_escalated", async () => {
    await auditBreakerEscalation("WARNING", "HALT", "drawdown", -250, 3);
    expect(insertCallArg(0).event_type).toBe("breaker_escalated");
  });

  it("second insert has level=newLevel", async () => {
    await auditBreakerEscalation("NORMAL", "THROTTLE", "velocity", -100, 0);
    expect(insertCallArg(1).level).toBe("THROTTLE");
  });
});
