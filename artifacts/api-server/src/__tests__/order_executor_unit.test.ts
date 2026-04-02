/**
 * order_executor_unit.test.ts — Phase 60
 *
 * Unit tests for lib/order_executor.ts:
 *
 *   getExecutionMode — returns { mode, canWrite, isLive } based on env
 *   executeOrder     — integration path (mocked Alpaca + DB)
 *
 * Dependencies mocked:
 *   @workspace/db              — db, siDecisionsTable
 *   @workspace/strategy-core   — canWriteOrders, isLiveMode, resolveSystemMode
 *   ../lib/alpaca              — placeOrder
 *   ../lib/alerts              — alertKillSwitch
 *   ../lib/logger              — logger
 *   drizzle-orm                — operators
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and:       vi.fn((...args: unknown[]) => args),
  eq:        vi.fn(() => null),
  desc:      vi.fn(() => null),
  sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
  count:     vi.fn(() => 0),
}));

vi.mock("@workspace/db", () => {
  const chain: any = {};
  chain.insert    = vi.fn().mockReturnValue(chain);
  chain.values    = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue([{ id: 1 }]);
  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "insert")  return (..._args: any[]) => chain;
      if (key === "execute") return vi.fn().mockResolvedValue(undefined);
      return undefined;
    },
  });
  return {
    db,
    siDecisionsTable: new Proxy({ tableName: "si_decisions" } as any, {
      get(t, p) { return t[p] ?? String(p); },
    }),
  };
});

vi.mock("@workspace/strategy-core", () => ({
  canWriteOrders:    vi.fn(() => true),
  isLiveMode:        vi.fn(() => false),
  resolveSystemMode: vi.fn(() => "paper"),
}));

vi.mock("../lib/alpaca", () => ({
  placeOrder: vi.fn(async () => ({
    id:     "mock-order-001",
    symbol: "BTCUSD",
    side:   "buy",
    status: "accepted",
  })),
}));

vi.mock("../lib/alerts", () => ({
  alertKillSwitch: vi.fn(),
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
import { getExecutionMode, executeOrder } from "../lib/order_executor";

// ─────────────────────────────────────────────────────────────────────────────
// getExecutionMode
// ─────────────────────────────────────────────────────────────────────────────

describe("getExecutionMode", () => {
  it("returns an object with mode, canWrite, isLive", () => {
    const result = getExecutionMode();
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("canWrite");
    expect(result).toHaveProperty("isLive");
  });

  it("mode is a non-empty string", () => {
    const result = getExecutionMode();
    expect(typeof result.mode).toBe("string");
    expect(result.mode.length).toBeGreaterThan(0);
  });

  it("canWrite and isLive are booleans", () => {
    const result = getExecutionMode();
    expect(typeof result.canWrite).toBe("boolean");
    expect(typeof result.isLive).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// executeOrder
// ─────────────────────────────────────────────────────────────────────────────

const MOCK_DECISION: any = {
  approved:       true,
  decision:       "approved",
  confidence:     0.75,
  blockedReasons: [],
  edgeScore:      0.65,
};

const VALID_REQ: any = {
  symbol:       "BTCUSD",
  side:         "buy",
  quantity:     0.1,
  direction:    "long",
  setup_type:   "sweep_reclaim",
  regime:       "trending",
  entry_price:  42000,
  stop_loss:    41500,
  take_profit:  43000,
  decision:     MOCK_DECISION,
};

describe("executeOrder", () => {
  it("returns an ExecutionResult object", async () => {
    const result = await executeOrder(VALID_REQ);
    expect(result).toHaveProperty("executed");
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("details");
  });

  it("executed is a boolean", async () => {
    const result = await executeOrder(VALID_REQ);
    expect(typeof result.executed).toBe("boolean");
  });

  it("mode is paper, live, or dry_run", async () => {
    const result = await executeOrder(VALID_REQ);
    expect(["paper", "live", "dry_run"]).toContain(result.mode);
  });

  it("handles zero quantity gracefully", async () => {
    const result = await executeOrder({ ...VALID_REQ, quantity: 0 });
    // Should either refuse with executed=false or handle safely
    expect(result).toHaveProperty("executed");
  });

  it("handles non-approved decision gracefully", async () => {
    const result = await executeOrder({
      ...VALID_REQ,
      decision: { ...MOCK_DECISION, approved: false, decision: "blocked" },
    });
    expect(result).toHaveProperty("executed");
    // Non-approved orders should not be executed
    expect(result.executed).toBe(false);
  });
});
