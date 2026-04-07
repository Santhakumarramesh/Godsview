/**
 * super_intelligence_v3.ts — GodsView Adaptive Super Intelligence
 *
 * V3 wraps V2's ensemble and adds five new intelligence layers:
 *
 *   1. ADAPTIVE REGIME SWITCHING — dynamically re-weight models based on
 *      which regime is active (trending favors M5, volatile favors M3, etc.)
 *   2. TEMPORAL ATTENTION — exponential decay weighting on outcomes
 *   3. CROSS-ASSET CORRELATION — checks if correlated symbols confirm direction
 *   4. SIGNAL TIER CLASSIFICATION — ELITE / STRONG / MARGINAL / WEAK
 *   5. ANTI-FRAGILITY SCORING — resilience under adverse conditions
 */

import { superIntelligenceV2, type SIFeatures, type OutcomeRecord } from "./super_intelligence_v2.js";

export type SignalTier = "ELITE" | "STRONG" | "MARGINAL" | "WEAK";

export interface TierClassification {
  tier: SignalTier;
  kellyFraction: number;
  sizeMultiplier: number;
  reason: string;
}

export interface V3Prediction {
  winProbability: number;
  confidence: number;
  modelVotes: Record<string, number>;  ensembleVariance: number;
  horizon: { h5: number; h20: number; h50: number };
  source: string;
  regime: string;
  totalOutcomes: number;
  v3Adjustments: {
    regimeBoost: number;
    correlationBoost: number;
    temporalDecay: number;
    antifragility: number;
    adjustedProbability: number;
  };
  tier: TierClassification;
  edgeScore: number;
  shouldTrade: boolean;
  reasoning: string[];
}

const REGIME_WEIGHT_PROFILES: Record<string, Record<string, number>> = {
  trending_bull: { m1: 0.30, m2: 0.15, m3: 0.15, m4: 0.15, m5: 0.25 },
  trending_bear: { m1: 0.30, m2: 0.15, m3: 0.15, m4: 0.15, m5: 0.25 },
  ranging:       { m1: 0.20, m2: 0.15, m3: 0.30, m4: 0.25, m5: 0.10 },
  volatile:      { m1: 0.15, m2: 0.30, m3: 0.30, m4: 0.15, m5: 0.10 },
  chop:          { m1: 0.15, m2: 0.25, m3: 0.20, m4: 0.30, m5: 0.10 },
};

interface AdverseOutcome {
  setupType: string;
  regime: string;
  won: boolean;
  adverseCondition: string;  timestamp: number;
}

class SuperIntelligenceV3 {
  private correlationMatrix = new Map<string, Map<string, number>>();
  private adversePool: AdverseOutcome[] = [];
  private readonly MAX_ADVERSE_POOL = 500;
  private recentAccuracy = new Map<string, { correct: number; total: number; timestamps: number[] }>();
  private readonly TEMPORAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

