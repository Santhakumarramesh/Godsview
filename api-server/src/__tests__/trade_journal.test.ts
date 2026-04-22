import { describe, it, expect, beforeEach } from "vitest";
import {
  recordEntry,
  recordExit,
  getJournal,
  replayTrade,
  getJournalAnalytics,
  getTradeJournalSnapshot,
  resetTradeJournal,
} from "../lib/trade_journal.js";

const base = {
  tradeId: "t1",
  symbol: "AAPL",
  direction: "long" as const,
  strategyId: "s1",
  strategyName: "MomentumAlpha",
  entryPrice: 150,
  entryReason: "RSI oversold bounce",
  positionSize: 100,
  riskPct: 1,
};

beforeEach(() => resetTradeJournal());

describe("Trade Journal", () => {
  it("records an entry", () => {
    const e = recordEntry(base);
    expect(e.id).toMatch(/^tj_/);
    expect(e.status).toBe("open");
    expect(e.symbol).toBe("AAPL");
  });

  it("records exit and computes PnL", () => {
    recordEntry(base);
    const closed = recordExit({
      tradeId: "t1",
      exitPrice: 160,
      exitReason: "Target hit",
    });
    expect(closed.status).toBe("closed");
    expect(closed.pnl).toBeGreaterThan(0);
    expect(closed.pnlPct).toBeCloseTo(6.67, 1);
    expect(closed.holdDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("throws on exit for unknown trade", () => {
    expect(() => recordExit({ tradeId: "none", exitPrice: 100, exitReason: "x" }))
      .toThrow("Open trade none not found");
  });

  it("filters journal entries", () => {
    recordEntry(base);
    recordEntry({ ...base, tradeId: "t2", symbol: "MSFT" });
    const aapl = getJournal({ symbol: "AAPL" });
    expect(aapl).toHaveLength(1);
    const all = getJournal();
    expect(all).toHaveLength(2);
  });

  it("replays a trade", () => {
    recordEntry(base);
    recordExit({ tradeId: "t1", exitPrice: 160, exitReason: "TP1" });
    const replay = replayTrade("t1");
    expect(replay.steps).toHaveLength(2);
    expect(replay.lessonsLearned.length).toBeGreaterThan(0);
  });

  it("throws on replay unknown trade", () => {
    expect(() => replayTrade("nope")).toThrow("Trade nope not found");
  });

  it("computes analytics", () => {
    recordEntry(base);
    recordExit({ tradeId: "t1", exitPrice: 160, exitReason: "win" });
    recordEntry({ ...base, tradeId: "t2" });
    recordExit({ tradeId: "t2", exitPrice: 140, exitReason: "loss" });
    const a = getJournalAnalytics();
    expect(a.totalTrades).toBe(2);
    expect(a.winRate).toBe(0.5);
    expect(a.profitFactor).toBeGreaterThan(0);
    expect(a.bestStrategy).toBe("MomentumAlpha");
  });

  it("returns snapshot", () => {
    recordEntry(base);
    const snap = getTradeJournalSnapshot();
    expect(snap.totalEntries).toBe(1);
    expect(snap.openTrades).toBe(1);
  });
});
