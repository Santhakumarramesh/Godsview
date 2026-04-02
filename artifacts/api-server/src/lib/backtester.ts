/**
 * Backtesting Engine v2 — Walk-Forward Statistical Backtest
 *
 * Works entirely on stored accuracy_results data — no live market data needed.
 * Compares baseline (quality threshold) vs Super Intelligence (ensemble filter).
 *
 * Methodology:
 *   1. Load all win/loss rows from accuracy_results (sorted chronologically)
 *   2. Walk-forward split: first 80% = "historical", last 20% = "out-of-sample"
 *   3. Baseline: take trades where final_quality >= threshold (static rule)
 *   4. SI filter: run ensemble prediction; take only approved signals
 *   5. Compute win rate, profit factor, Sharpe, max drawdown, edge decay
 *   6. Statistical significance: Z-test on win rate delta
 *
 * Key insight: since outcomes are already stored, we get pure ML filter lift
 * measurement — exactly what matters for production decision quality.
 */

import { processSuperSignal } from "./super_intelligence";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface BacktestConfig {
  lookback_days: number;
  initial_equity: number;
  mode: "baseline" | "super_intelligence" | "comparison";
  min_signals?: number;
  use_oos_only?: boolean; // only use out-of-sample (last 20%) for reporting
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
  avg_edge_score: number;
  best_regime: string;
  worst_regime: string;
  avg_quality: number;
}

export interface BacktestResult {
  config: BacktestConfig;
  total_signals_loaded: number;
  train_samples: number;
  test_samples: number;
  baseline: BacktestMetrics;
  super_intelligence: BacktestMetrics;
  improvement: {
    win_rate_delta: number;
    profit_factor_delta: number;
    sharpe_delta: number;
    max_dd_improvement: number;
    signals_filtered_pct: number;
    edge_lift: number;
  };
  by_regime: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }>;
  by_setup: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }>;
  equity_curve_baseline: Array<{ idx: number; equity: number }>;
  equity_curve_si: Array<{ idx: number; equity: number }>;
  significance: {
    z_score: number;
    p_value: number;
    is_significant: boolean;
    confidence_level: string;
  };
  edge_decay: Array<{ window: number; baseline_wr: number; si_wr: number }>;
  generated_at: string;
}

interface SignalRow {
  id: number;
  symbol: string;
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  setup_type: string;
  regime: string;
  direction: "long" | "short";
  outcome: "win" | "loss";
  tp_ticks: number;
  sl_ticks: number;
  created_at: Date;
}

// ── Metric Helpers ─────────────────────────────────────────────────────────────

