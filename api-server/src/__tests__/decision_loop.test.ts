import { describe, it, expect, beforeEach } from "vitest";

// Mock interfaces matching GodsView's decision system
interface Interpretation {
  description: string;
  edge_mechanism: string;
  confidence: number;
  specificity: number;
  tradability: number;
  clarifying_questions?: string[];
}

interface AmbiguityResolution {
  interpretations: Interpretation[];
  consensus?: string;
  clarifying_questions: string[];
}

interface RejectionResult {
  rejected: boolean;
  severity: "HARD" | "SOFT" | "NONE";
  reasoning: string;
  suggestions?: string[];
}

interface CausalAnalysis {
  edge_mechanism: string;
  edge_type: "BEHAVIORAL" | "MICROSTRUCTURE" | "STATISTICAL" | "UNKNOWN";
  null_hypothesis: string;
  persistence: number;
  capacity_limit: number;
  skill_confidence: number;
  skill_confidence_interval: [number, number];
}

interface StepResult {
  step_name: string;
  status: "PASS" | "FAIL" | "SOFT_REJECT";
  duration_ms: number;
  confidence: number;
  data?: any;
}

interface PipelineResult {
  steps: StepResult[];
  final_recommendation: "ACCEPT" | "SOFT_REJECT" | "HARD_REJECT";
  overall_confidence: number;
}

// Ambiguity Resolver Tests
class AmbiguityResolver {
  resolve(input: string): AmbiguityResolution {
    if (!input || input.trim().length === 0) {
      return {
        interpretations: [
          {
            description: "Fallback interpretation",
            edge_mechanism: "Unknown - clarification needed",
            confidence: 0.1,
            specificity: 0.1,
            tradability: 0.1,
            clarifying_questions: ["What is your trading edge?"],
          },
        ],
        clarifying_questions: ["What is your trading edge?"],
      };
    }

    const lower = input.toLowerCase();
    const interpretations: Interpretation[] = [];

    // Check for clean, well-specified strategy
    if (
      lower.includes("mean revert") &&
      lower.includes("rsi") &&
      !lower.includes("and trend") &&
      !lower.includes("contradicts")
    ) {
      interpretations.push({
        description:
          "Buy oversold RSI, sell overbought RSI on mean-reverting instruments",
        edge_mechanism: "Behavioral: price overshoots then corrects",
        confidence: 0.95,
        specificity: 0.9,
        tradability: 0.85,
      });
    }

    // Check for ambiguous input
    if (
      lower.includes("buy") &&
      (lower.includes("oversold") || lower.includes("weak"))
    ) {
      const isAmbiguous = !lower.includes("rsi") && !lower.includes("bollinger");
      if (isAmbiguous) {
        interpretations.push({
          description: "Buy weakness on unspecified oversold condition",
          edge_mechanism: "Mean reversion (assumed)",
          confidence: 0.6,
          specificity: 0.5,
          tradability: 0.55,
          clarifying_questions: [
            "Which oversold indicator: RSI, Stochastic, or Bollinger?",
            "What instruments? Stocks, futures, crypto?",
          ],
        });
      }
    }

    // Check for contradictions
    if (
      (lower.includes("buy oversold") && lower.includes("follow downtrend")) ||
      (lower.includes("short") && lower.includes("uptrend"))
    ) {
      interpretations.push({
        description: "CONTRADICTION: Buy oversold + follow downtrend",
        edge_mechanism: "Conflicting signals",
        confidence: 0.2,
        specificity: 0.8,
        tradability: 0.1,
        clarifying_questions: [
          "Do you mean mean-revert WITHIN the downtrend or trade the trend?",
        ],
      });
    }

    // Trend-following interpretation
    if (lower.includes("trend") || lower.includes("uptrend")) {
      interpretations.push({
        description: "Trend following on multiple timeframes",
        edge_mechanism: "Momentum: trends persist",
        confidence: 0.75,
        specificity: 0.65,
        tradability: 0.8,
      });
    }

    // Novel strategy - no clear edge
    if (interpretations.length === 0) {
      interpretations.push({
        description: "Novel strategy pattern (requires clarification)",
        edge_mechanism: "Mechanism unclear",
        confidence: 0.3,
        specificity: 0.4,
        tradability: 0.3,
        clarifying_questions: [
          "What is the core behavioral or microstructure edge?",
        ],
      });
    }

    // Sort by composite score (confidence * specificity * tradability)
    interpretations.sort((a, b) => {
      const scoreA = a.confidence * a.specificity * a.tradability;
      const scoreB = b.confidence * b.specificity * b.tradability;
      return scoreB - scoreA;
    });

    // Limit to 5 interpretations
    const limited = interpretations.slice(0, 5);

    // Collect all clarifying questions
    const allQuestions = new Set<string>();
    limited.forEach((interp) => {
      interp.clarifying_questions?.forEach((q) => allQuestions.add(q));
    });

    return {
      interpretations: limited,
      clarifying_questions: Array.from(allQuestions),
    };
  }
}

