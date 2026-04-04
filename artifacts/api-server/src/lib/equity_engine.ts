/**
 * equity_engine.ts — Portfolio Performance & Equity Curve Engine
 *
 * Computes performance metrics from resolved TradeJournalEntries:
 *   - Equity curve (cumulative daily returns, normalised to 100)
 *   - Drawdown series (point-in-time % from peak)
 *   - Sharpe / Sortino / Calmar ratios
 *   - Win / loss streaks
 *   - Breakdown by setup type, symbol, regime, macro conviction
 *
 * All calculations work entirely from the in-memory journal —
 * no additional DB queries needed.
 */

import { listJournalEntries } from "./trade_journal";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EquityPoint {
  /** ISO date (YYYY-MM-DD) */
  date:          string;
  /** Cumulative return starting from 100 */
  equity:        number;
  /** Daily return as a fraction (e.g. 0.02 = +2%) */
  dailyReturn:   number;
  /** Draw from all-time peak as a fraction (e.g. -0.05 = -5% drawdown) */
  drawdown:      number;
  /** Number of resolved trades on this day */
  tradeCount:    number;
  wins:          number;
  losses:        number;
}

export interface PerformanceMetrics {
  /** Total resolved trades */
  totalTrades:        number;
  wins:               number;
  losses:             number;
  breakeven:          number;
  winRate:            number;
  /** Average win as fraction */
  avgWinPct:          number;
  /** Average loss as fraction (positive = loss magnitude) */
  avgLossPct:         number;
  /** Profit factor = gross wins / gross losses */
  profitFactor:       number;
  /** Average risk-reward ratio (avg win / avg loss) */
  avgRR:              number;
  /** Expectancy per trade as a fraction */
  expectancy:         number;
  /** Annualised Sharpe ratio (daily returns, rf=0) */
  sharpeRatio:        number;
  /** Sortino ratio (downside deviation only) */
  sortinoRatio:       number;
  /** Calmar ratio (annualised return / max drawdown) */
  calmarRatio:        number;
  /** Maximum drawdown experienced (fraction, positive = bad) */
  maxDrawdown:        number;
  /** Current drawdown from most recent equity peak */
  currentDrawdown:    number;
  /** Longest winning streak */
  maxWinStreak:       number;
  /** Longest losing streak */
  maxLossStreak:      number;
  /** Current active streak: positive = wins, negative = losses */
  currentStreak:      number;
  /** Sum of all PnL fractions */
  totalPnlPct:        number;
  /** Annualised return estimate */
  annualisedReturnPct: number;
  /** Date range covered */
  fromDate:           string | null;
  toDate:             string | null;
  /** Trading days with at least one resolved trade */
  activeDays:         number;
}

export interface SetupBreakdown {
  setupType:    string;
  trades:       number;
  wins:         number;
  losses:       number;
  winRate:      number;
  avgPnlPct:    number;
  totalPnlPct:  number;
  expectancy:   number;
}

export interface SymbolBreakdown {
  symbol:       string;
  trades:       number;
  wins:         number;
  losses:       number;
  winRate:      number;
  avgPnlPct:    number;
}

export interface RegimeBreakdown {
  regime:       string;
  trades:       number;
  wins:         number;
  winRate:      number;
  avgPnlPct:    number;
}

