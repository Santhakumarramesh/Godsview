/**
 * Super Intelligence v2 — Maximum Win Rate & Profit Engine
 *
 * Architecture:
 *   Layer 1: Logistic Regression (baseline, fast)
 *   Layer 2: Gradient Boosted Stumps 300 rounds, 26-feature vector
 *   Layer 3: Random Forest (50 bagged GBMs, variance reduction)
 *   Layer 4: Platt-calibrated meta-ensemble with walk-forward validation
 *   Layer 5: Regime-adaptive quality gating + Kelly sizing
 *   Layer 6: Multi-timeframe confluence (1m/5m/15m)
 *   Layer 7: Claude reasoning veto (optional)
 *
 * Targets: 65-72% win rate, Sharpe > 1.5, profit factor > 2.0
 */

import { predictWinProbability, getModelStatus } from "./ml_model";
import { reasonTradeDecision } from "./reasoning_engine";
import { logger } from "./logger";

// ── Canonical constants (must match accuracy_seeder and DB data) ──────────────

export const SETUP_TYPES = [
  "absorption_reversal",
  "sweep_reclaim",
  "continuation_pullback",
  "cvd_divergence",
  "breakout_failure",
] as const;

export const REGIMES = [
  "trending_bull",
  "trending_bear",
  "ranging",
  "volatile",
  "chop",
] as const;

export type SetupType = typeof SETUP_TYPES[number];
export type Regime = typeof REGIMES[number];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SuperSignal {
  base_quality: number;
  enhanced_quality: number;
  win_probability: number;
  kelly_fraction: number;
  suggested_qty: number;
  regime_weights: RegimeWeights;
  confluence_score: number;
  aligned_timeframes: number;
  trailing_stop: TrailingStopConfig;
  profit_targets: ProfitTarget[];
  approved: boolean;
  rejection_reason?: string;
  edge_score: number;
  model_breakdown: { lr: number; gbm: number; rf: number; ensemble: number };
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
  initial_atr_multiple: number;
  activation_atr: number;
  trail_step: number;
  max_hold_minutes: number;
}

export interface ProfitTarget {
  close_pct: number;
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
  timeframe_scores?: Record<string, number>;
}

// ── 1. Enhanced Feature Engineering (18 → 26 features) ───────────────────────
// Added: triple interaction, avg, variance, weakest link, quality tiers,
//        regime-direction alignment flag.

function featurize(row: {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  setup_type: string;
  regime: string;
  direction?: string;
}): number[] {
  const s = Math.max(0, Math.min(1, row.structure_score));
  const o = Math.max(0, Math.min(1, row.order_flow_score));
  const r = Math.max(0, Math.min(1, row.recall_score));
  const q = Math.max(0, Math.min(1, row.final_quality));
  const avg = (s + o + r) / 3;
  const variance = Math.sqrt(((s - avg) ** 2 + (o - avg) ** 2 + (r - avg) ** 2) / 3);
  const dir = row.direction === "long" ? 1 : 0;

  const aligned =
    (row.regime === "trending_bull" && row.direction === "long") ||
    (row.regime === "trending_bear" && row.direction === "short")
      ? 1
      : 0;

  const base = [
    s,                           // structure
    o,                           // order_flow
    r,                           // recall
    q,                           // final_quality
    s * o,                       // structure × order_flow
    r * s,                       // recall × structure
    o * r,                       // order_flow × recall (new)
    s * o * r,                   // triple interaction (new)
    Math.abs(s - o),             // disagreement
    avg,                         // average score (new)
    variance,                    // score spread (new)
    Math.min(s, o, r),           // weakest signal (new)
    q > 0.75 ? 1 : 0,            // high quality tier (new)
    q > 0.55 && q <= 0.75 ? 1 : 0, // mid quality tier (new)
    dir,                         // direction
    aligned,                     // regime-direction alignment (new)
  ];

  const setupOH = SETUP_TYPES.map(st => st === row.setup_type ? 1 : 0);
  const regimeOH = REGIMES.map(re => re === row.regime ? 1 : 0);

  return [...base, ...setupOH, ...regimeOH]; // 16 + 5 + 5 = 26 features
}

// ── 2. Gradient Boosted Stumps (enhanced) ─────────────────────────────────────

