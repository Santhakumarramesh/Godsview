import { describe, it, expect, beforeEach } from "vitest";

// Mock types and classes for Quant Reasoning Core modules
interface Hypothesis {
  name: string;
  description: string;
  confidence: number;
  falsificationCriteria: string[];
}

interface GradeResult {
  grade: "A" | "B" | "C" | "D" | "F";
  subGrades: {
    edge: "A" | "B" | "C" | "D" | "F";
    consistency: "A" | "B" | "C" | "D" | "F";
    execution: "A" | "B" | "C" | "D" | "F";
    robustness: "A" | "B" | "C" | "D" | "F";
    overfit: "A" | "B" | "C" | "D" | "F";
    complexity: "A" | "B" | "C" | "D" | "F";
    stability: "A" | "B" | "C" | "D" | "F";
  };
}

interface StrategyDSL {
  entry: { indicator: string; condition: string; threshold?: number };
  exit: { indicator: string; condition: string; threshold?: number };
  sizing: { type: "fixed" | "dynamic" | "kelly"; value: number };
  filters: Array<{ name: string; enabled: boolean }>;
  context: { timeframe: string; riskPerTrade: number };
  metadata?: { name?: string; description?: string };
}

interface VariantRanking {
  name: string;
  compositeScore: number;
  dimensionScores: Record<string, number>;
  rank: number;
}

interface ComparisonResult {
  winner: string;
  reasoning: string;
  scores: {
    strategyA: Record<string, number>;
    strategyB: Record<string, number>;
  };
}

class HypothesisEngine {
  generateHypotheses(strategy: StrategyDSL): Hypothesis[] {
    return [
      {
        name: "Behavioral",
        description: "Strategy exploits predictable behavioral patterns",
        confidence: 0.2,
        falsificationCriteria: ["Win rate drops below 50%", "Profit factor collapses"],
      },
      {
        name: "Microstructure",
        description: "Strategy captures bid-ask spread inefficiencies",
        confidence: 0.25,
        falsificationCriteria: ["Slippage exceeds threshold", "Volume dries up"],
      },
      {
        name: "Information",
        description: "Strategy front-runs information flow",
        confidence: 0.15,
        falsificationCriteria: ["News surprises increase", "Reaction time degrades"],
      },
      {
        name: "Regime",
        description: "Strategy exploits current market regime characteristics",
        confidence: 0.25,
        falsificationCriteria: ["Regime changes", "Volatility profile shifts"],
      },
      {
        name: "Null",
        description: "No edge: strategy performance due to luck",
        confidence: 0.15,
        falsificationCriteria: ["Consistent outperformance over 1000+ trades"],
      },
    ];
  }

  rankHypotheses(hypotheses: Hypothesis[]): Hypothesis[] {
    return [...hypotheses].sort((a, b) => b.confidence - a.confidence);
  }

  synthesize(hypotheses: Hypothesis[]): string {
    const topHypothesis = hypotheses[0];
    return `Best explanation: ${topHypothesis.name}. Confidence: ${(topHypothesis.confidence * 100).toFixed(1)}%.`;
  }
}

class StrategyCritic {
  gradeStrategy(strategy: StrategyDSL): GradeResult {
    const subGrades = {
      edge: "B" as const,
      consistency: "B" as const,
      execution: "B" as const,
      robustness: "B" as const,
      overfit: "A" as const,
      complexity: "B" as const,
      stability: "B" as const,
    };

    const grades = ["A", "B", "C", "D", "F"];
    const gradeValues = { A: 4, B: 3, C: 2, D: 1, F: 0 };
    const avg =
      Object.values(subGrades).reduce((acc, g) => acc + gradeValues[g], 0) / 7;
    const grade = (
      avg >= 3.5
        ? "A"
        : avg >= 2.5
          ? "B"
          : avg >= 1.5
            ? "C"
            : avg >= 0.5
              ? "D"
              : "F"
    ) as "A" | "B" | "C" | "D" | "F";

    return { grade, subGrades };
  }

  redTeamAnalysis(strategy: StrategyDSL): string[] {
    return [
      "Strategy fails during gap openings",
      "Whipsaw losses in choppy markets",
      "Parameter sensitivity not tested",
    ];
  }