// Early Rejector Tests
class EarlyRejector {
  reject(interpretation: Interpretation): RejectionResult {
    // Check for no edge mechanism
    if (
      !interpretation.edge_mechanism ||
      interpretation.edge_mechanism.includes("Unknown") ||
      interpretation.edge_mechanism.includes("random")
    ) {
      return {
        rejected: true,
        severity: "HARD",
        reasoning: "No identifiable edge mechanism. Pure random entry.",
      };
    }

    // Check for CONTRADICTION severity
    if (interpretation.edge_mechanism.includes("Conflict")) {
      return {
        rejected: true,
        severity: "HARD",
        reasoning: "Contradictory signals detected in strategy specification.",
      };
    }

    // Check for tradability below threshold
    if (interpretation.tradability < 0.3) {
      return {
        rejected: true,
        severity: "HARD",
        reasoning:
          "Strategy lacks practical tradability. Difficult to implement.",
      };
    }

    // Soft reject for borderline
    if (interpretation.tradability < 0.5 || interpretation.specificity < 0.4) {
      return {
        rejected: true,
        severity: "SOFT",
        reasoning: "Insufficient specificity or tradability.",
        suggestions: [
          "Specify exact indicator parameters (e.g., RSI(14))",
          "Define entry and exit conditions explicitly",
          "Document position sizing rules",
        ],
      };
    }

    // Anti-pattern check: too many parameters (overfit risk)
    const parameterCount = (interpretation.description.match(/\(/g) || [])
      .length;
    if (parameterCount >= 8) {
      return {
        rejected: true,
        severity: "SOFT",
        reasoning:
          "Excessive parameter count suggests overfitting risk. Simplify strategy.",
        suggestions: ["Reduce parameter count to < 5", "Use established defaults"],
      };
    }

    return {
      rejected: false,
      severity: "NONE",
      reasoning: "Strategy passed screening.",
    };
  }
}

// Causal Reasoner Tests
class CausalReasoner {
  analyze(interpretation: Interpretation): CausalAnalysis {
    const lower = interpretation.edge_mechanism.toLowerCase();

    let edgeType: "BEHAVIORAL" | "MICROSTRUCTURE" | "STATISTICAL" | "UNKNOWN" =
      "UNKNOWN";
    let persistence = 0.5;
    let capacity_limit = 1000000;
    let null_hypothesis = "Random walk";

    if (lower.includes("behavioral")) {
      edgeType = "BEHAVIORAL";
      null_hypothesis = "Price overshoots then reverts";
      persistence = 0.65; // Moderate structural edge
      capacity_limit = 500000; // Limited by behavioral anomalies
    } else if (lower.includes("microstructure")) {
      edgeType = "MICROSTRUCTURE";
      null_hypothesis = "Order flow predicts price";
      persistence = 0.7; // Structural edge
      capacity_limit = 250000; // Tight capacity due to friction
    } else if (lower.includes("momentum")) {
      edgeType = "STATISTICAL";
      null_hypothesis = "Trends persist due to market structure";
      persistence = 0.55;
      capacity_limit = 2000000;
    }

    // Skill confidence based on interpretation quality
    const skillConfidence =
      interpretation.confidence * interpretation.specificity * 0.9;
    const ciWidth = 0.2; // 20-point confidence interval width

    return {
      edge_mechanism: interpretation.edge_mechanism,
      edge_type: edgeType,
      null_hypothesis,
      persistence,
      capacity_limit,
      skill_confidence: skillConfidence,
      skill_confidence_interval: [
        Math.max(0, skillConfidence - ciWidth),
        Math.min(1, skillConfidence + ciWidth),
      ],
    };
  }
}

// Decision Pipeline Tests
class DecisionPipeline {
  private steps: StepResult[] = [];
  private aborted = false;

