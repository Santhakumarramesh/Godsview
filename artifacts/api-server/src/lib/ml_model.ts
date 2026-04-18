/**
 * ML Model Layer — Ensemble Logistic Regression trained on accuracy_results.
 *
 * v2 improvements over v1:
 *   - Feature vector expanded from 21 → 29 features
 *     (added: avg_score, min_score, quality², quality_high/low flags,
 *      structure×quality, flow×recall, directional_structure interaction)
 *   - Class-balanced gradient descent (sklearn-style balanced weights)
 *   - Cosine annealing learning rate schedule for better convergence
 *   - Bootstrap ensemble: 5 models trained on resampled subsets, averaged
 *   - Setup-specific sub-models blend stays (35% global / 65% setup-specific)
 *
 * Architecture:
 *   - Feature vector: 16 base + 8 setup one-hot + 5 regime one-hot = 29
 *   - Target: outcome === "win" → 1, "loss" → 0
 *   - Method: Balanced-class L2 logistic regression, SGD, ensemble of 5
 *   - Inference: <2ms per prediction (pure math, no external deps)
 */

import { db, accuracyResultsTable } from "@workspace/db";
import { eq, sql, and, isNotNull, or, desc } from "@workspace/db";
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MLPrediction {
  probability: number;   // 0.0 – 1.0 win probability
  confidence: number;    // model confidence (calibration quality)
  source: "trained" | "trained_setup" | "heuristic";
}

interface TrainingRow {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  setup_type: string;
  regime: string;
  direction: string;
  outcome: string; // "win" | "loss"
}

interface RawTrainingRow {
  structure_score: unknown;
  order_flow_score: unknown;
  recall_score: unknown;
  final_quality: unknown;
  setup_type: string | null;
  regime: string | null;
  direction: string | null;
  outcome: string | null;
}

interface CvFoldMetrics {
  fold: number;
  trainSamples: number;
  testSamples: number;
  accuracy: number;
  auc: number;
}

interface PurgedCvMetrics {
  folds: number;
  embargoPct: number;
  purgeWindow: number;
  evaluatedSamples: number;
  accuracy: number;
  auc: number;
  foldMetrics: CvFoldMetrics[];
}

interface DriftSnapshot {
  status: "stable" | "watch" | "drift";
  sampleRecent: number;
  sampleBaseline: number;
  recentWinRate: number;
  baselineWinRate: number;
  winRateDelta: number;
  recentAvgQuality: number;
  baselineAvgQuality: number;
  qualityDelta: number;
  bySetup: Array<{
    setup: string;
    recentWinRate: number;
    baselineWinRate: number;
    winRateDelta: number;
    recentSamples: number;
    baselineSamples: number;
  }>;
  computedAt: string;
}

interface SetupModelMeta {
  setup: string;
  samples: number;
  accuracy: number;
  auc: number;
  winRate: number;
}

// ── Feature Engineering ────────────────────────────────────────────────────────

const SETUP_TYPES = [
  "absorption_reversal",
  "sweep_reclaim",
  "continuation_pullback",
  "cvd_divergence",
  "breakout_failure",
  "vwap_reclaim",
  "opening_range_breakout",
  "post_news_continuation",
] as const;
const REGIMES = ["trending_bull", "trending_bear", "ranging", "volatile", "chop"] as const;

function oneHotSetup(setup: string): number[] {
  return SETUP_TYPES.map(s => s === setup ? 1 : 0);
}

function oneHotRegime(regime: string): number[] {
  return REGIMES.map(r => r === regime ? 1 : 0);
}

/**
 * v2 feature vector: 16 base + 8 setup one-hot + 5 regime one-hot = 29 features.
 *
 * Key additions over v1:
 *  - avg_score: mean of all three component scores
 *  - min_score: weakest component (catches one bad factor)
 *  - quality_sq: non-linear quality effect (high quality matters more)
 *  - quality_high / quality_low: threshold flags
 *  - structure × quality: amplifies strong setups
 *  - flow × recall: confluence between memory and current flow
 *  - directional_structure: direction-signed structure (longs benefit from bull structure)
 */