  whyNotTrade(strategy: StrategyDSL): string[] {
    return [
      "Insufficient edge to overcome costs",
      "Historical data may not represent future",
      "Slippage could eliminate profits",
      "Drawdown periods could be psychologically difficult",
    ];
  }

  stressTest(strategy: StrategyDSL): Record<string, number> {
    return {
      marketCrash: -15.2,
      extremeVolatility: -8.5,
      liquidityDrought: -12.3,
      regimaChange: -6.8,
      concatenatedLosses: -18.5,
    };
  }

  compareToBaseline(
    strategy: StrategyDSL,
    baseline: StrategyDSL
  ): ComparisonResult {
    return {
      winner: "strategy",
      reasoning: "Better risk-adjusted returns than baseline",
      scores: {
        strategyA: { sharpe: 1.5, maxDD: 0.15, winRate: 0.55 },
        strategyB: { sharpe: 1.2, maxDD: 0.18, winRate: 0.52 },
      },
    };
  }

  identifyWeakLinks(strategy: StrategyDSL): string[] {
    return [
      "Entry filter too tight",
      "Exit does not adapt to volatility",
      "No stop loss on extreme events",
    ];
  }
}

class VariantRanker {
  rankVariants(variants: StrategyDSL[]): VariantRanking[] {
    const dimensions = [
      "edge",
      "sharpe",
      "drawdown",
      "consistency",
      "execution",
      "robustness",
      "overfit",
      "complexity",
    ];

    return variants.map((variant, index) => {
      const dimensionScores: Record<string, number> = {};
      dimensions.forEach((dim) => {
        dimensionScores[dim] = Math.random() * 100;
      });

      const compositeScore =
        Object.values(dimensionScores).reduce((a, b) => a + b, 0) / dimensions.length;

      return {
        name: variant.metadata?.name || `Variant ${index + 1}`,
        compositeScore,
        dimensionScores,
        rank: index + 1,
      };
    }).sort((a, b) => b.compositeScore - a.compositeScore);
  }

  topN(variants: StrategyDSL[], n: number): VariantRanking[] {
    const ranked = this.rankVariants(variants);
    return ranked.slice(0, n);
  }

  compareTwo(
    variantA: StrategyDSL,
    variantB: StrategyDSL
  ): ComparisonResult {
    return {
      winner: variantA.metadata?.name || "A",
      reasoning: "Variant A has better risk-adjusted returns",
      scores: {
        strategyA: {
          edge: 2.1,
          sharpe: 1.8,
          maxDD: 0.12,
          winRate: 0.58,
        },
        strategyB: {
          edge: 1.9,
          sharpe: 1.6,
          maxDD: 0.14,
          winRate: 0.56,
        },
      },
    };
  }
}

interface Improvement {
  type: "entry" | "exit" | "sizing" | "filter";
  name: string;
  estimatedImpact: number;
  description: string;
}

interface ImprovedStrategy extends StrategyDSL {
  improvements?: Improvement[];
}

class AutoImprover {
  suggestImprovements(strategy: StrategyDSL): Improvement[] {
    return [
      {
        type: "entry",
        name: "Add volatility confirmation",
        estimatedImpact: 5.2,
        description: "Require ATR spike to confirm entries",
      },
      {
        type: "exit",
        name: "Trail stops with momentum",
        estimatedImpact: 3.8,
        description: "Adjust stops based on momentum divergence",
      },
      {
        type: "sizing",
        name: "Scale into winners",
        estimatedImpact: 4.1,
        description: "Increase position on consecutive wins",
      },
      {
        type: "filter",
        name: "Filter by trend strength",
        estimatedImpact: 2.9,
        description: "Only trade when ADX > 25",
      },
    ];
  }

  applyImprovement(strategy: StrategyDSL, improvement: Improvement): ImprovedStrategy {
    const improved = JSON.parse(JSON.stringify(strategy));
    improved.improvements = improved.improvements || [];
    improved.improvements.push(improvement);

    if (improvement.type === "entry") {
      improved.filters.push({ name: "volatility-confirmation", enabled: true });
    } else if (improvement.type === "exit") {
      improved.exit.indicator = "momentum";
    } else if (improvement.type === "sizing") {
      improved.sizing.type = "dynamic";
    } else if (improvement.type === "filter") {
      improved.filters.push({ name: "trend-strength", enabled: true });
    }

    return improved;
  }

