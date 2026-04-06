/**
 * Strategy Lab - Main Orchestrator
 *
 * Coordinates the full pipeline:
 * 1. Natural language input
 * 2. Parse to StrategyDSL
 * 3. Critique for quality
 * 4. Generate variants
 * 5. Rank and recommend
 */

import { StrategyParser, ParseResult } from './strategy_parser';
import { StrategyCritique, CritiqueReport } from './strategy_critique';
import { VariantGenerator, RankedVariant, StrategyVariant } from './variant_generator';
import { StrategyDSL } from './strategy_dsl';

export interface LabResult {
  strategy: StrategyDSL;
  parseResult: ParseResult;
  critique: CritiqueReport;
  variants: RankedVariant[];
  nextSteps: string[];
  timestamp: string;
}

export interface ComparisonReport {
  strategies: StrategyDSL[];
  pairwiseComparisons: any[];
  bestCandidate?: StrategyDSL;
  recommendation: string;
}

export class StrategyLab {
  private parser: StrategyParser;
  private critique: StrategyCritique;
  private variants: VariantGenerator;

  constructor() {
    this.parser = new StrategyParser();
    this.critique = new StrategyCritique();
    this.variants = new VariantGenerator();
  }

  /**
   * End-to-end: natural language → parsed → critiqued → variants → ranked
   */
  async processIdea(naturalLanguage: string): Promise<LabResult> {
    const timestamp = new Date().toISOString();

    // Step 1: Parse natural language
    const parseResult = this.parser.parse(naturalLanguage);
    const strategy = parseResult.strategy;

    // Step 2: Critique the strategy
    const critiqueReport = this.critique.critique(strategy);

    // Step 3: Generate variants
    let generatedVariants: StrategyVariant[] = [];
    if (critiqueReport.recommendation !== 'fundamentally_flawed') {
      generatedVariants = this.variants.generateVariants(strategy, 5);
    }

    // Step 4: Rank variants
    const rankedVariants = this.variants.rankVariants(generatedVariants);

    // Step 5: Determine next steps
    const nextSteps = this.generateNextSteps(critiqueReport, parseResult);

    return {
      strategy,
      parseResult,
      critique: critiqueReport,
      variants: rankedVariants,
      nextSteps,
      timestamp,
    };
  }

  /**
   * Refine based on user feedback
   */
  async refineStrategy(strategy: StrategyDSL, feedback: string): Promise<LabResult> {
    const timestamp = new Date().toISOString();

    // Apply feedback to strategy
    const refined = this.applyFeedback(strategy, feedback);

    // Re-critique
    const critiqueReport = this.critique.critique(refined);

    // Generate new variants based on refined strategy
    let generatedVariants: StrategyVariant[] = [];
    if (critiqueReport.recommendation !== 'fundamentally_flawed') {
      generatedVariants = this.variants.generateVariants(refined, 5);
    }

    const rankedVariants = this.variants.rankVariants(generatedVariants);

    const nextSteps = this.generateNextSteps(critiqueReport, {
      strategy: refined,
      confidence: 0.8,
      ambiguities: [],
      suggestions: [],
      interpretations: [],
    });

    return {
      strategy: refined,
      parseResult: {
        strategy: refined,
        confidence: 0.8,
        ambiguities: [],
        suggestions: [],
        interpretations: [],
      },
      critique: critiqueReport,
      variants: rankedVariants,
      nextSteps,
      timestamp,
    };
  }

  /**
   * Compare multiple strategies
   */
  async compareStrategies(strategies: StrategyDSL[]): Promise<ComparisonReport> {
    if (strategies.length < 2) {
      return {
        strategies,
        pairwiseComparisons: [],
        recommendation: 'Need at least 2 strategies to compare',
      };
    }

    const pairwiseComparisons: any[] = [];

    // Compare each pair
    for (let i = 0; i < strategies.length; i++) {
      for (let j = i + 1; j < strategies.length; j++) {
        const comparison = this.variants.compareStrategies(strategies[i], strategies[j]);
        pairwiseComparisons.push(comparison);
      }
    }

    // Critique each strategy
    const critiques = strategies.map(s => this.critique.critique(s));

    // Find best candidate
    let bestCandidate = strategies[0];
    let bestScore = critiques[0].overallScore;

    for (let i = 1; i < critiques.length; i++) {
      if (critiques[i].overallScore > bestScore) {
        bestScore = critiques[i].overallScore;
        bestCandidate = strategies[i];
      }
    }

    const recommendation =
      bestScore >= 70
        ? `"${bestCandidate.name}" is the strongest candidate (Score: ${bestScore}). Recommend proceeding to backtesting.`
        : `Best option is "${bestCandidate.name}" (Score: ${bestScore}), but all strategies need refinement before backtesting.`;

    return {
      strategies,
      pairwiseComparisons,
      bestCandidate,
      recommendation,
    };
  }

  /**
   * Apply user feedback to refine strategy
   */
  private applyFeedback(strategy: StrategyDSL, feedback: string): StrategyDSL {
    const refined = JSON.parse(JSON.stringify(strategy)) as StrategyDSL;
    const fb = feedback.toLowerCase();

    // Entry adjustments
    if (fb.includes('too many') || fb.includes('simplify entry')) {
      if (refined.entry.conditions.length > 2) {
        refined.entry.conditions = refined.entry.conditions.slice(0, 2);
      }
      refined.entry.minConfirmationsRequired = Math.min(1, refined.entry.minConfirmationsRequired);
    }

    if (fb.includes('need more') || fb.includes('add more') || fb.includes('require all')) {
      refined.entry.minConfirmationsRequired = Math.min(
        refined.entry.conditions.length,
        refined.entry.minConfirmationsRequired + 1
      );
    }

    // Exit adjustments
    if (fb.includes('widen stop') || fb.includes('larger stop')) {
      refined.exit.stopLoss.value *= 1.25;
    }

    if (fb.includes('tighter stop') || fb.includes('smaller stop')) {