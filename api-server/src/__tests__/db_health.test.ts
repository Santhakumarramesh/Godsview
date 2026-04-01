import { describe, it, expect } from "vitest";

describe("Database Health & Schema", () => {
  it("checkDbHealth returns ok for PGlite", async () => {
    const { checkDbHealth } = await import("@workspace/db");
    const result = await checkDbHealth();
    expect(result.ok).toBe(true);
    expect(result.driver).toBe("pglite");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("db can insert and query audit_events", async () => {
    const { db, auditEventsTable } = await import("@workspace/db");
    const inserted = await db
      .insert(auditEventsTable)
      .values({
        event_type: "test_event",
        decision_state: "approved",
        system_mode: "paper",
        instrument: "BTCUSD",
        actor: "test",
        reason: "unit test",
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0].event_type).toBe("test_event");
    expect(inserted[0].actor).toBe("test");
    expect(inserted[0].id).toBeGreaterThan(0);
  });

  it("db can insert and query trading_sessions", async () => {
    const { db, tradingSessionsTable } = await import("@workspace/db");
    const sessionId = `test-${Date.now()}`;
    const inserted = await db
      .insert(tradingSessionsTable)
      .values({
        session_id: sessionId,
        system_mode: "paper",
        operator_id: "tester",
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0].session_id).toBe(sessionId);
    expect(inserted[0].system_mode).toBe("paper");
    expect(inserted[0].trades_executed).toBe(0);
  });

  it("db can insert and query breaker_events", async () => {
    const { db, breakerEventsTable } = await import("@workspace/db");
    const inserted = await db
      .insert(breakerEventsTable)
      .values({
        level: "WARNING",
        previous_level: "NORMAL",
        trigger: "pnl",
        daily_pnl: "-125.50",
        consecutive_losses: 3,
        position_size_multiplier: "1.0000",
      })
      .returning();

    expect(inserted).toHaveLength(1);
    expect(inserted[0].level).toBe("WARNING");
    expect(inserted[0].trigger).toBe("pnl");
  });

  it("closePool does not throw", async () => {
    const { closePool } = await import("@workspace/db");
    // PGlite pool.end is a no-op stub
    await expect(closePool()).resolves.not.toThrow();
  });
});
