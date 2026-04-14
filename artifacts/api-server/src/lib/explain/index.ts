/**
 * explain/index.ts — Explainability System Orchestrator
 *
 * Coordinates the four pillars of trading system transparency:
 *   1. Decision Explainer: "Why was this signal approved/rejected?"
 *   2. Attribution Engine: "What actually drove the returns?"
 *   3. Fragility Detector: "What hidden risks could blow us up?"
 *   4. Report Generator: "Show me the full picture in human-readable form"
 *
 * This orchestrator ensures all explanations are consistent, fact-based,
 * and suitable for:
 *   - Traders understanding the system
 *   - Risk managers assessing exposure
 *   - Regulators auditing decisions
 *   - Researchers validating claims
 */

import { DecisionExplainer, decisionExplainer } from "./decision_explainer";
import { AttributionEngine, attributionEngine } from "./attribution_engine_explain";
import { FragilityDetector, fragilityDetector } from "./fragility_detector";
import { ReportGenerator, reportGenerator } from "./report_generator";
import { logger } from "../logger";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ExplainabilityRequest {
  type: "signal" | "trade" | "strategy" | "no_trade" | "promotion" | "attribution" | "fragility" | "report";
  context: any;
}

export interface ExplainabilityResponse {
  type: string;
  timestamp: string;
  explanation: any;
  confidence: number;
  auditable: boolean;
  factBased: boolean;
}

// ─── Explainability Orchestrator ──────────────────────────────────────────────

export class ExplainabilitySystem {
  constructor(
    private decisionExplainer: DecisionExplainer,
    private attributionEngine: AttributionEngine,
    private fragilityDetector: FragilityDetector,
    private reportGenerator: ReportGenerator,
  ) {}

  /**
   * Main entry point: explain any decision or analyze any aspect
   */
  async explain(request: ExplainabilityRequest): Promise<ExplainabilityResponse> {
    const timestamp = new Date().toISOString();

    try {
      let explanation: any;
      let confidence = 0.9;
      let auditable = true;
      let factBased = true;

      switch (request.type) {
        case "signal":
          explanation = this.decisionExplainer.explainSignalDecision(
            request.context.signal,
            request.context.siResult,
            request.context.brainOutput,
          );
          confidence = explanation.confidence;
          break;

        case "trade":
          explanation = this.decisionExplainer.explainTrade(
            request.context.trade,
            request.context.context,
          );
          confidence = 0.95;
          break;

        case "strategy":
          explanation = this.decisionExplainer.explainStrategyQuality(
            request.context.strategy,
            request.context.metrics,
          );
          factBased = this._assessFactBased(explanation);
          break;

        case "no_trade":
          explanation = this.decisionExplainer.explainNoTrade(
            request.context.symbol,
            request.context.marketState,
            request.context.brainOutput,
          );
          confidence = 0.85;
          break;

        case "promotion":
          explanation = this.decisionExplainer.explainPromotion(request.context.promotionResult);
          auditable = true;
          break;

        case "attribution":
          explanation = this.attributionEngine.attributeReturns(request.context.trades);
          factBased = true;
          break;

        case "fragility":
          explanation = this.fragilityDetector.analyze(
            request.context.strategy,
            request.context.trades,
            request.context.backtestResults,
          );
          factBased = true;
          break;

        case "report":
          explanation = this.reportGenerator.generateStrategyReport(
            request.context.strategy,
            request.context.results,
          );
          auditable = true;
          break;

        default:
          throw new Error(`Unknown explanation type: ${request.type}`);
      }

      logger.info(
        {
          type: request.type,
          confidence,
          auditable,
          factBased,
        },
        "Explanation generated",
      );

      return {
        type: request.type,
        timestamp,
        explanation,
        confidence,
        auditable,
        factBased,
      };
    } catch (err) {
      logger.error({ err, request }, "Failed to generate explanation");
      throw err;
    }
  }

  /**
   * Generate a comprehensive trading report with all analyses
   */
  async generateComprehensiveReport(strategy: any, trades: any[], backtestResults: any): Promise<any> {
    const timestamp = new Date().toISOString();

    try {
      const strategyReport = this.reportGenerator.generateStrategyReport(strategy, backtestResults);
      const attribution = this.attributionEngine.attributeReturns(trades);
      const fragility = this.fragilityDetector.analyze(strategy, trades, backtestResults);

      return {
        timestamp,
        strategy: {
          id: strategy.id,
          name: strategy.name,
        },
        report: strategyReport,
        attribution,
        fragility,
        summary: {
          grade: strategyReport.sections.overview.grade,
          recommendation: strategyReport.sections.overview.recommendation,
          topRisks: fragility.hiddenRisks.filter((r) => r.detected).slice(0, 3),
          keyInsights: attribution.insights,
        },
      };
    } catch (err) {
      logger.error({ err, strategy }, "Failed to generate comprehensive report");
      throw err;
    }
  }

