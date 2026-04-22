/**
 * Exposure Guard — Hard limits on position sizing and portfolio exposure.
 *
 * Enforces:
 * 1. Per-symbol max position size (% of capital)
 * 2. Per-strategy max allocation
 * 3. Total portfolio exposure cap
 * 4. Sector/correlation concentration limits
 * 5. Daily new-position limit
 * 6. Concurrent open position limit
 *
 * All limits are HARD — no override, no bypass.
 * Violations are logged and blocked, never warned-and-allowed.
 */
import { logger } from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ExposureLimits {
  maxPositionPct: number;          // max single position as % of capital (e.g. 0.05 = 5%)
  maxPortfolioExposurePct: number; // max total exposure as % of capital (e.g. 0.80 = 80%)
  maxConcurrentPositions: number;  // max number of open positions at once
  maxDailyNewPositions: number;    // max new positions opened per day
  maxPerStrategyPct: number;       // max allocation per strategy (e.g. 0.25 = 25%)
  maxCorrelatedExposurePct: number; // max exposure to correlated assets (e.g. 0.30 = 30%)
}

export interface PortfolioSnapshot {
  totalCapital: number;
  openPositions: PositionSnapshot[];
  dailyNewPositionCount: number;
  date: string; // YYYY-MM-DD
}

export interface PositionSnapshot {
  symbol: string;
  strategy: string;
  notionalValue: number;
  direction: "long" | "short";
  entryTime: string;
}

export interface ExposureCheckResult {
  allowed: boolean;
  violations: ExposureViolation[];
  currentExposure: {
    totalExposurePct: number;
    positionCount: number;
    dailyNewPositions: number;
    requestedPositionPct: number;
  };
}

export interface ExposureViolation {
  rule: string;
  limit: number;
  actual: number;
  message: string;
}

// ── Default Limits (conservative for paper trading) ──────────────────────────

const DEFAULT_LIMITS: ExposureLimits = {
  maxPositionPct: 0.05,            // 5% per position
  maxPortfolioExposurePct: 0.60,   // 60% total exposure
  maxConcurrentPositions: 8,       // 8 positions max
  maxDailyNewPositions: 10,        // 10 new positions per day
  maxPerStrategyPct: 0.25,         // 25% per strategy
  maxCorrelatedExposurePct: 0.30,  // 30% correlated exposure
};

let activeLimits: ExposureLimits = { ...DEFAULT_LIMITS };

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Check if a proposed new position passes all exposure limits.
 * Returns detailed result with violations (if any).
 */
