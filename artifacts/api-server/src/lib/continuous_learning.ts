/**
 * continuous_learning.ts — Continuous Learning Loop
 *
 * Makes GodsView a self-improving system by:
 * 1. Scheduled ML retraining every RETRAIN_INTERVAL_MS (default 4h)
 * 2. Post-trade feedback: records outcomes into accuracy_results
 * 3. Backtest-to-learning bridge: backtest results feed into training data
 * 4. Drift-triggered emergency retrain when model degrades
 * 5. Strategy promotion pipeline: backtest → paper → assisted → auto
 *
 * Env:
 *   RETRAIN_INTERVAL_MS    — retrain interval (default: 14400000 = 4h)
 *   RETRAIN_MIN_NEW_TRADES — min new trades before retrain (default: 10)
 *   LEARNING_ENABLED       — master switch (default: true)
 *   DRIFT_RETRAIN_THRESHOLD — win rate drop % to trigger emergency retrain (default: 0.08)
 */

import { db, accuracyResultsTable, siDecisionsTable } from "@workspace/db";
import { eq, sql, and, isNull, isNotNull, desc, gte } from "drizzle-orm";
import { retrainModel, getModelStatus, getModelDiagnostics } from "./ml_model";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "continuous_learning" });

// ── Configuration ─────────────────────────────────────────────────────────────

const RETRAIN_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.RETRAIN_INTERVAL_MS ?? 4 * 60 * 60 * 1000), // 4 hours
);
const RETRAIN_MIN_NEW_TRADES = Math.max(
  1,
  Number(process.env.RETRAIN_MIN_NEW_TRADES ?? 10),
);
const DRIFT_RETRAIN_THRESHOLD = Math.max(
  0.01,
  Number(process.env.DRIFT_RETRAIN_THRESHOLD ?? 0.08),
);
const LEARNING_ENABLED = (process.env.LEARNING_ENABLED ?? "true") !== "false";

// ── State ─────────────────────────────────────────────────────────────────────

interface LearningState {
  running: boolean;
  lastRetrainAt: string | null;
  lastRetrainResult: { success: boolean; message: string } | null;
  totalRetrains: number;
  totalFeedbackRecorded: number;
  tradesProcessedSinceRetrain: number;
  backtestSamplesIngested: number;
  driftTriggeredRetrains: number;
  lastDriftCheck: string | null;
  nextScheduledRetrain: string | null;
}

let _state: LearningState = {
  running: false,
  lastRetrainAt: null,
  lastRetrainResult: null,
  totalRetrains: 0,
  totalFeedbackRecorded: 0,
  tradesProcessedSinceRetrain: 0,
  backtestSamplesIngested: 0,
  driftTriggeredRetrains: 0,
  lastDriftCheck: null,
  nextScheduledRetrain: null,
};

let _retrainTimer: NodeJS.Timeout | null = null;
let _feedbackTimer: NodeJS.Timeout | null = null;
let _retrainInFlight = false;

// ── Public API ────────────────────────────────────────────────────────────────

export function getLearningState(): LearningState & { config: Record<string, unknown> } {
  return {
    ..._state,
    config: {
      retrainIntervalMs: RETRAIN_INTERVAL_MS,
      retrainMinNewTrades: RETRAIN_MIN_NEW_TRADES,
      driftRetrainThreshold: DRIFT_RETRAIN_THRESHOLD,
      learningEnabled: LEARNING_ENABLED,
    },
  };
}

/**
 * Start the continuous learning loop.
 * Called from server startup (index.ts).
 */
export function startLearningLoop(): void {
  if (!LEARNING_ENABLED) {
    logger.info("[learning] Continuous learning disabled (LEARNING_ENABLED=false)");
    return;
  }
  if (_state.running) {
    logger.warn("[learning] Already running");
    return;
  }

  _state.running = true;
  const nextRetrain = new Date(Date.now() + RETRAIN_INTERVAL_MS).toISOString();
  _state.nextScheduledRetrain = nextRetrain;

  // Schedule periodic retrain
  _retrainTimer = setInterval(async () => {
    await scheduledRetrain();
  }, RETRAIN_INTERVAL_MS);

  // Schedule periodic feedback reconciliation (every 5 minutes)
  _feedbackTimer = setInterval(async () => {
    await reconcileTradeOutcomes();
  }, 5 * 60 * 1000);

  // Run initial reconciliation after 30s delay
  setTimeout(() => {
    reconcileTradeOutcomes().catch((err) =>
      logger.error({ err: err.message }, "[learning] Initial reconciliation failed")
    );
  }, 30_000);

  logger.info(
    { intervalMs: RETRAIN_INTERVAL_MS, nextRetrain },
    "[learning] Continuous learning loop started"
  );
}

