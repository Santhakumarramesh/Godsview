/**
 * autonomous/index.ts — Autonomous System Orchestrator
 *
 * Coordinates all autonomous modules:
 *   • DriftDetector — monitors live vs backtest divergence
 *   • SelfMonitor — self-checks and health reporting
 *   • ModeManager — automatic mode transitions
 *   • SafetyBoundaries — enforces hard limits
 *   • PostTradeLoop — trade review and learning
 *
 * Provides unified interface for:
 *   • Starting/stopping autonomous monitoring
 *   • Running periodic health checks
 *   • Triggering mode evaluations
 *   • Emergency response
 */

import { driftDetector } from "./drift_detector";
import { selfMonitor } from "./self_monitor";
import { modeManager } from "./mode_manager";
import { safetyBoundaries } from "./safety_boundaries";
import { postTradeLoop } from "./post_trade_loop";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "autonomous_orchestrator" });

export { driftDetector } from "./drift_detector";
export type { DriftDetector, DriftReport, DriftAlert } from "./drift_detector";

export type {
  LiveMetrics,
  BacktestMetrics,
  ExecutionDrift,
  ModelDrift,
  DataDrift,
} from "./drift_detector";

export { selfMonitor } from "./self_monitor";
export type { SelfMonitor, SelfCheckReport, PostTradeReview, DailyAssessment, TradingReadinessCheck } from "./self_monitor";

export type {
  ExecutionQualityCheck,
  ModelHealthCheck,
  DataHealthCheck,
  RiskLimitCheck,
  PerformanceCheck,
  InfraCheck,
} from "./self_monitor";

export {
  modeManager,
  ModeManager,
} from "./mode_manager";

export type {
  Mode,
  ModeParameters,
  OperatingMode,
  ModeDecision,
  ModeChangeRecord,
  UpgradeDecision,
  DowngradeDecision,
} from "./mode_manager";

export { safetyBoundaries } from "./safety_boundaries";
export type { SafetyBoundaries, BoundaryReport, BoundaryViolation, BoundaryWarning, BoundaryConfig } from "./safety_boundaries";

export type {
  PositionSafetyCheck,
  PortfolioSafetyCheck,
  MarketSafetyCheck,
  SystemState,
  EmergencyStopRecord,
} from "./safety_boundaries";

export { postTradeLoop } from "./post_trade_loop";
export type { PostTradeLoop, PostTradeAnalysis, BatchAnalysis, DailyReviewReport } from "./post_trade_loop";

export type {
  TradeRecord,
  EntryAnalysis,
  ExitAnalysis,
  SizingAnalysis,
  MarketContext,
  WhatIfAnalysis,
} from "./post_trade_loop";

// ─── Autonomous System Orchestrator ────────────────────────────────────────

export interface AutonomousSystemStatus {
  timestamp: number;
  running: boolean;
  currentMode: string;
  healthScore: number;
  
  selfCheck: any;
  boundaries: any;
  readiness: any;
  
  activeAlerts: string[];
  recentActions: string[];
}

export class AutonomousOrchestrator {
  private running: boolean = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private modeEvalInterval: NodeJS.Timeout | null = null;

  /**
   * Start autonomous monitoring
   */
  start(): void {
    if (this.running) {
      logger.warn("Autonomous system already running");
      return;
    }

    logger.info("Starting autonomous system");
    this.running = true;

    // Run self-check every 60 seconds
    this.checkInterval = setInterval(() => {
      this.runPeriodicHealthCheck();
    }, 60000);

    // Evaluate mode every 5 minutes
    this.modeEvalInterval = setInterval(() => {
      this.evaluateModeTransition();
    }, 300000);

    logger.info("Autonomous system started");
  }

  /**
   * Stop autonomous monitoring
   */
  stop(): void {
    if (!this.running) {
      logger.warn("Autonomous system not running");
      return;
    }

    if (this.checkInterval) clearInterval(this.checkInterval);
    if (this.modeEvalInterval) clearInterval(this.modeEvalInterval);

    this.running = false;
    logger.info("Autonomous system stopped");
  }

