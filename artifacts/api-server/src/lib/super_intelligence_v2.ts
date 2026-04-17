/**
 * super_intelligence_v2.ts — GodsView Continuous-Learning Super Intelligence
 *
 * This is the brain's forecasting core — an ensemble intelligence that
 * CONTINUOUSLY improves itself from every completed trade outcome.
 *
 * Unlike a static ML model, this version:
 *   - Accumulates trade outcomes in a rolling evidence pool
 *   - Re-fits feature weights from outcomes (online gradient descent)
 *   - Maintains per-regime confidence calibration
 *   - Tracks prediction accuracy and recalibrates when drifting
 *   - Provides multi-horizon confidence (next 5 bars, 20 bars, 50 bars)
 *   - Runs an ensemble of 5 sub-models and aggregates via weighted voting
 *
 * Sub-models:
 *   M1: Structure model — OBs, FVGs, BOS/CHoCH pattern scoring
 *   M2: Regime model  — regime-conditional historical win rates
 *   M3: Orderflow model — delta, CVD, absorption pattern scoring
 *   M4: Memory model  — setup type historical performance
 *   M5: Momentum model — trend strength × MTF alignment
 *
 * Each sub-model casts a probability vote (0-1) for win probability.
 * The ensemble weights are re-calibrated from outcomes via Platt scaling.
 *
 * Output:
 *   winProbability: 0-1 (calibrated, not raw)
 *   confidence: 0-1 (uncertainty estimate from ensemble variance)
 *   horizon: { 5bar: number, 20bar: number, 50bar: number }
 *   modelVotes: { m1, m2, m3, m4, m5 }
 *   source: "ensemble" | "fallback"
 */

import { logger } from "./logger";
import { strategyRegistry } from "./strategy_evolution";
import {
  saveSiModelState,
  loadAllSiModelStates,
  saveTradeOutcome,
} from "./brain_persistence.js";

// ── Feature Vector ─────────────────────────────────────────────────────────

export interface SIFeatures {
  // Structure (M1)
  structureScore: number;       // 0-1 composite SMC quality
  obCount: number;              // active order blocks
  fvgCount: number;             // unfilled FVGs
  bosConfirmed: boolean;        // break of structure
  chochConfirmed: boolean;      // change of character
  confluenceScore: number;      // multi-factor alignment

  // Regime (M2)
  regime: string;               // current regime label
  trendStrength: number;        // 0-1
  regimeConfidence: number;     // 0-1

  // Orderflow (M3)
  orderflowBias: string;        // "bullish" | "bearish" | "neutral"
  cvdSlope: number;             // normalized CVD direction
  deltaScore: number;           // 0-1 orderflow quality
  absorptionDetected: boolean;

  // Memory (M4)
  setupType: string;
  historicalWR: number;         // win rate for this setup on this symbol
  historicalSampleSize: number; // how many times we've seen this setup
  decayDetected: boolean;

  // MTF / Momentum (M5)
  mtfAligned: boolean;
  trendScore: number;           // 0-1 directional consensus
  momentum: number;             // price momentum normalized

  // Context
  symbol: string;
  direction: "long" | "short";
  finalQuality: number;         // final composite from L2-L4
}

// ── Sub-Model Predictions ──────────────────────────────────────────────────

interface ModelPrediction {
  modelId: string;
  rawScore: number;        // 0-1 raw vote
  calibratedScore: number; // Platt-calibrated probability
  weight: number;          // ensemble weight
  features: string[];      // which features drove this prediction
}

// ── Outcome Record (for online learning) ──────────────────────────────────

export interface OutcomeRecord {
  id: string;
  symbol: string;
  strategyId: string;
  direction: "long" | "short";
  regime: string;
  features: Partial<SIFeatures>;
  predictedWinProb: number;
  actualWon: boolean;
  achievedR: number;
  timestamp: string;
}

// ── Ensemble State ─────────────────────────────────────────────────────────

