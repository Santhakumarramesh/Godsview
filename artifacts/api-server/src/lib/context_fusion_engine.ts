/**
 * context_fusion_engine.ts — Context Fusion Intelligence Layer
 *
 * Combines macro bias, sentiment, event risk, and regime context into a single
 * trade-quality modifier that gates and adjusts execution decisions.
 *
 * The fusion score is [0, 1]:
 *   ≥ 0.70 = FAVORABLE (green light, potential size boost)
 *   0.50–0.69 = NEUTRAL (no modification)
 *   0.30–0.49 = CAUTIOUS (size reduction, tighter stops)
 *   < 0.30 = HOSTILE (block or heavily reduce)
 *
 * Env overrides:
 *   CONTEXT_FUSION_BLOCK_THRESHOLD  — below this, block execution (default 0.25)
 *   CONTEXT_FUSION_REDUCE_THRESHOLD — below this, reduce size (default 0.45)
 *   CONTEXT_FUSION_BOOST_THRESHOLD  — above this, allow size boost (default 0.72)
 *   CONTEXT_FUSION_CACHE_TTL_MS     — cache TTL (default 30000)
 *   CONTEXT_FUSION_ENABLED          — master switch (default true)
 */

import { logger } from "./logger.js";
import { MacroContextService, type MacroContext } from "./macro_context_service.js";
import { getMacroContext as getMacroEngineContext, type MacroContext as MacroEngineContext } from "./macro_engine.js";
import { computeSentiment, neutralSentiment, type SentimentResult, type SentimentInput } from "./sentiment_engine.js";
import { computeMacroBias, type MacroBiasResult, type MacroBiasInput } from "./macro_bias_engine.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContextLevel = "FAVORABLE" | "NEUTRAL" | "CAUTIOUS" | "HOSTILE";

export interface EventRiskAssessment {
  hasHighImpactUpcoming: boolean;
  highImpactCount: number;
  lockoutActive: boolean;
  lockoutReason: string | null;
  overallEventSentiment: number; // -1 to 1
  riskLevel: string;
}

export interface ContextFusionResult {
  fusionScore: number;
  level: ContextLevel;
  sizeMultiplier: number;
  blocked: boolean;
  blockReason: string | null;
  components: {
    macroBiasScore: number;
    macroBiasDirection: string;
    macroBiasConviction: string;
    macroBiasAligned: boolean;
    sentimentScore: number;
    sentimentCrowding: string;
    sentimentAligned: boolean;
    eventRiskScore: number;
    eventLockout: boolean;
    highImpactEvents: number;
    regimeScore: number;
    regimeLabel: string;
  };
  reasons: string[];
  evaluatedAt: string;
}

export interface ContextFusionInput {
  symbol: string;
  direction: "long" | "short";
  regime?: string;
  assetClass?: "crypto" | "forex" | "equity" | "commodity";
}