function featurize(row: {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  setup_type: string;
  regime: string;
  direction?: string;
}): number[] {
  const s = row.structure_score;
  const f = row.order_flow_score;
  const r = row.recall_score;
  const q = row.final_quality;
  const isLong = row.direction === "long" ? 1 : 0;

  const base = [
    // ── Original 8 ─────────────────────────────────────────────
    s,
    f,
    r,
    q,
    s * f,                        // structure × flow confluence
    r * s,                        // recall × structure confluence
    Math.abs(s - f),              // score disagreement (negative signal)
    isLong,
    // ── v2 additions ────────────────────────────────────────────
    (s + f + r) / 3,              // average composite score
    Math.min(s, f),               // weakest link (both must be good)
    q * q,                        // quality² — non-linear quality premium
    q > 0.65 ? 1 : 0,             // high-quality flag
    q < 0.40 ? 1 : 0,             // low-quality flag (negative signal)
    s * q,                        // structure × quality amplifier
    f * r,                        // flow × recall confluence
    (isLong * 2 - 1) * s,         // direction-signed structure
  ];
  return [...base, ...oneHotSetup(row.setup_type), ...oneHotRegime(row.regime)];
}

const FEATURE_DIM = 16 + SETUP_TYPES.length + REGIMES.length; // 16 + 8 + 5 = 29

// ── Logistic Regression ────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

interface TrainOptions {
  epochs?: number;
  lr?: number;
  lambda?: number;
  batchSize?: number;
  classWeights?: { pos: number; neg: number }; // balanced class weights
}

class LogisticRegression {
  weights: Float64Array;
  bias: number = 0;
  trained: boolean = false;
  trainingSamples: number = 0;
  accuracy: number = 0;
  auc: number = 0;

  constructor(dim: number) {
    this.weights = new Float64Array(dim);
  }

  predict(features: number[]): number {
    let z = this.bias;
    for (let i = 0; i < features.length; i++) {
      z += this.weights[i] * (features[i] ?? 0);
    }
    return sigmoid(z);
  }

  /**
   * Train with mini-batch SGD + L2 regularization + class balancing.
   * Uses cosine annealing learning rate schedule for better convergence.
   */
  train(X: number[][], y: number[], options: TrainOptions = {}): void {
    const {
      epochs = 100,
      lr = 0.015,
      lambda = 0.0005,
      batchSize = 128,
      classWeights,
    } = options;
    const n = X.length;
    if (n === 0) return;

    // Default to balanced class weights if not provided
    const nPos = y.filter(v => v === 1).length;
    const nNeg = n - nPos;
    const cw = classWeights ?? {
      pos: nNeg > 0 ? n / (2 * nPos) : 1,
      neg: nPos > 0 ? n / (2 * nNeg) : 1,
    };

    // Initialize weights with He-style small random values
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] = (Math.random() - 0.5) * 0.02;
    }
    this.bias = 0;

    const indices = Array.from({ length: n }, (_, i) => i);

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Fisher-Yates shuffle
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      // Cosine annealing: lr_t = lr_min + 0.5 * (lr_max - lr_min) * (1 + cos(π * t/T))
      const currentLr = lr * 0.5 * (1 + Math.cos(Math.PI * epoch / epochs));

      for (let batch = 0; batch < n; batch += batchSize) {
        const end = Math.min(batch + batchSize, n);
        const batchLen = end - batch;

        const gradW = new Float64Array(this.weights.length);
        let gradB = 0;

        for (let b = batch; b < end; b++) {
          const idx = indices[b];
          const pred = this.predict(X[idx]);
          const error = pred - y[idx];
          // Class-weighted gradient
          const w = y[idx] === 1 ? cw.pos : cw.neg;

          for (let j = 0; j < this.weights.length; j++) {
            gradW[j] += w * error * (X[idx][j] ?? 0);
          }
          gradB += w * error;
        }

        for (let j = 0; j < this.weights.length; j++) {
          this.weights[j] -= currentLr * (gradW[j] / batchLen + lambda * this.weights[j]);
        }
        this.bias -= currentLr * (gradB / batchLen);
      }
    }

    this.trained = true;
    this.trainingSamples = n;

    let correct = 0;
    const predictions: { pred: number; label: number }[] = [];
    for (let i = 0; i < n; i++) {
      const pred = this.predict(X[i]);
      predictions.push({ pred, label: y[i] });
      if ((pred >= 0.5 && y[i] === 1) || (pred < 0.5 && y[i] === 0)) correct++;
    }
    this.accuracy = correct / n;
    this.auc = computeAUC(predictions);
  }
}

