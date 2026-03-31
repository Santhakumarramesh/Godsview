/**
 * Backtesting Engine — Replay historical signals through Super Intelligence
 *
 * Compares baseline pipeline (static Q formula) vs Super Intelligence
 * (ensemble ML + Kelly + regime-adaptive + confluence) to prove the
 * system actually improves win rate and profit factor.
 *
 * Key metrics:
 * - Win rate: % of trades that hit TP before SL
 * - Profit factor: gross_profit / gross_loss
 * - Sharpe ratio: annualized risk-adjusted return
 * - Max drawdown: largest peak-to-trough equity decline
 * - Kelly efficiency: actual vs optimal position sizing
 * - Edge decay: how quickly edge deteriorates over time
 */

import { processSuperSignal } from "./super_intelligence";
import { computeFinalQuality } from "./strategy_engine";

// ── Types ──────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  /** Number of days to look back */
  lookback_days: number;
  /** Starting equity */
  initial_equity: number;
  /** Apply SI filters or just measure baseline */
  mode: "baseline" | "super_intelligence" | "comparison";
  /** Minimum signals required for statistical validity */
  min_signals?: number;
}

export interface TradeResult {
  signal_id: number;
  setup_type: string;
  regime: string;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  outcome: "win" | "loss";
  pnl_pct: number;
  /** Super Intelligence verdict */
  si_approved: boolean;
  si_win_prob: number;
  si_edge_score: number;
  si_kelly_pct: number;
  /** Baseline quality */
  baseline_quality: number;
  /** Enhanced quality */
  enhanced_quality: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  /** Baseline metrics (all historical signals) */
  baseline: BacktestMetrics;
  /** Super Intelligence metrics (SI-filtered signals only) */
  super_intelligence: BacktestMetrics;
  /** Improvement delta */
  improvement: {
    win_rate_delta: number;
    profit_factor_delta: number;
    sharpe_delta: number;
    max_dd_improvement: number;
    signals_filtered_pct: number;
  };
  /** Per-regime breakdown */
  by_regime: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }>;
  /** Per-setup breakdown */
  by_setup: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }>;
  /** Equity curve data points */
  equity_curve_baseline: Array<{ idx: number; equity: number }>;
  equity_curve_si: Array<{ idx: number; equity: number }>;
  /** Statistical significance */
  significance: {
    z_score: number;
    p_value: number;
    is_significant: boolean;
    confidence_level: string;
  };
  generated_at: string;
}

export interface BacktestMetrics {
  total_signals: number;
  trades_taken: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  total_pnl_pct: number;
  avg_win_pct: number;
  avg_loss_pct: number;
  max_drawdown_pct: number;
  sharpe_ratio: number;
  avg_kelly_pct: number;
  avg_edge_score: number;
  best_trade_pct: number;
  worst_trade_pct: number;
  avg_hold_quality: number;
}

// ── Backtest Engine ────────────────────────────────────────────────────────

