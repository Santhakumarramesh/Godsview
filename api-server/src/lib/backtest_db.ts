/**
 * backtest_db.ts — Bulk Backtest Outcome Database
 *
 * In-memory store for historical replay outcomes, supporting:
 *   - Inserting replay reports (single or batch)
 *   - Querying by symbol, regime, direction, date range
 *   - Statistical aggregation: win rate, expectancy, avg R, Sharpe proxy
 *   - Regime comparison: bullish vs bearish vs range context
 *   - Setup effectiveness: which trigger combinations have highest edge
 *
 * Thread-safe for sequential access (Node.js single-threaded).
 * Designed to be populated by runReplay / runMultiSymbolReplay.
 */

import type { SetupOutcome, ReplayReport } from "./historical_replay";

// ── Types ──────────────────────────────────────────────────────────────────────

export type Regime = "bullish" | "bearish" | "range";

export interface BacktestRecord {
  id: string;
  symbol: string;
  regime: Regime;
  /** ISO timestamp of the setup trigger bar */
  timestamp: string;
  direction: "long" | "short";
  /** Entry price */
  entryPrice: number;
  /** Confidence score 0–1 */
  confidence: number;
  /** Trigger labels (e.g. BOS_UP, near_OB) */
  triggers: string[];
  /** Whether the trade won */
  won: boolean;
  /** R-multiple achieved */
  rMultiple: number;
  /** Bars held before exit */
  barsHeld: number;
  /** Risk points (entry → stop) */
  riskPoints: number;
}

export interface QueryFilter {
  symbol?: string;
  regime?: Regime;
  direction?: "long" | "short";
  minConfidence?: number;
  minRisk?: number;
  /** ISO date string — only include records on/after this date */
  fromDate?: string;
  /** ISO date string — only include records on/before this date */
  toDate?: string;
  /** Include only records whose triggers array contains ALL of these */
  requiredTriggers?: string[];
}

export interface AggregateStats {
  count: number;
  winRate: number;
  avgRMultiple: number;
  expectancy: number;
  totalR: number;
  avgBarsHeld: number;
  avgConfidence: number;
  /** Simple Sharpe proxy: avgR / stdR */
  sharpeProxy: number;
  maxWin: number;
  maxLoss: number;
  profitFactor: number;
}

export interface RegimeBreakdown {
  bullish: AggregateStats;
  bearish: AggregateStats;
  range: AggregateStats;
}

export interface TriggerStats {
  trigger: string;
  count: number;
  winRate: number;
  avgRMultiple: number;
  expectancy: number;
}

// ── BacktestDatabase ──────────────────────────────────────────────────────────

export class BacktestDatabase {
  private records: BacktestRecord[] = [];
  private nextId = 1;

  /** Insert a single outcome record */
  insert(record: Omit<BacktestRecord, "id">): BacktestRecord {
    const full: BacktestRecord = { id: String(this.nextId++), ...record };
    this.records.push(full);
    return full;
  }

  /**
   * Ingest all resolved outcomes from a ReplayReport.
   * Maps the SMC structure trend to a Regime label.
   */
  ingestReport(report: ReplayReport): number {
    const regime = trendToRegime(report.smcStructure.trend);
    let inserted = 0;

    for (const outcome of report.outcomes) {
      this.insert({
        symbol: report.symbol,
        regime,
        timestamp: outcome.setup.timestamp,
        direction: outcome.setup.direction,
        entryPrice: outcome.setup.entryPrice,
        confidence: outcome.setup.confidence,
        triggers: outcome.setup.triggers,
        won: outcome.won,
        rMultiple: outcome.rMultiple,
        barsHeld: outcome.barsHeld,
        riskPoints: outcome.setup.riskPoints,
      });
      inserted++;
    }

    return inserted;
  }

  /** Query records with optional filter */
  query(filter: QueryFilter = {}): BacktestRecord[] {
    return this.records.filter((r) => matchesFilter(r, filter));
  }

  /** Compute aggregate statistics for a filtered set */
  aggregate(filter: QueryFilter = {}): AggregateStats {
    const rows = this.query(filter);
    return computeStats(rows);
  }

  /** Break down performance by market regime */
  regimeBreakdown(filter: Omit<QueryFilter, "regime"> = {}): RegimeBreakdown {
    return {
      bullish: computeStats(this.query({ ...filter, regime: "bullish" })),
      bearish: computeStats(this.query({ ...filter, regime: "bearish" })),
      range:   computeStats(this.query({ ...filter, regime: "range" })),
    };
  }