// ── Ensemble ───────────────────────────────────────────────────────────────────

/**
 * Bootstrap ensemble: trains N models on resampled subsets of the data.
 * Averaging reduces variance and gives more stable probability estimates.
 */
class EnsembleLR {
  models: LogisticRegression[] = [];
  trained: boolean = false;
  accuracy: number = 0;
  auc: number = 0;
  trainingSamples: number = 0;

  train(
    X: number[][],
    y: number[],
    nModels: number = 5,
    options: TrainOptions = {},
  ): void {
    const n = X.length;
    if (n < 100) return;

    this.models = [];

    // Train each member on a bootstrap resample (63.2% unique samples on average)
    const sampleSize = Math.max(200, Math.floor(n * 0.8));

    for (let m = 0; m < nModels; m++) {
      const model = new LogisticRegression(FEATURE_DIM);

      // Bootstrap sample (with replacement)
      const bootX: number[][] = [];
      const bootY: number[] = [];
      for (let i = 0; i < sampleSize; i++) {
        const idx = Math.floor(Math.random() * n);
        bootX.push(X[idx]);
        bootY.push(y[idx]);
      }

      model.train(bootX, bootY, options);
      if (model.trained) this.models.push(model);
    }

    if (!this.models.length) return;
    this.trained = true;
    this.trainingSamples = n;

    // Compute ensemble-level metrics on full training set
    let correct = 0;
    const preds: { pred: number; label: number }[] = [];
    for (let i = 0; i < n; i++) {
      const prob = this.predict(X[i]);
      preds.push({ pred: prob, label: y[i] });
      if ((prob >= 0.5 && y[i] === 1) || (prob < 0.5 && y[i] === 0)) correct++;
    }
    this.accuracy = correct / n;
    this.auc = computeAUC(preds);
  }

  predict(features: number[]): number {
    if (!this.models.length) return 0.5;
    const sum = this.models.reduce((acc, m) => acc + m.predict(features), 0);
    return sum / this.models.length;
  }
}

// ── AUC-ROC ───────────────────────────────────────────────────────────────────

function computeAUC(predictions: { pred: number; label: number }[]): number {
  const sorted = [...predictions].sort((a, b) => b.pred - a.pred);
  let tp = 0, fp = 0;
  const totalP = sorted.filter(p => p.label === 1).length;
  const totalN = sorted.length - totalP;
  if (totalP === 0 || totalN === 0) return 0.5;

  let auc = 0;
  let prevFPR = 0;
  let prevTPR = 0;

  for (const { label } of sorted) {
    if (label === 1) tp++;
    else fp++;

    const tpr = tp / totalP;
    const fpr = fp / totalN;
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2;
    prevFPR = fpr;
    prevTPR = tpr;
  }

  return auc;
}

function predictWithModel(model: { weights: Float64Array; bias: number }, features: number[]): number {
  let z = model.bias;
  for (let i = 0; i < features.length; i++) {
    z += model.weights[i] * (features[i] ?? 0);
  }
  return sigmoid(z);
}

function sampleIndices(length: number, target: number): number[] {
  if (length <= target) return Array.from({ length }, (_, idx) => idx);
  const stride = Math.max(1, Math.floor(length / target));
  const indices: number[] = [];
  for (let i = 0; i < length; i += stride) {
    indices.push(i);
    if (indices.length >= target) break;
  }
  if (indices[indices.length - 1] !== length - 1) indices.push(length - 1);
  return indices;
}

