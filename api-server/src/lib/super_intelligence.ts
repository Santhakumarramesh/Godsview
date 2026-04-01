/**
 * Super Intelligence Module — Maximum Win Rate & Profit Engine
 *
 * Upgrades the pipeline from basic scoring to an adaptive system that:
 * 1. Ensemble ML: Gradient-boosted trees + logistic regression voting
 * 2. Kelly Criterion: Mathematically optimal position sizing
 * 3. Regime-Adaptive Weights: Dynamic Q formula per market condition
 * 4. Multi-Timeframe Confluence: Requires alignment across 1m/5m/15m
 * 5. Trailing Stop Engine: Dynamic exits that lock in profit
 *
 * The goal: turn a 55-60% win rate into 65-75%+ while maximizing
 * profit per winning trade via optimal sizing and exits.
 */

import { predictWinProbability, getModelStatus } from "./ml_model";
import { reasonTradeDecision } from "./reasoning_engine";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SuperSignal {
  /** Original pipeline quality (0-1) */
  base_quality: number;
  /** Enhanced quality after super intelligence (0-1) */
  enhanced_quality: number;
  /** Win probability from ensemble model (0-1) */
  win_probability: number;
  /** Confidence-weighted position size (fraction of equity) */
  kelly_fraction: number;
  /** Suggested quantity (units) */
  suggested_qty: number;
  /** Regime-adaptive pipeline weights used */
  regime_weights: RegimeWeights;
  /** Multi-timeframe confluence score (0-1) */
  confluence_score: number;
  /** Number of aligned timeframes (out of 3) */
  aligned_timeframes: number;
  /** Trailing stop parameters */
  trailing_stop: TrailingStopConfig;
  /** Partial profit targets */
  profit_targets: ProfitTarget[];
  /** Whether signal passes super intelligence filter */
  approved: boolean;
  /** Rejection reason if not approved */
  rejection_reason?: string;
  /** Edge score: expected value per dollar risked */
  edge_score: number;
}

export interface RegimeWeights {
  structure: number;
  order_flow: number;
  recall: number;
  ml: number;
  claude: number;
  label: string;
}

export interface TrailingStopConfig {
  /** Initial stop distance as ATR multiple */
  initial_atr_multiple: number;
  /** Trailing activation: move stop to breakeven after this ATR move */
  activation_atr: number;
  /** Trail step: move stop by this fraction of favorable move */
  trail_step: number;
  /** Time-based exit: close after N minutes if flat */
  max_hold_minutes: number;
}

export interface ProfitTarget {
  /** Fraction of position to close */
  close_pct: number;
  /** R-multiple target (e.g., 1.5 = 1.5× risk) */
  r_target: number;
}

export interface SuperIntelligenceInput {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  setup_type: string;
  regime: string;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  atr: number;
  equity: number;
  /** Multi-timeframe signals: { "1m": score, "5m": score, "15m": score } */
  timeframe_scores?: Record<string, number>;
}

// ── 1. Regime-Adaptive Pipeline Weights ─────────────────────────────────────
// Different market conditions demand different layer emphasis.
// Trending: trust structure + ML. Ranging: trust order flow + recall.
// Volatile: require ALL layers strong. Chop: don't trade.

const REGIME_WEIGHTS: Record<string, RegimeWeights> = {
  trending_bull: {
    structure: 0.35, order_flow: 0.22, recall: 0.18, ml: 0.15, claude: 0.10,
    label: "Trend-Following (Bull)",
  },
  trending_bear: {
    structure: 0.35, order_flow: 0.22, recall: 0.18, ml: 0.15, claude: 0.10,
    label: "Trend-Following (Bear)",
  },
  ranging: {
    structure: 0.25, order_flow: 0.30, recall: 0.22, ml: 0.13, claude: 0.10,
    label: "Mean-Reversion (Range)",
  },
  volatile: {
    structure: 0.28, order_flow: 0.28, recall: 0.20, ml: 0.12, claude: 0.12,
    label: "High-Conviction Only (Volatile)",
  },
  chop: {
    structure: 0.20, order_flow: 0.20, recall: 0.20, ml: 0.20, claude: 0.20,
    label: "All-Layer Consensus (Chop)",
  },
};

