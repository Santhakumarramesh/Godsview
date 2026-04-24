/**
 * unified_decision_engine.ts — GodsView Unified Decision Engine (Phase 1)
 *
 * The central intelligence orchestrator that consolidates all SI versions,
 * memory, reasoning, risk, and explainability into a single decision pipeline.
 *
 * Pipeline:
 *   1. SIGNAL INTAKE    — receive raw signal from scanner/strategy
 *   2. CONTEXT ENRICH   — attach regime, session, macro, sentiment
 *   3. MEMORY RECALL    — consult historical similar setups + failure patterns
 *   4. MULTI-LAYER SCORE — weighted ensemble across structure/flow/recall/ML/reasoning
 *   5. CONFIDENCE GATE  — multi-factor confidence with attribution
 *   6. RISK GATE        — portfolio-aware risk check (exposure, correlation, drawdown)
 *   7. EXPLAINABILITY   — generate human-readable decision trace
 *   8. DECISION OUTPUT  — approve/reject with full audit trail
 *
 * This engine replaces the fragmented SI v1-v4 decision paths with one
 * canonical flow. All trade decisions in GodsView route through here.
 */

import { logger as _logger } from "./logger";
import { predictWinProbability, getModelStatus } from "./ml_model";
import { reasonTradeDecision } from "./reasoning_engine";
import { recallBeforeTrade, type RecallInput, type MemoryRecallResult } from "./memory/recall_bridge";
import { memorySystem, marketEmbeddings, contextMemory } from "./memory";
import { publishAlert } from "./signal_stream";

const logger = _logger.child({ module: "unified-decision-engine" });

// ── Types ────────────────────────────────────────────────────────────────────

export interface DecisionRequest {
  /** Unique request ID for tracing */
  requestId: string;
  /** Symbol being evaluated */
  symbol: string;
  /** Direction of the trade */
  direction: "long" | "short";
  /** Strategy name */
  strategy: string;
  /** Setup type (e.g., "order_block_retest", "liquidity_sweep") */
  setupType: string;

  // Price levels
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;

  // Scores from upstream layers (0-1)
  structureScore: number;
  orderFlowScore: number;
  recallScore: number;

  // Context
  regime: string;
  session: string;
  timeframe: string;
  volatility: number;
  atr: number;

  // Portfolio context
  equity: number;
  openPositions: number;
  dailyPnl: number;
  dailyDrawdown: number;

  // Multi-timeframe (optional)
  timeframeScores?: Record<string, number>;

  // Macro + sentiment (optional)
  macroBias?: { direction: string; score: number; conviction: string };
  sentimentScore?: number;
}

export interface DecisionResult {
  requestId: string;
  symbol: string;
  direction: "long" | "short";
  strategy: string;

  // Final decision
  approved: boolean;
  decision: "EXECUTE" | "REJECT" | "DEFER";
  rejectionReasons: string[];

  // Confidence
  confidence: ConfidenceBreakdown;

  // Sizing
  positionSize: number;
  kellyFraction: number;
  riskPercent: number;

  // Trailing stop
  trailingStop: TrailingStopParams;
  profitTargets: ProfitTarget[];

  // Memory recall
  memoryRecall: MemoryRecallSummary;

  // Explainability
  explanation: DecisionExplanation;

  // Audit
  pipelineTrace: PipelineStage[];
  decidedAt: string;
  latencyMs: number;
}

export interface ConfidenceBreakdown {
  /** Final composite confidence (0-1) */
  overall: number;
  /** Individual factor scores */
  factors: ConfidenceFactor[];
  /** Regime-adaptive weights used */
  weights: RegimeWeights;
  /** Win probability from ML ensemble */
  mlWinProbability: number;
  /** Edge score: expected value per dollar risked */
  edgeScore: number;
}

export interface ConfidenceFactor {
  name: string;
  score: number;
  weight: number;
  weighted: number;
  contribution: string; // "strong_positive" | "positive" | "neutral" | "negative" | "strong_negative"
}

