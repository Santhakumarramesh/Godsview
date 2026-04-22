/**
 * Backtest↔Live Alignment Engine
 *
 * Compares backtest assumptions against actual execution outcomes
 * from the execution truth layer (Phase 12). Produces:
 *
 * 1. Alignment snapshots — periodic comparison of BT vs live metrics
 * 2. Divergence scoring — how far live reality departs from BT expectations
 * 3. Drift detection — fires events when alignment degrades past thresholds
 * 4. Slippage calibration — adjusts BT slippage assumptions from real fills
 *
 * This is the core "proof of edge" mechanism: if backtest says X and live
 * shows Y, the delta is the alignment score. Strategies that stay aligned
 * earn trust; strategies that diverge get paused or demoted.
 */

import { logger } from "./logger";
import {
  db,
  alignmentSnapshotsTable,
  slippageCalibrationTable,
  driftEventsTable,
  fillsTable,
  ordersTable,
  executionMetricsTable,
} from "@workspace/db";
import { desc, eq, and, gte, lte, isNotNull, sql } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────

export type AlignmentVerdict = "aligned" | "drifting" | "diverged" | "insufficient_data";
export type DriftDirection = "backtest_optimistic" | "backtest_pessimistic" | "mixed";
export type DriftSeverity = "warning" | "critical";

export interface BacktestMetrics {
  win_rate: number;
  avg_pnl: number;
  sharpe: number;
  max_drawdown_pct: number;
  avg_slippage_bps: number;
  trade_count: number;
}

export interface LiveMetrics {
  win_rate: number;
  avg_pnl: number;
  sharpe: number;
  max_drawdown_pct: number;
  avg_slippage_bps: number;
  trade_count: number;
}

export interface DivergenceScores {
  win_rate: number;
  pnl: number;
  sharpe: number;
  slippage: number;
  composite: number; // 0-1, higher = better alignment
}

export interface AlignmentResult {
  strategy_id: string;
  symbol: string | null;
  period_start: Date;
  period_end: Date;
  backtest: BacktestMetrics;
  live: LiveMetrics;
  divergence: DivergenceScores;
  verdict: AlignmentVerdict;
  drift_direction: DriftDirection | null;
  regime: string | null;
  drift_events: Array<{
    metric: string;
    bt_value: number;
    live_value: number;
    divergence: number;
    severity: DriftSeverity;
  }>;
}

// ── Configuration ──────────────────────────────────────────────

export const ALIGNMENT_THRESHOLDS = {
  /** Min trades to produce a meaningful alignment score */
  MIN_TRADES: 10,

  /** Win rate divergence thresholds (absolute difference) */
  WIN_RATE_WARNING: 0.10,   // 10% difference
  WIN_RATE_CRITICAL: 0.20,  // 20% difference

  /** PnL divergence thresholds (ratio: |bt - live| / max(|bt|, |live|)) */
  PNL_WARNING: 0.30,     // 30% divergence
  PNL_CRITICAL: 0.50,    // 50% divergence

  /** Sharpe divergence thresholds (absolute difference) */
  SHARPE_WARNING: 0.50,
  SHARPE_CRITICAL: 1.00,

  /** Slippage divergence thresholds (bps difference) */
  SLIPPAGE_WARNING: 5.0,   // 5 bps
  SLIPPAGE_CRITICAL: 15.0, // 15 bps

  /** Composite score below this = drifting */
  COMPOSITE_DRIFTING: 0.70,
  /** Composite score below this = diverged */
  COMPOSITE_DIVERGED: 0.40,
};

// ── Core Divergence Computation ────────────────────────────────

/**
 * Compute divergence between a backtest metric and live metric.
 * Returns a value between 0 (identical) and 1+ (diverged).
 */
export function computeRateDivergence(bt: number, live: number): number {
  return Math.abs(bt - live);
}

