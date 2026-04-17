/**
 * safety_boundaries.ts — Safety Boundaries for Autonomous Operation
 *
 * Enforces hard limits on:
 *   • Portfolio drawdown (daily and overall)
 *   • Daily loss amount
 *   • Position size limits
 *   • Open positions count
 *   • Order rate limits
 *   • Slippage tolerance
 *   • Model confidence minimums
 *   • Win rate minimums
 *
 * When boundaries are breached:
 *   • Records violation with full context
 *   • Takes automatic action (reduce size, pause, stop)
 *   • Alerts human operators
 *   • Can escalate to emergency stop
 */

import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "safety_boundaries" });

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SystemState {
  portfolioValue: number;
  cash: number;
  positions: any[];
  recentTrades: any[];
  openOrders: any[];
  timestamp: number;
}

export interface BoundaryConfig {
  // Portfolio limits
  maxPortfolioDrawdown: number;         // 0.10 = 10%
  maxDailyLoss: number;                 // e.g., -2500
  maxPositionSize: number;              // 0.08 = 8% of account
  maxOpenPositions: number;             // max concurrent
  maxCorrelatedPositions: number;       // max in same sector
  maxSectorExposure: number;            // max sector concentration

  // Execution limits
  maxOrdersPerMinute: number;
  maxOrderSize: number;
  maxSlippageTolerance: number;         // 0.005 = 50 bps

  // Model limits
  minModelConfidence: number;           // 0-1
  maxConsecutiveLosses: number;
  minWinRateLast20: number;             // last 20 trades

  // Market limits
  maxVolatilityPercentile: number;      // don't trade if vol > 95th percentile
  blackoutBeforeEvents: number;         // minutes
  requiredDataFreshness: number;        // seconds
}

export interface BoundaryViolation {
  boundary: string;
  limit: number;
  actual: number;
  severity: "warning" | "breach" | "critical";
  autoAction: string;
  description: string;
}

export interface BoundaryWarning {
  boundary: string;
  limit: number;
  actual: number;
  percentOfLimit: number;  // 0-1
  message: string;
}

export interface PositionSafetyCheck {
  status: "pass" | "warn" | "fail";
  currentPositions: number;
  maxAllowed: number;
  avgPositionSize: number;
  maxPositionSize: number;
  issues: string[];
}

export interface PortfolioSafetyCheck {
  status: "pass" | "warn" | "fail";
  currentDrawdown: number;
  maxAllowedDrawdown: number;
  dayPnL: number;
  maxDailyLoss: number;
  portfolioValue: number;
  issues: string[];
}

export interface MarketSafetyCheck {
  status: "pass" | "warn" | "fail";
  currentVolatility: number;
  volatilityPercentile: number;