import { describe, expect, it } from "vitest";
import { classifyOrphans, type ReconcilerOpenRow, type BrokerPositionLite } from "../lib/paper_trades/reconciler";
import { checkTradeIntegrity } from "../lib/paper_trades/integrity";
import type { ExecutedTrade } from "../lib/paper_trades/types";

const NOW = Date.UTC(2026, 4, 5, 12, 0, 0);
const minsAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const row = (over: Partial<ReconcilerOpenRow>): ReconcilerOpenRow => ({
  id: 1, symbol: "BTCUSD", broker_order_id: "ord_1",
  entry_price: 50_000, entry_time: minsAgo(60),
  status: "open", quantity: 0.01, ...over,
});

describe("classifyOrphans", () => {
  it("classifies as orphan when symbol absent from broker positions and grace expired", () => {
    const rows = [row({ id: 1, symbol: "BTCUSD", entry_time: minsAgo(60) })];
    const positions: BrokerPositionLite[] = []; // broker has nothing
    const out = classifyOrphans(rows, positions, { nowMs: NOW });
    expect(out.orphans.map((r) => r.id)).toEqual([1]);
    expect(out.kept).toHaveLength(0);
    expect(out.untrackedPositions).toHaveLength(0);
  });

  it("KEEPS rows whose symbol is present in broker positions", () => {
    const rows = [row({ id: 1, symbol: "BTCUSD", entry_time: minsAgo(60) })];
    const positions: BrokerPositionLite[] = [{ symbol: "BTCUSD", qty: 0.01 }];
    const out = classifyOrphans(rows, positions, { nowMs: NOW });
    expect(out.orphans).toHaveLength(0);
    expect(out.kept).toHaveLength(1);
    expect(out.untrackedPositions).toHaveLength(0);
  });

  it("KEEPS rows younger than the grace window even if absent from positions", () => {
    const rows = [row({ id: 1, symbol: "BTCUSD", entry_time: minsAgo(2) })];
    const out = classifyOrphans(rows, [], { nowMs: NOW, graceMs: 5 * 60_000 });
    expect(out.orphans).toHaveLength(0);
    expect(out.kept).toHaveLength(1);
  });

  it("flags untracked positions when broker has positions with no DB row", () => {
    const rows = [row({ id: 1, symbol: "BTCUSD", entry_time: minsAgo(60) })];
    const positions: BrokerPositionLite[] = [
      { symbol: "BTCUSD", qty: 0.01 },
      { symbol: "ETHUSD", qty: 0.5 },  // not in DB
    ];
    const out = classifyOrphans(rows, positions, { nowMs: NOW });
    expect(out.untrackedPositions).toEqual([{ symbol: "ETHUSD", qty: 0.5 }]);
    expect(out.orphans).toHaveLength(0);
  });

  it("handles invalid entry_time by KEEPING the row (defensive)", () => {
    const rows = [row({ id: 1, entry_time: "not-a-date" })];
    const out = classifyOrphans(rows, [], { nowMs: NOW });
    expect(out.kept).toHaveLength(1);
    expect(out.orphans).toHaveLength(0);
  });
});

const trade = (over: Partial<ExecutedTrade>): ExecutedTrade => ({
  id: 1, audit_id: "audit_x", broker_order_id: "ord_1",
  symbol: "BTCUSD", strategy_id: "ob_retest_long_1h", direction: "long",
  quantity: 0.01, entry_price: 50_000, stop_loss: 49_500, take_profit: 51_000,
  exit_price: 51_000, pnl: 5, pnl_pct: 0.05, realized_r: 2,
  outcome: "win", status: "closed",
  entry_time: minsAgo(120), exit_time: minsAgo(60),
  mode: "paper", bypass_reasons: [], closing: false, equity_at_entry: 10_000,
  ...over,
});

describe("checkTradeIntegrity", () => {
  it("clean fixture produces zero violations", () => {
    const r = checkTradeIntegrity([trade({})], { nowMs: NOW });
    expect(r.total_violations).toBe(0);
  });

  it("flags missing audit_id", () => {
    const r = checkTradeIntegrity([trade({ audit_id: null })], { nowMs: NOW });
    expect(r.violations.some((v) => v.rule === "missing_audit_id")).toBe(true);
  });

  it("flags missing broker_order_id", () => {
    const r = checkTradeIntegrity([trade({ broker_order_id: null })], { nowMs: NOW });
    expect(r.violations.some((v) => v.rule === "missing_broker_order_id")).toBe(true);
  });

  it("flags closed_without_exit_time and closed_without_pnl on closed rows", () => {
    const r = checkTradeIntegrity([trade({ exit_time: null, pnl: null })], { nowMs: NOW });
    const rules = r.violations.map((v) => v.rule);
    expect(rules).toContain("closed_without_exit_time");
    expect(rules).toContain("closed_without_pnl");
  });

  it("flags open_too_long for old open rows", () => {
    const old = trade({
      status: "open", outcome: "open", exit_price: null, exit_time: null, pnl: null,
      entry_time: new Date(NOW - 26 * 3600_000).toISOString(),
    });
    const r = checkTradeIntegrity([old], { nowMs: NOW, maxOpenAgeMs: 24 * 3600_000 });
    expect(r.violations.some((v) => v.rule === "open_too_long")).toBe(true);
  });

  it("does NOT flag open_too_long when within window", () => {
    const young = trade({
      status: "open", outcome: "open", exit_price: null, exit_time: null, pnl: null,
      entry_time: new Date(NOW - 1 * 3600_000).toISOString(),
    });
    const r = checkTradeIntegrity([young], { nowMs: NOW, maxOpenAgeMs: 24 * 3600_000 });
    expect(r.violations.some((v) => v.rule === "open_too_long")).toBe(false);
  });

  it("by_rule histogram sums to total_violations", () => {
    const trades = [
      trade({ id: 1, audit_id: null }),
      trade({ id: 2, broker_order_id: null }),
      trade({ id: 3, exit_time: null }),
    ];
    const r = checkTradeIntegrity(trades, { nowMs: NOW });
    const sum = Object.values(r.by_rule).reduce((a, b) => a + b, 0);
    expect(sum).toBe(r.total_violations);
  });
});
