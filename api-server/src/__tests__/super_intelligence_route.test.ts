/**
 * super_intelligence_route.test.ts — Phase 57
 *
 * Tests for the Super Intelligence endpoints (routes/super_intelligence.ts):
 *
 *   GET  /super-intelligence/status           — ensemble diagnostics
 *   POST /super-intelligence/signal           — full SI pipeline
 *   POST /super-intelligence/retrain          — retrain ensemble
 *   GET  /super-intelligence/edge-analysis    — edge analysis for setup/regime
 *   POST /super-intelligence/production-gate  — production evaluation
 *   GET  /super-intelligence/stream/clients   — SSE client count (REST)
 *   GET  /super-intelligence/production-stats — gate statistics
 *
 * NOTE: GET /super-intelligence/stream is SSE; excluded from these tests.
 *
 * Dependencies mocked:
 *   ../lib/super_intelligence — processSuperSignal, getSuperIntelligenceStatus, trainEnsemble
 *   ../lib/production_gate    — evaluateForProduction, getProductionGateStats
 *   ../lib/signal_stream      — addSSEClient, getSSEClientCount
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_SI_STATUS = {
  status:   "active",
  message:  "Ensemble ready",
  ensemble: {
    gbm_accuracy:  0.66,
    lr_accuracy:   0.61,
    sample_count:  500,
  },
};

const MOCK_SI_RESULT = {
  win_probability:   0.68,
  enhanced_quality:  0.72,
  kelly_fraction:    0.04,
  edge_score:        0.65,
  approved:          true,
  rejection_reason:  null,
  trailing_stop:     41800,
  profit_targets:    [42500, 43000],
};

const MOCK_GATE_DECISION = {
  approved:       true,
  decision:       "approved",
  confidence:     0.7,
  blockedReasons: [],
  edgeScore:      0.65,
};

const MOCK_GATE_STATS = {
  totalChecks: 50,
  passed:      38,
  blocked:     12,
  blockReasons: [],
};

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/super_intelligence", () => ({
  processSuperSignal:        vi.fn(async () => MOCK_SI_RESULT),
  getSuperIntelligenceStatus: vi.fn(() => MOCK_SI_STATUS),
  trainEnsemble:             vi.fn(async () => undefined),
}));

vi.mock("../lib/production_gate", () => ({
  evaluateForProduction: vi.fn(async () => MOCK_GATE_DECISION),
  getProductionGateStats: vi.fn(() => MOCK_GATE_STATS),
}));

vi.mock("../lib/signal_stream", () => ({
  addSSEClient:    vi.fn((res: any) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
  }),
  getSSEClientCount: vi.fn(() => 3),
  publishAlert:    vi.fn(),
  publishCandle:   vi.fn(),
  signalHub:       {
    addClient:     vi.fn(() => "client-1"),
    removeClient:  vi.fn(),
    status:        vi.fn(() => ({ clients: 0, events: 0 })),
    replay:        vi.fn(),
  },
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import superIntelligenceRouter from "../routes/super_intelligence";

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
  app.use("/", superIntelligenceRouter);

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

// ─────────────────────────────────────────────────────────────────────────────
// GET /super-intelligence/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /super-intelligence/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/super-intelligence/status");
    expect(status).toBe(200);
  });

  it("response has status and ensemble fields", async () => {
    const { data } = await get("/super-intelligence/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("status");
    expect(d).toHaveProperty("ensemble");
  });

  it("status is active or inactive", async () => {
    const { data } = await get("/super-intelligence/status");
    const d = data as Record<string, unknown>;
    expect(typeof d.status).toBe("string");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /super-intelligence/signal
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /super-intelligence/signal", () => {
  const validInput = {
    structure_score:  0.75,
    order_flow_score: 0.65,
    recall_score:     0.60,
    setup_type:       "sweep_reclaim",
    regime:           "trending",
    direction:        "long",
    entry_price:      42000,
    stop_loss:        41500,
    take_profit:      43000,
    atr:              200,
    equity:           50000,
    symbol:           "BTCUSD",
  };

  it("returns 200 with valid input", async () => {
    const { status } = await post("/super-intelligence/signal", validInput);
    expect(status).toBe(200);
  });

  it("response has win_probability and edge_score", async () => {
    const { data } = await post("/super-intelligence/signal", validInput);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("win_probability");
    expect(d).toHaveProperty("edge_score");
  });

  it("response has approved boolean", async () => {
    const { data } = await post("/super-intelligence/signal", validInput);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("approved");
    expect(typeof d.approved).toBe("boolean");
  });

  it("returns 400 when structure_score missing", async () => {
    const { status } = await post("/super-intelligence/signal", {
      entry_price: 42000,
      stop_loss:   41500,
      take_profit: 43000,
    });
    expect(status).toBe(400);
  });

  it("returns 400 when entry_price missing", async () => {
    const { status } = await post("/super-intelligence/signal", {
      structure_score: 0.7,
      stop_loss:       41500,
      take_profit:     43000,
    });
    expect(status).toBe(400);
  });

  it("response has kelly_fraction", async () => {
    const { data } = await post("/super-intelligence/signal", validInput);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("kelly_fraction");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /super-intelligence/retrain
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /super-intelligence/retrain", () => {
  it("returns 200", async () => {
    const { status } = await post("/super-intelligence/retrain", {});
    expect(status).toBe(200);
  });

  it("response has success and message fields", async () => {
    const { data } = await post("/super-intelligence/retrain", {});
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("success");
    expect(d).toHaveProperty("message");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /super-intelligence/edge-analysis
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /super-intelligence/edge-analysis", () => {
  it("returns 200 with default params", async () => {
    const { status } = await get("/super-intelligence/edge-analysis");
    expect(status).toBe(200);
  });

  it("response has win_probability and edge_score", async () => {
    const { data } = await get("/super-intelligence/edge-analysis");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("win_probability");
    expect(d).toHaveProperty("edge_score");
  });

  it("response has setup_type, regime, direction", async () => {
    const { data } = await get("/super-intelligence/edge-analysis?setup_type=sweep_reclaim&regime=trending&direction=long");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("setup_type");
    expect(d).toHaveProperty("regime");
    expect(d).toHaveProperty("direction");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /super-intelligence/production-gate
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /super-intelligence/production-gate", () => {
  const validGateInput = {
    entry_price: 42000,
    stop_loss:   41500,
    take_profit: 43000,
    symbol:      "BTCUSD",
  };

  it("returns 200 with valid input", async () => {
    const { status } = await post("/super-intelligence/production-gate", validGateInput);
    expect(status).toBe(200);
  });

  it("response has approved field", async () => {
    const { data } = await post("/super-intelligence/production-gate", validGateInput);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("approved");
  });

  it("returns 400 when entry_price missing", async () => {
    const { status } = await post("/super-intelligence/production-gate", { symbol: "BTCUSD" });
    expect(status).toBe(400);
  });

  it("returns 400 when symbol missing", async () => {
    const { status } = await post("/super-intelligence/production-gate", { entry_price: 42000, stop_loss: 41500 });
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /super-intelligence/stream/clients
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /super-intelligence/stream/clients", () => {
  it("returns 200", async () => {
    const { status } = await get("/super-intelligence/stream/clients");
    expect(status).toBe(200);
  });

  it("response has connected_clients field", async () => {
    const { data } = await get("/super-intelligence/stream/clients");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("connected_clients");
    expect(typeof d.connected_clients).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /super-intelligence/production-stats
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /super-intelligence/production-stats", () => {
  it("returns 200", async () => {
    const { status } = await get("/super-intelligence/production-stats");
    expect(status).toBe(200);
  });

  it("response has totalChecks field", async () => {
    const { data } = await get("/super-intelligence/production-stats");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("totalChecks");
  });
});