function getRegimeWeights(regime: string): RegimeWeights {
  return REGIME_WEIGHTS[regime] ?? REGIME_WEIGHTS.ranging;
}

// ── 2. Ensemble ML: Gradient Boosted Decision Stumps + Logistic Regression ──
// The existing logistic regression is Layer 1. We add a gradient-boosted
// ensemble of shallow decision stumps (depth=1) as Layer 2, then vote.
// This catches non-linear interactions the LR misses.

class GradientBoostedStumps {
  stumps: Array<{ featureIdx: number; threshold: number; leftVal: number; rightVal: number; weight: number }> = [];
  trained = false;
  accuracy = 0;

  train(X: number[][], y: number[], nStumps = 100, learningRate = 0.1): void {
    const n = X.length;
    if (n < 50) return;
    const dim = X[0].length;

    // Initialize predictions to base rate (log-odds)
    const baseRate = y.reduce((s, v) => s + v, 0) / n;
    const baseLogOdds = Math.log(baseRate / (1 - baseRate + 1e-10));
    const F = new Float64Array(n).fill(baseLogOdds);

    for (let round = 0; round < nStumps; round++) {
      // Compute pseudo-residuals (gradient of log-loss)
      const residuals = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = 1 / (1 + Math.exp(-F[i]));
        residuals[i] = y[i] - p;
      }

      // Find best stump (single split)
      let bestGain = -Infinity;
      let bestFeature = 0, bestThresh = 0, bestLeft = 0, bestRight = 0;

      for (let f = 0; f < dim; f++) {
        // Try 10 quantile thresholds per feature
        const vals = X.map(row => row[f]).sort((a, b) => a - b);
        for (let q = 1; q <= 9; q++) {
          const thresh = vals[Math.floor(n * q / 10)];
          let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0;
          for (let i = 0; i < n; i++) {
            if (X[i][f] <= thresh) { leftSum += residuals[i]; leftCount++; }
            else { rightSum += residuals[i]; rightCount++; }
          }
          if (leftCount === 0 || rightCount === 0) continue;
          const leftMean = leftSum / leftCount;
          const rightMean = rightSum / rightCount;
          const gain = leftSum * leftMean + rightSum * rightMean;
          if (gain > bestGain) {
            bestGain = gain;
            bestFeature = f;
            bestThresh = thresh;
            bestLeft = leftMean;
            bestRight = rightMean;
          }
        }
      }

      this.stumps.push({
        featureIdx: bestFeature,
        threshold: bestThresh,
        leftVal: bestLeft * learningRate,
        rightVal: bestRight * learningRate,
        weight: learningRate,
      });

      // Update predictions
      for (let i = 0; i < n; i++) {
        if (X[i][bestFeature] <= bestThresh) F[i] += bestLeft * learningRate;
        else F[i] += bestRight * learningRate;
      }
    }

    this.trained = true;

    // Compute accuracy
    let correct = 0;
    for (let i = 0; i < n; i++) {
      const p = this.predict(X[i]);
      if ((p >= 0.5 && y[i] === 1) || (p < 0.5 && y[i] === 0)) correct++;
    }
    this.accuracy = correct / n;
  }

  predict(features: number[]): number {
    if (!this.trained || this.stumps.length === 0) return 0.5;
    let F = 0;
    for (const stump of this.stumps) {
      F += (features[stump.featureIdx] ?? 0) <= stump.threshold
        ? stump.leftVal : stump.rightVal;
    }
    return 1 / (1 + Math.exp(-F));
  }
}

// ── 3. Kelly Criterion Position Sizing ──────────────────────────────────────
// Full Kelly is too aggressive — we use fractional Kelly (25%) for safety.
// Kelly fraction = (p × b - q) / b
//   p = win probability, q = 1-p, b = avg_win / avg_loss (reward:risk ratio)