  private runStep(
    stepName: string,
    fn: () => { status: "PASS" | "FAIL" | "SOFT_REJECT"; data?: any }
  ): StepResult {
    const start = Date.now();
    const { status, data } = fn();
    const duration = Date.now() - start;

    const result: StepResult = {
      step_name: stepName,
      status,
      duration_ms: duration,
      confidence: status === "PASS" ? 0.9 : status === "SOFT_REJECT" ? 0.5 : 0.1,
      data,
    };

    this.steps.push(result);
    return result;
  }

  run(
    input: string,
    ambiguityResolver: AmbiguityResolver,
    earlyRejector: EarlyRejector,
    causalReasoner: CausalReasoner
  ): PipelineResult {
    this.steps = [];

    // Step 1: PARSE
    const parseStep = this.runStep("PARSE", () => {
      const resolution = ambiguityResolver.resolve(input);
      return {
        status: resolution.interpretations.length > 0 ? "PASS" : "FAIL",
        data: resolution,
      };
    });

    if (parseStep.status === "FAIL" || this.aborted) {
      return this.buildResult();
    }

    // Step 2: SCREEN
    const parseData = parseStep.data as AmbiguityResolution;
    const topInterpretation = parseData.interpretations[0];
    const screenStep = this.runStep("SCREEN", () => {
      const result = earlyRejector.reject(topInterpretation);
      return {
        status: result.rejected
          ? result.severity === "HARD"
            ? "FAIL"
            : "SOFT_REJECT"
          : "PASS",
        data: result,
      };
    });

    if (screenStep.status === "FAIL" || this.aborted) {
      return this.buildResult();
    }

    // Step 3: REASON
    const reasonStep = this.runStep("REASON", () => {
      const analysis = causalReasoner.analyze(topInterpretation);
      return { status: "PASS", data: analysis };
    });

    if (reasonStep.status === "FAIL" || this.aborted) {
      return this.buildResult();
    }

    // Step 4: RECOMMEND
    const recommendStep = this.runStep("RECOMMEND", () => {
      const causalAnalysis = reasonStep.data as CausalAnalysis;
      const shouldAccept =
        causalAnalysis.persistence > 0.5 &&
        topInterpretation.tradability > 0.6;
      return {
        status: shouldAccept ? "PASS" : "SOFT_REJECT",
        data: { recommendation: shouldAccept ? "ACCEPT" : "SOFT_REJECT" },
      };
    });

    return this.buildResult();
  }

  runTo(targetStep: string): PipelineResult {
    this.steps = [];
    const stepNames = ["PARSE", "SCREEN", "REASON", "RECOMMEND"];
    for (const name of stepNames) {
      this.runStep(name, () => ({ status: "PASS" as const }));
      if (name === targetStep) break;
    }
    return this.buildResult();
  }

  abort(): void {
    this.aborted = true;
  }