export interface RegimeWeights {
  structure: number;
  orderFlow: number;
  recall: number;
  ml: number;
  reasoning: number;
  label: string;
}

export interface TrailingStopParams {
  initialAtrMultiple: number;
  activationAtr: number;
  trailStep: number;
  maxHoldMinutes: number;
}

export interface ProfitTarget {
  closePct: number;
  rTarget: number;
}

export interface MemoryRecallSummary {
  consulted: boolean;
  similarSetups: number;
  historicalWinRate: number;
  failurePatterns: number;
  recommendation: "proceed" | "caution" | "avoid";
  sizeMultiplier: number;
  confidenceAdjustment: number;
  warnings: string[];
}

export interface DecisionExplanation {
  /** One-sentence summary */
  headline: string;
  /** Structured reasoning */
  reasoning: string[];
  /** Key factors that drove the decision */
  keyFactors: { factor: string; impact: "positive" | "negative" | "neutral"; detail: string }[];
  /** Historical context */
  historicalContext: string;
  /** Risk assessment */
  riskAssessment: string;
  /** What would change the decision */
  wouldChangeIf: string[];
}

export interface PipelineStage {
  stage: string;
  status: "pass" | "fail" | "skip" | "warn";
  durationMs: number;
  detail: string;
}

// ── Regime Weights ───────────────────────────────────────────────────────────

const REGIME_WEIGHT_MAP: Record<string, RegimeWeights> = {
  trending_bull: {
    structure: 0.35, orderFlow: 0.22, recall: 0.18, ml: 0.15, reasoning: 0.10,
    label: "Trend-Following (Bull)",
  },
  trending_bear: {
    structure: 0.35, orderFlow: 0.22, recall: 0.18, ml: 0.15, reasoning: 0.10,
    label: "Trend-Following (Bear)",
  },
  ranging: {
    structure: 0.25, orderFlow: 0.30, recall: 0.22, ml: 0.13, reasoning: 0.10,
    label: "Mean-Reversion (Range)",
  },
  volatile: {
    structure: 0.28, orderFlow: 0.28, recall: 0.20, ml: 0.12, reasoning: 0.12,
    label: "High-Conviction Only (Volatile)",
  },
  chop: {
    structure: 0.20, orderFlow: 0.20, recall: 0.20, ml: 0.20, reasoning: 0.20,
    label: "All-Layer Consensus (Chop)",
  },
};

function getWeightsForRegime(regime: string): RegimeWeights {
  return REGIME_WEIGHT_MAP[regime] ?? REGIME_WEIGHT_MAP.ranging;
}

// ── Configuration ────────────────────────────────────────────────────────────

const CONFIG = {
  // Minimum confidence to approve a trade
  minConfidence: parseFloat(process.env.UDE_MIN_CONFIDENCE ?? "0.55"),
  // Minimum confluence (timeframes aligned)
  minConfluence: parseInt(process.env.UDE_MIN_CONFLUENCE ?? "2", 10),
  // Maximum daily drawdown before pausing
  maxDailyDrawdown: parseFloat(process.env.UDE_MAX_DAILY_DD ?? "0.03"),
  // Maximum open positions
  maxOpenPositions: parseInt(process.env.UDE_MAX_POSITIONS ?? "5", 10),
  // Kelly fraction cap (never risk more than this)
  kellyMaxFraction: parseFloat(process.env.UDE_KELLY_MAX ?? "0.05"),
  // Minimum edge score to trade
  minEdgeScore: parseFloat(process.env.UDE_MIN_EDGE ?? "0.15"),
  // Chop regime: require higher confidence
  chopConfidenceBoost: 0.15,
  // Volatile regime: require higher confidence
  volatileConfidenceBoost: 0.10,
};

// ── Decision History (ring buffer) ──────────────────────────────────────────

const HISTORY_MAX = parseInt(process.env.UDE_HISTORY_MAX ?? "500", 10);
const _decisionHistory: DecisionResult[] = [];

