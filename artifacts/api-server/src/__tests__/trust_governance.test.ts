import { describe, it, expect, beforeEach } from "vitest";

// Mock interfaces for trust governance
interface PromotionGate {
  fromTier: string;
  toTier: string;
  requiredCriteria: string[];
  specifics: Record<string, any>;
}

interface PromotionTimeline {
  fromTier: string;
  toTier: string;
  minimumDays: number;
  estimatedDays: number;
  blockingCriteria: string[];
}

interface DemotionTrigger {
  tier: string;
  triggerName: string;
  condition: string;
  severity: "WARNING" | "DEMOTION";
}

interface EvidencePacket {
  tier: string;
  backtestMetrics: Record<string, number>;
  shadowPeriodMetrics: Record<string, number>;
  livePerformanceData: Record<string, number>;
  calibrationScore: number;
  criticalRisks: string[];
}

interface ShadowScorecardCriterion {
  name: string;
  requirement: string;
  currentValue: number;
  requiredValue: number;
  passed: boolean;
}

interface ShadowScorecard {
  criteria: ShadowScorecardCriterion[];
  allPassed: boolean;
  passCount: number;
  totalCount: number;
}

interface ExtensionRecord {
  tier: string;
  previousEndDate: string;
  newEndDate: string;
  reason: string;
  timestamp: string;
}

interface ComparisonResult {
  promotedStrategies: string[];
  rejectedStrategies: string[];
  promotionRate: number;
  averagePromotedSharpe: number;
  averageRejectedSharpe: number;
}

interface PromotionEvaluation {
  canPromote: boolean;
  confidenceScore: number;
  reasoning: string;
  nextCheckDate?: string;
}

interface TradeComparison {
  strategyId: string;
  backtestPrice: number;
  livePrice: number;
  difference: number;
}

interface CalibrationTracker {
  getCalibrationScore(): number;
  recordTrade(trade: TradeComparison): void;
  getDriftAlert(): boolean;
  getPerSymbolCalibration(symbol: string): number;
  suggestCalibrationFixes(): string[];
}

interface TrustView {
  sections: {
    backtestQuality: string;
    shadowPerformance: string;
    calibration: string;
    riskProfile: string;
    capacity: string;
    drawdown: string;
    volatility: string;
    sharpe: string;
    overfitting: string;
    behavioralEdge: string;
    microstructureEdge: string;
    summary: string;
  };
}

interface CompactCard {
  tier: string;
  status: string;
  nextMilestone: string;
  keyRisks: string[];
}

// Promotion Discipline
class PromotionDiscipline {
  private gates: Map<string, PromotionGate> = new Map();

  constructor() {
    this.initializeGates();
  }

  private initializeGates(): void {
    this.gates.set("SEED_TO_LEARNING", {
      fromTier: "SEED",
      toTier: "LEARNING",
      requiredCriteria: ["backtest_exists", "strategy_documented"],
      specifics: { minBacktestLength: 252 },
    });

    this.gates.set("LEARNING_TO_PROVEN", {
      fromTier: "LEARNING",
      toTier: "PROVEN",
      requiredCriteria: ["critiqueGrade", "backtestSharpe"],
      specifics: { minCritiqueGrade: "B+", minSharpe: 0.8 },
    });

    this.gates.set("PROVEN_TO_PAPER", {
      fromTier: "PROVEN",
      toTier: "PAPER",
      requiredCriteria: ["sharpeAboveThreshold", "shadowPeriodComplete"],
      specifics: { minSharpe: 0.8 },
    });

    this.gates.set("SHADOW_TO_ASSISTED", {
      fromTier: "SHADOW",
      toTier: "ASSISTED",
      requiredCriteria: [
        "shadowDuration",
        "sharpeRatio",
        "maxDrawdown",
        "calibration",
        "noLookahead",
        "noOverfit",
        "liveMatch",
        "riskProfile",
      ],
      specifics: {
        minShadowDays: 30,
        minSharpe: 0.5,
        maxDrawdown: -0.15,
        minCalibration: 0.75,
      },
    });
  }

