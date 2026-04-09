/**
 * portfolio_guardrails.ts — Guardrail System for Portfolio Risk Control
 *
 * Implements 4 core guardrail checks to prevent excessive portfolio concentration:
 * 1. Concentration: No single strategy > max_single_strategy_pct
 * 2. Correlation Cluster: No correlated group > max_correlation_cluster_pct
 * 3. Regime Overexposure: No single regime > max_regime_exposure_pct
 * 4. Daily CAR Cap: Daily capital at risk < daily_car_cap_pct of total capital
 *
 * Each check runs independently and returns:
 * - passed: boolean indicating if portfolio passes the guardrail
 * - severity: "info" | "warning" | "critical" based on how close to limit
 * - current_value: current utilization percentage or absolute amount
 * - threshold: the configured limit
 * - message: human-readable explanation
 *
 * AllocationExplanation provides visibility into why allocations are approved/denied,
 * including reasons that may reference guardrail checks that influenced the decision.
 */

import { randomUUID } from "node:crypto";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "portfolio_guardrails" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardrailCheckType =
  | "concentration"
  | "correlation_cluster"
  | "regime_overexposure"
  | "daily_car_cap";

export type Severity = "info" | "warning" | "critical";

export interface GuardrailCheck {
  check_id: string;
  type: GuardrailCheckType;
  passed: boolean;
  severity: Severity;
  current_value: number;      // Current utilization or amount
  threshold: number;          // The configured limit
  message: string;
  timestamp: string;
}

export interface GuardrailConfig {
  max_single_strategy_pct: number;      // Default 25
  max_correlation_cluster_pct: number;  // Default 40
  max_regime_exposure_pct: number;      // Default 60
  daily_car_cap_pct: number;            // Default 5
  updated_at: string;
}

export interface AllocationExplanation {
  explanation_id: string;
  strategy_id: string;
  action: "increased" | "reduced" | "blocked" | "unchanged";
  original_size: number;
  adjusted_size: number;
  reasons: string[];
  guardrail_violations: GuardrailCheckType[];
  timestamp: string;
}