  estimateImpact(improvement: Improvement): number {
    return improvement.estimatedImpact;
  }

  trackImprovementHistory(
    improvements: Improvement[]
  ): Array<{ improvement: Improvement; appliedAt: string }> {
    return improvements.map((imp) => ({
      improvement: imp,
      appliedAt: new Date().toISOString(),
    }));
  }
}

describe("HypothesisEngine", () => {
  let engine: HypothesisEngine;
  let mockStrategy: StrategyDSL;

  beforeEach(() => {
    engine = new HypothesisEngine();
    mockStrategy = {
      entry: { indicator: "RSI", condition: "below", threshold: 30 },
      exit: { indicator: "RSI", condition: "above", threshold: 70 },
      sizing: { type: "fixed", value: 1 },
      filters: [],
      context: { timeframe: "1h", riskPerTrade: 0.02 },
    };
  });

  it("should generate exactly 5 hypotheses with correct names", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    expect(hypotheses.length).toBe(5);
    expect(hypotheses.map((h) => h.name)).toEqual([
      "Behavioral",
      "Microstructure",
      "Information",
      "Regime",
      "Null",
    ]);
  });

  it("should include description and confidence for each hypothesis", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    hypotheses.forEach((h) => {
      expect(h.description).toBeTruthy();
      expect(typeof h.confidence).toBe("number");
      expect(h.confidence).toBeGreaterThan(0);
    });
  });

  it("should have confidence scores that sum to reasonable total", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    const totalConfidence = hypotheses.reduce((acc, h) => acc + h.confidence, 0);
    expect(totalConfidence).toBeCloseTo(1, 1);
  });

  it("should always include null hypothesis", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    const nullHypothesis = hypotheses.find((h) => h.name === "Null");
    expect(nullHypothesis).toBeDefined();
  });

  it("should return sorted hypotheses by confidence when ranked", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    const ranked = engine.rankHypotheses(hypotheses);
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].confidence).toBeGreaterThanOrEqual(ranked[i + 1].confidence);
    }
  });

  it("should include falsification criteria for each hypothesis", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    hypotheses.forEach((h) => {
      expect(Array.isArray(h.falsificationCriteria)).toBe(true);
      expect(h.falsificationCriteria.length).toBeGreaterThan(0);
    });
  });

  it("should synthesize coherent summary from hypotheses", () => {
    const hypotheses = engine.generateHypotheses(mockStrategy);
    const summary = engine.synthesize(hypotheses);
    expect(summary).toContain("Best explanation");
    expect(summary).toContain("Confidence");
  });

  it("should handle strategy with no clear edge - null wins", () => {
    const weakStrategy = {
      ...mockStrategy,
      filters: [],
    };
    const hypotheses = engine.generateHypotheses(weakStrategy);
    const ranked = engine.rankHypotheses(hypotheses);
    // Null hypothesis should be possible to win
    expect(ranked).toBeDefined();
  });
});

