/**
 * quant/index.ts — GodsView Phase 3: QuantCore Super Intelligence
 *
 * Orchestrates the full quant reasoning pipeline:
 * - Pre-screen: rapid assessment before backtesting
 * - Post-backtest: deep analysis and improvement suggestions
 * - Rejection criteria: hard stop on obviously bad strategies
 *
 * This is the reasoning layer that separates real edges from noise.
 */

import { hypothesisEngine, type EdgeAssessment } from "./hypothesis_engine.js";
import { strategyCritic, type QuantReview } from "./strategy_critic.js";
import { variantRanker, type RobustnessScore, type RankedVariant } from "./variant_ranker.js";
import { autoImprover, type ImprovementPlan } from "./auto_improver.js";

// ── Pre-Screen Result ────────────────────────────────────────────────────────

export interface PreScreenResult {
  recommend: boolean;
  score: number; // 0-100
  reasoning: string[];
  warnings: string[];
  rejectionReason?: string;
}

// ── Post-Backtest Analysis ──────────────────────────────────────────────────

export interface PostAnalysis {
  critique: QuantReview;
  edgeAssessment: EdgeAssessment;
  improvementPlan: ImprovementPlan;
  overallAssessment: string;
  shouldDeploy: boolean;
  confidenceLevel: number; // 0-1
}

// ── Full Quant Analysis ─────────────────────────────────────────────────────

export interface QuantAnalysis {
  preScreen?: PreScreenResult;
  postBacktest?: PostAnalysis;
  edgeAssessment: EdgeAssessment;
  critique: QuantReview;
  improvements: ImprovementPlan;
  verdict: "STRONG_BUY" | "BUY" | "HOLD" | "SELL" | "REJECT";
  deploymentRecommendation: string;
  reasoning: string[];
}

// ── Rejection Criteria ──────────────────────────────────────────────────────

interface RejectionCriteria {
  reasons: string[];
  shouldReject: boolean;
}

// ── Main QuantCore Engine ──────────────────────────────────────────────────

class QuantCore {
  /**
   * Full quant analysis pipeline
   */
  async analyzeStrategy(strategy: any, backtestResults?: any): Promise<QuantAnalysis> {
    const reasoning: string[] = [];

    // Step 1: Edge assessment (hypothesis testing)
    reasoning.push("Testing edge hypotheses...");
    const edgeAssessment = hypothesisEngine.assessEdgeReality(strategy, backtestResults || {});

    // Step 2: Detailed critique
    reasoning.push("Conducting expert review...");
    const critique = strategyCritic.review(strategy, backtestResults);

    // Step 3: Improvement suggestions
    reasoning.push("Identifying improvements...");
    const improvements = autoImprover.improve(strategy, backtestResults);

    // Step 4: Synthesize verdict
    const verdict = this.synthesizeVerdict(edgeAssessment, critique, improvements);
    const deploymentRecommendation = this.generateDeploymentRec(verdict, critique, edgeAssessment);

    return {
      edgeAssessment,
      critique,
      improvements,
      verdict,
      deploymentRecommendation,
      reasoning,
    };
  }

  /**
   * Quick pre-screen before backtesting
   * Filters out obviously bad ideas early
   */
  preScreen(strategy: any): PreScreenResult {
    const reasoning: string[] = [];
    const warnings: string[] = [];
    let score = 80; // start optimistic

    // Check 1: Entry logic exists
    if (!strategy.entry || Object.keys(strategy.entry).length === 0) {
      score -= 30;
      warnings.push("No entry logic defined");
    } else {
      reasoning.push("Entry logic defined");
    }

    // Check 2: Exit strategy exists
    if (!strategy.exit || (!strategy.exit.stopLoss && !strategy.exit.profitTarget)) {
      score -= 25;
      warnings.push("No clear exit strategy (missing stop loss or profit target)");
    } else {
      reasoning.push("Exit strategy defined");
    }

    // Check 3: Risk/reward ratio
    const pt = strategy.exit?.profitTarget || 1;
    const sl = strategy.exit?.stopLoss || 1;
    if (pt < sl * 0.8) {
      score -= 20;
      warnings.push(`Poor risk/reward: PT ${pt} < SL ${sl} * 1.25`);
    } else if (pt >= sl * 1.5) {
      reasoning.push("Good risk/reward ratio");
    }

    // Check 4: Parameter count
    const paramCount = strategy.parameterCount || 5;
    if (paramCount > 20) {
      score -= 25;
      warnings.push(`Too many parameters (${paramCount}) - high overfitting risk`);
    } else if (paramCount <= 3) {
      reasoning.push("Simple parameter set - low overfitting risk");
    }

    // Check 5: Has theoretical basis
    const theoryStr = JSON.stringify(strategy).toLowerCase();
    if (!theoryStr.includes("mean_reversion") && !theoryStr.includes("momentum") && !theoryStr.includes("regime")) {
      warnings.push("Unclear market mechanism - what edge is being exploited?");
      score -= 15;
    } else {
      reasoning.push("Clear market mechanism identified");
    }

    // Check 6: Trading frequency (not too rare, not too often)
    const estimatedTradesPerYear = strategy.estimatedTradesPerYear || 100;
    if (estimatedTradesPerYear < 20) {
      warnings.push(`Low trade frequency (${estimatedTradesPerYear}/year) - hard to assess edge`);
      score -= 10;
    } else if (estimatedTradesPerYear > 5000) {
      warnings.push(`Very high frequency (${estimatedTradesPerYear}/year) - noise risk, slippage impact`);
      score -= 15;
    } else {
      reasoning.push(`Good trade frequency: ${estimatedTradesPerYear}/year`);
    }

    // Decision
    const recommend = score >= 60 && warnings.length < 3;

    return {
      recommend,
      score: Math.max(0, score),
      reasoning,
      warnings,
      rejectionReason: recommend ? undefined : `Strategy scored ${score.toFixed(0)} and has ${warnings.length} major issues`,
    };
  }

  /**
   * Post-backtest deep analysis
   */
  postBacktestAnalysis(strategy: any, results: any): PostAnalysis {
    // Run all three engines
    const critique = strategyCritic.review(strategy, results);
    const edgeAssessment = hypothesisEngine.assessEdgeReality(strategy, results);
    const improvementPlan = autoImprover.improve(strategy, results);

    // Synthesize overall assessment
    const hasRedFlags = critique.grade === "D" || critique.grade === "F";
    const hasWeakEdge = edgeAssessment.noiseRisk > 0.6;
    const hasSeriosDrawdown = results.maxDrawdown > 0.35;

    let overallAssessment = "";
    let shouldDeploy = true;
    let confidenceLevel = 1.0;

    if (hasRedFlags) {
      overallAssessment = "CRITICAL ISSUES: Strategy has fundamental flaws. Do NOT deploy.";
      shouldDeploy = false;
      confidenceLevel = 0.1;
    } else if (hasWeakEdge && hasSeriosDrawdown) {
      overallAssessment = "RISKY: Edge is weak and drawdown is high. Only deploy in portfolio context with position sizing.";
      shouldDeploy = true;
      confidenceLevel = 0.4;
    } else if (hasWeakEdge) {
      overallAssessment = "MODERATE: Edge exists but is not robust. Deploy with caution, monitor closely.";
      shouldDeploy = true;
      confidenceLevel = 0.55;