class GradientBoostedStumps {
  stumps: Array<{
    featureIdx: number;
    threshold: number;
    leftVal: number;
    rightVal: number;
  }> = [];
  trained = false;
  accuracy = 0;
  private calibA = 1.0;
  private calibB = 0.0;

  train(
    X: number[][],
    y: number[],
    nStumps = 300,
    learningRate = 0.08,
    colSampleRate = 0.8,
  ): void {
    const n = X.length;
    if (n < 50) return;
    const dim = X[0].length;

    const baseRate = y.reduce((s, v) => s + v, 0) / n;
    const baseLogOdds = Math.log((baseRate + 1e-7) / (1 - baseRate + 1e-7));
    const F = new Float64Array(n).fill(baseLogOdds);

    for (let round = 0; round < nStumps; round++) {
      // Gradient (pseudo-residuals)
      const residuals = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = 1 / (1 + Math.exp(-F[i]));
        residuals[i] = y[i] - p;
      }

      // Column subsampling (80% of features per round)
      const nCols = Math.max(1, Math.floor(dim * colSampleRate));
      const colIdx: number[] = [];
      const allCols = Array.from({ length: dim }, (_, i) => i);
      // Shuffle and take nCols
      for (let i = allCols.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [allCols[i], allCols[j]] = [allCols[j], allCols[i]];
      }
      for (let i = 0; i < nCols; i++) colIdx.push(allCols[i]);

      let bestGain = -Infinity;
      let bestFeature = 0, bestThresh = 0, bestLeft = 0, bestRight = 0;

      for (const f of colIdx) {
        const vals = X.map(row => row[f]).sort((a, b) => a - b);
        for (let q = 1; q <= 9; q++) {
          const thresh = vals[Math.floor(n * q / 10)];
          let lSum = 0, lN = 0, rSum = 0, rN = 0;
          for (let i = 0; i < n; i++) {
            if (X[i][f] <= thresh) { lSum += residuals[i]; lN++; }
            else { rSum += residuals[i]; rN++; }
          }
          if (lN < 3 || rN < 3) continue;
          const lMean = lSum / lN;
          const rMean = rSum / rN;
          const gain = lSum * lMean + rSum * rMean;
          if (gain > bestGain) {
            bestGain = gain; bestFeature = f;
            bestThresh = thresh; bestLeft = lMean; bestRight = rMean;
          }
        }
      }

      this.stumps.push({
        featureIdx: bestFeature,
        threshold: bestThresh,
        leftVal: bestLeft * learningRate,
        rightVal: bestRight * learningRate,
      });

      for (let i = 0; i < n; i++) {
        F[i] += X[i][bestFeature] <= bestThresh
          ? bestLeft * learningRate
          : bestRight * learningRate;
      }
    }

    this.trained = true;

    // Platt calibration: fit sigmoid on training predictions
    const rawScores = X.map((_, i) => F[i]);
    this._calibrate(rawScores, y);

    // Accuracy after calibration
    let correct = 0;
    for (let i = 0; i < n; i++) {
      const p = this.predictRaw(X[i]);
      if ((p >= 0.5 && y[i] === 1) || (p < 0.5 && y[i] === 0)) correct++;
    }
    this.accuracy = correct / n;
  }

  private _calibrate(rawF: number[], y: number[]): void {
    // Simple isotonic-like calibration via logistic fit on raw scores
    // a, b: minimize cross-entropy of sigmoid(a*F + b)
    let a = 1.0, b = 0.0;
    const lr = 0.01;
    for (let iter = 0; iter < 100; iter++) {
      let da = 0, db = 0;
      for (let i = 0; i < rawF.length; i++) {
        const p = 1 / (1 + Math.exp(-(a * rawF[i] + b)));
        const err = y[i] - p;
        da += err * rawF[i];
        db += err;
      }
      a += lr * da / rawF.length;
      b += lr * db / rawF.length;
    }
    this.calibA = a;
    this.calibB = b;
  }

  private predictRaw(features: number[]): number {
    if (!this.trained || this.stumps.length === 0) return 0.5;
    let F = 0;
    for (const s of this.stumps) {
      F += (features[s.featureIdx] ?? 0) <= s.threshold ? s.leftVal : s.rightVal;
    }
    return 1 / (1 + Math.exp(-(this.calibA * F + this.calibB)));
  }

  predict(features: number[]): number {
    return this.predictRaw(features);
  }
}

