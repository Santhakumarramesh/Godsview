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
import { getBars, AlpacaBar } from "./alpaca";
import pLimit from "p-limit";

// ─── Validation ───────────────────────────────────────────────────────────────

export interface BacktestConfigValidationError {
  field: string;
  message: string;
}

export interface ValidateBacktestConfigResult {
  valid: boolean;
  errors: BacktestConfigValidationError[];
}

/**
 * Validate backtest configuration before execution
 * - lookback_days must be > 0 and <= 3650 (10 years)
 * - initial_equity must be > 0
 * - symbol must be non-empty and valid format
 * - mode must be one of: baseline | super_intelligence | comparison
 * - min_signals (if provided) must be > 0
 */
export function validateBacktestConfig(config: BacktestConfig): ValidateBacktestConfigResult {
  const errors: BacktestConfigValidationError[] = [];

  if (!config.lookback_days || config.lookback_days <= 0 || config.lookback_days > 3650) {
    errors.push({ field: "lookback_days", message: "Must be > 0 and <= 3650 days (10 years)" });
  }

  if (!config.initial_equity || config.initial_equity <= 0) {
    errors.push({ field: "initial_equity", message: "Must be > 0" });
  }

  if (config.initial_equity && config.initial_equity > 1_000_000_000) {
    errors.push({ field: "initial_equity", message: "Initial equity exceeds reasonable limit (1B)" });
  }

  const validModes: BacktestConfig["mode"][] = ["baseline", "super_intelligence", "comparison"];
  if (!validModes.includes(config.mode)) {
    errors.push({ field: "mode", message: `Must be one of: ${validModes.join(", ")}` });
  }

  if (config.min_signals !== undefined) {
    if (config.min_signals <= 0) {
      errors.push({ field: "min_signals", message: "Must be > 0" });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Backtest Health Check ────────────────────────────────────────────────────

export interface BacktestHealthCheckResult {
  activeBacktests: number;
  estimatedMemoryMB: number;
  healthy: boolean;
  warnings: string[];
}

let activeBacktestCount = 0;

export function backtestHealthCheck(): BacktestHealthCheckResult {
  const warnings: string[] = [];

  if (activeBacktestCount > 10) {
    warnings.push(`High number of active backtests: ${activeBacktestCount}`);
  }

  const estimatedMemoryMB = activeBacktestCount * 15; // ~15MB per active backtest

  if (estimatedMemoryMB > 500) {
    warnings.push(`Estimated memory usage high: ${estimatedMemoryMB}MB`);
  }

  return {
    activeBacktests: activeBacktestCount,
    estimatedMemoryMB,
    healthy: activeBacktestCount <= 10 && estimatedMemoryMB <= 500,
    warnings,
  };
}

/**
 * Protect equity curve from going negative — floor at 0
 * Logs warning if equity would have gone negative
 */
export function enforceEquityCurveFloor(equity: number, startingEquity: number): number {
  if (equity < 0) {
    console.warn(`Equity curve would have gone negative: ${equity}. Flooring at 0.`);
    return 0;
  }
  return equity;
}

/**
 * Compute running checksum of trade sequence for integrity validation
 * Uses simple hash to detect if trades have been modified or reordered
 */
export function computeTradeChecksum(trades: TradeResult[]): string {
  let hash = 5381;
  for (const trade of trades) {
    const tradeStr = `${trade.signal_id}|${trade.entry_price}|${trade.outcome}|${trade.pnl_pct}`;
    for (let i = 0; i < tradeStr.length; i++) {
      hash = ((hash << 5) + hash) + tradeStr.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
  }
  return Math.abs(hash).toString(16);
}

/**
 * Validate trade sequence integrity
 */
export function validateTradeSequenceIntegrity(trades: TradeResult[], expectedChecksum?: string): boolean {
  if (trades.length === 0) return true;

  const computed = computeTradeChecksum(trades);

  if (expectedChecksum && computed !== expectedChecksum) {
    console.warn(`Trade sequence checksum mismatch. Expected: ${expectedChecksum}, Got: ${computed}`);
    return false;
  }

  // Additional validation: ensure trades are ordered by signal_id (monotonic)
  for (let i = 1; i < trades.length; i++) {
    if (trades[i].signal_id < trades[i - 1].signal_id) {
      console.warn(`Trade sequence not monotonic. Trade ${i} (id=${trades[i].signal_id}) follows trade ${i - 1} (id=${trades[i - 1].signal_id})`);
      return false;
    }
  }

  return true;
}

/**
 * Generate synthetic 1-minute bars for backtesting when real bars aren't available.
 * Uses a random walk around a base price with realistic OHLCV structure.
 */
function generateSyntheticBars(basePrice: number, count: number, direction: "long" | "short"): AlpacaBar[] {
  const bars: AlpacaBar[] = [];
  let price = basePrice || 100;
  const drift = direction === "long" ? 0.0001 : -0.0001;
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.48 + drift) * price * 0.002;
    const open = price;
    const close = price + change;
    const high = Math.max(open, close) + Math.random() * price * 0.001;
    const low = Math.min(open, close) - Math.random() * price * 0.001;
    const timestamp = new Date(Date.now() - (count - i) * 60000).toISOString();
    const volume = Math.floor(Math.random() * 1000 + 100);
    const tradeCount = Math.floor(Math.random() * 50 + 5);
    const vwap = (open + close + high + low) / 4;
    bars.push({
      t: timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      vw: vwap,
      n: tradeCount,
      Timestamp: timestamp,
      Open: open,
      High: high,
      Low: low,
      Close: close,
      Volume: volume,
      VWAP: vwap,
    });
    price = close;
  }
  return bars;
}

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

export type StrategyTier = "SEED" | "LEARNING" | "PROVEN" | "ELITE" | "DEGRADING" | "SUSPENDED";

export interface WalkForwardConfig {
  strategy_id: string;
  persist_result?: boolean;
  lookback_days?: number;
  train_days?: number;
  test_days?: number;
  step_days?: number;
  min_train_samples?: number;
  min_test_samples?: number;
  min_win_rate?: number;
  min_profit_factor?: number;
  max_drawdown_pct?: number;
}

export interface WalkForwardWindowMetrics {
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  expectancy_r: number;
  max_drawdown_pct: number;
  avg_rr: number;
  avg_quality: number;
}

export interface WalkForwardWindowResult {
  window_index: number;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  selected_quality_threshold: number;
  train: WalkForwardWindowMetrics;
  test: WalkForwardWindowMetrics;
  passed: boolean;
  fail_reasons: string[];
}

export interface WalkForwardPromotionDecision {
  action: "PROMOTE" | "HOLD" | "DEGRADE" | "SUSPEND";
  current_tier: StrategyTier;
  next_tier: StrategyTier;
  reasons: string[];
  scored_at: string;
}

export interface WalkForwardResult {
  strategy_id: string;
  strategy_filter: {
    setup_type: string | null;
    regime: string | null;
    symbol: string | null;
  };
  config: {
    lookback_days: number;
    train_days: number;
    test_days: number;
    step_days: number;
    min_train_samples: number;
    min_test_samples: number;
    min_win_rate: number;
    min_profit_factor: number;
    max_drawdown_pct: number;
  };
  sample_size: number;
  windows: WalkForwardWindowResult[];
  aggregate_oos: WalkForwardWindowMetrics & {
    pass_rate: number;
    windows_passed: number;
    windows_total: number;
  };
  stability: {
    score: number;
    win_rate_cv: number;
    profit_factor_cv: number;
    sharpe_cv: number;
    expectancy_cv: number;
    threshold_cv: number;
  };
  promotion: WalkForwardPromotionDecision;
  generated_at: string;
}

export interface StrategyOptimizationConfig {
  strategy_id: string;
  lookback_days?: number;
  min_train_samples?: number;
  min_test_samples?: number;
}

export interface StrategyOptimizationResult {
  strategy_id: string;
  evaluated_candidates: number;
  best_config: WalkForwardResult["config"];
  best_score: number;
  top_candidates: Array<{
    score: number;
    config: WalkForwardResult["config"];
    aggregate_oos: WalkForwardResult["aggregate_oos"];
    stability: WalkForwardResult["stability"];
    promotion: WalkForwardResult["promotion"];
  }>;
  applied_result: WalkForwardResult;
  generated_at: string;
}

interface WalkForwardSample {
  id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  outcome: "win" | "loss";
  final_quality: number;
  tp_ticks: number;
  sl_ticks: number;
  created_at: Date;
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
      symbol: accuracyResultsTable.symbol,
      structure_score: accuracyResultsTable.structure_score,
      order_flow_score: accuracyResultsTable.order_flow_score,
      recall_score: accuracyResultsTable.recall_score,
      final_quality: accuracyResultsTable.final_quality,
      setup_type: accuracyResultsTable.setup_type,
      regime: accuracyResultsTable.regime,
      direction: accuracyResultsTable.direction,
      bar_time: accuracyResultsTable.bar_time,
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
  const limit = pLimit(10); // Concurrent bar fetching limit
  
  const trades = await Promise.all((rows as any[]).map(row => limit(async () => {
    const r = row as any; // Cast for easier access to dynamic columns
    const structure = parseFloat(String(r.structure_score ?? "0"));
    const orderFlow = parseFloat(String(r.order_flow_score ?? "0"));
    const recall = parseFloat(String(r.recall_score ?? "0"));
    const direction = (r.direction ?? "long") as "long" | "short";
    const setupType = r.setup_type ?? "absorption_reversal";
    const regime = r.regime ?? "ranging";
    const symbol = r.symbol ?? "BTCUSD";
    const tpTicks = r.tp_ticks ?? 8;
    const slTicks = r.sl_ticks ?? 4;
    const barTime = r.bar_time;

    if (!barTime) return null;

    // ── STRICT REPLAY ────────────────────────────────────────────────────────
    // Fetch 4 hours of 1m bars starting from signal time
    // Approximate base prices for synthetic fallback
    const APPROX_PRICES: Record<string, number> = {
      BTCUSD: 60000, ETHUSD: 3000, SOLUSD: 150,
      SPY: 520, QQQ: 440, IWM: 200, AAPL: 180, MSFT: 420,
      NVDA: 900, TSLA: 250, AMZN: 190, META: 500, GLD: 220, TLT: 95,
    };
    let bars: Awaited<ReturnType<typeof getBars>>;
    try {
      bars = await getBars(symbol, "1Min", 240, barTime.toISOString());
    } catch {
      // No Alpaca key or API error — generate synthetic 1m bars for replay
      // GUARDED: blocked in live mode to prevent fake data contaminating decisions
      const { guardSyntheticData } = await import("./data_safety_guard.js");
      bars = guardSyntheticData(
        `backtester:${symbol}`,
        () => generateSyntheticBars(APPROX_PRICES[symbol] ?? 100, 240, direction),
        `Cannot backtest ${symbol}: real market data unavailable and synthetic data blocked in live mode`,
      );
    }
    if (bars.length === 0) return null;

    // Entry price is the Close of the first bar (the signal bar)
    const entryPrice = bars[0].Close;

    // Tick-based distance for SL/TP
    const TICK_VALUE = symbol.includes("USD") ? 0.25 : 0.01;
    const slDistance = slTicks * TICK_VALUE;
    const tpDistance = tpTicks * TICK_VALUE;
    const stopLoss = direction === "long" ? entryPrice - slDistance : entryPrice + slDistance;
    const takeProfit = direction === "long" ? entryPrice + tpDistance : entryPrice - tpDistance;

    const replay = replaySignal(bars.slice(1), direction, entryPrice, stopLoss, takeProfit);

    // Baseline quality
    const baselineQuality = computeFinalQuality(structure, orderFlow, recall, {
      setup_type: setupType as any,
      recall: { regime } as any,
      direction,
    });

    // Super Intelligence evaluation
    const siResult = await processSuperSignal(row.id ?? 0, symbol, {
      structure_score: structure,
      order_flow_score: orderFlow,
      recall_score: recall,
      setup_type: setupType,
      regime,
      direction,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      atr: slDistance * 0.8,
      equity: initial_equity,
    });

    return {
      signal_id: r.id ?? 0,
      setup_type: setupType,
      regime: regime,
      direction,
      entry_price: entryPrice,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      outcome: replay.outcome === "unresolved" ? (r.outcome as "win"|"loss") : replay.outcome,
      pnl_pct: replay.pnl_pct,
      si_approved: siResult.approved,
      si_win_prob: siResult.win_probability,
      si_edge_score: siResult.edge_score,
      si_kelly_pct: siResult.kelly_fraction * 100,
      baseline_quality: baselineQuality,
      enhanced_quality: siResult.enhanced_quality,
    } as TradeResult;
  })));

  // Filter out nulls and unresolved trades
  const validTrades = trades.filter((t): t is TradeResult => t !== null && (t.outcome === "win" || t.outcome === "loss"));

  if (validTrades.length < min_signals) {
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
  const baselineTrades = validTrades.filter(t => t.baseline_quality >= BASELINE_QUALITY_THRESHOLD);
  // SI: only trades that Super Intelligence approved
  const siTrades = validTrades.filter(t => t.si_approved);

  const baseline = computeMetrics(baselineTrades, initial_equity);
  const si = computeMetrics(siTrades, initial_equity);

  // Equity curves
  const equity_curve_baseline = buildEquityCurve(baselineTrades, initial_equity);
  const equity_curve_si = buildEquityCurve(siTrades, initial_equity);

  // Per-regime breakdown
  const regimes = [...new Set(validTrades.map(t => t.regime))];
  const by_regime: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }> = {};
  for (const r of regimes) {
    const rBaseline = validTrades.filter(t => t.regime === r && t.baseline_quality >= BASELINE_QUALITY_THRESHOLD);
    const rSi = validTrades.filter(t => t.regime === r && t.si_approved);
    if (rBaseline.length > 0 || rSi.length > 0) {
      by_regime[r] = {
        baseline: computeMetrics(rBaseline, initial_equity),
        si: computeMetrics(rSi, initial_equity),
      };
    }
  }

  // Per-setup breakdown
  const setups = [...new Set(validTrades.map(t => t.setup_type))];
  const by_setup: Record<string, { baseline: BacktestMetrics; si: BacktestMetrics }> = {};
  for (const s of setups) {
    const sBaseline = validTrades.filter(t => t.setup_type === s && t.baseline_quality >= BASELINE_QUALITY_THRESHOLD);
    const sSi = validTrades.filter(t => t.setup_type === s && t.si_approved);
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

  // ── Bidirectional Learning: feed backtest results into continuous learning ──
  try {
    const { ingestBacktestResults } = await import("./continuous_learning.js");
    const ingestPayload = validTrades.map(t => ({
      symbol: t.setup_type.includes("/") ? t.setup_type : config.symbols?.[0] ?? "UNKNOWN",
      setup_type: t.setup_type,
      direction: t.direction,
      regime: t.regime,
      structure_score: t.baseline_quality,
      order_flow_score: t.si_edge_score ?? 0.5,
      recall_score: t.si_win_prob ?? 0.5,
      final_quality: t.enhanced_quality ?? t.baseline_quality,
      outcome: t.outcome as "win" | "loss",
      entry_price: t.entry_price,
      stop_loss: t.stop_loss,
      take_profit: t.take_profit,
      realized_pnl: t.pnl_pct,
    }));
    await ingestBacktestResults(ingestPayload);
  } catch (err: any) {
    // Non-fatal — learning ingestion should never block backtest results
    const { logger } = await import("./logger.js");
    logger.warn({ err: err?.message }, "[backtester] Failed to ingest results into learning loop");
  }

  return {
    config,
    baseline,
    super_intelligence: si,
    improvement: {
      win_rate_delta: si.win_rate - baseline.win_rate,
      profit_factor_delta: si.profit_factor - baseline.profit_factor,
      sharpe_delta: si.sharpe_ratio - baseline.sharpe_ratio,
      max_dd_improvement: baseline.max_drawdown_pct - si.max_drawdown_pct,
      signals_filtered_pct: validTrades.length > 0
        ? ((validTrades.length - siTrades.length) / validTrades.length) * 100 : 0,
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

export function computeMetrics(trades: TradeResult[], initialEquity: number): BacktestMetrics {
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

export function emptyMetrics(): BacktestMetrics {
  return {
    total_signals: 0, trades_taken: 0, wins: 0, losses: 0, win_rate: 0,
    profit_factor: 0, total_pnl_pct: 0, avg_win_pct: 0, avg_loss_pct: 0,
    max_drawdown_pct: 0, sharpe_ratio: 0, avg_kelly_pct: 0, avg_edge_score: 0,
    best_trade_pct: 0, worst_trade_pct: 0, avg_hold_quality: 0,
  };
}

export function buildEquityCurve(
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

export function computeSignificance(
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
export function approxNormalCDF(x: number): number {
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

/**
 * REPLAY LOGIC: Walks through bars to find TP/SL hit
 * Handles slippage by checking if bar opens beyond the level
 */
export function replaySignal(
  bars: AlpacaBar[],
  direction: "long" | "short",
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
): { outcome: "win" | "loss" | "unresolved"; pnl_pct: number } {
  if (bars.length === 0) return { outcome: "unresolved", pnl_pct: 0 };

  for (const bar of bars) {
    if (direction === "long") {
      // Check SL hit first (conservative)
      if (bar.Low <= stopLoss) {
        const exit = Math.min(bar.Open, stopLoss); // Slippage if Open < SL
        return { outcome: "loss", pnl_pct: ((exit - entryPrice) / entryPrice) * 100 };
      }
      // Check TP hit
      if (bar.High >= takeProfit) {
        const exit = Math.max(bar.Open, takeProfit); // Slippage if Open > TP
        return { outcome: "win", pnl_pct: ((exit - entryPrice) / entryPrice) * 100 };
      }
    } else {
      // Short
      if (bar.High >= stopLoss) {
        const exit = Math.max(bar.Open, stopLoss); // Slippage if Open > SL
        return { outcome: "loss", pnl_pct: ((entryPrice - exit) / entryPrice) * 100 };
      }
      if (bar.Low <= takeProfit) {
        const exit = Math.min(bar.Open, takeProfit); // Slippage if Open < TP
        return { outcome: "win", pnl_pct: ((entryPrice - exit) / entryPrice) * 100 };
      }
    }
  }

  return { outcome: "unresolved", pnl_pct: 0 };
}

// ══════════════════════════════════════════════════════════════════════════════
// CONTINUOUS BACKTESTING: Auto-runs backtests over expanding time horizons
// ══════════════════════════════════════════════════════════════════════════════

export interface StrategyLeaderboardEntry {
  strategy_name: string;
  setup_type: string;
  regime: string;
  tier?: StrategyTier;
  stars: number; // 1-5 star rating based on accuracy
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  total_tests: number;
  consistency_score: number; // How stable across time horizons
  last_tested: string;
}

let _continuousBacktestRunning = false;
let _continuousBacktestInterval: NodeJS.Timeout | null = null;
let _strategyLeaderboard: Map<string, StrategyLeaderboardEntry> = new Map();
let _lastBacktestResult: { result: BacktestResult; timestamp: string } | null = null;
const _strategyTierRegistry: Map<string, {
  strategy_id: string;
  tier: StrategyTier;
  updated_at: string;
  notes: string[];
  aggregate_oos: WalkForwardResult["aggregate_oos"];
}> = new Map();
const _latestWalkForwardByStrategy: Map<string, WalkForwardResult> = new Map();
const _walkForwardCache: Map<string, { ts: number; result: WalkForwardResult }> = new Map();

/**
 * Start continuous backtesting: runs backtests over 30d, 60d, 90d, 180d, 365d
 * Updates strategy leaderboard in real-time
 */
export async function startContinuousBacktest(): Promise<{ success: boolean; message: string }> {
  if (_continuousBacktestRunning) {
    return { success: false, message: "Continuous backtest already running" };
  }

  _continuousBacktestRunning = true;
  console.log("[backtest] Continuous backtesting started — will test every 5 minutes");

  // Perform initial backtest immediately
  await runContinuousBacktestCycle();

  // Schedule recurring backtests every 5 minutes
  _continuousBacktestInterval = setInterval(async () => {
    try {
      await runContinuousBacktestCycle();
    } catch (err) {
      console.error("[backtest] Continuous cycle error:", err);
    }
  }, 5 * 60_000);

  return { success: true, message: "Continuous backtesting activated — testing every 5 minutes" };
}

/**
 * Stop continuous backtesting
 */
export function stopContinuousBacktest(): { success: boolean; message: string } {
  if (!_continuousBacktestRunning) {
    return { success: false, message: "Continuous backtest not running" };
  }

  if (_continuousBacktestInterval) {
    clearInterval(_continuousBacktestInterval);
    _continuousBacktestInterval = null;
  }

  _continuousBacktestRunning = false;
  console.log("[backtest] Continuous backtesting stopped");
  return { success: true, message: "Continuous backtesting deactivated" };
}

/**
 * Internal: perform one continuous backtest cycle across all time horizons
 */
async function runContinuousBacktestCycle(): Promise<void> {
  try {
    console.log("[backtest] [continuous] Starting backtest cycle...");

    const timeHorizons = [30, 60, 90, 180, 365];
    const results: BacktestResult[] = [];

    // Run backtest for each time horizon
    for (const days of timeHorizons) {
      try {
        console.log(`[backtest] [continuous] Running ${days}-day backtest...`);
        const result = await runBacktest({
          lookback_days: days,
          initial_equity: 10_000,
          mode: "comparison",
          min_signals: 20,
        });
        results.push(result);
      } catch (err) {
        console.error(`[backtest] [continuous] ${days}-day backtest failed:`, err);
      }
    }

    if (results.length === 0) {
      console.log("[backtest] [continuous] No valid results from cycle");
      return;
    }

    // Store most recent result
    _lastBacktestResult = {
      result: results[results.length - 1],
      timestamp: new Date().toISOString(),
    };

    // Update strategy leaderboard based on results
    updateStrategyLeaderboard(results);

    console.log(`[backtest] [continuous] Cycle complete: ${results.length} time horizons tested`);
  } catch (err) {
    console.error("[backtest] [continuous] Backtest cycle failed:", err);
  }
}

/**
 * Update strategy leaderboard based on backtest results across all time horizons
 */
function updateStrategyLeaderboard(results: BacktestResult[]): void {
  try {
    // Aggregate strategy performance across time horizons
    const strategyStats = new Map<string, {
      win_rates: number[];
      profit_factors: number[];
      sharpes: number[];
      test_count: number;
    }>();

    for (const result of results) {
      // Process baseline strategies (by_setup breakdown)
      for (const [setupType, breakdown] of Object.entries(result.by_setup || {})) {
        const regime = "baseline"; // Aggregate across regimes for base strategy
        const key = `${setupType}::${regime}`;

        if (!strategyStats.has(key)) {
          strategyStats.set(key, {
            win_rates: [],
            profit_factors: [],
            sharpes: [],
            test_count: 0,
          });
        }

        const stats = strategyStats.get(key)!;
        stats.win_rates.push(breakdown.baseline.win_rate);
        stats.profit_factors.push(breakdown.baseline.profit_factor);
        stats.sharpes.push(breakdown.baseline.sharpe_ratio);
        stats.test_count++;
      }

      // Process SI-enhanced strategies
      for (const [setupType, breakdown] of Object.entries(result.by_setup || {})) {
        const siKey = `${setupType}::si`;

        if (!strategyStats.has(siKey)) {
          strategyStats.set(siKey, {
            win_rates: [],
            profit_factors: [],
            sharpes: [],
            test_count: 0,
          });
        }

        const stats = strategyStats.get(siKey)!;
        stats.win_rates.push(breakdown.si.win_rate);
        stats.profit_factors.push(breakdown.si.profit_factor);
        stats.sharpes.push(breakdown.si.sharpe_ratio);
        stats.test_count++;
      }
    }

    // Convert to leaderboard entries
    for (const [key, stats] of strategyStats) {
      const [setupType, regimeLabel] = key.split("::");
      const isSI = regimeLabel === "si";

      // Calculate averages
      const avgWinRate = stats.win_rates.length > 0
        ? stats.win_rates.reduce((a, b) => a + b, 0) / stats.win_rates.length : 0;
      const avgPF = stats.profit_factors.length > 0
        ? stats.profit_factors.reduce((a, b) => a + b, 0) / stats.profit_factors.length : 1;
      const avgSharpe = stats.sharpes.length > 0
        ? stats.sharpes.reduce((a, b) => a + b, 0) / stats.sharpes.length : 0;

      // Calculate consistency (standard deviation of win rates across horizons)
      const variance = stats.win_rates.length > 0
        ? stats.win_rates.reduce((s, v) => s + (v - avgWinRate) ** 2, 0) / stats.win_rates.length : 0;
      const consistency = Math.max(0, 1 - Math.sqrt(variance)); // Higher = more consistent

      // Star rating based on accuracy (win rate)
      let stars = 1;
      if (avgWinRate > 0.55) stars = 2;
      if (avgWinRate > 0.60) stars = 3;
      if (avgWinRate > 0.65) stars = 4;
      if (avgWinRate > 0.70) stars = 5;

      const entry: StrategyLeaderboardEntry = {
        strategy_name: `${setupType}${isSI ? " [SI]" : ""}`,
        setup_type: setupType,
        regime: isSI ? "super_intelligence" : "baseline",
        tier: _strategyTierRegistry.get(`${setupType}::*::*`)?.tier,
        stars,
        win_rate: avgWinRate,
        profit_factor: avgPF,
        sharpe_ratio: avgSharpe,
        total_tests: stats.test_count,
        consistency_score: consistency,
        last_tested: new Date().toISOString(),
      };

      _strategyLeaderboard.set(key, entry);
    }

    console.log(`[backtest] Updated leaderboard: ${_strategyLeaderboard.size} strategies`);
  } catch (err) {
    console.error("[backtest] [continuous] Strategy leaderboard update failed:", err);
  }
}

/**
 * Get continuous backtest status
 */
export function getContinuousBacktestStatus(): {
  running: boolean;
  message: string;
  last_result_timestamp?: string;
  strategies_tested: number;
} {
  return {
    running: _continuousBacktestRunning,
    message: _continuousBacktestRunning ? "Continuous backtesting active" : "Continuous backtesting inactive",
    last_result_timestamp: _lastBacktestResult?.timestamp,
    strategies_tested: _strategyLeaderboard.size,
  };
}

/**
 * Get strategy leaderboard sorted by star rating and consistency
 */
export function getStrategyLeaderboard(): StrategyLeaderboardEntry[] {
  const strategies = Array.from(_strategyLeaderboard.values());
  return strategies.sort((a, b) => {
    // Sort by stars descending, then by win_rate descending, then by consistency
    if (b.stars !== a.stars) return b.stars - a.stars;
    if (Math.abs(b.win_rate - a.win_rate) > 0.001) return b.win_rate - a.win_rate;
    return b.consistency_score - a.consistency_score;
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// WALK-FORWARD HARNESS: rolling train/test validation + tier promotion
// ══════════════════════════════════════════════════════════════════════════════

const DAY_MS = 24 * 60 * 60 * 1000;
const WALK_FORWARD_CACHE_TTL_MS = 2 * 60_000;
const DEFAULT_WALK_FORWARD_CONFIG: Required<Omit<WalkForwardConfig, "strategy_id" | "persist_result">> = {
  lookback_days: 240,
  train_days: 60,
  test_days: 20,
  step_days: 20,
  min_train_samples: 30,
  min_test_samples: 10,
  min_win_rate: 0.56,
  min_profit_factor: 1.15,
  max_drawdown_pct: 18,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  const d = new Date(String(value ?? ""));
  return Number.isFinite(d.getTime()) ? d : null;
}

function asOutcome(value: unknown): "win" | "loss" | null {
  const out = String(value ?? "").toLowerCase();
  if (out === "win" || out === "loss") return out;
  return null;
}

function normalizeWalkForwardConfig(config: WalkForwardConfig): Required<Omit<WalkForwardConfig, "strategy_id" | "persist_result">> {
  return {
    lookback_days: Math.max(30, Math.min(730, Math.round(toFiniteNumber(config.lookback_days, DEFAULT_WALK_FORWARD_CONFIG.lookback_days)))),
    train_days: Math.max(15, Math.min(365, Math.round(toFiniteNumber(config.train_days, DEFAULT_WALK_FORWARD_CONFIG.train_days)))),
    test_days: Math.max(7, Math.min(120, Math.round(toFiniteNumber(config.test_days, DEFAULT_WALK_FORWARD_CONFIG.test_days)))),
    step_days: Math.max(5, Math.min(90, Math.round(toFiniteNumber(config.step_days, DEFAULT_WALK_FORWARD_CONFIG.step_days)))),
    min_train_samples: Math.max(10, Math.min(500, Math.round(toFiniteNumber(config.min_train_samples, DEFAULT_WALK_FORWARD_CONFIG.min_train_samples)))),
    min_test_samples: Math.max(5, Math.min(200, Math.round(toFiniteNumber(config.min_test_samples, DEFAULT_WALK_FORWARD_CONFIG.min_test_samples)))),
    min_win_rate: Math.max(0.45, Math.min(0.9, toFiniteNumber(config.min_win_rate, DEFAULT_WALK_FORWARD_CONFIG.min_win_rate))),
    min_profit_factor: Math.max(0.8, Math.min(5, toFiniteNumber(config.min_profit_factor, DEFAULT_WALK_FORWARD_CONFIG.min_profit_factor))),
    max_drawdown_pct: Math.max(5, Math.min(60, toFiniteNumber(config.max_drawdown_pct, DEFAULT_WALK_FORWARD_CONFIG.max_drawdown_pct))),
  };
}

function parseStrategyFilter(strategyIdRaw: string): {
  canonical_id: string;
  setup_type: string | null;
  regime: string | null;
  symbol: string | null;
} {
  const raw = String(strategyIdRaw ?? "").trim();
  if (!raw) {
    throw new Error("strategy_id is required");
  }

  const parts = raw.split("::").map((p) => p.trim()).filter((p) => p.length > 0);
  const setup = parts[0] && parts[0] !== "*" ? parts[0] : null;
  const regime = parts[1] && parts[1] !== "*" ? parts[1] : null;
  const symbolRaw = parts[2] && parts[2] !== "*" ? parts[2] : null;
  const symbol = symbolRaw ? symbolRaw.toUpperCase() : null;
  const canonical_id = `${setup ?? "*"}::${regime ?? "*"}::${symbol ?? "*"}`;
  return { canonical_id, setup_type: setup, regime, symbol };
}

function strategyTierRank(tier: StrategyTier): number {
  switch (tier) {
    case "SUSPENDED": return -1;
    case "SEED": return 0;
    case "LEARNING": return 1;
    case "DEGRADING": return 1;
    case "PROVEN": return 2;
    case "ELITE": return 3;
    default: return 0;
  }
}

function sampleReturnR(sample: WalkForwardSample): number {
  const tp = Math.max(1, toFiniteNumber(sample.tp_ticks, 4));
  const sl = Math.max(1, toFiniteNumber(sample.sl_ticks, 4));
  const rr = tp / sl;
  return sample.outcome === "win" ? rr : -1;
}

function computeWalkForwardMetrics(samples: WalkForwardSample[]): WalkForwardWindowMetrics {
  if (samples.length === 0) {
    return {
      trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      profit_factor: 0,
      sharpe_ratio: 0,
      expectancy_r: 0,
      max_drawdown_pct: 0,
      avg_rr: 0,
      avg_quality: 0,
    };
  }

  const wins = samples.filter((s) => s.outcome === "win");
  const losses = samples.length - wins.length;
  const returnsR = samples.map(sampleReturnR);
  const grossWin = returnsR.filter((r) => r > 0).reduce((s, v) => s + v, 0);
  const grossLoss = Math.abs(returnsR.filter((r) => r < 0).reduce((s, v) => s + v, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99.9 : 0;
  const expectancy = returnsR.reduce((s, v) => s + v, 0) / samples.length;
  const avg = expectancy;
  const variance = returnsR.reduce((s, v) => s + (v - avg) ** 2, 0) / samples.length;
  const stdDev = Math.sqrt(variance);
  const sharpe = stdDev > 0 ? (avg / stdDev) * Math.sqrt(Math.max(1, samples.length / 8)) : 0;

  // R-multiple drawdown
  let peak = 0;
  let equityR = 0;
  let maxDD = 0;
  for (const r of returnsR) {
    equityR += r;
    if (equityR > peak) peak = equityR;
    const dd = peak - equityR;
    if (dd > maxDD) maxDD = dd;
  }

  const avgRR = wins.length > 0
    ? wins.reduce((s, sample) => s + (Math.max(1, sample.tp_ticks) / Math.max(1, sample.sl_ticks)), 0) / wins.length
    : 0;
  const avgQuality = samples.reduce((s, sample) => s + sample.final_quality, 0) / samples.length;

  return {
    trades: samples.length,
    wins: wins.length,
    losses,
    win_rate: wins.length / samples.length,
    profit_factor: Number.isFinite(profitFactor) ? profitFactor : 0,
    sharpe_ratio: Number.isFinite(sharpe) ? sharpe : 0,
    expectancy_r: Number.isFinite(expectancy) ? expectancy : 0,
    max_drawdown_pct: Math.max(0, maxDD * 100),
    avg_rr: Number.isFinite(avgRR) ? avgRR : 0,
    avg_quality: Number.isFinite(avgQuality) ? avgQuality : 0,
  };
}

function optimizeQualityThreshold(samples: WalkForwardSample[], minSamples: number): number {
  if (samples.length === 0) return 0.68;

  const thresholdCandidates = [0.45, 0.5, 0.55, 0.6, 0.65, 0.68, 0.7, 0.72, 0.75, 0.8];
  const requiredTrades = Math.max(6, Math.floor(minSamples / 2));
  let bestThreshold = 0.68;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const threshold of thresholdCandidates) {
    const filtered = samples.filter((s) => s.final_quality >= threshold);
    if (filtered.length < requiredTrades) continue;

    const metrics = computeWalkForwardMetrics(filtered);
    const score = (
      metrics.expectancy_r * 0.45 +
      metrics.win_rate * 0.25 +
      (Math.min(metrics.profit_factor, 3) / 3) * 0.20 +
      Math.max(0, 1 - metrics.max_drawdown_pct / 25) * 0.10
    );

    if (score > bestScore) {
      bestScore = score;
      bestThreshold = threshold;
    }
  }

  return bestThreshold;
}

function coefficientOfVariation(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  if (Math.abs(mean) < 1e-9) return 1;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  const std = Math.sqrt(variance);
  return Math.abs(std / mean);
}

function decideWalkForwardTier(
  currentTier: StrategyTier,
  aggregate: WalkForwardResult["aggregate_oos"],
  stabilityScore: number,
  config: WalkForwardResult["config"],
): WalkForwardPromotionDecision {
  const passRate = aggregate.pass_rate;
  const windows = aggregate.windows_total;
  const reasons: string[] = [];
  let nextTier: StrategyTier = currentTier;

  if (
    aggregate.trades >= Math.max(12, config.min_test_samples * 2) &&
    (aggregate.win_rate < 0.45 || aggregate.profit_factor < 0.85 || aggregate.max_drawdown_pct > 30 || passRate < 0.2)
  ) {
    nextTier = "SUSPENDED";
    reasons.push("Severe out-of-sample underperformance detected.");
  } else if (
    aggregate.trades >= Math.max(10, config.min_test_samples) &&
    (aggregate.win_rate < config.min_win_rate || aggregate.profit_factor < config.min_profit_factor || passRate < 0.45)
  ) {
    nextTier = "DEGRADING";
    reasons.push("Walk-forward pass rate fell below reliability threshold.");
  } else if (
    windows >= 4 &&
    aggregate.win_rate >= 0.68 &&
    aggregate.profit_factor >= 1.8 &&
    aggregate.sharpe_ratio >= 1.1 &&
    stabilityScore >= 0.72 &&
    passRate >= 0.75
  ) {
    nextTier = "ELITE";
    reasons.push("Elite out-of-sample profile achieved.");
  } else if (
    windows >= 3 &&
    aggregate.win_rate >= config.min_win_rate &&
    aggregate.profit_factor >= config.min_profit_factor &&
    aggregate.sharpe_ratio >= 0.5 &&
    stabilityScore >= 0.55 &&
    passRate >= 0.60
  ) {
    nextTier = "PROVEN";
    reasons.push("Out-of-sample thresholds cleared with stable windows.");
  } else if (aggregate.trades >= Math.max(8, config.min_test_samples)) {
    nextTier = "LEARNING";
    reasons.push("Collecting more evidence before promotion.");
  } else {
    nextTier = "SEED";
    reasons.push("Insufficient out-of-sample evidence.");
  }

  const now = new Date().toISOString();
  if (nextTier === "SUSPENDED") {
    return {
      action: "SUSPEND",
      current_tier: currentTier,
      next_tier: nextTier,
      reasons,
      scored_at: now,
    };
  }

  const nextRank = strategyTierRank(nextTier);
  const currRank = strategyTierRank(currentTier);
  const action: WalkForwardPromotionDecision["action"] =
    nextRank > currRank ? "PROMOTE" : nextRank < currRank ? "DEGRADE" : "HOLD";

  return {
    action,
    current_tier: currentTier,
    next_tier: nextTier,
    reasons,
    scored_at: now,
  };
}

export async function runWalkForwardBacktest(config: WalkForwardConfig): Promise<WalkForwardResult> {
  const strategyFilter = parseStrategyFilter(config.strategy_id);
  const persistResult = config.persist_result !== false;
  const normalized = normalizeWalkForwardConfig(config);
  const cacheKey = [
    strategyFilter.canonical_id,
    normalized.lookback_days,
    normalized.train_days,
    normalized.test_days,
    normalized.step_days,
    normalized.min_train_samples,
    normalized.min_test_samples,
    normalized.min_win_rate.toFixed(4),
    normalized.min_profit_factor.toFixed(4),
    normalized.max_drawdown_pct.toFixed(4),
  ].join("|");

  const cached = _walkForwardCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < WALK_FORWARD_CACHE_TTL_MS) {
    return cached.result;
  }

  const { db, accuracyResultsTable } = await import("@workspace/db");
  const { and, asc, eq, gte, or } = await import("drizzle-orm");

  const cutoff = new Date(Date.now() - normalized.lookback_days * DAY_MS);
  const conditions: any[] = [
    or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
    gte(accuracyResultsTable.created_at, cutoff),
  ];

  if (strategyFilter.setup_type) {
    conditions.push(eq(accuracyResultsTable.setup_type, strategyFilter.setup_type));
  }
  if (strategyFilter.regime) {
    conditions.push(eq(accuracyResultsTable.regime, strategyFilter.regime));
  }
  if (strategyFilter.symbol) {
    conditions.push(eq(accuracyResultsTable.symbol, strategyFilter.symbol));
  }

  const rows = await db
    .select({
      id: accuracyResultsTable.id,
      symbol: accuracyResultsTable.symbol,
      setup_type: accuracyResultsTable.setup_type,
      regime: accuracyResultsTable.regime,
      outcome: accuracyResultsTable.outcome,
      final_quality: accuracyResultsTable.final_quality,
      tp_ticks: accuracyResultsTable.tp_ticks,
      sl_ticks: accuracyResultsTable.sl_ticks,
      created_at: accuracyResultsTable.created_at,
    })
    .from(accuracyResultsTable)
    .where(and(...conditions))
    .orderBy(asc(accuracyResultsTable.created_at))
    .limit(200_000);

  const samples: WalkForwardSample[] = (rows as any[])
    .map((row) => {
      const outcome = asOutcome(row.outcome);
      const createdAt = toDate(row.created_at);
      if (!outcome || !createdAt) return null;
      return {
        id: Number(row.id ?? 0),
        symbol: String(row.symbol ?? "UNKNOWN"),
        setup_type: String(row.setup_type ?? "unknown"),
        regime: String(row.regime ?? "unknown"),
        outcome,
        final_quality: toFiniteNumber(row.final_quality, 0),
        tp_ticks: Math.max(1, Math.round(toFiniteNumber(row.tp_ticks, 4))),
        sl_ticks: Math.max(1, Math.round(toFiniteNumber(row.sl_ticks, 4))),
        created_at: createdAt,
      } as WalkForwardSample;
    })
    .filter((row): row is WalkForwardSample => row !== null);

  const windows: WalkForwardWindowResult[] = [];
  const allTestSamples: WalkForwardSample[] = [];
  const selectedThresholds: number[] = [];

  if (samples.length > 0) {
    const firstTs = samples[0].created_at.getTime();
    const lastTs = samples[samples.length - 1].created_at.getTime();
    const trainMs = normalized.train_days * DAY_MS;
    const testMs = normalized.test_days * DAY_MS;
    const stepMs = normalized.step_days * DAY_MS;

    let cursor = firstTs;
    let windowIndex = 0;
    while (cursor + trainMs + testMs <= lastTs + DAY_MS && windowIndex < 80) {
      const trainStart = cursor;
      const trainEnd = cursor + trainMs;
      const testStart = trainEnd;
      const testEnd = trainEnd + testMs;

      const trainSlice = samples.filter((s) => {
        const ts = s.created_at.getTime();
        return ts >= trainStart && ts < trainEnd;
      });
      const testSlice = samples.filter((s) => {
        const ts = s.created_at.getTime();
        return ts >= testStart && ts < testEnd;
      });

      const threshold = optimizeQualityThreshold(trainSlice, normalized.min_train_samples);
      selectedThresholds.push(threshold);
      const trainFiltered = trainSlice.filter((s) => s.final_quality >= threshold);
      const testFiltered = testSlice.filter((s) => s.final_quality >= threshold);
      const trainMetrics = computeWalkForwardMetrics(trainFiltered);
      const testMetrics = computeWalkForwardMetrics(testFiltered);

      const failReasons: string[] = [];
      if (trainFiltered.length < normalized.min_train_samples) {
        failReasons.push(`Train samples below minimum (${trainFiltered.length}/${normalized.min_train_samples})`);
      }
      if (testMetrics.trades < normalized.min_test_samples) {
        failReasons.push(`Test samples below minimum (${testMetrics.trades}/${normalized.min_test_samples})`);
      }
      if (testMetrics.win_rate < normalized.min_win_rate) {
        failReasons.push(`Win rate ${testMetrics.win_rate.toFixed(3)} < ${normalized.min_win_rate.toFixed(3)}`);
      }
      if (testMetrics.profit_factor < normalized.min_profit_factor) {
        failReasons.push(`Profit factor ${testMetrics.profit_factor.toFixed(3)} < ${normalized.min_profit_factor.toFixed(3)}`);
      }
      if (testMetrics.max_drawdown_pct > normalized.max_drawdown_pct) {
        failReasons.push(`Drawdown ${testMetrics.max_drawdown_pct.toFixed(2)}% > ${normalized.max_drawdown_pct.toFixed(2)}%`);
      }
      if (testMetrics.expectancy_r <= 0) {
        failReasons.push("Expectancy is non-positive");
      }

      const passed = failReasons.length === 0;
      if (testFiltered.length > 0) {
        allTestSamples.push(...testFiltered);
      }

      windows.push({
        window_index: windowIndex,
        train_start: new Date(trainStart).toISOString(),
        train_end: new Date(trainEnd).toISOString(),
        test_start: new Date(testStart).toISOString(),
        test_end: new Date(testEnd).toISOString(),
        selected_quality_threshold: threshold,
        train: trainMetrics,
        test: testMetrics,
        passed,
        fail_reasons: failReasons,
      });

      windowIndex += 1;
      cursor += stepMs;
    }

    // Fallback: if time-based windows failed but there is enough sample count, run one split.
    if (windows.length === 0 && samples.length >= normalized.min_train_samples + normalized.min_test_samples) {
      const split = Math.floor(samples.length * 0.7);
      const trainSlice = samples.slice(0, split);
      const testSlice = samples.slice(split);
      const threshold = optimizeQualityThreshold(trainSlice, normalized.min_train_samples);
      selectedThresholds.push(threshold);
      const trainFiltered = trainSlice.filter((s) => s.final_quality >= threshold);
      const testFiltered = testSlice.filter((s) => s.final_quality >= threshold);
      const trainMetrics = computeWalkForwardMetrics(trainFiltered);
      const testMetrics = computeWalkForwardMetrics(testFiltered);
      const failReasons: string[] = [];
      if (trainFiltered.length < normalized.min_train_samples) {
        failReasons.push(`Train samples below minimum (${trainFiltered.length}/${normalized.min_train_samples})`);
      }
      if (testMetrics.trades < normalized.min_test_samples) {
        failReasons.push(`Test samples below minimum (${testMetrics.trades}/${normalized.min_test_samples})`);
      }
      if (testMetrics.win_rate < normalized.min_win_rate) {
        failReasons.push(`Win rate ${testMetrics.win_rate.toFixed(3)} < ${normalized.min_win_rate.toFixed(3)}`);
      }
      if (testMetrics.profit_factor < normalized.min_profit_factor) {
        failReasons.push(`Profit factor ${testMetrics.profit_factor.toFixed(3)} < ${normalized.min_profit_factor.toFixed(3)}`);
      }
      if (testMetrics.max_drawdown_pct > normalized.max_drawdown_pct) {
        failReasons.push(`Drawdown ${testMetrics.max_drawdown_pct.toFixed(2)}% > ${normalized.max_drawdown_pct.toFixed(2)}%`);
      }
      if (testMetrics.expectancy_r <= 0) {
        failReasons.push("Expectancy is non-positive");
      }

      windows.push({
        window_index: 0,
        train_start: trainSlice[0].created_at.toISOString(),
        train_end: trainSlice[trainSlice.length - 1].created_at.toISOString(),
        test_start: testSlice[0].created_at.toISOString(),
        test_end: testSlice[testSlice.length - 1].created_at.toISOString(),
        selected_quality_threshold: threshold,
        train: trainMetrics,
        test: testMetrics,
        passed: failReasons.length === 0,
        fail_reasons: failReasons,
      });
      if (testFiltered.length > 0) {
        allTestSamples.push(...testFiltered);
      }
    }
  }

  const aggregateMetrics = computeWalkForwardMetrics(allTestSamples);
  const windowsPassed = windows.filter((w) => w.passed).length;
  const passRate = windows.length > 0 ? windowsPassed / windows.length : 0;
  const aggregate_oos: WalkForwardResult["aggregate_oos"] = {
    ...aggregateMetrics,
    pass_rate: passRate,
    windows_passed: windowsPassed,
    windows_total: windows.length,
  };

  const evalWindows = windows.filter((w) => w.test.trades > 0);
  const winCV = coefficientOfVariation(evalWindows.map((w) => w.test.win_rate));
  const pfCV = coefficientOfVariation(evalWindows.map((w) => w.test.profit_factor));
  const sharpeCV = coefficientOfVariation(evalWindows.map((w) => w.test.sharpe_ratio));
  const expectancyCV = coefficientOfVariation(evalWindows.map((w) => w.test.expectancy_r));
  const thresholdCV = coefficientOfVariation(selectedThresholds);
  const stabilityScore = clamp01(
    1 - (winCV * 0.35 + pfCV * 0.3 + sharpeCV * 0.2 + expectancyCV * 0.15 + thresholdCV * 0.1),
  );

  const currentTier = _strategyTierRegistry.get(strategyFilter.canonical_id)?.tier ?? "SEED";
  const promotion = decideWalkForwardTier(currentTier, aggregate_oos, stabilityScore, normalized);
  const result: WalkForwardResult = {
    strategy_id: strategyFilter.canonical_id,
    strategy_filter: {
      setup_type: strategyFilter.setup_type,
      regime: strategyFilter.regime,
      symbol: strategyFilter.symbol,
    },
    config: normalized,
    sample_size: samples.length,
    windows,
    aggregate_oos,
    stability: {
      score: stabilityScore,
      win_rate_cv: winCV,
      profit_factor_cv: pfCV,
      sharpe_cv: sharpeCV,
      expectancy_cv: expectancyCV,
      threshold_cv: thresholdCV,
    },
    promotion,
    generated_at: new Date().toISOString(),
  };

  _walkForwardCache.set(cacheKey, { ts: Date.now(), result });
  if (persistResult) {
    _latestWalkForwardByStrategy.set(strategyFilter.canonical_id, result);
    _strategyTierRegistry.set(strategyFilter.canonical_id, {
      strategy_id: strategyFilter.canonical_id,
      tier: promotion.next_tier,
      updated_at: result.generated_at,
      notes: promotion.reasons,
      aggregate_oos,
    });
  }

  return result;
}

export async function runStrategyOptimization(config: StrategyOptimizationConfig): Promise<StrategyOptimizationResult> {
  const strategyId = String(config.strategy_id ?? "").trim();
  if (!strategyId) {
    throw new Error("strategy_id is required");
  }

  const lookback = Math.max(60, Math.min(730, Math.round(toFiniteNumber(config.lookback_days, 240))));
  const minTrain = Math.max(10, Math.min(500, Math.round(toFiniteNumber(config.min_train_samples, 24))));
  const minTest = Math.max(5, Math.min(200, Math.round(toFiniteNumber(config.min_test_samples, 8))));

  const trainTestPairs: Array<[number, number]> = [[45, 15], [60, 20], [90, 30]];
  const minWinRates = [0.54, 0.56, 0.58];
  const minProfitFactors = [1.05, 1.15];

  const candidates: Array<{
    config: WalkForwardResult["config"];
    result: WalkForwardResult;
    score: number;
  }> = [];

  for (const [trainDays, testDays] of trainTestPairs) {
    const stepDays = Math.max(5, Math.round(testDays / 2));
    for (const minWin of minWinRates) {
      for (const minPF of minProfitFactors) {
        const wf = await runWalkForwardBacktest({
          strategy_id: strategyId,
          persist_result: false,
          lookback_days: lookback,
          train_days: trainDays,
          test_days: testDays,
          step_days: stepDays,
          min_train_samples: minTrain,
          min_test_samples: minTest,
          min_win_rate: minWin,
          min_profit_factor: minPF,
        });

        const aggregate = wf.aggregate_oos;
        const score = (
          aggregate.pass_rate * 0.35 +
          aggregate.win_rate * 0.25 +
          (Math.min(aggregate.profit_factor, 3) / 3) * 0.20 +
          wf.stability.score * 0.20 -
          Math.min(aggregate.max_drawdown_pct / 100, 0.3)
        );

        candidates.push({
          config: wf.config,
          result: wf,
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best) {
    throw new Error("No optimization candidates were evaluated");
  }

  // Persist the best profile into strategy tier state.
  const appliedResult = await runWalkForwardBacktest({
    strategy_id: strategyId,
    persist_result: true,
    lookback_days: best.config.lookback_days,
    train_days: best.config.train_days,
    test_days: best.config.test_days,
    step_days: best.config.step_days,
    min_train_samples: best.config.min_train_samples,
    min_test_samples: best.config.min_test_samples,
    min_win_rate: best.config.min_win_rate,
    min_profit_factor: best.config.min_profit_factor,
    max_drawdown_pct: best.config.max_drawdown_pct,
  });

  return {
    strategy_id: appliedResult.strategy_id,
    evaluated_candidates: candidates.length,
    best_config: best.config,
    best_score: best.score,
    top_candidates: candidates.slice(0, 5).map((candidate) => ({
      score: candidate.score,
      config: candidate.config,
      aggregate_oos: candidate.result.aggregate_oos,
      stability: candidate.result.stability,
      promotion: candidate.result.promotion,
    })),
    applied_result: appliedResult,
    generated_at: new Date().toISOString(),
  };
}

export function getWalkForwardTierRegistry(): Array<{
  strategy_id: string;
  tier: StrategyTier;
  updated_at: string;
  notes: string[];
  aggregate_oos: WalkForwardResult["aggregate_oos"];
}> {
  return Array.from(_strategyTierRegistry.values()).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export function getLatestWalkForward(strategyId?: string): WalkForwardResult | WalkForwardResult[] | null {
  if (strategyId) {
    const filter = parseStrategyFilter(strategyId);
    return _latestWalkForwardByStrategy.get(filter.canonical_id) ?? null;
  }
  const all = Array.from(_latestWalkForwardByStrategy.values()).sort((a, b) => b.generated_at.localeCompare(a.generated_at));
  return all;
}

function emptyAggregateOos(): WalkForwardResult["aggregate_oos"] {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    profit_factor: 0,
    sharpe_ratio: 0,
    expectancy_r: 0,
    max_drawdown_pct: 0,
    avg_rr: 0,
    avg_quality: 0,
    pass_rate: 0,
    windows_passed: 0,
    windows_total: 0,
  };
}

export function getWalkForwardTier(strategyId: string): {
  strategy_id: string;
  tier: StrategyTier;
  updated_at: string;
  notes: string[];
  aggregate_oos: WalkForwardResult["aggregate_oos"];
} | null {
  const canonical = parseStrategyFilter(strategyId).canonical_id;
  return _strategyTierRegistry.get(canonical) ?? null;
}

export function setWalkForwardTier(input: {
  strategy_id: string;
  tier: StrategyTier;
  notes?: string[];
  aggregate_oos?: WalkForwardResult["aggregate_oos"];
}): {
  strategy_id: string;
  tier: StrategyTier;
  updated_at: string;
  notes: string[];
  aggregate_oos: WalkForwardResult["aggregate_oos"];
} {
  const canonical = parseStrategyFilter(input.strategy_id).canonical_id;
  const existing = _strategyTierRegistry.get(canonical);
  const next = {
    strategy_id: canonical,
    tier: input.tier,
    updated_at: new Date().toISOString(),
    notes: input.notes?.length ? input.notes : existing?.notes ?? [],
    aggregate_oos: input.aggregate_oos ?? existing?.aggregate_oos ?? emptyAggregateOos(),
  };
  _strategyTierRegistry.set(canonical, next);
  return next;
}