function runPurgedEmbargoCv(
  X: number[][],
  y: number[],
  options: {
    folds?: number;
    embargoPct?: number;
    purgeWindow?: number;
    maxSamples?: number;
  } = {},
): PurgedCvMetrics | null {
  const folds = Math.max(3, Math.min(Math.floor(options.folds ?? 5), 8));
  const embargoPct = Math.max(0, Math.min(options.embargoPct ?? 0.01, 0.1));
  const purgeWindow = Math.max(1, Math.min(Math.floor(options.purgeWindow ?? 20), 300));
  const maxSamples = Math.max(2_000, Math.min(Math.floor(options.maxSamples ?? 25_000), X.length));

  if (X.length < 500 || X.length !== y.length) return null;

  const sampledIdx = sampleIndices(X.length, maxSamples);
  const Xs = sampledIdx.map((idx) => X[idx]);
  const ys = sampledIdx.map((idx) => y[idx]);
  const n = Xs.length;
  const foldSize = Math.max(1, Math.floor(n / folds));
  const embargo = Math.floor(n * embargoPct);

  const foldMetrics: CvFoldMetrics[] = [];

  for (let fold = 0; fold < folds; fold++) {
    const testStart = fold * foldSize;
    const testEnd = fold === folds - 1 ? n : Math.min(n, (fold + 1) * foldSize);
    if (testStart >= testEnd) continue;

    const purgeStart = Math.max(0, testStart - purgeWindow);
    const purgeEnd = Math.min(n, testEnd + purgeWindow);
    const embargoEnd = Math.min(n, purgeEnd + embargo);

    const trainIndices: number[] = [];
    for (let i = 0; i < purgeStart; i++) trainIndices.push(i);
    for (let i = embargoEnd; i < n; i++) trainIndices.push(i);
    const testIndices: number[] = [];
    for (let i = testStart; i < testEnd; i++) testIndices.push(i);

    if (trainIndices.length < 120 || testIndices.length < 40) continue;

    const model = new LogisticRegression(FEATURE_DIM);
    model.train(
      trainIndices.map((idx) => Xs[idx]),
      trainIndices.map((idx) => ys[idx]),
      { epochs: 60, lr: 0.012, lambda: 0.0008, batchSize: 96 },
    );

    let correct = 0;
    const preds: { pred: number; label: number }[] = [];
    for (const idx of testIndices) {
      const pred = predictWithModel(model, Xs[idx]);
      const label = ys[idx]!;
      preds.push({ pred, label });
      if ((pred >= 0.5 && label === 1) || (pred < 0.5 && label === 0)) correct++;
    }

    foldMetrics.push({
      fold: fold + 1,
      trainSamples: trainIndices.length,
      testSamples: testIndices.length,
      accuracy: correct / testIndices.length,
      auc: computeAUC(preds),
    });
  }

  if (!foldMetrics.length) return null;

  const evaluatedSamples = foldMetrics.reduce((sum, fold) => sum + fold.testSamples, 0);
  const accuracy = foldMetrics.reduce((sum, fold) => sum + fold.accuracy * fold.testSamples, 0) / evaluatedSamples;
  const auc = foldMetrics.reduce((sum, fold) => sum + fold.auc * fold.testSamples, 0) / evaluatedSamples;

  return { folds, embargoPct, purgeWindow, evaluatedSamples, accuracy, auc, foldMetrics };
}

function summarizeRows(rows: TrainingRow[]): {
  samples: number;
  winRate: number;
  avgQuality: number;
  bySetup: Map<string, { wins: number; total: number }>;
} {
  if (!rows.length) {
    return { samples: 0, winRate: 0, avgQuality: 0, bySetup: new Map() };
  }
  let wins = 0;
  let qualitySum = 0;
  const bySetup = new Map<string, { wins: number; total: number }>();
  for (const row of rows) {
    if (row.outcome === "win") wins++;
    qualitySum += row.final_quality;
    const bucket = bySetup.get(row.setup_type) ?? { wins: 0, total: 0 };
    bucket.total += 1;
    if (row.outcome === "win") bucket.wins += 1;
    bySetup.set(row.setup_type, bucket);
  }
  return {
    samples: rows.length,
    winRate: wins / rows.length,
    avgQuality: qualitySum / rows.length,
    bySetup,
  };
}

function trainSetupSpecificModels(rows: TrainingRow[]): {
  models: Map<string, EnsembleLR>;
  meta: SetupModelMeta[];
} {
  const bySetup = new Map<string, { X: number[][]; y: number[]; wins: number; losses: number }>();

  for (const row of rows) {
    const bucket = bySetup.get(row.setup_type) ?? { X: [], y: [], wins: 0, losses: 0 };
    const label = row.outcome === "win" ? 1 : 0;
    bucket.X.push(featurize(row));
    bucket.y.push(label);
    if (label === 1) bucket.wins += 1;
    else bucket.losses += 1;
    bySetup.set(row.setup_type, bucket);
  }

  const models = new Map<string, EnsembleLR>();
  const meta: SetupModelMeta[] = [];

  for (const [setup, bucket] of bySetup.entries()) {
    if (bucket.X.length < 350) continue;
    if (bucket.wins < 25 || bucket.losses < 25) continue;

    const ensemble = new EnsembleLR();
    ensemble.train(bucket.X, bucket.y, 3, {
      epochs: 80,
      lr: 0.013,
      lambda: 0.0007,
      batchSize: 96,
    });
    if (!ensemble.trained) continue;

    models.set(setup, ensemble);
    meta.push({
      setup,
      samples: bucket.X.length,
      accuracy: ensemble.accuracy,
      auc: ensemble.auc,
      winRate: bucket.wins / Math.max(bucket.X.length, 1),
    });
  }

  meta.sort((a, b) => b.samples - a.samples);
  return { models, meta };
}

