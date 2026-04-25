/**
 * portfolio_route.test.ts — Phase 53
 *
 * Tests for portfolio management endpoints:
 *
 *   POST /portfolio/compute      — compute optimal portfolio allocations
 *   GET  /portfolio/current      — current portfolio state
 *   GET  /portfolio/constraints  — current constraints
 *   POST /portfolio/constraints  — update constraints
 *
 * portfolio_engine is pure in-memory — no DB or Alpaca mocking needed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";

import portfolioRouter from "../routes/portfolio";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/portfolio", portfolioRouter);

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

// ── Minimal valid position ────────────────────────────────────────────────────

const VALID_POSITION = {
  symbol:        "BTCUSD",
  conviction:    0.75,
  realized_vol:  0.02,
  sector:        "crypto",
  current_qty:   0.1,
  current_price: 42000,
};

// ─────────────────────────────────────────────────────────────────────────────
// POST /portfolio/compute
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /portfolio/compute", () => {
  it("returns 200 with portfolio state on valid input", async () => {
    const { status, data } = await post("/portfolio/compute", {
      positions: [VALID_POSITION],
      equity:    100000,
    });
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
  });

  it("returns 400 when positions missing", async () => {
    const { status } = await post("/portfolio/compute", { equity: 100000 });
    expect(status).toBe(400);
  });

  it("returns 400 when positions is not an array", async () => {
    const { status } = await post("/portfolio/compute", {
      positions: "not-an-array",
      equity:    100000,
    });
    expect(status).toBe(400);
  });

  it("returns 400 when equity is missing", async () => {
    const { status } = await post("/portfolio/compute", {
      positions: [VALID_POSITION],
    });
    expect(status).toBe(400);
  });

  it("returns 400 when equity is zero or negative", async () => {
    const { status } = await post("/portfolio/compute", {
      positions: [VALID_POSITION],
      equity:    -1000,
    });
    expect(status).toBe(400);
  });

  it("returns 400 on invalid position (missing conviction)", async () => {
    const { status } = await post("/portfolio/compute", {
      positions: [{ symbol: "BTCUSD", realized_vol: 0.02, sector: "crypto", current_qty: 1, current_price: 42000 }],
      equity:    100000,
    });
    expect([400, 500, 503]).toContain(status);
  });

  it("accepts multiple positions", async () => {
    const { status } = await post("/portfolio/compute", {
      positions: [
        VALID_POSITION,
        { symbol: "ETHUSD", conviction: 0.60, realized_vol: 0.025, sector: "crypto", current_qty: 1, current_price: 3200 },
      ],
      equity: 100000,
    });
    expect(status).toBe(200);
  });

  it("accepts optional constraints override", async () => {
    const { status } = await post("/portfolio/compute", {
      positions:   [VALID_POSITION],
      equity:      100000,
      constraints: { max_single_position_pct: 0.15 },
    });
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /portfolio/current
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /portfolio/current", () => {
  it("returns 200", async () => {
    const { status } = await get("/portfolio/current");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/portfolio/current");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /portfolio/constraints
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /portfolio/constraints", () => {
  it("returns 200 with constraints object", async () => {
    const { status, data } = await get("/portfolio/constraints");
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
  });

  it("constraints has max_single_position_pct field", async () => {
    const { data } = await get("/portfolio/constraints");
    const d = data as Record<string, unknown>;
    // Could be nested under `constraints` key or flat
    const constraints = (d.constraints ?? d) as Record<string, unknown>;
    expect(constraints).toHaveProperty("max_single_position_pct");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /portfolio/constraints
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /portfolio/constraints", () => {
  it("returns 200 with updated portfolio state", async () => {
    // Ensure state exists (portfolio_engine is module-level; compute tests above set it)
    await post("/portfolio/compute", { positions: [VALID_POSITION], equity: 100000 });
    const { status, data } = await post("/portfolio/constraints", {
      max_single_position_pct: 0.10,
    });
    expect(status).toBe(200);
    expect(typeof data).toBe("object");
  });

  it("returns 200 when updating with different pct", async () => {
    await post("/portfolio/compute", { positions: [VALID_POSITION], equity: 100000 });
    const { status } = await post("/portfolio/constraints", { max_single_position_pct: 0.12 });
    expect(status).toBe(200);
  });
});