  /**
   * Rank individual trigger labels by edge (expectancy).
   * Each trigger is evaluated in isolation.
   */
  triggerLeaderboard(filter: QueryFilter = {}): TriggerStats[] {
    const rows = this.query(filter);
    const byTrigger = new Map<string, BacktestRecord[]>();

    for (const r of rows) {
      for (const t of r.triggers) {
        if (!byTrigger.has(t)) byTrigger.set(t, []);
        byTrigger.get(t)!.push(r);
      }
    }

    const out: TriggerStats[] = [];
    for (const [trigger, trigRows] of byTrigger.entries()) {
      const stats = computeStats(trigRows);
      out.push({
        trigger,
        count: stats.count,
        winRate: stats.winRate,
        avgRMultiple: stats.avgRMultiple,
        expectancy: stats.expectancy,
      });
    }

    return out.sort((a, b) => b.expectancy - a.expectancy);
  }

  /** Return symbol-level performance summary */
  symbolSummary(): Array<{ symbol: string } & AggregateStats> {
    const bySymbol = new Map<string, BacktestRecord[]>();
    for (const r of this.records) {
      if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
      bySymbol.get(r.symbol)!.push(r);
    }

    return [...bySymbol.entries()]
      .map(([symbol, rows]) => ({ symbol, ...computeStats(rows) }))
      .sort((a, b) => b.expectancy - a.expectancy);
  }

  /** Total record count */
  get size(): number {
    return this.records.length;
  }

  /** Clear all records (useful for testing) */
  clear(): void {
    this.records = [];
    this.nextId = 1;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const backtestDb = new BacktestDatabase();

// ── Internal helpers ───────────────────────────────────────────────────────────

function trendToRegime(trend: string): Regime {
  if (trend === "bullish") return "bullish";
  if (trend === "bearish") return "bearish";
  return "range";
}

function matchesFilter(r: BacktestRecord, f: QueryFilter): boolean {
  if (f.symbol && r.symbol !== f.symbol) return false;
  if (f.regime && r.regime !== f.regime) return false;
  if (f.direction && r.direction !== f.direction) return false;
  if (f.minConfidence !== undefined && r.confidence < f.minConfidence) return false;
  if (f.minRisk !== undefined && r.riskPoints < f.minRisk) return false;
  if (f.fromDate && r.timestamp < f.fromDate) return false;
  if (f.toDate && r.timestamp > f.toDate) return false;
  if (f.requiredTriggers && f.requiredTriggers.length > 0) {
    for (const t of f.requiredTriggers) {
      if (!r.triggers.includes(t)) return false;
    }
  }
  return true;
}

function computeStats(rows: BacktestRecord[]): AggregateStats {
  if (rows.length === 0) {
    return {
      count: 0, winRate: 0, avgRMultiple: 0, expectancy: 0, totalR: 0,
      avgBarsHeld: 0, avgConfidence: 0, sharpeProxy: 0, maxWin: 0,
      maxLoss: 0, profitFactor: 0,
    };
  }

  const wins = rows.filter((r) => r.won);
  const losses = rows.filter((r) => !r.won);
  const winRate = wins.length / rows.length;

  const rValues = rows.map((r) => r.rMultiple);
  const totalR = rValues.reduce((s, v) => s + v, 0);
  const avgRMultiple = totalR / rows.length;

  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r.rMultiple, 0) / wins.length : 0;
  const avgLossAbs = losses.length > 0 ? Math.abs(losses.reduce((s, r) => s + r.rMultiple, 0) / losses.length) : 0;
  const expectancy = winRate * avgWin - (1 - winRate) * avgLossAbs;

  const avgBarsHeld = rows.reduce((s, r) => s + r.barsHeld, 0) / rows.length;
  const avgConfidence = rows.reduce((s, r) => s + r.confidence, 0) / rows.length;

  // Sharpe proxy
  const mean = avgRMultiple;
  const variance = rValues.reduce((s, v) => s + (v - mean) ** 2, 0) / rows.length;
  const stdR = Math.sqrt(variance);
  const sharpeProxy = stdR > 0 ? mean / stdR : 0;

  const maxWin = wins.length > 0 ? Math.max(...wins.map((r) => r.rMultiple)) : 0;
  const maxLoss = losses.length > 0 ? Math.min(...losses.map((r) => r.rMultiple)) : 0;

  const grossWins = wins.reduce((s, r) => s + r.rMultiple, 0);
  const grossLosses = Math.abs(losses.reduce((s, r) => s + r.rMultiple, 0));
  const profitFactor = grossLosses > 0 ? grossWins / grossLosses : grossWins > 0 ? Infinity : 0;

  return {
    count: rows.length,
    winRate: r4(winRate),
    avgRMultiple: r4(avgRMultiple),
    expectancy: r4(expectancy),
    totalR: r4(totalR),
    avgBarsHeld: r4(avgBarsHeld),
    avgConfidence: r4(avgConfidence),
    sharpeProxy: r4(sharpeProxy),
    maxWin: r4(maxWin),
    maxLoss: r4(maxLoss),
    profitFactor: isFinite(profitFactor) ? r4(profitFactor) : profitFactor,
  };
}

function r4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