/**
 * Compute relative divergence for magnitude values (PnL, etc).
 * Uses ratio: |bt - live| / max(|bt|, |live|, 1).
 * Returns 0 for identical, approaches 1 for total divergence.
 */
export function computeRelativeDivergence(bt: number, live: number): number {
  const denom = Math.max(Math.abs(bt), Math.abs(live), 1);
  return Math.abs(bt - live) / denom;
}

/**
 * Compute all divergence scores between backtest and live metrics.
 * Each sub-score is 0+ (0 = identical, higher = more divergent).
 * Composite is 0-1 where 1 = perfect alignment.
 */
export function computeDivergence(bt: BacktestMetrics, live: LiveMetrics): DivergenceScores {
  const winRateDiv = computeRateDivergence(bt.win_rate, live.win_rate);
  const pnlDiv = computeRelativeDivergence(bt.avg_pnl, live.avg_pnl);
  const sharpeDiv = computeRateDivergence(bt.sharpe, live.sharpe);
  const slippageDiv = Math.abs(bt.avg_slippage_bps - live.avg_slippage_bps);

  // Normalize each to 0-1 scale for composite (1 = aligned, 0 = diverged)
  const winRateScore = Math.max(0, 1 - winRateDiv / ALIGNMENT_THRESHOLDS.WIN_RATE_CRITICAL);
  const pnlScore = Math.max(0, 1 - pnlDiv / ALIGNMENT_THRESHOLDS.PNL_CRITICAL);
  const sharpeScore = Math.max(0, 1 - sharpeDiv / ALIGNMENT_THRESHOLDS.SHARPE_CRITICAL);
  const slippageScore = Math.max(0, 1 - slippageDiv / ALIGNMENT_THRESHOLDS.SLIPPAGE_CRITICAL);

  // Weighted composite: win rate and PnL matter most
  const composite = round4(
    winRateScore * 0.30 +
    pnlScore * 0.30 +
    sharpeScore * 0.20 +
    slippageScore * 0.20
  );

  return {
    win_rate: round4(winRateDiv),
    pnl: round4(pnlDiv),
    sharpe: round4(sharpeDiv),
    slippage: round4(slippageDiv),
    composite: Math.max(0, Math.min(1, composite)),
  };
}

/**
 * Determine alignment verdict from composite score and trade counts.
 */
export function determineVerdict(
  composite: number,
  btTradeCount: number,
  liveTradeCount: number,
): AlignmentVerdict {
  if (btTradeCount < ALIGNMENT_THRESHOLDS.MIN_TRADES || liveTradeCount < ALIGNMENT_THRESHOLDS.MIN_TRADES) {
    return "insufficient_data";
  }
  if (composite >= ALIGNMENT_THRESHOLDS.COMPOSITE_DRIFTING) return "aligned";
  if (composite >= ALIGNMENT_THRESHOLDS.COMPOSITE_DIVERGED) return "drifting";
  return "diverged";
}

/**
 * Determine the direction of drift.
 * backtest_optimistic = BT looks better than live reality
 * backtest_pessimistic = live is actually outperforming BT
 */
export function determineDriftDirection(bt: BacktestMetrics, live: LiveMetrics): DriftDirection | null {
  let btBetter = 0;
  let liveBetter = 0;

  if (bt.win_rate > live.win_rate + 0.02) btBetter++;
  if (live.win_rate > bt.win_rate + 0.02) liveBetter++;

  if (bt.avg_pnl > live.avg_pnl + 1) btBetter++;
  if (live.avg_pnl > bt.avg_pnl + 1) liveBetter++;

  if (bt.sharpe > live.sharpe + 0.1) btBetter++;
  if (live.sharpe > bt.sharpe + 0.1) liveBetter++;

  if (btBetter > liveBetter) return "backtest_optimistic";
  if (liveBetter > btBetter) return "backtest_pessimistic";
  if (btBetter > 0 && liveBetter > 0) return "mixed";
  return null;
}

/**
 * Detect specific drift events that cross warning/critical thresholds.
 */