function calcMetrics(
  trades: Array<{ outcome: "win" | "loss"; tp: number; sl: number; edge: number; quality: number }>,
  regime_wins: Record<string, number>,
  regime_total: Record<string, number>,
  initial_equity: number,
): BacktestMetrics {
  if (trades.length === 0) {
    return {
      total_signals: 0, trades_taken: 0, wins: 0, losses: 0,
      win_rate: 0, profit_factor: 0, total_pnl_pct: 0,
      avg_win_pct: 0, avg_loss_pct: 0, max_drawdown_pct: 0,
      sharpe_ratio: 0, avg_edge_score: 0,
      best_regime: "—", worst_regime: "—", avg_quality: 0,
    };
  }

  const wins = trades.filter(t => t.outcome === "win");
  const losses = trades.filter(t => t.outcome === "loss");

  // PnL: wins pay tp_ticks/sl_ticks as R-multiple (normalised to 1% risk)
  const RISK_PCT = 0.01;
  const winPnls = wins.map(t => RISK_PCT * (t.tp / Math.max(t.sl, 1)));
  const lossPnls = losses.map(_ => -RISK_PCT);

  const allPnls = [...winPnls, ...lossPnls];
  const grossProfit = winPnls.reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(lossPnls.reduce((s, v) => s + v, 0));
  const totalPnl = allPnls.reduce((s, v) => s + v, 0);

  // Max drawdown
  let equity = 1.0, peak = 1.0, maxDD = 0;
  for (const pnl of allPnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (annualised, assume 252 trading days, 4 signals/day)
  const mean = allPnls.reduce((s, v) => s + v, 0) / allPnls.length;
  const variance = allPnls.reduce((s, v) => s + (v - mean) ** 2, 0) / allPnls.length;
  const std = Math.sqrt(variance);
  const annFactor = Math.sqrt(252 * 4);
  const sharpe = std > 0 ? (mean / std) * annFactor : 0;

  // Best/worst regime by win rate
  let bestRegime = "—", bestWR = 0, worstRegime = "—", worstWR = 1;
  for (const [r, total] of Object.entries(regime_total)) {
    if (total < 5) continue;
    const wr = (regime_wins[r] ?? 0) / total;
    if (wr > bestWR) { bestWR = wr; bestRegime = r; }
    if (wr < worstWR) { worstWR = wr; worstRegime = r; }
  }

  return {
    total_signals: trades.length,
    trades_taken: trades.length,
    wins: wins.length,
    losses: losses.length,
    win_rate: trades.length > 0 ? wins.length / trades.length : 0,
    profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
    total_pnl_pct: totalPnl * 100,
    avg_win_pct: wins.length > 0 ? winPnls.reduce((s, v) => s + v, 0) / wins.length * 100 : 0,
    avg_loss_pct: losses.length > 0 ? -(RISK_PCT * 100) : 0,
    max_drawdown_pct: maxDD * 100,
    sharpe_ratio: parseFloat(sharpe.toFixed(3)),
    avg_edge_score: trades.reduce((s, t) => s + t.edge, 0) / trades.length,
    best_regime: bestRegime,
    worst_regime: worstRegime,
    avg_quality: trades.reduce((s, t) => s + t.quality, 0) / trades.length,
  };
}

function calcEquityCurve(
  trades: Array<{ outcome: "win" | "loss"; tp: number; sl: number }>,
  initial_equity: number,
): Array<{ idx: number; equity: number }> {
  const RISK_PCT = 0.01;
  let equity = initial_equity;
  const curve: Array<{ idx: number; equity: number }> = [{ idx: 0, equity }];
  for (let i = 0; i < trades.length; i++) {
    const t = trades[i];
    const rrr = t.tp / Math.max(t.sl, 1);
    equity += t.outcome === "win"
      ? equity * RISK_PCT * rrr
      : -equity * RISK_PCT;
    if (i % 5 === 0 || i === trades.length - 1) {
      curve.push({ idx: i + 1, equity: parseFloat(equity.toFixed(2)) });
    }
  }
  return curve;
}

function zTest(n1: number, p1: number, n2: number, p2: number): {
  z_score: number; p_value: number; is_significant: boolean; confidence_level: string;
} {
  if (n1 < 5 || n2 < 5) {
    return { z_score: 0, p_value: 1, is_significant: false, confidence_level: "insufficient data" };
  }
  const pooled = (n1 * p1 + n2 * p2) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  if (se === 0) return { z_score: 0, p_value: 1, is_significant: false, confidence_level: "no variance" };
  const z = (p2 - p1) / se;
  // Approximate p-value from Z (two-tailed)
  const absZ = Math.abs(z);
  const p_value = absZ > 3.3 ? 0.001 : absZ > 2.576 ? 0.01 : absZ > 1.96 ? 0.05 : absZ > 1.645 ? 0.10 : 0.5;
  const confidence_level = p_value <= 0.001 ? "99.9%" : p_value <= 0.01 ? "99%" : p_value <= 0.05 ? "95%" : p_value <= 0.10 ? "90%" : "not significant";
  return { z_score: parseFloat(z.toFixed(3)), p_value, is_significant: p_value <= 0.05, confidence_level };
}

function edgeDecay(
  baselineTrades: Array<{ outcome: "win" | "loss" }>,
  siTrades: Array<{ outcome: "win" | "loss" }>,
): Array<{ window: number; baseline_wr: number; si_wr: number }> {
  const windows = [10, 20, 50, 100, 200];
  return windows.map(w => {
    const bSlice = baselineTrades.slice(0, w);
    const sSlice = siTrades.slice(0, w);
    return {
      window: w,
      baseline_wr: bSlice.length > 0 ? bSlice.filter(t => t.outcome === "win").length / bSlice.length : 0,
      si_wr: sSlice.length > 0 ? sSlice.filter(t => t.outcome === "win").length / sSlice.length : 0,
    };
  });
}

// ── Main Backtest ──────────────────────────────────────────────────────────────

const BASELINE_QUALITY_THRESHOLD = 0.62; // static threshold for baseline filter

export async function runBacktest(config: BacktestConfig): Promise<BacktestResult> {
  const { lookback_days, initial_equity, min_signals = 30, use_oos_only = false } = config;

  const { db, accuracyResultsTable } = await import("@workspace/db");
  const { and, or, eq, gte, isNotNull, asc } = await import("drizzle-orm");

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - lookback_days);

  // Load ALL rows chronologically
  const raw = await db
    .select({
      id: accuracyResultsTable.id,
      symbol: accuracyResultsTable.symbol,
      structure_score: accuracyResultsTable.structure_score,
      order_flow_score: accuracyResultsTable.order_flow_score,
      recall_score: accuracyResultsTable.recall_score,
      final_quality: accuracyResultsTable.final_quality,
      setup_type: accuracyResultsTable.setup_type,
      regime: accuracyResultsTable.regime,
      direction: accuracyResultsTable.direction,
      outcome: accuracyResultsTable.outcome,
      tp_ticks: accuracyResultsTable.tp_ticks,
      sl_ticks: accuracyResultsTable.sl_ticks,
      created_at: accuracyResultsTable.created_at,
    })
    .from(accuracyResultsTable)
    .where(
      and(
        or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
        isNotNull(accuracyResultsTable.structure_score),
        isNotNull(accuracyResultsTable.order_flow_score),
        gte(accuracyResultsTable.created_at, cutoff),
      )
    )
    .orderBy(asc(accuracyResultsTable.created_at))
    .limit(50_000);

  const totalLoaded = raw.length;

  // Walk-forward split: first 80% = "train/historical", last 20% = OOS
  const splitIdx = Math.floor(totalLoaded * 0.8);
  const evalRows = use_oos_only ? raw.slice(splitIdx) : raw;

  const rows: SignalRow[] = evalRows.map(r => ({
    id: r.id ?? 0,
    symbol: r.symbol ?? "AAPL",
    structure_score: parseFloat(String(r.structure_score ?? "0")),
    order_flow_score: parseFloat(String(r.order_flow_score ?? "0")),
    recall_score: parseFloat(String(r.recall_score ?? "0")),
    final_quality: parseFloat(String(r.final_quality ?? "0")),
    setup_type: r.setup_type ?? "absorption_reversal",
    regime: r.regime ?? "ranging",
    direction: (r.direction ?? "long") as "long" | "short",
    outcome: (r.outcome ?? "loss") as "win" | "loss",
    tp_ticks: r.tp_ticks ?? 20,
    sl_ticks: r.sl_ticks ?? 10,
    created_at: r.created_at ?? new Date(),
  }));

  // ── Baseline filter: quality >= threshold ──────────────────────────────────
  const baselineTrades: Array<{ outcome: "win" | "loss"; tp: number; sl: number; edge: number; quality: number; regime: string; setup: string }> = [];
  for (const row of rows) {
    if (row.final_quality >= BASELINE_QUALITY_THRESHOLD) {
      const rrr = row.tp_ticks / Math.max(row.sl_ticks, 1);
      const edge = row.final_quality * rrr - (1 - row.final_quality);
      baselineTrades.push({
        outcome: row.outcome,
        tp: row.tp_ticks,
        sl: row.sl_ticks,
        edge,
        quality: row.final_quality,
        regime: row.regime,
        setup: row.setup_type,
      });
    }
  }

  // ── SI filter: run ensemble, take only approved ────────────────────────────
  const siTrades: Array<{ outcome: "win" | "loss"; tp: number; sl: number; edge: number; quality: number; regime: string; setup: string }> = [];
  const MOCK_EQUITY = initial_equity;
  const MOCK_ENTRY = 100;
  const MOCK_SL = 99;
  const MOCK_TP = 103;

  for (const row of rows) {
    try {
      const si = await processSuperSignal(row.id, row.symbol, {
        structure_score: row.structure_score,
        order_flow_score: row.order_flow_score,
        recall_score: row.recall_score,
        setup_type: row.setup_type,
        regime: row.regime,
        direction: row.direction,
        entry_price: MOCK_ENTRY,
        stop_loss: MOCK_SL,
        take_profit: MOCK_TP,
        atr: 0.5,
        equity: MOCK_EQUITY,
      });

      if (si.approved) {
        siTrades.push({
          outcome: row.outcome,
          tp: row.tp_ticks,
          sl: row.sl_ticks,
          edge: si.edge_score,
          quality: si.enhanced_quality,
          regime: row.regime,
          setup: row.setup_type,
        });
      }
    } catch (_) {
      // Skip errored signals
    }
  }

  // ── Per-regime breakdown ───────────────────────────────────────────────────
  const allRegimes = [...new Set(rows.map(r => r.regime))];
  const allSetups = [...new Set(rows.map(r => r.setup_type))];

  const by_regime: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }> = {};
  for (const regime of allRegimes) {
    const bTrades = baselineTrades.filter(t => t.regime === regime);
    const sTrades = siTrades.filter(t => t.regime === regime);
    const bRW: Record<string, number> = {};
    const bRT: Record<string, number> = {};
    const sRW: Record<string, number> = {};
    const sRT: Record<string, number> = {};
    bTrades.forEach(t => { bRW[t.regime] = (bRW[t.regime] ?? 0) + (t.outcome === "win" ? 1 : 0); bRT[t.regime] = (bRT[t.regime] ?? 0) + 1; });
    sTrades.forEach(t => { sRW[t.regime] = (sRW[t.regime] ?? 0) + (t.outcome === "win" ? 1 : 0); sRT[t.regime] = (sRT[t.regime] ?? 0) + 1; });
    by_regime[regime] = {
      baseline: calcMetrics(bTrades, bRW, bRT, initial_equity),
      si: calcMetrics(sTrades, sRW, sRT, initial_equity),
    };
  }

  const by_setup: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }> = {};
  for (const setup of allSetups) {
    const bTrades = baselineTrades.filter(t => t.setup === setup);
    const sTrades = siTrades.filter(t => t.setup === setup);
    const bRW: Record<string, number> = {};
    const bRT: Record<string, number> = {};
    const sRW: Record<string, number> = {};
    const sRT: Record<string, number> = {};
    bTrades.forEach(t => { bRW[t.regime] = (bRW[t.regime] ?? 0) + (t.outcome === "win" ? 1 : 0); bRT[t.regime] = (bRT[t.regime] ?? 0) + 1; });
    sTrades.forEach(t => { sRW[t.regime] = (sRW[t.regime] ?? 0) + (t.outcome === "win" ? 1 : 0); sRT[t.regime] = (sRT[t.regime] ?? 0) + 1; });
    by_setup[setup] = {
      baseline: calcMetrics(bTrades, bRW, bRT, initial_equity),
      si: calcMetrics(sTrades, sRW, sRT, initial_equity),
    };
  }

  // ── Overall metrics ────────────────────────────────────────────────────────
  const bRW: Record<string, number> = {};
  const bRT: Record<string, number> = {};
  const sRW: Record<string, number> = {};
  const sRT: Record<string, number> = {};
  baselineTrades.forEach(t => { bRW[t.regime] = (bRW[t.regime] ?? 0) + (t.outcome === "win" ? 1 : 0); bRT[t.regime] = (bRT[t.regime] ?? 0) + 1; });
  siTrades.forEach(t => { sRW[t.regime] = (sRW[t.regime] ?? 0) + (t.outcome === "win" ? 1 : 0); sRT[t.regime] = (sRT[t.regime] ?? 0) + 1; });

  const baselineMetrics = calcMetrics(baselineTrades, bRW, bRT, initial_equity);
  const siMetrics = calcMetrics(siTrades, sRW, sRT, initial_equity);

  const significance = zTest(
    baselineTrades.length, baselineMetrics.win_rate,
    siTrades.length, siMetrics.win_rate,
  );

  const improvement = {
    win_rate_delta: parseFloat(((siMetrics.win_rate - baselineMetrics.win_rate) * 100).toFixed(2)),
    profit_factor_delta: parseFloat((siMetrics.profit_factor - baselineMetrics.profit_factor).toFixed(3)),
    sharpe_delta: parseFloat((siMetrics.sharpe_ratio - baselineMetrics.sharpe_ratio).toFixed(3)),
    max_dd_improvement: parseFloat((baselineMetrics.max_drawdown_pct - siMetrics.max_drawdown_pct).toFixed(2)),
    signals_filtered_pct: baselineTrades.length > 0
      ? parseFloat(((1 - siTrades.length / baselineTrades.length) * 100).toFixed(1))
      : 0,
    edge_lift: parseFloat((siMetrics.avg_edge_score - baselineMetrics.avg_edge_score).toFixed(4)),
  };

  return {
    config,
    total_signals_loaded: totalLoaded,
    train_samples: splitIdx,
    test_samples: totalLoaded - splitIdx,
    baseline: baselineMetrics,
    super_intelligence: siMetrics,
    improvement,
    by_regime,
    by_setup,
    equity_curve_baseline: calcEquityCurve(baselineTrades, initial_equity),
    equity_curve_si: calcEquityCurve(siTrades, initial_equity),
    significance,
    edge_decay: edgeDecay(baselineTrades, siTrades),
    generated_at: new Date().toISOString(),
  };
}