const KELLY_FRACTION = 0.25; // Quarter-Kelly for safety
const MIN_POSITION_PCT = 0.005; // 0.5% minimum
const MAX_POSITION_PCT = 0.03;  // 3% maximum per trade

function kellySize(
  winProb: number,
  rewardRiskRatio: number,
  equity: number,
  entryPrice: number,
): { fraction: number; qty: number } {
  const p = Math.max(0.01, Math.min(0.99, winProb));
  const q = 1 - p;
  const b = Math.max(0.1, rewardRiskRatio);

  // Full Kelly
  let fullKelly = (p * b - q) / b;

  // Clamp: if negative edge, don't trade
  if (fullKelly <= 0) return { fraction: 0, qty: 0 };

  // Apply fractional Kelly
  let fraction = fullKelly * KELLY_FRACTION;
  fraction = Math.max(MIN_POSITION_PCT, Math.min(MAX_POSITION_PCT, fraction));

  // Convert to quantity
  const dollarSize = equity * fraction;
  const qty = Math.max(0, Math.floor(dollarSize / entryPrice * 1000) / 1000);

  return { fraction, qty };
}

// ── 4. Multi-Timeframe Confluence ───────────────────────────────────────────
// Require 2+ out of 3 timeframes to agree for signal approval.
// Each timeframe contributes a directional bias score (0-1).

const TIMEFRAMES = ["1m", "5m", "15m"] as const;
const CONFLUENCE_THRESHOLD = 0.55; // Score above this = aligned
const MIN_ALIGNED_TF = 2; // Need at least 2 timeframes agreeing

function computeConfluence(
  tfScores: Record<string, number> | undefined,
  direction: "long" | "short",
): { score: number; aligned: number } {
  if (!tfScores || Object.keys(tfScores).length === 0) {
    return { score: 0.5, aligned: 0 }; // Neutral if no MTF data
  }

  let aligned = 0;
  let totalScore = 0;
  let count = 0;

  for (const tf of TIMEFRAMES) {
    const raw = tfScores[tf];
    if (raw == null) continue;
    // For long: high score = aligned. For short: low score = aligned
    const dirScore = direction === "long" ? raw : 1 - raw;
    if (dirScore >= CONFLUENCE_THRESHOLD) aligned++;
    totalScore += dirScore;
    count++;
  }

  const avgScore = count > 0 ? totalScore / count : 0.5;
  return { score: avgScore, aligned };
}

// ── 5. Trailing Stop & Partial Profit Engine ────────────────────────────────

function buildTrailingStop(
  regime: string,
  atr: number,
  winProb: number,
): TrailingStopConfig {
  // Trending: wider stops (let winners run). Ranging: tighter stops.
  const isStrong = regime.includes("trending");
  const isTrending = isStrong;

  return {
    initial_atr_multiple: isTrending ? 2.5 : 1.8,
    activation_atr: isTrending ? 1.5 : 1.0,
    trail_step: isTrending ? 0.4 : 0.6, // Trending: trail less aggressively
    max_hold_minutes: isTrending ? 180 : 90,
  };
}

function buildProfitTargets(
  regime: string,
  winProb: number,
  rewardRiskRatio: number,
): ProfitTarget[] {
  const isHighConf = winProb >= 0.65;
  const isTrending = regime.includes("trending");

  if (isTrending && isHighConf) {
    // High confidence trending: scale out slowly, let runner ride
    return [
      { close_pct: 0.33, r_target: 1.5 },
      { close_pct: 0.33, r_target: 3.0 },
      { close_pct: 0.34, r_target: 5.0 },
    ];
  }

  if (isTrending) {
    // Trending normal: scale out in thirds
    return [
      { close_pct: 0.33, r_target: 1.0 },
      { close_pct: 0.33, r_target: 2.0 },
      { close_pct: 0.34, r_target: 3.5 },
    ];
  }

  // Ranging / volatile: take profit faster
  return [
    { close_pct: 0.50, r_target: 1.0 },
    { close_pct: 0.30, r_target: 1.5 },
    { close_pct: 0.20, r_target: 2.5 },
  ];
}

// ── 6. Global Ensemble Model Instance ───────────────────────────────────────

