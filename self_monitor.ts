/**
 * self_monitor.ts — Self-Monitoring and Self-Check System
 *
 * The system continuously monitors itself:
 *
 *   • Execution Quality — latency, fill rates, slippage
 *   • Model Health — accuracy, calibration, confidence reliability
 *   • Data Pipeline — freshness, validity, continuity
 *   • Risk Limits — portfolio limits, position limits, loss limits
 *   • Performance — Sharpe, win rate, drawdown tracking
 *   • Infrastructure — data feeds, broker connection, order submission
 *
 * Runs self-checks periodically and provides a health score (0-100).
 * Post-trade reviews grade each trade and extract lessons learned.
 * Daily assessments provide accountability and improvement signals.
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "self_monitor" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ExecutionQualityCheck {
  status: "pass" | "warn" | "fail";
  avgSlippage: number;
  maxSlippage: number;
  fillRate: number;
  latencyP95: number;
  issues: string[];
}

export interface ModelHealthCheck {
  status: "pass" | "warn" | "fail";
  recentAccuracy: number;
  calibrationError: number;
  confidenceReliability: number;
  predictionDistribution: { mean: number; std: number };
  issues: string[];
}

export interface DataHealthCheck {
  status: "pass" | "warn" | "fail";
  dataFreshness: number;  // seconds since last update
  missingDataPoints: number;
  dataQuality: number;  // 0-1
  issues: string[];
}

export interface RiskLimitCheck {
  status: "pass" | "warn" | "fail";
  currentDrawdown: number;
  maxAllowedDrawdown: number;
  currentPortfolioSize: number;
  maxAllowedSize: number;
  openPositions: number;
  maxAllowedPositions: number;
  issues: string[];
}

export interface PerformanceCheck {
  status: "pass" | "warn" | "fail";
  winRate: number;
  sharpeRatio: number;
  profitFactor: number;
  maxConsecutiveLosses: number;
  issues: string[];
}

export interface InfraCheck {
  status: "pass" | "warn" | "fail";
  brokerConnected: boolean;
  dataFeedHealthy: boolean;
  apiLatency: number;
  errorRate: number;
  issues: string[];
}

export interface SelfCheckIssue {
  component: string;
  severity: "warning" | "critical";
  message: string;
  autoAction?: string;
}

export interface AutoAction {
  action: string;
  reason: string;
  executed: boolean;
}

export interface SelfCheckReport {
  timestamp: number;
  overall: "healthy" | "warning" | "degraded" | "critical";
  score: number;  // 0-100
  
  checks: {
    execution: ExecutionQualityCheck;
    model: ModelHealthCheck;
    data: DataHealthCheck;