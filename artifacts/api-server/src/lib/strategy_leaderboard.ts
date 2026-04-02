/**
 * strategy_leaderboard.ts — Phase 22: Strategy Performance Leaderboard
 *
 * Computes EV-ranked performance tables from the live trade journal:
 *   - Per-setup rankings (win rate, profit factor, expectancy, edge decay)
 *   - Per-symbol rankings
 *   - Per-regime rankings
 *   - Top/bottom performers summary + edge-decaying setups alert
 *
 * All computations are pure over in-memory journal data — no DB queries.
 */

import { listJournalEntries } from "./trade_journal";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LeaderboardTier = "elite" | "strong" | "average" | "weak" | "avoid";
export type LeaderboardCategory = "setup" | "symbol" | "regime";

export interface LeaderboardEntry {
  /** Dimension value (setup name, symbol, or regime label) */
  key: string;
  category: LeaderboardCategory;
  totalTrades: number;
  wins: number;
  losses: number;
  breakeven: number;
  /** Win fraction 0..1 (excludes breakeven) */
  winRate: number;
  /** Average win magnitude as positive fraction (e.g. 0.02 = 2%) */
  avgWinPct: number;
  /** Average loss magnitude as positive fraction (e.g. 0.01 = 1%) */
  avgLossPct: number;
  /** Gross wins / gross losses; Infinity when no losses */
  profitFactor: number;
  /**
   * Per-trade expectancy as a fraction:
   *   (winRate × avgWinPct) − (lossRate × avgLossPct)
   */
  expectancy: number;
  /** Sum of all resolved pnlPct values */
  netPnlPct: number;
  /** Win rate of the most recent RECENT_WINDOW trades */
  recentWinRate: number;
  /**
   * Edge decay score: recentWinRate − winRate
   * Negative → edge is weakening recently; positive → momentum
   */
  edgeDecay: number;
  /** Performance tier assigned by expectancy + profitFactor */
  tier: LeaderboardTier;
  /** Ordinal rank within its category (1 = best) */
  rank: number;
}

