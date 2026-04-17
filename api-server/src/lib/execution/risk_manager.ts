/**
 * Phase 96 — Risk Management Engine
 *
 * Comprehensive risk management: position sizing, drawdown protection,
 * exposure limits, and circuit breakers.
 */

export interface RiskLimits {
  maxPositionSizePct: number;    // max % of portfolio per position
  maxPortfolioExposurePct: number; // max gross exposure %
  maxDailyLossPct: number;       // max daily loss before halt
  maxDrawdownPct: number;        // max total drawdown before halt
  maxOpenPositions: number;      // max concurrent positions
  maxCorrelatedPositions: number; // max positions in same sector/direction
  maxSingleTradeRiskPct: number; // max risk per trade as % of equity
  minCashReservePct: number;     // minimum cash to keep
  cooldownAfterLossMs: number;   // cooldown period after a loss
}

export interface PositionSizeRequest {
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  stopPrice: number;
  confidence: number;
  regime: string;
  volatility: number;
  setupFamily: string;
}

export interface PositionSizeResult {
  approved: boolean;
  quantity: number;
  riskDollars: number;
  riskPercent: number;
  positionValue: number;
  positionWeight: number;
  method: string;
  rejectionReason?: string;
  adjustments: string[];
}

export interface RiskCheckResult {
  passed: boolean;
  checks: RiskCheck[];
  overallRisk: "low" | "medium" | "high" | "critical";
  blockReasons: string[];
}

export interface RiskCheck {
  name: string;
  passed: boolean;
  value: number;
  limit: number;
  severity: "info" | "warning" | "critical";
  message: string;
}

export interface CircuitBreakerState {
  isTripped: boolean;
  reason: string | null;
  trippedAt: Date | null;
  resetsAt: Date | null;
  dailyLoss: number;
  consecutiveLosses: number;
}

const DEFAULT_LIMITS: RiskLimits = {
  maxPositionSizePct: 10,
  maxPortfolioExposurePct: 200,
  maxDailyLossPct: 3,
  maxDrawdownPct: 15,
  maxOpenPositions: 10,
  maxCorrelatedPositions: 3,
  maxSingleTradeRiskPct: 2,
  minCashReservePct: 10,
  cooldownAfterLossMs: 60_000,
};

export class RiskManager {
  private limits: RiskLimits;
  private circuitBreaker: CircuitBreakerState;
  private dailyPnl = 0;
  private consecutiveLosses = 0;
  private lastLossTime: Date | null = null;
  private currentEquity: number;
  private currentCash: number;
  private openPositions = 0;
  private currentExposure = 0;
  private tradeLog: { ts: Date; pnl: number }[] = [];

  constructor(initialEquity: number, limits: Partial<RiskLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.currentEquity = initialEquity;
    this.currentCash = initialEquity;
    this.circuitBreaker = {
      isTripped: false,
      reason: null,
      trippedAt: null,
      resetsAt: null,
      dailyLoss: 0,
      consecutiveLosses: 0,
    };
  }