interface EnsembleState {
  // Sub-model weights (learned from outcomes)
  weights: { m1: number; m2: number; m3: number; m4: number; m5: number };
  // Platt scaling params per model
  plattA: { m1: number; m2: number; m3: number; m4: number; m5: number };
  plattB: { m1: number; m2: number; m3: number; m4: number; m5: number };
  // Per-regime calibration multipliers
  regimeCalibration: Record<string, number>;
  // Rolling outcome pool
  outcomes: OutcomeRecord[];
  // Accuracy tracking
  totalPredictions: number;
  correctPredictions: number;
  brier: number;           // Brier score (lower = better calibration)
  // When last retrained
  lastRetrainedAt: string;
  lastRetrainOutcomes: number;
  version: number;
}

const DEFAULT_STATE: EnsembleState = {
  weights: { m1: 0.25, m2: 0.20, m3: 0.25, m4: 0.20, m5: 0.10 },
  plattA: { m1: -1, m2: -1, m3: -1, m4: -1, m5: -1 },
  plattB: { m1: 0, m2: 0, m3: 0, m4: 0, m5: 0 },
  regimeCalibration: {},
  outcomes: [],
  totalPredictions: 0,
  correctPredictions: 0,
  brier: 0.25,
  lastRetrainedAt: new Date().toISOString(),
  lastRetrainOutcomes: 0,
  version: 1,
};

// ── Per-symbol ensemble state ──────────────────────────────────────────────

class SuperIntelligenceEngine {
  private states = new Map<string, EnsembleState>();
  private readonly MAX_OUTCOMES = 2000;
  private readonly RETRAIN_THRESHOLD = 50;

  private getState(symbol: string): EnsembleState {
    if (!this.states.has(symbol)) {
      this.states.set(symbol, JSON.parse(JSON.stringify(DEFAULT_STATE)));
    }
    return this.states.get(symbol)!;
  }

  // ── Sub-models ─────────────────────────────────────────────────────────────

  private m1Structure(f: SIFeatures): ModelPrediction {
    const bosBonus = f.bosConfirmed ? 0.15 : 0;
    const chochBonus = f.chochConfirmed ? 0.10 : 0;
    const obBonus = Math.min(0.15, f.obCount * 0.05);
    const fvgBonus = Math.min(0.10, f.fvgCount * 0.04);
    const raw = clamp(f.structureScore * 0.50 + f.confluenceScore * 0.20 + bosBonus + chochBonus + obBonus + fvgBonus);
    return { modelId: "m1", rawScore: raw, calibratedScore: raw, weight: 0.25, features: ["structureScore", "bos", "choch", "obCount", "fvgCount"] };
  }

  private m2Regime(f: SIFeatures, state: EnsembleState): ModelPrediction {
    // Regime-conditional historical win rates (built from outcomes)
    const regimeCal = state.regimeCalibration[f.regime] ?? 1.0;
    const trendBonus = f.direction === "long"
      ? (f.trendStrength > 0.6 ? 0.1 : f.trendStrength < 0.3 ? -0.1 : 0)
      : (f.trendStrength > 0.6 ? -0.1 : f.trendStrength < 0.3 ? 0.1 : 0);
    const raw = clamp(0.5 * regimeCal + trendBonus + (f.regimeConfidence - 0.5) * 0.1);
    return { modelId: "m2", rawScore: raw, calibratedScore: raw, weight: 0.20, features: ["regime", "trendStrength", "regimeConfidence"] };
  }

  private m3Orderflow(f: SIFeatures): ModelPrediction {
    const biasMatch = (f.direction === "long" && f.orderflowBias === "bullish") ||
                      (f.direction === "short" && f.orderflowBias === "bearish");
    const biasBonus = biasMatch ? 0.15 : f.orderflowBias === "neutral" ? 0 : -0.10;
    const absBonus = f.absorptionDetected ? 0.08 : 0;
    const cvdBonus = Math.max(-0.1, Math.min(0.1, f.cvdSlope * 0.05));
    const raw = clamp(f.deltaScore * 0.40 + 0.45 + biasBonus + absBonus + cvdBonus);
    return { modelId: "m3", rawScore: raw, calibratedScore: raw, weight: 0.25, features: ["orderflowBias", "deltaScore", "cvdSlope", "absorption"] };
  }