function recordDecision(decision: DecisionResult): void {
  _decisionHistory.unshift(decision);
  while (_decisionHistory.length > HISTORY_MAX) _decisionHistory.pop();
}

// ── Stats ────────────────────────────────────────────────────────────────────

let _stats = {
  totalDecisions: 0,
  approved: 0,
  rejected: 0,
  deferred: 0,
  avgConfidence: 0,
  avgLatencyMs: 0,
  lastDecisionAt: null as string | null,
  rejectionReasons: {} as Record<string, number>,
};

function updateStats(result: DecisionResult): void {
  _stats.totalDecisions++;
  if (result.decision === "EXECUTE") _stats.approved++;
  else if (result.decision === "REJECT") _stats.rejected++;
  else _stats.deferred++;

  // Running average confidence
  _stats.avgConfidence =
    (_stats.avgConfidence * (_stats.totalDecisions - 1) + result.confidence.overall) /
    _stats.totalDecisions;

  // Running average latency
  _stats.avgLatencyMs =
    (_stats.avgLatencyMs * (_stats.totalDecisions - 1) + result.latencyMs) /
    _stats.totalDecisions;

  _stats.lastDecisionAt = result.decidedAt;

  // Track rejection reasons
  for (const reason of result.rejectionReasons) {
    _stats.rejectionReasons[reason] = (_stats.rejectionReasons[reason] ?? 0) + 1;
  }
}

// ── Core Decision Pipeline ──────────────────────────────────────────────────

/**
 * Main entry point: evaluate a trade candidate through the full pipeline.
 */