const BASELINE_QUALITY_THRESHOLD = 0.68;

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { lookback_days, initial_equity, min_signals = 50 } = config;

  // Fetch historical signals from accuracy_results
  const { db, accuracyResultsTable } = await import("@workspace/db");
  const { and, or, eq, gte, isNotNull } = await import("drizzle-orm");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookback_days);

  const rows = await db
    .select({
      id: accuracyResultsTable.id,
      structure_score: accuracyResultsTable.structure_score,
      order_flow_score: accuracyResultsTable.order_flow_score,
      recall_score: accuracyResultsTable.recall_score,
      final_quality: accuracyResultsTable.final_quality,
      setup_type: accuracyResultsTable.setup_type,
      regime: accuracyResultsTable.regime,
      direction: accuracyResultsTable.direction,
      tp_ticks: accuracyResultsTable.tp_ticks,
      sl_ticks: accuracyResultsTable.sl_ticks,
      outcome: accuracyResultsTable.outcome,
      created_at: accuracyResultsTable.created_at,
    })
    .from(accuracyResultsTable)
    .where(
      and(
        or(
          eq(accuracyResultsTable.outcome, "win"),
          eq(accuracyResultsTable.outcome, "loss")
        ),
        isNotNull(accuracyResultsTable.structure_score),
        isNotNull(accuracyResultsTable.order_flow_score),
        gte(accuracyResultsTable.created_at, cutoff)
      )
    )
    .limit(100_000);

  // Process each signal through both pipelines
  const trades: TradeResult[] = [];
  // Synthetic base price for tick-based PnL calculation
  const BASE_PRICE = 100;
  const TICK_VALUE = 0.25;

  for (const row of rows) {
    const structure = parseFloat(String(row.structure_score ?? "0"));
    const orderFlow = parseFloat(String(row.order_flow_score ?? "0"));
    const recall = parseFloat(String(row.recall_score ?? "0"));
    const direction = (row.direction ?? "long") as "long" | "short";
    const setupType = row.setup_type ?? "absorption_reversal";
    const regime = row.regime ?? "ranging";
    const outcome = row.outcome as "win" | "loss";
    const tpTicks = row.tp_ticks ?? 8;
    const slTicks = row.sl_ticks ?? 4;

    // Compute synthetic entry/SL/TP from ticks
    const entryPrice = BASE_PRICE;
    const slDistance = slTicks * TICK_VALUE;
    const tpDistance = tpTicks * TICK_VALUE;
    const stopLoss = direction === "long" ? entryPrice - slDistance : entryPrice + slDistance;
    const takeProfit = direction === "long" ? entryPrice + tpDistance : entryPrice - tpDistance;

    const risk = slDistance;
    const reward = tpDistance;
    const pnlPct = outcome === "win"
      ? (reward / entryPrice) * 100
      : -(risk / entryPrice) * 100;

    // Baseline quality
    const baselineQuality = computeFinalQuality(structure, orderFlow, recall, {
      setup_type: setupType as any,
      recall: { regime } as any,
      direction,
    });

    // Super Intelligence evaluation
    const siResult = processSuperSignal({
      structure_score: structure,
      order_flow_score: orderFlow,
      recall_score: recall,
      setup_type: setupType,
      regime,
      direction,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      atr: risk * 0.8, // Estimate ATR from risk
      equity: initial_equity,
    });

    trades.push({
      signal_id: row.id ?? 0,
      setup_type: setupType,
      regime,
      direction,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      outcome,
      pnl_pct: pnlPct,
      si_approved: siResult.approved,
      si_win_prob: siResult.win_probability,
      si_edge_score: siResult.edge_score,
      si_kelly_pct: siResult.kelly_fraction * 100,
      baseline_quality: baselineQuality,
      enhanced_quality: siResult.enhanced_quality,
    });
  }

  if (trades.length < min_signals) {
    // Not enough data — return empty result with message
    const empty = emptyMetrics();
    return {
      config,
      baseline: empty,
      super_intelligence: empty,
      improvement: { win_rate_delta: 0, profit_factor_delta: 0, sharpe_delta: 0, max_dd_improvement: 0, signals_filtered_pct: 0 },
      by_regime: {},
      by_setup: {},
      equity_curve_baseline: [],
      equity_curve_si: [],
      significance: { z_score: 0, p_value: 1, is_significant: false, confidence_level: "insufficient_data" },
      generated_at: new Date().toISOString(),
    };
  }

  // Baseline: all trades that passed old quality threshold
  const baselineTrades = trades.filter(t => t.baseline_quality >= BASELINE_QUALITY_THRESHOLD);
  // SI: only trades that Super Intelligence approved
  const siTrades = trades.filter(t => t.si_approved);

  const baseline = computeMetrics(baselineTrades, initial_equity);
  const si = computeMetrics(siTrades, initial_equity);

  // Equity curves
  const equity_curve_baseline = buildEquityCurve(baselineTrades, initial_equity);
  const equity_curve_si = buildEquityCurve(siTrades, initial_equity);

  // Per-regime breakdown
  const regimes = [...new Set(trades.map(t => t.regime))];
  const by_regime: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }> = {};
  for (const r of regimes) {
    const rBaseline = trades.filter(t => t.regime === r && t.baseline_quality >= BASELINE_QUALITY_THRESHOLD);
    const rSi = trades.filter(t => t.regime === r && t.si_approved);
    if (rBaseline.length > 0 || rSi.length > 0) {
      by_regime[r] = {
        baseline: computeMetrics(rBaseline, initial_equity),
        si: computeMetrics(rSi, initial_equity),
      };
    }
  }

  // Per-setup breakdown
  const setups = [...new Set(trades.map(t => t.setup_type))];
  const by_setup: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }> = {};
  for (const s of setups) {
    const sBaseline = trades.filter(t => t.setup_type === s && t.baseline_quality >= BASELINE_QUALITY_THRESHOLD);
    const sSi = trades.filter(t => t.setup_type === s && t.si_approved);
    if (sBaseline.length > 0 || sSi.length > 0) {
      by_setup[s] = {
        baseline: computeMetrics(sBaseline, initial_equity),
        si: computeMetrics(sSi, initial_equity),
      };
    }
  }

  // Statistical significance (two-proportion z-test)
  const significance = computeSignificance(
    baseline.wins, baseline.trades_taken,
    si.wins, si.trades_taken,
  );

  return {
    config,
    baseline,
    super_intelligence: si,
    improvement: {
      win_rate_delta: si.win_rate - baseline.win_rate,
      profit_factor_delta: si.profit_factor - baseline.profit_factor,
      sharpe_delta: si.sharpe_ratio - baseline.sharpe_ratio,
      max_dd_improvement: baseline.max_drawdown_pct - si.max_drawdown_pct,
      signals_filtered_pct: trades.length > 0
        ? ((trades.length - siTrades.length) / trades.length) * 100 : 0,
    },
    by_regime,
    by_setup,
    equity_curve_baseline,
    equity_curve_si,
    significance,
    generated_at: new Date().toISOString(),
  };
}

