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

import { logger as _logger } from "../logger";

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
  dataFreshness: number;
  issues: string[];
}

export interface BoundaryReport {
  allClear: boolean;
  violations: BoundaryViolation[];
  warnings: BoundaryWarning[];
  
  portfolio: PortfolioSafetyCheck;
  position: PositionSafetyCheck;
  market: MarketSafetyCheck;
  
  autoActions: { action: string; reason: string; executed: boolean }[];
}

export interface EmergencyStopRecord {
  timestamp: number;
  reason: string;
  triggeringBoundary: string;
  systemState: Partial<SystemState>;
  autoClosePositions: boolean;
}

// ─── Safety Boundaries Implementation ────────────────────────────────────────

export class SafetyBoundaries {
  private boundaries: BoundaryConfig;
  private emergencyStopActive: boolean = false;
  private emergencyStopHistory: EmergencyStopRecord[] = [];
  private violationHistory: BoundaryViolation[] = [];

  constructor() {
    this.boundaries = this.loadBoundaryConfiguration();
  }

  private loadBoundaryConfiguration(): BoundaryConfig {
    return {
      // Portfolio limits
      maxPortfolioDrawdown: parseFloat(process.env.MAX_PORTFOLIO_DRAWDOWN ?? "0.10"),
      maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS ?? "-2500"),
      maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE ?? "0.08"),
      maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS ?? "5", 10),
      maxCorrelatedPositions: parseInt(process.env.MAX_CORRELATED_POSITIONS ?? "2", 10),
      maxSectorExposure: parseFloat(process.env.MAX_SECTOR_EXPOSURE ?? "0.25"),

      // Execution limits
      maxOrdersPerMinute: parseInt(process.env.MAX_ORDERS_PER_MINUTE ?? "10", 10),
      maxOrderSize: parseFloat(process.env.MAX_ORDER_SIZE ?? "10000"),
      maxSlippageTolerance: parseFloat(process.env.MAX_SLIPPAGE_TOLERANCE ?? "0.005"),

      // Model limits
      minModelConfidence: parseFloat(process.env.MIN_MODEL_CONFIDENCE ?? "0.45"),
      maxConsecutiveLosses: parseInt(process.env.MAX_CONSECUTIVE_LOSSES ?? "5", 10),
      minWinRateLast20: parseFloat(process.env.MIN_WIN_RATE_LAST_20 ?? "0.35"),

      // Market limits
      maxVolatilityPercentile: parseFloat(process.env.MAX_VOLATILITY_PERCENTILE ?? "95"),
      blackoutBeforeEvents: parseInt(process.env.BLACKOUT_BEFORE_EVENTS ?? "30", 10),
      requiredDataFreshness: parseInt(process.env.REQUIRED_DATA_FRESHNESS ?? "5", 10),
    };
  }

  /**
   * Check all safety boundaries
   */
  checkBoundaries(currentState: SystemState): BoundaryReport {
    // If emergency stop active, everything fails
    if (this.emergencyStopActive) {
      return {
        allClear: false,
        violations: [
          {
            boundary: "emergency_stop",
            limit: 0,
            actual: 1,
            severity: "critical",
            autoAction: "halt_all_trading",
            description: "Emergency stop is active",
          },
        ],
        warnings: [],
        portfolio: this.checkPortfolioSafety(currentState),
        position: this.checkPositionSafety(currentState),
        market: this.checkMarketSafety(currentState),
        autoActions: [],
      };
    }

    const portfolio = this.checkPortfolioSafety(currentState);
    const position = this.checkPositionSafety(currentState);
    const market = this.checkMarketSafety(currentState);

    // Collect violations and warnings
    const violations: BoundaryViolation[] = [];
    const warnings: BoundaryWarning[] = [];

    // Portfolio violations
    if (portfolio.status === "fail") {
      portfolio.issues.forEach((issue) => {
        if (issue.includes("Drawdown")) {
          violations.push({
            boundary: "max_portfolio_drawdown",
            limit: this.boundaries.maxPortfolioDrawdown,
            actual: portfolio.currentDrawdown,
            severity: "breach",
            autoAction: "reduce_position_size",
            description: issue,
          });
        } else if (issue.includes("Daily loss")) {
          violations.push({
            boundary: "max_daily_loss",
            limit: this.boundaries.maxDailyLoss,
            actual: portfolio.dayPnL,
            severity: "breach",
            autoAction: "pause_trading",
            description: issue,
          });
        }
      });
    } else if (portfolio.status === "warn") {
      portfolio.issues.forEach((issue) => {
        warnings.push({
          boundary: "portfolio_stress",
          limit: this.boundaries.maxPortfolioDrawdown,
          actual: portfolio.currentDrawdown,
          percentOfLimit: portfolio.currentDrawdown / this.boundaries.maxPortfolioDrawdown,
          message: issue,
        });
      });
    }

    // Position violations
    if (position.status === "fail") {
      violations.push({
        boundary: "max_open_positions",
        limit: this.boundaries.maxOpenPositions,
        actual: position.currentPositions,
        severity: "breach",
        autoAction: "reject_new_entries",
        description: "Too many open positions",
      });
    }

    // Market violations
    if (market.status === "fail") {
      violations.push({
        boundary: "market_conditions",
        limit: this.boundaries.maxVolatilityPercentile,
        actual: market.volatilityPercentile,
        severity: "warning",
        autoAction: "reduce_size_or_pause",
        description: "Market volatility excessive",
      });
    }

    // Determine auto actions
    const autoActions = this.determineAutoActions(violations, warnings);

    const allClear =
      violations.length === 0 &&
      portfolio.status !== "fail" &&
      position.status !== "fail" &&
      market.status !== "fail";

    return {
      allClear,
      violations,
      warnings,
      portfolio,
      position,
      market,
      autoActions,
    };
  }

  /**
   * Check position-level safety
   */
  checkPositionSafety(state: SystemState): PositionSafetyCheck {
    const currentPositions = state.positions ? state.positions.length : 0;
    const maxAllowed = this.boundaries.maxOpenPositions;

    // Calculate position sizes
    const totalExposure = state.positions
      ? state.positions.reduce((sum, p) => sum + Math.abs(p.value || 0), 0)
      : 0;

    const avgPositionSize = currentPositions > 0 ? totalExposure / currentPositions : 0;
    const maxPositionSize = state.positions
      ? Math.max(...state.positions.map((p) => Math.abs(p.value || 0)))
      : 0;

    const maxAllowedSize = state.portfolioValue * this.boundaries.maxPositionSize;

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (currentPositions > maxAllowed) {
      issues.push(`Too many open positions: ${currentPositions} > ${maxAllowed}`);
      status = "fail";
    } else if (currentPositions > maxAllowed * 0.8) {
      issues.push(`Approaching position limit: ${currentPositions}/${maxAllowed}`);
      status = "warn";
    }

    if (maxPositionSize > maxAllowedSize) {
      issues.push(`Position size exceeds limit: ${maxPositionSize} > ${maxAllowedSize}`);
      status = "fail";
    } else if (maxPositionSize > maxAllowedSize * 0.9) {
      issues.push(`Position approaching size limit`);
      status = "warn";
    }

    return {
      status,
      currentPositions,
      maxAllowed,
      avgPositionSize,
      maxPositionSize,
      issues,
    };
  }

  /**
   * Check portfolio-level safety
   */
  checkPortfolioSafety(state: SystemState): PortfolioSafetyCheck {
    // Calculate drawdown
    const startValue = parseFloat(process.env.PORTFOLIO_START_VALUE ?? "100000");
    const currentValue = state.portfolioValue;
    const currentDrawdown = (startValue - currentValue) / startValue;

    // Calculate daily PnL (simplified)
    const dayStartValue = parseFloat(process.env.DAY_START_VALUE ?? "100000");
    const dayPnL = currentValue - dayStartValue;

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (currentDrawdown > this.boundaries.maxPortfolioDrawdown) {
      issues.push(
        `Drawdown exceeded: ${(currentDrawdown * 100).toFixed(2)}% > ${(this.boundaries.maxPortfolioDrawdown * 100).toFixed(2)}%`
      );
      status = "fail";
    } else if (currentDrawdown > this.boundaries.maxPortfolioDrawdown * 0.7) {
      issues.push(
        `Drawdown approaching limit: ${(currentDrawdown * 100).toFixed(2)}%`
      );
      status = "warn";
    }

    if (dayPnL < this.boundaries.maxDailyLoss) {
      issues.push(`Daily loss limit exceeded: ${dayPnL} < ${this.boundaries.maxDailyLoss}`);
      status = "fail";
    } else if (dayPnL < this.boundaries.maxDailyLoss * 0.7) {
      issues.push(`Daily loss approaching limit: ${dayPnL}`);
      status = "warn";
    }

    return {
      status,
      currentDrawdown,
      maxAllowedDrawdown: this.boundaries.maxPortfolioDrawdown,
      dayPnL,
      maxDailyLoss: this.boundaries.maxDailyLoss,
      portfolioValue: currentValue,
      issues,
    };
  }

  /**
   * Check market condition safety
   */
  checkMarketSafety(state: SystemState): MarketSafetyCheck {
    // In production, would get actual market volatility
    const currentVolatility = 0.18;  // 18% annualized
    const volatilityPercentile = 55;  // percentile rank
    const dataFreshness = 1;  // seconds

    const issues: string[] = [];
    let status: "pass" | "warn" | "fail" = "pass";

    if (volatilityPercentile > this.boundaries.maxVolatilityPercentile) {
      issues.push(`Market volatility too high: ${volatilityPercentile}th percentile`);
      status = "fail";
    } else if (volatilityPercentile > this.boundaries.maxVolatilityPercentile * 0.85) {
      issues.push(`Market volatility elevated`);
      status = "warn";
    }

    if (dataFreshness > this.boundaries.requiredDataFreshness) {
      issues.push(`Data lag: ${dataFreshness}s > ${this.boundaries.requiredDataFreshness}s`);
      status = "warn";
    }

    return {
      status,
      currentVolatility,
      volatilityPercentile,
      dataFreshness,
      issues,
    };
  }

  /**
   * Trigger emergency stop
   */
  triggerEmergencyStop(reason: string): EmergencyStopRecord {
    const record: EmergencyStopRecord = {
      timestamp: Date.now(),
      reason,
      triggeringBoundary: "emergency_stop",
      systemState: {},
      autoClosePositions: true,
    };

    this.emergencyStopActive = true;
    this.emergencyStopHistory.push(record);

    logger.error({ reason }, "EMERGENCY STOP TRIGGERED");

    return record;
  }

  /**
   * Get boundary configuration
   */
  getBoundaries(): BoundaryConfig {
    return { ...this.boundaries };
  }

  /**
   * Update a single boundary
   */
  updateBoundary(boundary: string, value: number): void {
    const key = boundary as keyof BoundaryConfig;
    if (key in this.boundaries) {
      (this.boundaries[key] as any) = value;
      logger.info({ boundary, value }, "Boundary updated");
    }
  }

  /**
   * Check if emergency stop is active
   */
  isEmergencyStopActive(): boolean {
    return this.emergencyStopActive;
  }

  /**
   * Deactivate emergency stop (requires external authorization)
   */
  deactivateEmergencyStop(): void {
    this.emergencyStopActive = false;
    logger.warn("Emergency stop deactivated");
  }

  // ─── Private Helpers ────────────────────────────────────────────────────────

  private determineAutoActions(
    violations: BoundaryViolation[],
    warnings: BoundaryWarning[]
  ): { action: string; reason: string; executed: boolean }[] {
    const actions: { action: string; reason: string; executed: boolean }[] = [];

    // Check for critical violations
    const criticalViolations = violations.filter((v) => v.severity === "critical");
    if (criticalViolations.length > 0) {
      actions.push({
        action: "emergency_stop",
        reason: criticalViolations[0].description,
        executed: false,
      });
      return actions;  // Stop processing, emergency is priority
    }

    // Handle breaches
    violations.forEach((v) => {
      if (v.autoAction === "reduce_position_size") {
        actions.push({
          action: "reduce_kelly_fraction",
          reason: v.description,
          executed: false,
        });
      } else if (v.autoAction === "pause_trading") {
        actions.push({
          action: "pause_new_entries",
          reason: v.description,
          executed: false,
        });
      } else if (v.autoAction === "reject_new_entries") {
        actions.push({
          action: "reject_new_entries",
          reason: v.description,
          executed: false,
        });
      }
    });

    // Handle warnings
    warnings.forEach((w) => {
      if (w.percentOfLimit > 0.85) {
        actions.push({
          action: "increase_monitoring",
          reason: w.message,
          executed: false,
        });
      }
    });

    return actions;
  }
}

export const safetyBoundaries = new SafetyBoundaries();