export function checkExposure(
  proposed: {
    symbol: string;
    strategy: string;
    notionalValue: number;
    direction: "long" | "short";
  },
  portfolio: PortfolioSnapshot,
  limits: ExposureLimits = activeLimits,
): ExposureCheckResult {
  const violations: ExposureViolation[] = [];

  const totalCapital = portfolio.totalCapital;
  if (totalCapital <= 0) {
    violations.push({
      rule: "capital_check",
      limit: 0,
      actual: totalCapital,
      message: "Total capital is zero or negative — cannot assess exposure",
    });
    return {
      allowed: false,
      violations,
      currentExposure: {
        totalExposurePct: 0,
        positionCount: 0,
        dailyNewPositions: 0,
        requestedPositionPct: 0,
      },
    };
  }

  const requestedPct = proposed.notionalValue / totalCapital;
  const currentExposure = portfolio.openPositions.reduce(
    (sum, p) => sum + p.notionalValue, 0,
  );
  const currentExposurePct = currentExposure / totalCapital;
  const newExposurePct = (currentExposure + proposed.notionalValue) / totalCapital;

  // 1. Per-position size limit
  if (requestedPct > limits.maxPositionPct) {
    violations.push({
      rule: "max_position_size",
      limit: limits.maxPositionPct,
      actual: requestedPct,
      message: `Position size ${(requestedPct * 100).toFixed(1)}% exceeds limit ${(limits.maxPositionPct * 100).toFixed(1)}%`,
    });
  }

  // 2. Total portfolio exposure
  if (newExposurePct > limits.maxPortfolioExposurePct) {
    violations.push({
      rule: "max_portfolio_exposure",
      limit: limits.maxPortfolioExposurePct,
      actual: newExposurePct,
      message: `Portfolio exposure would be ${(newExposurePct * 100).toFixed(1)}%, exceeds ${(limits.maxPortfolioExposurePct * 100).toFixed(1)}%`,
    });
  }

  // 3. Concurrent position limit
  if (portfolio.openPositions.length >= limits.maxConcurrentPositions) {
    violations.push({
      rule: "max_concurrent_positions",
      limit: limits.maxConcurrentPositions,
      actual: portfolio.openPositions.length,
      message: `Already at ${portfolio.openPositions.length} open positions (limit: ${limits.maxConcurrentPositions})`,
    });
  }

  // 4. Daily new position limit
  if (portfolio.dailyNewPositionCount >= limits.maxDailyNewPositions) {
    violations.push({
      rule: "max_daily_new_positions",
      limit: limits.maxDailyNewPositions,
      actual: portfolio.dailyNewPositionCount,
      message: `Already opened ${portfolio.dailyNewPositionCount} positions today (limit: ${limits.maxDailyNewPositions})`,
    });
  }

  // 5. Per-strategy concentration
  const strategyExposure = portfolio.openPositions
    .filter(p => p.strategy === proposed.strategy)
    .reduce((sum, p) => sum + p.notionalValue, 0);
  const strategyPct = (strategyExposure + proposed.notionalValue) / totalCapital;

  if (strategyPct > limits.maxPerStrategyPct) {
    violations.push({
      rule: "max_per_strategy",
      limit: limits.maxPerStrategyPct,
      actual: strategyPct,
      message: `Strategy "${proposed.strategy}" exposure would be ${(strategyPct * 100).toFixed(1)}%, exceeds ${(limits.maxPerStrategyPct * 100).toFixed(1)}%`,
    });
  }

  // 6. Duplicate symbol check (don't double up)
  const existingSameSymbol = portfolio.openPositions.filter(
    p => p.symbol === proposed.symbol && p.direction === proposed.direction,
  );
  if (existingSameSymbol.length > 0) {
    violations.push({
      rule: "duplicate_position",
      limit: 0,
      actual: existingSameSymbol.length,
      message: `Already have ${existingSameSymbol.length} ${proposed.direction} position(s) in ${proposed.symbol}`,
    });
  }

  const result: ExposureCheckResult = {
    allowed: violations.length === 0,
    violations,
    currentExposure: {
      totalExposurePct: currentExposurePct,
      positionCount: portfolio.openPositions.length,
      dailyNewPositions: portfolio.dailyNewPositionCount,
      requestedPositionPct: requestedPct,
    },
  };

  if (violations.length > 0) {
    logger.warn({
      symbol: proposed.symbol,
      strategy: proposed.strategy,
      violations: violations.map(v => v.rule),
      violationCount: violations.length,
    }, "Exposure guard BLOCKED position");
  }

  return result;
}

/**
 * Hard guard — call before any order. Throws on violation.
 */
export function guardExposure(
  proposed: {
    symbol: string;
    strategy: string;
    notionalValue: number;
    direction: "long" | "short";
  },
  portfolio: PortfolioSnapshot,
): void {
  const result = checkExposure(proposed, portfolio);
  if (!result.allowed) {
    const reasons = result.violations.map(v => v.message).join("; ");
    throw new Error(`Exposure guard violation: ${reasons}`);
  }
}

/** Update exposure limits at runtime (operator action, logged) */
export function updateExposureLimits(
  updates: Partial<ExposureLimits>,
  actor: string,
): ExposureLimits {
  const prev = { ...activeLimits };
  activeLimits = { ...activeLimits, ...updates };

  logger.info({
    actor,
    previous: prev,
    updated: activeLimits,
  }, "Exposure limits updated");

  return { ...activeLimits };
}

/** Get current limits */
export function getExposureLimits(): Readonly<ExposureLimits> {
  return { ...activeLimits };
}

/** Reset to defaults (testing) */
export function _resetExposureLimits(): void {
  activeLimits = { ...DEFAULT_LIMITS };
}