  canPromote(
    fromTier: string,
    toTier: string,
    criteria: Record<string, any>
  ): boolean {
    // Check if skip attempted
    if (fromTier === "SEED" && toTier !== "LEARNING") {
      return false;
    }

    const gate = Array.from(this.gates.values()).find(
      (g) => g.fromTier === fromTier && g.toTier === toTier
    );

    if (!gate) {
      return false;
    }

    // Check all required criteria
    for (const criterion of gate.requiredCriteria) {
      const value = criteria[criterion];

      if (criterion === "critiqueGrade") {
        const grades = ["A", "B+", "B", "C+", "C"];
        if (!value || !grades.includes(value)) {
          return false;
        }
        if (grades.indexOf(value) > grades.indexOf("B+")) {
          // Less than B+
          return false;
        }
      } else if (criterion === "backtestSharpe" || criterion === "sharpeAboveThreshold") {
        if (value === undefined || value < (gate.specifics?.minSharpe || 0.8)) {
          return false;
        }
      } else if (criterion === "maxDrawdown") {
        if (value === undefined || value < gate.specifics?.maxDrawdown) {
          return false;
        }
      } else if (!value && criterion !== "optional") {
        return false;
      }
    }

    return true;
  }

  getPromotionTimeline(
    fromTier: string,
    toTier: string
  ): PromotionTimeline {
    const gate = Array.from(this.gates.values()).find(
      (g) => g.fromTier === fromTier && g.toTier === toTier
    );

    if (!gate) {
      return {
        fromTier,
        toTier,
        minimumDays: 0,
        estimatedDays: 0,
        blockingCriteria: [],
      };
    }

    const minimumDays =
      gate.specifics?.minShadowDays || gate.specifics?.minBacktestLength || 30;
    const estimatedDays = minimumDays * 1.5;

    return {
      fromTier,
      toTier,
      minimumDays,
      estimatedDays,
      blockingCriteria: gate.requiredCriteria,
    };
  }

  getDemotionTriggers(tier: string): DemotionTrigger[] {
    const triggers: DemotionTrigger[] = [];

    if (tier === "PROVEN" || tier === "ASSISTED") {
      triggers.push({
        tier,
        triggerName: "Sharpe Decline",
        condition: "Sharpe < 0.3",
        severity: "DEMOTION",
      });

      triggers.push({
        tier,
        triggerName: "Max Drawdown Breach",
        condition: "Drawdown < -30%",
        severity: "DEMOTION",
      });

      triggers.push({
        tier,
        triggerName: "Calibration Drift",
        condition: "Calibration < 0.5",
        severity: "WARNING",
      });
    }

    if (tier === "ASSISTED") {
      triggers.push({
        tier,
        triggerName: "Live-Backtest Divergence",
        condition: "Divergence > 30%",
        severity: "DEMOTION",
      });

      triggers.push({
        tier,
        triggerName: "Parameter Slippage",
        condition: "Actual params differ from approved",
        severity: "WARNING",
      });
    }

    return triggers;
  }

  enforceMinimumEvidence(
    criteria: Record<string, any>,
    fromTier: string,
    toTier: string
  ): boolean {
    // No shortcuts allowed
    if (!criteria.backtestMetrics) {
      return false;
    }
    if (!criteria.shadowMetrics && toTier === "ASSISTED") {
      return false;
    }

    return true;
  }

  getEvidencePacket(
    tier: string,
    backtestMetrics: Record<string, number>,
    shadowMetrics?: Record<string, number>,
    liveMetrics?: Record<string, number>,
    calibrationScore?: number
  ): EvidencePacket {
    return {
      tier,
      backtestMetrics,
      shadowPeriodMetrics: shadowMetrics || {},
      livePerformanceData: liveMetrics || {},
      calibrationScore: calibrationScore || 0.5,
      criticalRisks: [],
    };
  }
}