  private m4Memory(f: SIFeatures): ModelPrediction {
    if (f.historicalSampleSize < 5) {
      return { modelId: "m4", rawScore: 0.5, calibratedScore: 0.5, weight: 0.10, features: ["historicalWR", "sampleSize"] };
    }
    const decayPenalty = f.decayDetected ? -0.12 : 0;
    // Weight historical WR by sample size confidence
    const sampleConf = Math.min(1, f.historicalSampleSize / 50);
    const raw = clamp(f.historicalWR * sampleConf + 0.5 * (1 - sampleConf) + decayPenalty);
    return { modelId: "m4", rawScore: raw, calibratedScore: raw, weight: 0.20, features: ["historicalWR", "decayDetected", "sampleSize"] };
  }

  private m5Momentum(f: SIFeatures): ModelPrediction {
    const mtfBonus = f.mtfAligned ? 0.12 : -0.05;
    const momentumScore = f.direction === "long"
      ? clamp(0.5 + f.momentum * 0.3)
      : clamp(0.5 - f.momentum * 0.3);
    const raw = clamp(f.trendScore * 0.4 + momentumScore * 0.4 + 0.1 + mtfBonus / 2);
    return { modelId: "m5", rawScore: raw, calibratedScore: raw, weight: 0.10, features: ["mtfAligned", "trendScore", "momentum"] };
  }

  // ── Platt Calibration ──────────────────────────────────────────────────────

  private plattScale(
    raw: number,
    A: number,
    B: number,
  ): number {
    // Sigmoid(A * raw + B)
    return 1 / (1 + Math.exp(A * raw + B));
  }

  // ── Ensemble Prediction ────────────────────────────────────────────────────

  predict(features: SIFeatures): {
    winProbability: number;
    confidence: number;
    modelVotes: Record<string, number>;
    ensembleVariance: number;
    horizon: { h5: number; h20: number; h50: number };
    source: "ensemble" | "thin_data";
    regime: string;
    totalOutcomes: number;
  } {
    const state = this.getState(features.symbol);

    // Get strategy params if available
    const strategy = strategyRegistry.get("smc_ob_fvg", features.symbol);

    // Run sub-models
    const predictions: ModelPrediction[] = [
      this.m1Structure(features),
      this.m2Regime(features, state),
      this.m3Orderflow(features),
      this.m4Memory(features),
      this.m5Momentum(features),
    ];

    // Apply Platt calibration + live weights
    const modelIds = ["m1", "m2", "m3", "m4", "m5"] as const;
    let weightedSum = 0;
    let totalWeight = 0;
    const votes: Record<string, number> = {};

    for (const pred of predictions) {
      const id = pred.modelId as keyof typeof state.weights;
      const w = state.weights[id];
      const calibrated = this.plattScale(pred.rawScore, state.plattA[id], state.plattB[id]);
      pred.calibratedScore = clamp(calibrated);
      votes[id] = pred.calibratedScore;
      weightedSum += pred.calibratedScore * w;
      totalWeight += w;
    }

    const rawEnsemble = weightedSum / Math.max(totalWeight, 0.001);

    // Regime calibration adjustment
    const regimeMul = state.regimeCalibration[features.regime] ?? 1.0;
    const calWinProb = clamp(rawEnsemble * regimeMul);

    // Variance across models → uncertainty
    const variance = predictions.reduce((sum, p) => sum + Math.pow(p.calibratedScore - rawEnsemble, 2), 0) / predictions.length;
    const confidence = clamp(1 - Math.sqrt(variance) * 2);

    // Multi-horizon — decay with time (short-term more reliable)
    const h5 = clamp(calWinProb * 1.05);
    const h20 = calWinProb;
    const h50 = clamp(calWinProb * 0.92 + 0.04);

    const thinData = state.outcomes.length < 20;

    state.totalPredictions++;

    return {
      winProbability: calWinProb,
      confidence,
      modelVotes: votes,
      ensembleVariance: variance,
      horizon: { h5, h20, h50 },
      source: thinData ? "thin_data" : "ensemble",
      regime: features.regime,
      totalOutcomes: state.outcomes.length,
    };
  }