export async function evaluateDecision(req: DecisionRequest): Promise<DecisionResult> {
  const startMs = Date.now();
  const trace: PipelineStage[] = [];
  const rejectionReasons: string[] = [];

  logger.info(
    { requestId: req.requestId, symbol: req.symbol, strategy: req.strategy },
    "[UDE] Decision pipeline started",
  );

  // ── Stage 1: Context Enrichment ──────────────────────────────────────────
  const s1Start = Date.now();
  const weights = getWeightsForRegime(req.regime);
  const effectiveMinConfidence = req.regime === "chop"
    ? CONFIG.minConfidence + CONFIG.chopConfidenceBoost
    : req.regime === "volatile"
      ? CONFIG.minConfidence + CONFIG.volatileConfidenceBoost
      : CONFIG.minConfidence;

  trace.push({
    stage: "context_enrichment",
    status: "pass",
    durationMs: Date.now() - s1Start,
    detail: `Regime: ${req.regime}, Weights: ${weights.label}, Min confidence: ${effectiveMinConfidence.toFixed(2)}`,
  });

  // ── Stage 2: Memory Recall ───────────────────────────────────────────────
  const s2Start = Date.now();
  let memoryResult: MemoryRecallResult | null = null;
  let memorySummary: MemoryRecallSummary;

  try {
    const recallInput: RecallInput = {
      symbol: req.symbol,
      strategy: req.strategy,
      direction: req.direction,
      entryPrice: req.entryPrice,
      stopLoss: req.stopLoss,
      takeProfit: req.takeProfit,
      regime: req.regime,
      volatility: req.volatility,
      session: req.session,
      timeframe: req.timeframe,
    };
    memoryResult = await recallBeforeTrade(recallInput);

    memorySummary = {
      consulted: memoryResult.consulted,
      similarSetups: memoryResult.similarSetupCount,
      historicalWinRate: memoryResult.historicalWinRate,
      failurePatterns: memoryResult.failurePatternCount,
      recommendation: memoryResult.tradeAllowed
        ? (memoryResult.positionSizeMultiplier < 1 ? "caution" : "proceed")
        : "avoid",
      sizeMultiplier: memoryResult.positionSizeMultiplier,
      confidenceAdjustment: memoryResult.confidenceAdjustment,
      warnings: memoryResult.warnings,
    };

    if (!memoryResult.tradeAllowed) {
      rejectionReasons.push("memory_block: historical failure pattern match");
    }

    trace.push({
      stage: "memory_recall",
      status: memoryResult.tradeAllowed ? "pass" : "fail",
      durationMs: Date.now() - s2Start,
      detail: `${memoryResult.similarSetupCount} similar setups, ${(memoryResult.historicalWinRate * 100).toFixed(0)}% win rate, ${memoryResult.failurePatternCount} failure patterns`,
    });
  } catch (err: any) {
    memorySummary = {
      consulted: false,
      similarSetups: 0,
      historicalWinRate: 0.5,
      failurePatterns: 0,
      recommendation: "proceed",
      sizeMultiplier: 1,
      confidenceAdjustment: 0,
      warnings: [`Memory recall failed: ${err.message}`],
    };
    trace.push({
      stage: "memory_recall",
      status: "skip",
      durationMs: Date.now() - s2Start,
      detail: `Recall failed: ${err.message}`,
    });
  }

  // ── Stage 3: ML Prediction ───────────────────────────────────────────────
  const s3Start = Date.now();
  let mlWinProb = 0.5;
  try {
    const mlResult = predictWinProbability({
      structure_score: req.structureScore,
      order_flow_score: req.orderFlowScore,
      recall_score: req.recallScore,
      regime: req.regime,
      setup_type: req.setupType,
      direction: req.direction,
    });
    mlWinProb = mlResult.probability;
    trace.push({
      stage: "ml_prediction",
      status: "pass",
      durationMs: Date.now() - s3Start,
      detail: `Win probability: ${(mlWinProb * 100).toFixed(1)}% (model: ${mlResult.model || "ensemble"})`,
    });
  } catch (err: any) {
    trace.push({
      stage: "ml_prediction",
      status: "skip",
      durationMs: Date.now() - s3Start,
      detail: `ML prediction failed: ${err.message}`,
    });
  }

  // ── Stage 4: Reasoning (Claude or heuristic) ────────────────────────────
  const s4Start = Date.now();
  let reasoningScore = 0.5;
  let reasoningExplanation = "No reasoning available";
  try {
    const reasoningResult = await reasonTradeDecision({
      symbol: req.symbol,
      direction: req.direction,
      entry: req.entryPrice,
      stop: req.stopLoss,
      target: req.takeProfit,
      quality: req.structureScore,
      regime: req.regime,
      setup_type: req.setupType,
    });
    reasoningScore = reasoningResult.quality ?? 0.5;
    reasoningExplanation = reasoningResult.reasoning ?? "Heuristic fallback";
    trace.push({
      stage: "reasoning",
      status: "pass",
      durationMs: Date.now() - s4Start,
      detail: `Score: ${(reasoningScore * 100).toFixed(0)}%, Source: ${reasoningResult.source || "fallback"}`,
    });
  } catch (err: any) {
    trace.push({
      stage: "reasoning",
      status: "skip",
      durationMs: Date.now() - s4Start,
      detail: `Reasoning failed: ${err.message}`,
    });
  }

  // ── Stage 5: Multi-Layer Confidence Scoring ──────────────────────────────
  const s5Start = Date.now();
  const factors: ConfidenceFactor[] = [
    {
      name: "structure",
      score: req.structureScore,
      weight: weights.structure,
      weighted: req.structureScore * weights.structure,
      contribution: classifyContribution(req.structureScore),
    },
    {
      name: "order_flow",
      score: req.orderFlowScore,
      weight: weights.orderFlow,
      weighted: req.orderFlowScore * weights.orderFlow,
      contribution: classifyContribution(req.orderFlowScore),
    },
    {
      name: "recall",
      score: req.recallScore,
      weight: weights.recall,
      weighted: req.recallScore * weights.recall,
      contribution: classifyContribution(req.recallScore),
    },
    {
      name: "ml_ensemble",
      score: mlWinProb,
      weight: weights.ml,
      weighted: mlWinProb * weights.ml,
      contribution: classifyContribution(mlWinProb),
    },
    {
      name: "reasoning",
      score: reasoningScore,
      weight: weights.reasoning,
      weighted: reasoningScore * weights.reasoning,
      contribution: classifyContribution(reasoningScore),
    },
  ];

  let rawConfidence = factors.reduce((sum, f) => sum + f.weighted, 0);

  // Apply memory adjustment
  rawConfidence += memorySummary.confidenceAdjustment;

  // Multi-timeframe confluence bonus
  let confluenceCount = 0;
  if (req.timeframeScores) {
    confluenceCount = Object.values(req.timeframeScores).filter((s) => s > 0.5).length;
    if (confluenceCount >= 3) rawConfidence += 0.05;
    else if (confluenceCount >= 2) rawConfidence += 0.02;
  }

  // Macro alignment bonus
  if (req.macroBias) {
    const macroAligned =
      (req.direction === "long" && req.macroBias.direction === "long") ||
      (req.direction === "short" && req.macroBias.direction === "short");
    if (macroAligned && req.macroBias.score > 0.6) rawConfidence += 0.03;
    else if (!macroAligned && req.macroBias.score > 0.7) rawConfidence -= 0.05;
  }

  // Sentiment check
  if (req.sentimentScore !== undefined) {
    const sentimentAligned =
      (req.direction === "long" && req.sentimentScore > 0.6) ||
      (req.direction === "short" && req.sentimentScore < 0.4);
    if (sentimentAligned) rawConfidence += 0.02;
  }

  const confidence = Math.max(0, Math.min(1, rawConfidence));

  // Risk-reward ratio
  const riskDist = Math.abs(req.entryPrice - req.stopLoss);
  const rewardDist = Math.abs(req.takeProfit - req.entryPrice);
  const rrRatio = riskDist > 0 ? rewardDist / riskDist : 0;

  // Edge score: (winProb * avgWin) - ((1-winProb) * avgLoss)
  const edgeScore = (mlWinProb * rrRatio) - ((1 - mlWinProb) * 1);

  // Kelly Criterion
  const kellyRaw = mlWinProb - ((1 - mlWinProb) / (rrRatio || 1));
  const kellyFraction = Math.max(0, Math.min(CONFIG.kellyMaxFraction, kellyRaw * 0.5)); // half-Kelly

  trace.push({
    stage: "confidence_scoring",
    status: confidence >= effectiveMinConfidence ? "pass" : "fail",
    durationMs: Date.now() - s5Start,
    detail: `Confidence: ${(confidence * 100).toFixed(1)}% (min: ${(effectiveMinConfidence * 100).toFixed(0)}%), Edge: ${edgeScore.toFixed(3)}, RR: ${rrRatio.toFixed(2)}, Kelly: ${(kellyFraction * 100).toFixed(2)}%`,
  });

  if (confidence < effectiveMinConfidence) {
    rejectionReasons.push(`low_confidence: ${(confidence * 100).toFixed(1)}% < ${(effectiveMinConfidence * 100).toFixed(0)}%`);
  }

  if (edgeScore < CONFIG.minEdgeScore) {
    rejectionReasons.push(`low_edge: ${edgeScore.toFixed(3)} < ${CONFIG.minEdgeScore}`);
  }

  // ── Stage 6: Risk Gate ───────────────────────────────────────────────────
  const s6Start = Date.now();
  const riskChecks: string[] = [];

  if (req.dailyDrawdown > CONFIG.maxDailyDrawdown) {
    rejectionReasons.push(`daily_drawdown: ${(req.dailyDrawdown * 100).toFixed(1)}% exceeds ${(CONFIG.maxDailyDrawdown * 100).toFixed(0)}% limit`);
    riskChecks.push("FAIL: daily drawdown exceeded");
  } else {
    riskChecks.push(`PASS: daily DD ${(req.dailyDrawdown * 100).toFixed(1)}%`);
  }

  if (req.openPositions >= CONFIG.maxOpenPositions) {
    rejectionReasons.push(`max_positions: ${req.openPositions} >= ${CONFIG.maxOpenPositions}`);
    riskChecks.push("FAIL: max positions reached");
  } else {
    riskChecks.push(`PASS: ${req.openPositions}/${CONFIG.maxOpenPositions} positions`);
  }

  // Position sizing
  const baseRiskPct = kellyFraction > 0 ? kellyFraction : 0.01;
  const adjustedRiskPct = baseRiskPct * memorySummary.sizeMultiplier;
  const positionSize = (req.equity * adjustedRiskPct) / (riskDist || 1);

  trace.push({
    stage: "risk_gate",
    status: riskChecks.every((c) => c.startsWith("PASS")) ? "pass" : "fail",
    durationMs: Date.now() - s6Start,
    detail: riskChecks.join("; "),
  });

  // ── Stage 7: Final Decision ──────────────────────────────────────────────
  const approved = rejectionReasons.length === 0;
  const decision: "EXECUTE" | "REJECT" | "DEFER" = approved
    ? "EXECUTE"
    : rejectionReasons.some((r) => r.startsWith("memory_block") || r.startsWith("daily_drawdown"))
      ? "REJECT"
      : "DEFER";

  // ── Stage 8: Explainability ──────────────────────────────────────────────
  const s8Start = Date.now();
  const explanation = generateExplanation(req, confidence, factors, memorySummary, edgeScore, rrRatio, mlWinProb, rejectionReasons, reasoningExplanation);

  trace.push({
    stage: "explainability",
    status: "pass",
    durationMs: Date.now() - s8Start,
    detail: explanation.headline,
  });

  // ── Trailing stop params ─────────────────────────────────────────────────
  const trailingStop = computeTrailingStop(req.regime, req.atr, confidence);
  const profitTargets = computeProfitTargets(rrRatio);

  // ── Build result ─────────────────────────────────────────────────────────
  const result: DecisionResult = {
    requestId: req.requestId,
    symbol: req.symbol,
    direction: req.direction,
    strategy: req.strategy,
    approved,
    decision,
    rejectionReasons,
    confidence: {
      overall: confidence,
      factors,
      weights,
      mlWinProbability: mlWinProb,
      edgeScore,
    },
    positionSize: approved ? Math.max(1, Math.round(positionSize)) : 0,
    kellyFraction,
    riskPercent: adjustedRiskPct,
    trailingStop,
    profitTargets,
    memoryRecall: memorySummary,
    explanation,
    pipelineTrace: trace,
    decidedAt: new Date().toISOString(),
    latencyMs: Date.now() - startMs,
  };

  // Record + publish
  recordDecision(result);
  updateStats(result);

  // SSE event for dashboard
  publishAlert({
    type: "ude_decision",
    requestId: req.requestId,
    symbol: req.symbol,
    strategy: req.strategy,
    direction: req.direction,
    decision: result.decision,
    confidence: result.confidence.overall,
    edgeScore: result.confidence.edgeScore,
    approved: result.approved,
    rejectionReasons: result.rejectionReasons,
    headline: result.explanation.headline,
    decidedAt: result.decidedAt,
    latencyMs: result.latencyMs,
  });

  logger.info(
    {
      requestId: req.requestId,
      symbol: req.symbol,
      decision: result.decision,
      confidence: result.confidence.overall.toFixed(3),
      edgeScore: result.confidence.edgeScore.toFixed(3),
      latencyMs: result.latencyMs,
    },
    `[UDE] Decision: ${result.decision}`,
  );

  return result;
}