  /**
   * Generate daily trading report
   */
  async generateDailyReport(trades: any[], date: string): Promise<any> {
    try {
      return this.reportGenerator.generateDailyReport(trades, date);
    } catch (err) {
      logger.error({ err, date }, "Failed to generate daily report");
      throw err;
    }
  }

  /**
   * Generate performance review
   */
  async generatePerformanceReview(period: string): Promise<any> {
    try {
      return this.reportGenerator.generatePerformanceReview(period);
    } catch (err) {
      logger.error({ err, period }, "Failed to generate performance review");
      throw err;
    }
  }

  /**
   * Generate executive summary
   */
  async generateExecutiveSummary(): Promise<any> {
    try {
      return this.reportGenerator.generateExecutiveSummary();
    } catch (err) {
      logger.error({ err }, "Failed to generate executive summary");
      throw err;
    }
  }

  /**
   * Skill vs Luck decomposition
   */
  async decomposeSkillLuck(trades: any[]): Promise<any> {
    try {
      return this.attributionEngine.skillLuckDecomposition(trades);
    } catch (err) {
      logger.error({ err }, "Failed to decompose skill/luck");
      throw err;
    }
  }

  /**
   * Regime attribution
   */
  async analyzeRegimeAttribution(trades: any[]): Promise<any> {
    try {
      return this.attributionEngine.regimeAttribution(trades);
    } catch (err) {
      logger.error({ err }, "Failed to analyze regime attribution");
      throw err;
    }
  }

  /**
   * Temporal patterns (intraday, day-of-week)
   */
  async analyzeTemporalPatterns(trades: any[]): Promise<any> {
    try {
      return this.attributionEngine.temporalAttribution(trades);
    } catch (err) {
      logger.error({ err }, "Failed to analyze temporal patterns");
      throw err;
    }
  }

  /**
   * Entry vs exit quality
   */
  async analyzeEntryExitQuality(trades: any[]): Promise<any> {
    try {
      return this.attributionEngine.entryExitAttribution(trades);
    } catch (err) {
      logger.error({ err }, "Failed to analyze entry/exit quality");
      throw err;
    }
  }

  /**
   * Factor analysis
   */
  async analyzeFactor(trades: any[], factors: string[]): Promise<any> {
    try {
      return this.attributionEngine.analyzeFactors(trades, factors);
    } catch (err) {
      logger.error({ err, factors }, "Failed to analyze factors");
      throw err;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private _assessFactBased(explanation: any): boolean {
    // Check that explanation includes metrics and data-driven reasoning
    if (!explanation) return false;
    if (typeof explanation === "object") {
      return (
        ("factors" in explanation) ||
        ("components" in explanation) ||
        ("bySetupType" in explanation) ||
        ("metrics" in explanation)
      );
    }
    return false;
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const explainabilitySystem = new ExplainabilitySystem(
  decisionExplainer,
  attributionEngine,
  fragilityDetector,
  reportGenerator,
);

// ─── Exports ──────────────────────────────────────────────────────────────────

export { DecisionExplainer } from "./decision_explainer";
export type {
  SignalExplanation,
  StrategyExplanation,
  ReturnDriverExplanation,
  TradeExplanation,
  NoTradeExplanation,
  PromotionExplanation,
  ExplanationFactor,
} from "./decision_explainer";

export { AttributionEngine } from "./attribution_engine_explain";
export type {
  AttributionReport,
  AttributionComponent,
  SkillLuckReport,
  RegimeAttributionReport,
  TemporalAttributionReport,
  EntryExitReport,
  FactorAnalysisResult,
} from "./attribution_engine_explain";

export { FragilityDetector } from "./fragility_detector";
export type {
  FragilityReport,
  ParameterFragility,
  RegimeFragility,
  ConcentrationFragility,
  TimingFragility,
  DataFragility,
  HiddenRisk,
  StressTestResult,
} from "./fragility_detector";

export { ReportGenerator } from "./report_generator";
export type {
  StrategyReport,
  DailyReport,
  PerformanceReview,
  ExecutiveSummary,
  ReportSection,
} from "./report_generator";