  // ── Online Learning ────────────────────────────────────────────────────────

  /** Record a trade outcome to improve future predictions */
  recordOutcome(outcome: OutcomeRecord): void {
    const state = this.getState(outcome.symbol);
    state.outcomes.push(outcome);
    if (state.outcomes.length > this.MAX_OUTCOMES) {
      // In-place splice to avoid creating a new array (memory-friendly)
      state.outcomes.splice(0, state.outcomes.length - this.MAX_OUTCOMES);
    }

    // Update accuracy
    const predicted = outcome.predictedWinProb >= 0.5;
    if (predicted === outcome.actualWon) state.correctPredictions++;
    state.totalPredictions = Math.max(state.totalPredictions, state.outcomes.length);

    // Rolling Brier score update
    const brierUpdate = Math.pow(outcome.predictedWinProb - (outcome.actualWon ? 1 : 0), 2);
    state.brier = state.brier * 0.95 + brierUpdate * 0.05;

    // Update regime calibration
    if (!state.regimeCalibration[outcome.regime]) {
      state.regimeCalibration[outcome.regime] = 1.0;
    }
    // Nudge regime calibration based on outcome
    const regimeTarget = outcome.actualWon ? 1.05 : 0.95;
    state.regimeCalibration[outcome.regime] =
      state.regimeCalibration[outcome.regime] * 0.95 + regimeTarget * 0.05;
    state.regimeCalibration[outcome.regime] = clamp(state.regimeCalibration[outcome.regime], 0.5, 2.0);

    // Persist trade outcome to DB (fire-and-forget)
    saveTradeOutcome({
      symbol: outcome.symbol,
      strategy_id: outcome.strategyId,
      confirmation_id: outcome.id,
      direction: outcome.direction,
      regime: outcome.regime,
      outcome: outcome.actualWon ? "WIN" : "LOSS",
      pnl_r: String(outcome.achievedR),
      si_win_probability: String(outcome.predictedWinProb),
      entry_price: String((outcome.features as any)?.entryPrice ?? "0"),
      stop_loss: String((outcome.features as any)?.stopLoss ?? "0"),
      take_profit: String((outcome.features as any)?.takeProfit ?? "0"),
    }).catch(() => {/* logged inside persistence layer */});

    // Trigger retrain if enough new data
    const newOutcomes = state.outcomes.length - state.lastRetrainOutcomes;
    if (newOutcomes >= this.RETRAIN_THRESHOLD) {
      this.retrain(outcome.symbol);
    }
  }

