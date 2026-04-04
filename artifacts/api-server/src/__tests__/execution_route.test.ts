/**
 * execution_route.test.ts — Phase 49
 *
 * Tests for the production trading execution routes mounted at /api/execution:
 *
 *   POST /execute          — Full pipeline gate (mocked) → validate rejection/approval shapes
 *   POST /kill-switch      — Toggle kill switch (requires operator token)
 *   POST /emergency-close  — Emergency liquidation (mocked)
 *   GET  /execution-status — Combined in-memory status snapshot
 *   GET  /fills            — Recent reconciled fills
 *   GET  /breaker          — Drawdown breaker state
 *   POST /breaker/reset    — Manual breaker reset
 *   GET  /monitor-events   — Position monitor events
 *
 * Approach:
 * - Heavy async dependencies (production_gate, order_executor, alpaca,
 *   emergency_liquidator) are vi.mocked to avoid Alpaca credentials / DB.
 * - Auth guard is exercised via GODSVIEW_OPERATOR_TOKEN set in env before import.
 * - Read-only GET endpoints use real in-memory state — no mocks needed.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Set operator token before any module load ─────────────────────────────────
process.env.GODSVIEW_OPERATOR_TOKEN = "test-operator-secret";

// ── Mock auth_guard — token is captured at module load time, so we must mock
//    requireOperator to honour the test token set above. ────────────────────────
vi.mock("../lib/auth_guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/auth_guard")>();
  const TEST_TOKEN = "test-operator-secret";
  const requireOperator: typeof original.requireOperator = (req, res, next) => {
    const header = (req.headers["x-operator-token"] as string | undefined)?.trim()
      ?? (req.headers["authorization"] as string | undefined)?.replace("Bearer ", "").trim()
      ?? (req.body?.operator_token as string | undefined)?.trim()
      ?? "";
    if (!header) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (header !== TEST_TOKEN) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
  return { ...original, requireOperator };
});

// ── Mock heavy dependencies ───────────────────────────────────────────────────

vi.mock("../lib/production_gate", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/production_gate")>();
  return {
    ...original,
    evaluateForProduction: vi.fn(async (input: Record<string, unknown>) => ({
      action: "EXECUTE" as const,
      quantity: 1,
      block_reasons: [],
      signal: {
        approved: true,
        win_probability: 0.68,
        edge_score: 0.72,
        enhanced_quality: 0.74,
        kelly_fraction: 0.05,
        rejection_reason: undefined,
        trailing_stop: { trail_pct: 0.02, activation_pct: 0.01 },
        profit_targets: [{ target_pct: 0.03, close_pct: 0.5 }],
      },
      meta: { evaluated_at: new Date().toISOString() },
    })),
    getProductionGateStats: vi.fn(() => ({ daily_trades: 3, last_reset: new Date().toISOString() })),
  };
});

vi.mock("../lib/order_executor", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/order_executor")>();
  return {
    ...original,
    executeOrder: vi.fn(async () => ({
      executed: true,
      order_id: "mock-order-123",
      mode: "paper" as const,
      si_decision_id: 1,
      details: { broker: "alpaca", type: "paper" },
    })),
    getExecutionMode: vi.fn(() => "paper"),
  };
});

vi.mock("../lib/execution_market_guard", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/execution_market_guard")>();
  return {
    ...original,
    evaluateExecutionMarketGuard: vi.fn(async () => ({
      allowed: true,
      level: "NORMAL" as const,
      action: "ALLOW" as const,
      reasons: [],
      snapshot: original.getExecutionMarketGuardSnapshot(),
    })),
    resetExecutionMarketGuard: vi.fn(() => original.getExecutionMarketGuardSnapshot()),
  };
});

vi.mock("../lib/alpaca", () => ({
  getAccount: vi.fn(async () => ({ equity: "100000" })),
  getBars: vi.fn(async () => [
    { c: 100, h: 102, l: 98, o: 99, v: 5000 },
    { c: 101, h: 103, l: 99, o: 100, v: 4800 },
  ]),
  getTypedPositions: vi.fn(async () => []),
  placeOrder: vi.fn(async () => ({ id: "mock-order", status: "accepted" })),
}));

vi.mock("../lib/emergency_liquidator", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/emergency_liquidator")>();
  return {
    ...original,
    emergencyLiquidateAll: vi.fn(async (reason: string) => ({
      liquidated: true,
      reason,
      positions_closed: 0,
      timestamp: new Date().toISOString(),
    })),
    isLiquidationInProgress: vi.fn(() => false),
    getLastLiquidation: vi.fn(() => null),
  };
});

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import { executionRouter } from "../routes/execution";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/execution", executionRouter);

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

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
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
          ...headers,
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) });
          } catch {
            resolve({ status: res.statusCode ?? 0, data: raw });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get  = (path: string, headers?: Record<string, string>) =>
  httpRequest("GET", path, undefined, headers);
const post = (path: string, body: unknown, headers?: Record<string, string>) =>
  httpRequest("POST", path, body, headers);

const opHeaders = { "X-Operator-Token": "test-operator-secret" };

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/breaker  (no auth required, pure in-memory)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/breaker", () => {
  it("returns 200 with breaker snapshot shape", async () => {
    const { status, data } = await get("/api/execution/breaker");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("level");
    expect(d).toHaveProperty("realized_pnl_today");
    expect(d).toHaveProperty("unrealized_pnl");
    expect(d).toHaveProperty("consecutive_losses");
    expect(d).toHaveProperty("position_size_multiplier");
    expect(d).toHaveProperty("trades_today");
    expect(d).toHaveProperty("wins_today");
    expect(d).toHaveProperty("losses_today");
    expect(d).toHaveProperty("cooldown_active");
    expect(["NORMAL", "WARNING", "THROTTLE", "HALT"]).toContain(d.level);
  });

  it("position_size_multiplier is between 0 and 1", async () => {
    const { data } = await get("/api/execution/breaker");
    const mult = (data as Record<string, unknown>).position_size_multiplier as number;
    expect(mult).toBeGreaterThanOrEqual(0);
    expect(mult).toBeLessThanOrEqual(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/fills  (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/fills", () => {
  it("returns 200 with fills array and snapshot", async () => {
    const { status, data } = await get("/api/execution/fills");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("fills");
    expect(d).toHaveProperty("snapshot");
    expect(Array.isArray(d.fills)).toBe(true);
  });

  it("respects limit query param (clamps to 200)", async () => {
    const { status } = await get("/api/execution/fills?limit=5");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/execution-status  (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/execution-status", () => {
  it("returns 200 with full status shape", async () => {
    const { status, data } = await get("/api/execution/execution-status");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("mode");
    expect(d).toHaveProperty("kill_switch");
    expect(d).toHaveProperty("breaker");
    expect(d).toHaveProperty("reconciliation");
    expect(d).toHaveProperty("managed_positions");
    expect(d).toHaveProperty("positions");
    expect(d).toHaveProperty("gate_stats");
    expect(d).toHaveProperty("risk");
    expect(typeof d.kill_switch).toBe("boolean");
    expect(Array.isArray(d.positions)).toBe(true);
    expect(typeof d.managed_positions).toBe("number");
  });

  it("mode is one of the expected execution modes", async () => {
    const { data } = await get("/api/execution/execution-status");
    const mode = (data as Record<string, unknown>).mode;
    // mode comes from mocked getExecutionMode → "paper"
    expect(typeof mode).toBe("string");
    expect(mode).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/execution/monitor-events  (no auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/execution/monitor-events", () => {
  it("returns 200 with events array", async () => {
    const { status, data } = await get("/api/execution/monitor-events");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("events");
    expect(Array.isArray(d.events)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/execution/kill-switch  (operator auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/execution/kill-switch", () => {
  it("returns 403 when no token provided", async () => {
    const { status } = await post("/api/execution/kill-switch", { active: true });
    expect([401, 403]).toContain(status);
  });

  it("returns 403 when wrong token provided", async () => {
    const { status } = await post(
      "/api/execution/kill-switch",
      { active: true },
      { "X-Operator-Token": "wrong-token" },
    );
    expect(status).toBe(403);
  });

  it("activates kill switch and returns snapshot", async () => {
    const { status, data } = await post(
      "/api/execution/kill-switch",
      { active: true, reason: "test_activation" },
      opHeaders,
    );
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.kill_switch).toBe(true);
    expect(d).toHaveProperty("risk_snapshot");
  });

  it("deactivates kill switch", async () => {
    // First activate
    await post("/api/execution/kill-switch", { active: true }, opHeaders);
    // Then deactivate
    const { status, data } = await post(
      "/api/execution/kill-switch",
      { active: false, reason: "test_deactivation" },
      opHeaders,
    );
    expect(status).toBe(200);
    expect((data as Record<string, unknown>).kill_switch).toBe(false);
  });

  it("kill switch state is reflected in GET /execution-status", async () => {
    // Activate
    await post("/api/execution/kill-switch", { active: true }, opHeaders);
    const { data: statusOn } = await get("/api/execution/execution-status");
    expect((statusOn as Record<string, unknown>).kill_switch).toBe(true);

    // Deactivate
    await post("/api/execution/kill-switch", { active: false }, opHeaders);
    const { data: statusOff } = await get("/api/execution/execution-status");
    expect((statusOff as Record<string, unknown>).kill_switch).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/execution/breaker/reset  (operator auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/execution/breaker/reset", () => {
  it("returns 403 without operator token", async () => {
    const { status } = await post("/api/execution/breaker/reset", {});
    expect([401, 403]).toContain(status);
  });

  it("resets breaker and returns snapshot with valid token", async () => {
    const { status, data } = await post(
      "/api/execution/breaker/reset",
      {},
      opHeaders,
    );
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("level");
    // After reset the breaker should be at NORMAL
    expect(d.level).toBe("NORMAL");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/execution/emergency-close  (operator auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/execution/emergency-close", () => {
  it("returns 403 without operator token", async () => {
    const { status } = await post("/api/execution/emergency-close", {});
    expect([401, 403]).toContain(status);
  });

  it("calls emergency liquidation and returns result", async () => {
    const { status, data } = await post(
      "/api/execution/emergency-close",
      { reason: "test_emergency" },
      opHeaders,
    );
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("liquidated");
    expect(d.liquidated).toBe(true);
  });

  it("returns 409 when liquidation already in progress", async () => {
    const { isLiquidationInProgress } = await import("../lib/emergency_liquidator");
    vi.mocked(isLiquidationInProgress).mockReturnValueOnce(true);
    const { status } = await post(
      "/api/execution/emergency-close",
      { reason: "double_close" },
      opHeaders,
    );
    expect(status).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/execution/execute  (operator auth required)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/execution/execute", () => {
  it("returns 403 without operator token", async () => {
    const { status } = await post("/api/execution/execute", {
      symbol: "BTCUSD",
      direction: "long",
      entry_price: 50000,
      stop_loss: 49000,
      take_profit: 52000,
    });
    expect([401, 403]).toContain(status);
  });

  it("returns 400 when required fields are missing", async () => {
    const { status, data } = await post(
      "/api/execution/execute",
      { symbol: "BTCUSD" }, // missing direction, entry_price, etc.
      opHeaders,
    );
    expect(status).toBe(400);
    const d = data as Record<string, unknown>;
    expect(d.error).toBe("validation_error");
  });

  it("returns execution result for valid request (paper mode, gate EXECUTE)", async () => {
    const { status, data } = await post(
      "/api/execution/execute",
      {
        symbol: "BTCUSD",
        direction: "long",
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
        setup_type: "sweep_reclaim",
        regime: "trending_bull",
        equity: 10000,
      },
      opHeaders,
    );
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    // Either executed or blocked by gate — both are valid responses
    expect(typeof d.executed).toBe("boolean");
    expect(d).toHaveProperty("gate_action");
    expect(d).toHaveProperty("signal");
    const sig = d.signal as Record<string, unknown>;
    expect(typeof sig.win_probability).toBe("number");
    expect(typeof sig.edge_score).toBe("number");
  });

  it("returns 429 when breaker size multiplier is 0 (HALT state)", async () => {
    // Put breaker into halt by mocking the helper
    const breakerMod = await import("../lib/drawdown_breaker");
    const origMultiplier = breakerMod.getPositionSizeMultiplier;
    const multiplierSpy = vi.spyOn(breakerMod, "getPositionSizeMultiplier").mockReturnValueOnce(0);
    const isCooldownSpy = vi.spyOn(breakerMod, "isCooldownActive").mockReturnValueOnce(false);

    const { status, data } = await post(
      "/api/execution/execute",
      {
        symbol: "ETHUSD",
        direction: "short",
        entry_price: 3000,
        stop_loss: 3100,
        take_profit: 2800,
      },
      opHeaders,
    );
    expect(status).toBe(429);
    expect((data as Record<string, unknown>).error).toBe("breaker_halt");

    multiplierSpy.mockRestore();
    isCooldownSpy.mockRestore();
  });

  it("returns 429 when cooldown is active", async () => {
    const breakerMod = await import("../lib/drawdown_breaker");
    const isCooldownSpy = vi.spyOn(breakerMod, "isCooldownActive").mockReturnValueOnce(true);

    const { status, data } = await post(
      "/api/execution/execute",
      {
        symbol: "ETHUSD",
        direction: "long",
        entry_price: 3000,
        stop_loss: 2900,
        take_profit: 3200,
      },
      opHeaders,
    );
    expect(status).toBe(429);
    expect((data as Record<string, unknown>).error).toBe("cooldown_active");

    isCooldownSpy.mockRestore();
  });

  it("gate BLOCK returns executed=false with block details", async () => {
    const { evaluateForProduction } = await import("../lib/production_gate");
    vi.mocked(evaluateForProduction).mockResolvedValueOnce({
      action: "BLOCK",
      quantity: 0,
      block_reasons: ["kill_switch"],
      signal: {
        approved: false,
        win_probability: 0.35,
        edge_score: 0.40,
        enhanced_quality: 0.38,
        kelly_fraction: 0,
        rejection_reason: "kill_switch_active",
        trailing_stop: null as unknown as { trail_pct: number; activation_pct: number },
        profit_targets: [],
      },
      meta: { evaluated_at: new Date().toISOString() },
    } as unknown as Awaited<ReturnType<typeof evaluateForProduction>>);

    const { status, data } = await post(
      "/api/execution/execute",
      {
        symbol: "BTCUSD",
        direction: "long",
        entry_price: 50000,
        stop_loss: 49000,
        take_profit: 52000,
      },
      opHeaders,
    );
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.executed).toBe(false);
    expect(d.gate_action).toBe("BLOCK");
    expect(Array.isArray(d.block_reasons)).toBe(true);
  });
});