  /** Calculate position size for a trade */
  calculatePositionSize(request: PositionSizeRequest): PositionSizeResult {
    const adjustments: string[] = [];

    // 1. Base risk per trade
    let riskPct = this.limits.maxSingleTradeRiskPct;

    // 2. Adjust for confidence
    if (request.confidence < 0.5) {
      riskPct *= 0.5;
      adjustments.push(`Halved risk due to low confidence (${(request.confidence * 100).toFixed(0)}%)`);
    } else if (request.confidence > 0.8) {
      riskPct *= 1.2;
      adjustments.push(`Increased risk 20% due to high confidence (${(request.confidence * 100).toFixed(0)}%)`);
    }

    // 3. Adjust for regime
    if (request.regime === "high_vol" || request.regime === "risk_off") {
      riskPct *= 0.5;
      adjustments.push(`Halved risk for ${request.regime} regime`);
    }

    // 4. Adjust for volatility
    if (request.volatility > 0.03) {
      riskPct *= 0.7;
      adjustments.push("Reduced risk 30% for high volatility");
    }

    // 5. Adjust for consecutive losses
    if (this.consecutiveLosses >= 3) {
      riskPct *= 0.5;
      adjustments.push(`Halved risk after ${this.consecutiveLosses} consecutive losses`);
    }

    // Calculate quantity from risk
    const riskDollars = this.currentEquity * (riskPct / 100);
    const stopDistance = Math.abs(request.entryPrice - request.stopPrice);

    if (stopDistance <= 0) {
      return {
        approved: false,
        quantity: 0,
        riskDollars: 0,
        riskPercent: 0,
        positionValue: 0,
        positionWeight: 0,
        method: "fixed_risk",
        rejectionReason: "Stop distance is zero or negative",
        adjustments,
      };
    }

    let quantity = Math.floor(riskDollars / stopDistance);
    const positionValue = quantity * request.entryPrice;
    const positionWeight = this.currentEquity > 0 ? (positionValue / this.currentEquity) * 100 : 0;

    // Cap by max position size
    if (positionWeight > this.limits.maxPositionSizePct) {
      quantity = Math.floor((this.currentEquity * this.limits.maxPositionSizePct / 100) / request.entryPrice);
      adjustments.push(`Capped to ${this.limits.maxPositionSizePct}% position size`);
    }

    // Cap by available cash
    const maxByAvailableCash = Math.floor(
      (this.currentCash - this.currentEquity * this.limits.minCashReservePct / 100) / request.entryPrice
    );
    if (quantity > maxByAvailableCash) {
      quantity = Math.max(0, maxByAvailableCash);
      adjustments.push("Reduced for cash reserve requirement");
    }

    const finalRiskDollars = quantity * stopDistance;
    const finalRiskPct = this.currentEquity > 0 ? (finalRiskDollars / this.currentEquity) * 100 : 0;
    const finalPositionValue = quantity * request.entryPrice;
    const finalPositionWeight = this.currentEquity > 0 ? (finalPositionValue / this.currentEquity) * 100 : 0;

    return {
      approved: quantity > 0,
      quantity,
      riskDollars: finalRiskDollars,
      riskPercent: finalRiskPct,
      positionValue: finalPositionValue,
      positionWeight: finalPositionWeight,
      method: "fixed_risk_with_adjustments",
      rejectionReason: quantity <= 0 ? "Position size reduced to zero after adjustments" : undefined,
      adjustments,
    };
  }

  /** Run pre-trade risk checks */
  runPreTradeChecks(request: PositionSizeRequest): RiskCheckResult {
    const checks: RiskCheck[] = [];
    let blockReasons: string[] = [];

    // Circuit breaker check
    if (this.circuitBreaker.isTripped) {
      checks.push({
        name: "circuit_breaker",
        passed: false,
        value: 0,
        limit: 0,
        severity: "critical",
        message: `Circuit breaker active: ${this.circuitBreaker.reason}`,
      });
      blockReasons.push(`Circuit breaker: ${this.circuitBreaker.reason}`);
    }

    // Daily loss check
    const dailyLossPct = this.currentEquity > 0
      ? (Math.abs(Math.min(0, this.dailyPnl)) / this.currentEquity) * 100
      : 0;
    checks.push({
      name: "daily_loss",
      passed: dailyLossPct < this.limits.maxDailyLossPct,
      value: dailyLossPct,
      limit: this.limits.maxDailyLossPct,
      severity: dailyLossPct > this.limits.maxDailyLossPct * 0.8 ? "critical" : "info",
      message: `Daily loss: ${dailyLossPct.toFixed(2)}% / ${this.limits.maxDailyLossPct}%`,
    });
    if (dailyLossPct >= this.limits.maxDailyLossPct) {
      blockReasons.push("Daily loss limit reached");
    }

    // Open positions check
    checks.push({
      name: "open_positions",
      passed: this.openPositions < this.limits.maxOpenPositions,
      value: this.openPositions,
      limit: this.limits.maxOpenPositions,
      severity: this.openPositions >= this.limits.maxOpenPositions ? "critical" : "info",
      message: `Open positions: ${this.openPositions} / ${this.limits.maxOpenPositions}`,
    });
    if (this.openPositions >= this.limits.maxOpenPositions) {
      blockReasons.push("Max positions reached");
    }

    // Exposure check
    const exposurePct = this.currentEquity > 0
      ? (this.currentExposure / this.currentEquity) * 100
      : 0;
    checks.push({
      name: "portfolio_exposure",
      passed: exposurePct < this.limits.maxPortfolioExposurePct,
      value: exposurePct,
      limit: this.limits.maxPortfolioExposurePct,
      severity: exposurePct > this.limits.maxPortfolioExposurePct * 0.9 ? "warning" : "info",
      message: `Portfolio exposure: ${exposurePct.toFixed(1)}% / ${this.limits.maxPortfolioExposurePct}%`,
    });

    // Cooldown check
    if (this.lastLossTime) {
      const timeSinceLoss = Date.now() - this.lastLossTime.getTime();
      const inCooldown = timeSinceLoss < this.limits.cooldownAfterLossMs;
      checks.push({
        name: "loss_cooldown",
        passed: !inCooldown,
        value: timeSinceLoss,
        limit: this.limits.cooldownAfterLossMs,
        severity: inCooldown ? "warning" : "info",
        message: inCooldown
          ? `In cooldown: ${((this.limits.cooldownAfterLossMs - timeSinceLoss) / 1000).toFixed(0)}s remaining`
          : "No cooldown active",
      });
      if (inCooldown) {
        blockReasons.push("In post-loss cooldown period");
      }
    }

    const passed = checks.every((c) => c.passed);
    const criticalCount = checks.filter((c) => c.severity === "critical" && !c.passed).length;
    const warningCount = checks.filter((c) => c.severity === "warning" && !c.passed).length;

    const overallRisk = criticalCount > 0
      ? "critical"
      : warningCount > 1
      ? "high"
      : warningCount > 0
      ? "medium"
      : "low";

    return { passed, checks, overallRisk, blockReasons };
  }