// ── Global Model Instance ──────────────────────────────────────────────────────

let _ensemble: EnsembleLR | null = null;
let _modelStatus: "untrained" | "training" | "trained" | "error" = "untrained";
let _modelMeta: {
  samples: number;
  accuracy: number;
  auc: number;
  winRate: number;
  purgedCv: PurgedCvMetrics | null;
  setupModelsTrained: number;
  setupModelMeta: SetupModelMeta[];
  trainedAt: string;
} | null = null;
let _setupModels = new Map<string, EnsembleLR>();
let _driftCache: { data: DriftSnapshot; ts: number } | null = null;
const DRIFT_CACHE_TTL_MS = 60_000;

/**
 * Train the ML ensemble from accuracy_results in the database.
 * Called once at server startup. Safe to call multiple times.
 */
export async function trainModel(): Promise<void> {
  _modelStatus = "training";
  logger.info("[ml] Training ML ensemble from accuracy_results...");

  try {
    const rows: RawTrainingRow[] = await db
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
          or(
            eq(accuracyResultsTable.outcome, "win"),
            eq(accuracyResultsTable.outcome, "loss")
          ),
          isNotNull(accuracyResultsTable.structure_score),
          isNotNull(accuracyResultsTable.order_flow_score)
        )
      )
      .limit(200_000);

    if (rows.length < 50) {
      logger.info(`Only ${rows.length} labeled samples — need ≥50. Keeping heuristic fallback.`);
      _modelStatus = "untrained";
      _setupModels = new Map();
      return;
    }

    const wins = rows.filter((r: RawTrainingRow) => r.outcome === "win").length;
    const losses = rows.filter((r: RawTrainingRow) => r.outcome === "loss").length;
    const winRate = wins / (wins + losses);
    logger.info(`Training data: ${rows.length} samples (${wins} wins, ${losses} losses, ${(winRate * 100).toFixed(1)}% win rate)`);

    const X: number[][] = [];
    const y: number[] = [];
    const normalizedRows: TrainingRow[] = [];

    for (const row of rows) {
      const normalized: TrainingRow = {
        structure_score: parseFloat(String(row.structure_score ?? "0")),
        order_flow_score: parseFloat(String(row.order_flow_score ?? "0")),
        recall_score: parseFloat(String(row.recall_score ?? "0")),
        final_quality: parseFloat(String(row.final_quality ?? "0")),
        setup_type: row.setup_type ?? "absorption_reversal",
        regime: row.regime ?? "ranging",
        direction: row.direction ?? "long",
        outcome: row.outcome === "win" ? "win" : "loss",
      };
      normalizedRows.push(normalized);
      X.push(featurize(normalized));
      y.push(normalized.outcome === "win" ? 1 : 0);
    }

    const purgedCv = runPurgedEmbargoCv(X, y, {
      folds: 5,
      embargoPct: 0.015,
      purgeWindow: 20,
      maxSamples: 25_000,
    });

    // Train bootstrap ensemble (5 members, class-balanced)
    const ensemble = new EnsembleLR();
    ensemble.train(X, y, 5, {
      epochs: 100,
      lr: 0.015,
      lambda: 0.0005,
      batchSize: 128,
    });

    const setupSpecific = trainSetupSpecificModels(normalizedRows);
    _ensemble = ensemble;
    _setupModels = setupSpecific.models;
    _modelStatus = "trained";
    _modelMeta = {
      samples: rows.length,
      accuracy: ensemble.accuracy,
      auc: ensemble.auc,
      winRate,
      purgedCv,
      setupModelsTrained: setupSpecific.models.size,
      setupModelMeta: setupSpecific.meta,
      trainedAt: new Date().toISOString(),
    };

    logger.info(`Ensemble trained successfully:`);
    logger.info(`  Samples: ${rows.length}`);
    logger.info(`  Accuracy: ${(ensemble.accuracy * 100).toFixed(1)}%`);
    logger.info(`  AUC-ROC: ${ensemble.auc.toFixed(3)}`);
    logger.info(`  Win rate baseline: ${(winRate * 100).toFixed(1)}%`);
    logger.info(`  Ensemble members: ${ensemble.models.length}`);
    logger.info(`  Setup sub-models: ${setupSpecific.models.size}`);
    if (purgedCv) {
      logger.info(
        `[ml]   Purged CV: AUC ${purgedCv.auc.toFixed(3)} · Accuracy ${(purgedCv.accuracy * 100).toFixed(1)}% · Samples ${purgedCv.evaluatedSamples}`,
      );
    }

    const trainingSummary = summarizeRows(normalizedRows);
    logger.info(
      `[ml]   Summary: ${(trainingSummary.winRate * 100).toFixed(1)}% win rate across ${trainingSummary.samples} labeled rows`,
    );
  } catch (err) {
    logger.error({ err }, "[ml] Training failed");
    _modelStatus = "error";
    _setupModels = new Map();
  }
}

