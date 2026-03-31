import { describe, it, expect, beforeEach } from "vitest";

describe("Session Manager", () => {
  beforeEach(async () => {
    // Reset any active session between tests
    const { endSession, getActiveSession } = await import("../lib/session_manager");
    if (getActiveSession()) {
      await endSession("test_reset");
    }
  });

  it("startSession creates an active session", async () => {
    const { startSession, getActiveSession, getSessionId } = await import("../lib/session_manager");
    const session = await startSession("paper", "tester");
    expect(session).toBeDefined();
    expect(session.session_id).toMatch(/^gs-/);
    expect(session.system_mode).toBe("paper");
    expect(session.operator_id).toBe("tester");
    expect(session.trades_executed).toBe(0);
    expect(getActiveSession()).toBeTruthy();
    expect(getSessionId()).toBe(session.session_id);
    await import("../lib/session_manager").then(m => m.endSession("test_done"));
  });

  it("endSession clears the active session", async () => {
    const { startSession, endSession, getActiveSession } = await import("../lib/session_manager");
    await startSession("paper");
    expect(getActiveSession()).toBeTruthy();
    await endSession("manual");
    expect(getActiveSession()).toBeNull();
  });

  it("recordTradeExecuted increments counter", async () => {
    const { startSession, recordTradeExecuted, getActiveSession, endSession } = await import("../lib/session_manager");
    await startSession("paper");
    recordTradeExecuted();
    recordTradeExecuted();
    recordTradeExecuted();
    expect(getActiveSession()!.trades_executed).toBe(3);
    await endSession("test_done");
  });

  it("recordSignalGenerated increments counter", async () => {
    const { startSession, recordSignalGenerated, getActiveSession, endSession } = await import("../lib/session_manager");
    await startSession("paper");
    recordSignalGenerated();
    recordSignalGenerated();
    expect(getActiveSession()!.signals_generated).toBe(2);
    await endSession("test_done");
  });
});

describe("Audit Logger", () => {
  it("logAuditEvent persists to DB", async () => {
    const { logAuditEvent } = await import("../lib/audit_logger");
    const { db, auditEventsTable } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");

    await logAuditEvent({
      event_type: "trade_executed",
      decision_state: "executed",
      instrument: "BTCUSD",
      actor: "test",
      payload: { direction: "long", quantity: 0.5 },
    });

    const rows = await db
      .select()
      .from(auditEventsTable)
      .orderBy(desc(auditEventsTable.id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0].event_type).toBe("trade_executed");
    expect(rows[0].instrument).toBe("BTCUSD");
    expect(rows[0].actor).toBe("test");
    const payload = JSON.parse(rows[0].payload_json!);
    expect(payload.direction).toBe("long");
  });

  it("logBreakerEvent persists to DB", async () => {
    const { logBreakerEvent } = await import("../lib/audit_logger");
    const { db, breakerEventsTable } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");

    await logBreakerEvent({
      level: "THROTTLE",
      previous_level: "WARNING",
      trigger: "pnl",
      daily_pnl: -187.5,
      consecutive_losses: 4,
      position_size_multiplier: 0.5,
    });

    const rows = await db
      .select()
      .from(breakerEventsTable)
      .orderBy(desc(breakerEventsTable.id))
      .limit(1);

    expect(rows).toHaveLength(1);
    expect(rows[0].level).toBe("THROTTLE");
    expect(rows[0].trigger).toBe("pnl");
    expect(parseFloat(rows[0].daily_pnl!)).toBeCloseTo(-187.5);
  });

  it("auditSignalGenerated convenience function works", async () => {
    const { auditSignalGenerated } = await import("../lib/audit_logger");
    const { db, auditEventsTable } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");

    await auditSignalGenerated("ETHUSD", "sweep_reclaim", 0.85, {
      structure: 0.9, orderflow: 0.8, recall: 0.75,
    });

    const rows = await db
      .select()
      .from(auditEventsTable)
      .orderBy(desc(auditEventsTable.id))
      .limit(1);

    expect(rows[0].event_type).toBe("signal_generated");
    expect(rows[0].decision_state).toBe("accepted");
    expect(rows[0].instrument).toBe("ETHUSD");
  });
});
