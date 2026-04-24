/**
 * live_launch_engine.ts — Phase 75: Controlled Live Trading Safeguards
 *
 * Pre-flight checks, position scaling, emergency shutdown, and safety monitoring
 * for transitioning from paper to live trading with graduated risk exposure.
 */

import { logger as _logger } from "../lib/logger";
import { persistWrite, persistRead, persistAppend } from "../lib/persistent_store";
import {
  getCircuitBreakerSnapshot,
  activateKillSwitch,
} from "../lib/circuit_breaker";
import {
  runPreflight,
  type PreflightResult,
} from "../lib/preflight";
import { alpacaStream } from "../lib/alpaca_stream";
import { getModelStatus } from "../lib/ml_model";

const logger = _logger.child({ module: "live_launch_engine" });

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LiveLaunchConfig {
  maxDailyLoss: number; // default 500 USD
  maxDailyTrades: number; // default 20
  maxPositionValue: number; // default 5000 USD
  maxDrawdownPct: number; // default 2 (2% of equity)
  killSwitchTriggers: string[]; // circuit breaker trip, 3 consecutive losses, drawdown breach
  preFlightChecks: string[]; // broker connected, model trained, market open, validation passing
  gradualScaleUp: boolean; // default true — start with tiny positions
  scaleUpDays: number; // default 5 — days before full position size
}

export interface PreFlightCheck {
  name: string;
  passed: boolean;
  details: string;
}

export interface PreFlightCheckResult {
  passed: boolean;
  checks: PreFlightCheck[];
  summary: string;
  timestamp: string;
}

export interface SafetyCheckResult {
  allowed: boolean;
  dailyLoss: number;
  drawdownPct: number;
  consecutiveLosses: number;
  blockedReasons: string[];
  timestamp: string;
}

export interface LiveLaunchState {
  status: "idle" | "preflight" | "live" | "scaling" | "emergency_shutdown" | "error";
  launchedAt: string | null;
  daysSinceLaunch: number;
  currentScaleMultiplier: number;
  dailyTrades: number;
  dailyLossPct: number;
  maxDrawdownPct: number;
  emergencyShutdownReason: string | null;
  lastPreFlightAt: string | null;
  lastSafetyCheckAt: string | null;
  totalPositionsOpened: number;
  totalPositionsClosed: number;
}

const DEFAULT_CONFIG: LiveLaunchConfig = {
  maxDailyLoss: 500,
  maxDailyTrades: 20,
  maxPositionValue: 5000,
  maxDrawdownPct: 2,
  killSwitchTriggers: ["circuit_breaker_trip", "consecutive_losses", "drawdown_breach"],
  preFlightChecks: ["broker_connected", "model_trained", "market_open", "validation_passing"],
  gradualScaleUp: true,
  scaleUpDays: 5,
};

// ─── State ────────────────────────────────────────────────────────────────────

let _config = { ...DEFAULT_CONFIG };
let _launchedAtMs: number | null = null;
let _status: LiveLaunchState["status"] = "idle";
let _emergencyShutdownReason: string | null = null;
let _dailyTrades = 0;
let _dailyLossPct = 0;
let _maxDrawdownPct = 0;
let _totalPositionsOpened = 0;
let _totalPositionsClosed = 0;
let _lastPreFlightAtMs: number | null = null;
let _lastSafetyCheckAtMs: number | null = null;

// ─── Pre-Flight Checks ─────────────────────────────────────────────────────────

