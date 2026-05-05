/**
 * Phase 3 choke-point test.
 *
 * Hypothesis: under any failing-gate snapshot, executeOrder() MUST NOT call
 * alpaca.placeOrder. Stub placeOrder via vi.mock and assert call count = 0
 * on rejection paths and = 1 on the happy path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const placeOrderMock = vi.fn(async (_req: unknown) => ({ id: "test_order_id_1", symbol: "BTCUSD", status: "accepted" }));
const buildSnapMock = vi.fn();
const recordAuditMock = vi.fn(() => ({ audit_id: "audit_test_1" }));

vi.mock("../lib/alpaca", () => ({
  placeOrder: placeOrderMock,
}));

vi.mock("../lib/risk/risk_snapshot", () => ({
  buildRiskSnapshot: (i: unknown) => buildSnapMock(i),
  SNAPSHOT_CONFIG: { systemMode: "paper", maxDailyLossPct: 2 },
}));

vi.mock("../lib/risk/audit_log", () => ({
  recordExecutionAudit: (...args: unknown[]) => recordAuditMock(...args),
}));

// Block real DB / persistent_store side effects.
vi.mock("../lib/persistent_store", () => ({
  persistAppend: vi.fn(),
  persistRead: vi.fn(() => []),
  persistWrite: vi.fn(),
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../lib/alerts", () => ({ alertKillSwitch: vi.fn() }));
vi.mock("../lib/metrics", () => ({ tradesExecutedTotal: { inc: vi.fn() } }));
vi.mock("@workspace/db", () => ({
  db: {
    insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }) }),
  },
  siDecisionsTable: { id: "id" },
}));

const baseReq = () => ({
  symbol: "BTCUSD",
  side: "buy" as const,
  direction: "long" as const,
  quantity: 0.01,
  setup_type: "manual_test",
  regime: "test",
  entry_price: 50_000,
  stop_loss: 49_500,
  take_profit: 51_000,
});

const happySnap = {
  systemMode: "paper" as const,
  killSwitchActive: false,
  operatorTokenValid: true,
  dataAgeMs: 1000,
  maxDataAgeMs: 30_000,
  sessionAllowed: true,
  activeSession: "NY",
  newsLockoutActive: false,
  dailyPnLPct: 0,
  maxDailyLossPct: 2,
  openPositionCount: 0,
  maxConcurrentPositions: 1,
  tradesTodayCount: 0,
  maxTradesPerDay: 3,
};

describe("order_executor choke point", () => {
  beforeEach(() => {
    placeOrderMock.mockClear();
    recordAuditMock.mockClear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("HAPPY: calls placeOrder exactly once and records audit accepted_executed", async () => {
    buildSnapMock.mockReturnValue(happySnap);
    const { executeOrder } = await import("../lib/order_executor");
    const out = await executeOrder(baseReq() as any);
    expect(out.executed).toBe(true);
    expect(placeOrderMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock).toHaveBeenCalledTimes(1);
    expect(recordAuditMock.mock.calls[0]![0]).toMatchObject({ outcome: "accepted_executed" });
  });

  it("BLOCK by kill_switch: never calls placeOrder, audit outcome is rejected_by_gate", async () => {
    buildSnapMock.mockReturnValue({ ...happySnap, killSwitchActive: true });
    const { executeOrder } = await import("../lib/order_executor");
    const out = await executeOrder(baseReq() as any);
    expect(out.executed).toBe(false);
    expect(out.blocking_gate).toBe("kill_switch");
    expect(placeOrderMock).not.toHaveBeenCalled();
    expect(recordAuditMock.mock.calls[0]![0]).toMatchObject({ outcome: "rejected_by_gate" });
  });

  it("BLOCK by data_staleness: never calls placeOrder", async () => {
    buildSnapMock.mockReturnValue({ ...happySnap, dataAgeMs: 60_000 });
    const { executeOrder } = await import("../lib/order_executor");
    const out = await executeOrder(baseReq() as any);
    expect(out.executed).toBe(false);
    expect(out.blocking_gate).toBe("data_staleness");
    expect(placeOrderMock).not.toHaveBeenCalled();
  });

  it("BLOCK by daily_loss_limit: never calls placeOrder unless stop_out bypass", async () => {
    buildSnapMock.mockReturnValue({ ...happySnap, dailyPnLPct: -5 });
    const { executeOrder } = await import("../lib/order_executor");
    const out = await executeOrder(baseReq() as any);
    expect(out.executed).toBe(false);
    expect(out.blocking_gate).toBe("daily_loss_limit");
    expect(placeOrderMock).not.toHaveBeenCalled();
  });

  it("BYPASS stop_out: daily_loss_limit allowed, placeOrder is called", async () => {
    buildSnapMock.mockReturnValue({ ...happySnap, dailyPnLPct: -5 });
    const { executeOrder } = await import("../lib/order_executor");
    const out = await executeOrder({ ...baseReq(), bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 } as any);
    expect(out.executed).toBe(true);
    expect(placeOrderMock).toHaveBeenCalledTimes(1);
  });

  it("BYPASS stop_out does NOT bypass kill_switch", async () => {
    buildSnapMock.mockReturnValue({ ...happySnap, killSwitchActive: true });
    const { executeOrder } = await import("../lib/order_executor");
    const out = await executeOrder({ ...baseReq(), bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 } as any);
    expect(out.executed).toBe(false);
    expect(out.blocking_gate).toBe("kill_switch");
    expect(placeOrderMock).not.toHaveBeenCalled();
  });
});