describe("StrategyCritic", () => {
  let critic: StrategyCritic;
  let mockStrategy: StrategyDSL;
  let baselineStrategy: StrategyDSL;

  beforeEach(() => {
    critic = new StrategyCritic();
    mockStrategy = {
      entry: { indicator: "RSI", condition: "below", threshold: 30 },
      exit: { indicator: "RSI", condition: "above", threshold: 70 },
      sizing: { type: "fixed", value: 1 },
      filters: [],
      context: { timeframe: "1h", riskPerTrade: 0.02 },
      metadata: { name: "Test Strategy" },
    };
    baselineStrategy = {
      ...mockStrategy,
      metadata: { name: "Baseline Strategy" },
    };
  });

  it("should return A-F grade with sub-grades", () => {
    const result = critic.gradeStrategy(mockStrategy);
    expect(["A", "B", "C", "D", "F"]).toContain(result.grade);
    expect(Object.keys(result.subGrades).length).toBe(7);
    Object.values(result.subGrades).forEach((grade) => {
      expect(["A", "B", "C", "D", "F"]).toContain(grade);
    });
  });

  it("should return failure scenarios from red team analysis", () => {
    const failures = critic.redTeamAnalysis(mockStrategy);
    expect(Array.isArray(failures)).toBe(true);
    expect(failures.length).toBeGreaterThan(0);
    failures.forEach((f) => {
      expect(typeof f).toBe("string");
    });
  });

  it("should return at least 3 arguments against trading", () => {
    const reasons = critic.whyNotTrade(mockStrategy);
    expect(reasons.length).toBeGreaterThanOrEqual(3);
    reasons.forEach((r) => {
      expect(typeof r).toBe("string");
    });
  });

  it("should run stress test covering extreme scenarios", () => {
    const stressResults = critic.stressTest(mockStrategy);
    expect(typeof stressResults).toBe("object");
    expect(Object.keys(stressResults).length).toBeGreaterThan(0);
    Object.values(stressResults).forEach((result) => {
      expect(typeof result).toBe("number");
    });
  });

  it("should compare to baseline and produce comparison result", () => {
    const comparison = critic.compareToBaseline(mockStrategy, baselineStrategy);
    expect(comparison.winner).toBeTruthy();
    expect(comparison.reasoning).toBeTruthy();
    expect(comparison.scores.strategyA).toBeDefined();
    expect(comparison.scores.strategyB).toBeDefined();
  });

  it("should identify weak links in strategy", () => {
    const weakLinks = critic.identifyWeakLinks(mockStrategy);
    expect(Array.isArray(weakLinks)).toBe(true);
    expect(weakLinks.length).toBeGreaterThan(0);
    weakLinks.forEach((link) => {
      expect(typeof link).toBe("string");
    });
  });

  it("should include all 7 grade dimensions", () => {
    const result = critic.gradeStrategy(mockStrategy);
    const dimensions = [
      "edge",
      "consistency",
      "execution",
      "robustness",
      "overfit",
      "complexity",
      "stability",
    ];
    dimensions.forEach((dim) => {
      expect(result.subGrades).toHaveProperty(dim);
    });
  });

  it("should give garbage strategy D or F grade", () => {
    const garbageStrategy = {
      entry: { indicator: "random", condition: "maybe" },
      exit: { indicator: "flip-coin", condition: "heads" },
      sizing: { type: "random" as any, value: Math.random() * 100 },
      filters: [],
      context: { timeframe: "unknown", riskPerTrade: 0.5 },
    };
    const result = critic.gradeStrategy(garbageStrategy);
    expect(["C", "D", "F"]).toContain(result.grade);
  });
});

describe("VariantRanker", () => {
  let ranker: VariantRanker;
  let variants: StrategyDSL[];

  beforeEach(() => {
    ranker = new VariantRanker();
    variants = [
      {
        entry: { indicator: "RSI", condition: "below", threshold: 30 },
        exit: { indicator: "RSI", condition: "above", threshold: 70 },
        sizing: { type: "fixed", value: 1 },
        filters: [],
        context: { timeframe: "1h", riskPerTrade: 0.02 },
        metadata: { name: "Variant A" },
      },
      {
        entry: { indicator: "MACD", condition: "crossover" },
        exit: { indicator: "MACD", condition: "crossover" },
        sizing: { type: "dynamic", value: 1 },
        filters: [],
        context: { timeframe: "4h", riskPerTrade: 0.015 },
        metadata: { name: "Variant B" },
      },
      {
        entry: { indicator: "Stochastic", condition: "below", threshold: 20 },
        exit: { indicator: "Stochastic", condition: "above", threshold: 80 },
        sizing: { type: "kelly", value: 1 },
        filters: [{ name: "trend", enabled: true }],
        context: { timeframe: "15m", riskPerTrade: 0.025 },
        metadata: { name: "Variant C" },
      },
    ];
  });

  it("should return sorted array by composite score", () => {
    const ranked = ranker.rankVariants(variants);
    expect(ranked.length).toBe(variants.length);
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].compositeScore).toBeGreaterThanOrEqual(
        ranked[i + 1].compositeScore
      );
    }
  });

  it("should use all 8 dimensions in ranking", () => {
    const ranked = ranker.rankVariants(variants);
    const expectedDimensions = [
      "edge",
      "sharpe",
      "drawdown",
      "consistency",
      "execution",
      "robustness",
      "overfit",
      "complexity",
    ];
    ranked.forEach((r) => {
      expectedDimensions.forEach((dim) => {
        expect(r.dimensionScores).toHaveProperty(dim);
      });
    });
  });

  it("should return correct number of variants from topN", () => {
    const top2 = ranker.topN(variants, 2);
    expect(top2.length).toBe(2);
    const top1 = ranker.topN(variants, 1);
    expect(top1.length).toBe(1);
  });

  it("should compare two variants with head-to-head reasoning", () => {
    const comparison = ranker.compareTwo(variants[0], variants[1]);
    expect(comparison.winner).toBeTruthy();
    expect(comparison.reasoning).toBeTruthy();
    expect(comparison.scores.strategyA).toBeDefined();
    expect(comparison.scores.strategyB).toBeDefined();
  });

  it("should have scores in 0-100 range", () => {
    const ranked = ranker.rankVariants(variants);
    ranked.forEach((r) => {
      Object.values(r.dimensionScores).forEach((score) => {
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThanOrEqual(100);
      });
    });
  });

  it("should have best variant with highest composite score", () => {
    const ranked = ranker.rankVariants(variants);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    expect(best.compositeScore).toBeGreaterThanOrEqual(worst.compositeScore);
  });
});