// ── Explainability Generator ─────────────────────────────────────────────────

function generateExplanation(
  req: DecisionRequest,
  confidence: number,
  factors: ConfidenceFactor[],
  memory: MemoryRecallSummary,
  edgeScore: number,
  rrRatio: number,
  mlWinProb: number,
  rejections: string[],
  reasoningText: string,
): DecisionExplanation {
  const topFactors = [...factors].sort((a, b) => b.weighted - a.weighted);
  const strongestPositive = topFactors.find((f) => f.score > 0.6);
  const strongestNegative = topFactors.find((f) => f.score < 0.4);

  // Headline
  let headline: string;
  if (rejections.length === 0) {
    headline = `${req.symbol} ${req.direction.toUpperCase()} approved at ${(confidence * 100).toFixed(0)}% confidence — ${strongestPositive?.name || "multi-factor"} leads.`;
  } else {
    headline = `${req.symbol} ${req.direction.toUpperCase()} rejected: ${rejections[0]}`;
  }

  // Reasoning
  const reasoning: string[] = [
    `Regime: ${req.regime} → using ${getWeightsForRegime(req.regime).label} weights.`,
    `ML ensemble gives ${(mlWinProb * 100).toFixed(1)}% win probability.`,
    `Risk/reward ratio: ${rrRatio.toFixed(2)}:1 → edge score: ${edgeScore.toFixed(3)}.`,
  ];
  if (memory.consulted) {
    reasoning.push(
      `Memory found ${memory.similarSetups} similar setups with ${(memory.historicalWinRate * 100).toFixed(0)}% historical win rate.`,
    );
    if (memory.failurePatterns > 0) {
      reasoning.push(`WARNING: ${memory.failurePatterns} historical failure pattern(s) match this setup.`);
    }
  }
  if (reasoningText && reasoningText !== "No reasoning available") {
    reasoning.push(`Reasoning engine: ${reasoningText}`);
  }

  // Key factors
  const keyFactors = factors.map((f) => ({
    factor: f.name,
    impact: f.score > 0.6 ? "positive" as const : f.score < 0.4 ? "negative" as const : "neutral" as const,
    detail: `${(f.score * 100).toFixed(0)}% (weight: ${(f.weight * 100).toFixed(0)}%)`,
  }));

  // Historical context
  const historicalContext = memory.consulted
    ? `Based on ${memory.similarSetups} similar historical setups: ${(memory.historicalWinRate * 100).toFixed(0)}% win rate. ${memory.warnings.join(" ")}`
    : "No historical data available for this exact setup pattern.";

  // Risk assessment
  const riskAssessment = `Position risk: ${(req.dailyDrawdown * 100).toFixed(1)}% daily DD, ${req.openPositions} open positions. ${edgeScore > 0.3 ? "Strong positive edge." : edgeScore > 0.1 ? "Marginal positive edge." : "Edge is thin — caution advised."}`;

  // What would change
  const wouldChangeIf: string[] = [];
  if (rejections.length > 0) {
    if (rejections.some((r) => r.includes("confidence")))
      wouldChangeIf.push("Higher structure or order flow scores would increase confidence.");
    if (rejections.some((r) => r.includes("edge")))
      wouldChangeIf.push("Better risk/reward ratio or higher ML win probability would improve edge.");
    if (rejections.some((r) => r.includes("drawdown")))
      wouldChangeIf.push("Waiting for daily PnL to recover would clear the drawdown gate.");
    if (rejections.some((r) => r.includes("memory")))
      wouldChangeIf.push("Different setup conditions that don't match historical failure patterns.");
  } else {
    wouldChangeIf.push("A sudden regime shift to chop would raise the confidence threshold.");
    if (strongestNegative)
      wouldChangeIf.push(`Improving ${strongestNegative.name} (currently ${(strongestNegative.score * 100).toFixed(0)}%) would strengthen conviction.`);
  }

  return { headline, reasoning, keyFactors, historicalContext, riskAssessment, wouldChangeIf };
}

