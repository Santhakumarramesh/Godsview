/**
 * canary_controller.ts — Canary Deployment & Auto-Demotion Engine
 *
 * Manages canary deployments with automatic demotion rules.
 * Monitors performance metrics and demotes/revokes canaries based on thresholds.
 *
 * Deployment lifecycle:
 *   pending → active → [demoted/graduated/revoked]
 *
 * Auto-demotion rules trigger on:
 *   - PnL thresholds (drawdown, max loss)
 *   - Trade count violations
 *   - Position size breaches
 *   - Regime mismatch
 */

import { randomUUID } from "crypto";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "canary" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type CanaryStatus = "pending" | "active" | "demoted" | "graduated" | "revoked";
export type ComparisonOperator = "gt" | "lt" | "gte" | "lte" | "eq" | "ne";
export type AutoDemotionAction = "demote" | "revoke";

export interface AutoDemotionRule {
  rule_id?: string;
  metric: string; // "pnl", "drawdown", "trade_count", "max_position_size", "sharpe_ratio"
  threshold: number;
  comparison: ComparisonOperator;
  action: AutoDemotionAction;
}

export interface CanaryConfig {
  strategy_id: string;
  symbols_allowed: string[];
  max_position_size: number;
  max_daily_trades: number;
  trust_tier_required: "bronze" | "silver" | "gold" | "platinum";
  regime_allowed: string[];
  auto_demotion_rules: AutoDemotionRule[];
}

export interface PerformanceMetrics {
  total_trades: number;
  total_pnl: number;
  win_rate: number;
  drawdown: number;
  sharpe_ratio: number;
  daily_trades: number;
  largest_position_size: number;
  last_updated: string;
}

export interface CanaryDeployment {
  deployment_id: string;
  strategy_id: string;
  config: CanaryConfig;
  status: CanaryStatus;
  trades_executed: number;
  performance_metrics: PerformanceMetrics;
  demotion_reasons: string[];
  created_at: string;
  activated_at: string | null;
  completed_at: string | null;
}

// ─── State ────────────────────────────────────────────────────────────────────

const _deployments = new Map<string, CanaryDeployment>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new canary deployment (in pending status).
 */
export function createCanaryDeployment(config: CanaryConfig): {
  success: boolean;
  data?: CanaryDeployment;
  error?: string;
} {
  try {
    const deployment_id = `can_${randomUUID()}`;
    const now = new Date().toISOString();

    // Ensure each rule has an ID
    const rulesWithIds = config.auto_demotion_rules.map((rule) => ({
      ...rule,
      rule_id: rule.rule_id ?? `rule_${randomUUID()}`,
    }));

    const deployment: CanaryDeployment = {
      deployment_id,
      strategy_id: config.strategy_id,
      config: {
        ...config,
        auto_demotion_rules: rulesWithIds,
      },
      status: "pending",
      trades_executed: 0,
      performance_metrics: {
        total_trades: 0,
        total_pnl: 0,
        win_rate: 0,
        drawdown: 0,
        sharpe_ratio: 0,
        daily_trades: 0,
        largest_position_size: 0,
        last_updated: now,
      },
      demotion_reasons: [],
      created_at: now,
      activated_at: null,
      completed_at: null,
    };

    _deployments.set(deployment_id, deployment);
    logger.info(`[canary] Created deployment ${deployment_id} for ${config.strategy_id}`);

    return { success: true, data: deployment };
  } catch (err) {
    logger.error({ err }, "[canary] createCanaryDeployment error");
    return { success: false, error: String(err) };
  }
}

/**
 * Activate a pending canary deployment.
 */
export function activateCanary(deployment_id: string): {
  success: boolean;
  data?: CanaryDeployment;
  error?: string;
} {
  try {
    const deployment = _deployments.get(deployment_id);
    if (!deployment) {
      return { success: false, error: "deployment_not_found" };
    }

    if (deployment.status !== "pending") {
      return { success: false, error: "deployment_not_pending" };
    }

    deployment.status = "active";
    deployment.activated_at = new Date().toISOString();

    logger.info(`[canary] Activated deployment ${deployment_id}`);

    return { success: true, data: deployment };
  } catch (err) {
    logger.error({ err }, "[canary] activateCanary error");
    return { success: false, error: String(err) };
  }
}

/**
 * Check demotion rules against current performance metrics.
 * Returns triggered rules, if any.
 */
export function checkDemotionRules(deployment_id: string): {
  success: boolean;
  data?: {
    triggered_rules: AutoDemotionRule[];
    should_demote: boolean;
    should_revoke: boolean;
  };
  error?: string;
} {
  try {
    const deployment = _deployments.get(deployment_id);
    if (!deployment) {
      return { success: false, error: "deployment_not_found" };
    }

    const metrics = deployment.performance_metrics;
    const triggered_rules: AutoDemotionRule[] = [];
    let should_demote = false;
    let should_revoke = false;

    for (const rule of deployment.config.auto_demotion_rules) {
      const ruleMetricValue = getMetricValue(metrics, rule.metric);
      const triggered = checkThreshold(ruleMetricValue, rule.threshold, rule.comparison);

      if (triggered) {
        triggered_rules.push(rule);
        if (rule.action === "demote") {
          should_demote = true;
        } else if (rule.action === "revoke") {
          should_revoke = true;
        }
      }
    }

    logger.info(
      `[canary] Checked demotion rules for ${deployment_id}: ${triggered_rules.length} triggered, should_demote=${should_demote}, should_revoke=${should_revoke}`
    );

    return {
      success: true,
      data: {
        triggered_rules,
        should_demote,
        should_revoke,
      },
    };
  } catch (err) {
    logger.error({ err }, "[canary] checkDemotionRules error");
    return { success: false, error: String(err) };
  }
}