export function detectDriftEvents(
  bt: BacktestMetrics,
  live: LiveMetrics,
  divergence: DivergenceScores,
): AlignmentResult["drift_events"] {
  const events: AlignmentResult["drift_events"] = [];

  if (divergence.win_rate >= ALIGNMENT_THRESHOLDS.WIN_RATE_CRITICAL) {
    events.push({
      metric: "win_rate",
      bt_value: bt.win_rate,
      live_value: live.win_rate,
      divergence: divergence.win_rate,
      severity: "critical",
    });
  } else if (divergence.win_rate >= ALIGNMENT_THRESHOLDS.WIN_RATE_WARNING) {
    events.push({
      metric: "win_rate",
      bt_value: bt.win_rate,
      live_value: live.win_rate,
      divergence: divergence.win_rate,
      severity: "warning",
    });
  }

  if (divergence.pnl >= ALIGNMENT_THRESHOLDS.PNL_CRITICAL) {
    events.push({
      metric: "pnl",
      bt_value: bt.avg_pnl,
      live_value: live.avg_pnl,
      divergence: divergence.pnl,
      severity: "critical",
    });
  } else if (divergence.pnl >= ALIGNMENT_THRESHOLDS.PNL_WARNING) {
    events.push({
      metric: "pnl",
      bt_value: bt.avg_pnl,
      live_value: live.avg_pnl,
      divergence: divergence.pnl,
      severity: "warning",
    });
  }

  if (divergence.sharpe >= ALIGNMENT_THRESHOLDS.SHARPE_CRITICAL) {
    events.push({
      metric: "sharpe",
      bt_value: bt.sharpe,
      live_value: live.sharpe,
      divergence: divergence.sharpe,
      severity: "critical",
    });
  } else if (divergence.sharpe >= ALIGNMENT_THRESHOLDS.SHARPE_WARNING) {
    events.push({
      metric: "sharpe",
      bt_value: bt.sharpe,
      live_value: live.sharpe,
      divergence: divergence.sharpe,
      severity: "warning",
    });
  }

  if (divergence.slippage >= ALIGNMENT_THRESHOLDS.SLIPPAGE_CRITICAL) {
    events.push({
      metric: "slippage",
      bt_value: bt.avg_slippage_bps,
      live_value: live.avg_slippage_bps,
      divergence: divergence.slippage,
      severity: "critical",
    });
  } else if (divergence.slippage >= ALIGNMENT_THRESHOLDS.SLIPPAGE_WARNING) {
    events.push({
      metric: "slippage",
      bt_value: bt.avg_slippage_bps,
      live_value: live.avg_slippage_bps,
      divergence: divergence.slippage,
      severity: "warning",
    });
  }

  return events;
}

// ── Full Alignment Check ───────────────────────────────────────

/**
 * Run a full alignment check for a strategy.
 *
 * @param strategyId - Strategy identifier
 * @param bt - Backtest metrics (caller provides from backtester)
 * @param live - Live metrics (caller provides or we compute from execution truth)
 * @param options - period, symbol, regime
 */
export function runAlignmentCheck(
  strategyId: string,
  bt: BacktestMetrics,
  live: LiveMetrics,
  options: {
    period_start: Date;
    period_end: Date;
    symbol?: string;
    regime?: string;
  },
): AlignmentResult {
  const divergence = computeDivergence(bt, live);
  const verdict = determineVerdict(divergence.composite, bt.trade_count, live.trade_count);
  const driftDirection = determineDriftDirection(bt, live);
  const driftEvents = detectDriftEvents(bt, live, divergence);

  return {
    strategy_id: strategyId,
    symbol: options.symbol ?? null,
    period_start: options.period_start,
    period_end: options.period_end,
    backtest: bt,
    live,
    divergence,
    verdict,
    drift_direction: driftDirection,
    regime: options.regime ?? null,
    drift_events: driftEvents,
  };
}

// ── Persistence ────────────────────────────────────────────────