/**
 * Predict win probability for a signal.
 * Falls back to heuristic if ensemble is not trained.
 */
export function predictWinProbability(input: {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  setup_type: string;
  regime: string;
  direction?: string;
}): MLPrediction {
  if (_ensemble?.trained) {
    const features = featurize(input);
    const globalProbability = _ensemble.predict(features);
    const setupEnsemble = _setupModels.get(input.setup_type);
    let source: MLPrediction["source"] = "trained";
    let probability = globalProbability;
    let confidence = _ensemble.auc;

    if (setupEnsemble?.trained) {
      const setupProbability = setupEnsemble.predict(features);
      // 30% global + 70% setup-specific for more targeted predictions
      probability = globalProbability * 0.30 + setupProbability * 0.70;
      confidence = (_ensemble.auc * 0.40) + (setupEnsemble.auc * 0.60);
      source = "trained_setup";
    }

    // Drift-aware confidence squeeze
    const drift = _driftCache?.data;
    if (drift?.status === "watch") {
      probability = 0.5 + (probability - 0.5) * 0.7;
      confidence *= 0.88;
    } else if (drift?.status === "drift") {
      let squeeze = 0.45;
      const setupDrift = drift.bySetup.find((item) => item.setup === input.setup_type);
      if (setupDrift && setupDrift.winRateDelta <= -0.06) squeeze = 0.35;
      probability = 0.5 + (probability - 0.5) * squeeze;
      confidence *= 0.75;
    }

    return {
      probability: Math.max(0.01, Math.min(0.99, probability)),
      confidence: Math.max(0, Math.min(1, confidence)),
      source,
    };
  }

  // Heuristic fallback
  const heuristic = 0.55 + input.recall_score * 0.25;
  return {
    probability: Math.max(0.01, Math.min(0.99, heuristic)),
    confidence: 0,
    source: "heuristic",
  };
}

/**
 * Get model status for system diagnostics.
 */
export function getModelStatus(): {
  status: "active" | "warning" | "error";
  message: string;
  meta: typeof _modelMeta;
} {
  switch (_modelStatus) {
    case "trained": {
      const cvMessage = _modelMeta?.purgedCv
        ? ` · PurgedCV AUC ${_modelMeta.purgedCv.auc.toFixed(2)}`
        : "";
      const setupMessage = _modelMeta?.setupModelsTrained
        ? ` · SetupModels ${_modelMeta.setupModelsTrained}`
        : "";
      return {
        status: "active",
        message: `Ensemble(${_ensemble?.models.length ?? 0}) · ${_modelMeta!.samples} samples · AUC ${_modelMeta!.auc.toFixed(2)} · Accuracy ${(_modelMeta!.accuracy * 100).toFixed(0)}%${cvMessage}${setupMessage}`,
        meta: _modelMeta,
      };
    }
    case "training":
      return { status: "warning", message: "Ensemble training in progress…", meta: null };
    case "error":
      return { status: "error", message: "Ensemble training failed — using heuristic fallback", meta: null };
    default:
      return { status: "warning", message: "ML layer using heuristic scoring — train a model to upgrade", meta: null };
  }
}