// ── 3. Random Forest (bagging of GBMs for variance reduction) ────────────────

class RandomForest {
  trees: GradientBoostedStumps[] = [];
  trained = false;
  accuracy = 0;

  train(X: number[][], y: number[], nTrees = 50): void {
    const n = X.length;
    if (n < 50) return;

    for (let t = 0; t < nTrees; t++) {
      // Bootstrap sample
      const bootX: number[][] = [];
      const bootY: number[] = [];
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(Math.random() * n);
        bootX.push(X[idx]);
        bootY.push(y[idx]);
      }
      const tree = new GradientBoostedStumps();
      tree.train(bootX, bootY, 60, 0.12, 0.7);
      this.trees.push(tree);
    }

    this.trained = true;

    let correct = 0;
    for (let i = 0; i < n; i++) {
      const p = this.predict(X[i]);
      if ((p >= 0.5 && y[i] === 1) || (p < 0.5 && y[i] === 0)) correct++;
    }
    this.accuracy = correct / n;
  }

  predict(features: number[]): number {
    if (!this.trained || this.trees.length === 0) return 0.5;
    return this.trees.reduce((sum, t) => sum + t.predict(features), 0) / this.trees.length;
  }
}

// ── 4. Walk-Forward Validation ────────────────────────────────────────────────

export interface WalkForwardResult {
  train_accuracy: number;
  test_accuracy: number;
  train_samples: number;
  test_samples: number;
  overfit_gap: number;
  is_robust: boolean;
}

function walkForwardValidate(X: number[][], y: number[]): WalkForwardResult {
  const n = X.length;
  const splitIdx = Math.floor(n * 0.8);

  const trainX = X.slice(0, splitIdx);
  const trainY = y.slice(0, splitIdx);
  const testX = X.slice(splitIdx);
  const testY = y.slice(splitIdx);

  const gbm = new GradientBoostedStumps();
  gbm.train(trainX, trainY, 200, 0.08);

  let testCorrect = 0;
  for (let i = 0; i < testX.length; i++) {
    const p = gbm.predict(testX[i]);
    if ((p >= 0.5 && testY[i] === 1) || (p < 0.5 && testY[i] === 0)) testCorrect++;
  }

  const trainAcc = gbm.accuracy;
  const testAcc = testX.length > 0 ? testCorrect / testX.length : 0;
  const gap = trainAcc - testAcc;

  return {
    train_accuracy: trainAcc,
    test_accuracy: testAcc,
    train_samples: trainX.length,
    test_samples: testX.length,
    overfit_gap: gap,
    is_robust: gap < 0.10 && testAcc > 0.58,
  };
}

// ── 5. Regime-Adaptive Weights ────────────────────────────────────────────────

const REGIME_WEIGHTS: Record<string, RegimeWeights> = {
  trending_bull: { structure: 0.35, order_flow: 0.22, recall: 0.18, ml: 0.15, claude: 0.10, label: "Trend-Following (Bull)" },
  trending_bear: { structure: 0.35, order_flow: 0.22, recall: 0.18, ml: 0.15, claude: 0.10, label: "Trend-Following (Bear)" },
  ranging:       { structure: 0.25, order_flow: 0.30, recall: 0.22, ml: 0.13, claude: 0.10, label: "Mean-Reversion (Range)" },
  volatile:      { structure: 0.28, order_flow: 0.28, recall: 0.20, ml: 0.12, claude: 0.12, label: "High-Conviction Only (Volatile)" },
  chop:          { structure: 0.20, order_flow: 0.20, recall: 0.20, ml: 0.20, claude: 0.20, label: "All-Layer Consensus (Chop)" },
};

function getRegimeWeights(regime: string): RegimeWeights {
  return REGIME_WEIGHTS[regime] ?? REGIME_WEIGHTS.ranging;
}

// ── 6. Kelly Criterion ────────────────────────────────────────────────────────

const KELLY_FRACTION = 0.25;
const MIN_POSITION_PCT = 0.005;
const MAX_POSITION_PCT = 0.03;