/**
 * Persist an alignment result to the database.
 */
export async function persistAlignmentSnapshot(result: AlignmentResult): Promise<number | null> {
  try {
    const rows = await db.insert(alignmentSnapshotsTable).values({
      strategy_id: result.strategy_id,
      symbol: result.symbol,
      period_start: result.period_start,
      period_end: result.period_end,
      bt_win_rate: String(result.backtest.win_rate),
      bt_avg_pnl: String(result.backtest.avg_pnl),
      bt_sharpe: String(result.backtest.sharpe),
      bt_max_drawdown_pct: String(result.backtest.max_drawdown_pct),
      bt_avg_slippage_bps: String(result.backtest.avg_slippage_bps),
      bt_trade_count: result.backtest.trade_count,
      live_win_rate: String(result.live.win_rate),
      live_avg_pnl: String(result.live.avg_pnl),
      live_sharpe: String(result.live.sharpe),
      live_max_drawdown_pct: String(result.live.max_drawdown_pct),
      live_avg_slippage_bps: String(result.live.avg_slippage_bps),
      live_trade_count: result.live.trade_count,
      win_rate_divergence: String(result.divergence.win_rate),
      pnl_divergence: String(result.divergence.pnl),
      sharpe_divergence: String(result.divergence.sharpe),
      slippage_divergence: String(result.divergence.slippage),
      composite_alignment_score: String(result.divergence.composite),
      verdict: result.verdict,
      drift_direction: result.drift_direction,
      regime: result.regime,
      details_json: { drift_events: result.drift_events },
    }).returning({ id: alignmentSnapshotsTable.id });

    const id = rows[0]?.id ?? null;

    // Also persist any drift events
    for (const evt of result.drift_events) {
      await db.insert(driftEventsTable).values({
        strategy_id: result.strategy_id,
        symbol: result.symbol,
        event_type: `${evt.metric}_drift`,
        severity: evt.severity,
        metric_name: evt.metric,
        backtest_value: String(evt.bt_value),
        live_value: String(evt.live_value),
        divergence: String(evt.divergence),
        threshold: String(
          evt.severity === "critical"
            ? getThreshold(evt.metric, "critical")
            : getThreshold(evt.metric, "warning")
        ),
      });
    }

    if (result.verdict !== "aligned" && result.verdict !== "insufficient_data") {
      logger.warn({
        strategy: result.strategy_id,
        verdict: result.verdict,
        composite: result.divergence.composite,
        driftEvents: result.drift_events.length,
      }, "Alignment check found drift");
    } else {
      logger.info({
        strategy: result.strategy_id,
        verdict: result.verdict,
        composite: result.divergence.composite,
      }, "Alignment check complete");
    }

    return id;
  } catch (err) {
    logger.error({ err, strategy: result.strategy_id }, "Failed to persist alignment snapshot");
    return null;
  }
}

// ── Live Metrics from Execution Truth ──────────────────────────

/**
 * Compute live execution metrics for a strategy from the execution truth tables.
 * This queries the orders + fills tables from Phase 12.
 */