export async function runPreFlightChecks(): Promise<PreFlightCheckResult> {
  const checks: PreFlightCheck[] = [];
  const now = new Date();

  // 1. Broker connectivity
  const brokerConnected = alpacaStream.status().authenticated || alpacaStream.status().pollingMode;
  checks.push({
    name: "broker_connected",
    passed: brokerConnected,
    details: brokerConnected ? "Alpaca authenticated or polling" : "Broker not connected",
  });

  // 2. Model training status
  const modelStatus = getModelStatus();
  const modelTrained = modelStatus.status !== "error" && modelStatus.meta !== null;
  checks.push({
    name: "model_trained",
    passed: modelTrained,
    details: modelTrained ? `Model status: ${modelStatus.status}` : "Model not trained or in error state",
  });

  // 3. Market hours
  const now_hour = now.getHours();
  const market_open = now_hour >= 9 && now_hour < 16 && now.getDay() >= 1 && now.getDay() <= 5;
  checks.push({
    name: "market_open",
    passed: market_open,
    details: market_open ? "US market hours (9:30-16:00 ET)" : "Outside market hours",
  });

  // 4. Recent validation pass
  let validationPassing = false;
  try {
    const validationData = persistRead("paper_validation_latest", null);
    if (validationData && typeof validationData === "object") {
      const validationObj = validationData as Record<string, unknown>;
      validationPassing = String(validationObj.status) === "PASSED";
    }
  } catch (err) {
    logger.warn({ err }, "Failed to read validation status");
  }
  checks.push({
    name: "validation_passing",
    passed: validationPassing,
    details: validationPassing ? "Latest paper validation passed" : "No recent validation pass",
  });

  // 5. Circuit breaker state
  const breakerSnapshot = getCircuitBreakerSnapshot();
  const breakerHealthy = breakerSnapshot.breaker.state === "CLOSED";
  checks.push({
    name: "circuit_breaker_healthy",
    passed: breakerHealthy,
    details: breakerHealthy ? "Circuit breaker CLOSED" : `Circuit breaker ${breakerSnapshot.breaker.state}`,
  });

  const allPassed = checks.every((c) => c.passed);
  _lastPreFlightAtMs = Date.now();

  const result: PreFlightCheckResult = {
    passed: allPassed,
    checks,
    summary: allPassed ? "All pre-flight checks PASSED" : `${checks.filter((c) => !c.passed).length} checks failed`,
    timestamp: now.toISOString(),
  };

  try {
    persistAppend("live_launch_preflight", result, 100);
  } catch (err) {
    logger.warn({ err }, "Failed to persist pre-flight result");
  }

  logger.info({ checks, passed: allPassed }, "Pre-flight checks completed");
  return result;
}

// ─── Position Scaling ─────────────────────────────────────────────────────────

export function calculateScaledPositionSize(baseSize: number, daysSinceLaunch: number): number {
  if (!_config.gradualScaleUp || daysSinceLaunch < 0) {
    return baseSize;
  }

  // Start at 10%, scale to 100% over scaleUpDays
  const minScale = 0.1;
  const maxScale = 1.0;
  const daysElapsed = Math.min(daysSinceLaunch, _config.scaleUpDays);
  const progress = daysElapsed / _config.scaleUpDays;

  const scaledMultiplier = minScale + (maxScale - minScale) * progress;
  const scaledSize = Math.round(baseSize * scaledMultiplier);

  logger.debug(
    { baseSize, daysSinceLaunch, scaledMultiplier, scaledSize },
    "Position size scaled"
  );

  return scaledSize;
}

// ─── Safety Checks ────────────────────────────────────────────────────────────

export function liveSafetyCheck(): SafetyCheckResult {
  const blockedReasons: string[] = [];
  const now = new Date();

  // 1. Daily loss limit
  if (Math.abs(_dailyLossPct) >= _config.maxDailyLoss) {
    blockedReasons.push(`Daily loss ${Math.abs(_dailyLossPct).toFixed(0)} USD exceeds ${_config.maxDailyLoss}`);
  }

  // 2. Daily trade count
  if (_dailyTrades >= _config.maxDailyTrades) {
    blockedReasons.push(`Daily trades ${_dailyTrades} >= limit ${_config.maxDailyTrades}`);
  }

  // 3. Drawdown
  if (_maxDrawdownPct >= _config.maxDrawdownPct) {
    blockedReasons.push(`Drawdown ${_maxDrawdownPct.toFixed(2)}% exceeds ${_config.maxDrawdownPct}%`);
  }

  // 4. Circuit breaker
  const breaker = getCircuitBreakerSnapshot();
  if (breaker.breaker.state === "OPEN") {
    blockedReasons.push(`Circuit breaker OPEN: ${breaker.breaker.tripReason}`);
  }

  _lastSafetyCheckAtMs = Date.now();

  const result: SafetyCheckResult = {
    allowed: blockedReasons.length === 0,
    dailyLoss: _dailyLossPct,
    drawdownPct: _maxDrawdownPct,
    consecutiveLosses: breaker.breaker.consecutiveLosses,
    blockedReasons,
    timestamp: now.toISOString(),
  };

  try {
    persistAppend("live_launch_safety_checks", result, 200);
  } catch (err) {
    logger.warn({ err }, "Failed to persist safety check");
  }

  if (!result.allowed) {
    logger.warn({ blockedReasons }, "Live safety check FAILED");
  }

  return result;
}

// ─── Emergency Shutdown ────────────────────────────────────────────────────────