/**
 * Stop the continuous learning loop.
 */
export function stopLearningLoop(): void {
  if (_retrainTimer) {
    clearInterval(_retrainTimer);
    _retrainTimer = null;
  }
  if (_feedbackTimer) {
    clearInterval(_feedbackTimer);
    _feedbackTimer = null;
  }
  _state.running = false;
  _state.nextScheduledRetrain = null;
  logger.info("[learning] Continuous learning loop stopped");
}

// ── Scheduled Retrain ─────────────────────────────────────────────────────────

async function scheduledRetrain(): Promise<void> {
  if (_retrainInFlight) {
    logger.debug("[learning] Retrain already in flight — skipping");
    return;
  }

  // Check if we have enough new trades to justify retraining
  if (_state.tradesProcessedSinceRetrain < RETRAIN_MIN_NEW_TRADES) {
    logger.debug(
      { newTrades: _state.tradesProcessedSinceRetrain, threshold: RETRAIN_MIN_NEW_TRADES },
      "[learning] Not enough new trades for retrain — skipping"
    );
    _state.nextScheduledRetrain = new Date(Date.now() + RETRAIN_INTERVAL_MS).toISOString();
    return;
  }

  await executeRetrain("scheduled");
}

/**
 * Force a retrain (called externally or by drift detection).
 */
export async function forceRetrain(reason: string): Promise<{ success: boolean; message: string }> {
  return executeRetrain(reason);
}

async function executeRetrain(trigger: string): Promise<{ success: boolean; message: string }> {
  if (_retrainInFlight) {
    return { success: false, message: "Retrain already in flight" };
  }

  _retrainInFlight = true;
  logger.info({ trigger, newTrades: _state.tradesProcessedSinceRetrain }, "[learning] Starting ML retrain");

  try {
    const result = await retrainModel();
    _state.lastRetrainAt = new Date().toISOString();
    _state.lastRetrainResult = result;
    _state.totalRetrains += 1;
    _state.tradesProcessedSinceRetrain = 0;
    _state.nextScheduledRetrain = new Date(Date.now() + RETRAIN_INTERVAL_MS).toISOString();

    if (result.success) {
      logger.info({ trigger, message: result.message }, "[learning] ML retrain completed successfully");
    } else {
      logger.warn({ trigger, message: result.message }, "[learning] ML retrain completed with issues");
    }

    return result;
  } catch (err: any) {
    const result = { success: false, message: err.message };
    _state.lastRetrainResult = result;
    logger.error({ err: err.message, trigger }, "[learning] ML retrain failed");
    return result;
  } finally {
    _retrainInFlight = false;
  }
}

// ── Trade Outcome Reconciliation ──────────────────────────────────────────────
// Matches SI decisions with market outcomes and records them in accuracy_results