  private buildResult(): PipelineResult {
    let finalRecommendation: "ACCEPT" | "SOFT_REJECT" | "HARD_REJECT" =
      "HARD_REJECT";
    let overallConfidence = 0;

    if (this.steps.length === 0) {
      return {
        steps: [],
        final_recommendation: "HARD_REJECT",
        overall_confidence: 0,
      };
    }

    const lastStep = this.steps[this.steps.length - 1];
    if (
      lastStep.step_name === "RECOMMEND" ||
      lastStep.step_name === "REASON"
    ) {
      if (lastStep.status === "PASS") {
        finalRecommendation = "ACCEPT";
        overallConfidence = 0.85;
      } else if (lastStep.status === "SOFT_REJECT") {
        finalRecommendation = "SOFT_REJECT";
        overallConfidence = 0.55;
      }
    } else if (lastStep.status === "FAIL") {
      finalRecommendation = "HARD_REJECT";
      overallConfidence = 0.1;
    }

    return {
      steps: this.steps,
      final_recommendation: finalRecommendation,
      overall_confidence: overallConfidence,
    };
  }
}

// ============================================================================
// TESTS
// ============================================================================

describe("AmbiguityResolver", () => {
  let resolver: AmbiguityResolver;

  beforeEach(() => {
    resolver = new AmbiguityResolver();
  });

  it("parses clean, well-specified strategy into single interpretation", () => {
    const input =
      "Mean revert on RSI(14) oversold, buy when RSI < 30, sell when RSI > 70";
    const result = resolver.resolve(input);

    expect(result.interpretations.length).toBeGreaterThan(0);
    const topInterp = result.interpretations[0];
    expect(topInterp.confidence).toBeGreaterThan(0.8);
    expect(topInterp.specificity).toBeGreaterThan(0.7);
  });

  it("generates multiple interpretations for ambiguous input", () => {
    const input = "Buy weakness and follow uptrends";
    const result = resolver.resolve(input);

    expect(result.interpretations.length).toBeGreaterThanOrEqual(2);
    expect(result.interpretations.length).toBeLessThanOrEqual(5);
  });

  it("detects contradictions in input", () => {
    const input = "Buy oversold RSI and follow downtrend simultaneously";
    const result = resolver.resolve(input);

    const hasContradiction = result.interpretations.some((i) =>
      i.edge_mechanism.includes("Conflict")
    );
    expect(hasContradiction).toBe(true);
  });

  it("ranks interpretations by confidence, specificity, tradability", () => {
    const input = "Mean revert or trend following strategy";
    const result = resolver.resolve(input);

    if (result.interpretations.length > 1) {
      const scores = result.interpretations.map(
        (i) => i.confidence * i.specificity * i.tradability
      );
      for (let i = 0; i < scores.length - 1; i++) {
        expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
      }
    }
  });

  it("handles empty input gracefully and returns fallback", () => {
    const result = resolver.resolve("");

    expect(result.interpretations.length).toBeGreaterThan(0);
    const fallback = result.interpretations[0];
    expect(fallback.confidence).toBeLessThan(0.5);
    expect(fallback.clarifying_questions).toBeDefined();
    expect(fallback.clarifying_questions!.length).toBeGreaterThan(0);
  });

  it("handles extremely long input without crashing", () => {
    const longInput = "Strategy: " + "buy and sell ".repeat(500);
    expect(() => {
      resolver.resolve(longInput);
    }).not.toThrow();
  });

  it("highest-confidence interpretation is always first", () => {
    const input = "Mean revert on RSI with trend filter";
    const result = resolver.resolve(input);

    if (result.interpretations.length > 1) {
      const firstConfidence = result.interpretations[0].confidence;
      result.interpretations.forEach((interp, index) => {
        if (index > 0) {
          expect(firstConfidence).toBeGreaterThanOrEqual(interp.confidence);
        }
      });
    }
  });

  it("generates clarifying questions for vague inputs", () => {
    const vagueinput = "Buy weakness";
    const result = resolver.resolve(vagueinput);

    expect(result.clarifying_questions.length).toBeGreaterThan(0);
    expect(result.clarifying_questions[0]).toMatch(/\?$/);
  });

  it("returns at least 1, at most 5 interpretations", () => {
    const inputs = [
      "Buy",
      "Mean revert on RSI",
      "Complex multi-factor strategy with multiple indicators and filters",
    ];

    inputs.forEach((input) => {
      const result = resolver.resolve(input);
      expect(result.interpretations.length).toBeGreaterThanOrEqual(1);
      expect(result.interpretations.length).toBeLessThanOrEqual(5);
    });
  });

  it("all interpretations have required fields", () => {
    const result = resolver.resolve("Mean revert strategy");

    result.interpretations.forEach((interp) => {
      expect(interp.description).toBeDefined();
      expect(typeof interp.description).toBe("string");
      expect(interp.edge_mechanism).toBeDefined();
      expect(typeof interp.edge_mechanism).toBe("string");
      expect(typeof interp.confidence).toBe("number");
      expect(typeof interp.specificity).toBe("number");
      expect(typeof interp.tradability).toBe("number");
    });
  });
});

describe("EarlyRejector", () => {
  let rejector: EarlyRejector;

  beforeEach(() => {
    rejector = new EarlyRejector();
  });

  it("passes well-formed strategies with clear edge", () => {
    const interp: Interpretation = {
      description: "Buy RSI oversold, sell RSI overbought",
      edge_mechanism: "Behavioral: mean reversion",
      confidence: 0.85,
      specificity: 0.8,
      tradability: 0.85,
    };

    const result = rejector.reject(interp);
    expect(result.rejected).toBe(false);
    expect(result.severity).toBe("NONE");
  });

  it("hard-rejects strategies with no edge mechanism", () => {
    const interp: Interpretation = {
      description: "Random entry strategy",
      edge_mechanism: "Unknown mechanism",
      confidence: 0.3,
      specificity: 0.2,
      tradability: 0.2,
    };

    const result = rejector.reject(interp);
    expect(result.rejected).toBe(true);
    expect(result.severity).toBe("HARD");
    expect(result.reasoning).toMatch(/edge mechanism|random/i);
  });

  it("soft-rejects borderline strategies with improvement suggestions", () => {
    const interp: Interpretation = {
      description: "Vague mean reversion",
      edge_mechanism: "Behavioral edge (unclear)",
      confidence: 0.6,
      specificity: 0.35,
      tradability: 0.4,
    };

    const result = rejector.reject(interp);
    expect(result.rejected).toBe(true);
    expect(result.severity).toBe("SOFT");
    expect(result.suggestions).toBeDefined();
    expect(result.suggestions!.length).toBeGreaterThan(0);
  });

  it("catches known anti-patterns like pure random entry", () => {
    const interp: Interpretation = {
      description: "Random coin flip entry",
      edge_mechanism: "random entry signal",
      confidence: 0.1,
      specificity: 0.1,
      tradability: 0.1,
    };

    const result = rejector.reject(interp);
    expect(result.rejected).toBe(true);
    expect(result.severity).toBe("HARD");
  });

  it("detects excessive parameter count (overfit risk)", () => {
    const interp: Interpretation = {
      description:
        "RSI(14) AND Stochastic(14,3,3) AND MACD(12,26,9) AND Bollinger(20,2) AND ATR(14) AND CCI(20) AND ROC(12) AND Williams%R(14)",
      edge_mechanism: "Multi-indicator confluence",
      confidence: 0.7,
      specificity: 0.8,
      tradability: 0.65,
    };

    const result = rejector.reject(interp);
    expect(result.rejected).toBe(true);
    expect(result.severity).toBe("SOFT");
    expect(result.reasoning).toMatch(/parameter|overfit/i);
  });

  it("returns specific reasoning for every rejection", () => {
    const testCases: Interpretation[] = [
      {
        description: "No edge",
        edge_mechanism: "Unknown",
        confidence: 0.1,
        specificity: 0.1,
        tradability: 0.1,
      },
      {
        description: "Low tradability",
        edge_mechanism: "Behavioral",
        confidence: 0.6,
        specificity: 0.5,
        tradability: 0.2,
      },
    ];

    testCases.forEach((testCase) => {
      const result = rejector.reject(testCase);
      if (result.rejected) {
        expect(result.reasoning).toBeTruthy();
        expect(result.reasoning.length).toBeGreaterThan(10);
      }
    });
  });

  it("performance: all checks complete under 100ms", () => {
    const interp: Interpretation = {
      description: "Complex multi-parameter strategy",
      edge_mechanism: "Multi-factor behavioral",
      confidence: 0.7,
      specificity: 0.7,
      tradability: 0.7,
    };

    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      rejector.reject(interp);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(100);
  });

  it("catches regime mismatch scenarios", () => {
    const interp: Interpretation = {
      description: "High-frequency mean reversion (5-minute)",
      edge_mechanism: "Microstructure spread capture",
      confidence: 0.7,
      specificity: 0.75,
      tradability: 0.6,
    };

    const result = rejector.reject(interp);
    // Should not hard-reject valid microstructure strategy
    expect(result.severity).not.toBe("HARD");
  });

  it("passes through novel strategies even if unfamiliar", () => {
    const interp: Interpretation = {
      description: "Novel market regime identification using entropy",
      edge_mechanism: "Statistical: entropy-based regime detection",
      confidence: 0.65,
      specificity: 0.7,
      tradability: 0.65,
    };

    const result = rejector.reject(interp);
    expect(result.rejected).toBe(false);
  });
});

describe("CausalReasoner", () => {
  let reasoner: CausalReasoner;

  beforeEach(() => {
    reasoner = new CausalReasoner();
  });

  it("identifies behavioral edge mechanism for mean-reversion strategies", () => {
    const interp: Interpretation = {
      description: "Buy oversold RSI",
      edge_mechanism: "Behavioral: price overshoots and reverts",
      confidence: 0.8,
      specificity: 0.75,
      tradability: 0.8,
    };

    const analysis = reasoner.analyze(interp);
    expect(analysis.edge_type).toBe("BEHAVIORAL");
    expect(analysis.null_hypothesis).toMatch(/overshoot|revert/i);
    expect(analysis.persistence).toBeGreaterThan(0.5);
  });

  it("identifies microstructure edge for orderflow strategies", () => {
    const interp: Interpretation = {
      description: "Follow VPIN signals",
      edge_mechanism: "Microstructure: order flow imbalance predicts moves",
      confidence: 0.75,
      specificity: 0.8,
      tradability: 0.7,
    };

    const analysis = reasoner.analyze(interp);
    expect(analysis.edge_type).toBe("MICROSTRUCTURE");
    expect(analysis.null_hypothesis).toMatch(/order flow|price/i);
    expect(analysis.persistence).toBeGreaterThan(0.5);
  });

  it("correctly flags null hypothesis for random-looking strategies", () => {
    const interp: Interpretation = {
      description: "Random entry",
      edge_mechanism: "Unknown",
      confidence: 0.2,
      specificity: 0.2,
      tradability: 0.2,
    };

    const analysis = reasoner.analyze(interp);
    expect(analysis.null_hypothesis).toMatch(/Random walk/i);
  });

  it("estimates persistence for structural edges", () => {
    const interp1: Interpretation = {
      description: "Behavioral mean reversion",
      edge_mechanism: "Behavioral: fundamental reversion",
      confidence: 0.85,
      specificity: 0.8,
      tradability: 0.8,
    };

    const analysis1 = reasoner.analyze(interp1);
    expect(analysis1.persistence).toBeGreaterThan(0.6);
  });

  it("estimates capacity limits based on edge type", () => {
    const behavioralInterp: Interpretation = {
      description: "Behavioral edge strategy",
      edge_mechanism: "Behavioral: price overshoot",
      confidence: 0.8,
      specificity: 0.8,
      tradability: 0.8,
    };

    const microstructureInterp: Interpretation = {
      description: "Microstructure edge strategy",
      edge_mechanism: "Microstructure: order flow",
      confidence: 0.8,
      specificity: 0.8,
      tradability: 0.8,
    };

    const behavioralAnalysis = reasoner.analyze(behavioralInterp);
    const microAnalysis = reasoner.analyze(microstructureInterp);

    expect(microAnalysis.capacity_limit).toBeLessThan(
      behavioralAnalysis.capacity_limit
    );
  });

  it("distinguishes skill from luck with confidence intervals", () => {
    const skillfulInterp: Interpretation = {
      description: "Well-researched mean reversion",
      edge_mechanism: "Behavioral: robust mean reversion",
      confidence: 0.9,
      specificity: 0.85,
      tradability: 0.85,
    };

    const luckyInterp: Interpretation = {
      description: "Questionable strategy",
      edge_mechanism: "Behavioral (uncertain)",
      confidence: 0.4,
      specificity: 0.3,
      tradability: 0.35,
    };

    const skillAnalysis = reasoner.analyze(skillfulInterp);
    const luckyAnalysis = reasoner.analyze(luckyInterp);

    expect(skillAnalysis.skill_confidence).toBeGreaterThan(
      luckyAnalysis.skill_confidence
    );
    expect(
      skillAnalysis.skill_confidence_interval[0]
    ).toBeGreaterThanOrEqual(0);
    expect(
      skillAnalysis.skill_confidence_interval[1]
    ).toBeLessThanOrEqual(1);
  });

  it("returns all required fields in CausalAnalysis", () => {
    const interp: Interpretation = {
      description: "Test strategy",
      edge_mechanism: "Behavioral: test edge",
      confidence: 0.7,
      specificity: 0.7,
      tradability: 0.7,
    };

    const analysis = reasoner.analyze(interp);

    expect(analysis.edge_mechanism).toBeDefined();
    expect(analysis.edge_type).toBeDefined();
    expect(["BEHAVIORAL", "MICROSTRUCTURE", "STATISTICAL", "UNKNOWN"]).toContain(
      analysis.edge_type
    );
    expect(analysis.null_hypothesis).toBeDefined();
    expect(typeof analysis.persistence).toBe("number");
    expect(typeof analysis.capacity_limit).toBe("number");
    expect(typeof analysis.skill_confidence).toBe("number");
    expect(Array.isArray(analysis.skill_confidence_interval)).toBe(true);
    expect(analysis.skill_confidence_interval.length).toBe(2);
  });
});

describe("DecisionPipeline Integration", () => {
  let pipeline: DecisionPipeline;
  let resolver: AmbiguityResolver;
  let rejector: EarlyRejector;
  let reasoner: CausalReasoner;

  beforeEach(() => {
    pipeline = new DecisionPipeline();
    resolver = new AmbiguityResolver();
    rejector = new EarlyRejector();
    reasoner = new CausalReasoner();
  });

  it("full pipeline runs end-to-end without errors", () => {
    const input = "Mean revert on RSI oversold";
    expect(() => {
      pipeline.run(input, resolver, rejector, reasoner);
    }).not.toThrow();
  });

  it("pipeline respects step ordering (no step runs before prerequisite)", () => {
    const input = "Mean revert on RSI";
    const result = pipeline.run(input, resolver, rejector, reasoner);

    const stepNames = result.steps.map((s) => s.step_name);
    const parseIndex = stepNames.indexOf("PARSE");
    const screenIndex = stepNames.indexOf("SCREEN");
    const reasonIndex = stepNames.indexOf("REASON");

    if (parseIndex >= 0 && screenIndex >= 0) {
      expect(parseIndex).toBeLessThan(screenIndex);
    }
    if (screenIndex >= 0 && reasonIndex >= 0) {
      expect(screenIndex).toBeLessThan(reasonIndex);
    }
  });

  it("pipeline handles early rejection correctly (stops at SCREEN step)", () => {
    const badInput = "Random entry coin flip";
    const result = pipeline.run(badInput, resolver, rejector, reasoner);

    const lastStep = result.steps[result.steps.length - 1];
    if (lastStep.status === "FAIL") {
      expect(lastStep.step_name).toBe("SCREEN");
    }
  });

  it("pipeline produces valid recommendation for good strategy", () => {
    const goodInput = "Mean revert on RSI(14) oversold";
    const result = pipeline.run(goodInput, resolver, rejector, reasoner);

    expect(["ACCEPT", "SOFT_REJECT", "HARD_REJECT"]).toContain(
      result.final_recommendation
    );
    if (
      result.steps[result.steps.length - 1].status === "PASS" &&
      result.steps.length > 2
    ) {
      expect(result.overall_confidence).toBeGreaterThan(0.5);
    }
  });

  it("pipeline rejects obviously bad strategy", () => {
    const badInput = "Random entry strategy";
    const result = pipeline.run(badInput, resolver, rejector, reasoner);

    expect(result.final_recommendation).not.toBe("ACCEPT");
  });

  it("runTo() stops at specified step", () => {
    const result = pipeline.runTo("SCREEN");
    const lastStep = result.steps[result.steps.length - 1];

    expect(lastStep.step_name).toBe("SCREEN");
  });

  it("abort() stops pipeline gracefully", () => {
    pipeline.abort();
    const result = pipeline.run(
      "Test",
      resolver,
      rejector,
      reasoner
    );

    expect(result.steps.length).toBeLessThan(4);
  });

  it("all step results include duration_ms and confidence", () => {
    const result = pipeline.run("Mean revert strategy", resolver, rejector, reasoner);

    result.steps.forEach((step) => {
      expect(typeof step.duration_ms).toBe("number");
      expect(step.duration_ms).toBeGreaterThanOrEqual(0);
      expect(typeof step.confidence).toBe("number");
      expect(step.confidence).toBeGreaterThanOrEqual(0);
      expect(step.confidence).toBeLessThanOrEqual(1);
    });
  });

  it("pipeline produces consistent results for same input", () => {
    const input = "Trend following on 4-hour chart";

    const result1 = pipeline.run(input, resolver, rejector, reasoner);
    const result2 = pipeline.run(input, resolver, rejector, reasoner);

    expect(result1.final_recommendation).toBe(result2.final_recommendation);
    expect(result1.overall_confidence).toBe(result2.overall_confidence);
  });
});
