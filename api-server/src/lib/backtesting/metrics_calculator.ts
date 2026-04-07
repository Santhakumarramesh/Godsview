/**
 * Phase 94 — Comprehensive Backtest Metrics Calculator
 *
 * Computes all key quant metrics from completed backtest positions:
 * Sharpe ratio, Sortino ratio, profit factor, win rate, max drawdown,
 * Calmar ratio, expectancy, and more.
 */

import type { ReplayPosition, ReplayState } from "./replay_engine.js";

export interface BacktestMetrics {
  // Summary
  totalTrades: number;
  winners: number;
  losers: number;
  breakeven: number;
  winRate: number;
  lossRate: number;

  // P&L
  totalPnl: number;
  totalPnlPercent: number;
  avgPnl: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  avgWinLossRatio: number;

  // Risk-adjusted returns
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  expectancy: number;
  expectancyR: number;

  // Drawdown
  maxDrawdown: number;
  maxDrawdownDuration: number; // in bars
  avgDrawdown: number;
  currentDrawdown: number;

  // Trade quality
  avgHoldBars: number;
  avgMAE: number;
  avgMFE: number;
  edgeRatio: number; // MFE/MAE — measures how well you're capturing moves
  payoffRatio: number;

  // Streaks
  maxWinStreak: number;
  maxLossStreak: number;
  currentStreak: number;
  currentStreakType: "win" | "loss" | "none";

  // Risk
  kellyFraction: number;
  optimalF: number;
  annualizedReturn: number;
  annualizedVolatility: number;

  // Monthly breakdown
  monthlyReturns: { month: string; pnl: number; trades: number; winRate: number }[];

  // By setup type
  setupBreakdown: Record<string, {
    trades: number;
    winRate: number;
    avgPnl: number;
    profitFactor: number;
    sharpe: number;
  }>;

  // Equity curve
  equityCurve: { ts: Date; equity: number; drawdown: number }[];
}

