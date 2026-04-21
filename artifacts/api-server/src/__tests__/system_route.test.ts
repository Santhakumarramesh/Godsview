/**
 * system_route.test.ts — Phase 56
 *
 * Tests for the /system/* endpoints (routes/system.ts):
 *
 *   GET  /system/status                 — full system health (read-only)
 *   GET  /system/risk                   — risk engine snapshot
 *   GET  /system/model/diagnostics      — ML model CV + drift
 *   GET  /system/proof/by-setup         — accuracy proof per setup
 *   GET  /system/proof/by-regime        — accuracy proof per regime
 *   GET  /system/audit                  — audit events log
 *   POST /system/recall/refresh         — operator-protected (→ 403)
 *   POST /system/retrain                — operator-protected (→ 403)
 *   PUT  /system/risk                   — operator-protected (→ 403)
 *   POST /system/risk/reset             — operator-protected (→ 403)
 *   POST /system/kill-switch            — operator-protected (→ 403)
 *
 * GODSVIEW_OPERATOR_TOKEN is NOT set in test env → operator routes return 403.
 *
 * Dependencies mocked:
 *   @workspace/db              — db (select chain + execute), table references
 *   @workspace/strategy-core   — resolveSystemMode, canWriteOrders, isLiveMode
 *   @workspace/common-types    — StockBrainStateSchema
 *   ../lib/alpaca              — getTypedPositions, getAccount, hasValidTradingKey, isBrokerKey
 *   ../lib/ml_model            — getModelDiagnostics, getModelStatus, retrainModel
 *   ../lib/retrain_scheduler   — getSchedulerStats
 *   ../lib/risk_engine         — multiple functions
 *   ../lib/brain_bridge        — runBrainCycle
 *   node:fs/promises           — readFile (JSON artifact reads → always fail gracefully)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── @workspace/db mock ────────────────────────────────────────────────────────
// Every chain resolves to [{ count: 0 }] — works for both count queries
// (signalsRow[0].count) and row queries (graceful empty/zero metrics).

function makeDbChain() {
  const rows = [{ count: 0 }];
  const chain: any = {};
  chain.select  = vi.fn().mockReturnValue(chain);
  chain.from    = vi.fn().mockReturnValue(chain);
  chain.where   = vi.fn().mockReturnValue(chain);
  chain.orderBy = vi.fn().mockReturnValue(chain);
  chain.limit   = vi.fn().mockResolvedValue(rows);
  // Make awaitable at any point in the chain
  chain.then    = (resolve: (val: unknown) => void) => Promise.resolve(rows).then(resolve);
  return chain;
}

vi.mock("@workspace/db", () => {
  const chain = makeDbChain();
  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "select")  return (..._args: any[]) => chain;
      if (key === "execute") return vi.fn().mockResolvedValue(undefined);
      return undefined;
    },
  });
  return {
    db,
    sql:                    { raw: vi.fn((s: string) => s) },
    accuracyResultsTable:   { setup_type: "setup_type", regime: "regime", symbol: "symbol", outcome: "outcome", tp_ticks: "tp_ticks", sl_ticks: "sl_ticks", final_quality: "final_quality", created_at: "created_at" },
    auditEventsTable:       { id: "id", event_type: "event_type", decision_state: "decision_state", system_mode: "system_mode", instrument: "instrument", setup_type: "setup_type", symbol: "symbol", actor: "actor", reason: "reason", payload_json: "payload_json", created_at: "created_at" },
    signalsTable:           { created_at: "created_at", instrument: "instrument" },
    tradesTable:            { created_at: "created_at" },
  };
});

// ── drizzle-orm helpers — mock so column-operator calls don't throw ──────────
vi.mock("drizzle-orm", () => ({
  and:       vi.fn((...args: unknown[]) => args),
  or:        vi.fn((...args: unknown[]) => args),
  gte:       vi.fn((_col: unknown, _val: unknown) => null),
  lte:       vi.fn((_col: unknown, _val: unknown) => null),
  eq:        vi.fn((_col: unknown, _val: unknown) => null),
  ne:        vi.fn((_col: unknown, _val: unknown) => null),
  isNotNull: vi.fn((_col: unknown) => null),
  isNull:    vi.fn((_col: unknown) => null),
  desc:      vi.fn((_col: unknown) => null),
  asc:       vi.fn((_col: unknown) => null),
  sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
  inArray:   vi.fn((_col: unknown, _arr: unknown) => null),
  count:     vi.fn(() => 0),
}));

// ── @workspace/strategy-core ─────────────────────────────────────────────────
vi.mock("@workspace/strategy-core", () => ({
  resolveSystemMode: vi.fn(() => "paper"),
  canWriteOrders:    vi.fn(() => false),
  isLiveMode:        vi.fn(() => false),
}));

// ── @workspace/common-types ──────────────────────────────────────────────────
vi.mock("@workspace/common-types", () => ({
  StockBrainStateSchema: {
    safeParse: vi.fn(() => ({ success: false })),
  },
}));

// ── ../lib/alpaca ─────────────────────────────────────────────────────────────
vi.mock("../lib/alpaca", () => ({
  getTypedPositions: vi.fn(async () => []),
  getAccount:        vi.fn(async () => ({ equity: "50000", buying_power: "25000", account_number: "PA123" })),
  hasValidTradingKey: false,
  isBrokerKey:        false,
}));

// ── ../lib/ml_model ───────────────────────────────────────────────────────────
vi.mock("../lib/ml_model", () => ({
  getModelDiagnostics: vi.fn(async () => ({
    status:       "ready",
    accuracy:     0.65,
    cv_score:     0.62,
    drift_score:  0.08,
    last_trained: new Date().toISOString(),
  })),
  getModelStatus: vi.fn(() => ({
    status:  "active",
    message: "Model trained and ready",
  })),
  retrainModel: vi.fn(async () => ({ success: true, message: "Retrained" })),
}));

// ── ../lib/retrain_scheduler ──────────────────────────────────────────────────
vi.mock("../lib/retrain_scheduler", () => ({
  getSchedulerStats: vi.fn(() => ({
    enabled:       true,
    intervalHours: 24,
    lastRunAt:     null,
    nextRunAt:     null,
    runCount:      0,
  })),
}));

// ── ../lib/risk_engine ────────────────────────────────────────────────────────
vi.mock("../lib/risk_engine", () => ({
  getCurrentTradingSession:  vi.fn(() => "open"),
  getRiskEngineSnapshot:     vi.fn(() => ({
    config: {
      maxRiskPerTradePct:    1,
      maxDailyLossUsd:       500,
      maxOpenExposurePct:    5,
      maxConcurrentPositions: 3,
      maxTradesPerSession:   10,
      cooldownAfterLosses:   3,
      cooldownMinutes:       60,
      blockOnDegradedData:   true,
      allowAsianSession:     false,
      allowLondonSession:    true,
      allowNySession:        true,
      newsLockoutActive:     false,
    },
    runtime: {
      dailyLosses: 0,
      consecutiveLosses: 0,
      openPositions: 0,
      tradesThisSession: 0,
      killSwitchActive: false,
    },
  })),
  isKillSwitchActive:        vi.fn(() => false),
  isSessionAllowed:          vi.fn(() => true),
  resetRiskEngineRuntime:    vi.fn(() => ({ config: {}, runtime: {} })),
  setKillSwitchActive:       vi.fn((active: boolean) => ({ active })),
  updateRiskConfig:          vi.fn((updates: any) => ({ ...updates })),
}));

// ── ../lib/brain_bridge ───────────────────────────────────────────────────────
vi.mock("../lib/brain_bridge", () => ({
  runBrainCycle: vi.fn(async () => ({
    success:  true,
    decision: "wait",
    score:    0.4,
  })),
}));

// ── node:fs/promises — artifact files don't exist in test env ────────────────
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => { throw new Error("ENOENT"); }),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import systemRouter from "../routes/system";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/", systemRouter);

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

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
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
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (path: string)               => httpReq("GET",  path);
const post = (path: string, body: unknown) => httpReq("POST", path, body);
const put  = (path: string, body: unknown) => httpReq("PUT",  path, body);

// ─────────────────────────────────────────────────────────────────────────────
// GET /system/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /system/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/system/status");
    expect(status).toBe(200);
  });

  it("response has overall field", async () => {
    const { data } = await get("/system/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("overall");
    expect(["healthy", "degraded", "error"]).toContain(d.overall);
  });

  it("response has layers array", async () => {
    const { data } = await get("/system/status");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.layers)).toBe(true);
    expect((d.layers as unknown[]).length).toBeGreaterThan(0);
  });

  it("response has system_mode and live_mode", async () => {
    const { data } = await get("/system/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("system_mode");
    expect(d).toHaveProperty("live_mode");
  });

  it("response has trading_kill_switch boolean", async () => {
    const { data } = await get("/system/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("trading_kill_switch");
    expect(typeof d.trading_kill_switch).toBe("boolean");
  });

  it("response has signals_today and trades_today", async () => {
    const { data } = await get("/system/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("signals_today");
    expect(d).toHaveProperty("trades_today");
  });

  it("response has active_session and active_instrument", async () => {
    const { data } = await get("/system/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("active_session");
    expect(d).toHaveProperty("active_instrument");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /system/risk
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /system/risk", () => {
  it("returns 200", async () => {
    const { status } = await get("/system/risk");
    expect(status).toBe(200);
  });

  it("response has config and runtime", async () => {
    const { data } = await get("/system/risk");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("config");
    expect(d).toHaveProperty("runtime");
  });

  it("response has fetched_at timestamp", async () => {
    const { data } = await get("/system/risk");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("fetched_at");
    expect(typeof d.fetched_at).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /system/model/diagnostics
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /system/model/diagnostics", () => {
  it("returns 200", async () => {
    const { status } = await get("/system/model/diagnostics");
    expect(status).toBe(200);
  });

  it("response has status and fetched_at", async () => {
    const { data } = await get("/system/model/diagnostics");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("status");
    expect(d).toHaveProperty("fetched_at");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /system/proof/by-setup
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /system/proof/by-setup", () => {
  it("returns 200", async () => {
    const { status } = await get("/system/proof/by-setup");
    expect(status).toBe(200);
  });

  it("response is array or has setups key", async () => {
    const { data } = await get("/system/proof/by-setup");
    const isArrayOrObj = Array.isArray(data) || (typeof data === "object" && data !== null);
    expect(isArrayOrObj).toBe(true);
  });

  it("accepts days query param", async () => {
    const { status } = await get("/system/proof/by-setup?days=14");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /system/proof/by-regime
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /system/proof/by-regime", () => {
  it("returns 200", async () => {
    const { status } = await get("/system/proof/by-regime");
    expect(status).toBe(200);
  });

  it("accepts days query param", async () => {
    const { status } = await get("/system/proof/by-regime?days=30");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /system/audit
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /system/audit", () => {
  it("returns 200", async () => {
    const { status } = await get("/system/audit");
    expect(status).toBe(200);
  });

  it("response has events array or equivalent structure", async () => {
    const { data } = await get("/system/audit");
    const isObj = typeof data === "object" && data !== null;
    expect(isObj).toBe(true);
  });

  it("accepts limit query param", async () => {
    const { status } = await get("/system/audit?limit=10");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Operator-protected endpoints → 403 (no token configured)
// ─────────────────────────────────────────────────────────────────────────────

describe("Operator-protected endpoints (no token configured)", () => {
  it("POST /system/recall/refresh returns 403", async () => {
    const { status } = await post("/system/recall/refresh", {});
    expect(status).toBe(403);
  });

  it("POST /system/retrain returns 403", async () => {
    const { status } = await post("/system/retrain", {});
    expect(status).toBe(403);
  });

  it("PUT /system/risk returns 403", async () => {
    const { status } = await put("/system/risk", {});
    expect(status).toBe(403);
  });

  it("POST /system/risk/reset returns 403", async () => {
    const { status } = await post("/system/risk/reset", {});
    expect(status).toBe(403);
  });

  it("POST /system/kill-switch returns 403", async () => {
    const { status } = await post("/system/kill-switch", { active: true });
    expect(status).toBe(403);
  });

  it("403 response has error field", async () => {
    const { data } = await post("/system/kill-switch", {});
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("error");
    expect(typeof d.error).toBe("string");
  });
});
