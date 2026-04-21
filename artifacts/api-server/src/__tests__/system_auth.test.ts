/**
 * system_auth.test.ts — Phase 34
 *
 * Integration tests verifying that critical system mutation endpoints
 * are protected by the operator token guard.
 *
 * Covered endpoints (all require Authorization: Bearer <operator-token>):
 *   POST /system/kill-switch
 *   POST /system/risk/reset
 *   PUT  /system/risk
 *   POST /system/retrain
 *   POST /system/recall/refresh
 *
 * Strategy: spin up a real Express app with the system router mounted
 * and a known GODSVIEW_OPERATOR_TOKEN, then verify:
 *   1. No token → 401
 *   2. Wrong token → 403
 *   3. Valid token → 200 (or non-4xx)
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express, { type Express } from "express";
import http from "http";
import net from "net";

// ── Set the operator token before importing routes ────────────────────────────
const TEST_TOKEN = "test-operator-token-abc123";
process.env.GODSVIEW_OPERATOR_TOKEN = TEST_TOKEN;

// ── Minimal mocks for heavy dependencies ─────────────────────────────────────
vi.mock("../lib/brain_bridge", () => ({
  runBrainCycle: vi.fn().mockResolvedValue({ ok: true, command: "", stderr: "", snapshot: {} }),
  readJsonArtifact: vi.fn().mockResolvedValue({ exists: false, data: null, path: "", error: null }),
}));

vi.mock("../lib/ml_model", () => ({
  getModelDiagnostics: vi.fn().mockReturnValue({}),
  getModelStatus: vi.fn().mockReturnValue({ trained: false }),
  retrainModel: vi.fn().mockResolvedValue({ success: true, message: "retrained" }),
  trainModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/alpaca", () => ({
  getTypedPositions: vi.fn().mockResolvedValue([]),
  getAccount: vi.fn().mockResolvedValue(null),
  hasValidTradingKey: false,
  isBrokerKey: false,
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }) }),
    execute: vi.fn().mockResolvedValue(undefined),
  },
  accuracyResultsTable: {},
  auditEventsTable: { event_type: "event_type", decision_state: "decision_state", symbol: "symbol", created_at: "created_at", instrument: "instrument" },
  signalsTable: {},
  tradesTable: {},
}));

vi.mock("@workspace/strategy-core", () => ({
  resolveSystemMode: vi.fn().mockReturnValue("paper"),
  canWriteOrders: vi.fn().mockReturnValue(false),
  isLiveMode: vi.fn().mockReturnValue(false),
}));

vi.mock("@workspace/common-types", () => ({
  StockBrainStateSchema: { safeParse: vi.fn().mockReturnValue({ success: false }) },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

async function makeRequest(
  _server: http.Server | null,
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    if (!app) {
      reject(new Error("Express app is not initialized"));
      return;
    }
    const bodyStr = options.body ? JSON.stringify(options.body) : undefined;
    const socket = new net.Socket({ readable: true, writable: true });
    const req = new http.IncomingMessage(socket);

    const normalizedHeaders = Object.fromEntries(
      Object.entries({
        "content-type": "application/json",
        ...(options.headers ?? {}),
      }).map(([k, v]) => [k.toLowerCase(), v]),
    );
    if (bodyStr) {
      normalizedHeaders["content-length"] = Buffer.byteLength(bodyStr).toString();
    }

    req.method = method;
    req.url = path;
    req.headers = normalizedHeaders;
    if (bodyStr) {
      req.push(bodyStr);
    }
    req.push(null);

    const res = new http.ServerResponse(req);
    let data = "";
    const origWrite = res.write.bind(res);
    const origEnd = res.end.bind(res);
    res.write = ((chunk: unknown, encoding?: BufferEncoding | ((err?: Error) => void), cb?: (err?: Error) => void) => {
      if (chunk) {
        data += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      }
      return origWrite(chunk as any, encoding as any, cb as any);
    }) as typeof res.write;
    res.end = ((chunk?: unknown, encoding?: BufferEncoding | (() => void), cb?: () => void) => {
      if (chunk) {
        data += Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
      }
      const ended = origEnd(chunk as any, encoding as any, cb as any);
      try {
        resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
      } catch {
        resolve({ status: res.statusCode ?? 0, body: data });
      }
      return ended;
    }) as typeof res.end;

    app.handle(req, res, reject);
  });
}

// ── Test setup ────────────────────────────────────────────────────────────────

let app: Express;
let server: http.Server | null = null;

beforeAll(async () => {
  app = express();
  app.use(express.json());

  // Dynamically import the system router after mocks are set up
  const { default: systemRouter } = await import("../routes/system");
  app.use("/api", systemRouter);
});

afterAll(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/system/kill-switch
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/system/kill-switch — auth guard", () => {
  it("returns 401 when no token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/kill-switch", {
      body: { active: false },
    });
    expect(result.status).toBe(401);
  });

  it("returns 403 when wrong token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/kill-switch", {
      headers: authHeader("wrong-token"),
      body: { active: false },
    });
    expect(result.status).toBe(403);
  });

  it("returns 200 with valid token", async () => {
    const result = await makeRequest(server, "POST", "/api/system/kill-switch", {
      headers: authHeader(TEST_TOKEN),
      body: { active: false },
    });
    expect(result.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/system/risk/reset
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/system/risk/reset — auth guard", () => {
  it("returns 401 when no token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/risk/reset");
    expect(result.status).toBe(401);
  });

  it("returns 403 when wrong token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/risk/reset", {
      headers: authHeader("bad-token"),
    });
    expect(result.status).toBe(403);
  });

  it("returns 200 with valid token", async () => {
    const result = await makeRequest(server, "POST", "/api/system/risk/reset", {
      headers: authHeader(TEST_TOKEN),
    });
    expect(result.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUT /api/system/risk
// ═════════════════════════════════════════════════════════════════════════════

describe("PUT /api/system/risk — auth guard", () => {
  it("returns 401 when no token provided", async () => {
    const result = await makeRequest(server, "PUT", "/api/system/risk", {
      body: { maxDailyLossUsd: 100 },
    });
    expect(result.status).toBe(401);
  });

  it("returns 403 when wrong token provided", async () => {
    const result = await makeRequest(server, "PUT", "/api/system/risk", {
      headers: authHeader("wrong"),
      body: { maxDailyLossUsd: 100 },
    });
    expect(result.status).toBe(403);
  });

  it("returns 200 with valid token", async () => {
    const result = await makeRequest(server, "PUT", "/api/system/risk", {
      headers: authHeader(TEST_TOKEN),
      body: { maxDailyLossUsd: 200 },
    });
    expect(result.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/system/retrain
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/system/retrain — auth guard", () => {
  it("returns 401 when no token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/retrain");
    expect(result.status).toBe(401);
  });

  it("returns 403 when wrong token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/retrain", {
      headers: authHeader("wrong-token"),
    });
    expect(result.status).toBe(403);
  });

  it("returns 200 with valid token", async () => {
    const result = await makeRequest(server, "POST", "/api/system/retrain", {
      headers: authHeader(TEST_TOKEN),
    });
    expect(result.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// POST /api/system/recall/refresh
// ═════════════════════════════════════════════════════════════════════════════

describe("POST /api/system/recall/refresh — auth guard", () => {
  it("returns 401 when no token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/recall/refresh", {
      body: { symbol: "BTCUSD" },
    });
    expect(result.status).toBe(401);
  });

  it("returns 403 when wrong token provided", async () => {
    const result = await makeRequest(server, "POST", "/api/system/recall/refresh", {
      headers: authHeader("invalid"),
      body: { symbol: "BTCUSD" },
    });
    expect(result.status).toBe(403);
  });

  it("returns 2xx with valid token (recall may fail but auth passes)", async () => {
    const result = await makeRequest(server, "POST", "/api/system/recall/refresh", {
      headers: authHeader(TEST_TOKEN),
      body: { symbol: "BTCUSD", with_replay: false },
    });
    // Auth passes — result may be 200 or 502 (recall mock), but not 401/403
    expect(result.status).not.toBe(401);
    expect(result.status).not.toBe(403);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// X-Operator-Token header variant
// ═════════════════════════════════════════════════════════════════════════════

describe("X-Operator-Token header support", () => {
  it("accepts valid token via X-Operator-Token header", async () => {
    const result = await makeRequest(server, "POST", "/api/system/kill-switch", {
      headers: { "X-Operator-Token": TEST_TOKEN },
      body: { active: false },
    });
    expect(result.status).toBe(200);
  });

  it("rejects invalid token via X-Operator-Token header", async () => {
    const result = await makeRequest(server, "POST", "/api/system/kill-switch", {
      headers: { "X-Operator-Token": "not-valid" },
      body: { active: false },
    });
    expect(result.status).toBe(403);
  });
});