  /** Record a trade P&L result */
  recordTradePnl(pnl: number): void {
    this.dailyPnl += pnl;
    this.tradeLog.push({ ts: new Date(), pnl });

    if (pnl < 0) {
      this.consecutiveLosses++;
      this.lastLossTime = new Date();
    } else if (pnl > 0) {
      this.consecutiveLosses = 0;
    }

    // Check circuit breaker
    this.checkCircuitBreaker();
  }

  /** Check and potentially trip the circuit breaker */
  private checkCircuitBreaker(): void {
    const dailyLossPct = this.currentEquity > 0
      ? (Math.abs(Math.min(0, this.dailyPnl)) / this.currentEquity) * 100
      : 0;

    if (dailyLossPct >= this.limits.maxDailyLossPct) {
      this.tripCircuitBreaker(`Daily loss limit reached: ${dailyLossPct.toFixed(2)}%`);
    }

    if (this.consecutiveLosses >= 5) {
      this.tripCircuitBreaker(`${this.consecutiveLosses} consecutive losses`);
    }
  }

  /** Trip the circuit breaker */
  private tripCircuitBreaker(reason: string): void {
    this.circuitBreaker = {
      isTripped: true,
      reason,
      trippedAt: new Date(),
      resetsAt: new Date(Date.now() + 3600_000), // 1 hour cooldown
      dailyLoss: this.dailyPnl,
      consecutiveLosses: this.consecutiveLosses,
    };
  }

  /** Reset circuit breaker */
  resetCircuitBreaker(): void {
    this.circuitBreaker = {
      isTripped: false,
      reason: null,
      trippedAt: null,
      resetsAt: null,
      dailyLoss: 0,
      consecutiveLosses: 0,
    };
  }

  /** Update portfolio state */
  updatePortfolioState(equity: number, cash: number, openPositions: number, exposure: number): void {
    this.currentEquity = equity;
    this.currentCash = cash;
    this.openPositions = openPositions;
    this.currentExposure = exposure;
  }

  /** Reset daily counters */
  resetDaily(): void {
    this.dailyPnl = 0;
    this.tradeLog = this.tradeLog.filter(
      (t) => Date.now() - t.ts.getTime() < 24 * 60 * 60 * 1000
    );
    if (this.circuitBreaker.isTripped && this.circuitBreaker.resetsAt &&
        new Date() >= this.circuitBreaker.resetsAt) {
      this.resetCircuitBreaker();
    }
  }

  /** Get current risk limits */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /** Update risk limits */
  updateLimits(newLimits: Partial<RiskLimits>): void {
    Object.assign(this.limits, newLimits);
  }

  /** Get circuit breaker state */
  getCircuitBreakerState(): CircuitBreakerState {
    return { ...this.circuitBreaker };
  }

  /** Get daily P&L */
  getDailyPnl(): number {
    return this.dailyPnl;
  }
}
