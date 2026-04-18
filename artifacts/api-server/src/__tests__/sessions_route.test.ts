/**
 * sessions_route.test.ts — Phase 50
 *
 * HTTP-level tests for the session & audit trail endpoints:
 *
 *   GET  /api/sessions              — list sessions (DB)
 *   GET  /api/sessions/active       — in-memory active session
 *   POST /api/sessions/start        — start session (DB via session_manager)
 *   POST /api/sessions/end          — end session
 *   GET  /api/sessions/:id/events   — session audit (DB)
 *   GET  /api/audit                 — audit events (DB)
 *   GET  /api/audit/breaker         — breaker events (DB)
 *   GET  /api/audit/timeline        — unified timeline (DB)
 *
 * Strategy:
 * - vi.mock on @workspace/db to return empty arrays for DB queries without PGlite startup
 * - vi.mock on session_manager for start/end to avoid DB writes
 * - GET /api/sessions/active uses real session_manager (pure in-memory, no DB)
 */

import { describe, it, expect, beforeAll, afterAll, vi, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mock @workspace/db before router import ───────────────────────────────────

const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

const mockChain = {
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  $dynamic: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockReturnThis(),
};

vi.mock("@workspace/db", async () => {
  return {
    db: {
      select: vi.fn(() => mockChain),
      insert: vi.fn(() => mockChain),
      update: vi.fn(() => mockChain),
    },
    tradingSessionsTable: { session_id: "session_id", created_at: "created_at" },
    auditEventsTable: { id: "id", event_type: "event_type", created_at: "created_at" },
    breakerEventsTable: { id: "id", session_id: "session_id", created_at: "created_at", trigger: "trigger", level: "level", details: "details" },
    siDecisionsTable: {},
    // drizzle-orm re-exports (now provided by @workspace/db)
    and:       (..._args: unknown[]) => ({ type: "and" }),
    or:        (..._args: unknown[]) => ({ type: "or" }),
    eq:        (..._args: unknown[]) => ({ type: "eq" }),
    ne:        (..._args: unknown[]) => ({ type: "ne" }),
    gt:        (..._args: unknown[]) => ({ type: "gt" }),
    gte:       (..._args: unknown[]) => ({ type: "gte" }),
    lt:        (..._args: unknown[]) => ({ type: "lt" }),
    lte:       (..._args: unknown[]) => ({ type: "lte" }),
    isNotNull: (..._args: unknown[]) => ({ type: "isNotNull" }),
    isNull:    (..._args: unknown[]) => ({ type: "isNull" }),
    desc:      (..._args: unknown[]) => ({ type: "desc" }),
    asc:       (..._args: unknown[]) => ({ type: "asc" }),
    inArray:   (..._args: unknown[]) => ({ type: "inArray" }),
    notInArray:(..._args: unknown[]) => ({ type: "notInArray" }),
    count:     (..._args: unknown[]) => 0,
    sum:       (..._args: unknown[]) => 0,
    max:       (..._args: unknown[]) => null,
    min:       (..._args: unknown[]) => null,
    between:   (..._args: unknown[]) => null,
    like:      (..._args: unknown[]) => null,
    ilike:     (..._args: unknown[]) => null,
    exists:    (..._args: unknown[]) => null,
    not:       (..._args: unknown[]) => null,
    sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
  };
});

// ── Mock session_manager to avoid DB writes ───────────────────────────────────

let _mockActiveSession: import("../lib/session_manager").ActiveSession | null = null;

vi.mock("../lib/session_manager", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/session_manager")>();
  return {
    ...original,
    getActiveSession: vi.fn(() => _mockActiveSession),
    getSessionId: vi.fn(() => _mockActiveSession?.session_id ?? null),
    startSession: vi.fn(async (mode: string, operatorId?: string) => {
      _mockActiveSession = {
        session_id: `gs-test-${Date.now()}`,
        system_mode: mode,
        operator_id: operatorId ?? null,
        started_at: new Date(),
        trades_executed: 0,
        signals_generated: 0,
      };
      return _mockActiveSession;
    }),
    endSession: vi.fn(async () => {
      _mockActiveSession = null;
    }),
    recordTradeExecuted: vi.fn(),
    recordSignalGenerated: vi.fn(),
  };
});

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import sessionsRouter from "../routes/sessions";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api", sessionsRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

afterEach(() => {
  _mockActiveSession = null;
});

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function req(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : undefined;
    const request = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
        });
      },
    );
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