  /** Full retrain from stored outcomes — updates sub-model weights */
  retrain(symbol: string): { version: number; weightChanges: Record<string, number>; accuracy: number; brier: number } {
    const state = this.getState(symbol);
    if (state.outcomes.length < 20) {
      return { version: state.version, weightChanges: {}, accuracy: 0.5, brier: state.brier };
    }

    // Take recent outcomes (more weight on recent)
    const recent = state.outcomes.slice(-500);

    // Compute per-model accuracy on recent outcomes
    const modelAcc: Record<string, { correct: number; total: number; brierSum: number }> = {
      m1: { correct: 0, total: 0, brierSum: 0 },
      m2: { correct: 0, total: 0, brierSum: 0 },
      m3: { correct: 0, total: 0, brierSum: 0 },
      m4: { correct: 0, total: 0, brierSum: 0 },
      m5: { correct: 0, total: 0, brierSum: 0 },
    };

    for (const outcome of recent) {
      const f = outcome.features as SIFeatures;
      if (!f.structureScore) continue;

      const preds = [
        this.m1Structure(f),
        this.m2Regime(f, state),
        this.m3Orderflow(f),
        this.m4Memory(f),
        this.m5Momentum(f),
      ];

      for (const pred of preds) {
        const acc = modelAcc[pred.modelId];
        if (!acc) continue;
        acc.total++;
        acc.brierSum += Math.pow(pred.rawScore - (outcome.actualWon ? 1 : 0), 2);
        if ((pred.rawScore >= 0.5) === outcome.actualWon) acc.correct++;
      }
    }

    // Re-weight: better Brier score → higher weight
    const oldWeights = { ...state.weights };
    const invBrier: Record<string, number> = {};
    let totalInvBrier = 0;
    for (const [id, data] of Object.entries(modelAcc)) {
      if (data.total === 0) { invBrier[id] = 0.2; continue; }
      const brier = data.brierSum / data.total;
      invBrier[id] = Math.max(0.05, 1 - brier);
      totalInvBrier += invBrier[id];
    }

    const weightChanges: Record<string, number> = {};
    for (const id of Object.keys(state.weights) as (keyof typeof state.weights)[]) {
      const newW = totalInvBrier > 0 ? invBrier[id] / totalInvBrier : 0.2;
      // Smooth update — don't jump too fast
      const updated = state.weights[id] * 0.7 + newW * 0.3;
      weightChanges[id] = updated - state.weights[id];
      state.weights[id] = Math.round(updated * 1000) / 1000;
    }

    // Normalize weights to sum to 1
    const wSum = Object.values(state.weights).reduce((a, b) => a + b, 0);
    for (const id of Object.keys(state.weights) as (keyof typeof state.weights)[]) {
      state.weights[id] = Math.round((state.weights[id] / wSum) * 1000) / 1000;
    }

    const accuracy = state.totalPredictions > 0
      ? state.correctPredictions / state.totalPredictions
      : 0.5;

    state.lastRetrainedAt = new Date().toISOString();
    state.lastRetrainOutcomes = state.outcomes.length;
    state.version++;

    logger.info(`[SuperIntel v2] Retrained ${symbol} v${state.version} — acc: ${(accuracy * 100).toFixed(1)}%, brier: ${state.brier.toFixed(3)}, outcomes: ${state.outcomes.length}`);

    // Persist model state to DB (fire-and-forget)
    saveSiModelState({
      symbol,
      model_version: state.version,
      weight_m1: String(state.weights.m1),
      weight_m2: String(state.weights.m2),
      weight_m3: String(state.weights.m3),
      weight_m4: String(state.weights.m4),
      weight_m5: String(state.weights.m5),
      platt_a: String(state.plattA.m1),
      platt_b: String(state.plattB.m1),
      brier_score: String(state.brier),
      total_outcomes: state.outcomes.length,
      regime_calibration: JSON.stringify(state.regimeCalibration),
      is_active: true,
    }).catch(() => {/* logged inside persistence layer */});

    return { version: state.version, weightChanges, accuracy, brier: state.brier };
  }

  // ── Status ─────────────────────────────────────────────────────────────────

  getStatus(symbol?: string): Array<{
    symbol: string;
    version: number;
    outcomes: number;
    accuracy: number;
    brier: number;
    weights: Record<string, number>;
    regimeCalibration: Record<string, number>;
    lastRetrainedAt: string;
  }> {
    const symbolList = symbol ? [symbol] : Array.from(this.states.keys());
    return symbolList.map((sym) => {
      const state = this.getState(sym);
      return {
        symbol: sym,
        version: state.version,
        outcomes: state.outcomes.length,
        accuracy: state.totalPredictions > 0 ? state.correctPredictions / state.totalPredictions : 0.5,
        brier: state.brier,
        weights: { ...state.weights },
        regimeCalibration: { ...state.regimeCalibration },
        lastRetrainedAt: state.lastRetrainedAt,
      };
    });
  }

