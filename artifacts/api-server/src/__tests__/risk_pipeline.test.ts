import { describe, expect, it } from "vitest";
import {
  evaluatePipeline,
  type RiskRequest,
  type RiskSnapshot,
  type GateName,
} from "../lib/risk/risk_pipeline";

const baseReq = (over: Partial<RiskRequest> = {}): RiskRequest => ({
  symbol: "BTCUSD",
  side: "buy",
  direction: "long",
  quantity: 0.01,
  entry_price: 50_000,
  stop_loss: 49_500,
  take_profit: 51_000,
  ...over,
});

const baseSnap = (over: Partial<RiskSnapshot> = {}): RiskSnapshot => ({
  systemMode: "paper",
  killSwitchActive: false,
  operatorTokenValid: true,
  dataAgeMs: 1_000,
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
  ...over,
});

describe("evaluatePipeline — happy path", () => {
  it("allows a clean order with all gates passing", () => {
    const r = evaluatePipeline(baseReq(), baseSnap());
    expect(r.allowed).toBe(true);
    expect(r.blockingGate).toBeUndefined();
    expect(r.decisions.length).toBe(9);
    expect(r.decisions.every((d) => d.allowed)).toBe(true);
  });
});

describe("evaluatePipeline — single-gate rejections (each in spec order)", () => {
  const cases: Array<{ name: string; snap?: Partial<RiskSnapshot>; req?: Partial<RiskRequest>; expectGate: GateName }> = [
    { name: "system_mode: live_disabled blocks", snap: { systemMode: "live_disabled" }, expectGate: "system_mode" },
    { name: "system_mode: demo blocks", snap: { systemMode: "demo" }, expectGate: "system_mode" },
    { name: "kill_switch: active blocks", snap: { killSwitchActive: true }, expectGate: "kill_switch" },
    { name: "operator_token: missing in live mode blocks", snap: { systemMode: "live_enabled", operatorTokenValid: false }, expectGate: "operator_token" },
    { name: "data_staleness: age > max blocks", snap: { dataAgeMs: 60_000, maxDataAgeMs: 30_000 }, expectGate: "data_staleness" },
    { name: "session: not allowed blocks", snap: { sessionAllowed: false }, expectGate: "session" },
    { name: "news_lockout: active blocks", snap: { newsLockoutActive: true }, expectGate: "news_lockout" },
    { name: "daily_loss_limit: at cap blocks", snap: { dailyPnLPct: -2.0, maxDailyLossPct: 2 }, expectGate: "daily_loss_limit" },
    { name: "daily_loss_limit: beyond cap blocks", snap: { dailyPnLPct: -3.0, maxDailyLossPct: 2 }, expectGate: "daily_loss_limit" },
    { name: "max_exposure: max concurrent positions blocks", snap: { openPositionCount: 1, maxConcurrentPositions: 1 }, expectGate: "max_exposure" },
    { name: "max_exposure: max trades/day blocks", snap: { tradesTodayCount: 3, maxTradesPerDay: 3 }, expectGate: "max_exposure" },
    { name: "order_sanity: zero qty blocks", req: { quantity: 0 }, expectGate: "order_sanity" },
    { name: "order_sanity: long stop above entry blocks", req: { stop_loss: 50_500 }, expectGate: "order_sanity" },
    { name: "order_sanity: long target below entry blocks", req: { take_profit: 49_900 }, expectGate: "order_sanity" },
    { name: "order_sanity: short stop below entry blocks", req: { side: "sell", direction: "short", stop_loss: 49_500, take_profit: 49_000 }, expectGate: "order_sanity" },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const r = evaluatePipeline(baseReq(c.req), baseSnap(c.snap));
      expect(r.allowed).toBe(false);
      expect(r.blockingGate).toBe(c.expectGate);
    });
  }
});

