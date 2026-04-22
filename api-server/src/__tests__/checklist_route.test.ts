/**
 * checklist_route.test.ts — Phase 53
 *
 * Tests for the pre-trade discipline gate endpoints:
 *
 *   GET  /checklist/template     — returns template structure
 *   POST /checklist/evaluate     — manual boolean evaluation
 *   POST /checklist/auto/:symbol — auto-evaluate using SMC + alpaca data
 *   GET  /checklist/:symbol      — retrieve cached result
 *
 * Alpaca is mocked (getBars). checklist_engine and smc_engine are in-memory.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock Alpaca ───────────────────────────────────────────────────────────────

vi.mock("../lib/alpaca", () => ({
  getBars: vi.fn(async () => [
    // Minimal OHLCV bars for SMC computation
    ...Array.from({ length: 100 }, (_, i) => ({
      t: new Date(Date.now() - (100 - i) * 60_000).toISOString(),
      o: 42000 + i * 10,
      h: 42100 + i * 10,
      l: 41900 + i * 10,
      c: 42050 + i * 10,
      v: 100 + i,
    })),
  ]),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import checklistRouter from "../routes/checklist";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/checklist", checklistRouter);

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
    const payload = body ? JSON.stringify(body) : undefined;
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

// ── Valid evaluate body ───────────────────────────────────────────────────────

const VALID_EVALUATE_BODY = {
  symbol:                  "BTCUSD",
  setup_type:              "sweep_reclaim",
  session:                 "london_ny_overlap",
  htf_bias_aligned:        true,
  liquidity_swept:         true,
  structure_shift:         true,
  displacement_confirmed:  true,
  entry_zone_touched:      true,
  rr_minimum_met:          true,
  session_valid:           true,
  no_news_lockout:         true,
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /checklist/template
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /checklist/template", () => {
  it("returns 200", async () => {
    const { status } = await get("/checklist/template");
    expect(status).toBe(200);
  });

  it("response has template array", async () => {
    const { data } = await get("/checklist/template");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("template");
    expect(Array.isArray(d.template)).toBe(true);
  });

  it("response has total_items count", async () => {
    const { data } = await get("/checklist/template");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("total_items");
    expect(typeof d.total_items).toBe("number");
    expect(Number(d.total_items)).toBeGreaterThan(0);
  });

  it("response has required_items count", async () => {
    const { data } = await get("/checklist/template");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("required_items");
    expect(typeof d.required_items).toBe("number");
  });

  it("total_items equals template array length", async () => {
    const { data } = await get("/checklist/template");
    const d = data as Record<string, unknown>;
    expect(d.total_items).toBe((d.template as unknown[]).length);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /checklist/evaluate
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /checklist/evaluate", () => {
  it("returns 200 on all-true evaluation", async () => {
    const { status, data } = await post("/checklist/evaluate", VALID_EVALUATE_BODY);
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("passed");
    expect(d).toHaveProperty("score");
  });

  it("passed=true when all booleans are true", async () => {
    const { data } = await post("/checklist/evaluate", VALID_EVALUATE_BODY);
    const d = data as Record<string, unknown>;
    expect(d.passed).toBe(true);
  });

  it("passed=false when critical items are false", async () => {
    const { data } = await post("/checklist/evaluate", {
      ...VALID_EVALUATE_BODY,
      htf_bias_aligned:       false,
      liquidity_swept:        false,
      displacement_confirmed: false,
    });
    const d = data as Record<string, unknown>;
    expect(d.passed).toBe(false);
  });

  it("returns 400 when symbol missing", async () => {
    const { status } = await post("/checklist/evaluate", {
      ...VALID_EVALUATE_BODY,
      symbol: undefined,
    });
    expect(status).toBe(400);
  });

  it("returns 400 when boolean field is missing", async () => {
    const { symbol, setup_type, session } = VALID_EVALUATE_BODY;
    const { status } = await post("/checklist/evaluate", {
      symbol, setup_type, session,
      // omit all booleans
    });
    expect(status).toBe(400);
  });

  it("score is a number between 0 and 1", async () => {
    const { data } = await post("/checklist/evaluate", VALID_EVALUATE_BODY);
    const d = data as Record<string, unknown>;
    expect(typeof d.score).toBe("number");
    expect(Number(d.score)).toBeGreaterThanOrEqual(0);
    expect(Number(d.score)).toBeLessThanOrEqual(1);
  });

  it("result has items array", async () => {
    const { data } = await post("/checklist/evaluate", VALID_EVALUATE_BODY);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("items");
    expect(Array.isArray(d.items)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /checklist/auto/:symbol
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /checklist/auto/:symbol", () => {
  it("returns 200 with checklist result", async () => {
    const { status, data } = await post("/checklist/auto/BTCUSD", {});
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("passed");
    expect(d).toHaveProperty("score");
  });

  it("returns cached result on second call", async () => {
    // First call populates cache
    await post("/checklist/auto/CACHEHIT", {});
    // Second call should return the same result (from cache)
    const { status } = await post("/checklist/auto/CACHEHIT", {});
    expect(status).toBe(200);
  });

  it("returns 400 when symbol is empty", async () => {
    // Express won't route to empty segment naturally, but edge case
    const { status } = await post("/checklist/auto/%20", {});
    expect([400, 404]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /checklist/:symbol
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /checklist/:symbol", () => {
  it("returns cached result for symbol that was evaluated", async () => {
    // Seed via POST /evaluate (which caches)
    await post("/checklist/evaluate", { ...VALID_EVALUATE_BODY, symbol: "CACHEMISS" });
    const { status, data } = await get("/checklist/CACHEMISS");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("passed");
  });

  it("returns 404 for symbol with no cached result", async () => {
    const { status } = await get("/checklist/NOCACHEDENTRY_XYZ");
    expect(status).toBe(404);
  });
});