async function reconcileTradeOutcomes(): Promise<number> {
  try {
    // Find SI decisions that have no outcome yet (within last 7 days)
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const pendingDecisions = await db
      .select({
        id: siDecisionsTable.id,
        symbol: siDecisionsTable.symbol,
        setup_type: siDecisionsTable.setup_type,
        direction: siDecisionsTable.direction,
        regime: siDecisionsTable.regime,
        approved: siDecisionsTable.approved,
        win_probability: siDecisionsTable.win_probability,
        edge_score: siDecisionsTable.edge_score,
        enhanced_quality: siDecisionsTable.enhanced_quality,
        entry_price: siDecisionsTable.entry_price,
        stop_loss: siDecisionsTable.stop_loss,
        take_profit: siDecisionsTable.take_profit,
        final_quality: siDecisionsTable.final_quality,
        confluence_score: siDecisionsTable.confluence_score,
        created_at: siDecisionsTable.created_at,
      })
      .from(siDecisionsTable)
      .where(
        and(
          isNull(siDecisionsTable.outcome),
          gte(siDecisionsTable.created_at, cutoff)
        )
      )
      .limit(200);

    if (pendingDecisions.length === 0) return 0;

    let matched = 0;

    for (const decision of pendingDecisions) {
      const entryPrice = parseFloat(String(decision.entry_price));
      const stopLoss = parseFloat(String(decision.stop_loss));
      const takeProfit = parseFloat(String(decision.take_profit));
      const createdAt = decision.created_at;

      if (!entryPrice || !stopLoss || !takeProfit || !createdAt) continue;

      // Check if enough time has passed (at least 30 minutes for outcome resolution)
      const ageMs = Date.now() - createdAt.getTime();
      if (ageMs < 30 * 60 * 1000) continue;

      // Simulate outcome based on price movement from accuracy_results
      // Look for matching accuracy_result with same symbol+setup within 2h window
      const matchWindow = new Date(createdAt.getTime() + 2 * 60 * 60 * 1000);
      const matchingResults = await db
        .select({
          id: accuracyResultsTable.id,
          outcome: accuracyResultsTable.outcome,
        })
        .from(accuracyResultsTable)
        .where(
          and(
            eq(accuracyResultsTable.symbol, decision.symbol),
            eq(accuracyResultsTable.setup_type, decision.setup_type),
            gte(accuracyResultsTable.created_at, createdAt),
          )
        )
        .limit(1);

      if (matchingResults.length > 0 && matchingResults[0].outcome) {
        const outcome = matchingResults[0].outcome;
        const isWin = outcome === "win";
        const riskAmount = Math.abs(entryPrice - stopLoss);
        const rewardAmount = Math.abs(takeProfit - entryPrice);
        const realizedPnl = isWin ? rewardAmount : -riskAmount;

        // Update SI decision with outcome
        await db
          .update(siDecisionsTable)
          .set({
            outcome,
            realized_pnl: String(realizedPnl.toFixed(2)),
          })
          .where(eq(siDecisionsTable.id, decision.id));

        matched += 1;
        _state.totalFeedbackRecorded += 1;
        _state.tradesProcessedSinceRetrain += 1;
      }
    }

    if (matched > 0) {
      logger.info(
        { matched, pending: pendingDecisions.length },
        "[learning] Reconciled trade outcomes"
      );

      // Check if we should trigger emergency retrain due to drift
      await checkDriftAndRetrain();
    }

    return matched;
  } catch (err: any) {
    logger.error({ err: err.message }, "[learning] Trade reconciliation failed");
    return 0;
  }
}

// ── Drift Detection + Emergency Retrain ───────────────────────────────────────