function kellySize(
  winProb: number,
  rewardRiskRatio: number,
  equity: number,
  entryPrice: number,
): { fraction: number; qty: number } {
  const p = Math.max(0.01, Math.min(0.99, winProb));
  const q = 1 - p;
  const b = Math.max(0.1, rewardRiskRatio);
  let fullKelly = (p * b - q) / b;
  if (fullKelly <= 0) return { fraction: 0, qty: 0 };
  let fraction = Math.max(MIN_POSITION_PCT, Math.min(MAX_POSITION_PCT, fullKelly * KELLY_FRACTION));
  const qty = Math.max(0, Math.floor(equity * fraction / entryPrice * 1000) / 1000);
  return { fraction, qty };
}

// ── 7. Multi-Timeframe Confluence ─────────────────────────────────────────────

const TIMEFRAMES_3 = ["1m", "5m", "15m"] as const;
const CONFLUENCE_THRESHOLD = 0.55;
const MIN_ALIGNED_TF = 2;

function computeConfluence(
  tfScores: Record<string, number> | undefined,
  direction: "long" | "short",
): { score: number; aligned: number } {
  if (!tfScores || Object.keys(tfScores).length === 0) return { score: 0.5, aligned: 0 };
  let aligned = 0, total = 0, count = 0;
  for (const tf of TIMEFRAMES_3) {
    const raw = tfScores[tf];
    if (raw == null) continue;
    const ds = direction === "long" ? raw : 1 - raw;
    if (ds >= CONFLUENCE_THRESHOLD) aligned++;
    total += ds; count++;
  }
  return { score: count > 0 ? total / count : 0.5, aligned };
}

// ── 8. Trailing Stop & Profit Targets ────────────────────────────────────────

function buildTrailingStop(regime: string, winProb: number): TrailingStopConfig {
  const isTrending = regime.includes("trending");
  return {
    initial_atr_multiple: isTrending ? 2.5 : 1.8,
    activation_atr: isTrending ? 1.5 : 1.0,
    trail_step: isTrending ? 0.4 : 0.6,
    max_hold_minutes: isTrending ? 180 : 90,
  };
}

function buildProfitTargets(regime: string, winProb: number): ProfitTarget[] {
  const isTrending = regime.includes("trending");
  const isHighConf = winProb >= 0.65;
  if (isTrending && isHighConf)
    return [{ close_pct: 0.33, r_target: 1.5 }, { close_pct: 0.33, r_target: 3.0 }, { close_pct: 0.34, r_target: 5.0 }];
  if (isTrending)
    return [{ close_pct: 0.33, r_target: 1.0 }, { close_pct: 0.33, r_target: 2.0 }, { close_pct: 0.34, r_target: 3.5 }];
  return [{ close_pct: 0.50, r_target: 1.0 }, { close_pct: 0.30, r_target: 1.5 }, { close_pct: 0.20, r_target: 2.5 }];
}

// ── 9. Global Model State ─────────────────────────────────────────────────────

let _gbm: GradientBoostedStumps | null = null;
let _rf: RandomForest | null = null;
let _ensembleStatus: "untrained" | "trained" | "error" = "untrained";
let _walkForward: WalkForwardResult | null = null;
let _ensembleMeta: {
  gbm_accuracy: number;
  rf_accuracy: number;
  lr_accuracy: number;
  ensemble_accuracy: number;
  samples: number;
  trained_at: string;
  walk_forward: WalkForwardResult | null;
} | null = null;

// ── 10. Train Ensemble ────────────────────────────────────────────────────────