export interface ContextFusionSnapshot {
  enabled: boolean;
  blockThreshold: number;
  reduceThreshold: number;
  boostThreshold: number;
  cacheTtlMs: number;
  cacheSize: number;
  totalEvaluations: number;
  blockedCount: number;
  reducedCount: number;
  boostedCount: number;
  lastEvaluation: ContextFusionResult | null;
  lastEvaluatedAt: string | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const BLOCK_THRESHOLD = parseFloat(process.env.CONTEXT_FUSION_BLOCK_THRESHOLD ?? "0.25");
const REDUCE_THRESHOLD = parseFloat(process.env.CONTEXT_FUSION_REDUCE_THRESHOLD ?? "0.45");
const BOOST_THRESHOLD = parseFloat(process.env.CONTEXT_FUSION_BOOST_THRESHOLD ?? "0.72");
const CACHE_TTL_MS = parseInt(process.env.CONTEXT_FUSION_CACHE_TTL_MS ?? "30000", 10);
const ENABLED = (process.env.CONTEXT_FUSION_ENABLED ?? "true") !== "false";

// ─── Fusion weights ───────────────────────────────────────────────────────────

const WEIGHTS = {
  macro: 0.30,
  sentiment: 0.20,
  eventRisk: 0.25,
  regime: 0.25,
};

// ─── Regime scoring ───────────────────────────────────────────────────────────

const REGIME_SCORES: Record<string, number> = {
  TRENDING: 0.90,
  HIGH_MOMENTUM: 0.88,
  BREAKOUT: 0.85,
  UPTREND: 0.85,
  DOWNTREND: 0.80,
  MEAN_REVERSION: 0.70,
  RANGE_BOUND: 0.65,
  RANGING: 0.60,
  LOW_VOLATILITY: 0.55,
  COMPRESSION: 0.55,
  SQUEEZE: 0.60,
  VOLATILE: 0.40,
  HIGH_VOLATILITY: 0.35,
  CHOPPY: 0.30,
  UNCERTAIN: 0.35,
  MIXED: 0.40,
};

// ─── State ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: ContextFusionResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
let totalEvaluations = 0;
let blockedCount = 0;
let reducedCount = 0;
let boostedCount = 0;
let lastEvaluation: ContextFusionResult | null = null;
let lastEvaluatedAt: string | null = null;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function cacheKey(input: ContextFusionInput): string {
  return `${input.symbol}:${input.direction}:${input.regime ?? "UNKNOWN"}`;
}

function classifyLevel(score: number): ContextLevel {
  if (score >= 0.70) return "FAVORABLE";
  if (score >= 0.50) return "NEUTRAL";
  if (score >= 0.30) return "CAUTIOUS";
  return "HOSTILE";
}

function computeSizeMultiplier(score: number, level: ContextLevel): number {
  if (score >= BOOST_THRESHOLD) return clamp(1.0 + (score - BOOST_THRESHOLD) * 0.5, 1.0, 1.15);
  if (score < BLOCK_THRESHOLD) return 0;
  if (score < REDUCE_THRESHOLD) return clamp(0.4 + (score - BLOCK_THRESHOLD) / (REDUCE_THRESHOLD - BLOCK_THRESHOLD) * 0.35, 0.4, 0.75);
  return 1.0;
}

// ─── Event Risk Assessment ────────────────────────────────────────────────────

function assessEventRisk(): EventRiskAssessment {
  try {
    const ctx: MacroEngineContext = getMacroEngineContext();
    return {
      hasHighImpactUpcoming: ctx.high_impact_upcoming.length > 0,
      highImpactCount: ctx.high_impact_upcoming.length,
      lockoutActive: ctx.lockout_active,
      lockoutReason: ctx.lockout_reason,
      overallEventSentiment: ctx.overall_sentiment,
      riskLevel: ctx.risk_level,
    };
  } catch {
    return {
      hasHighImpactUpcoming: false,
      highImpactCount: 0,
      lockoutActive: false,
      lockoutReason: null,
      overallEventSentiment: 0,
      riskLevel: "low",
    };
  }
}

function eventRiskToScore(assessment: EventRiskAssessment): number {
  if (assessment.lockoutActive) return 0.10;
  let score = 0.80;
  if (assessment.riskLevel === "extreme") score -= 0.45;
  else if (assessment.riskLevel === "elevated") score -= 0.25;
  else if (assessment.riskLevel === "moderate") score -= 0.10;
  score -= assessment.highImpactCount * 0.08;
  // Sentiment modifier: negative event sentiment reduces score
  score += assessment.overallEventSentiment * 0.10;
  return clamp(score, 0, 1);
}

// ─── Core Fusion ──────────────────────────────────────────────────────────────

export async function evaluateContextFusion(input: ContextFusionInput): Promise<ContextFusionResult> {
  if (!ENABLED) {
    const bypass: ContextFusionResult = {
      fusionScore: 0.60,
      level: "NEUTRAL",
      sizeMultiplier: 1.0,
      blocked: false,
      blockReason: null,
      components: {
        macroBiasScore: 0.5, macroBiasDirection: "flat", macroBiasConviction: "low",
        macroBiasAligned: true, sentimentScore: 0.5, sentimentCrowding: "low",
        sentimentAligned: true, eventRiskScore: 0.8, eventLockout: false,
        highImpactEvents: 0, regimeScore: 0.6, regimeLabel: input.regime ?? "UNKNOWN",
      },
      reasons: ["context_fusion_disabled"],
      evaluatedAt: new Date().toISOString(),
    };
    return bypass;
  }

  // Check cache
  const key = cacheKey(input);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  const reasons: string[] = [];
  const assetClass = input.assetClass ?? "equity";

  // 1. Macro Bias
  let macroBiasScore = 0.5;
  let macroBiasDirection = "flat";
  let macroBiasConviction = "low";
  let macroBiasAligned = true;
  try {
    const macroSvc = MacroContextService.getInstance();
    const macroCtx: MacroContext = macroSvc.getContext();
    if (macroCtx.isLive) {
      macroBiasScore = macroCtx.macroBias.score;
      macroBiasDirection = macroCtx.macroBias.direction;
      macroBiasConviction = macroCtx.macroBias.conviction;
      macroBiasAligned = macroCtx.macroBias.aligned;
      if (!macroBiasAligned) {
        reasons.push(`macro_headwind:${macroBiasDirection}_bias_vs_${input.direction}`);
        macroBiasScore = clamp(macroBiasScore * 0.6, 0, 1);
      } else if (macroBiasConviction === "high") {
        reasons.push(`macro_tailwind:${macroBiasDirection}_high_conviction`);
      }
    } else {
      reasons.push("macro_data_not_live");
    }
  } catch (err) {
    logger.warn({ error: String(err) }, "Context fusion: macro bias fetch failed");
    reasons.push("macro_bias_unavailable");
  }

  // 2. Sentiment
  let sentimentScore = 0.5;
  let sentimentCrowding = "low";
  let sentimentAligned = true;
  try {
    const macroSvc = MacroContextService.getInstance();
    const macroCtx: MacroContext = macroSvc.getContext();
    if (macroCtx.isLive) {
      sentimentScore = macroCtx.sentiment.sentimentScore;
      sentimentCrowding = macroCtx.sentiment.crowdingLevel;
      sentimentAligned = macroCtx.sentiment.aligned;
      if (macroCtx.sentiment.crowdingLevel === "extreme" && !sentimentAligned) {
        reasons.push(`extreme_crowding_contrarian:fade_${input.direction}`);
        sentimentScore = clamp(sentimentScore * 0.5, 0, 1);
      }
    }
  } catch {
    reasons.push("sentiment_unavailable");
  }

  // 3. Event Risk
  const eventAssessment = assessEventRisk();
  const eventRiskScore = eventRiskToScore(eventAssessment);
  if (eventAssessment.lockoutActive) {
    reasons.push(`event_lockout:${eventAssessment.lockoutReason ?? "active"}`);
  }
  if (eventAssessment.hasHighImpactUpcoming) {
    reasons.push(`high_impact_events:${eventAssessment.highImpactCount}`);
  }

  // 4. Regime
  const regimeLabel = (input.regime ?? "UNKNOWN").toUpperCase();
  const regimeScore = REGIME_SCORES[regimeLabel] ?? 0.50;
  if (regimeScore < 0.40) {
    reasons.push(`hostile_regime:${regimeLabel}`);
  }

  // ── Weighted fusion ──
  const fusionScore = clamp(
    WEIGHTS.macro * macroBiasScore +
    WEIGHTS.sentiment * sentimentScore +
    WEIGHTS.eventRisk * eventRiskScore +
    WEIGHTS.regime * regimeScore,
    0, 1,
  );

  const level = classifyLevel(fusionScore);
  const sizeMultiplier = computeSizeMultiplier(fusionScore, level);
  const blocked = fusionScore < BLOCK_THRESHOLD || eventAssessment.lockoutActive;
  const finalSizeMultiplier = blocked ? 0 : sizeMultiplier;
  const blockReason = blocked
    ? eventAssessment.lockoutActive
      ? `event_lockout:${eventAssessment.lockoutReason ?? "active"}`
      : `context_fusion_score_below_threshold:${fusionScore.toFixed(3)}<${BLOCK_THRESHOLD}`
    : null;

  if (blocked) {
    reasons.push("EXECUTION_BLOCKED_BY_CONTEXT");
  } else if (finalSizeMultiplier < 1.0) {
    reasons.push(`size_reduced_to_${(finalSizeMultiplier * 100).toFixed(0)}pct`);
  } else if (finalSizeMultiplier > 1.0) {
    reasons.push(`size_boosted_to_${(finalSizeMultiplier * 100).toFixed(0)}pct`);
  }

  const result: ContextFusionResult = {
    fusionScore,
    level,
    sizeMultiplier: finalSizeMultiplier,
    blocked,
    blockReason,
    components: {
      macroBiasScore,
      macroBiasDirection,
      macroBiasConviction,
      macroBiasAligned,
      sentimentScore,
      sentimentCrowding,
      sentimentAligned,
      eventRiskScore,
      eventLockout: eventAssessment.lockoutActive,
      highImpactEvents: eventAssessment.highImpactCount,
      regimeScore,
      regimeLabel,
    },
    reasons,
    evaluatedAt: new Date().toISOString(),
  };

  // Update telemetry
  totalEvaluations++;
  if (blocked) blockedCount++;
  else if (finalSizeMultiplier < 1.0) reducedCount++;
  else if (finalSizeMultiplier > 1.0) boostedCount++;
  lastEvaluation = result;
  lastEvaluatedAt = result.evaluatedAt;

  // Cache (with periodic eviction of expired entries to prevent memory leak)
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  if (cache.size > 50) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
  }

  logger.info({
    symbol: input.symbol,
    direction: input.direction,
    regime: regimeLabel,
    fusionScore: fusionScore.toFixed(3),
    level,
    sizeMultiplier: finalSizeMultiplier.toFixed(2),
    blocked,
  }, "Context fusion evaluated");

  return result;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

export function getContextFusionSnapshot(): ContextFusionSnapshot {
  return {
    enabled: ENABLED,
    blockThreshold: BLOCK_THRESHOLD,
    reduceThreshold: REDUCE_THRESHOLD,
    boostThreshold: BOOST_THRESHOLD,
    cacheTtlMs: CACHE_TTL_MS,
    cacheSize: cache.size,
    totalEvaluations,
    blockedCount,
    reducedCount,
    boostedCount,
    lastEvaluation,
    lastEvaluatedAt,
  };
}

export function resetContextFusionState(): void {
  cache.clear();
  totalEvaluations = 0;
  blockedCount = 0;
  reducedCount = 0;
  boostedCount = 0;
  lastEvaluation = null;
  lastEvaluatedAt = null;
  logger.info("Context fusion state reset");
}