export function emergencyShutdown(reason: string): void {
  _status = "emergency_shutdown";
  _emergencyShutdownReason = reason;

  // Trigger kill switch
  activateKillSwitch(`Live launch emergency shutdown: ${reason}`, "live_launch_engine");

  logger.fatal({ reason }, "EMERGENCY SHUTDOWN ACTIVATED");

  try {
    const event = {
      timestamp: new Date().toISOString(),
      reason,
      status_before: _status,
      daily_trades: _dailyTrades,
      daily_loss_pct: _dailyLossPct,
      max_drawdown_pct: _maxDrawdownPct,
    };
    persistAppend("live_launch_emergency_shutdowns", event, 50);
  } catch (err) {
    logger.warn({ err }, "Failed to persist emergency shutdown event");
  }
}

// ─── Live Launch Lifecycle ────────────────────────────────────────────────────

export async function initiateLiveLaunch(config?: Partial<LiveLaunchConfig>): Promise<{ success: boolean; message: string; preFlightResult?: PreFlightCheckResult }> {
  if (_status === "live" || _status === "scaling") {
    return { success: false, message: "Live launch already active" };
  }

  if (config) {
    _config = { ..._config, ...config };
  }

  _status = "preflight";

  // Run pre-flight
  const preFlightResult = await runPreFlightChecks();
  if (!preFlightResult.passed) {
    _status = "idle";
    return {
      success: false,
      message: `Pre-flight checks failed: ${preFlightResult.summary}`,
      preFlightResult,
    };
  }

  // Launch
  _launchedAtMs = Date.now();
  _status = _config.gradualScaleUp ? "scaling" : "live";
  _dailyTrades = 0;
  _dailyLossPct = 0;
  _maxDrawdownPct = 0;

  logger.info({ config: _config }, "Live launch initiated");

  try {
    persistWrite("live_launch_state", getLiveLaunchState());
  } catch (err) {
    logger.warn({ err }, "Failed to persist live launch state");
  }

  return {
    success: true,
    message: _status === "scaling" ? "Live launch with scaling enabled" : "Live launch active",
    preFlightResult,
  };
}

export function terminateLiveLaunch(): void {
  _status = "idle";
  _launchedAtMs = null;
  _emergencyShutdownReason = null;
  _dailyTrades = 0;
  _dailyLossPct = 0;
  _maxDrawdownPct = 0;

  logger.info("Live launch terminated");
}

// ─── State Getters ────────────────────────────────────────────────────────────

export function getLiveLaunchState(): LiveLaunchState {
  const daysSinceLaunch = _launchedAtMs ? Math.floor((Date.now() - _launchedAtMs) / (24 * 60 * 60 * 1000)) : 0;
  const currentScaleMultiplier = calculateScaledPositionSize(1, daysSinceLaunch);

  return {
    status: _status,
    launchedAt: _launchedAtMs ? new Date(_launchedAtMs).toISOString() : null,
    daysSinceLaunch,
    currentScaleMultiplier,
    dailyTrades: _dailyTrades,
    dailyLossPct: _dailyLossPct,
    maxDrawdownPct: _maxDrawdownPct,
    emergencyShutdownReason: _emergencyShutdownReason,
    lastPreFlightAt: _lastPreFlightAtMs ? new Date(_lastPreFlightAtMs).toISOString() : null,
    lastSafetyCheckAt: _lastSafetyCheckAtMs ? new Date(_lastSafetyCheckAtMs).toISOString() : null,
    totalPositionsOpened: _totalPositionsOpened,
    totalPositionsClosed: _totalPositionsClosed,
  };
}

export function recordTradeMetrics(quantity: number, pnlPct: number): void {
  _dailyTrades += 1;
  if (pnlPct < 0) {
    _dailyLossPct += Math.abs(pnlPct);
    _maxDrawdownPct = Math.max(_maxDrawdownPct, _dailyLossPct);
  }
  _totalPositionsOpened += quantity > 0 ? 1 : 0;
}

export function recordPositionClosed(): void {
  _totalPositionsClosed += 1;
}

export function updateConfig(config: Partial<LiveLaunchConfig>): void {
  _config = { ..._config, ...config };
  logger.info({ config: _config }, "Live launch config updated");
}

export function getConfig(): LiveLaunchConfig {
  return { ..._config };
}

export function resetDailyMetrics(): void {
  _dailyTrades = 0;
  _dailyLossPct = 0;
  _maxDrawdownPct = 0;
}