export async function trainEnsemble(): Promise<void> {
  try {
    console.log("[SI-v2] Training ensemble (GBM-300 + RF-50 + LR)...");

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
          isNotNull(accuracyResultsTable.order_flow_score),
        )
      )
      .limit(200_000);

    if (rows.length < 100) {
      console.log(`[SI-v2] Only ${rows.length} samples — need ≥100.`);
      _ensembleStatus = "untrained";
      return;
    }

    // Build feature matrix
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

    // Walk-forward validation (out-of-sample test)
    console.log("[SI-v2] Running walk-forward validation...");
    _walkForward = walkForwardValidate(X, y);
    console.log(`[SI-v2] Walk-forward: train=${(_walkForward.train_accuracy * 100).toFixed(1)}% test=${(_walkForward.test_accuracy * 100).toFixed(1)}% gap=${(_walkForward.overfit_gap * 100).toFixed(1)}% robust=${_walkForward.is_robust}`);

    // Train GBM on full dataset
    const gbm = new GradientBoostedStumps();
    gbm.train(X, y, 300, 0.08, 0.8);

    // Train Random Forest
    const rf = new RandomForest();
    rf.train(X, y, 50);

    // LR accuracy
    const mlStatus = getModelStatus();
    const lrAccuracy = mlStatus.meta?.accuracy ?? 0;

    // Ensemble accuracy (40% GBM + 30% RF + 30% LR)
    let ensembleCorrect = 0;
    for (let i = 0; i < X.length; i++) {
      const gbmP = gbm.predict(X[i]);
      const rfP = rf.predict(X[i]);
      const lrP = predictWinProbability({
        structure_score: parseFloat(String(rows[i].structure_score ?? "0")),
        order_flow_score: parseFloat(String(rows[i].order_flow_score ?? "0")),
        recall_score: parseFloat(String(rows[i].recall_score ?? "0")),
        final_quality: parseFloat(String(rows[i].final_quality ?? "0")),
        setup_type: rows[i].setup_type ?? "absorption_reversal",
        regime: rows[i].regime ?? "ranging",
        direction: rows[i].direction ?? "long",
      }).probability;
      const ens = 0.40 * gbmP + 0.30 * rfP + 0.30 * lrP;
      if ((ens >= 0.5 && y[i] === 1) || (ens < 0.5 && y[i] === 0)) ensembleCorrect++;
    }

    _gbm = gbm;
    _rf = rf;
    _ensembleStatus = "trained";
    _ensembleMeta = {
      gbm_accuracy: gbm.accuracy,
      rf_accuracy: rf.accuracy,
      lr_accuracy: lrAccuracy,
      ensemble_accuracy: ensembleCorrect / X.length,
      samples: X.length,
      trained_at: new Date().toISOString(),
      walk_forward: _walkForward,
    };

    console.log(`[SI-v2] Ensemble trained:`);
    console.log(`[SI-v2]   GBM(300):  ${(gbm.accuracy * 100).toFixed(1)}%`);
    console.log(`[SI-v2]   RF(50):    ${(rf.accuracy * 100).toFixed(1)}%`);
    console.log(`[SI-v2]   LR:        ${(lrAccuracy * 100).toFixed(1)}%`);
    console.log(`[SI-v2]   Ensemble:  ${(_ensembleMeta.ensemble_accuracy * 100).toFixed(1)}%`);
    console.log(`[SI-v2]   Samples:   ${X.length}`);

  } catch (err) {
    console.error("[SI-v2] Ensemble training failed:", err);
    _ensembleStatus = "error";
  }
}

function ensemblePredict(input: {
  structure_score: number; order_flow_score: number; recall_score: number;
  final_quality: number; setup_type: string; regime: string; direction?: string;
}): { probability: number; lr: number; gbm: number; rf: number } {
  const lrResult = predictWinProbability(input);
  const lr = lrResult.probability;

  if (_gbm?.trained && _rf?.trained) {
    const features = featurize(input);
    const gbm = _gbm.predict(features);
    const rf = _rf.predict(features);
    const probability = 0.40 * gbm + 0.30 * rf + 0.30 * lr;
    return { probability, lr, gbm, rf };
  }

  if (_gbm?.trained) {
    const features = featurize(input);
    const gbm = _gbm.predict(features);
    const probability = 0.60 * gbm + 0.40 * lr;
    return { probability, lr, gbm, rf: lr };
  }

  return { probability: lr, lr, gbm: lr, rf: lr };
}

// ── 11. Main Entry Point ──────────────────────────────────────────────────────

