/**
 * ML Model Layer — Logistic Regression trained on accuracy_results data.
 *
 * Replaces the heuristic stub (0.55 + recall * 0.25) with a real
 * learned probability of win, trained at server startup from the
 * accuracy_results table (136k+ labeled records).
 *
 * Architecture:
 *   - Feature vector: [structure_score, order_flow_score, recall_score,
 *                       regime_enc, setup_enc, final_quality]
 *   - Target: outcome === "win" → 1, "loss" → 0
 *   - Method: L2-regularized logistic regression (SGD-trained)
 *   - Inference: <1ms per prediction (pure math, no external deps)
 */

import { db, accuracyResultsTable } from "@workspace/db";
import { eq, sql, and, isNotNull, or } from "drizzle-orm";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface MLPrediction {
  probability: number;   // 0.0 – 1.0 win probability
  confidence: number;    // model confidence (calibration quality)
  source: "trained" | "heuristic";
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

// ── Feature Engineering ────────────────────────────────────────────────────────

const SETUP_TYPES = ["absorption_reversal", "sweep_reclaim", "continuation_pullback", "cvd_divergence", "breakout_failure"] as const;
const REGIMES = ["trending_bull", "trending_bear", "ranging", "volatile", "chop"] as const;

function oneHotSetup(setup: string): number[] {
  return SETUP_TYPES.map(s => s === setup ? 1 : 0);
}

function oneHotRegime(regime: string): number[] {
  return REGIMES.map(r => r === regime ? 1 : 0);
}

function featurize(row: {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  final_quality: number;
  setup_type: string;
  regime: string;
  direction?: string;
}): number[] {
  const base = [
    row.structure_score,
    row.order_flow_score,
    row.recall_score,
    row.final_quality,
    row.structure_score * row.order_flow_score,          // interaction: structure × flow
    row.recall_score * row.structure_score,               // interaction: recall × structure
    Math.abs(row.structure_score - row.order_flow_score), // disagreement signal
    row.direction === "long" ? 1 : 0,
  ];
  return [...base, ...oneHotSetup(row.setup_type), ...oneHotRegime(row.regime)];
}

const FEATURE_DIM = 8 + SETUP_TYPES.length + REGIMES.length; // 8 + 5 + 5 = 18

// ── Logistic Regression ────────────────────────────────────────────────────────

function sigmoid(x: number): number {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
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
   * Train with mini-batch SGD + L2 regularization.
   * Shuffles data each epoch for better convergence.
   */
  train(X: number[][], y: number[], options: {
    epochs?: number;
    lr?: number;
    lambda?: number;  // L2 reg strength
    batchSize?: number;
  } = {}): void {
    const { epochs = 50, lr = 0.01, lambda = 0.001, batchSize = 64 } = options;
    const n = X.length;
    if (n === 0) return;

    // Initialize weights with small random values
    for (let i = 0; i < this.weights.length; i++) {
      this.weights[i] = (Math.random() - 0.5) * 0.01;
    }
    this.bias = 0;

    // Shuffle indices
    const indices = Array.from({ length: n }, (_, i) => i);

    for (let epoch = 0; epoch < epochs; epoch++) {
      // Fisher-Yates shuffle
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }

      // Decay learning rate
      const currentLr = lr / (1 + epoch * 0.02);

      // Mini-batch gradient descent
      for (let batch = 0; batch < n; batch += batchSize) {
        const end = Math.min(batch + batchSize, n);
        const batchLen = end - batch;

        const gradW = new Float64Array(this.weights.length);
        let gradB = 0;

        for (let b = batch; b < end; b++) {
          const idx = indices[b];
          const pred = this.predict(X[idx]);
          const error = pred - y[idx];

          for (let j = 0; j < this.weights.length; j++) {
            gradW[j] += error * (X[idx][j] ?? 0);
          }
          gradB += error;
        }

        // Update weights with L2 regularization
        for (let j = 0; j < this.weights.length; j++) {
          this.weights[j] -= currentLr * (gradW[j] / batchLen + lambda * this.weights[j]);
        }
        this.bias -= currentLr * (gradB / batchLen);
      }
    }

    this.trained = true;
    this.trainingSamples = n;

    // Compute training accuracy + AUC
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

/**
 * Compute AUC-ROC from predictions.
 */
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
    auc += (fpr - prevFPR) * (tpr + prevTPR) / 2; // trapezoidal rule
    prevFPR = fpr;
    prevTPR = tpr;
  }

  return auc;
}

