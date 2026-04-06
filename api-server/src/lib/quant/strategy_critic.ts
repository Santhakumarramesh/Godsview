/**
 * strategy_critic.ts — GodsView Quant Reasoning: Internal Strategy Review
 *
 * Deep quant review like a professional quant researcher would do.
 * Challenges each component, identifies hidden assumptions, red-teams the strategy.
 *
 * Key responsibilities:
 * - Comprehensive review scoring (A-F grades)
 * - Challenge each strategy component (entry, exit, filters, sizing)
 * - Red team: find breaking conditions and worst-case scenarios
 * - Answer "why NOT trade this?"
 */

export type ReviewGrade = "A" | "B" | "C" | "D" | "F";

export interface Challenge {
  component: string;
  issue: string;
  severity: "critical" | "major" | "minor" | "suggestion";
  suggestedFix: string;
}

export interface TheoreticaBasis {
  score: number; // 0-100
  reasoning: string;
  marketInefficiency: string;
  whyOthersAreLate: string;
  durabilityEstimate: string;
}

export interface BacktestTrust {
  score: number; // 0-100
  concerns: string[];
  overfitIndicators: string[];
  dataSnoopingRisk: number; // 0-1
}

export interface RiskProfile {
  maxDrawdownEstimate: number;
  tailRisk: number; // 0-1
  correlationWithMarket: number; // -1 to 1
  regimeDependence: number; // 0-1: how much does it depend on regime
  liquidityRisk: number; // 0-1: can we get in/out reliably
}

export interface QuantReview {
  grade: ReviewGrade;
  score: number; // 0-100
  theoreticalBasis: TheoreticaBasis;
  backtestTrust: BacktestTrust;
  riskProfile: RiskProfile;
  challenges: Challenge[];
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
  improvementSuggestions: string[];
}

export interface AttackVector {
  name: string;
  mechanism: string;
  probability: number; // 0-1
  impact: string;
}

export interface Scenario {
  name: string;
  description: string;
  probability: number;
  expectedLoss: number; // %
  recoveryTime: string; // estimated months to recover
}

export interface RedTeamReport {
  attackVectors: AttackVector[];
  worstCaseScenarios: Scenario[];
  hiddenAssumptions: string[];
  breakingConditions: string[];
  survivalProbability: number; // 0-1: probability survives next 12 months
}

export interface WhyNotReport {
  shouldTrade: boolean;
  blockingReasons: string[];
  riskReward: number; // expected reward / risk ratio
  recommendation: string;
  alternatives: string[]; // what else to trade instead
}

class StrategyCritic {
  /**
   * Full review like a quant researcher would do
   */
  review(strategy: any, backtestResults?: any): QuantReview {
    const results = backtestResults || {};

    // Compute theoretical basis
    const theoreticalBasis = this.assessTheoretical(strategy);

    // Assess backtest trust
    const backtestTrust = this.assessBacktestTrust(strategy, results);

    // Analyze risk profile
    const riskProfile = this.analyzeRisk(strategy, results);

    // Challenge components
    const challenges: Challenge[] = [];
    challenges.push(...this.challengeEntry(strategy.entry));
    challenges.push(...this.challengeExit(strategy.exit));
    challenges.push(...this.challengeFilters(strategy.filters));
    challenges.push(...this.challengeSizing(strategy.sizing));

    // Identify strengths
    const strengths = this.identifyStrengths(strategy, results);

    // Identify weaknesses
    const weaknesses = this.identifyWeaknesses(strategy, results, challenges);

    // Compute grade
    const score = this.computeScore(theoreticalBasis, backtestTrust, riskProfile, challenges);
    const grade = this.gradeFromScore(score);

    // Generate recommendation
    const recommendation = this.generateRecommendation(grade, score, challenges, theoreticalBasis);

    // Improvement suggestions
    const improvementSuggestions = this.suggestImprovements(strategy, challenges);

    return {
      grade,
      score,
      theoreticalBasis,
      backtestTrust,
      riskProfile,
      challenges,
      strengths,
      weaknesses,
      recommendation,
      improvementSuggestions,
    };
  }

  /**
   * Challenge entry setup
   */
  challengeEntry(entry: any): Challenge[] {
    const challenges: Challenge[] = [];

    if (!entry) {
      return challenges;
    }

    // Check for look-ahead bias
    if (this.hasLookAheadBias(entry)) {
      challenges.push({
        component: "entry",
        issue: "Look-ahead bias detected: signal uses future bars or prices",
        severity: "critical",
        suggestedFix: "Shift signal back one bar or use only confirmed data",
      });
    }

    // Check for entry timing
    if (!entry.timing) {
      challenges.push({
        component: "entry",
        issue: "Entry timing undefined: when exactly in the bar?",
        severity: "major",
        suggestedFix: "Specify: open, close, limit price, market order timing",
      });
    }

    // Check for over-parameterization
    const paramCount = this.countParameters(entry);
    if (paramCount > 5) {
      challenges.push({
        component: "entry",
        issue: `Entry has ${paramCount} parameters - high overfitting risk`,
        severity: "major",
        suggestedFix: "Reduce to 2-3 core parameters, test others separately",
      });
    }

    // Check for signal independence
    if (this.hasRedundantSignals(entry)) {
      challenges.push({
        component: "entry",
        issue: "Entry signals are correlated - redundant information",
        severity: "minor",
        suggestedFix: "Remove correlated signals, keep orthogonal ones",
      });
    }

    return challenges;
  }

  /**
   * Challenge exit setup
   */