export async function processSuperSignal(
  signalId: number,
  symbol: string,
  input: SuperIntelligenceInput,
): Promise<SuperSignal> {
  const { structure_score, order_flow_score, recall_score,
    setup_type, regime, direction, entry_price, stop_loss,
    take_profit, atr, equity, timeframe_scores } = input;

  const weights = getRegimeWeights(regime);

  const { probability: win_probability, lr, gbm, rf } = ensemblePredict({
    structure_score, order_flow_score, recall_score,
    final_quality: structure_score * 0.35 + order_flow_score * 0.30 + recall_score * 0.20 + 0.05,
    setup_type, regime, direction,
  });

  const reasoning = await reasonTradeDecision(signalId, symbol, {
    structure: structure_score, order_flow: order_flow_score,
    recall: recall_score, setup_type, regime, direction,
  });
  const claude_est = reasoning.winProbability;

  const enhanced_quality = Math.max(0, Math.min(1,
    weights.structure * structure_score +
    weights.order_flow * order_flow_score +
    weights.recall * recall_score +
    weights.ml * win_probability +
    weights.claude * claude_est,
  ));

  const base_quality =
    0.32 * structure_score + 0.28 * order_flow_score +
    0.20 * recall_score + 0.12 * claude_est +
    0.08 * (0.55 + recall_score * 0.25);

  const { score: confluence_score, aligned: aligned_timeframes } =
    computeConfluence(timeframe_scores, direction);

  const risk = Math.abs(entry_price - stop_loss);
  const reward = Math.abs(take_profit - entry_price);
  const rrr = risk > 0 ? reward / risk : 1;

  const { fraction: kelly_fraction, qty: suggested_qty } =
    kellySize(win_probability, rrr, equity, entry_price);

  const trailing_stop = buildTrailingStop(regime, win_probability);
  const profit_targets = buildProfitTargets(regime, win_probability);

  const edge_score = win_probability * rrr - (1 - win_probability);

  // Gate thresholds — tuned based on regime
  const regimeThresholds: Record<string, number> = {
    trending_bull: 0.58, trending_bear: 0.60,
    ranging: 0.65, volatile: 0.72, chop: 0.82,
  };
  const qualityThreshold = regimeThresholds[regime] ?? 0.65;
  const hasMTF = timeframe_scores && Object.keys(timeframe_scores).length > 0;

  let approved = true;
  let rejection_reason: string | undefined;

  if (enhanced_quality < qualityThreshold) {
    approved = false;
    rejection_reason = `Quality ${(enhanced_quality * 100).toFixed(1)}% below ${regime} threshold ${(qualityThreshold * 100).toFixed(0)}%`;
  } else if (win_probability < 0.54) {
    approved = false;
    rejection_reason = `Win probability ${(win_probability * 100).toFixed(1)}% below 54% minimum`;
  } else if (hasMTF && aligned_timeframes < MIN_ALIGNED_TF) {
    approved = false;
    rejection_reason = `Only ${aligned_timeframes}/${TIMEFRAMES_3.length} timeframes aligned (need ${MIN_ALIGNED_TF})`;
  } else if (edge_score <= 0) {
    approved = false;
    rejection_reason = `Negative edge: EV = ${edge_score.toFixed(3)}`;
  } else if (kelly_fraction <= 0) {
    approved = false;
    rejection_reason = "Kelly says no bet";
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
    model_breakdown: { lr, gbm, rf, ensemble: win_probability },
  };
}

// ── 12. Status & Diagnostics ──────────────────────────────────────────────────

export function getSuperIntelligenceStatus(): {
  status: "active" | "partial" | "inactive";
  ensemble: typeof _ensembleMeta;
  walk_forward: WalkForwardResult | null;
  message: string;
} {
  if (_ensembleStatus === "trained" && _ensembleMeta) {
    const wf = _ensembleMeta.walk_forward;
    const wfStr = wf ? ` | WF test=${(wf.test_accuracy * 100).toFixed(1)}% robust=${wf.is_robust}` : "";
    return {
      status: "active",
      ensemble: _ensembleMeta,
      walk_forward: _walkForward,
      message: `Ensemble v2 active: ${(_ensembleMeta.ensemble_accuracy * 100).toFixed(1)}% accuracy (GBM ${(_ensembleMeta.gbm_accuracy * 100).toFixed(1)}% | RF ${(_ensembleMeta.rf_accuracy * 100).toFixed(1)}% | LR ${(_ensembleMeta.lr_accuracy * 100).toFixed(1)}%) on ${_ensembleMeta.samples} samples${wfStr}`,
    };
  }
  const mlStatus = getModelStatus();
  if (mlStatus.status === "active") {
    return { status: "partial", ensemble: null, walk_forward: null, message: "LR active, GBM/RF training pending" };
  }
  return { status: "inactive", ensemble: null, walk_forward: null, message: "Super Intelligence inactive — heuristic pipeline only" };
}

export { featurize, ensemblePredict };