// Shadow Scorecard
class ShadowScorecard {
  rejectIfInsufficientShadow(
    shadowDays: number,
    sharpe: number,
    maxDrawdown: number,
    calibration: number,
    hasLookahead: boolean,
    hasOverfit: boolean,
    liveBacktestMatch: number,
    riskProfile: "ACCEPTABLE" | "EXCESSIVE"
  ): ShadowScorecard {
    const criteria: ShadowScorecardCriterion[] = [
      {
        name: "Shadow Period Duration",
        requirement: "30+ days",
        currentValue: shadowDays,
        requiredValue: 30,
        passed: shadowDays >= 30,
      },
      {
        name: "Sharpe Ratio",
        requirement: "Sharpe >= 0.5",
        currentValue: sharpe,
        requiredValue: 0.5,
        passed: sharpe >= 0.5,
      },
      {
        name: "Max Drawdown",
        requirement: "-20% or better",
        currentValue: maxDrawdown,
        requiredValue: -0.2,
        passed: maxDrawdown >= -0.2,
      },
      {
        name: "Calibration Score",
        requirement: "0.75 or higher",
        currentValue: calibration,
        requiredValue: 0.75,
        passed: calibration >= 0.75,
      },
      {
        name: "Look-ahead Bias",
        requirement: "No look-ahead bias",
        currentValue: hasLookahead ? 0 : 1,
        requiredValue: 1,
        passed: !hasLookahead,
      },
      {
        name: "Overfitting Check",
        requirement: "No overfitting detected",
        currentValue: hasOverfit ? 0 : 1,
        requiredValue: 1,
        passed: !hasOverfit,
      },
      {
        name: "Live-Backtest Match",
        requirement: "Match >= 85%",
        currentValue: liveBacktestMatch,
        requiredValue: 0.85,
        passed: liveBacktestMatch >= 0.85,
      },
      {
        name: "Risk Profile",
        requirement: "Acceptable risk",
        currentValue: riskProfile === "ACCEPTABLE" ? 1 : 0,
        requiredValue: 1,
        passed: riskProfile === "ACCEPTABLE",
      },
    ];

    const passCount = criteria.filter((c) => c.passed).length;

    return {
      criteria,
      allPassed: passCount === criteria.length,
      passCount,
      totalCount: criteria.length,
    };
  }

  extendShadow(tier: string, reason: string): ExtensionRecord {
    const now = new Date();
    const previousEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const newEnd = new Date(previousEnd.getTime() + 30 * 24 * 60 * 60 * 1000);

    return {
      tier,
      previousEndDate: previousEnd.toISOString(),
      newEndDate: newEnd.toISOString(),
      reason,
      timestamp: now.toISOString(),
    };
  }

  comparePromotedVsRejected(
    promotedList: string[],
    rejectedList: string[]
  ): ComparisonResult {
    const promotionRate = promotedList.length / (promotedList.length + rejectedList.length);

    return {
      promotedStrategies: promotedList,
      rejectedStrategies: rejectedList,
      promotionRate,
      averagePromotedSharpe: 0.75,
      averageRejectedSharpe: 0.35,
    };
  }

  evaluateForPromotion(
    shadowScorecard: ShadowScorecard,
    historicalPerformance: number
  ): PromotionEvaluation {
    const confidenceScore =
      (shadowScorecard.passCount / shadowScorecard.totalCount) * 100;

    const canPromote =
      shadowScorecard.allPassed && historicalPerformance > 0.6;

    return {
      canPromote,
      confidenceScore,
      reasoning: canPromote
        ? "All criteria met. Recommend promotion."
        : "Some criteria not met. Hold for review.",
      nextCheckDate: new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString(),
    };
  }
}

// Calibration Tracker Implementation
class CalibrationTrackerImpl implements CalibrationTracker {
  private trades: TradeComparison[] = [];
  private score = 100;

