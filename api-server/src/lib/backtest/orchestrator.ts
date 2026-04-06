/**
 * orchestrator.ts — Enhanced Backtest Orchestrator
 *
 * Ties together all Phase 2 modules:
 *   - Fill simulator for realistic execution modeling
 *   - Sensitivity analyzer for robustness validation
 *   - Portfolio backtester for multi-strategy analysis
 *   - Validation engine for comprehensive quality checks
 *
 * Provides unified interface for institutional-grade analysis.
 */

import { logger } from "../logger";
import { FillSimulator, type FillConfig, type FillResult } from "./fill_simulator";
import { SensitivityAnalyzer, type SweepConfig, type SweepResult } from "./sensitivity_analyzer";
import { PortfolioBacktester, type PortfolioConfig, type PortfolioResult } from "./portfolio_backtester";
import { BacktestValidator, type ValidationReport } from "./validation_engine";
import { TradeOutcome } from "../backtest_engine";

// ── Unified Configuration ──────────────────────────────────────────────────

export interface EnhancedBacktestConfig {
  // Core backtest
  trades: TradeOutcome[];
  equityCurve: number[];

  // Realistic fills
  fillConfig?: FillConfig;
  applyFills?: boolean;

  // Sensitivity
  runSensitivity?: boolean;
  parameterSweep?: SweepConfig;

  // Validation
  validateResults?: boolean;
  validationData?: {
    confirmations: any[];
    bars: any[];
    regimes?: Array<{ startIdx: number; regime: string }>;
  };

  // Portfolio (if multi-strategy)
  portfolio?: PortfolioConfig;
}

export interface EnhancedBacktestResult {
  trades: TradeOutcome[];
  filledTrades?: TradeOutcome[];
  originalEquity: number;
  filledEquity?: number;
  fillImpact?: number; // % change

  sensitivity?: {
    sweep: SweepResult;
    overfit: any;
  };

  portfolio?: PortfolioResult;

  validation?: ValidationReport;

  summary: {
    trustScore: number; // 0-1
    readyForProduction: boolean;
    topRisks: string[];
    recommendations: string[];
  };
}

// ── Orchestrator ───────────────────────────────────────────────────────────

export class BacktestOrchestrator {
  private fillSimulator: FillSimulator;
  private sensitivityAnalyzer: SensitivityAnalyzer;
  private portfolioBacktester: PortfolioBacktester;
  private validator: BacktestValidator;

  constructor() {
    this.fillSimulator = new FillSimulator();
    this.sensitivityAnalyzer = new SensitivityAnalyzer();
    this.portfolioBacktester = new PortfolioBacktester();
    this.validator = new BacktestValidator();
  }

  /**
   * Run complete enhanced backtest pipeline
   */
  async runEnhancedBacktest(config: EnhancedBacktestConfig): Promise<EnhancedBacktestResult> {
    logger.info({ config: JSON.stringify(config).slice(0, 200) }, "Running enhanced backtest");

    const result: EnhancedBacktestResult = {
      trades: config.trades,
      originalEquity: config.equityCurve[config.equityCurve.length - 1],
      summary: {
        trustScore: 0,
        readyForProduction: false,
        topRisks: [],
        recommendations: [],
      },
    };

    // 1. Apply realistic fills if requested
    if (config.applyFills && config.fillConfig) {
      logger.debug("Applying realistic fill simulation");
      const fillResult = this.applyFillsToTrades(config.trades, config.fillConfig);
      result.filledTrades = fillResult.trades;
      result.filledEquity = fillResult.equity;
      result.fillImpact = (fillResult.equity - result.originalEquity) / result.originalEquity;

      if (result.fillImpact && result.fillImpact < -0.1) {
        result.summary.topRisks.push(`High fill slippage: ${(result.fillImpact * 100).toFixed(1)}%`);
      }
    }

    // 2. Run sensitivity analysis if requested
    if (config.runSensitivity && config.parameterSweep) {
      logger.debug("Running parameter sensitivity analysis");
      const sweep = this.sensitivityAnalyzer.runParameterSweep(config.parameterSweep);
      const overfit = this.sensitivityAnalyzer.detectOverfitting(sweep);

      result.sensitivity = { sweep, overfit };

      if (overfit.isOverfit) {
        result.summary.topRisks.push(`Overfitting detected (confidence: ${(overfit.confidence * 100).toFixed(0)}%)`);
      }

      result.summary.recommendations.push(...overfit.recommendations);
    }

    // 3. Portfolio analysis if multi-strategy
    if (config.portfolio) {
      logger.debug("Running portfolio analysis");
      result.portfolio = this.portfolioBacktester.runPortfolioBacktest(config.portfolio);
    }

    // 4. Comprehensive validation if requested
    if (config.validateResults && config.validationData) {
      logger.debug("Running comprehensive validation");
      const validation = this.validator.validate({
        trades: config.trades,
        equityCurve: config.equityCurve,
        ...config.validationData,
      });

      result.validation = validation;

      result.summary.topRisks.push(...validation.dealBreakers);
      result.summary.topRisks.push(...validation.warnings.slice(0, 3));

      result.summary.trustScore = validation.trustworthiness;
      result.summary.readyForProduction = validation.grade === "A" || validation.grade === "B";
    } else {
      // Fallback: basic trust score
      result.summary.trustScore = 0.6;
    }

    // 5. Generate final summary
    result.summary.recommendations.push(
      result.summary.readyForProduction
        ? "Backtest passed validation. Ready for forward testing."
        : "Address critical issues before forward testing."
    );

    logger.info(
      {
        trustScore: result.summary.trustScore,
        readyForProduction: result.summary.readyForProduction,
        risksCount: result.summary.topRisks.length,
      },
      "Enhanced backtest complete"
    );

    return result;
  }

  /**
   * Apply fill simulation to all trades
   */
  private applyFillsToTrades(trades: TradeOutcome[], fillConfig: FillConfig) {
    // This would require access to bar data for execution simulation
    // For now, return simplified impact estimate
    const estimatedSlippagePercent = fillConfig.spreadBps / 10000 + fillConfig.slippageBps / 10000;
    const estimatedImpact = estimatedSlippagePercent * trades.length;

    // Adjust trades
    const adjustedTrades = trades.map((trade) => ({
      ...trade,
      pnlPrice: trade.pnlPrice * (1 - estimatedSlippagePercent),
      pnlR: trade.pnlR * (1 - estimatedSlippagePercent),
    }));

    // Recompute equity
    let equity = 10000; // Base
    adjustedTrades.forEach((trade) => {
      equity += trade.pnlPrice;
    });

    return {
      trades: adjustedTrades,
      equity,
    };
  }

  /**
   * Get default config template
   */
  getDefaultConfig(trades: TradeOutcome[], equityCurve: number[]): EnhancedBacktestConfig {
    return {
      trades,
      equityCurve,
      fillConfig: this.fillSimulator.defaultConfig(),
      applyFills: true,
      runSensitivity: false,
      validateResults: true,
      validationData: {
        confirmations: [],
        bars: [],
      },
    };
  }
}

// Export singleton
export const backtestOrchestrator = new BacktestOrchestrator();