// ── Trailing Stop Calculator ─────────────────────────────────────────────────

function computeTrailingStop(regime: string, atr: number, confidence: number): TrailingStopParams {
  const isVolatile = regime === "volatile";
  const isTrending = regime.startsWith("trending");

  return {
    initialAtrMultiple: isVolatile ? 2.5 : isTrending ? 1.8 : 2.0,
    activationAtr: isVolatile ? 1.5 : 1.0,
    trailStep: isTrending ? 0.4 : 0.5,
    maxHoldMinutes: confidence > 0.75 ? 240 : confidence > 0.6 ? 120 : 60,
  };
}

// ── Profit Targets ───────────────────────────────────────────────────────────

function computeProfitTargets(rrRatio: number): ProfitTarget[] {
  if (rrRatio >= 3) {
    return [
      { closePct: 0.33, rTarget: 1.5 },
      { closePct: 0.33, rTarget: 2.5 },
      { closePct: 0.34, rTarget: 3.5 },
    ];
  }
  if (rrRatio >= 2) {
    return [
      { closePct: 0.5, rTarget: 1.0 },
      { closePct: 0.5, rTarget: 2.0 },
    ];
  }
  return [
    { closePct: 0.5, rTarget: 1.0 },
    { closePct: 0.5, rTarget: 1.5 },
  ];
}