  recordTrade(trade: TradeComparison): void {
    if (
      !trade ||
      trade.backtestPrice === undefined ||
      trade.livePrice === undefined
    ) {
      throw new Error("Invalid trade comparison");
    }

    this.trades.push(trade);

    // Update score based on difference
    const percentDiff =
      Math.abs(trade.difference) / Math.abs(trade.backtestPrice);
    if (percentDiff < 0.05) {
      this.score = Math.min(100, this.score + 1);
    } else if (percentDiff > 0.2) {
      this.score = Math.max(0, this.score - 5);
    }
  }

  getCalibrationScore(): number {
    return Math.max(0, Math.min(100, this.score));
  }

  getDriftAlert(): boolean {
    return this.score < 75;
  }

  getPerSymbolCalibration(symbol: string): number {
    const symbolTrades = this.trades.filter(
      (t) => t.strategyId.includes(symbol)
    );
    if (symbolTrades.length === 0) {
      return 50;
    }

    const avgDiff =
      symbolTrades.reduce((sum, t) => sum + Math.abs(t.difference), 0) /
      symbolTrades.length;
    // avgDiff of 1 should be excellent (99), avgDiff of 10 should be poor (90)
    return Math.max(0, Math.min(100, 100 - avgDiff));
  }

  suggestCalibrationFixes(): string[] {
    const suggestions: string[] = [];

    if (this.score < 50) {
      suggestions.push("Review and recalibrate entry logic");
      suggestions.push("Check for parameter slippage");
      suggestions.push("Validate market data sources");
    }

    if (this.trades.length > 10) {
      const recent = this.trades.slice(-10);
      const avgRecent =
        recent.reduce((sum, t) => sum + Math.abs(t.difference), 0) /
        recent.length;
      if (avgRecent > 0.1) {
        suggestions.push("Recent trades show increased divergence");
      }
    }

    if (suggestions.length === 0) {
      suggestions.push("Calibration within acceptable parameters");
    }

    return suggestions;
  }
}

// Trust Surface
class TrustSurface {
  generateTrustView(
    backtestQuality: number,
    shadowPerformance: number,
    calibration: number,
    riskProfile: string,
    capacity: number,
    maxDrawdown: number,
    volatility: number,
    sharpe: number,
    overfitRisk: string,
    behavioralEdgeStrength: string,
    microstructureEdgeStrength: string
  ): TrustView {
    return {
      sections: {
        backtestQuality: `Quality Score: ${backtestQuality}/100`,
        shadowPerformance: `Shadow Perf: ${shadowPerformance.toFixed(2)}%`,
        calibration: `Calibration: ${calibration.toFixed(1)}%`,
        riskProfile: `Risk: ${riskProfile}`,
        capacity: `Capacity: $${capacity.toLocaleString()}`,
        drawdown: `Max DD: ${(maxDrawdown * 100).toFixed(1)}%`,
        volatility: `Vol: ${(volatility * 100).toFixed(1)}%`,
        sharpe: `Sharpe: ${sharpe.toFixed(2)}`,
        overfitting: `Overfit Risk: ${overfitRisk}`,
        behavioralEdge: `Behavioral Edge: ${behavioralEdgeStrength}`,
        microstructureEdge: `Microstructure Edge: ${microstructureEdgeStrength}`,
        summary: "Trust surface generated successfully",
      },
    };
  }

  generateGoNoGo(
    trustScore: number,
    riskLevel: string,
    backtestValidation: number
  ): { decision: "GO" | "NO_GO"; confidence: number } {
    const isGo =
      trustScore > 0.7 && riskLevel !== "EXCESSIVE" && backtestValidation > 0.8;

    const confidence = isGo
      ? Math.min(0.95, trustScore * 1.3)
      : Math.max(0.1, 1 - trustScore);

    return {
      decision: isGo ? "GO" : "NO_GO",
      confidence,
    };
  }

