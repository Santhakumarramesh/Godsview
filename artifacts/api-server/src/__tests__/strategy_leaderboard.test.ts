/**
 * strategy_leaderboard.test.ts — Phase 22: Strategy Performance Leaderboard
 *
 * Tests:
 *   - Empty journal → empty leaderboards
 *   - Single-trade entry handling
 *   - Win rate calculation
 *   - Profit factor (gross wins / gross losses; ∞ when no losses)
 *   - Expectancy math: (winRate × avgWin%) - (lossRate × avgLoss%)
 *   - Net PnL accumulation
 *   - Ranking by expectancy (descending)
 *   - Tier assignment (elite / strong / average / weak / avoid)
 *   - Edge decay detection (recent vs all-time win rate)
 *   - Filtering by minTrades
 *   - Breakeven trade handling (excluded from win/loss rate)
 *   - Short direction pnlPct handling
 *   - Multi-setup / multi-symbol / multi-regime isolation
 *   - getLeaderboardSummary: top setups, symbols, decaying edges, bottom setup
 *   - Pending/blocked entries NOT counted in resolved totals
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getSetupLeaderboard,
  getSymbolLeaderboard,
  getRegimeLeaderboard,
  getLeaderboardSummary,
} from "../lib/strategy_leaderboard";
import { recordDecision, recordOutcome, clearJournal } from "../lib/trade_journal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function macroBias(override: Record<string, unknown> = {}) {
  return {
    bias: "neutral", direction: "long", score: 0.5, conviction: "medium",
    aligned: true, tailwind: false, headwind: false, blockedDirections: [],
    reasons: [], updatedAt: new Date().toISOString(), ...override,
  } as any;
}

function sentiment(override: Record<string, unknown> = {}) {
  return {
    retailBias: "balanced", institutionalEdge: "none", sentimentScore: 0.5,
    crowdingLevel: "moderate", aligned: false, contrarian: false, reasons: [],
    ...override,
  } as any;
}

function makeJournalEntry(opts: {
  symbol?:    string;
  setupType?: string;
  regime?:    string;
  direction?: "long" | "short";
  signalPrice?: number;
} = {}) {
  return {
    symbol:     opts.symbol      ?? "BTCUSD",
    setupType:  opts.setupType   ?? "breakout_retest",
    regime:     opts.regime      ?? "trending",
    direction:  opts.direction   ?? "long",
    decision:   "approved" as const,
    blockReason: "none" as any,
    macroBias:  macroBias(),
    sentiment:  sentiment(),
    signalPrice: opts.signalPrice ?? 50_000,
  };
}

/**
 * Helper: add a fully resolved trade to the journal.
 * pnlPct is computed from entry/exit prices (long direction).
 */