describe("evaluatePipeline — short-circuit ordering (upstream gate fails first)", () => {
  it("kill_switch fires before operator_token even in live mode", () => {
    const r = evaluatePipeline(
      baseReq(),
      baseSnap({ systemMode: "live_enabled", killSwitchActive: true, operatorTokenValid: false }),
    );
    expect(r.blockingGate).toBe("kill_switch");
  });
  it("system_mode fires before kill_switch", () => {
    const r = evaluatePipeline(
      baseReq(),
      baseSnap({ systemMode: "live_disabled", killSwitchActive: true }),
    );
    expect(r.blockingGate).toBe("system_mode");
  });
  it("data_staleness fires before session", () => {
    const r = evaluatePipeline(
      baseReq(),
      baseSnap({ dataAgeMs: 60_000, maxDataAgeMs: 30_000, sessionAllowed: false }),
    );
    expect(r.blockingGate).toBe("data_staleness");
  });
});

describe("evaluatePipeline — stop_out bypass", () => {
  it("bypasses daily_loss_limit and max_exposure", () => {
    const r = evaluatePipeline(
      baseReq({ bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 }),
      baseSnap({ dailyPnLPct: -5.0, maxDailyLossPct: 2, openPositionCount: 1, maxConcurrentPositions: 1, tradesTodayCount: 3, maxTradesPerDay: 3 }),
    );
    expect(r.allowed).toBe(true);
    const bypassedGates = r.decisions.filter((d) => d.bypassed).map((d) => d.gate);
    expect(bypassedGates).toEqual(expect.arrayContaining(["daily_loss_limit", "max_exposure"]));
  });

  it("does NOT bypass kill_switch (must always hold)", () => {
    const r = evaluatePipeline(
      baseReq({ bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 }),
      baseSnap({ killSwitchActive: true }),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingGate).toBe("kill_switch");
  });

  it("does NOT bypass system_mode", () => {
    const r = evaluatePipeline(
      baseReq({ bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 }),
      baseSnap({ systemMode: "live_disabled" }),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingGate).toBe("system_mode");
  });

  it("does NOT bypass data_staleness", () => {
    const r = evaluatePipeline(
      baseReq({ bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 }),
      baseSnap({ dataAgeMs: 60_000, maxDataAgeMs: 30_000 }),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingGate).toBe("data_staleness");
  });

  it("does NOT bypass news_lockout", () => {
    const r = evaluatePipeline(
      baseReq({ bypassReasons: ["stop_out"], closing: true, stop_loss: 0, take_profit: 0 }),
      baseSnap({ newsLockoutActive: true }),
    );
    expect(r.allowed).toBe(false);
    expect(r.blockingGate).toBe("news_lockout");
  });
});

describe("evaluatePipeline — closing flag relaxes order_sanity", () => {
  it("closing=true accepts qty>0 + entry>0 with zero stop/TP", () => {
    const r = evaluatePipeline(
      baseReq({ closing: true, stop_loss: 0, take_profit: 0, bypassReasons: ["stop_out"] }),
      baseSnap(),
    );
    expect(r.allowed).toBe(true);
  });
  it("closing=false (default) rejects zero stop/TP", () => {
    const r = evaluatePipeline(baseReq({ stop_loss: 0, take_profit: 0 }), baseSnap());
    expect(r.allowed).toBe(false);
    expect(r.blockingGate).toBe("order_sanity");
  });
});

describe("evaluatePipeline — audit trail completeness", () => {
  it("populates decisions for every reached gate (not just the blocker)", () => {
    const r = evaluatePipeline(
      baseReq(),
      baseSnap({ newsLockoutActive: true }), // gate 6 fires
    );
    // 1 mode + 2 kill + 3 token + 4 data + 5 session + 6 news (block) = 6 decisions
    expect(r.decisions.length).toBe(6);
    expect(r.decisions[5]!.gate).toBe("news_lockout");
    expect(r.decisions[5]!.allowed).toBe(false);
  });
  it("happy path produces all 9 decisions", () => {
    const r = evaluatePipeline(baseReq(), baseSnap());
    expect(r.decisions.length).toBe(9);
    const names = r.decisions.map((d) => d.gate);
    expect(names).toEqual([
      "system_mode", "kill_switch", "operator_token", "data_staleness",
      "session", "news_lockout", "daily_loss_limit", "max_exposure", "order_sanity",
    ]);
  });
});