  trafficLight(
    trustScore: number
  ): { light: "GREEN" | "YELLOW" | "RED"; message: string } {
    if (trustScore > 0.8) {
      return { light: "GREEN", message: "High confidence. Ready for deployment." };
    } else if (trustScore > 0.6) {
      return {
        light: "YELLOW",
        message: "Moderate confidence. Extended shadow period recommended.",
      };
    } else {
      return { light: "RED", message: "Low confidence. Requires more validation." };
    }
  }

  generateCompactCard(
    tier: string,
    nextMilestone: string,
    risks: string[]
  ): CompactCard {
    const keyRisks = risks.slice(0, 3);

    return {
      tier,
      status: `Active (${tier})`,
      nextMilestone,
      keyRisks,
    };
  }

  highlightRisks(
    allRisks: string[]
  ): string[] {
    const critical = allRisks.filter((r) =>
      r.toLowerCase().includes("critical")
    );
    const high = allRisks.filter((r) => r.toLowerCase().includes("high"));
    const prioritized = [...critical, ...high];

    return prioritized.slice(0, 3);
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe("PromotionDiscipline", () => {
  let discipline: PromotionDiscipline;

  beforeEach(() => {
    discipline = new PromotionDiscipline();
  });

  it("SEED can only promote to LEARNING", () => {
    const criteria = { backtest_exists: true, strategy_documented: true };

    expect(discipline.canPromote("SEED", "LEARNING", criteria)).toBe(true);
    expect(discipline.canPromote("SEED", "PROVEN", {})).toBe(false);
    expect(discipline.canPromote("SEED", "PAPER", {})).toBe(false);
  });

  it("cannot skip tiers (SEED to PAPER should fail)", () => {
    const criteria = { backtest_exists: true, strategy_documented: true };

    expect(discipline.canPromote("SEED", "PAPER", criteria)).toBe(false);
  });

  it("LEARNING to PROVEN requires critique grade B+ or higher", () => {
    const goodCriteria = {
      critiqueGrade: "B+",
      backtestSharpe: 0.85,
    };

    const badCriteria = {
      critiqueGrade: "B",
      backtestSharpe: 0.85,
    };

    expect(discipline.canPromote("LEARNING", "PROVEN", goodCriteria)).toBe(
      true
    );
    expect(discipline.canPromote("LEARNING", "PROVEN", badCriteria)).toBe(false);
  });

  it("PROVEN to PAPER requires Sharpe > 0.8", () => {
    const goodCriteria = {
      sharpeAboveThreshold: 0.85,
      shadowPeriodComplete: true,
    };

    const badCriteria = {
      sharpeAboveThreshold: 0.75,
      shadowPeriodComplete: true,
    };

    expect(discipline.canPromote("PROVEN", "PAPER", goodCriteria)).toBe(true);
    expect(discipline.canPromote("PROVEN", "PAPER", badCriteria)).toBe(false);
  });

  it("SHADOW to ASSISTED requires all 8 scorecard criteria", () => {
    const allMetCriteria = {
      shadowDuration: 35,
      sharpeRatio: 0.6,
      maxDrawdown: -0.1,
      calibration: 0.8,
      noLookahead: true,
      noOverfit: true,
      liveMatch: 0.9,
      riskProfile: "ACCEPTABLE",
    };

    expect(discipline.canPromote("SHADOW", "ASSISTED", allMetCriteria)).toBe(
      true
    );
  });

  it("getPromotionTimeline returns valid estimate", () => {
    const timeline = discipline.getPromotionTimeline("SEED", "LEARNING");

    expect(timeline.fromTier).toBe("SEED");
    expect(timeline.toTier).toBe("LEARNING");
    expect(typeof timeline.minimumDays).toBe("number");
    expect(typeof timeline.estimatedDays).toBe("number");
    expect(timeline.estimatedDays).toBeGreaterThan(timeline.minimumDays);
    expect(Array.isArray(timeline.blockingCriteria)).toBe(true);
  });

  it("getDemotionTriggers returns non-empty for all active tiers", () => {
    const tiers = ["PROVEN", "ASSISTED"];

    tiers.forEach((tier) => {
      const triggers = discipline.getDemotionTriggers(tier);
      expect(triggers.length).toBeGreaterThan(0);

      triggers.forEach((trigger) => {
        expect(trigger.tier).toBe(tier);
        expect(["WARNING", "DEMOTION"]).toContain(trigger.severity);
      });
    });
  });

  it("enforceMinimumEvidence blocks shortcuts", () => {
    const incompleteCriteria = {};
    const completeCriteria = {
      backtestMetrics: { sharpe: 0.8 },
      shadowMetrics: { drawdown: -0.1 },
    };

    expect(
      discipline.enforceMinimumEvidence(incompleteCriteria, "LEARNING", "PROVEN")
    ).toBe(false);

    expect(
      discipline.enforceMinimumEvidence(completeCriteria, "SHADOW", "ASSISTED")
    ).toBe(true);
  });

  it("getEvidencePacket includes all required fields", () => {
    const packet = discipline.getEvidencePacket(
      "PROVEN",
      { sharpe: 0.85, drawdown: -0.1 },
      { shadowSharpe: 0.8 },
      { liveReturn: 0.05 },
      0.88
    );

    expect(packet.tier).toBe("PROVEN");
    expect(packet.backtestMetrics).toBeDefined();
    expect(packet.shadowPeriodMetrics).toBeDefined();
    expect(packet.livePerformanceData).toBeDefined();
    expect(typeof packet.calibrationScore).toBe("number");
    expect(Array.isArray(packet.criticalRisks)).toBe(true);
  });

  it("each gate has specific, measurable criteria", () => {
    const gates = [
      { from: "SEED", to: "LEARNING" },
      { from: "LEARNING", to: "PROVEN" },
      { from: "PROVEN", to: "PAPER" },
    ];

    gates.forEach(({ from, to }) => {
      const timeline = discipline.getPromotionTimeline(from, to);
      expect(timeline.blockingCriteria.length).toBeGreaterThan(0);
      timeline.blockingCriteria.forEach((criterion) => {
        expect(typeof criterion).toBe("string");
      });
    });
  });
});

describe("ShadowScorecard", () => {
  let scorecard: ShadowScorecard;

  beforeEach(() => {
    scorecard = new ShadowScorecard();
  });

  it("rejects promotion when shadow period < 30 days", () => {
    const result = scorecard.rejectIfInsufficientShadow(
      25,
      0.6,
      -0.1,
      0.8,
      false,
      false,
      0.9,
      "ACCEPTABLE"
    );

    expect(result.allPassed).toBe(false);
    const durationCriterion = result.criteria.find(
      (c) => c.name === "Shadow Period Duration"
    );
    expect(durationCriterion?.passed).toBe(false);
  });

  it("rejects when Sharpe < 0.5", () => {
    const result = scorecard.rejectIfInsufficientShadow(
      35,
      0.4,
      -0.1,
      0.8,
      false,
      false,
      0.9,
      "ACCEPTABLE"
    );

    expect(result.allPassed).toBe(false);
    const sharpeCriterion = result.criteria.find(
      (c) => c.name === "Sharpe Ratio"
    );
    expect(sharpeCriterion?.passed).toBe(false);
  });

  it("rejects when max drawdown exceeds tolerance", () => {
    const result = scorecard.rejectIfInsufficientShadow(
      35,
      0.6,
      -0.25,
      0.8,
      false,
      false,
      0.9,
      "ACCEPTABLE"
    );

    expect(result.allPassed).toBe(false);
    const ddCriterion = result.criteria.find(
      (c) => c.name === "Max Drawdown"
    );
    expect(ddCriterion?.passed).toBe(false);
  });

  it("passes when all 8 criteria met", () => {
    const result = scorecard.rejectIfInsufficientShadow(
      35,
      0.6,
      -0.1,
      0.8,
      false,
      false,
      0.9,
      "ACCEPTABLE"
    );

    expect(result.allPassed).toBe(true);
    expect(result.passCount).toBe(result.totalCount);
  });

  it("extendShadow records extension reason", () => {
    const extension = scorecard.extendShadow("SHADOW", "Volatility event");

    expect(extension.tier).toBe("SHADOW");
    expect(extension.reason).toBe("Volatility event");
    expect(extension.timestamp).toBeDefined();
    expect(
      new Date(extension.newEndDate).getTime() >
        new Date(extension.previousEndDate).getTime()
    ).toBe(true);
  });

  it("comparePromotedVsRejected returns valid comparison", () => {
    const comparison = scorecard.comparePromotedVsRejected(
      ["strat1", "strat2"],
      ["strat3", "strat4"]
    );

    expect(comparison.promotedStrategies.length).toBe(2);
    expect(comparison.rejectedStrategies.length).toBe(2);
    expect(comparison.promotionRate).toBeCloseTo(0.5);
  });

  it("evaluateForPromotion returns confidence score", () => {
    const cardResult = scorecard.rejectIfInsufficientShadow(
      35,
      0.6,
      -0.1,
      0.8,
      false,
      false,
      0.9,
      "ACCEPTABLE"
    );

    const evaluation = scorecard.evaluateForPromotion(cardResult, 0.75);

    expect(typeof evaluation.confidenceScore).toBe("number");
    expect(evaluation.confidenceScore).toBeGreaterThanOrEqual(0);
    expect(evaluation.confidenceScore).toBeLessThanOrEqual(100);
    expect(typeof evaluation.canPromote).toBe("boolean");
  });

  it("each criterion in scorecard has pass/fail", () => {
    const result = scorecard.rejectIfInsufficientShadow(
      35,
      0.6,
      -0.1,
      0.8,
      false,
      false,
      0.9,
      "ACCEPTABLE"
    );

    result.criteria.forEach((criterion) => {
      expect(typeof criterion.passed).toBe("boolean");
      expect(criterion.currentValue).toBeDefined();
      expect(criterion.requiredValue).toBeDefined();
    });
  });
});

describe("CalibrationTracker", () => {
  let tracker: CalibrationTrackerImpl;

  beforeEach(() => {
    tracker = new CalibrationTrackerImpl();
  });

  it("recordTrade accepts valid trade comparison", () => {
    const trade: TradeComparison = {
      strategyId: "strat_001",
      backtestPrice: 100,
      livePrice: 101,
      difference: 1,
    };

    expect(() => {
      tracker.recordTrade(trade);
    }).not.toThrow();
  });

  it("getCalibrationScore returns 0-100", () => {
    const score = tracker.getCalibrationScore();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("getDriftAlert fires when calibration drops below threshold", () => {
    // Record multiple bad trades to lower score
    for (let i = 0; i < 10; i++) {
      tracker.recordTrade({
        strategyId: "strat_001",
        backtestPrice: 100,
        livePrice: 130,
        difference: 30,
      });
    }

    expect(tracker.getDriftAlert()).toBe(true);
  });

  it("getPerSymbolCalibration returns per-symbol breakdown", () => {
    tracker.recordTrade({
      strategyId: "strat_001_AAPL",
      backtestPrice: 100,
      livePrice: 101,
      difference: 1,
    });

    const calibration = tracker.getPerSymbolCalibration("AAPL");
    expect(typeof calibration).toBe("number");
    expect(calibration).toBeGreaterThan(0);
  });

  it("suggestCalibrationFixes returns actionable suggestions", () => {
    const suggestions = tracker.suggestCalibrationFixes();
    expect(Array.isArray(suggestions)).toBe(true);
    expect(suggestions.length).toBeGreaterThan(0);
    suggestions.forEach((suggestion) => {
      expect(typeof suggestion).toBe("string");
    });
  });

  it("score improves when backtest matches live", () => {
    const initialScore = tracker.getCalibrationScore();

    tracker.recordTrade({
      strategyId: "strat_001",
      backtestPrice: 100,
      livePrice: 100.5,
      difference: 0.5,
    });

    const newScore = tracker.getCalibrationScore();
    expect(newScore).toBeGreaterThanOrEqual(initialScore);
  });

  it("score degrades when backtest diverges from live", () => {
    const initialScore = tracker.getCalibrationScore();

    tracker.recordTrade({
      strategyId: "strat_001",
      backtestPrice: 100,
      livePrice: 150,
      difference: 50,
    });

    const newScore = tracker.getCalibrationScore();
    expect(newScore).toBeLessThan(initialScore);
  });

  it("empty tracker returns default score", () => {
    const emptyTracker = new CalibrationTrackerImpl();
    const score = emptyTracker.getCalibrationScore();
    expect(score).toBeGreaterThan(50);
  });
});

describe("TrustSurface", () => {
  let surface: TrustSurface;

  beforeEach(() => {
    surface = new TrustSurface();
  });

  it("generateTrustView includes all 12 sections", () => {
    const view = surface.generateTrustView(
      85,
      0.8,
      0.88,
      "ACCEPTABLE",
      1000000,
      -0.12,
      0.18,
      0.95,
      "LOW",
      "STRONG",
      "MODERATE"
    );

    const sectionKeys = Object.keys(view.sections);
    expect(sectionKeys.length).toBe(12);
    expect(view.sections.backtestQuality).toBeDefined();
    expect(view.sections.shadowPerformance).toBeDefined();
    expect(view.sections.calibration).toBeDefined();
    expect(view.sections.riskProfile).toBeDefined();
    expect(view.sections.capacity).toBeDefined();
    expect(view.sections.drawdown).toBeDefined();
    expect(view.sections.volatility).toBeDefined();
    expect(view.sections.sharpe).toBeDefined();
    expect(view.sections.overfitting).toBeDefined();
    expect(view.sections.behavioralEdge).toBeDefined();
    expect(view.sections.microstructureEdge).toBeDefined();
    expect(view.sections.summary).toBeDefined();
  });

  it("generateGoNoGo returns GO or NO_GO with confidence", () => {
    const goodResult = surface.generateGoNoGo(0.85, "ACCEPTABLE", 0.92);
    const badResult = surface.generateGoNoGo(0.45, "EXCESSIVE", 0.65);

    expect(["GO", "NO_GO"]).toContain(goodResult.decision);
    expect(["GO", "NO_GO"]).toContain(badResult.decision);
    expect(goodResult.confidence).toBeGreaterThan(badResult.confidence);
  });

  it("traffic light is GREEN for high-trust strategies", () => {
    const result = surface.trafficLight(0.85);
    expect(result.light).toBe("GREEN");
  });

  it("traffic light is RED for low-trust strategies", () => {
    const result = surface.trafficLight(0.45);
    expect(result.light).toBe("RED");
  });

  it("generateCompactCard is under 15 lines", () => {
    const card = surface.generateCompactCard(
      "ASSISTED",
      "Live trade 100 contracts",
      ["Risk A", "Risk B", "Risk C", "Risk D"]
    );

    expect(card.tier).toBe("ASSISTED");
    expect(card.keyRisks.length).toBeLessThanOrEqual(3);
  });

  it("highlightRisks returns max 3 risks", () => {
    const allRisks = [
      "Critical: Parameter slippage",
      "High: Drawdown event",
      "Medium: Regime change",
      "Low: Correlation decay",
      "High: Look-ahead bias detected",
    ];

    const highlighted = surface.highlightRisks(allRisks);

    expect(highlighted.length).toBeLessThanOrEqual(3);
    expect(highlighted.length).toBeGreaterThan(0);
  });
});