// ── Contribution Classifier ──────────────────────────────────────────────────

function classifyContribution(score: number): string {
  if (score >= 0.8) return "strong_positive";
  if (score >= 0.6) return "positive";
  if (score >= 0.4) return "neutral";
  if (score >= 0.2) return "negative";
  return "strong_negative";
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getDecisionHistory(limit = 50): DecisionResult[] {
  return _decisionHistory.slice(0, limit);
}

export function getDecisionById(requestId: string): DecisionResult | undefined {
  return _decisionHistory.find((d) => d.requestId === requestId);
}

export function getDecisionStats() {
  return {
    ..._stats,
    historySize: _decisionHistory.length,
    recentApprovalRate:
      _stats.totalDecisions > 0 ? _stats.approved / _stats.totalDecisions : 0,
  };
}

export function getRecentDecisionsForSymbol(symbol: string, limit = 20): DecisionResult[] {
  return _decisionHistory.filter((d) => d.symbol === symbol).slice(0, limit);
}

/**
 * Get decision quality metrics — how well is the engine performing?
 */
export function getDecisionQuality(): {
  totalDecisions: number;
  approvalRate: number;
  avgConfidence: number;
  avgEdgeScore: number;
  avgLatencyMs: number;
  topRejectionReasons: { reason: string; count: number }[];
  regimeBreakdown: Record<string, { total: number; approved: number; avgConfidence: number }>;
} {
  const regimeBreakdown: Record<string, { total: number; approved: number; totalConf: number; avgConfidence: number }> = {};

  let totalEdge = 0;
  for (const d of _decisionHistory) {
    totalEdge += d.confidence.edgeScore;

    // Extract regime from trace
    const ctxStage = d.pipelineTrace.find((s) => s.stage === "context_enrichment");
    const regimeMatch = ctxStage?.detail.match(/Regime: (\w+)/);
    const regime = regimeMatch?.[1] ?? "unknown";

    if (!regimeBreakdown[regime]) {
      regimeBreakdown[regime] = { total: 0, approved: 0, totalConf: 0, avgConfidence: 0 };
    }
    regimeBreakdown[regime].total++;
    if (d.approved) regimeBreakdown[regime].approved++;
    regimeBreakdown[regime].totalConf += d.confidence.overall;
    regimeBreakdown[regime].avgConfidence = regimeBreakdown[regime].totalConf / regimeBreakdown[regime].total;
  }

  // Clean up totalConf from output
  const cleanRegime: Record<string, { total: number; approved: number; avgConfidence: number }> = {};
  for (const [k, v] of Object.entries(regimeBreakdown)) {
    cleanRegime[k] = { total: v.total, approved: v.approved, avgConfidence: v.avgConfidence };
  }

  const topReasons = Object.entries(_stats.rejectionReasons)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    totalDecisions: _stats.totalDecisions,
    approvalRate: _stats.totalDecisions > 0 ? _stats.approved / _stats.totalDecisions : 0,
    avgConfidence: _stats.avgConfidence,
    avgEdgeScore: _decisionHistory.length > 0 ? totalEdge / _decisionHistory.length : 0,
    avgLatencyMs: _stats.avgLatencyMs,
    topRejectionReasons: topReasons,
    regimeBreakdown: cleanRegime,
  };
}