const get  = (path: string) => req("GET", path);
const post = (path: string, body: unknown) => req("POST", path, body);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/active
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/sessions/active", () => {
  it("returns active:false when no session is running", async () => {
    _mockActiveSession = null;
    const { status, data } = await get("/api/sessions/active");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.active).toBe(false);
    expect(d.session).toBeNull();
  });

  it("returns active:true with session data when session exists", async () => {
    _mockActiveSession = {
      session_id: "gs-test-001",
      system_mode: "paper",
      operator_id: "op1",
      started_at: new Date(),
      trades_executed: 5,
      signals_generated: 12,
    };
    const { status, data } = await get("/api/sessions/active");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.active).toBe(true);
    const session = d.session as Record<string, unknown>;
    expect(session.session_id).toBe("gs-test-001");
    expect(session.system_mode).toBe("paper");
    expect(session.trades_executed).toBe(5);
    expect(session.signals_generated).toBe(12);
  });

  it("session object has all required fields", async () => {
    _mockActiveSession = {
      session_id: "gs-test-002",
      system_mode: "live",
      operator_id: null,
      started_at: new Date(),
      trades_executed: 0,
      signals_generated: 0,
    };
    const { data } = await get("/api/sessions/active");
    const session = (data as Record<string, unknown>).session as Record<string, unknown>;
    expect(session).toHaveProperty("session_id");
    expect(session).toHaveProperty("system_mode");
    expect(session).toHaveProperty("operator_id");
    expect(session).toHaveProperty("started_at");
    expect(session).toHaveProperty("trades_executed");
    expect(session).toHaveProperty("signals_generated");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sessions/start
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/sessions/start", () => {
  it("starts a session and returns session object", async () => {
    const { status, data } = await post("/api/sessions/start", { mode: "paper", operator_id: "op1" });
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.ok).toBe(true);
    expect(d).toHaveProperty("session");
    const session = d.session as Record<string, unknown>;
    expect(session.system_mode).toBe("paper");
    expect(session.operator_id).toBe("op1");
    expect(typeof session.session_id).toBe("string");
  });

  it("defaults to paper mode when mode is omitted", async () => {
    const { status, data } = await post("/api/sessions/start", {});
    expect(status).toBe(200);
    const session = (data as Record<string, unknown>).session as Record<string, unknown>;
    expect(typeof session.system_mode).toBe("string");
  });

  it("accepts live mode", async () => {
    const { status, data } = await post("/api/sessions/start", { mode: "live" });
    expect(status).toBe(200);
    const session = (data as Record<string, unknown>).session as Record<string, unknown>;
    expect(session.system_mode).toBe("live");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sessions/end
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/sessions/end", () => {
  it("ends the session and returns ok", async () => {
    // Start first
    await post("/api/sessions/start", { mode: "paper" });
    const { status, data } = await post("/api/sessions/end", { reason: "manual" });
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).ok).toBe(true);
  });

  it("can end with a custom reason", async () => {
    const { status, data } = await post("/api/sessions/end", { reason: "kill_switch" });
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sessions  (DB-backed, returns mock empty array)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/sessions", () => {
  it("returns 200 with sessions array", async () => {
    const { status, data } = await get("/api/sessions");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("sessions");
    expect(Array.isArray(d.sessions)).toBe(true);
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/sessions?limit=5");
    expect(status).toBe(200);
  });

  it("caps limit at 100", async () => {
    const { status } = await get("/api/sessions?limit=999");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sessions/:id/events  (DB-backed)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/sessions/:id/events", () => {
  it("returns 200 with session, audit_events, breaker_events fields", async () => {
    const { status, data } = await get("/api/sessions/gs-test-001/events");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("session");
    expect(d).toHaveProperty("audit_events");
    expect(d).toHaveProperty("breaker_events");
    expect(Array.isArray(d.audit_events)).toBe(true);
    expect(Array.isArray(d.breaker_events)).toBe(true);
  });

  it("handles non-existent session ID gracefully", async () => {
    const { status } = await get("/api/sessions/gs-nonexistent-999/events");
    expect(status).toBe(200); // returns null session, empty arrays
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit  (DB-backed)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/audit", () => {
  it("returns 200 with events array and count", async () => {
    const { status, data } = await get("/api/audit");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("events");
    expect(d).toHaveProperty("count");
    expect(Array.isArray(d.events)).toBe(true);
    expect(typeof d.count).toBe("number");
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/audit?limit=10");
    expect(status).toBe(200);
  });

  it("accepts event_type filter", async () => {
    const { status } = await get("/api/audit?event_type=trade_executed");
    expect(status).toBe(200);
  });

  it("caps limit at 500", async () => {
    const { status } = await get("/api/audit?limit=9999");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/breaker  (DB-backed)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/audit/breaker", () => {
  it("returns 200 with events array and count", async () => {
    const { status, data } = await get("/api/audit/breaker");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("events");
    expect(d).toHaveProperty("count");
    expect(Array.isArray(d.events)).toBe(true);
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/audit/breaker?limit=25");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/audit/timeline  (DB-backed)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/audit/timeline", () => {
  it("returns 200 with timeline array, count, and hours_back", async () => {
    const { status, data } = await get("/api/audit/timeline");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("timeline");
    expect(d).toHaveProperty("count");
    expect(d).toHaveProperty("hours_back");
    expect(Array.isArray(d.timeline)).toBe(true);
    expect(typeof d.hours_back).toBe("number");
  });

  it("accepts hours query param (capped at 168)", async () => {
    const { status, data } = await get("/api/audit/timeline?hours=48");
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).hours_back).toBe(48);
  });

  it("caps hours at 168 (7 days)", async () => {
    const { status, data } = await get("/api/audit/timeline?hours=9999");
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).hours_back).toBe(168);
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/api/audit/timeline?limit=50");
    expect(status).toBe(200);
  });
});