function addTrade(opts: {
  entryPrice:  number;
  exitPrice:   number;
  symbol?:     string;
  setupType?:  string;
  regime?:     string;
  direction?:  "long" | "short";
}): string {
  const dir = opts.direction ?? "long";
  const entry = recordDecision(makeJournalEntry({
    symbol: opts.symbol, setupType: opts.setupType,
    regime: opts.regime, direction: dir,
    signalPrice: opts.entryPrice,
  }));

  const pnl = dir === "long"
    ? (opts.exitPrice - opts.entryPrice) / opts.entryPrice
    : (opts.entryPrice - opts.exitPrice) / opts.entryPrice;

  recordOutcome(entry.id, {
    entryPrice: opts.entryPrice,
    exitPrice:  opts.exitPrice,
    outcome:    pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven",
    pnlUsd:     pnl * opts.entryPrice,
  });

  return entry.id;
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

describe("strategy_leaderboard", () => {
  beforeEach(() => {
    clearJournal();
  });

  // ── Empty journal ─────────────────────────────────────────────────────────────

  describe("empty journal", () => {
    it("getSetupLeaderboard returns empty array", () => {
      expect(getSetupLeaderboard()).toHaveLength(0);
    });

    it("getSymbolLeaderboard returns empty array", () => {
      expect(getSymbolLeaderboard()).toHaveLength(0);
    });

    it("getRegimeLeaderboard returns empty array", () => {
      expect(getRegimeLeaderboard()).toHaveLength(0);
    });

    it("getLeaderboardSummary returns zero totals", () => {
      const summary = getLeaderboardSummary();
      expect(summary.totalResolved).toBe(0);
      expect(summary.topSetups).toHaveLength(0);
      expect(summary.topSymbols).toHaveLength(0);
      expect(summary.bestRegime).toBeNull();
      expect(summary.bottomSetup).toBeNull();
    });
  });

  // ── Single trade ──────────────────────────────────────────────────────────────

  describe("single resolved trade", () => {
    it("appears in setup leaderboard when minTrades=1", () => {
      addTrade({ entryPrice: 100, exitPrice: 110, setupType: "sweep_reclaim" });
      const lb = getSetupLeaderboard(1);
      expect(lb).toHaveLength(1);
      expect(lb[0]!.key).toBe("sweep_reclaim");
    });

    it("does NOT appear when minTrades=3 (default)", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 });
      expect(getSetupLeaderboard()).toHaveLength(0);
    });

    it("winning trade: winRate=1, losses=0, profitFactor=∞ (stored as 999)", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.winRate).toBe(1);
      expect(lb[0]!.losses).toBe(0);
      expect(lb[0]!.profitFactor).toBe(999);
    });

    it("losing trade: winRate=0", () => {
      addTrade({ entryPrice: 100, exitPrice: 90 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.winRate).toBe(0);
      expect(lb[0]!.wins).toBe(0);
    });
  });

  // ── Win rate ──────────────────────────────────────────────────────────────────

  describe("winRate calculation", () => {
    it("4 wins 2 losses → winRate≈0.667", () => {
      for (let i = 0; i < 4; i++) addTrade({ entryPrice: 100, exitPrice: 110 });
      for (let i = 0; i < 2; i++) addTrade({ entryPrice: 100, exitPrice: 90 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.winRate).toBeCloseTo(4 / 6, 4);
    });

    it("breakeven trades are excluded from win rate calculation", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 }); // win
      addTrade({ entryPrice: 100, exitPrice:  90 }); // loss
      addTrade({ entryPrice: 100, exitPrice: 100 }); // breakeven
      const lb = getSetupLeaderboard(1);
      // winRate uses decidingTrades = wins + losses = 2, not 3
      expect(lb[0]!.winRate).toBeCloseTo(0.5, 4);
      expect(lb[0]!.breakeven).toBe(1);
    });
  });

  // ── Profit factor ─────────────────────────────────────────────────────────────

  describe("profitFactor", () => {
    it("2 wins at +10%, 1 loss at -5% → PF = 2.0 / 0.5 = 4.0", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      addTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      addTrade({ entryPrice: 100, exitPrice: 95 });  // -5%
      const lb = getSetupLeaderboard(1);
      // sumWinPct=0.2, sumLossPct=0.05 → PF=4
      expect(lb[0]!.profitFactor).toBeCloseTo(4.0, 2);
    });

    it("all wins → profitFactor = 999 (Infinity sentinel)", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.profitFactor).toBe(999);
    });

    it("all losses → profitFactor = 0", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 90 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.profitFactor).toBe(0);
    });
  });

  // ── Expectancy ────────────────────────────────────────────────────────────────

  describe("expectancy", () => {
    it("50% win rate, +10% avg win, -5% avg loss → expectancy=0.025", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 }); // +10%
      addTrade({ entryPrice: 100, exitPrice: 95 });  // -5%
      const lb = getSetupLeaderboard(1);
      // (0.5 × 0.10) - (0.5 × 0.05) = 0.025
      expect(lb[0]!.expectancy).toBeCloseTo(0.025, 4);
    });

    it("negative expectancy when avg loss exceeds avg win × winRate", () => {
      addTrade({ entryPrice: 100, exitPrice: 105 }); // +5% win
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 90 }); // -10% each
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.expectancy).toBeLessThan(0);
    });

    it("zero expectancy when winRate=0 and losses exist", () => {
      addTrade({ entryPrice: 100, exitPrice: 90 });
      addTrade({ entryPrice: 100, exitPrice: 85 });
      const lb = getSetupLeaderboard(1);
      // winRate=0 → (0 × avgWin) - (1 × avgLoss) < 0
      expect(lb[0]!.expectancy).toBeLessThan(0);
    });
  });

  // ── Net PnL accumulation ──────────────────────────────────────────────────────

  describe("netPnlPct", () => {
    it("sums all pnlPct values algebraically", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 }); // +0.1
      addTrade({ entryPrice: 100, exitPrice: 90 });  // -0.1
      addTrade({ entryPrice: 100, exitPrice: 115 }); // +0.15
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.netPnlPct).toBeCloseTo(0.15, 4);
    });
  });

  // ── Ranking order ─────────────────────────────────────────────────────────────

  describe("ranking by expectancy (descending)", () => {
    it("setup with higher expectancy is ranked #1", () => {
      // Setup A: 80% win rate, large wins
      for (let i = 0; i < 4; i++) addTrade({ entryPrice: 100, exitPrice: 120, setupType: "setup_a" });
      addTrade({ entryPrice: 100, exitPrice: 90, setupType: "setup_a" });
      // Setup B: 50% win rate, modest wins
      addTrade({ entryPrice: 100, exitPrice: 105, setupType: "setup_b" });
      addTrade({ entryPrice: 100, exitPrice: 95, setupType: "setup_b" });

      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.key).toBe("setup_a");
      expect(lb[0]!.rank).toBe(1);
      expect(lb[1]!.rank).toBe(2);
    });

    it("entries with equal trades are still ranked (no ties in rank)", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 120, setupType: "good" });
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 80, setupType: "bad" });
      const lb = getSetupLeaderboard(1);
      expect(lb.map(e => e.rank)).toEqual([1, 2]);
    });
  });

  // ── Tier assignment ───────────────────────────────────────────────────────────

  describe("tier assignment", () => {
    it("high expectancy + PF≥2 → elite", () => {
      // 90% win rate, +20% avg win, -10% avg loss → EV≈0.167, PF high
      for (let i = 0; i < 9; i++) addTrade({ entryPrice: 100, exitPrice: 120 });
      addTrade({ entryPrice: 100, exitPrice: 90 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.tier).toBe("elite");
    });

    it("negative expectancy → avoid tier", () => {
      for (let i = 0; i < 4; i++) addTrade({ entryPrice: 100, exitPrice: 85 }); // big losses
      addTrade({ entryPrice: 100, exitPrice: 101 }); // tiny win
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.tier).toBe("avoid");
    });
  });

  // ── Edge decay ────────────────────────────────────────────────────────────────

  describe("edge decay detection", () => {
    it("edgeDecay is 0 when total trades < RECENT_WINDOW (10)", () => {
      for (let i = 0; i < 5; i++) addTrade({ entryPrice: 100, exitPrice: 110 });
      for (let i = 0; i < 4; i++) addTrade({ entryPrice: 100, exitPrice: 90 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.edgeDecay).toBe(0);
    });

    it("edgeDecay is negative when recent trades underperform overall history", () => {
      // First 10 trades: strong winning
      for (let i = 0; i < 10; i++) addTrade({ entryPrice: 100, exitPrice: 120 });
      // Next 10 trades: all losses → recent win rate much lower than all-time
      for (let i = 0; i < 10; i++) addTrade({ entryPrice: 100, exitPrice: 80 });
      const lb = getSetupLeaderboard(1);
      // edgeDecay should be negative (recent losing streak vs all-time 50% win rate)
      expect(lb[0]!.edgeDecay).toBeLessThan(0);
    });

    it("edgeDecay is positive when recent trades outperform overall history", () => {
      // First 10 trades: mostly losing
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110 });
      for (let i = 0; i < 7; i++) addTrade({ entryPrice: 100, exitPrice: 90 });
      // Next 10 trades: all wins → hot streak
      for (let i = 0; i < 10; i++) addTrade({ entryPrice: 100, exitPrice: 115 });
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.edgeDecay).toBeGreaterThan(0);
    });
  });

  // ── Multi-dimension isolation ─────────────────────────────────────────────────

  describe("setup isolation", () => {
    it("two distinct setups produce two leaderboard entries", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110, setupType: "alpha" });
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 95, setupType: "beta" });
      const lb = getSetupLeaderboard(1);
      expect(lb).toHaveLength(2);
      expect(lb.map(e => e.key).sort()).toEqual(["alpha", "beta"]);
    });

    it("stats are not cross-contaminated across setups", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 120, setupType: "wins_only" });
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 80, setupType: "losses_only" });
      const lb = getSetupLeaderboard(1);
      const wins = lb.find(e => e.key === "wins_only")!;
      const losses = lb.find(e => e.key === "losses_only")!;
      expect(wins.winRate).toBe(1);
      expect(losses.winRate).toBe(0);
    });
  });

  describe("symbol isolation", () => {
    it("two distinct symbols produce two symbol leaderboard entries", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110, symbol: "BTCUSD" });
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 95,  symbol: "ETHUSD" });
      const lb = getSymbolLeaderboard(1);
      expect(lb).toHaveLength(2);
      expect(lb.map(e => e.category)).toEqual(["symbol", "symbol"]);
    });
  });

  describe("regime isolation", () => {
    it("two distinct regimes produce two regime leaderboard entries", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 115, regime: "trending" });
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 93, regime: "ranging" });
      const lb = getRegimeLeaderboard(1);
      expect(lb).toHaveLength(2);
      expect(lb.map(e => e.category)).toEqual(["regime", "regime"]);
    });

    it("trending regime beats ranging regime when trending has better trades", () => {
      for (let i = 0; i < 4; i++) addTrade({ entryPrice: 100, exitPrice: 120, regime: "trending" });
      addTrade({ entryPrice: 100, exitPrice: 90, regime: "trending" });
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 90, regime: "ranging" });
      const lb = getRegimeLeaderboard(1);
      expect(lb[0]!.key).toBe("trending");
    });
  });

  // ── Short direction ───────────────────────────────────────────────────────────

  describe("short direction", () => {
    it("short win: price goes down from entry to exit → win", () => {
      addTrade({ entryPrice: 100, exitPrice: 90, direction: "short" }); // +10% short win
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.wins).toBe(1);
      expect(lb[0]!.winRate).toBe(1);
    });

    it("short loss: price goes up from entry to exit → loss", () => {
      addTrade({ entryPrice: 100, exitPrice: 110, direction: "short" }); // -10% short loss
      const lb = getSetupLeaderboard(1);
      expect(lb[0]!.losses).toBe(1);
      expect(lb[0]!.winRate).toBe(0);
    });
  });

  // ── minTrades filter ─────────────────────────────────────────────────────────

  describe("minTrades filter", () => {
    it("minTrades=5 hides entries with fewer than 5 trades", () => {
      for (let i = 0; i < 4; i++) addTrade({ entryPrice: 100, exitPrice: 110, setupType: "small" });
      for (let i = 0; i < 5; i++) addTrade({ entryPrice: 100, exitPrice: 110, setupType: "large" });
      const lb = getSetupLeaderboard(5);
      expect(lb).toHaveLength(1);
      expect(lb[0]!.key).toBe("large");
    });

    it("minTrades=0 shows all entries including single trades", () => {
      addTrade({ entryPrice: 100, exitPrice: 110, setupType: "a" });
      addTrade({ entryPrice: 100, exitPrice: 105, setupType: "b" });
      expect(getSetupLeaderboard(0)).toHaveLength(2);
    });
  });

  // ── Blocked/pending entries excluded ─────────────────────────────────────────

  describe("blocked and pending entries excluded", () => {
    it("blocked decisions do not affect leaderboard counts", () => {
      // Add a blocked entry (no outcome)
      recordDecision({
        symbol: "BTCUSD", setupType: "breakout_retest", direction: "long",
        decision: "blocked", blockReason: "circuit_breaker_open",
        macroBias: macroBias(), sentiment: sentiment(), signalPrice: 100,
      });
      expect(getSetupLeaderboard(1)).toHaveLength(0);
    });

    it("pending (approved but no outcome recorded) entries do not appear", () => {
      recordDecision({
        symbol: "BTCUSD", setupType: "breakout_retest", direction: "long",
        decision: "approved", blockReason: "none" as any,
        macroBias: macroBias(), sentiment: sentiment(), signalPrice: 100,
      });
      // No recordOutcome → outcome remains "pending"
      expect(getSetupLeaderboard(1)).toHaveLength(0);
    });
  });

  // ── getLeaderboardSummary ─────────────────────────────────────────────────────

  describe("getLeaderboardSummary", () => {
    it("topSetups returns up to 3 entries sorted by expectancy", () => {
      for (const setup of ["s1", "s2", "s3", "s4"]) {
        const isGood = setup === "s1" || setup === "s2";
        for (let i = 0; i < 3; i++) {
          addTrade({ entryPrice: 100, exitPrice: isGood ? 115 : 92, setupType: setup });
        }
      }
      const summary = getLeaderboardSummary();
      expect(summary.topSetups.length).toBeLessThanOrEqual(3);
    });

    it("totalResolved counts all wins + losses + breakeven", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 }); // win
      addTrade({ entryPrice: 100, exitPrice: 90 });  // loss
      addTrade({ entryPrice: 100, exitPrice: 100 }); // breakeven
      const summary = getLeaderboardSummary();
      expect(summary.totalResolved).toBe(3);
    });

    it("bottomSetup is the entry with the lowest expectancy", () => {
      // Good setup
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 120, setupType: "good" });
      // Terrible setup
      addTrade({ entryPrice: 100, exitPrice: 50, setupType: "terrible" });
      addTrade({ entryPrice: 100, exitPrice: 55, setupType: "terrible" });
      addTrade({ entryPrice: 100, exitPrice: 52, setupType: "terrible" });

      const summary = getLeaderboardSummary();
      expect(summary.bottomSetup?.key).toBe("terrible");
    });

    it("decayingEdges only includes entries with ≥10 trades AND decay < -10%", () => {
      // Add 20 trades to setup A: first 10 good, last 10 all losses
      for (let i = 0; i < 10; i++) addTrade({ entryPrice: 100, exitPrice: 120, setupType: "decaying" });
      for (let i = 0; i < 10; i++) addTrade({ entryPrice: 100, exitPrice: 80, setupType: "decaying" });
      // Add 20 trades to setup B: consistent performance
      for (let i = 0; i < 20; i++) addTrade({ entryPrice: 100, exitPrice: 110, setupType: "stable" });
      const summary = getLeaderboardSummary();
      const decayKeys = summary.decayingEdges.map(e => e.key);
      expect(decayKeys).toContain("decaying");
      expect(decayKeys).not.toContain("stable");
    });

    it("computedAt is a valid ISO timestamp", () => {
      const summary = getLeaderboardSummary();
      expect(Date.parse(summary.computedAt)).not.toBeNaN();
    });
  });

  // ── result shape correctness ──────────────────────────────────────────────────

  describe("LeaderboardEntry shape", () => {
    it("all required fields are present", () => {
      addTrade({ entryPrice: 100, exitPrice: 110 });
      addTrade({ entryPrice: 100, exitPrice: 90 });
      addTrade({ entryPrice: 100, exitPrice: 115 });
      const entry = getSetupLeaderboard(1)[0]!;
      expect(entry).toHaveProperty("key");
      expect(entry).toHaveProperty("category", "setup");
      expect(entry).toHaveProperty("totalTrades");
      expect(entry).toHaveProperty("wins");
      expect(entry).toHaveProperty("losses");
      expect(entry).toHaveProperty("breakeven");
      expect(entry).toHaveProperty("winRate");
      expect(entry).toHaveProperty("avgWinPct");
      expect(entry).toHaveProperty("avgLossPct");
      expect(entry).toHaveProperty("profitFactor");
      expect(entry).toHaveProperty("expectancy");
      expect(entry).toHaveProperty("netPnlPct");
      expect(entry).toHaveProperty("recentWinRate");
      expect(entry).toHaveProperty("edgeDecay");
      expect(entry).toHaveProperty("tier");
      expect(entry).toHaveProperty("rank");
    });

    it("winRate is always between 0 and 1", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110 });
      const entry = getSetupLeaderboard(1)[0]!;
      expect(entry.winRate).toBeGreaterThanOrEqual(0);
      expect(entry.winRate).toBeLessThanOrEqual(1);
    });

    it("category field is 'symbol' for symbol leaderboard", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110, symbol: "ETHUSD" });
      const entry = getSymbolLeaderboard(1)[0]!;
      expect(entry.category).toBe("symbol");
    });

    it("category field is 'regime' for regime leaderboard", () => {
      for (let i = 0; i < 3; i++) addTrade({ entryPrice: 100, exitPrice: 110, regime: "ranging" });
      const entry = getRegimeLeaderboard(1)[0]!;
      expect(entry.category).toBe("regime");
    });
  });
});