export interface PortfolioState {
  total_capital: number;
  strategy_allocations: Record<string, number>;    // strategy_id -> allocated amount
  correlation_clusters: Record<string, string[]>;  // cluster_id -> [strategy_ids]
  regime_allocations: Record<string, number>;      // regime -> total allocated
  daily_capital_at_risk: number;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _guardrailConfig: GuardrailConfig = {
  max_single_strategy_pct: 25,
  max_correlation_cluster_pct: 40,
  max_regime_exposure_pct: 60,
  daily_car_cap_pct: 5,
  updated_at: new Date().toISOString(),
};

const guardrailChecks: GuardrailCheck[] = [];
const allocationExplanations: AllocationExplanation[] = [];
const MAX_CHECK_HISTORY = 500;
const MAX_EXPLANATION_HISTORY = 1000;

// ─── Helper Functions ─────────────────────────────────────────────────────────

function generateCheckId(): string {
  return `check-${randomUUID()}`;
}

function generateExplanationId(): string {
  return `explain-${randomUUID()}`;
}

function calculateSeverity(utilization: number, threshold: number): Severity {
  if (utilization <= threshold * 0.7) {
    return "info";
  } else if (utilization <= threshold * 0.9) {
    return "warning";
  } else {
    return "critical";
  }
}

// ─── Guardrail Check Functions ─────────────────────────────────────────────────

export function checkConcentration(portfolio: PortfolioState): GuardrailCheck {
  const threshold = _guardrailConfig.max_single_strategy_pct;
  let maxStrategyPct = 0;
  let worstStrategy = "";

  for (const [strategy_id, allocated] of Object.entries(portfolio.strategy_allocations)) {
    const pct = (allocated / portfolio.total_capital) * 100;
    if (pct > maxStrategyPct) {
      maxStrategyPct = pct;
      worstStrategy = strategy_id;
    }
  }

  const passed = maxStrategyPct <= threshold;
  const severity = calculateSeverity(maxStrategyPct, threshold);

  const check: GuardrailCheck = {
    check_id: generateCheckId(),
    type: "concentration",
    passed,
    severity,
    current_value: maxStrategyPct,
    threshold,
    message: passed
      ? `Concentration OK: largest strategy is ${maxStrategyPct.toFixed(1)}% (limit ${threshold}%)`
      : `CONCENTRATION ALERT: strategy "${worstStrategy}" is ${maxStrategyPct.toFixed(1)}% (limit ${threshold}%)`,
    timestamp: new Date().toISOString(),
  };

  guardrailChecks.push(check);
  if (guardrailChecks.length > MAX_CHECK_HISTORY) {
    guardrailChecks.shift();
  }

  return check;
}

export function checkCorrelationCluster(portfolio: PortfolioState): GuardrailCheck {
  const threshold = _guardrailConfig.max_correlation_cluster_pct;
  let maxClusterPct = 0;
  let worstCluster = "";

  for (const [cluster_id, strategy_ids] of Object.entries(portfolio.correlation_clusters)) {
    const clusterAllocated = strategy_ids.reduce((sum, sid) => {
      return sum + (portfolio.strategy_allocations[sid] ?? 0);
    }, 0);
    const pct = (clusterAllocated / portfolio.total_capital) * 100;

    if (pct > maxClusterPct) {
      maxClusterPct = pct;
      worstCluster = cluster_id;
    }
  }

  const passed = maxClusterPct <= threshold;
  const severity = calculateSeverity(maxClusterPct, threshold);

  const check: GuardrailCheck = {
    check_id: generateCheckId(),
    type: "correlation_cluster",
    passed,
    severity,
    current_value: maxClusterPct,
    threshold,
    message: passed
      ? `Cluster correlation OK: largest cluster is ${maxClusterPct.toFixed(1)}% (limit ${threshold}%)`
      : `CLUSTER ALERT: cluster "${worstCluster}" is ${maxClusterPct.toFixed(1)}% (limit ${threshold}%)`,
    timestamp: new Date().toISOString(),
  };

  guardrailChecks.push(check);
  if (guardrailChecks.length > MAX_CHECK_HISTORY) {
    guardrailChecks.shift();
  }

  return check;
}

export function checkRegimeExposure(portfolio: PortfolioState): GuardrailCheck {
  const threshold = _guardrailConfig.max_regime_exposure_pct;
  let maxRegimePct = 0;
  let worstRegime = "";

  for (const [regime, allocated] of Object.entries(portfolio.regime_allocations)) {
    const pct = (allocated / portfolio.total_capital) * 100;
    if (pct > maxRegimePct) {
      maxRegimePct = pct;
      worstRegime = regime;
    }
  }

  const passed = maxRegimePct <= threshold;
  const severity = calculateSeverity(maxRegimePct, threshold);

  const check: GuardrailCheck = {
    check_id: generateCheckId(),
    type: "regime_overexposure",
    passed,
    severity,
    current_value: maxRegimePct,
    threshold,
    message: passed
      ? `Regime exposure OK: largest regime is ${maxRegimePct.toFixed(1)}% (limit ${threshold}%)`
      : `REGIME ALERT: regime "${worstRegime}" is ${maxRegimePct.toFixed(1)}% (limit ${threshold}%)`,
    timestamp: new Date().toISOString(),
  };

  guardrailChecks.push(check);
  if (guardrailChecks.length > MAX_CHECK_HISTORY) {
    guardrailChecks.shift();
  }

  return check;
}

export function checkDailyCAR(portfolio: PortfolioState): GuardrailCheck {
  const carCapAmount = (portfolio.total_capital * _guardrailConfig.daily_car_cap_pct) / 100;
  const carPct = (portfolio.daily_capital_at_risk / carCapAmount) * 100;

  const passed = portfolio.daily_capital_at_risk <= carCapAmount;
  const severity = calculateSeverity(carPct, 100);

  const check: GuardrailCheck = {
    check_id: generateCheckId(),
    type: "daily_car_cap",
    passed,
    severity,
    current_value: portfolio.daily_capital_at_risk,
    threshold: carCapAmount,
    message: passed
      ? `Daily CAR OK: ${portfolio.daily_capital_at_risk.toFixed(2)} / ${carCapAmount.toFixed(2)} available`
      : `DAILY CAR ALERT: ${portfolio.daily_capital_at_risk.toFixed(2)} exceeds cap of ${carCapAmount.toFixed(2)}`,
    timestamp: new Date().toISOString(),
  };

  guardrailChecks.push(check);
  if (guardrailChecks.length > MAX_CHECK_HISTORY) {
    guardrailChecks.shift();
  }

  return check;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function runGuardrailChecks(portfolio: PortfolioState): GuardrailCheck[] {
  const checks = [
    checkConcentration(portfolio),
    checkCorrelationCluster(portfolio),
    checkRegimeExposure(portfolio),
    checkDailyCAR(portfolio),
  ];

  const allPassed = checks.every((c) => c.passed);
  const hasWarnings = checks.some((c) => c.severity === "warning");
  const hasCritical = checks.some((c) => c.severity === "critical");

  logger.debug(
    {
      all_passed: allPassed,
      has_warnings: hasWarnings,
      has_critical: hasCritical,
      check_count: checks.length,
    },
    "Guardrail checks completed"
  );

  return checks;
}

export function explainAllocationDecision(
  strategy_id: string,
  original_size: number,
  adjusted_size: number,
  portfolio: PortfolioState,
): AllocationExplanation {
  const checks = runGuardrailChecks(portfolio);
  const violations = checks.filter((c) => !c.passed).map((c) => c.type);

  let action: "increased" | "reduced" | "blocked" | "unchanged" = "unchanged";
  if (adjusted_size > original_size) {
    action = "increased";
  } else if (adjusted_size < original_size && adjusted_size > 0) {
    action = "reduced";
  } else if (adjusted_size === 0) {
    action = "blocked";
  }

  const reasons: string[] = [];

  if (action === "blocked") {
    reasons.push("Portfolio guardrails would be breached by any allocation");
    violations.forEach((type) => {
      const check = checks.find((c) => c.type === type);
      if (check) reasons.push(check.message);
    });
  } else if (action === "reduced") {
    reasons.push(`Reduced from ${original_size} to ${adjusted_size} to maintain guardrails`);
    violations.forEach((type) => {
      const check = checks.find((c) => c.type === type);
      if (check) reasons.push(check.message);
    });
  } else if (action === "increased") {
    reasons.push(`Increased from ${original_size} to ${adjusted_size} due to available capacity`);
  } else {
    reasons.push("Allocation unchanged");
  }

  const explanation: AllocationExplanation = {
    explanation_id: generateExplanationId(),
    strategy_id,
    action,
    original_size,
    adjusted_size,
    reasons,
    guardrail_violations: violations,
    timestamp: new Date().toISOString(),
  };

  allocationExplanations.push(explanation);
  if (allocationExplanations.length > MAX_EXPLANATION_HISTORY) {
    allocationExplanations.shift();
  }

  logger.info(
    {
      explanation_id: explanation.explanation_id,
      strategy_id,
      action,
      violations: violations.length,
    },
    "Allocation explained"
  );

  return explanation;
}

export function getGuardrailConfig(): GuardrailConfig {
  return { ..._guardrailConfig };
}

export function updateGuardrailConfig(
  updates: Partial<GuardrailConfig>
): { success: boolean; data?: GuardrailConfig; error?: string } {
  const validation = validateGuardrailConfig(updates);
  if (validation) {
    logger.warn({ error: validation }, "Guardrail config update rejected");
    return { success: false, error: validation };
  }

  if (updates.max_single_strategy_pct !== undefined) {
    _guardrailConfig.max_single_strategy_pct = updates.max_single_strategy_pct;
  }
  if (updates.max_correlation_cluster_pct !== undefined) {
    _guardrailConfig.max_correlation_cluster_pct = updates.max_correlation_cluster_pct;
  }
  if (updates.max_regime_exposure_pct !== undefined) {
    _guardrailConfig.max_regime_exposure_pct = updates.max_regime_exposure_pct;
  }
  if (updates.daily_car_cap_pct !== undefined) {
    _guardrailConfig.daily_car_cap_pct = updates.daily_car_cap_pct;
  }

  _guardrailConfig.updated_at = new Date().toISOString();

  logger.info(
    { updated_keys: Object.keys(updates).filter((k) => k !== "updated_at") },
    "Guardrail config updated"
  );

  return { success: true, data: _guardrailConfig };
}

function validateGuardrailConfig(config: Partial<GuardrailConfig>): string | null {
  if (
    config.max_single_strategy_pct !== undefined &&
    (config.max_single_strategy_pct < 1 || config.max_single_strategy_pct > 100)
  ) {
    return "max_single_strategy_pct must be between 1 and 100";
  }

  if (
    config.max_correlation_cluster_pct !== undefined &&
    (config.max_correlation_cluster_pct < 1 || config.max_correlation_cluster_pct > 100)
  ) {
    return "max_correlation_cluster_pct must be between 1 and 100";
  }

  if (
    config.max_regime_exposure_pct !== undefined &&
    (config.max_regime_exposure_pct < 1 || config.max_regime_exposure_pct > 100)
  ) {
    return "max_regime_exposure_pct must be between 1 and 100";
  }

  if (
    config.daily_car_cap_pct !== undefined &&
    (config.daily_car_cap_pct < 0 || config.daily_car_cap_pct > 100)
  ) {
    return "daily_car_cap_pct must be between 0 and 100";
  }

  return null;
}

export function getGuardrailCheckHistory(limit: number = 100): GuardrailCheck[] {
  return guardrailChecks.slice(-limit);
}

export function getAllocationExplanationHistory(limit: number = 50): AllocationExplanation[] {
  return allocationExplanations.slice(-limit);
}

export function _clearAll(): void {
  guardrailChecks.length = 0;
  allocationExplanations.length = 0;
  _guardrailConfig = {
    max_single_strategy_pct: 25,
    max_correlation_cluster_pct: 40,
    max_regime_exposure_pct: 60,
    daily_car_cap_pct: 5,
    updated_at: new Date().toISOString(),
  };
  logger.debug("Portfolio guardrails state cleared");
}
