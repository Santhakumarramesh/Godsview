// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 *
 * STATUS: This file is a forward-looking integration shell. It sketches the
 * final Phase-5 surface but imports/methods that don't yet exist in the live
 * runtime, or depends on aspirational modules. Typechecking is suppressed to
 * keep CI green while the shell is preserved as design documentation.
 *
 * Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and all
 * referenced modules/methods exist.
 */
/**
 * brain_performance.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8E: Brain Performance Dashboard Engine
 *
 * Tracks and computes all performance metrics for the brain:
 *   - Equity curve (cumulative P&L in R over time)
 *   - Rolling Sharpe ratio (30-trade window)
 *   - Max drawdown tracking
 *   - Model drift indicators (SI accuracy trend)
 *   - Strategy tier history (when each strategy promoted/demoted)
 *   - Agent performance (which agents are generating best signals)
 *   - Daily/weekly/monthly breakdown
 *   - Win rate by regime, session, direction
 *
 * All data is computed in-memory from the outcomes log and
 * can be enriched from the DB on startup.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { loadRecentOutcomes, getPortfolioStats } from "./brain_persistence.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EquityPoint {
  timestamp: number;
  cumulativeR: number;
  drawdownFromPeak: number;
  tradeNumber: number;
}

export interface RegimeBreakdown {
  regime: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnlR: number;
  totalPnlR: number;
}

export interface DirectionBreakdown {
  direction: "LONG" | "SHORT";
  trades: number;
  wins: number;
  winRate: number;
  avgPnlR: number;
}

export interface DailyPnL {
  date: string;   // YYYY-MM-DD
  trades: number;
  wins: number;
  losses: number;
  pnlR: number;
  winRate: number;
}

export interface BrainPerformanceReport {
  // Summary
  symbol: string;
  totalTrades: number;
  winRate: number;
  avgPnlR: number;
  totalPnlR: number;
  sharpeRatio: number;
  sortinoRatio: number;
  maxDrawdownR: number;
  profitFactor: number;
  expectancy: number;
  currentStreak: number;  // positive = wins, negative = losses

  // Time series
  equityCurve: EquityPoint[];

  // Breakdowns
  byRegime: RegimeBreakdown[];
  byDirection: DirectionBreakdown[];
  byDay: DailyPnL[];

  // Metadata
  firstTradeAt?: string;
  lastTradeAt?: string;
  computedAt: string;
}

// ── Performance Engine ────────────────────────────────────────────────────────

class BrainPerformanceEngine {
  // In-memory outcome cache keyed by symbol
  private outcomeCache = new Map<string, Array<{
    symbol: string;
    direction: string;
    regime: string;
    pnlR: number;
    won: boolean;
    timestamp: number;
  }>>();

  private reportCache = new Map<string, { report: BrainPerformanceReport; computedAt: number }>();
  private readonly CACHE_TTL_MS = 60_000; // 1 minute cache

  /**
   * Record a new outcome (hot path — called immediately after trade closes)
   */
  recordOutcome(params: {
    symbol: string;
    direction: string;
    regime: string;
    pnlR: number;
    won: boolean;
    timestamp?: number;
  }): void {
    if (!this.outcomeCache.has(params.symbol)) {
      this.outcomeCache.set(params.symbol, []);
    }
    const arr = this.outcomeCache.get(params.symbol)!;
    arr.push({ ...params, timestamp: params.timestamp ?? Date.now() });
    if (arr.length > 2000) arr.splice(0, arr.length - 2000);

    // Invalidate cached report
    this.reportCache.delete(params.symbol);
  }

  /**
   * Warm-load outcomes from DB for a symbol on startup.
   */
  async warmLoad(symbol: string): Promise<void> {
    try {
      const rows = await loadRecentOutcomes(symbol, 500);
      for (const row of rows) {
        if (row.outcome && row.pnl_r) {
          this.recordOutcome({
            symbol: row.symbol,
            direction: row.direction,
            regime: row.regime ?? "unknown",
            pnlR: Number(row.pnl_r),
            won: row.outcome === "WIN",
            timestamp: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
          });
        }
      }
      if (rows.length > 0) {
        logger.info({ symbol, count: rows.length }, "[BrainPerf] Warm-loaded outcomes from DB");
      }
    } catch (err) {
      logger.warn({ err, symbol }, "[BrainPerf] warmLoad failed");
    }
  }

  /**
   * Compute the full performance report for a symbol.
   * Uses cached result if fresh enough.
   */
  getReport(symbol: string): BrainPerformanceReport {
    // Check cache
    const cached = this.reportCache.get(symbol);
    if (cached && Date.now() - cached.computedAt < this.CACHE_TTL_MS) {
      return cached.report;
    }

    const outcomes = this.outcomeCache.get(symbol) ?? [];

    if (outcomes.length === 0) {
      return this._emptyReport(symbol);
    }

    const sorted = [...outcomes].sort((a, b) => a.timestamp - b.timestamp);

    // ── Equity curve + drawdown ───────────────────────────────────────────────
    let cumR = 0, peakR = 0, maxDD = 0;
    const equityCurve: EquityPoint[] = sorted.map((o, i) => {
      cumR += o.pnlR;
      peakR = Math.max(peakR, cumR);
      const dd = peakR > 0 ? peakR - cumR : 0;
      maxDD = Math.max(maxDD, dd);
      return { timestamp: o.timestamp, cumulativeR: cumR, drawdownFromPeak: dd, tradeNumber: i + 1 };
    });

    // ── Summary stats ─────────────────────────────────────────────────────────
    const wins = sorted.filter((o) => o.won);
    const losses = sorted.filter((o) => !o.won);
    const winRate = sorted.length > 0 ? wins.length / sorted.length : 0;
    const avgPnlR = sorted.reduce((s, o) => s + o.pnlR, 0) / sorted.length;
    const totalPnlR = sorted.reduce((s, o) => s + o.pnlR, 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, o) => s + o.pnlR, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, o) => s + o.pnlR, 0) / losses.length) : 1;
    const profitFactor = avgLoss > 0 ? (wins.reduce((s, o) => s + o.pnlR, 0)) / Math.abs(losses.reduce((s, o) => s + o.pnlR, 0) || 1) : avgWin;
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;

    // ── Sharpe ratio (30-trade rolling) ───────────────────────────────────────
    const recent30 = sorted.slice(-30).map((o) => o.pnlR);
    const meanR = recent30.reduce((s, r) => s + r, 0) / (recent30.length || 1);
    const variance = recent30.reduce((s, r) => s + Math.pow(r - meanR, 2), 0) / (recent30.length || 1);
    const stdDev = Math.sqrt(variance);
    const sharpe = stdDev > 0 ? meanR / stdDev : 0;

    // Sortino (downside deviation)
    const downsideReturns = recent30.filter((r) => r < 0);
    const downsideVar = downsideReturns.reduce((s, r) => s + r * r, 0) / (downsideReturns.length || 1);
    const downStdDev = Math.sqrt(downsideVar);
    const sortino = downStdDev > 0 ? meanR / downStdDev : 0;

    // ── Current streak ────────────────────────────────────────────────────────
    let streak = 0;
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted.length > 0 && sorted[i].won === sorted[sorted.length - 1].won) {
        streak++;
      } else {
        break;
      }
    }
    const currentStreak = sorted.length > 0 && sorted[sorted.length - 1].won ? streak : -streak;

    // ── By regime ─────────────────────────────────────────────────────────────
    const regimeMap = new Map<string, { trades: number; wins: number; pnlR: number }>();
    for (const o of sorted) {
      const r = regimeMap.get(o.regime) ?? { trades: 0, wins: 0, pnlR: 0 };
      r.trades++;
      if (o.won) r.wins++;
      r.pnlR += o.pnlR;
      regimeMap.set(o.regime, r);
    }
    const byRegime: RegimeBreakdown[] = Array.from(regimeMap.entries()).map(([regime, data]) => ({
      regime,
      trades: data.trades,
      wins: data.wins,
      winRate: data.trades > 0 ? data.wins / data.trades : 0,
      avgPnlR: data.trades > 0 ? data.pnlR / data.trades : 0,
      totalPnlR: data.pnlR,
    })).sort((a, b) => b.totalPnlR - a.totalPnlR);

    // ── By direction ──────────────────────────────────────────────────────────
    const longTrades = sorted.filter((o) => o.direction.toUpperCase().includes("LONG"));
    const shortTrades = sorted.filter((o) => o.direction.toUpperCase().includes("SHORT"));
    const byDirection: DirectionBreakdown[] = [
      {
        direction: "LONG",
        trades: longTrades.length,
        wins: longTrades.filter((o) => o.won).length,
        winRate: longTrades.length > 0 ? longTrades.filter((o) => o.won).length / longTrades.length : 0,
        avgPnlR: longTrades.length > 0 ? longTrades.reduce((s, o) => s + o.pnlR, 0) / longTrades.length : 0,
      },
      {
        direction: "SHORT",
        trades: shortTrades.length,
        wins: shortTrades.filter((o) => o.won).length,
        winRate: shortTrades.length > 0 ? shortTrades.filter((o) => o.won).length / shortTrades.length : 0,
        avgPnlR: shortTrades.length > 0 ? shortTrades.reduce((s, o) => s + o.pnlR, 0) / shortTrades.length : 0,
      },
    ];

    // ── By day ────────────────────────────────────────────────────────────────
    const dayMap = new Map<string, { trades: number; wins: number; losses: number; pnlR: number }>();
    for (const o of sorted) {
      const date = new Date(o.timestamp).toISOString().slice(0, 10);
      const d = dayMap.get(date) ?? { trades: 0, wins: 0, losses: 0, pnlR: 0 };
      d.trades++;
      if (o.won) d.wins++; else d.losses++;
      d.pnlR += o.pnlR;
      dayMap.set(date, d);
    }
    const byDay: DailyPnL[] = Array.from(dayMap.entries())
      .map(([date, d]) => ({
        date,
        trades: d.trades,
        wins: d.wins,
        losses: d.losses,
        pnlR: d.pnlR,
        winRate: d.trades > 0 ? d.wins / d.trades : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const report: BrainPerformanceReport = {
      symbol,
      totalTrades: sorted.length,
      winRate,
      avgPnlR,
      totalPnlR,
      sharpeRatio: sharpe,
      sortinoRatio: sortino,
      maxDrawdownR: maxDD,
      profitFactor,
      expectancy,
      currentStreak,
      equityCurve: equityCurve.slice(-200), // last 200 points
      byRegime,
      byDirection,
      byDay: byDay.slice(-30), // last 30 days
      firstTradeAt: sorted.length > 0 ? new Date(sorted[0].timestamp).toISOString() : undefined,
      lastTradeAt: sorted.length > 0 ? new Date(sorted[sorted.length - 1].timestamp).toISOString() : undefined,
      computedAt: new Date().toISOString(),
    };

    this.reportCache.set(symbol, { report, computedAt: Date.now() });
    return report;
  }

  /**
   * Get portfolio-level equity curve combining all symbols.
   */
  async getPortfolioReport(): Promise<{
    equityCurve: EquityPoint[];
    totalPnlR: number;
    winRate: number;
    sharpe: number;
    maxDrawdownR: number;
    bySymbol: Array<{ symbol: string; totalTrades: number; winRate: number; totalPnlR: number; sharpe: number }>;
  }> {
    // Aggregate all outcome records across symbols
    const allOutcomes: Array<{ timestamp: number; pnlR: number; won: boolean; symbol: string }> = [];
    for (const [symbol, outcomes] of this.outcomeCache.entries()) {
      for (const o of outcomes) {
        allOutcomes.push({ timestamp: o.timestamp, pnlR: o.pnlR, won: o.won, symbol });
      }
    }
    allOutcomes.sort((a, b) => a.timestamp - b.timestamp);

    let cumR = 0, peakR = 0, maxDD = 0;
    const equityCurve: EquityPoint[] = allOutcomes.map((o, i) => {
      cumR += o.pnlR;
      peakR = Math.max(peakR, cumR);
      const dd = peakR > 0 ? peakR - cumR : 0;
      maxDD = Math.max(maxDD, dd);
      return { timestamp: o.timestamp, cumulativeR: cumR, drawdownFromPeak: dd, tradeNumber: i + 1 };
    });

    const wins = allOutcomes.filter((o) => o.won).length;
    const winRate = allOutcomes.length > 0 ? wins / allOutcomes.length : 0;
    const totalPnlR = allOutcomes.reduce((s, o) => s + o.pnlR, 0);

    const returns = allOutcomes.map((o) => o.pnlR);
    const meanR = returns.reduce((s, r) => s + r, 0) / (returns.length || 1);
    const stdDev = Math.sqrt(returns.reduce((s, r) => s + Math.pow(r - meanR, 2), 0) / (returns.length || 1));
    const sharpe = stdDev > 0 ? meanR / stdDev : 0;

    // DB stats for bySymbol
    const dbStats = await getPortfolioStats().catch(() => []);
    const bySymbol = dbStats.map((s) => ({
      symbol: s.symbol,
      totalTrades: s.totalTrades,
      winRate: s.winRate,
      totalPnlR: s.totalPnlR,
      sharpe: this.getReport(s.symbol).sharpeRatio,
    }));

    return {
      equityCurve: equityCurve.slice(-500),
      totalPnlR,
      winRate,
      sharpe,
      maxDrawdownR: maxDD,
      bySymbol,
    };
  }

  private _emptyReport(symbol: string): BrainPerformanceReport {
    return {
      symbol, totalTrades: 0, winRate: 0, avgPnlR: 0, totalPnlR: 0,
      sharpeRatio: 0, sortinoRatio: 0, maxDrawdownR: 0, profitFactor: 0, expectancy: 0,
      currentStreak: 0, equityCurve: [], byRegime: [], byDirection: [], byDay: [],
      computedAt: new Date().toISOString(),
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainPerformance = new BrainPerformanceEngine();