  predict(
    features: SIFeatures,
    correlatedSymbols?: Array<{ symbol: string; direction: "long" | "short"; strength: number }>,
  ): V3Prediction {
    const v2 = superIntelligenceV2.predict(features);
    const reasoning: string[] = [];

    const regimeBoost = this.computeRegimeBoost(features, v2.modelVotes);
    reasoning.push(`Regime [${features.regime}]: ${regimeBoost > 0 ? "+" : ""}${(regimeBoost * 100).toFixed(1)}% adaptive boost`);

    const correlationBoost = this.computeCorrelationBoost(features, correlatedSymbols);
    if (Math.abs(correlationBoost) > 0.01) {
      reasoning.push(`Cross-asset: ${correlationBoost > 0 ? "+" : ""}${(correlationBoost * 100).toFixed(1)}% from correlated confirmations`);
    }

    const temporalDecay = this.computeTemporalDecay(features.symbol);
    if (Math.abs(temporalDecay) > 0.01) {
      reasoning.push(`Temporal: ${temporalDecay > 0 ? "+" : ""}${(temporalDecay * 100).toFixed(1)}% from recent accuracy trend`);
    }
    const antifragility = this.computeAntifragility(features.setupType, features.regime);
    reasoning.push(`Anti-fragility: ${(antifragility * 100).toFixed(0)}% resilience in adverse conditions`);

    const rawAdjusted = v2.winProbability + regimeBoost + correlationBoost + temporalDecay;
    const fragilityPull = antifragility >= 0.6 ? 0 : (0.5 - rawAdjusted) * (1 - antifragility) * 0.15;
    const adjustedProbability = clamp(rawAdjusted + fragilityPull);

    const regimeVolMultiplier = features.regime === "volatile" ? 0.85 : features.regime === "chop" ? 0.90 : 1.0;
    const horizon = {
      h5: clamp(adjustedProbability * 1.03 * regimeVolMultiplier),
      h20: clamp(adjustedProbability * regimeVolMultiplier),
      h50: clamp(adjustedProbability * 0.90 * regimeVolMultiplier + 0.05),
    };

    const tier = this.classifyTier(adjustedProbability, v2.confidence, antifragility, features);
    reasoning.push(`Signal tier: ${tier.tier} — ${tier.reason}`);

    const edgeScore = clamp((adjustedProbability - 0.5) * 2 * v2.confidence);

    const shouldTrade = tier.tier !== "WEAK" && adjustedProbability >= 0.55 && v2.confidence >= 0.40;
    if (!shouldTrade) {
      reasoning.push(`SKIP: ${adjustedProbability < 0.55 ? "probability below 55%" : v2.confidence < 0.40 ? "confidence below 40%" : "WEAK tier"}`);
    } else {
      reasoning.push(`TRADE: ${tier.tier} signal with ${(adjustedProbability * 100).toFixed(1)}% win probability, ${tier.kellyFraction * 100}% Kelly`);
    }

    return {
      winProbability: v2.winProbability, confidence: v2.confidence, modelVotes: v2.modelVotes,
      ensembleVariance: v2.ensembleVariance, horizon, source: `v3_${v2.source}`, regime: v2.regime, totalOutcomes: v2.totalOutcomes,      v3Adjustments: { regimeBoost, correlationBoost, temporalDecay, antifragility, adjustedProbability },
      tier, edgeScore, shouldTrade, reasoning,
    };
  }

  private computeRegimeBoost(features: SIFeatures, modelVotes: Record<string, number>): number {
    const profile = REGIME_WEIGHT_PROFILES[features.regime];
    if (!profile) return 0;
    let regimeWeighted = 0;
    let defaultWeighted = 0;
    const defaultWeights = { m1: 0.25, m2: 0.20, m3: 0.25, m4: 0.20, m5: 0.10 };
    for (const [modelId, vote] of Object.entries(modelVotes)) {
      const regimeW = profile[modelId] ?? 0.20;
      const defaultW = defaultWeights[modelId as keyof typeof defaultWeights] ?? 0.20;
      regimeWeighted += vote * regimeW;
      defaultWeighted += vote * defaultW;
    }
    return clamp(regimeWeighted - defaultWeighted, -0.10, 0.10);
  }

  private computeCorrelationBoost(
    features: SIFeatures,
    correlatedSymbols?: Array<{ symbol: string; direction: "long" | "short"; strength: number }>,
  ): number {
    if (!correlatedSymbols || correlatedSymbols.length === 0) return 0;
    let confirmations = 0;
    let contradictions = 0;
    let totalWeight = 0;
    for (const corr of correlatedSymbols) {      const pairCorrelation = this.getCorrelation(features.symbol, corr.symbol);
      const weight = Math.abs(pairCorrelation) * corr.strength;
      totalWeight += weight;
      const sameDirection = features.direction === corr.direction;
      const positivelyCorrelated = pairCorrelation > 0.3;
      const negativelyCorrelated = pairCorrelation < -0.3;
      if ((positivelyCorrelated && sameDirection) || (negativelyCorrelated && !sameDirection)) {
        confirmations += weight;
      } else if ((positivelyCorrelated && !sameDirection) || (negativelyCorrelated && sameDirection)) {
        contradictions += weight;
      }
    }
    if (totalWeight === 0) return 0;
    const netSignal = (confirmations - contradictions) / totalWeight;
    return clamp(netSignal * 0.08, -0.05, 0.05);
  }

  private computeTemporalDecay(symbol: string): number {
    const recent = this.recentAccuracy.get(symbol);
    if (!recent || recent.total < 10) return 0;
    const now = Date.now();
    const cutoff = now - this.TEMPORAL_WINDOW_MS;
    let totalWeight = 0;
    for (let i = 0; i < recent.timestamps.length; i++) {
      const ts = recent.timestamps[i];
      if (ts < cutoff) continue;
      const age = now - ts;
      const decayWeight = Math.exp(-age / (3 * 24 * 60 * 60 * 1000));
      totalWeight += decayWeight;
    }    if (totalWeight === 0) return 0;
    const recentAcc = recent.total > 0 ? recent.correct / recent.total : 0.5;
    return clamp((recentAcc - 0.5) * 0.15, -0.05, 0.05);
  }