export interface LeaderboardSummary {
  /** Top 3 by expectancy across all setups */
  topSetups: LeaderboardEntry[];
  /** Top 3 symbols by net PnL */
  topSymbols: LeaderboardEntry[];
  /** Regime with highest win rate (min 5 trades) */
  bestRegime: LeaderboardEntry | null;
  /** Setups with significant negative edge decay (decaying edge alert) */
  decayingEdges: LeaderboardEntry[];
  /** Worst setup by expectancy (to consider disabling) */
  bottomSetup: LeaderboardEntry | null;
  /** Total resolved trades counted in the leaderboard */
  totalResolved: number;
  /** ISO timestamp of when this summary was computed */
  computedAt: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum resolved trades before an entry appears in rankings */
const MIN_TRADES_DEFAULT = 3;

/** Window size for edge-decay calculation (most-recent N trades per key) */
const RECENT_WINDOW = 10;

/** Edge decay threshold: if recentWinRate − winRate < this, flag as decaying */
const DECAY_THRESHOLD = -0.10; // -10 percentage points

// ─── Core helpers ─────────────────────────────────────────────────────────────

interface RawStat {
  wins: number;
  losses: number;
  breakeven: number;
  sumWinPct: number;   // sum of positive pnlPct
  sumLossPct: number;  // sum of absolute negative pnlPct
  netPnlPct: number;   // algebraic sum
  /** timestamps for the trades, in order added */
  timestamps: string[];
  /** outcomes in insertion order (for recent-window decay) */
  recentOutcomes: Array<"win" | "loss" | "breakeven">;
}

function newRawStat(): RawStat {
  return {
    wins: 0, losses: 0, breakeven: 0,
    sumWinPct: 0, sumLossPct: 0, netPnlPct: 0,
    timestamps: [], recentOutcomes: [],
  };
}

/** Convert a raw accumulator → LeaderboardEntry (rank/tier filled later) */
function toEntry(key: string, category: LeaderboardCategory, stat: RawStat): LeaderboardEntry {
  const total = stat.wins + stat.losses + stat.breakeven;
  if (total === 0) {
    return {
      key, category, totalTrades: 0, wins: 0, losses: 0, breakeven: 0,
      winRate: 0, avgWinPct: 0, avgLossPct: 0,
      profitFactor: 0, expectancy: 0, netPnlPct: 0,
      recentWinRate: 0, edgeDecay: 0, tier: "avoid", rank: 0,
    };
  }

  const decidingTrades = stat.wins + stat.losses; // exclude breakeven from rates
  const winRate = decidingTrades > 0 ? stat.wins / decidingTrades : 0;
  const lossRate = 1 - winRate;

  const avgWinPct  = stat.wins   > 0 ? stat.sumWinPct  / stat.wins   : 0;
  const avgLossPct = stat.losses > 0 ? stat.sumLossPct / stat.losses : 0;

  const profitFactor = stat.sumLossPct > 0
    ? stat.sumWinPct / stat.sumLossPct
    : stat.sumWinPct > 0 ? Infinity : 0;

  const expectancy = (winRate * avgWinPct) - (lossRate * avgLossPct);

  // Recent window: most-recent RECENT_WINDOW trades.
  // listJournalEntries() returns newest-first, so recentOutcomes is
  // already in newest-first order; slice(0, N) gives the N most recent.
  const recentSlice = stat.recentOutcomes.slice(0, RECENT_WINDOW);
  const recentDeciding = recentSlice.filter(o => o === "win" || o === "loss");
  const recentWins = recentSlice.filter(o => o === "win").length;
  const recentWinRate = recentDeciding.length > 0 ? recentWins / recentDeciding.length : winRate;
  const edgeDecay = decidingTrades >= RECENT_WINDOW ? recentWinRate - winRate : 0;

  const tier = assignTier(expectancy, profitFactor);

  return {
    key, category, totalTrades: total,
    wins: stat.wins, losses: stat.losses, breakeven: stat.breakeven,
    winRate, avgWinPct, avgLossPct,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 999,
    expectancy, netPnlPct: stat.netPnlPct,
    recentWinRate, edgeDecay, tier, rank: 0,
  };
}

/** Classify performance tier from expectancy + profit factor */
function assignTier(expectancy: number, profitFactor: number): LeaderboardTier {
  if (expectancy >= 0.015 && profitFactor >= 2.0) return "elite";
  if (expectancy >= 0.008 && profitFactor >= 1.5) return "strong";
  if (expectancy >= 0.002 && profitFactor >= 1.0) return "average";
  if (expectancy >= -0.005) return "weak";
  return "avoid";
}

/** Sort entries by expectancy DESC, assign ranks, filter by minTrades */
function rankEntries(entries: LeaderboardEntry[], minTrades: number): LeaderboardEntry[] {
  const filtered = entries.filter(e => e.totalTrades >= minTrades);
  filtered.sort((a, b) => b.expectancy - a.expectancy);
  filtered.forEach((e, i) => { e.rank = i + 1; });
  return filtered;
}

// ─── Accumulation ─────────────────────────────────────────────────────────────

type Accumulator = Map<string, RawStat>;

function accumulate(
  groupFn: (entry: { setupType: string; symbol: string; regime: string }) => string,
): Accumulator {
  // Only resolved (win/loss/breakeven) trades count — pending/blocked don't
  const entries = listJournalEntries({ limit: 0 }).filter(
    e =>
      (e.outcome === "win" || e.outcome === "loss" || e.outcome === "breakeven") &&
      e.pnlPct !== null,
  );

  const acc: Accumulator = new Map();

  for (const e of entries) {
    const key = groupFn({ setupType: e.setupType, symbol: e.symbol, regime: e.regime ?? "unknown" });
    if (!acc.has(key)) acc.set(key, newRawStat());
    const stat = acc.get(key)!;

    const pnl = e.pnlPct ?? 0;
    stat.netPnlPct += pnl;
    stat.timestamps.push(e.decidedAt);

    if (e.outcome === "win") {
      stat.wins++;
      stat.sumWinPct += Math.abs(pnl);
      stat.recentOutcomes.push("win");
    } else if (e.outcome === "loss") {
      stat.losses++;
      stat.sumLossPct += Math.abs(pnl);
      stat.recentOutcomes.push("loss");
    } else {
      stat.breakeven++;
      stat.recentOutcomes.push("breakeven");
    }
  }

  return acc;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns setup rankings sorted by expectancy (best first).
 * @param minTrades  Minimum resolved trades required to appear (default 3)
 */
export function getSetupLeaderboard(minTrades = MIN_TRADES_DEFAULT): LeaderboardEntry[] {
  const acc = accumulate(e => e.setupType || "unknown");
  const entries = Array.from(acc.entries()).map(([key, stat]) =>
    toEntry(key, "setup", stat),
  );
  return rankEntries(entries, minTrades);
}

/**
 * Returns symbol rankings sorted by expectancy (best first).
 */
export function getSymbolLeaderboard(minTrades = MIN_TRADES_DEFAULT): LeaderboardEntry[] {
  const acc = accumulate(e => e.symbol || "unknown");
  const entries = Array.from(acc.entries()).map(([key, stat]) =>
    toEntry(key, "symbol", stat),
  );
  return rankEntries(entries, minTrades);
}

/**
 * Returns regime rankings sorted by expectancy (best first).
 */
export function getRegimeLeaderboard(minTrades = MIN_TRADES_DEFAULT): LeaderboardEntry[] {
  const acc = accumulate(e => e.regime || "unknown");
  const entries = Array.from(acc.entries()).map(([key, stat]) =>
    toEntry(key, "regime", stat),
  );
  return rankEntries(entries, minTrades);
}

/**
 * High-level summary: top performers, decaying edges, worst setup.
 */
export function getLeaderboardSummary(): LeaderboardSummary {
  const setups  = getSetupLeaderboard(1);
  const symbols = getSymbolLeaderboard(1);
  const regimes = getRegimeLeaderboard(5);

  const topSetups  = setups.slice(0, 3);
  const topSymbols = [...symbols].sort((a, b) => b.netPnlPct - a.netPnlPct).slice(0, 3);
  const bestRegime = regimes.length > 0 ? regimes[0]! : null;

  const decayingEdges = setups.filter(
    e => e.totalTrades >= RECENT_WINDOW && e.edgeDecay < DECAY_THRESHOLD,
  );

  const bottomSetup = setups.length > 0
    ? [...setups].sort((a, b) => a.expectancy - b.expectancy)[0]!
    : null;

  const totalResolved = listJournalEntries({ limit: 0 }).filter(
    e => e.outcome === "win" || e.outcome === "loss" || e.outcome === "breakeven",
  ).length;

  return {
    topSetups,
    topSymbols,
    bestRegime,
    decayingEdges,
    bottomSetup,
    totalResolved,
    computedAt: new Date().toISOString(),
  };
}