let _gbm: GradientBoostedStumps | null = null;
let _ensembleStatus: "untrained" | "trained" | "error" = "untrained";
let _ensembleMeta: {
  gbm_accuracy: number;
  lr_accuracy: number;
  ensemble_accuracy: number;
  samples: number;
  trained_at: string;
} | null = null;

// ── Feature engineering (same as ml_model.ts for consistency) ──

const SETUP_TYPES = ["absorption_reversal", "sweep_reclaim", "continuation_pullback", "cvd_divergence", "breakout_failure"] as const;
const REGIMES = ["trending_bull", "trending_bear", "ranging", "volatile", "chop"] as const;

function featurize(row: {
  structure_score: number; order_flow_score: number; recall_score: number;
  final_quality: number; setup_type: string; regime: string; direction?: string;
}): number[] {
  const base = [
    row.structure_score,
    row.order_flow_score,
    row.recall_score,
    row.final_quality,
    row.structure_score * row.order_flow_score,
    row.recall_score * row.structure_score,
    Math.abs(row.structure_score - row.order_flow_score),
    row.direction === "long" ? 1 : 0,
  ];
  const setupOH = SETUP_TYPES.map(s => s === row.setup_type ? 1 : 0);
  const regimeOH = REGIMES.map(r => r === row.regime ? 1 : 0);
  return [...base, ...setupOH, ...regimeOH];
}

/**
 * Train the ensemble model. Call after ml_model.trainModel().
 * Uses the same data source (accuracy_results).
 */
export async function trainEnsemble(): Promise<void> {
  try {
    console.log("[super] Training gradient-boosted ensemble...");

    // Dynamic import to avoid circular deps
    const { db, accuracyResultsTable } = await import("@workspace/db");
    const { and, or, eq, isNotNull } = await import("drizzle-orm");

    const rows = await db
      .select({
        structure_score: accuracyResultsTable.structure_score,
        order_flow_score: accuracyResultsTable.order_flow_score,
        recall_score: accuracyResultsTable.recall_score,
        final_quality: accuracyResultsTable.final_quality,
        setup_type: accuracyResultsTable.setup_type,
        regime: accuracyResultsTable.regime,
        direction: accuracyResultsTable.direction,
        outcome: accuracyResultsTable.outcome,
      })
      .from(accuracyResultsTable)
      .where(
        and(
          or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
          isNotNull(accuracyResultsTable.structure_score),
          isNotNull(accuracyResultsTable.order_flow_score)
        )
      )
      .limit(200_000);

    if (rows.length < 100) {
      console.log(`[super] Only ${rows.length} samples — need ≥100 for ensemble.`);
      _ensembleStatus = "untrained";
      return;
    }

    const X: number[][] = [];
    const y: number[] = [];
    for (const row of rows) {
      X.push(featurize({
        structure_score: parseFloat(String(row.structure_score ?? "0")),
        order_flow_score: parseFloat(String(row.order_flow_score ?? "0")),
        recall_score: parseFloat(String(row.recall_score ?? "0")),
        final_quality: parseFloat(String(row.final_quality ?? "0")),
        setup_type: row.setup_type ?? "absorption_reversal",
        regime: row.regime ?? "ranging",
        direction: row.direction ?? "long",
      }));
      y.push(row.outcome === "win" ? 1 : 0);
    }

    // Train GBM
    const gbm = new GradientBoostedStumps();
    gbm.train(X, y, 150, 0.08);

    // Get LR accuracy from existing model
    const mlStatus = getModelStatus();
    const lrAccuracy = mlStatus.meta?.accuracy ?? 0;

    // Compute ensemble accuracy (average of both predictions, majority vote)
    let ensembleCorrect = 0;
    for (let i = 0; i < X.length; i++) {
      const gbmPred = gbm.predict(X[i]);
      const lrPred = predictWinProbability({
        structure_score: parseFloat(String(rows[i].structure_score ?? "0")),
        order_flow_score: parseFloat(String(rows[i].order_flow_score ?? "0")),
        recall_score: parseFloat(String(rows[i].recall_score ?? "0")),
        final_quality: parseFloat(String(rows[i].final_quality ?? "0")),
        setup_type: rows[i].setup_type ?? "absorption_reversal",
        regime: rows[i].regime ?? "ranging",
        direction: rows[i].direction ?? "long",
      }).probability;

      // Ensemble: 60% GBM + 40% LR (GBM captures non-linear patterns better)
      const ensemblePred = 0.60 * gbmPred + 0.40 * lrPred;
      if ((ensemblePred >= 0.5 && y[i] === 1) || (ensemblePred < 0.5 && y[i] === 0)) {
        ensembleCorrect++;
      }
    }

    _gbm = gbm;
    _ensembleStatus = "trained";
    _ensembleMeta = {
      gbm_accuracy: gbm.accuracy,
      lr_accuracy: lrAccuracy,
      ensemble_accuracy: ensembleCorrect / X.length,
      samples: X.length,
      trained_at: new Date().toISOString(),
    };

    console.log(`[super] Ensemble trained successfully:`);
    console.log(`[super]   GBM accuracy: ${(gbm.accuracy * 100).toFixed(1)}%`);
    console.log(`[super]   LR accuracy:  ${(lrAccuracy * 100).toFixed(1)}%`);
    console.log(`[super]   Ensemble:     ${(_ensembleMeta.ensemble_accuracy * 100).toFixed(1)}%`);
    console.log(`[super]   Samples:      ${X.length}`);
  } catch (err) {
    console.error("[super] Ensemble training failed:", err);
    _ensembleStatus = "error";
  }
}

