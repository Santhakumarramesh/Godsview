import { describe, expect, it } from "vitest";
import { computeMetrics } from "../lib/paper_trades/metrics";
import { buildEquityCurve } from "../lib/paper_trades/equity";
import { tradesToCsv } from "../lib/paper_trades/csv";
import type { ExecutedTrade } from "../lib/paper_trades/types";

const ts = (h: number) =>
  new Date(Date.UTC(2026, 0, 1, h, 0, 0)).toISOString();

const closed = (over: Partial<ExecutedTrade>): ExecutedTrade => ({
  id: 1,
  audit_id: "audit_test",
  broker_order_id: "ord",
  symbol: "BTCUSD",
  strategy_id: "ob_retest_long_1h",
  direction: "long",
  quantity: 0.1,
  entry_price: 100,
  stop_loss: 98,
  take_profit: 104,
  exit_price: 104,
  pnl: 0.4,           // 0.1 * (104 - 100)
  pnl_pct: null,
  realized_r: 2.0,
  outcome: "win",
  status: "closed",
  entry_time: ts(0),
  exit_time: ts(1),
  mode: "paper",
  bypass_reasons: [],
  closing: false,
  equity_at_entry: 10_000,
  ...over,
});

const open = (over: Partial<ExecutedTrade>): ExecutedTrade => ({
  ...closed({ ...over, status: "open", outcome: "open", exit_price: null, exit_time: null, pnl: null, realized_r: null }),
});

describe("computeMetrics — empty input", () => {
  it("returns zeros and nulls without fabricating data", () => {
    const m = computeMetrics({ trades: [], rejectedCount: 0, startingEquity: 10_000 });
    expect(m.total_executed).toBe(0);
    expect(m.total_closed).toBe(0);
    expect(m.win_rate).toBeNull();
    expect(m.avg_r).toBeNull();
    expect(m.profit_factor).toBeNull();
    expect(m.max_drawdown_pct).toBeNull();
    expect(m.total_pnl).toBe(0);
    expect(m.first_trade_at).toBeNull();
  });
});

describe("computeMetrics — counts and rates", () => {
  it("computes win/loss/breakeven splits correctly", () => {
    const trades: ExecutedTrade[] = [
      closed({ id: 1, pnl: 5, realized_r: 2.5, outcome: "win", entry_time: ts(0), exit_time: ts(1) }),
      closed({ id: 2, pnl: -2, realized_r: -1.0, outcome: "loss", entry_time: ts(2), exit_time: ts(3) }),
      closed({ id: 3, pnl: 0, realized_r: 0, outcome: "breakeven", entry_time: ts(4), exit_time: ts(5) }),
      open({ id: 4, entry_time: ts(6) }),
    ];
    const m = computeMetrics({ trades, rejectedCount: 7, startingEquity: 100 });
    expect(m.total_executed).toBe(4);
    expect(m.total_open).toBe(1);
    expect(m.total_closed).toBe(3);
    expect(m.total_wins).toBe(1);
    expect(m.total_losses).toBe(1);
    expect(m.total_breakevens).toBe(1);
    expect(m.total_rejected).toBe(7);
    expect(m.win_rate).toBeCloseTo(1 / 3, 10);
    expect(m.loss_rate).toBeCloseTo(1 / 3, 10);
  });
});

describe("computeMetrics — R-multiple stats", () => {
  it("avg/median/best/worst R computed only from non-null R values", () => {
    const trades: ExecutedTrade[] = [
      closed({ id: 1, pnl: 5, realized_r: 2.5, entry_time: ts(0), exit_time: ts(1) }),
      closed({ id: 2, pnl: -2, realized_r: -1.0, entry_time: ts(2), exit_time: ts(3) }),
      closed({ id: 3, pnl: 1, realized_r: 0.5, entry_time: ts(4), exit_time: ts(5) }),
      closed({ id: 4, pnl: 1, realized_r: null, entry_time: ts(6), exit_time: ts(7) }),
    ];
    const m = computeMetrics({ trades, rejectedCount: 0, startingEquity: 100 });
    // R values used: [2.5, -1.0, 0.5]
    expect(m.avg_r).toBeCloseTo((2.5 - 1.0 + 0.5) / 3, 10);
    expect(m.median_r).toBeCloseTo(0.5, 10);
    expect(m.best_r).toBe(2.5);
    expect(m.worst_r).toBe(-1.0);
  });
});