export interface EquityReport {
  generatedAt:  string;
  metrics:      PerformanceMetrics;
  equityCurve:  EquityPoint[];
  bySetup:      SetupBreakdown[];
  bySymbol:     SymbolBreakdown[];
  byRegime:     RegimeBreakdown[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toIsoDate(iso: string): string {
  return iso.slice(0, 10);
}

function clampZero(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

function annualiseFactor(activeDays: number): number {
  if (activeDays < 2) return 1;
  return 252 / activeDays;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function downsideDev(values: number[], target = 0): number {
  const below = values.filter(v => v < target);
  if (below.length < 2) return 0;
  const variance = below.reduce((s, v) => s + (v - target) ** 2, 0) / below.length;
  return Math.sqrt(variance);
}

// ─── Core computation ─────────────────────────────────────────────────────────

/**
 * Generate a full equity report from resolved journal entries.
 * @param symbol   optional symbol filter
 * @param from     ISO date lower bound (inclusive)
 * @param to       ISO date upper bound (inclusive)
 */
export function generateEquityReport(opts: {
  symbol?: string;
  from?:   string;
  to?:     string;
} = {}): EquityReport {
  const generatedAt = new Date().toISOString();

  // Fetch resolved entries only
  let entries = listJournalEntries({ limit: 0 }) // 0 = no limit
    .filter(e => e.outcome !== "unknown" && e.pnlPct !== null);

  if (opts.symbol) entries = entries.filter(e => e.symbol === opts.symbol!.toUpperCase());
  if (opts.from)   entries = entries.filter(e => e.decidedAt.slice(0, 10) >= opts.from!);
  if (opts.to)     entries = entries.filter(e => e.decidedAt.slice(0, 10) <= opts.to!);

  // Sort oldest-first for time-series computation.
  // Tie-break by id so streak/order metrics are deterministic when timestamps match.
  entries = [...entries].sort((a, b) => {
    const byTime = a.decidedAt.localeCompare(b.decidedAt);
    if (byTime !== 0) return byTime;
    return a.id.localeCompare(b.id);
  });

  if (!entries.length) {
    return {
      generatedAt,
      metrics:     emptyMetrics(),
      equityCurve: [],
      bySetup:     [],
      bySymbol:    [],
      byRegime:    [],
    };
  }

  // ── Build daily P&L buckets ─────────────────────────────────────────────────
  const dailyMap = new Map<string, number[]>();
  const allPnl: number[] = [];
  let wins = 0, losses = 0, breakeven = 0;
  let maxWinStreak = 0, maxLossStreak = 0;
  let curWin = 0, curLoss = 0;
  let totalWinPnl = 0, totalLossPnl = 0;

  for (const e of entries) {
    const pnl = e.pnlPct!;
    allPnl.push(pnl);
    const day = toIsoDate(e.decidedAt);
    if (!dailyMap.has(day)) dailyMap.set(day, []);
    dailyMap.get(day)!.push(pnl);

    if (e.outcome === "win")       { wins++; totalWinPnl += pnl; curWin++; curLoss = 0; maxWinStreak = Math.max(maxWinStreak, curWin); }
    else if (e.outcome === "loss") { losses++; totalLossPnl += Math.abs(pnl); curLoss++; curWin = 0; maxLossStreak = Math.max(maxLossStreak, curLoss); }
    else                           { breakeven++; curWin = 0; curLoss = 0; }
  }

  const currentStreak = curWin > 0 ? curWin : -curLoss;
  const totalTrades   = entries.length;

  // ── Daily return series ────────────────────────────────────────────────────
  const sortedDays = Array.from(dailyMap.keys()).sort();
  const dailyReturns: number[] = sortedDays.map(day => {
    const pnls = dailyMap.get(day)!;
    return pnls.reduce((s, v) => s + v, 0);
  });

  // ── Equity curve & drawdown ────────────────────────────────────────────────
  const equityCurve: EquityPoint[] = [];
  let equity = 100;
  let peak   = 100;
  let maxDrawdown = 0;

  for (let i = 0; i < sortedDays.length; i++) {
    const day = sortedDays[i];
    const dr  = dailyReturns[i];
    equity    = equity * (1 + dr);
    peak      = Math.max(peak, equity);
    const dd  = (equity - peak) / peak; // negative
    maxDrawdown = Math.min(maxDrawdown, dd);

    const dayPnls  = dailyMap.get(day)!;
    const dayWins  = entries.filter(e => toIsoDate(e.decidedAt) === day && e.outcome === "win").length;
    const dayLosses = entries.filter(e => toIsoDate(e.decidedAt) === day && e.outcome === "loss").length;

    equityCurve.push({
      date:        day,
      equity:      Math.round(equity * 1000) / 1000,
      dailyReturn: Math.round(dr * 100000) / 100000,
      drawdown:    Math.round(dd * 100000) / 100000,
      tradeCount:  dayPnls.length,
      wins:        dayWins,
      losses:      dayLosses,
    });
  }

  const currentDrawdown = equityCurve.length ? equityCurve[equityCurve.length - 1].drawdown : 0;
  const activeDays      = sortedDays.length;

  // ── Ratios ────────────────────────────────────────────────────────────────
  const annFactor      = annualiseFactor(activeDays);
  const meanDailyRet   = dailyReturns.reduce((s, v) => s + v, 0) / (dailyReturns.length || 1);
  const sd             = stdDev(dailyReturns);
  const dsd            = downsideDev(dailyReturns);
  const sharpeRatio    = sd > 0 ? clampZero((meanDailyRet / sd) * Math.sqrt(annFactor * activeDays / activeDays)) : 0;
  const sortinoRatio   = dsd > 0 ? clampZero((meanDailyRet / dsd) * Math.sqrt(annFactor)) : 0;
  const totalPnlPct    = allPnl.reduce((s, v) => s + v, 0);
  const annReturn      = totalPnlPct * annFactor;
  const calmarRatio    = maxDrawdown < 0 ? clampZero(annReturn / Math.abs(maxDrawdown)) : 0;

  const winRate        = wins / (totalTrades || 1);
  const avgWinPct      = wins > 0 ? totalWinPnl / wins : 0;
  const avgLossPct     = losses > 0 ? totalLossPnl / losses : 0;
  const profitFactor   = totalLossPnl > 0 ? clampZero(totalWinPnl / totalLossPnl) : totalWinPnl > 0 ? Infinity : 0;
  const avgRR          = avgLossPct > 0 ? clampZero(avgWinPct / avgLossPct) : 0;
  const expectancy     = winRate * avgWinPct - (1 - winRate) * avgLossPct;

  const fromDate = sortedDays[0] ?? null;
  const toDate   = sortedDays[sortedDays.length - 1] ?? null;

  const metrics: PerformanceMetrics = {
    totalTrades, wins, losses, breakeven,
    winRate, avgWinPct, avgLossPct, profitFactor, avgRR, expectancy,
    sharpeRatio, sortinoRatio, calmarRatio,
    maxDrawdown: Math.abs(maxDrawdown),
    currentDrawdown: Math.abs(currentDrawdown),
    maxWinStreak, maxLossStreak, currentStreak,
    totalPnlPct, annualisedReturnPct: annReturn,
    fromDate, toDate, activeDays,
  };

  // ── Breakdowns ─────────────────────────────────────────────────────────────
  const bySetup   = computeSetupBreakdown(entries);
  const bySymbol  = computeSymbolBreakdown(entries);
  const byRegime  = computeRegimeBreakdown(entries);

  return { generatedAt, metrics, equityCurve, bySetup, bySymbol, byRegime };
}

function computeSetupBreakdown(entries: ReturnType<typeof listJournalEntries>): SetupBreakdown[] {
  const map = new Map<string, { trades: number; wins: number; losses: number; pnls: number[] }>();
  for (const e of entries) {
    const k = e.setupType;
    if (!map.has(k)) map.set(k, { trades: 0, wins: 0, losses: 0, pnls: [] });
    const b = map.get(k)!;
    b.trades++;
    if (e.outcome === "win")  b.wins++;
    if (e.outcome === "loss") b.losses++;
    if (e.pnlPct !== null) b.pnls.push(e.pnlPct);
  }
  return Array.from(map.entries())
    .map(([setupType, b]) => {
      const avgPnlPct   = b.pnls.length ? b.pnls.reduce((s, v) => s + v, 0) / b.pnls.length : 0;
      const totalPnlPct = b.pnls.reduce((s, v) => s + v, 0);
      const winRate     = b.trades ? b.wins / b.trades : 0;
      const wins  = b.pnls.filter(v => v > 0.001);
      const losses = b.pnls.filter(v => v < -0.001);
      const avgWin  = wins.length  ? wins.reduce((s, v) => s + v, 0) / wins.length : 0;
      const avgLoss = losses.length ? Math.abs(losses.reduce((s, v) => s + v, 0) / losses.length) : 0;
      const expectancy = winRate * avgWin - (1 - winRate) * avgLoss;
      return { setupType, trades: b.trades, wins: b.wins, losses: b.losses, winRate, avgPnlPct, totalPnlPct, expectancy };
    })
    .sort((a, b) => b.totalPnlPct - a.totalPnlPct);
}

function computeSymbolBreakdown(entries: ReturnType<typeof listJournalEntries>): SymbolBreakdown[] {
  const map = new Map<string, { trades: number; wins: number; losses: number; pnls: number[] }>();
  for (const e of entries) {
    const k = e.symbol;
    if (!map.has(k)) map.set(k, { trades: 0, wins: 0, losses: 0, pnls: [] });
    const b = map.get(k)!;
    b.trades++;
    if (e.outcome === "win")  b.wins++;
    if (e.outcome === "loss") b.losses++;
    if (e.pnlPct !== null) b.pnls.push(e.pnlPct);
  }
  return Array.from(map.entries())
    .map(([symbol, b]) => ({
      symbol,
      trades: b.trades,
      wins: b.wins,
      losses: b.losses,
      winRate: b.trades ? b.wins / b.trades : 0,
      avgPnlPct: b.pnls.length ? b.pnls.reduce((s, v) => s + v, 0) / b.pnls.length : 0,
    }))
    .sort((a, b) => b.avgPnlPct - a.avgPnlPct);
}

function computeRegimeBreakdown(entries: ReturnType<typeof listJournalEntries>): RegimeBreakdown[] {
  const map = new Map<string, { trades: number; wins: number; pnls: number[] }>();
  for (const e of entries) {
    const k = e.regime || "unknown";
    if (!map.has(k)) map.set(k, { trades: 0, wins: 0, pnls: [] });
    const b = map.get(k)!;
    b.trades++;
    if (e.outcome === "win") b.wins++;
    if (e.pnlPct !== null) b.pnls.push(e.pnlPct);
  }
  return Array.from(map.entries())
    .map(([regime, b]) => ({
      regime,
      trades: b.trades,
      wins: b.wins,
      winRate: b.trades ? b.wins / b.trades : 0,
      avgPnlPct: b.pnls.length ? b.pnls.reduce((s, v) => s + v, 0) / b.pnls.length : 0,
    }))
    .sort((a, b) => b.avgPnlPct - a.avgPnlPct);
}

function emptyMetrics(): PerformanceMetrics {
  return {
    totalTrades: 0, wins: 0, losses: 0, breakeven: 0,
    winRate: 0, avgWinPct: 0, avgLossPct: 0, profitFactor: 0, avgRR: 0, expectancy: 0,
    sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
    maxDrawdown: 0, currentDrawdown: 0,
    maxWinStreak: 0, maxLossStreak: 0, currentStreak: 0,
    totalPnlPct: 0, annualisedReturnPct: 0,
    fromDate: null, toDate: null, activeDays: 0,
  };
}

export { emptyMetrics };