function ensemblePredict(input: {
  structure_score: number; order_flow_score: number; recall_score: number;
  final_quality: number; setup_type: string; regime: string; direction?: string;
}): number {
  const lrResult = predictWinProbability(input);

  if (_gbm?.trained) {
    const features = featurize(input);
    const gbmPred = _gbm.predict(features);
    // Weighted ensemble: 60% GBM + 40% LR
    return 0.60 * gbmPred + 0.40 * lrResult.probability;
  }

  // Fallback to LR only
  return lrResult.probability;
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT: Process a signal through Super Intelligence
// ══════════════════════════════════════════════════════════════════════════════

export async function processSuperSignal(
  signalId: number,
  symbol: string,
  input: SuperIntelligenceInput
): Promise<SuperSignal> {
  const {
    structure_score, order_flow_score, recall_score,
    setup_type, regime, direction,
    entry_price, stop_loss, take_profit,
    atr, equity, timeframe_scores,
  } = input;

  // 1. Get regime-adaptive weights
  const weights = getRegimeWeights(regime);

  // 2. Compute enhanced quality with adaptive weights
  const ml_raw = ensemblePredict({
    structure_score, order_flow_score, recall_score,
    final_quality: 0, // Will be computed
    setup_type, regime, direction,
  });

  // Claude / Heuristic Reasoning layer: strict fallback policy
  const reasoning = await reasonTradeDecision(signalId, symbol, {
    structure: structure_score,
    order_flow: order_flow_score,
    recall: recall_score,
    setup_type,
    regime,
    direction,
  });

  const claude_est = reasoning.winProbability;

  const enhanced_quality = Math.max(0, Math.min(1,
    weights.structure * structure_score +
    weights.order_flow * order_flow_score +
    weights.recall * recall_score +
    weights.ml * ml_raw +
    weights.claude * claude_est
  ));

  // Base quality (original formula for comparison)
  const base_quality = 0.32 * structure_score + 0.28 * order_flow_score +
    0.20 * recall_score + 0.08 * (0.55 + recall_score * 0.25) +
    0.12 * claude_est;

  // 3. Ensemble win probability
  const win_probability = ensemblePredict({
    structure_score, order_flow_score, recall_score,
    final_quality: enhanced_quality,
    setup_type, regime, direction,
  });

  // 4. Multi-timeframe confluence
  const { score: confluence_score, aligned: aligned_timeframes } =
    computeConfluence(timeframe_scores, direction);

  // 5. Reward:risk ratio
  const risk = Math.abs(entry_price - stop_loss);
  const reward = Math.abs(take_profit - entry_price);
  const rewardRiskRatio = risk > 0 ? reward / risk : 1;

  // 6. Kelly position sizing
  const { fraction: kelly_fraction, qty: suggested_qty } =
    kellySize(win_probability, rewardRiskRatio, equity, entry_price);

  // 7. Trailing stop config
  const trailing_stop = buildTrailingStop(regime, atr, win_probability);

  // 8. Profit targets
  const profit_targets = buildProfitTargets(regime, win_probability, rewardRiskRatio);

  // 9. Edge score: expected value per dollar risked
  // EV = (winProb × avgWin) - (lossProb × avgLoss)
  const edge_score = win_probability * rewardRiskRatio - (1 - win_probability);

  // 10. Super Intelligence Gate — must pass ALL:
  //   a. Enhanced quality ≥ regime threshold
  //   b. Win probability ≥ 55%
  //   c. Multi-TF confluence ≥ 2 aligned (if MTF data available)
  //   d. Edge score > 0 (positive expected value)
  //   e. Kelly says to bet (fraction > 0)
  //   f. Not in chop regime (unless quality > 0.85)

  const regimeThresholds: Record<string, number> = {
    trending_bull: 0.58, trending_bear: 0.60,
    ranging: 0.68, volatile: 0.75, chop: 0.85,
  };
  const qualityThreshold = regimeThresholds[regime] ?? 0.68;
  const hasMTF = timeframe_scores && Object.keys(timeframe_scores).length > 0;

  let approved = true;
  let rejection_reason: string | undefined;

  if (enhanced_quality < qualityThreshold) {
    approved = false;
    rejection_reason = `Quality ${(enhanced_quality * 100).toFixed(1)}% below ${regime} threshold ${(qualityThreshold * 100).toFixed(0)}%`;
  } else if (win_probability < 0.55) {
    approved = false;
    rejection_reason = `Win probability ${(win_probability * 100).toFixed(1)}% below 55% minimum`;
  } else if (hasMTF && aligned_timeframes < MIN_ALIGNED_TF) {
    approved = false;
    rejection_reason = `Only ${aligned_timeframes}/${TIMEFRAMES.length} timeframes aligned (need ${MIN_ALIGNED_TF})`;
  } else if (edge_score <= 0) {
    approved = false;
    rejection_reason = `Negative edge: EV = ${edge_score.toFixed(3)} (need > 0)`;
  } else if (kelly_fraction <= 0) {
    approved = false;
    rejection_reason = "Kelly criterion says no bet (negative expected value)";
  }

  return {
    base_quality: Math.max(0, Math.min(1, base_quality)),
    enhanced_quality,
    win_probability,
    kelly_fraction,
    suggested_qty,
    regime_weights: weights,
    confluence_score,
    aligned_timeframes,
    trailing_stop,
    profit_targets,
    approved,
    rejection_reason,
    edge_score,
  };
}

// ── Status & Diagnostics ────────────────────────────────────────────────────

export function getSuperIntelligenceStatus(): {
  status: "active" | "partial" | "inactive";
  ensemble: typeof _ensembleMeta;
  message: string;
} {
  if (_ensembleStatus === "trained" && _ensembleMeta) {
    return {
      status: "active",
      ensemble: _ensembleMeta,
      message: `Ensemble active: ${(_ensembleMeta.ensemble_accuracy * 100).toFixed(1)}% accuracy (GBM ${(_ensembleMeta.gbm_accuracy * 100).toFixed(1)}% + LR ${(_ensembleMeta.lr_accuracy * 100).toFixed(1)}%) on ${_ensembleMeta.samples} samples`,
    };
  }

  const mlStatus = getModelStatus();
  if (mlStatus.status === "active") {
    return {
      status: "partial",
      ensemble: null,
      message: "LR model active, GBM training pending — running single-model mode",
    };
  }

  return {
    status: "inactive",
    ensemble: null,
    message: "Super Intelligence inactive — using heuristic pipeline scoring",
  };
}