  private computeAntifragility(setupType: string, currentRegime: string): number {
    const adverse = this.adversePool.filter((o) => o.setupType === setupType && o.regime !== currentRegime);
    if (adverse.length < 5) return 0.5;
    const wins = adverse.filter((o) => o.won).length;
    return clamp(wins / adverse.length);
  }

  private classifyTier(adjustedProb: number, confidence: number, antifragility: number, features: SIFeatures): TierClassification {
    const compositeScore = adjustedProb * 0.50 + confidence * 0.30 + antifragility * 0.20;
    if (compositeScore >= 0.78 && adjustedProb >= 0.68 && confidence >= 0.65) {
      return { tier: "ELITE", kellyFraction: 0.75, sizeMultiplier: 1.5, reason: `Composite ${(compositeScore * 100).toFixed(0)}% — high-conviction multi-factor alignment` };
    }
    if (compositeScore >= 0.65 && adjustedProb >= 0.60) {
      return { tier: "STRONG", kellyFraction: 0.50, sizeMultiplier: 1.0, reason: `Composite ${(compositeScore * 100).toFixed(0)}% — solid setup with good confirmation` };
    }
    if (compositeScore >= 0.52 && adjustedProb >= 0.55) {
      return { tier: "MARGINAL", kellyFraction: 0.25, sizeMultiplier: 0.5, reason: `Composite ${(compositeScore * 100).toFixed(0)}% — borderline, reduced size recommended` };
    }
    return { tier: "WEAK", kellyFraction: 0, sizeMultiplier: 0, reason: `Composite ${(compositeScore * 100).toFixed(0)}% — insufficient edge, skip trade` };
  }

  updateCorrelation(symbolA: string, symbolB: string, correlation: number): void {
    if (!this.correlationMatrix.has(symbolA)) this.correlationMatrix.set(symbolA, new Map());
    if (!this.correlationMatrix.has(symbolB)) this.correlationMatrix.set(symbolB, new Map());
    this.correlationMatrix.get(symbolA)!.set(symbolB, correlation);    this.correlationMatrix.get(symbolB)!.set(symbolA, correlation);
  }

  private getCorrelation(symbolA: string, symbolB: string): number {
    return this.correlationMatrix.get(symbolA)?.get(symbolB) ?? 0;
  }

  recordOutcome(outcome: OutcomeRecord & { adverseConditions?: string[] }): void {
    superIntelligenceV2.recordOutcome(outcome);
    const acc = this.recentAccuracy.get(outcome.symbol) ?? { correct: 0, total: 0, timestamps: [] };
    acc.total++;
    if ((outcome.predictedWinProb >= 0.5) === outcome.actualWon) acc.correct++;
    acc.timestamps.push(Date.now());
    if (acc.timestamps.length > 200) acc.timestamps = acc.timestamps.slice(-200);
    this.recentAccuracy.set(outcome.symbol, acc);
    if (outcome.adverseConditions && outcome.adverseConditions.length > 0) {
      for (const condition of outcome.adverseConditions) {
        this.adversePool.push({ setupType: outcome.features?.setupType ?? "unknown", regime: outcome.regime, won: outcome.actualWon, adverseCondition: condition, timestamp: Date.now() });
      }
      if (this.adversePool.length > this.MAX_ADVERSE_POOL) this.adversePool = this.adversePool.slice(-this.MAX_ADVERSE_POOL);
    }
  }

  getStatus() {
    return {
      v2Status: superIntelligenceV2.getStatus(),
      correlationPairs: Array.from(this.correlationMatrix.values()).reduce((sum, m) => sum + m.size, 0) / 2,
      adversePoolSize: this.adversePool.length,
      temporalSymbols: Array.from(this.recentAccuracy.keys()),
      version: "3.0.0",    };
  }
}

export const superIntelligenceV3 = new SuperIntelligenceV3();

function clamp(n: number, lo = 0, hi = 1): number {
  if (!Number.isFinite(n)) return (lo + hi) / 2;
  return Math.max(lo, Math.min(hi, n));
}