export async function getModelDriftStatus(forceRefresh = false): Promise<DriftSnapshot> {
  if (!forceRefresh && _driftCache && Date.now() - _driftCache.ts < DRIFT_CACHE_TTL_MS) {
    return _driftCache.data;
  }

  const rawRows: RawTrainingRow[] = await db
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
        isNotNull(accuracyResultsTable.final_quality),
      ),
    )
    .orderBy(desc(accuracyResultsTable.created_at))
    .limit(14_000);

  const normalized: TrainingRow[] = rawRows.map((row) => ({
    structure_score: parseFloat(String(row.structure_score ?? "0")),
    order_flow_score: parseFloat(String(row.order_flow_score ?? "0")),
    recall_score: parseFloat(String(row.recall_score ?? "0")),
    final_quality: parseFloat(String(row.final_quality ?? "0")),
    setup_type: row.setup_type ?? "unknown",
    regime: row.regime ?? "unknown",
    direction: row.direction ?? "unknown",
    outcome: row.outcome === "win" ? "win" : "loss",
  }));

  const recent = normalized.slice(0, 2_000);
  const baseline = normalized.slice(2_000, 10_000);
  const recentStats = summarizeRows(recent);
  const baselineStats = summarizeRows(baseline);

  const winRateDelta = recentStats.winRate - baselineStats.winRate;
  const qualityDelta = recentStats.avgQuality - baselineStats.avgQuality;
  let status: DriftSnapshot["status"] = "stable";
  if (winRateDelta <= -0.07 || qualityDelta <= -0.05) status = "drift";
  else if (winRateDelta <= -0.04 || qualityDelta <= -0.03) status = "watch";

  const setupNames = new Set<string>([
    ...Array.from(recentStats.bySetup.keys()),
    ...Array.from(baselineStats.bySetup.keys()),
  ]);
  const bySetup = Array.from(setupNames)
    .map((setup) => {
      const recentSetup = recentStats.bySetup.get(setup) ?? { wins: 0, total: 0 };
      const baselineSetup = baselineStats.bySetup.get(setup) ?? { wins: 0, total: 0 };
      const recentWinRate = recentSetup.total > 0 ? recentSetup.wins / recentSetup.total : 0;
      const baselineWinRate = baselineSetup.total > 0 ? baselineSetup.wins / baselineSetup.total : 0;
      return {
        setup,
        recentWinRate: Number(recentWinRate.toFixed(4)),
        baselineWinRate: Number(baselineWinRate.toFixed(4)),
        winRateDelta: Number((recentWinRate - baselineWinRate).toFixed(4)),
        recentSamples: recentSetup.total,
        baselineSamples: baselineSetup.total,
      };
    })
    .sort((a, b) => Math.abs(b.winRateDelta) - Math.abs(a.winRateDelta))
    .slice(0, 10);

  const snapshot: DriftSnapshot = {
    status,
    sampleRecent: recentStats.samples,
    sampleBaseline: baselineStats.samples,
    recentWinRate: Number(recentStats.winRate.toFixed(4)),
    baselineWinRate: Number(baselineStats.winRate.toFixed(4)),
    winRateDelta: Number(winRateDelta.toFixed(4)),
    recentAvgQuality: Number(recentStats.avgQuality.toFixed(4)),
    baselineAvgQuality: Number(baselineStats.avgQuality.toFixed(4)),
    qualityDelta: Number(qualityDelta.toFixed(4)),
    bySetup,
    computedAt: new Date().toISOString(),
  };

  _driftCache = { data: snapshot, ts: Date.now() };
  return snapshot;
}

export async function getModelDiagnostics(): Promise<{
  status: ReturnType<typeof getModelStatus>;
  drift: DriftSnapshot | null;
  validation: PurgedCvMetrics | null;
}> {
  const status = getModelStatus();
  let drift: DriftSnapshot | null = null;
  try {
    drift = await getModelDriftStatus();
  } catch {
    drift = null;
  }
  return {
    status,
    drift,
    validation: status.meta?.purgedCv ?? null,
  };
}

export async function retrainModel(): Promise<{ success: boolean; message: string }> {
  try {
    await trainModel();
    _driftCache = null;
    if (_modelStatus === "trained") {
      return { success: true, message: `Retrained ensemble on ${_modelMeta!.samples} samples, AUC ${_modelMeta!.auc.toFixed(3)}` };
    }
    return { success: false, message: "Not enough labeled data for training" };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}