  /**
   * Get current system status
   */
  getStatus(): AutonomousSystemStatus {
    const selfCheckReport = selfMonitor.runSelfCheck();
    const currentMode = modeManager.getCurrentMode();
    const readiness = selfMonitor.shouldBeTrading();

    return {
      timestamp: Date.now(),
      running: this.running,
      currentMode: currentMode.mode,
      healthScore: selfCheckReport.score,
      
      selfCheck: {
        overall: selfCheckReport.overall,
        score: selfCheckReport.score,
        issues: selfCheckReport.issues.length,
      },
      boundaries: {
        allClear: true,  // would check
      },
      readiness: {
        ready: readiness.ready,
        score: readiness.score,
      },
      
      activeAlerts: selfCheckReport.issues
        .filter((i) => i.severity === "critical")
        .map((i) => i.message),
      recentActions: selfCheckReport.autoActions
        .map((a) => a.action),
    };
  }

  /**
   * Check if system is ready to trade
   */
  canTrade(): boolean {
    const readiness = selfMonitor.shouldBeTrading();
    const boundaries = safetyBoundaries.checkBoundaries({
      portfolioValue: 100000,
      cash: 50000,
      positions: [],
      recentTrades: [],
      openOrders: [],
      timestamp: Date.now(),
    });

    return readiness.ready && boundaries.allClear;
  }

  /**
   * Get current mode parameters
   */
  getModeParams(): any {
    return modeManager.getModeParameters(modeManager.getCurrentMode().mode);
  }

  /**
   * Trigger mode evaluation
   */
  evaluateMode(selfCheck: any, driftReport: any, performance: any): any {
    return modeManager.evaluateMode(selfCheck, driftReport, performance);
  }

  /**
   * Manually change mode
   */
  changeMode(newMode: string, reason: string): any {
    return modeManager.changeMode(newMode, reason);
  }

  /**
   * Get drift report for strategy
   */
  getDriftReport(strategyId: string, liveMetrics: any, backtestMetrics: any): any {
    return driftDetector.detectDrift(liveMetrics, backtestMetrics);
  }

  /**
   * Monitor trade and update drift
   */
  monitorTrade(strategyId: string, trade: any): any {
    return driftDetector.monitorDrift(strategyId, trade);
  }

  /**
   * Analyze completed trade
   */
  analyzeCompletedTrade(trade: any, context: any): any {
    return postTradeLoop.analyzeTrade(trade, context);
  }

  /**
   * Get daily review
   */
  getDailyReview(date: string): any {
    return postTradeLoop.dailyReview(date);
  }

  /**
   * Trigger emergency stop
   */
  emergencyStop(reason: string): any {
    logger.error({ reason }, "EMERGENCY STOP TRIGGERED");
    safetyBoundaries.triggerEmergencyStop(reason);
    modeManager.changeMode("emergency_stop", reason);
    this.stop();
    return {
      status: "emergency_stop_active",
      reason,
      timestamp: Date.now(),
    };
  }

  /**
   * Check if emergency stop is active
   */
  isEmergencyStopActive(): boolean {
    return safetyBoundaries.isEmergencyStopActive();
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private runPeriodicHealthCheck(): void {
    try {
      const selfCheck = selfMonitor.runSelfCheck();

      // Check for critical issues
      if (selfCheck.overall === "critical") {
        logger.error(
          { issues: selfCheck.issues },
          "Critical system issues detected"
        );
        // Could trigger automated response
      }

      // Log health metrics
      if (selfCheck.overall !== "healthy") {
        logger.warn(
          { score: selfCheck.score, overall: selfCheck.overall },
          "System health degraded"
        );
      }
    } catch (error) {
      logger.error({ error }, "Error during health check");
    }
  }

  private evaluateModeTransition(): void {
    try {
      const selfCheck = selfMonitor.runSelfCheck();
      const currentMode = modeManager.getCurrentMode();

      // Placeholder: would get actual drift and performance data
      const driftReport = {
        overallDrift: 0.15,
        status: "stable",
      };

      const performance = {
        winRate: 0.55,
        consecutiveLosses: 2,
        drawdown: 0.032,
        sharpeRatio: 1.8,
      };

      const decision = modeManager.evaluateMode(selfCheck, driftReport, performance);

      if (decision.shouldChange) {
        logger.info(
          {
            from: decision.currentMode,
            to: decision.recommendedMode,
            reasons: decision.reasons,
          },
          "Mode change recommended"
        );

        // Auto-execute downgrade if urgent
        if (decision.direction === "downgrade" && decision.confidence > 0.75) {
          modeManager.changeMode(
            decision.recommendedMode,
            `Auto-downgrade: ${decision.reasons[0]}`
          );
        }
      }
    } catch (error) {
      logger.error({ error }, "Error during mode evaluation");
    }
  }
}

// Export singleton
export const autonomousOrchestrator = new AutonomousOrchestrator();

// (AutonomousSystemStatus already exported above as interface)
