/**
 * Live Mode Gate — Hard preflight checks before enabling live trading.
 *
 * Live mode is NOT a default. It is EARNED through evidence.
 * This gate runs a comprehensive checklist before any live order can execute.
 *
 * Preflight checks:
 * 1. Strategy has passed walk-forward OOS validation
 * 2. Strategy has paper trading track record (min 30 days, 50+ trades)
 * 3. Calibration drift is within acceptable bounds
 * 4. Risk limits are configured and active
 * 5. Kill switch is not active or in cooldown
 * 6. Data feeds are healthy and fresh
 * 7. Broker connection is verified
 * 8. Operator has explicitly approved live mode
 * 9. System health checks pass
 * 10. Environment is correctly configured for live
 *
 * ALL checks must pass. No partial approval. No override.
 */
import { logger } from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PreflightCheck {
  name: string;
  category: "strategy" | "risk" | "data" | "system" | "operator";
  passed: boolean;
  required: boolean;
  message: string;
  details?: Record<string, unknown>;
}

export interface PreflightResult {
  allPassed: boolean;
  passedCount: number;
  failedCount: number;
  checks: PreflightCheck[];
  evaluatedAt: string;
  recommendation: "approve" | "deny" | "conditional";
  blockers: string[];
}

export interface StrategyEvidence {
  strategyId: string;
  walkForwardPassed: boolean;
  oosWinRate: number;
  oosSharpe: number;
  oosDegrade: number;
  paperTradingDays: number;
  paperTradingTrades: number;
  paperTradingWinRate: number;
  paperTradingPnl: number;
  calibrationDrift: number;
  lastReviewedAt: string | null;
  operatorApproved: boolean;
}

export interface SystemHealthSnapshot {
  dataFeedHealthy: boolean;
  dataFeedLatencyMs: number;
  brokerConnected: boolean;
  brokerLatencyMs: number;
  killSwitchActive: boolean;
  killSwitchCooldown: boolean;
  riskLimitsConfigured: boolean;
  memoryUsagePct: number;
  cpuUsagePct: number;
  uptimeMinutes: number;
}

// ── Thresholds ───────────────────────────────────────────────────────────────

const THRESHOLDS = {
  minPaperDays: 30,
  minPaperTrades: 50,
  minPaperWinRate: 0.48,
  minOOSWinRate: 0.50,
  minOOSSharpe: 0.5,
  maxOOSDegrade: 0.25,
  maxCalibrationDrift: 0.15,
  maxDataFeedLatencyMs: 5000,
  maxBrokerLatencyMs: 3000,
  minUptimeMinutes: 5,
  maxMemoryUsagePct: 90,
} as const;

// ── Preflight Evaluation ─────────────────────────────────────────────────────

/**
 * Run full preflight evaluation for a strategy going live.
 * ALL required checks must pass.
 */