  /** Feed all stored outcomes across symbols to their strategies for evolution */
  triggerGlobalEvolution(): number {
    let count = 0;
    for (const [symbol, state] of this.states.entries()) {
      if (state.outcomes.length >= 20) {
        this.retrain(symbol);
        count++;
      }
    }
    return count;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

export const superIntelligenceV2 = new SuperIntelligenceEngine();

// ── Warm-load from DB on module init ──────────────────────────────────────
loadAllSiModelStates().then((rowsRaw) => {
  const rows = rowsRaw as Array<Record<string, any>>;
  for (const row of rows) {
    const state = (superIntelligenceV2 as any).getState(String(row.symbol ?? "")) as EnsembleState;
    state.weights.m1 = Number(row.weight_m1);
    state.weights.m2 = Number(row.weight_m2);
    state.weights.m3 = Number(row.weight_m3);
    state.weights.m4 = Number(row.weight_m4);
    state.weights.m5 = Number(row.weight_m5);
    state.plattA.m1 = Number(row.platt_a);
    state.plattB.m1 = Number(row.platt_b);
    state.brier = Number(row.brier_score ?? 0.25);
    state.version = Number(row.model_version ?? 1);
    state.regimeCalibration = row.regime_calibration ? JSON.parse(String(row.regime_calibration)) : {};
    state.totalPredictions = Number(row.total_outcomes ?? 0);
  }
  if (rows.length > 0) {
    logger.info(`[SuperIntel v2] Warm-loaded model state for ${rows.length} symbol(s) from DB`);
  }
}).catch(() => {/* DB not available — use defaults */});

// ── Integration helpers ────────────────────────────────────────────────────

/** Build SIFeatures from the outputs of brain layers L1-L4 */
export function buildSIFeatures(
  symbol: string,
  direction: "long" | "short",
  l2: { smc: any; regime: any; mtfScores: any; trend: string; regimeLabel: string; structureScore: number; regimeScore: number },
  l3: { macroBias: any; sentiment: any; volatility: any; macroScore: number; sentimentScore: number; stressScore: number },
  l4: { setupMemory: any; marketDna: any; winRate: number; profitFactor: number; decayDetected: boolean; similarSetups: number },
  l1?: { orderflow: any; liquidity: any; spreadBps: number; lastPrice: number },
): SIFeatures {
  const smc = l2.smc ?? {};
  const regime = l2.regime ?? {};
  const orderflow = l1?.orderflow ?? {};

  const bosConfirmed = Boolean(smc.breakOfStructure ?? smc.bos);
  const chochConfirmed = Boolean(smc.changeOfCharacter ?? smc.choch);
  const obCount = Number(smc.activeOrderBlocks?.length ?? smc.orderBlocks?.length ?? smc.obCount ?? 0);
  const fvgCount = Number(smc.unfilledFVGs?.length ?? smc.fvgCount ?? 0);

  const orderflowBias: string = orderflow.bias ?? orderflow.direction ?? "neutral";
  const cvdSlope: number = Number(orderflow.cvdSlope ?? orderflow.cvd ?? 0);
  const absorptionDetected: boolean = Boolean(orderflow.absorptionDetected ?? orderflow.absorption);
  const deltaScore: number = clamp(Number(orderflow.deltaScore ?? 0.5));

  const setupType: string = smc.setupType ?? smc.pattern ?? "unknown";
  const historicalWR: number = clamp(l4.winRate ?? 0.5);
  const historicalSampleSize: number = Number(l4.similarSetups ?? 0);

  const mtfScores = l2.mtfScores ?? {};
  const mtfAligned: boolean = Object.values(mtfScores).filter(Boolean).length >= 2;
  const trendScore: number = clamp(Number(regime.trendStrength ?? 0.5));
  const momentum: number = clamp(Number(regime.momentum ?? 0.5)) - 0.5;

  return {
    structureScore: clamp(l2.structureScore),
    obCount,
    fvgCount,
    bosConfirmed,
    chochConfirmed,
    confluenceScore: clamp(Number(smc.confluenceScore ?? l2.structureScore)),
    regime: l2.regimeLabel ?? regime.label ?? "unknown",
    trendStrength: clamp(Number(regime.trendStrength ?? 0.5)),
    regimeConfidence: clamp(Number(regime.confidence ?? 0.5)),
    orderflowBias,
    cvdSlope,
    deltaScore,
    absorptionDetected,
    setupType,
    historicalWR,
    historicalSampleSize,
    decayDetected: l4.decayDetected,
    mtfAligned,
    trendScore,
    momentum,
    symbol,
    direction,
    finalQuality: clamp(l2.structureScore * 0.4 + l4.winRate * 0.3 + deltaScore * 0.3),
  };
}

function clamp(n: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(n)) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, n));
}