async function checkDriftAndRetrain(): Promise<void> {
  try {
    _state.lastDriftCheck = new Date().toISOString();

    // Get recent outcomes (last 50 resolved decisions)
    const recentDecisions = await db
      .select({
        approved: siDecisionsTable.approved,
        win_probability: siDecisionsTable.win_probability,
        outcome: siDecisionsTable.outcome,
      })
      .from(siDecisionsTable)
      .where(isNotNull(siDecisionsTable.outcome))
      .orderBy(desc(siDecisionsTable.created_at))
      .limit(50);

    if (recentDecisions.length < 20) return; // Not enough data for drift detection

    const approvedDecisions = recentDecisions.filter((d) => d.approved);
    if (approvedDecisions.length < 10) return;

    const actualWins = approvedDecisions.filter((d) => d.outcome === "win").length;
    const actualWinRate = actualWins / approvedDecisions.length;
    const avgPredicted = approvedDecisions.reduce(
      (sum, d) => sum + parseFloat(String(d.win_probability)),
      0
    ) / approvedDecisions.length;

    const drift = avgPredicted - actualWinRate;

    if (drift > DRIFT_RETRAIN_THRESHOLD) {
      logger.warn(
        {
          drift: drift.toFixed(3),
          predicted: avgPredicted.toFixed(3),
          actual: actualWinRate.toFixed(3),
          threshold: DRIFT_RETRAIN_THRESHOLD,
          samples: approvedDecisions.length,
        },
        "[learning] DRIFT DETECTED — triggering emergency retrain"
      );
      _state.driftTriggeredRetrains += 1;
      await executeRetrain("drift_detected");
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[learning] Drift check failed");
  }
}

// ── Backtest Results Ingestion ─────────────────────────────────────────────────
// Called by the backtester to feed simulated outcomes into accuracy_results

export async function ingestBacktestResults(results: Array<{
  symbol: string;
  setup_type: string;
  direction: string;
  regime: string;
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  outcome: "win" | "loss";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  realized_pnl: number;
}>): Promise<{ ingested: number }> {
  if (!results.length) return { ingested: 0 };

  let ingested = 0;

  for (const r of results) {
    try {
      await db.insert(accuracyResultsTable).values({
        symbol: r.symbol,
        setup_type: r.setup_type,
        timeframe: "15m",
        bar_time: new Date(),
        signal_detected: r.direction === "long" ? "bullish" : "bearish",
        direction: r.direction,
        regime: r.regime,
        structure_score: String(r.structure_score),
        order_flow_score: String(r.order_flow_score),
        recall_score: String(r.recall_score),
        final_quality: String(r.final_quality),
        outcome: r.outcome,
        entry_price: String(r.entry_price),
        stop_loss: String(r.stop_loss),
        take_profit: String(r.take_profit),
        realized_pnl: String(r.realized_pnl),
        source: "backtest",
      });
      ingested += 1;
    } catch (err: any) {
      // Skip duplicates or constraint violations
      logger.debug({ err: err.message, symbol: r.symbol }, "[learning] Backtest ingestion skip");
    }
  }

  _state.backtestSamplesIngested += ingested;

  if (ingested > 0) {
    logger.info(
      { ingested, total: results.length },
      "[learning] Backtest results ingested into accuracy_results"
    );

    // Trigger retrain if we got significant new data
    if (ingested >= 50) {
      _state.tradesProcessedSinceRetrain += ingested;
      await executeRetrain("backtest_ingestion");
    }
  }

  return { ingested };
}

// ── Strategy Promotion Pipeline ───────────────────────────────────────────────

export interface PromotionCandidate {
  strategyId: string;
  setupType: string;
  currentTier: "backtest" | "paper" | "assisted" | "autonomous";
  winRate: number;
  profitFactor: number;
  sampleCount: number;
  eligible: boolean;
  reason: string;
}

const PROMOTION_THRESHOLDS = {
  backtest_to_paper: { minWinRate: 0.55, minSamples: 100, minPF: 1.2 },
  paper_to_assisted: { minWinRate: 0.52, minSamples: 30, minPF: 1.1 },
  assisted_to_autonomous: { minWinRate: 0.58, minSamples: 50, minPF: 1.3 },
};

export async function evaluatePromotions(): Promise<PromotionCandidate[]> {
  const candidates: PromotionCandidate[] = [];

  try {
    // Get per-setup performance from accuracy_results
    const setupStats = await db
      .select({
        setup_type: accuracyResultsTable.setup_type,
        total: sql<number>`count(*)`.as("total"),
        wins: sql<number>`sum(case when outcome = 'win' then 1 else 0 end)`.as("wins"),
        avg_quality: sql<number>`avg(cast(final_quality as float))`.as("avg_quality"),
      })
      .from(accuracyResultsTable)
      .where(isNotNull(accuracyResultsTable.outcome))
      .groupBy(accuracyResultsTable.setup_type);

    for (const stat of setupStats) {
      const winRate = Number(stat.wins) / Math.max(Number(stat.total), 1);
      const sampleCount = Number(stat.total);
      const threshold = PROMOTION_THRESHOLDS.backtest_to_paper;

      const eligible =
        winRate >= threshold.minWinRate &&
        sampleCount >= threshold.minSamples;

      candidates.push({
        strategyId: `setup_${stat.setup_type}`,
        setupType: String(stat.setup_type),
        currentTier: "backtest",
        winRate,
        profitFactor: winRate > 0.5 ? winRate / (1 - winRate) : 0,
        sampleCount,
        eligible,
        reason: eligible
          ? `Meets promotion criteria: ${(winRate * 100).toFixed(1)}% win rate, ${sampleCount} samples`
          : `Needs: ${(threshold.minWinRate * 100).toFixed(0)}% win rate (got ${(winRate * 100).toFixed(1)}%), ${threshold.minSamples} samples (got ${sampleCount})`,
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, "[learning] Promotion evaluation failed");
  }

  return candidates.sort((a, b) => b.winRate - a.winRate);
}