export async function computeLiveMetrics(
  strategyId: string,
  periodStart: Date,
  periodEnd: Date,
  symbol?: string,
): Promise<LiveMetrics | null> {
  try {
    // Query completed orders for this strategy in the period
    const conditions = [
      eq(ordersTable.strategy_id, strategyId),
      gte(ordersTable.completed_at, periodStart),
      lte(ordersTable.completed_at, periodEnd),
      eq(ordersTable.status, "filled"),
    ];
    if (symbol) conditions.push(eq(ordersTable.symbol, symbol));

    const orders = await db.select()
      .from(ordersTable)
      .where(and(...conditions))
      .orderBy(desc(ordersTable.completed_at));

    if (orders.length === 0) {
      return null;
    }

    // Get execution metrics for these orders
    const orderIds = orders.map(o => o.id);
    const metrics = await db.select()
      .from(executionMetricsTable)
      .where(
        sql`${executionMetricsTable.order_id} = ANY(ARRAY[${sql.raw(orderIds.join(","))}]::int[])`
      );

    // Get fills with slippage data
    const fills = await db.select()
      .from(fillsTable)
      .where(
        and(
          sql`${fillsTable.order_id} = ANY(ARRAY[${sql.raw(orderIds.join(","))}]::int[])`,
          isNotNull(fillsTable.slippage_bps),
        )
      );

    // Compute aggregate metrics
    const wins = orders.filter(o => {
      const pnl = Number(o.realized_pnl ?? 0);
      return pnl > 0;
    }).length;

    const pnls = orders.map(o => Number(o.realized_pnl ?? 0));
    const totalPnl = pnls.reduce((s, v) => s + v, 0);
    const avgPnl = pnls.length > 0 ? totalPnl / pnls.length : 0;
    const winRate = orders.length > 0 ? wins / orders.length : 0;

    // Compute Sharpe from PnL series
    const sharpe = computeSharpeFromPnls(pnls);

    // Max drawdown
    const maxDD = computeMaxDrawdownPct(pnls);

    // Average slippage from fills
    const slippageValues = fills.map(f => Number(f.slippage_bps ?? 0));
    const avgSlippage = slippageValues.length > 0
      ? slippageValues.reduce((s, v) => s + v, 0) / slippageValues.length
      : 0;

    return {
      win_rate: round4(winRate),
      avg_pnl: round4(avgPnl),
      sharpe: round4(sharpe),
      max_drawdown_pct: round4(maxDD),
      avg_slippage_bps: round4(avgSlippage),
      trade_count: orders.length,
    };
  } catch (err) {
    logger.error({ err, strategyId }, "Failed to compute live metrics");
    return null;
  }
}

// ── Slippage Calibration ───────────────────────────────────────

/**
 * Compute slippage calibration for a symbol.
 * Compares assumed backtest slippage against actual fill slippage.
 */
export async function computeSlippageCalibration(
  symbol: string,
  periodStart: Date,
  periodEnd: Date,
  assumedSlippageBps: number = 5.0,
  options?: { regime?: string; setup_type?: string },
): Promise<{
  actual_avg: number;
  actual_p50: number;
  actual_p95: number;
  actual_max: number;
  fill_count: number;
  calibration_error: number;
  recommended: number;
} | null> {
  try {
    const conditions = [
      eq(fillsTable.symbol, symbol),
      gte(fillsTable.filled_at, periodStart),
      lte(fillsTable.filled_at, periodEnd),
      isNotNull(fillsTable.slippage_bps),
    ];

    const fills = await db.select({
      slippage_bps: fillsTable.slippage_bps,
    })
      .from(fillsTable)
      .where(and(...conditions));

    if (fills.length < 5) return null;

    const values = fills.map(f => Number(f.slippage_bps ?? 0)).sort((a, b) => a - b);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const p50 = percentile(values, 0.50);
    const p95 = percentile(values, 0.95);
    const max = values[values.length - 1] ?? 0;

    const calibrationError = round4(assumedSlippageBps - avg);
    // Recommended: use p75 as a conservative-but-realistic assumption
    const p75 = percentile(values, 0.75);
    const recommended = round4(Math.max(p75, 1.0)); // At least 1 bps

    // Persist
    await db.insert(slippageCalibrationTable).values({
      symbol,
      period_start: periodStart,
      period_end: periodEnd,
      assumed_slippage_bps: String(assumedSlippageBps),
      actual_avg_slippage_bps: String(round4(avg)),
      actual_p50_slippage_bps: String(round4(p50)),
      actual_p95_slippage_bps: String(round4(p95)),
      actual_max_slippage_bps: String(round4(max)),
      fill_count: values.length,
      calibration_error_bps: String(calibrationError),
      recommended_slippage_bps: String(recommended),
      is_calibrated: true,
      regime: options?.regime,
      setup_type: options?.setup_type,
    });

    logger.info({
      symbol,
      assumed: assumedSlippageBps,
      actual_avg: round4(avg),
      recommended,
      fills: values.length,
    }, "Slippage calibration computed");

    return {
      actual_avg: round4(avg),
      actual_p50: round4(p50),
      actual_p95: round4(p95),
      actual_max: round4(max),
      fill_count: values.length,
      calibration_error: calibrationError,
      recommended,
    };
  } catch (err) {
    logger.error({ err, symbol }, "Slippage calibration failed");
    return null;
  }
}