// ── Metrics Computation ────────────────────────────────────────────────────

function computeMetrics(trades: TradeResult[], initialEquity: number): BacktestMetrics {
  if (trades.length === 0) return emptyMetrics();

  const wins = trades.filter(t => t.outcome === "win");
  const losses = trades.filter(t => t.outcome === "loss");

  const winPnls = wins.map(t => t.pnl_pct);
  const lossPnls = losses.map(t => Math.abs(t.pnl_pct));

  const totalWinPct = winPnls.reduce((s, v) => s + v, 0);
  const totalLossPct = lossPnls.reduce((s, v) => s + v, 0);

  const avgWin = winPnls.length > 0 ? totalWinPct / winPnls.length : 0;
  const avgLoss = lossPnls.length > 0 ? totalLossPct / lossPnls.length : 0;

  // Profit factor
  const profitFactor = totalLossPct > 0 ? totalWinPct / totalLossPct : totalWinPct > 0 ? Infinity : 0;

  // Max drawdown from equity curve
  let peak = initialEquity;
  let maxDd = 0;
  let equity = initialEquity;
  for (const t of trades) {
    equity += (equity * t.pnl_pct) / 100;
    if (equity > peak) peak = equity;
    const dd = ((peak - equity) / peak) * 100;
    if (dd > maxDd) maxDd = dd;
  }

  // Sharpe ratio (annualized, assuming ~252 trading days)
  const returns = trades.map(t => t.pnl_pct / 100);
  const avgReturn = returns.reduce((s, v) => s + v, 0) / returns.length;
  const variance = returns.reduce((s, v) => s + (v - avgReturn) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const dailyTrades = Math.max(1, trades.length / 30); // Rough trades per day
  const annualizationFactor = Math.sqrt(252 * dailyTrades);
  const sharpe = stdDev > 0 ? (avgReturn / stdDev) * annualizationFactor : 0;

  return {
    total_signals: trades.length,
    trades_taken: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: trades.length > 0 ? wins.length / trades.length : 0,
    profit_factor: Number.isFinite(profitFactor) ? profitFactor : 99.9,
    total_pnl_pct: trades.reduce((s, t) => s + t.pnl_pct, 0),
    avg_win_pct: avgWin,
    avg_loss_pct: avgLoss,
    max_drawdown_pct: maxDd,
    sharpe_ratio: Number.isFinite(sharpe) ? sharpe : 0,
    avg_kelly_pct: trades.reduce((s, t) => s + t.si_kelly_pct, 0) / trades.length,
    avg_edge_score: trades.reduce((s, t) => s + t.si_edge_score, 0) / trades.length,
    best_trade_pct: trades.length > 0 ? Math.max(...trades.map(t => t.pnl_pct)) : 0,
    worst_trade_pct: trades.length > 0 ? Math.min(...trades.map(t => t.pnl_pct)) : 0,
    avg_hold_quality: trades.reduce((s, t) => s + t.enhanced_quality, 0) / trades.length,
  };
}

function emptyMetrics(): BacktestMetrics {
  return {
    total_signals: 0, trades_taken: 0, wins: 0, losses: 0, win_rate: 0,
    profit_factor: 0, total_pnl_pct: 0, avg_win_pct: 0, avg_loss_pct: 0,
    max_drawdown_pct: 0, sharpe_ratio: 0, avg_kelly_pct: 0, avg_edge_score: 0,
    best_trade_pct: 0, worst_trade_pct: 0, avg_hold_quality: 0,
  };
}

function buildEquityCurve(
  trades: TradeResult[],
  initialEquity: number,
): Array<{ idx: number; equity: number }> {
  const curve: Array<{ idx: number; equity: number }> = [{ idx: 0, equity: initialEquity }];
  let equity = initialEquity;
  for (let i = 0; i < trades.length; i++) {
    equity += (equity * trades[i].pnl_pct) / 100;
    curve.push({ idx: i + 1, equity: Math.round(equity * 100) / 100 });
  }
  return curve;
}

// ── Statistical Significance (Two-Proportion Z-Test) ───────────────────────

function computeSignificance(
  wins1: number, n1: number,
  wins2: number, n2: number,
): { z_score: number; p_value: number; is_significant: boolean; confidence_level: string } {
  if (n1 === 0 || n2 === 0) {
    return { z_score: 0, p_value: 1, is_significant: false, confidence_level: "insufficient_data" };
  }

  const p1 = wins1 / n1;
  const p2 = wins2 / n2;
  const pPooled = (wins1 + wins2) / (n1 + n2);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));

  if (se === 0) {
    return { z_score: 0, p_value: 1, is_significant: false, confidence_level: "no_variance" };
  }

  const z = (p2 - p1) / se;

  // Approximate p-value from z-score (one-tailed)
  const pValue = approxNormalCDF(-Math.abs(z));

  let confidence = "not_significant";
  if (pValue < 0.01) confidence = "99%";
  else if (pValue < 0.05) confidence = "95%";
  else if (pValue < 0.10) confidence = "90%";

  return {
    z_score: Math.round(z * 1000) / 1000,
    p_value: Math.round(pValue * 10000) / 10000,
    is_significant: pValue < 0.05,
    confidence_level: confidence,
  };
}

// Rational approximation of normal CDF (Abramowitz & Stegun)
function approxNormalCDF(x: number): number {
  if (x < -8) return 0;
  if (x > 8) return 1;
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return 0.5 * (1 + sign * y);
}