describe("computeMetrics — profit factor", () => {
  it("equals sum(positive PnL) / abs(sum(negative PnL))", () => {
    const trades: ExecutedTrade[] = [
      closed({ id: 1, pnl: 10, entry_time: ts(0), exit_time: ts(1) }),
      closed({ id: 2, pnl: 5, entry_time: ts(2), exit_time: ts(3) }),
      closed({ id: 3, pnl: -6, entry_time: ts(4), exit_time: ts(5) }),
    ];
    const m = computeMetrics({ trades, rejectedCount: 0, startingEquity: 100 });
    expect(m.profit_factor).toBeCloseTo(15 / 6, 10);
  });
  it("returns null when there are no losses", () => {
    const trades: ExecutedTrade[] = [closed({ id: 1, pnl: 5, entry_time: ts(0), exit_time: ts(1) })];
    const m = computeMetrics({ trades, rejectedCount: 0, startingEquity: 100 });
    expect(m.profit_factor).toBeNull();
  });
});

describe("computeMetrics — drawdown peak-to-trough", () => {
  it("equity 100 → 110 → 105 → 95 → 100 has DD = 15 from peak 110", () => {
    const trades: ExecutedTrade[] = [
      closed({ id: 1, pnl: 10,  entry_time: ts(0), exit_time: ts(1) }),  // 100→110
      closed({ id: 2, pnl: -5,  entry_time: ts(2), exit_time: ts(3) }),  // 110→105
      closed({ id: 3, pnl: -10, entry_time: ts(4), exit_time: ts(5) }),  // 105→95   trough
      closed({ id: 4, pnl: 5,   entry_time: ts(6), exit_time: ts(7) }),  // 95→100
    ];
    const m = computeMetrics({ trades, rejectedCount: 0, startingEquity: 100 });
    expect(m.max_drawdown_abs).toBeCloseTo(15, 10);
    expect(m.max_drawdown_pct).toBeCloseTo((15 / 110) * 100, 10);
  });
  it("returns null when no trades closed", () => {
    const m = computeMetrics({ trades: [], rejectedCount: 0, startingEquity: 100 });
    expect(m.max_drawdown_abs).toBeNull();
    expect(m.max_drawdown_pct).toBeNull();
  });
});

describe("buildEquityCurve — chronological, no smoothing", () => {
  it("emits one point per closed trade, ordered by exit_time", () => {
    const trades: ExecutedTrade[] = [
      closed({ id: 1, pnl: 5,  entry_time: ts(0), exit_time: ts(2) }),
      closed({ id: 2, pnl: -2, entry_time: ts(1), exit_time: ts(3) }),
      closed({ id: 3, pnl: 7,  entry_time: ts(2), exit_time: ts(4) }),
      open({ id: 4, entry_time: ts(5) }),
    ];
    const curve = buildEquityCurve(trades, 100);
    expect(curve.starting_equity).toBe(100);
    expect(curve.points.length).toBe(3);
    expect(curve.points[0]!.trade_id).toBe(1);
    expect(curve.points[0]!.equity).toBe(105);
    expect(curve.points[1]!.equity).toBe(103);
    expect(curve.points[2]!.equity).toBe(110);
    expect(curve.ending_equity).toBe(110);
    expect(curve.starting_at).toBe(ts(0));
  });
  it("on empty input returns starting_equity unchanged", () => {
    const curve = buildEquityCurve([], 250);
    expect(curve.starting_equity).toBe(250);
    expect(curve.ending_equity).toBe(250);
    expect(curve.points).toHaveLength(0);
    expect(curve.starting_at).toBeNull();
  });
});

describe("tradesToCsv", () => {
  it("emits header + one row per trade with quoted timestamps", () => {
    const trades: ExecutedTrade[] = [closed({ id: 42 })];
    const csv = tradesToCsv(trades);
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^id,audit_id,broker_order_id/);
    expect(lines.length).toBe(2);
    expect(lines[1]).toContain("42");
    expect(lines[1]).toContain("BTCUSD");
  });
  it("escapes commas and quotes in values", () => {
    const trades: ExecutedTrade[] = [
      closed({ id: 1, audit_id: 'a"b,c', strategy_id: "x,y" }),
    ];
    const csv = tradesToCsv(trades);
    expect(csv).toContain('"a""b,c"');
    expect(csv).toContain('"x,y"');
  });
});