// ── Query Helpers ──────────────────────────────────────────────

/**
 * Get recent alignment snapshots for a strategy.
 */
export async function getAlignmentHistory(
  strategyId: string,
  limit: number = 20,
): Promise<any[]> {
  return db.select()
    .from(alignmentSnapshotsTable)
    .where(eq(alignmentSnapshotsTable.strategy_id, strategyId))
    .orderBy(desc(alignmentSnapshotsTable.created_at))
    .limit(limit);
}

/**
 * Get unresolved drift events for a strategy.
 */
export async function getUnresolvedDriftEvents(
  strategyId?: string,
): Promise<any[]> {
  const conditions = [eq(driftEventsTable.resolved, false)];
  if (strategyId) conditions.push(eq(driftEventsTable.strategy_id, strategyId));

  return db.select()
    .from(driftEventsTable)
    .where(and(...conditions))
    .orderBy(desc(driftEventsTable.created_at))
    .limit(50);
}

/**
 * Get latest slippage calibration for a symbol.
 */
export async function getLatestSlippageCalibration(symbol: string): Promise<any | null> {
  const rows = await db.select()
    .from(slippageCalibrationTable)
    .where(eq(slippageCalibrationTable.symbol, symbol))
    .orderBy(desc(slippageCalibrationTable.created_at))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Resolve a drift event.
 */
export async function resolveDriftEvent(
  eventId: number,
  notes?: string,
): Promise<boolean> {
  try {
    await db.update(driftEventsTable)
      .set({
        resolved: true,
        resolved_at: new Date(),
        notes: notes ?? "Resolved",
      })
      .where(eq(driftEventsTable.id, eventId));
    return true;
  } catch (err) {
    logger.error({ err, eventId }, "Failed to resolve drift event");
    return false;
  }
}

// ── Utility Functions ──────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.floor(sortedValues.length * p);
  return sortedValues[Math.min(idx, sortedValues.length - 1)] ?? 0;
}

/**
 * Compute annualized Sharpe ratio from a series of PnL values.
 */
export function computeSharpeFromPnls(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / (pnls.length - 1);
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return mean > 0 ? 3 : mean < 0 ? -3 : 0;
  // Annualize assuming ~252 trading days
  return (mean / stdDev) * Math.sqrt(252);
}

/**
 * Compute max drawdown percentage from a PnL series.
 */
export function computeMaxDrawdownPct(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  let cumulative = 0;
  let peak = 0;
  let maxDD = 0;

  for (const pnl of pnls) {
    cumulative += pnl;
    if (cumulative > peak) peak = cumulative;
    const dd = peak > 0 ? (peak - cumulative) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  return round4(maxDD * 100);
}

function getThreshold(metric: string, level: "warning" | "critical"): number {
  const t = ALIGNMENT_THRESHOLDS;
  switch (metric) {
    case "win_rate": return level === "critical" ? t.WIN_RATE_CRITICAL : t.WIN_RATE_WARNING;
    case "pnl": return level === "critical" ? t.PNL_CRITICAL : t.PNL_WARNING;
    case "sharpe": return level === "critical" ? t.SHARPE_CRITICAL : t.SHARPE_WARNING;
    case "slippage": return level === "critical" ? t.SLIPPAGE_CRITICAL : t.SLIPPAGE_WARNING;
    default: return 0;
  }
}