/**
 * Demote an active canary to pending.
 */
export function demoteCanary(deployment_id: string, reason: string): {
  success: boolean;
  data?: CanaryDeployment;
  error?: string;
} {
  try {
    const deployment = _deployments.get(deployment_id);
    if (!deployment) {
      return { success: false, error: "deployment_not_found" };
    }

    if (deployment.status !== "active") {
      return { success: false, error: "deployment_not_active" };
    }

    deployment.status = "demoted";
    deployment.demotion_reasons.push(reason);
    deployment.completed_at = new Date().toISOString();

    logger.warn(`[canary] Demoted ${deployment_id}: ${reason}`);

    return { success: true, data: deployment };
  } catch (err) {
    logger.error({ err }, "[canary] demoteCanary error");
    return { success: false, error: String(err) };
  }
}

/**
 * Graduate a canary deployment to full production status.
 */
export function graduateCanary(deployment_id: string): {
  success: boolean;
  data?: CanaryDeployment;
  error?: string;
} {
  try {
    const deployment = _deployments.get(deployment_id);
    if (!deployment) {
      return { success: false, error: "deployment_not_found" };
    }

    if (deployment.status !== "active") {
      return { success: false, error: "deployment_not_active" };
    }

    deployment.status = "graduated";
    deployment.completed_at = new Date().toISOString();

    logger.info(`[canary] Graduated deployment ${deployment_id} to production`);

    return { success: true, data: deployment };
  } catch (err) {
    logger.error({ err }, "[canary] graduateCanary error");
    return { success: false, error: String(err) };
  }
}

/**
 * Revoke a deployment (cannot be reactivated).
 */
export function revokeCanary(deployment_id: string, reason: string): {
  success: boolean;
  data?: CanaryDeployment;
  error?: string;
} {
  try {
    const deployment = _deployments.get(deployment_id);
    if (!deployment) {
      return { success: false, error: "deployment_not_found" };
    }

    if (deployment.status === "revoked") {
      return { success: false, error: "already_revoked" };
    }

    deployment.status = "revoked";
    deployment.demotion_reasons.push(`REVOKED: ${reason}`);
    deployment.completed_at = new Date().toISOString();

    logger.warn(`[canary] Revoked ${deployment_id}: ${reason}`);

    return { success: true, data: deployment };
  } catch (err) {
    logger.error({ err }, "[canary] revokeCanary error");
    return { success: false, error: String(err) };
  }
}

/**
 * Get a deployment by ID.
 */
export function getDeployment(deployment_id: string): CanaryDeployment | null {
  return _deployments.get(deployment_id) ?? null;
}

/**
 * Get all deployments for a strategy.
 */
export function getDeploymentsByStrategy(strategy_id: string): CanaryDeployment[] {
  return Array.from(_deployments.values()).filter((d) => d.strategy_id === strategy_id);
}

/**
 * Get all active canary deployments.
 */
export function getActiveDeployments(): CanaryDeployment[] {
  return Array.from(_deployments.values()).filter((d) => d.status === "active");
}

/**
 * Get all deployments.
 */
export function getAllDeployments(): CanaryDeployment[] {
  return Array.from(_deployments.values());
}

/**
 * Update performance metrics for a deployment.
 */
export function updatePerformanceMetrics(
  deployment_id: string,
  metrics: Partial<PerformanceMetrics>
): { success: boolean; data?: CanaryDeployment; error?: string } {
  try {
    const deployment = _deployments.get(deployment_id);
    if (!deployment) {
      return { success: false, error: "deployment_not_found" };
    }

    const current = deployment.performance_metrics;
    deployment.performance_metrics = {
      total_trades: metrics.total_trades ?? current.total_trades,
      total_pnl: metrics.total_pnl ?? current.total_pnl,
      win_rate: metrics.win_rate ?? current.win_rate,
      drawdown: metrics.drawdown ?? current.drawdown,
      sharpe_ratio: metrics.sharpe_ratio ?? current.sharpe_ratio,
      daily_trades: metrics.daily_trades ?? current.daily_trades,
      largest_position_size: metrics.largest_position_size ?? current.largest_position_size,
      last_updated: new Date().toISOString(),
    };

    logger.info(`[canary] Updated metrics for ${deployment_id}`);

    return { success: true, data: deployment };
  } catch (err) {
    logger.error({ err }, "[canary] updatePerformanceMetrics error");
    return { success: false, error: String(err) };
  }
}

/**
 * Clear all deployments (for testing).
 */
export function _clearDeployments(): void {
  _deployments.clear();
  logger.info("[canary] Cleared all deployments");
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function getMetricValue(metrics: PerformanceMetrics, metricName: string): number {
  switch (metricName) {
    case "pnl":
      return metrics.total_pnl;
    case "drawdown":
      return metrics.drawdown;
    case "trade_count":
      return metrics.total_trades;
    case "max_position_size":
      return metrics.largest_position_size;
    case "sharpe_ratio":
      return metrics.sharpe_ratio;
    case "daily_trades":
      return metrics.daily_trades;
    case "win_rate":
      return metrics.win_rate;
    default:
      return 0;
  }
}

function checkThreshold(value: number, threshold: number, operator: ComparisonOperator): boolean {
  switch (operator) {
    case "gt":
      return value > threshold;
    case "lt":
      return value < threshold;
    case "gte":
      return value >= threshold;
    case "lte":
      return value <= threshold;
    case "eq":
      return value === threshold;
    case "ne":
      return value !== threshold;
    default:
      return false;
  }
}