export function calculateMetrics(
  state: ReplayState,
  positions?: ReplayPosition[],
  annualizationFactor = 252 // trading days per year
): BacktestMetrics {
  const closed = positions ?? state.closedPositions;
  const totalTrades = closed.length;

  if (totalTrades === 0) {
    return emptyMetrics();
  }

  const pnls = closed.map((p) => p.pnl ?? 0);
  const pnlPercents = closed.map((p) => p.pnlPercent ?? 0);

  const winners = closed.filter((p) => (p.pnl ?? 0) > 0);
  const losers = closed.filter((p) => (p.pnl ?? 0) < 0);
  const breakeven = closed.filter((p) => (p.pnl ?? 0) === 0);

  const winRate = totalTrades > 0 ? winners.length / totalTrades : 0;
  const lossRate = totalTrades > 0 ? losers.length / totalTrades : 0;

  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const avgPnl = totalPnl / totalTrades;
  const avgWin = winners.length > 0
    ? winners.reduce((s, p) => s + (p.pnl ?? 0), 0) / winners.length
    : 0;
  const avgLoss = losers.length > 0
    ? losers.reduce((s, p) => s + (p.pnl ?? 0), 0) / losers.length
    : 0;
  const largestWin = Math.max(0, ...pnls);
  const largestLoss = Math.min(0, ...pnls);
  const avgWinLossRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : Infinity;

  // Profit factor
  const grossProfit = winners.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const grossLoss = Math.abs(losers.reduce((s, p) => s + (p.pnl ?? 0), 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : Infinity;

  // Sharpe ratio (annualized)
  const meanReturn = pnlPercents.reduce((a, b) => a + b, 0) / pnlPercents.length;
  const stdDev = computeStdDev(pnlPercents);
  const sharpeRatio = stdDev > 0 ? (meanReturn / stdDev) * Math.sqrt(annualizationFactor) : 0;

  // Sortino ratio (uses downside deviation)
  const downsideReturns = pnlPercents.filter((r) => r < 0);
  const downsideDev = computeStdDev(downsideReturns.length > 0 ? downsideReturns : [0]);
  const sortinoRatio = downsideDev > 0 ? (meanReturn / downsideDev) * Math.sqrt(annualizationFactor) : 0;

  // Drawdown analysis
  const { maxDrawdown, maxDrawdownDuration, avgDrawdown, equityCurve } = computeDrawdownMetrics(closed, state.capital);

  // Calmar ratio
  const totalPnlPercent = state.equity > 0 ? ((state.equity - state.capital) / state.capital) * 100 : 0;
  const calmarRatio = maxDrawdown > 0 ? (totalPnlPercent / maxDrawdown) : 0;

  // Expectancy
  const expectancy = winRate * avgWin + lossRate * avgLoss;

  // Expectancy in R multiples
  const avgR = closed.length > 0
    ? closed.reduce((s, p) => {
        const risk = Math.abs(p.entryPrice - p.stopLoss) * p.quantity;
        return s + (risk > 0 ? (p.pnl ?? 0) / risk : 0);
      }, 0) / closed.length
    : 0;

  // MAE/MFE
  const avgMAE = closed.reduce((s, p) => s + p.mae, 0) / totalTrades;
  const avgMFE = closed.reduce((s, p) => s + p.mfe, 0) / totalTrades;
  const edgeRatio = avgMAE !== 0 ? Math.abs(avgMFE / avgMAE) : 0;

  // Hold bars
  const avgHoldBars = closed.reduce((s, p) => s + p.holdBars, 0) / totalTrades;

  // Streaks
  const { maxWinStreak, maxLossStreak, currentStreak, currentStreakType } = computeStreaks(closed);

  // Kelly criterion
  const kellyFraction = avgWinLossRatio > 0
    ? winRate - (lossRate / avgWinLossRatio)
    : 0;

  // Optimal f (simplified)
  const optimalF = largestLoss !== 0 ? Math.abs(avgPnl / largestLoss) : 0;

  // Annualized return and volatility
  const annualizedReturn = meanReturn * annualizationFactor;
  const annualizedVolatility = stdDev * Math.sqrt(annualizationFactor);

  // Payoff ratio
  const payoffRatio = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : Infinity;

  // Monthly returns
  const monthlyReturns = computeMonthlyReturns(closed);

  return {
    totalTrades,
    winners: winners.length,
    losers: losers.length,
    breakeven: breakeven.length,
    winRate,
    lossRate,
    totalPnl,
    totalPnlPercent,
    avgPnl,
    avgWin,
    avgLoss,
    largestWin,
    largestLoss,
    avgWinLossRatio,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    profitFactor,
    expectancy,
    expectancyR: avgR,
    maxDrawdown,
    maxDrawdownDuration,
    avgDrawdown,
    currentDrawdown: state.drawdown,
    avgHoldBars,
    avgMAE,
    avgMFE,
    edgeRatio,
    payoffRatio,
    maxWinStreak,
    maxLossStreak,
    currentStreak,
    currentStreakType,
    kellyFraction: Math.max(0, kellyFraction),
    optimalF: Math.max(0, Math.min(1, optimalF)),
    annualizedReturn,
    annualizedVolatility,
    monthlyReturns,
    setupBreakdown: {},
    equityCurve,
  };
}

function computeStdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

function computeDrawdownMetrics(positions: ReplayPosition[], initialCapital: number) {
  let equity = initialCapital;
  let peak = initialCapital;
  let maxDD = 0;
  let maxDDDuration = 0;
  let currentDDDuration = 0;
  let totalDD = 0;
  let ddCount = 0;
  const equityCurve: { ts: Date; equity: number; drawdown: number }[] = [];

  for (const pos of positions) {
    equity += pos.pnl ?? 0;
    peak = Math.max(peak, equity);
    const dd = peak > 0 ? ((peak - equity) / peak) * 100 : 0;

    if (dd > 0) {
      currentDDDuration++;
      maxDDDuration = Math.max(maxDDDuration, currentDDDuration);
      totalDD += dd;
      ddCount++;
    } else {
      currentDDDuration = 0;
    }

    maxDD = Math.max(maxDD, dd);
    equityCurve.push({ ts: pos.exitTime ?? pos.entryTime, equity, drawdown: dd });
  }

  return {
    maxDrawdown: maxDD,
    maxDrawdownDuration: maxDDDuration,
    avgDrawdown: ddCount > 0 ? totalDD / ddCount : 0,
    equityCurve,
  };
}

function computeStreaks(positions: ReplayPosition[]) {
  let maxWin = 0;
  let maxLoss = 0;
  let current = 0;
  let currentType: "win" | "loss" | "none" = "none";

  for (const pos of positions) {
    const isWin = (pos.pnl ?? 0) > 0;
    if (isWin) {
      if (currentType === "win") current++;
      else { current = 1; currentType = "win"; }
      maxWin = Math.max(maxWin, current);
    } else {
      if (currentType === "loss") current++;
      else { current = 1; currentType = "loss"; }
      maxLoss = Math.max(maxLoss, current);
    }
  }

  return { maxWinStreak: maxWin, maxLossStreak: maxLoss, currentStreak: current, currentStreakType: currentType };
}

function computeMonthlyReturns(positions: ReplayPosition[]) {
  const monthly: Map<string, { pnl: number; trades: number; wins: number }> = new Map();

  for (const pos of positions) {
    const ts = pos.exitTime ?? pos.entryTime;
    const key = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, "0")}`;
    const entry = monthly.get(key) ?? { pnl: 0, trades: 0, wins: 0 };
    entry.pnl += pos.pnl ?? 0;
    entry.trades++;
    if ((pos.pnl ?? 0) > 0) entry.wins++;
    monthly.set(key, entry);
  }

  return Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      pnl: data.pnl,
      trades: data.trades,
      winRate: data.trades > 0 ? data.wins / data.trades : 0,
    }));
}

function emptyMetrics(): BacktestMetrics {
  return {
    totalTrades: 0, winners: 0, losers: 0, breakeven: 0,
    winRate: 0, lossRate: 0, totalPnl: 0, totalPnlPercent: 0,
    avgPnl: 0, avgWin: 0, avgLoss: 0, largestWin: 0, largestLoss: 0,
    avgWinLossRatio: 0, sharpeRatio: 0, sortinoRatio: 0, calmarRatio: 0,
    profitFactor: 0, expectancy: 0, expectancyR: 0,
    maxDrawdown: 0, maxDrawdownDuration: 0, avgDrawdown: 0, currentDrawdown: 0,
    avgHoldBars: 0, avgMAE: 0, avgMFE: 0, edgeRatio: 0, payoffRatio: 0,
    maxWinStreak: 0, maxLossStreak: 0, currentStreak: 0, currentStreakType: "none",
    kellyFraction: 0, optimalF: 0, annualizedReturn: 0, annualizedVolatility: 0,
    monthlyReturns: [], setupBreakdown: {}, equityCurve: [],
  };
}