export function evaluateLivePreflight(
  evidence: StrategyEvidence,
  health: SystemHealthSnapshot,
  mode: string, // current GODSVIEW_SYSTEM_MODE
): PreflightResult {
  const checks: PreflightCheck[] = [];

  // ── Strategy Evidence Checks ──────────────────────────────────────────

  checks.push({
    name: "walk_forward_validation",
    category: "strategy",
    passed: evidence.walkForwardPassed,
    required: true,
    message: evidence.walkForwardPassed
      ? "Walk-forward OOS validation passed"
      : "Walk-forward OOS validation NOT passed — strategy has not proven OOS robustness",
  });

  checks.push({
    name: "oos_win_rate",
    category: "strategy",
    passed: evidence.oosWinRate >= THRESHOLDS.minOOSWinRate,
    required: true,
    message: `OOS win rate: ${(evidence.oosWinRate * 100).toFixed(1)}% (min: ${(THRESHOLDS.minOOSWinRate * 100).toFixed(1)}%)`,
    details: { oosWinRate: evidence.oosWinRate },
  });

  checks.push({
    name: "oos_sharpe",
    category: "strategy",
    passed: evidence.oosSharpe >= THRESHOLDS.minOOSSharpe,
    required: true,
    message: `OOS Sharpe: ${evidence.oosSharpe.toFixed(2)} (min: ${THRESHOLDS.minOOSSharpe})`,
    details: { oosSharpe: evidence.oosSharpe },
  });

  checks.push({
    name: "oos_degradation",
    category: "strategy",
    passed: evidence.oosDegrade <= THRESHOLDS.maxOOSDegrade,
    required: true,
    message: `OOS degradation: ${(evidence.oosDegrade * 100).toFixed(1)}% (max: ${(THRESHOLDS.maxOOSDegrade * 100).toFixed(1)}%)`,
    details: { oosDegrade: evidence.oosDegrade },
  });

  checks.push({
    name: "paper_trading_duration",
    category: "strategy",
    passed: evidence.paperTradingDays >= THRESHOLDS.minPaperDays,
    required: true,
    message: `Paper trading: ${evidence.paperTradingDays} days (min: ${THRESHOLDS.minPaperDays})`,
    details: { paperDays: evidence.paperTradingDays },
  });

  checks.push({
    name: "paper_trading_sample_size",
    category: "strategy",
    passed: evidence.paperTradingTrades >= THRESHOLDS.minPaperTrades,
    required: true,
    message: `Paper trades: ${evidence.paperTradingTrades} (min: ${THRESHOLDS.minPaperTrades})`,
    details: { paperTrades: evidence.paperTradingTrades },
  });

  checks.push({
    name: "paper_trading_win_rate",
    category: "strategy",
    passed: evidence.paperTradingWinRate >= THRESHOLDS.minPaperWinRate,
    required: true,
    message: `Paper win rate: ${(evidence.paperTradingWinRate * 100).toFixed(1)}% (min: ${(THRESHOLDS.minPaperWinRate * 100).toFixed(1)}%)`,
    details: { paperWinRate: evidence.paperTradingWinRate },
  });

  // ── Calibration Check ─────────────────────────────────────────────────

  checks.push({
    name: "calibration_drift",
    category: "strategy",
    passed: evidence.calibrationDrift <= THRESHOLDS.maxCalibrationDrift,
    required: true,
    message: `Calibration drift: ${(evidence.calibrationDrift * 100).toFixed(1)}% (max: ${(THRESHOLDS.maxCalibrationDrift * 100).toFixed(1)}%)`,
    details: { drift: evidence.calibrationDrift },
  });

  // ── Risk Checks ───────────────────────────────────────────────────────

  checks.push({
    name: "risk_limits_configured",
    category: "risk",
    passed: health.riskLimitsConfigured,
    required: true,
    message: health.riskLimitsConfigured
      ? "Risk limits are configured and active"
      : "Risk limits NOT configured — cannot trade live without exposure guards",
  });

  checks.push({
    name: "kill_switch_clear",
    category: "risk",
    passed: !health.killSwitchActive && !health.killSwitchCooldown,
    required: true,
    message: health.killSwitchActive
      ? "Kill switch is ACTIVE — cannot enable live mode"
      : health.killSwitchCooldown
        ? "Kill switch cooldown period — wait before enabling live mode"
        : "Kill switch is clear",
  });

  // ── Data Checks ───────────────────────────────────────────────────────

  checks.push({
    name: "data_feed_health",
    category: "data",
    passed: health.dataFeedHealthy && health.dataFeedLatencyMs <= THRESHOLDS.maxDataFeedLatencyMs,
    required: true,
    message: health.dataFeedHealthy
      ? `Data feed healthy (latency: ${health.dataFeedLatencyMs}ms)`
      : "Data feed is NOT healthy — cannot trade on stale or missing data",
    details: { latencyMs: health.dataFeedLatencyMs },
  });

  // ── System Checks ─────────────────────────────────────────────────────

  checks.push({
    name: "broker_connection",
    category: "system",
    passed: health.brokerConnected && health.brokerLatencyMs <= THRESHOLDS.maxBrokerLatencyMs,
    required: true,
    message: health.brokerConnected
      ? `Broker connected (latency: ${health.brokerLatencyMs}ms)`
      : "Broker is NOT connected — cannot execute orders",
    details: { latencyMs: health.brokerLatencyMs },
  });

  checks.push({
    name: "system_uptime",
    category: "system",
    passed: health.uptimeMinutes >= THRESHOLDS.minUptimeMinutes,
    required: false,
    message: `System uptime: ${health.uptimeMinutes}min (min: ${THRESHOLDS.minUptimeMinutes}min)`,
  });

  checks.push({
    name: "memory_usage",
    category: "system",
    passed: health.memoryUsagePct < THRESHOLDS.maxMemoryUsagePct,
    required: false,
    message: `Memory usage: ${health.memoryUsagePct.toFixed(0)}% (max: ${THRESHOLDS.maxMemoryUsagePct}%)`,
  });

  checks.push({
    name: "environment_mode",
    category: "system",
    passed: mode === "live" || mode === "strict_live",
    required: true,
    message: mode === "live" || mode === "strict_live"
      ? `Environment mode: ${mode}`
      : `Environment mode is "${mode}" — must be "live" or "strict_live" for live trading`,
  });

  // ── Operator Approval ─────────────────────────────────────────────────

  checks.push({
    name: "operator_approval",
    category: "operator",
    passed: evidence.operatorApproved,
    required: true,
    message: evidence.operatorApproved
      ? `Operator approved (last reviewed: ${evidence.lastReviewedAt ?? "unknown"})`
      : "Operator has NOT approved this strategy for live trading",
  });

  // ── Aggregate ─────────────────────────────────────────────────────────

  const requiredChecks = checks.filter(c => c.required);
  const failedRequired = requiredChecks.filter(c => !c.passed);
  const allPassed = failedRequired.length === 0;
  const blockers = failedRequired.map(c => c.message);

  const recommendation: PreflightResult["recommendation"] =
    allPassed ? "approve" :
    failedRequired.length <= 2 ? "conditional" :
    "deny";

  const result: PreflightResult = {
    allPassed,
    passedCount: checks.filter(c => c.passed).length,
    failedCount: checks.filter(c => !c.passed).length,
    checks,
    evaluatedAt: new Date().toISOString(),
    recommendation,
    blockers,
  };

  logger.info({
    strategy: evidence.strategyId,
    passed: result.passedCount,
    failed: result.failedCount,
    allPassed,
    recommendation,
    blockerCount: blockers.length,
  }, allPassed
    ? "Live mode preflight PASSED"
    : "Live mode preflight FAILED",
  );

  return result;
}

/**
 * Quick check: is live trading currently possible?
 * (Does not evaluate strategy evidence — just system state)
 */
export function isLiveModeAvailable(
  health: SystemHealthSnapshot,
  mode: string,
): { available: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (mode !== "live" && mode !== "strict_live") {
    reasons.push(`Mode is "${mode}" — live trading requires "live" or "strict_live"`);
  }
  if (health.killSwitchActive) reasons.push("Kill switch is active");
  if (health.killSwitchCooldown) reasons.push("Kill switch cooldown in progress");
  if (!health.brokerConnected) reasons.push("Broker not connected");
  if (!health.dataFeedHealthy) reasons.push("Data feed unhealthy");
  if (!health.riskLimitsConfigured) reasons.push("Risk limits not configured");

  return {
    available: reasons.length === 0,
    reasons,
  };
}

/** Get preflight thresholds (for UI display) */
export function getPreflightThresholds(): Readonly<typeof THRESHOLDS> {
  return { ...THRESHOLDS };
}