// ── Global Model Instance ──────────────────────────────────────────────────────

let _model: LogisticRegression | null = null;
let _modelStatus: "untrained" | "training" | "trained" | "error" = "untrained";
let _modelMeta: {
  samples: number;
  accuracy: number;
  auc: number;
  winRate: number;
  trainedAt: string;
} | null = null;

/**
 * Train the ML model from accuracy_results in the database.
 * Called once at server startup. Safe to call multiple times
 * (subsequent calls retrain with latest data).
 */
export async function trainModel(): Promise<void> {
  _modelStatus = "training";
  console.log("[ml] Training ML model from accuracy_results...");

  try {
    // Fetch labeled training data (win/loss only, skip "open")
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
      console.log(`[ml] Only ${rows.length} labeled samples — need ≥50. Keeping heuristic fallback.`);
      _modelStatus = "untrained";
      return;
    }

    const wins = rows.filter((r: RawTrainingRow) => r.outcome === "win").length;
    const losses = rows.filter((r: RawTrainingRow) => r.outcome === "loss").length;
    const winRate = wins / (wins + losses);
    console.log(`[ml] Training data: ${rows.length} samples (${wins} wins, ${losses} losses, ${(winRate * 100).toFixed(1)}% win rate)`);

    // Build feature matrix
    const X: number[][] = [];
    const y: number[] = [];

    for (const row of rows) {
      const features = featurize({
        structure_score: parseFloat(String(row.structure_score ?? "0")),
        order_flow_score: parseFloat(String(row.order_flow_score ?? "0")),
        recall_score: parseFloat(String(row.recall_score ?? "0")),
        final_quality: parseFloat(String(row.final_quality ?? "0")),
        setup_type: row.setup_type ?? "absorption_reversal",
        regime: row.regime ?? "ranging",
        direction: row.direction ?? "long",
      });
      X.push(features);
      y.push(row.outcome === "win" ? 1 : 0);
    }

    // Train model
    const model = new LogisticRegression(FEATURE_DIM);
    model.train(X, y, {
      epochs: 80,
      lr: 0.015,
      lambda: 0.0005,
      batchSize: 128,
    });

    _model = model;
    _modelStatus = "trained";
    _modelMeta = {
      samples: rows.length,
      accuracy: model.accuracy,
      auc: model.auc,
      winRate,
      trainedAt: new Date().toISOString(),
    };

    console.log(`[ml] Model trained successfully:`);
    console.log(`[ml]   Samples: ${rows.length}`);
    console.log(`[ml]   Accuracy: ${(model.accuracy * 100).toFixed(1)}%`);
    console.log(`[ml]   AUC-ROC: ${model.auc.toFixed(3)}`);
    console.log(`[ml]   Win rate baseline: ${(winRate * 100).toFixed(1)}%`);
  } catch (err) {
    console.error("[ml] Training failed:", err);
    _modelStatus = "error";
  }
}

/**
 * Predict win probability for a signal.
 * Falls back to heuristic if model is not trained.
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
  if (_model?.trained) {
    const features = featurize(input);
    const probability = _model.predict(features);
    return {
      probability: Math.max(0.01, Math.min(0.99, probability)),
      confidence: _model.auc,
      source: "trained",
    };
  }

  // Heuristic fallback (original stub)
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
    case "trained":
      return {
        status: "active",
        message: `Trained on ${_modelMeta!.samples} samples · AUC ${_modelMeta!.auc.toFixed(2)} · Accuracy ${(_modelMeta!.accuracy * 100).toFixed(0)}%`,
        meta: _modelMeta,
      };
    case "training":
      return {
        status: "warning",
        message: "Model training in progress…",
        meta: null,
      };
    case "error":
      return {
        status: "error",
        message: "Model training failed — using heuristic fallback",
        meta: null,
      };
    default:
      return {
        status: "warning",
        message: "ML layer using heuristic scoring — train a model to upgrade",
        meta: null,
      };
  }
}

/**
 * Retrain the model (e.g., after new backtest data is added).
 */
export async function retrainModel(): Promise<{ success: boolean; message: string }> {
  try {
    await trainModel();
    if (_modelStatus === "trained") {
      return { success: true, message: `Retrained on ${_modelMeta!.samples} samples, AUC ${_modelMeta!.auc.toFixed(3)}` };
    }
    return { success: false, message: "Not enough labeled data for training" };
  } catch (err) {
    return { success: false, message: String(err) };
  }
}