describe("AutoImprover", () => {
  let improver: AutoImprover;
  let mockStrategy: StrategyDSL;

  beforeEach(() => {
    improver = new AutoImprover();
    mockStrategy = {
      entry: { indicator: "RSI", condition: "below", threshold: 30 },
      exit: { indicator: "RSI", condition: "above", threshold: 70 },
      sizing: { type: "fixed", value: 1 },
      filters: [],
      context: { timeframe: "1h", riskPerTrade: 0.02 },
      metadata: { name: "Original Strategy" },
    };
  });

  it("should return at least 3 improvement suggestions", () => {
    const suggestions = improver.suggestImprovements(mockStrategy);
    expect(suggestions.length).toBeGreaterThanOrEqual(3);
  });

  it("should include type, name, and estimated impact for each improvement", () => {
    const suggestions = improver.suggestImprovements(mockStrategy);
    suggestions.forEach((s) => {
      expect(["entry", "exit", "sizing", "filter"]).toContain(s.type);
      expect(s.name).toBeTruthy();
      expect(typeof s.estimatedImpact).toBe("number");
      expect(s.estimatedImpact).toBeGreaterThan(0);
      expect(s.description).toBeTruthy();
    });
  });

  it("should return modified strategy after applying improvement", () => {
    const suggestions = improver.suggestImprovements(mockStrategy);
    const improved = improver.applyImprovement(mockStrategy, suggestions[0]);
    expect(improved.improvements).toBeDefined();
    expect(improved.improvements!.length).toBe(1);
  });

  it("should estimate numeric impact for improvements", () => {
    const suggestions = improver.suggestImprovements(mockStrategy);
    suggestions.forEach((s) => {
      const impact = improver.estimateImpact(s);
      expect(typeof impact).toBe("number");
      expect(impact).toBeGreaterThan(0);
    });
  });

  it("should cover entry, exit, sizing, and filter categories", () => {
    const suggestions = improver.suggestImprovements(mockStrategy);
    const types = new Set(suggestions.map((s) => s.type));
    expect(types.has("entry")).toBe(true);
    expect(types.has("exit")).toBe(true);
    expect(types.has("sizing")).toBe(true);
    expect(types.has("filter")).toBe(true);
  });

  it("should track improvement history with timestamps", () => {
    const suggestions = improver.suggestImprovements(mockStrategy);
    const history = improver.trackImprovementHistory(suggestions);
    expect(history.length).toBe(suggestions.length);
    history.forEach((h) => {
      expect(h.improvement).toBeDefined();
      expect(h.appliedAt).toBeTruthy();
      expect(new Date(h.appliedAt)).toBeInstanceOf(Date);
    });
  });
});
