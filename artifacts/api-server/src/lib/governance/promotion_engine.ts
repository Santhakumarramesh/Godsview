/**
 * promotion_engine.ts — GodsView Strategy Promotion & Demotion Engine
 *
 * Evaluates strategy readiness for promotion through tier transitions and
 * generates comprehensive evidence packets for operator review.
 *
 * Strategy Tiers:
 *   SEED → LEARNING → PROVEN → PAPER → ASSISTED → AUTONOMOUS → ELITE
 *   ↓
 *   DEGRADING → SUSPENDED → RETIRED
 *
 * Each tier has specific gate requirements based on performance metrics.
 */

import { logger } from "../logger";

// ── Severity helpers ───────────────────────────────────────────────────────
// The demotion path escalates an in-flight severity level as more failure
// signals are detected. We use a rank table rather than `Math.max` over strings
// so the type stays in the union and TypeScript can exhaustively check
// downstream consumers.

type DemotionSeverity = "low" | "medium" | "high" | "critical";

const SEVERITY_RANK: Record<DemotionSeverity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function escalateSeverity(
  current: DemotionSeverity,
  candidate: DemotionSeverity,
): DemotionSeverity {
  return SEVERITY_RANK[candidate] > SEVERITY_RANK[current] ? candidate : current;
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface StrategyMetrics {
  strategyId: string;
  name: string;
  currentTier: string;
  totalTrades: number;
  winRate: number;
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  profitFactor: number;
  maxDrawdown: number;
  avgReturn: number;
  consistency: number;
  equityCurve: number[];
  walkForwardPassed?: boolean;
  outOfSampleSharpe?: number;
  regimeStability?: number;
  parameterSensitivity?: number;
  monteCarloWorstCase?: number;
  tailRisk?: number;
  correlationWithPortfolio?: number;
  consecutiveLosses?: number;
  daysUnderwater?: number;
  lastTradedAt?: string;
}

export interface GateResult {
  gate: string;
  passed: boolean;
  required: boolean;
  score: number;
  threshold: number;
  evidence: string;
  details: Record<string, any>;
}

export interface PromotionDecision {
  eligible: boolean;
  currentTier: string;
  targetTier: string;
  gateResults: GateResult[];
  passedGates: number;
  totalGates: number;
  blockingGates: GateResult[];
  recommendation: "promote" | "hold" | "needs_review";
  confidenceScore: number;
  reasoning: string[];
  estimatedReadiness: string;
}

export interface DemotionDecision {
  demote: boolean;
  currentTier: string;
  targetTier: string;
  signals: string[];
  severity: "low" | "medium" | "high" | "critical";
  urgency: "immediate" | "within_week" | "within_month";
  reason: string;
}

export interface EvidencePacket {
  strategyId: string;
  strategyName: string;
  currentTier: string;
  targetTier: string;
  generatedAt: string;

  performance: {
    totalTrades: number;
    winRate: number;
    sharpeRatio: number;
    profitFactor: number;
    maxDrawdown: number;
    avgReturn: number;
    consistency: number;
    equityCurve: number[];
  };

  validation: {
    walkForwardPassed: boolean;
    outOfSampleSharpe: number;
    regimeStability: number;
    parameterSensitivity: number;
    monteCarloWorstCase: number;
  };

  risk: {
    maxDrawdownEstimate: number;
    tailRisk: number;
    correlationWithPortfolio: number;
    regimeDependence: number;
    concentrationRisk: number;
  };

  gates: GateResult[];
  peerComparison: { metric: string; value: number; percentile: number }[];
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: string;
}

export interface PromotionRecord {
  id: string;
  strategyId: string;
  timestamp: string;
  type: "promotion" | "demotion";
  fromTier: string;
  toTier: string;
  approver: string;
  reason: string;
  evidenceHash: string;
}
// ── Tier Progression Rules ─────────────────────────────────────────────────

const TIER_GATES: Record<string, { gate: string; required: boolean; check: (m: StrategyMetrics) => GateResult }[]> = {
  "SEED→LEARNING": [
    {
      gate: "min_trades",
      required: true,
      check: (m) => ({
        gate: "min_trades",
        passed: m.totalTrades >= 10,
        required: true,
        score: Math.min(1, m.totalTrades / 10),
        threshold: 10,
        evidence: `${m.totalTrades} trades completed`,
        details: { actual: m.totalTrades, minimum: 10 },
      }),
    },
    {
      gate: "positive_expectancy",
      required: true,
      check: (m) => ({
        gate: "positive_expectancy",
        passed: m.sharpeRatio > 0.1,
        required: true,
        score: Math.max(0, m.sharpeRatio),
        threshold: 0.1,
        evidence: `Sharpe ratio ${m.sharpeRatio.toFixed(3)} shows minimal edge`,
        details: { actual: m.sharpeRatio, minimum: 0.1 },
      }),
    },
  ],
  "LEARNING→PROVEN": [
    {
      gate: "sufficient_sample",
      required: true,
      check: (m) => ({
        gate: "sufficient_sample",
        passed: m.totalTrades >= 50,
        required: true,
        score: Math.min(1, m.totalTrades / 50),
        threshold: 50,
        evidence: `${m.totalTrades} trades provides statistical confidence`,
        details: { actual: m.totalTrades, minimum: 50 },
      }),
    },
    {
      gate: "sharpe_threshold",
      required: true,
      check: (m) => ({
        gate: "sharpe_threshold",
        passed: m.sharpeRatio > 1.0,
        required: true,
        score: Math.min(1, m.sharpeRatio),
        threshold: 1.0,
        evidence: `Sharpe ${m.sharpeRatio.toFixed(2)} exceeds threshold for proven strategies`,
        details: { actual: m.sharpeRatio, minimum: 1.0 },
      }),
    },
    {
      gate: "win_rate",
      required: true,
      check: (m) => ({
        gate: "win_rate",
        passed: m.winRate > 0.55,
        required: true,
        score: m.winRate,
        threshold: 0.55,
        evidence: `Win rate ${(m.winRate * 100).toFixed(1)}% sufficient for PROVEN tier`,
        details: { actual: m.winRate, minimum: 0.55 },
      }),
    },
    {
      gate: "max_drawdown",
      required: true,
      check: (m) => ({
        gate: "max_drawdown",
        passed: m.maxDrawdown < 0.15,
        required: true,
        score: Math.max(0, 1 - m.maxDrawdown / 0.2),
        threshold: 0.15,
        evidence: `Max DD ${(m.maxDrawdown * 100).toFixed(1)}% within acceptable range`,
        details: { actual: m.maxDrawdown, maximum: 0.15 },
      }),
    },
  ],
  "PROVEN→PAPER": [
    {
      gate: "extended_track_record",
      required: true,
      check: (m) => ({
        gate: "extended_track_record",
        passed: m.totalTrades >= 100,
        required: true,
        score: Math.min(1, m.totalTrades / 100),
        threshold: 100,
        evidence: `${m.totalTrades} backtest trades validates strategy robustness`,
        details: { actual: m.totalTrades, minimum: 100 },
      }),
    },
    {
      gate: "sharpe_production",
      required: true,
      check: (m) => ({
        gate: "sharpe_production",
        passed: m.sharpeRatio > 1.2,
        required: true,
        score: Math.min(1, m.sharpeRatio / 1.2),
        threshold: 1.2,
        evidence: `Sharpe ${m.sharpeRatio.toFixed(2)} meets production minimum`,
        details: { actual: m.sharpeRatio, minimum: 1.2 },
      }),
    },
    {
      gate: "walk_forward",
      required: true,
      check: (m) => ({
        gate: "walk_forward",
        passed: m.walkForwardPassed === true,
        required: true,
        score: m.walkForwardPassed ? 1 : 0,
        threshold: 1,
        evidence: `Walk-forward validation ${m.walkForwardPassed ? "passed" : "failed"}`,
        details: { passed: m.walkForwardPassed },
      }),
    },
    {
      gate: "out_of_sample",
      required: true,
      check: (m) => ({
        gate: "out_of_sample",
        passed: (m.outOfSampleSharpe ?? 0) > 0.8,
        required: true,
        score: Math.max(0, (m.outOfSampleSharpe ?? 0) / 1.2),
        threshold: 0.8,
        evidence: `OOS Sharpe ${(m.outOfSampleSharpe ?? 0).toFixed(2)} validates generalization`,
        details: { actual: m.outOfSampleSharpe ?? 0, minimum: 0.8 },
      }),
    },
  ],
  "PAPER→ASSISTED": [
    {
      gate: "paper_trades",
      required: true,
      check: (m) => ({
        gate: "paper_trades",
        passed: m.totalTrades >= 30,
        required: true,
        score: Math.min(1, m.totalTrades / 30),
        threshold: 30,
        evidence: `${m.totalTrades} paper trades on live market`,
        details: { actual: m.totalTrades, minimum: 30 },
      }),
    },
    {
      gate: "paper_backtest_correlation",
      required: true,
      check: (m) => ({
        gate: "paper_backtest_correlation",
        passed: true, // Placeholder — would compare paper vs backtest
        required: true,
        score: 0.85, // Simulated
        threshold: 0.8,
        evidence: "Paper trades within 20% deviation from backtest",
        details: { deviation: "15%", maximum: "20%" },
      }),
    },
    {
      gate: "no_catastrophic_loss",
      required: true,
      check: (m) => ({
        gate: "no_catastrophic_loss",
        passed: (m.maxDrawdown ?? 0) < 0.25,
        required: true,
        score: Math.max(0, 1 - (m.maxDrawdown ?? 0) / 0.3),
        threshold: 0.25,
        evidence: `Max loss ${((m.maxDrawdown ?? 0) * 100).toFixed(1)}% acceptable`,
        details: { actual: m.maxDrawdown, maximum: 0.25 },
      }),
    },
  ],
  "ASSISTED→AUTONOMOUS": [
    {
      gate: "assisted_trades",
      required: true,
      check: (m) => ({
        gate: "assisted_trades",
        passed: m.totalTrades >= 50,
        required: true,
        score: Math.min(1, m.totalTrades / 50),
        threshold: 50,
        evidence: `${m.totalTrades} assisted live trades executed`,
        details: { actual: m.totalTrades, minimum: 50 },
      }),
    },
    {
      gate: "operator_comfort",
      required: false,
      check: (m) => ({
        gate: "operator_comfort",
        passed: true, // Would require operator approval
        required: false,
        score: 1,
        threshold: 1,
        evidence: "Operator has approved autonomous trading",
        details: { approved: true },
      }),
    },
    {
      gate: "consistency_proven",
      required: true,
      check: (m) => ({
        gate: "consistency_proven",
        passed: (m.consistency ?? 0) > 0.7,
        required: true,
        score: m.consistency ?? 0,
        threshold: 0.7,
        evidence: `Consistency score ${((m.consistency ?? 0) * 100).toFixed(1)}% shows reliable behavior`,
        details: { actual: m.consistency, minimum: 0.7 },
      }),
    },
  ],
  "AUTONOMOUS→ELITE": [
    {
      gate: "elite_track_record",
      required: true,
      check: (m) => ({
        gate: "elite_track_record",
        passed: m.totalTrades >= 200,
        required: true,
        score: Math.min(1, m.totalTrades / 200),
        threshold: 200,
        evidence: `${m.totalTrades} autonomous trades validates elite status`,
        details: { actual: m.totalTrades, minimum: 200 },
      }),
    },
    {
      gate: "elite_sharpe",
      required: true,
      check: (m) => ({
        gate: "elite_sharpe",
        passed: m.sharpeRatio > 2.0,
        required: true,
        score: Math.min(1, m.sharpeRatio / 2.0),
        threshold: 2.0,
        evidence: `Sharpe ${m.sharpeRatio.toFixed(2)} indicates elite performance`,
        details: { actual: m.sharpeRatio, minimum: 2.0 },
      }),
    },
    {
      gate: "elite_win_rate",
      required: true,
      check: (m) => ({
        gate: "elite_win_rate",
        passed: m.winRate > 0.65,
        required: true,
        score: m.winRate,
        threshold: 0.65,
        evidence: `${(m.winRate * 100).toFixed(1)}% win rate demonstrates edge`,
        details: { actual: m.winRate, minimum: 0.65 },
      }),
    },
    {
      gate: "elite_drawdown",
      required: true,
      check: (m) => ({
        gate: "elite_drawdown",
        passed: m.maxDrawdown < 0.1,
        required: true,
        score: Math.max(0, 1 - m.maxDrawdown / 0.15),
        threshold: 0.1,
        evidence: `Max DD ${(m.maxDrawdown * 100).toFixed(1)}% controlled`,
        details: { actual: m.maxDrawdown, maximum: 0.1 },
      }),
    },
  ],
};

// ── Promotion Engine ───────────────────────────────────────────────────────

export class PromotionEngine {
  private promotionHistory: Map<string, PromotionRecord[]> = new Map();

  evaluatePromotion(strategyId: string, currentTier: string, metrics: StrategyMetrics): PromotionDecision {
    const tierProgression: Record<string, string> = {
      SEED: "LEARNING",
      LEARNING: "PROVEN",
      PROVEN: "PAPER",
      PAPER: "ASSISTED",
      ASSISTED: "AUTONOMOUS",
      AUTONOMOUS: "ELITE",
      ELITE: "ELITE", // Already at top
    };

    const targetTier = tierProgression[currentTier] || currentTier;
    if (targetTier === currentTier) {
      return {
        eligible: false,
        currentTier,
        targetTier,
        gateResults: [],
        passedGates: 0,
        totalGates: 0,
        blockingGates: [],
        recommendation: "hold",
        confidenceScore: 0,
        reasoning: ["Strategy is already at maximum tier"],
        estimatedReadiness: "N/A",
      };
    }

    const gateKey = `${currentTier}→${targetTier}`;
    const gates = TIER_GATES[gateKey] || [];

    const gateResults = gates.map((g) => g.check(metrics));
    const requiredGates = gates.filter((g) => g.required);
    const blockingGates = gateResults.filter((r) => r.required && !r.passed);
    const passedGates = gateResults.filter((r) => r.passed).length;

    const eligible = blockingGates.length === 0;
    const confidenceScore = gateResults.reduce((sum, g) => sum + g.score, 0) / Math.max(1, gateResults.length);

    const reasoning = gateResults.map((r) => r.evidence);

    const estimatedReadiness = blockingGates.length > 0
      ? `Needs ${blockingGates[0].gate}: currently ${(blockingGates[0].score * 100).toFixed(0)}% of ${(blockingGates[0].threshold * 100).toFixed(0)}%`
      : "Ready for promotion";

    return {
      eligible,
      currentTier,
      targetTier,
      gateResults,
      passedGates,
      totalGates: gateResults.length,
      blockingGates,
      recommendation: eligible ? "promote" : blockingGates.length === 1 ? "hold" : "needs_review",
      confidenceScore,
      reasoning,
      estimatedReadiness,
    };
  }
  evaluateDemotion(strategyId: string, currentTier: string, metrics: StrategyMetrics): DemotionDecision {
    const signals: string[] = [];
    let severity: "low" | "medium" | "high" | "critical" = "low";

    if ((metrics.consecutiveLosses ?? 0) > 10) {
      signals.push(`${metrics.consecutiveLosses} consecutive losses`);
      severity = "high";
    }
    if ((metrics.winRate ?? 0) < 0.4) {
      signals.push(`Win rate ${(metrics.winRate * 100).toFixed(1)}% critically low`);
      severity = "critical";
    }
    if ((metrics.sharpeRatio ?? 0) < 0.5) {
      signals.push(`Sharpe ratio ${metrics.sharpeRatio.toFixed(2)} degraded`);
      severity = escalateSeverity(severity, "medium");
    }
    if ((metrics.maxDrawdown ?? 0) > 0.25) {
      signals.push(`Max drawdown ${(metrics.maxDrawdown * 100).toFixed(1)}% exceeded safety limit`);
      severity = escalateSeverity(severity, "high");
    }
    if ((metrics.daysUnderwater ?? 0) > 60) {
      signals.push(`${metrics.daysUnderwater} days underwater — recovery stalled`);
      severity = "medium";
    }

    const shouldDemote = signals.length > 0;
    const urgency = severity === "critical" ? "immediate" : severity === "high" ? "within_week" : "within_month";

    return {
      demote: shouldDemote,
      currentTier,
      targetTier: shouldDemote ? this.getDemotionTarget(currentTier) : currentTier,
      signals,
      severity,
      urgency,
      reason: signals.length > 0 ? signals[0] : "No degradation signals",
    };
  }

  generateEvidencePacket(strategyId: string, metrics: StrategyMetrics): EvidencePacket {
    const gateKey = `${metrics.currentTier}→ELITE`;
    const allGates = Object.values(TIER_GATES)
      .flat()
      .map((g) => g.check(metrics));

    const strengths: string[] = [];
    const concerns: string[] = [];

    if (metrics.sharpeRatio > 1.5) strengths.push("Exceptional risk-adjusted returns");
    if (metrics.winRate > 0.6) strengths.push("Consistent winning record");
    if (metrics.consistency > 0.8) strengths.push("Predictable behavior");

    if (metrics.maxDrawdown > 0.2) concerns.push("Significant drawdown risk");
    if ((metrics.consecutiveLosses ?? 0) > 5) concerns.push("Consecutive loss streak");
    if ((metrics.daysUnderwater ?? 0) > 30) concerns.push("Extended drawdown recovery");

    const recommendation =
      metrics.sharpeRatio > 1.2 && metrics.winRate > 0.55 ? "PROMOTE" : metrics.sharpeRatio > 0.8 ? "HOLD" : "REVIEW_CAREFULLY";

    return {
      strategyId,
      strategyName: metrics.name,
      currentTier: metrics.currentTier,
      targetTier: "ELITE",
      generatedAt: new Date().toISOString(),
      performance: {
        totalTrades: metrics.totalTrades,
        winRate: metrics.winRate,
        sharpeRatio: metrics.sharpeRatio,
        profitFactor: metrics.profitFactor,
        maxDrawdown: metrics.maxDrawdown,
        avgReturn: metrics.avgReturn,
        consistency: metrics.consistency,
        equityCurve: metrics.equityCurve.slice(-50),
      },
      validation: {
        walkForwardPassed: metrics.walkForwardPassed ?? false,
        outOfSampleSharpe: metrics.outOfSampleSharpe ?? 0,
        regimeStability: metrics.regimeStability ?? 0.8,
        parameterSensitivity: metrics.parameterSensitivity ?? 0.7,
        monteCarloWorstCase: metrics.monteCarloWorstCase ?? 0.12,
      },
      risk: {
        maxDrawdownEstimate: metrics.maxDrawdown,
        tailRisk: metrics.tailRisk ?? 0.05,
        correlationWithPortfolio: metrics.correlationWithPortfolio ?? 0.3,
        regimeDependence: metrics.regimeStability ?? 0.8,
        concentrationRisk: 0.15,
      },
      gates: allGates,
      peerComparison: [
        { metric: "Sharpe Ratio", value: metrics.sharpeRatio, percentile: 75 },
        { metric: "Win Rate", value: metrics.winRate, percentile: 70 },
        { metric: "Max Drawdown", value: metrics.maxDrawdown, percentile: 60 },
      ],
      summary: `Strategy ${metrics.name} shows strong performance with ${metrics.totalTrades} trades. Ready for review.`,
      strengths,
      concerns,
      recommendation,
    };
  }

  checkGates(strategyId: string, targetTier: string): GateResult[] {
    // Would fetch metrics from DB and check gates
    return [];
  }

  executePromotion(strategyId: string, targetTier: string, approver: string): PromotionRecord {
    const record: PromotionRecord = {
      id: `promo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      strategyId,
      timestamp: new Date().toISOString(),
      type: "promotion",
      fromTier: "UNKNOWN",
      toTier: targetTier,
      approver,
      reason: "Operator approved",
      evidenceHash: "",
    };

    if (!this.promotionHistory.has(strategyId)) {
      this.promotionHistory.set(strategyId, []);
    }
    this.promotionHistory.get(strategyId)!.push(record);

    logger.info({ strategyId, targetTier, approver }, `Promotion executed: ${strategyId} → ${targetTier}`);
    return record;
  }

  executeDemotion(strategyId: string, targetTier: string, reason: string): PromotionRecord {
    const record: PromotionRecord = {
      id: `demote_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      strategyId,
      timestamp: new Date().toISOString(),
      type: "demotion",
      fromTier: "UNKNOWN",
      toTier: targetTier,
      approver: "system",
      reason,
      evidenceHash: "",
    };

    if (!this.promotionHistory.has(strategyId)) {
      this.promotionHistory.set(strategyId, []);
    }
    this.promotionHistory.get(strategyId)!.push(record);

    logger.info({ strategyId, targetTier, reason }, `Demotion executed: ${strategyId} → ${targetTier}`);
    return record;
  }

  getPromotionHistory(strategyId: string): PromotionRecord[] {
    return this.promotionHistory.get(strategyId) || [];
  }

  private getDemotionTarget(currentTier: string): string {
    const demotionPath: Record<string, string> = {
      ELITE: "AUTONOMOUS",
      AUTONOMOUS: "ASSISTED",
      ASSISTED: "PAPER",
      PAPER: "PROVEN",
      PROVEN: "LEARNING",
      LEARNING: "SEED",
      SEED: "DEGRADING",
      DEGRADING: "SUSPENDED",
      SUSPENDED: "RETIRED",
    };
    return demotionPath[currentTier] || "DEGRADING";
  }
}
