import { checkDbHealth } from "@workspace/db";
import { existsSync } from "node:fs";
import path from "node:path";
import { getBreakerSnapshot } from "./drawdown_breaker";
import { logger } from "./logger";
import { runPreflight, type PreflightResult } from "./preflight";
import { getLatestPortfolioRiskSnapshot } from "./portfolio_risk_guard";
import { getRiskEngineSnapshot, isKillSwitchActive } from "./risk_engine";
import { runtimeConfig } from "./runtime_config";
import { getStartupSnapshot } from "./startup_state";
import { getAutonomySupervisorSnapshot, shouldAutonomySupervisorAutoStart } from "./autonomy_supervisor";
import { getStrategyGovernorSnapshot } from "./strategy_governor";
import { getStrategyAllocatorSnapshot } from "./strategy_allocator";
import { getStrategyEvolutionSnapshot } from "./strategy_evolution_scheduler";
import { getProductionWatchdogSnapshot, shouldProductionWatchdogAutoStart } from "./production_watchdog";
import {
  getExecutionSafetySupervisorSnapshot,
  shouldExecutionSafetySupervisorAutoStart,
} from "./execution_safety_supervisor";
import { getExecutionIncidentSnapshot } from "./execution_incident_guard";
import { getExecutionMarketGuardSnapshot } from "./execution_market_guard";
import { getExecutionAutonomyGuardSnapshot } from "./execution_autonomy_guard";
import { getExecutionIdempotencySnapshot } from "./execution_idempotency";
import {
  getAutonomyDebugSchedulerSnapshot,
  shouldAutonomyDebugSchedulerAutoStart,
} from "./autonomy_debug_scheduler";

export type DeploymentReadinessStatus = "READY" | "DEGRADED" | "NOT_READY";

type CheckCategory = "build" | "env" | "runtime" | "startup" | "dependency";

export interface DeploymentReadinessCheck {
  name: string;
  category: CheckCategory;
  passed: boolean;
  critical: boolean;
  detail: string;
  duration_ms: number;
}

export interface DeploymentReadinessReport {
  generated_at: string;
  status: DeploymentReadinessStatus;
  summary: {
    total: number;
    passed: number;
    failed_critical: number;
    failed_non_critical: number;
  };
  checks: DeploymentReadinessCheck[];
  startup: ReturnType<typeof getStartupSnapshot>;
  risk: {
    kill_switch_active: boolean;
    breaker_level: string;
    breaker_position_multiplier: number;
    portfolio_risk_state: string | null;
    incident_guard_level: string;
    incident_guard_halt: boolean;
    autonomy_guard_level: string;
    autonomy_guard_halt: boolean;
    market_guard_level: string;
    market_guard_halt: boolean;
    idempotency_entries: number;
    idempotency_require_key_live: boolean;
  };
  preflight: {
    included: boolean;
    passed: boolean | null;
    duration_ms: number | null;
    failed_critical_checks: string[];
  };
  autonomy: {
    supervisor_running: boolean;
    expected_services: number;
    healthy_services: number;
    total_heal_actions: number;
    strategy_governor_running: boolean;
    strategy_governor_last_error: string | null;
    strategy_allocator_running: boolean;
    strategy_allocator_last_error: string | null;
    strategy_evolution_running: boolean;
    strategy_evolution_last_error: string | null;
    production_watchdog_running: boolean;
    production_watchdog_last_error: string | null;
    execution_safety_supervisor_running: boolean;
    execution_safety_supervisor_last_error: string | null;
    autonomy_supervisor_heartbeat_fresh: boolean;
    production_watchdog_heartbeat_fresh: boolean;
    execution_safety_supervisor_heartbeat_fresh: boolean;
    autonomy_debug_scheduler_expected: boolean;
    autonomy_debug_scheduler_running: boolean;
    autonomy_debug_scheduler_last_error: string | null;
    autonomy_debug_scheduler_last_status: string | null;
    autonomy_debug_scheduler_heartbeat_fresh: boolean;
  };
  config: {
    system_mode: string;
    node_env: string;
    has_alpaca_keys: boolean;
    has_operator_token: boolean;
    has_anthropic_key: boolean;
  };
}

const CACHE_TTL_MS = 30_000;
let _cached: { report: DeploymentReadinessReport; ts: number; includePreflight: boolean } | null = null;

function boolFromQuery(value: unknown): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function boolFromEnv(name: string, fallback: boolean): boolean {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function intFromEnv(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(process.env[name] ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function nowMs(): number {
  return Date.now();
}

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function serviceHeartbeatFresh(input: {
  expected: boolean;
  running: boolean;
  startedAt: string | null;
  lastCycleAt: string | null;
  totalCycles: number;
  thresholdMs: number;
}): { passed: boolean; detail: string } {
  if (!input.expected) return { passed: true, detail: "expected=false" };
  if (!input.running) return { passed: true, detail: "running=false (covered by running gate)" };

  const safeThresholdMs = Math.max(10_000, input.thresholdMs);
  const lastCycleMs = parseIsoMs(input.lastCycleAt);
  if (lastCycleMs !== null) {
    const ageMs = Math.max(0, nowMs() - lastCycleMs);
    return {
      passed: ageMs <= safeThresholdMs,
      detail: `age_ms=${ageMs},threshold_ms=${safeThresholdMs}`,
    };
  }

  const startedMs = parseIsoMs(input.startedAt);
  if (input.totalCycles > 0) {
    return {
      passed: false,
      detail: `missing_last_cycle_at_with_total_cycles=${input.totalCycles}`,
    };
  }

  if (startedMs !== null) {
    const warmupAgeMs = Math.max(0, nowMs() - startedMs);
    return {
      passed: warmupAgeMs <= safeThresholdMs,
      detail: `warmup_age_ms=${warmupAgeMs},threshold_ms=${safeThresholdMs}`,
    };
  }

  return {
    passed: false,
    detail: "missing_cycle_timestamps",
  };
}

function timedCheck(
  checks: DeploymentReadinessCheck[],
  input: Omit<DeploymentReadinessCheck, "duration_ms">,
  startedAt: number,
): void {
  checks.push({ ...input, duration_ms: Math.max(0, nowMs() - startedAt) });
}

function readinessStatusFromChecks(checks: DeploymentReadinessCheck[]): DeploymentReadinessStatus {
  const criticalFailed = checks.some((c) => c.critical && !c.passed);
  if (criticalFailed) return "NOT_READY";
  const warningFailed = checks.some((c) => !c.critical && !c.passed);
  return warningFailed ? "DEGRADED" : "READY";
}

function summarize(checks: DeploymentReadinessCheck[]): DeploymentReadinessReport["summary"] {
  let passed = 0;
  let failedCritical = 0;
  let failedNonCritical = 0;
  for (const check of checks) {
    if (check.passed) passed += 1;
    else if (check.critical) failedCritical += 1;
    else failedNonCritical += 1;
  }
  return {
    total: checks.length,
    passed,
    failed_critical: failedCritical,
    failed_non_critical: failedNonCritical,
  };
}

function isKillSwitchCriticalGate(): boolean {
  return boolFromEnv("DEPLOYMENT_READINESS_KILL_SWITCH_CRITICAL", true);
}

function buildArtifactChecks(checks: DeploymentReadinessCheck[]): void {
  const root = process.cwd();
  const files: Array<{ rel: string; critical: boolean; label: string }> = [
    { rel: "artifacts/api-server/dist/index.mjs", critical: true, label: "API build bundle" },
    { rel: "artifacts/godsview-dashboard/dist/public/index.html", critical: true, label: "Dashboard build output" },
    { rel: "Dockerfile", critical: false, label: "Dockerfile" },
    { rel: "docker-entrypoint.sh", critical: false, label: "Docker entrypoint" },
  ];

  for (const file of files) {
    const startedAt = nowMs();
    const abs = path.resolve(root, file.rel);
    const exists = existsSync(abs);
    timedCheck(
      checks,
      {
        name: `${file.label} exists`,
        category: "build",
        passed: exists,
        critical: file.critical,
        detail: exists ? file.rel : `Missing: ${file.rel}`,
      },
      startedAt,
    );
  }
}

function envChecks(checks: DeploymentReadinessCheck[]): void {
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);

  {
    const startedAt = nowMs();
    timedCheck(
      checks,
      {
        name: "Node version >= 20",
        category: "env",
        passed: Number.isFinite(nodeMajor) && nodeMajor >= 20,
        critical: true,
        detail: process.version,
      },
      startedAt,
    );
  }

  {
    const startedAt = nowMs();
    const supportedModes = new Set<string>([
      "demo",
      "paper",
      "live_disabled",
      "live_enabled",
      // Backward-compat aliases for mixed deployments.
      "dry_run",
      "paper_enabled",
    ]);
    const supportedMode = supportedModes.has(String(runtimeConfig.systemMode));
    timedCheck(
      checks,
      {
        name: "System mode supported",
        category: "env",
        passed: supportedMode,
        critical: true,
        detail: runtimeConfig.systemMode,
      },
      startedAt,
    );
  }

  if (runtimeConfig.systemMode === "live_enabled") {
    const startedToken = nowMs();
    timedCheck(
      checks,
      {
        name: "Operator token configured for live mode",
        category: "env",
        passed: runtimeConfig.hasOperatorToken,
        critical: true,
        detail: runtimeConfig.hasOperatorToken ? "Configured" : "Missing GODSVIEW_OPERATOR_TOKEN",
      },
      startedToken,
    );

    const startedAlpaca = nowMs();
    timedCheck(
      checks,
      {
        name: "Alpaca keys configured for live mode",
        category: "env",
        passed: runtimeConfig.hasAlpacaKeys,
        critical: true,
        detail: runtimeConfig.hasAlpacaKeys ? "Configured" : "Missing ALPACA_API_KEY/ALPACA_SECRET_KEY",
      },
      startedAlpaca,
    );
  }
}

async function dependencyChecks(checks: DeploymentReadinessCheck[]): Promise<void> {
  const startedDb = nowMs();
  try {
    const db = await checkDbHealth();
    timedCheck(
      checks,
      {
        name: "Database connectivity",
        category: "dependency",
        passed: db.ok,
        critical: true,
        detail: db.ok
          ? `driver=${db.driver}, latency=${db.latencyMs}ms`
          : (db.error ?? "database check failed"),
      },
      startedDb,
    );
  } catch (err) {
    timedCheck(
      checks,
      {
        name: "Database connectivity",
        category: "dependency",
        passed: false,
        critical: true,
        detail: err instanceof Error ? err.message : String(err),
      },
      startedDb,
    );
  }
}

function runtimeChecks(checks: DeploymentReadinessCheck[]): {
  killSwitch: boolean;
  breakerLevel: string;
  breakerMultiplier: number;
  portfolioRiskState: string | null;
  supervisorRunning: boolean;
  expectedServices: number;
  healthyServices: number;
  totalHealActions: number;
  strategyGovernorRunning: boolean;
  strategyGovernorLastError: string | null;
  strategyAllocatorRunning: boolean;
  strategyAllocatorLastError: string | null;
  strategyEvolutionRunning: boolean;
  strategyEvolutionLastError: string | null;
  productionWatchdogRunning: boolean;
  productionWatchdogLastError: string | null;
  executionSafetySupervisorRunning: boolean;
  executionSafetySupervisorLastError: string | null;
  autonomySupervisorHeartbeatFresh: boolean;
  productionWatchdogHeartbeatFresh: boolean;
  executionSafetySupervisorHeartbeatFresh: boolean;
  autonomyDebugSchedulerExpected: boolean;
  autonomyDebugSchedulerRunning: boolean;
  autonomyDebugSchedulerLastError: string | null;
  autonomyDebugSchedulerLastStatus: string | null;
  autonomyDebugSchedulerHeartbeatFresh: boolean;
  incidentGuardLevel: string;
  incidentGuardHalt: boolean;
  autonomyGuardLevel: string;
  autonomyGuardHalt: boolean;
  marketGuardLevel: string;
  marketGuardHalt: boolean;
  idempotencyEntries: number;
  idempotencyRequireKeyLive: boolean;
} {
  const startedKillSwitch = nowMs();
  const killSwitch = isKillSwitchActive();
  const killSwitchCritical = isKillSwitchCriticalGate();
  timedCheck(
    checks,
    {
      name: "Kill switch is inactive",
      category: "runtime",
      passed: !killSwitch,
      critical: killSwitchCritical,
      detail: killSwitch ? `Kill switch active (critical_gate=${killSwitchCritical})` : "Inactive",
    },
    startedKillSwitch,
  );

  const startedBreaker = nowMs();
  const breaker = getBreakerSnapshot();
  const breakerHealthy = breaker.level !== "HALT";
  timedCheck(
    checks,
    {
      name: "Drawdown breaker not halted",
      category: "runtime",
      passed: breakerHealthy,
      critical: true,
      detail: `level=${breaker.level}, multiplier=${breaker.position_size_multiplier}`,
    },
    startedBreaker,
  );

  const startedRiskConfig = nowMs();
  const riskConfig = getRiskEngineSnapshot().config;
  const limitsValid = riskConfig.maxRiskPerTradePct > 0 && riskConfig.maxRiskPerTradePct <= 1;
  timedCheck(
    checks,
    {
      name: "Risk config sane",
      category: "runtime",
      passed: limitsValid,
      critical: true,
      detail: `maxRiskPerTradePct=${riskConfig.maxRiskPerTradePct}`,
    },
    startedRiskConfig,
  );

  const portfolioRisk = getLatestPortfolioRiskSnapshot();
  const startedPortfolio = nowMs();
  timedCheck(
    checks,
    {
      name: "Portfolio risk snapshot available",
      category: "runtime",
      passed: Boolean(portfolioRisk),
      critical: false,
      detail: portfolioRisk
        ? `state=${portfolioRisk.risk_state}, var_pct=${portfolioRisk.one_day_var_pct}`
        : "No cached risk snapshot yet",
    },
    startedPortfolio,
  );

  const incidentGuard = getExecutionIncidentSnapshot();
  const startedIncidentGuard = nowMs();
  timedCheck(
    checks,
    {
      name: "Execution incident guard not halted",
      category: "runtime",
      passed: !incidentGuard.halt_active,
      critical: true,
      detail: `level=${incidentGuard.level}, failures=${incidentGuard.window_failures}, rejections=${incidentGuard.window_rejections}`,
    },
    startedIncidentGuard,
  );

  const marketGuard = getExecutionMarketGuardSnapshot();
  const autonomyGuard = getExecutionAutonomyGuardSnapshot();
  const startedAutonomyGuard = nowMs();
  timedCheck(
    checks,
    {
      name: "Execution autonomy guard not halted",
      category: "runtime",
      passed: !autonomyGuard.halt_active,
      critical: true,
      detail: `level=${autonomyGuard.level}, blocks=${autonomyGuard.window_blocks}, warns=${autonomyGuard.window_warn}`,
    },
    startedAutonomyGuard,
  );

  const startedMarketGuard = nowMs();
  timedCheck(
    checks,
    {
      name: "Execution market guard not halted",
      category: "runtime",
      passed: !marketGuard.halt_active,
      critical: true,
      detail: `level=${marketGuard.level}, critical=${marketGuard.window_critical}, warnings=${marketGuard.window_warn}`,
    },
    startedMarketGuard,
  );

  const idempotency = getExecutionIdempotencySnapshot();
  const startedIdempotency = nowMs();
  timedCheck(
    checks,
    {
      name: "Execution idempotency guard active",
      category: "runtime",
      passed: idempotency.entries >= 0,
      critical: false,
      detail: `entries=${idempotency.entries}, require_live_key=${idempotency.policy.require_key_in_live_mode}`,
    },
    startedIdempotency,
  );

  const supervisor = getAutonomySupervisorSnapshot();
  const supervisorExpected = shouldAutonomySupervisorAutoStart();
  const expectedServices = supervisor.services.filter((svc) => svc.expected).length;
  const healthyServices = supervisor.services.filter((svc) => svc.expected && svc.health === "HEALTHY").length;
  const healthRatio = expectedServices > 0 ? healthyServices / expectedServices : 1;
  const supervisorHeartbeatThresholdMs = intFromEnv(
    "DEPLOYMENT_READINESS_STALE_AUTONOMY_SUPERVISOR_MS",
    5 * 60_000,
    10_000,
    60 * 60_000,
  );
  const supervisorHeartbeat = serviceHeartbeatFresh({
    expected: supervisorExpected,
    running: supervisor.running,
    startedAt: supervisor.started_at,
    lastCycleAt: supervisor.last_tick_at,
    totalCycles: supervisor.total_ticks,
    thresholdMs: supervisorHeartbeatThresholdMs,
  });
  const supervisorHeartbeatCritical = supervisorExpected && runtimeConfig.systemMode === "live_enabled";

  const startedSupervisor = nowMs();
  timedCheck(
    checks,
    {
      name: "Autonomy supervisor running",
      category: "runtime",
      passed: supervisor.running,
      critical: false,
      detail: `running=${supervisor.running}, ticks=${supervisor.total_ticks}`,
    },
    startedSupervisor,
  );

  const startedSupervisorHealth = nowMs();
  timedCheck(
    checks,
    {
      name: "Autonomy service health ratio",
      category: "runtime",
      passed: healthRatio >= 0.6,
      critical: false,
      detail: `${healthyServices}/${expectedServices} healthy (${Math.round(healthRatio * 100)}%)`,
    },
    startedSupervisorHealth,
  );

  const startedSupervisorHeartbeat = nowMs();
  timedCheck(
    checks,
    {
      name: "Autonomy supervisor heartbeat fresh",
      category: "runtime",
      passed: supervisorHeartbeat.passed,
      critical: supervisorHeartbeatCritical,
      detail:
        `expected=${supervisorExpected},running=${supervisor.running},` +
        supervisorHeartbeat.detail,
    },
    startedSupervisorHeartbeat,
  );

  const governor = getStrategyGovernorSnapshot();
  const startedGovernor = nowMs();
  timedCheck(
    checks,
    {
      name: "Strategy governor running",
      category: "runtime",
      passed: governor.running,
      critical: false,
      detail: `running=${governor.running}, cycles=${governor.total_cycles}, last_error=${governor.last_error ?? "none"}`,
    },
    startedGovernor,
  );

  const allocator = getStrategyAllocatorSnapshot();
  const startedAllocator = nowMs();
  timedCheck(
    checks,
    {
      name: "Strategy allocator running",
      category: "runtime",
      passed: allocator.running,
      critical: false,
      detail: `running=${allocator.running}, cycles=${allocator.total_cycles}, allocations=${allocator.allocation_count}`,
    },
    startedAllocator,
  );

  const evolution = getStrategyEvolutionSnapshot();
  const startedEvolution = nowMs();
  timedCheck(
    checks,
    {
      name: "Strategy evolution scheduler running",
      category: "runtime",
      passed: evolution.running,
      critical: false,
      detail: `running=${evolution.running}, cycles=${evolution.total_cycles}, last_error=${evolution.last_error ?? "none"}`,
    },
    startedEvolution,
  );

  const watchdog = getProductionWatchdogSnapshot();
  const watchdogExpected = shouldProductionWatchdogAutoStart();
  const watchdogHeartbeatThresholdMs = intFromEnv(
    "DEPLOYMENT_READINESS_STALE_PRODUCTION_WATCHDOG_MS",
    3 * 60_000,
    10_000,
    60 * 60_000,
  );
  const watchdogHeartbeat = serviceHeartbeatFresh({
    expected: watchdogExpected,
    running: watchdog.running,
    startedAt: watchdog.started_at,
    lastCycleAt: watchdog.last_cycle_at,
    totalCycles: watchdog.total_cycles,
    thresholdMs: watchdogHeartbeatThresholdMs,
  });
  const watchdogHeartbeatCritical = watchdogExpected && runtimeConfig.systemMode === "live_enabled";
  const startedWatchdog = nowMs();
  timedCheck(
    checks,
    {
      name: "Production watchdog running",
      category: "runtime",
      passed: watchdog.running,
      critical: false,
      detail: `running=${watchdog.running}, status=${watchdog.last_status ?? "UNKNOWN"}, last_error=${watchdog.last_error ?? "none"}`,
    },
    startedWatchdog,
  );

  const startedWatchdogHeartbeat = nowMs();
  timedCheck(
    checks,
    {
      name: "Production watchdog heartbeat fresh",
      category: "runtime",
      passed: watchdogHeartbeat.passed,
      critical: watchdogHeartbeatCritical,
      detail: `expected=${watchdogExpected},running=${watchdog.running},` + watchdogHeartbeat.detail,
    },
    startedWatchdogHeartbeat,
  );

  const executionSafety = getExecutionSafetySupervisorSnapshot();
  const executionSafetyExpected = shouldExecutionSafetySupervisorAutoStart();
  const executionSafetyHeartbeatThresholdMs = intFromEnv(
    "DEPLOYMENT_READINESS_STALE_EXECUTION_SAFETY_MS",
    3 * 60_000,
    10_000,
    60 * 60_000,
  );
  const executionSafetyHeartbeat = serviceHeartbeatFresh({
    expected: executionSafetyExpected,
    running: executionSafety.running,
    startedAt: executionSafety.started_at,
    lastCycleAt: executionSafety.last_cycle_at,
    totalCycles: executionSafety.total_cycles,
    thresholdMs: executionSafetyHeartbeatThresholdMs,
  });
  const executionSafetyHeartbeatCritical = executionSafetyExpected && runtimeConfig.systemMode === "live_enabled";
  const startedExecutionSafety = nowMs();
  timedCheck(
    checks,
    {
      name: "Execution safety supervisor running",
      category: "runtime",
      passed: executionSafety.running,
      critical: true,
      detail:
        `running=${executionSafety.running},blocked=${executionSafety.consecutive_blocked}` +
        `,warn=${executionSafety.consecutive_warn},last_error=${executionSafety.last_error ?? "none"}`,
    },
    startedExecutionSafety,
  );

  const startedExecutionSafetyHeartbeat = nowMs();
  timedCheck(
    checks,
    {
      name: "Execution safety supervisor heartbeat fresh",
      category: "runtime",
      passed: executionSafetyHeartbeat.passed,
      critical: executionSafetyHeartbeatCritical,
      detail:
        `expected=${executionSafetyExpected},running=${executionSafety.running},` +
        executionSafetyHeartbeat.detail,
    },
    startedExecutionSafetyHeartbeat,
  );

  const debugScheduler = getAutonomyDebugSchedulerSnapshot();
  const debugSchedulerExpected = shouldAutonomyDebugSchedulerAutoStart();
  const debugSchedulerHeartbeatThresholdMs = intFromEnv(
    "DEPLOYMENT_READINESS_STALE_AUTONOMY_DEBUG_SCHEDULER_MS",
    3 * 60_000,
    10_000,
    60 * 60_000,
  );
  const debugSchedulerHeartbeat = serviceHeartbeatFresh({
    expected: debugSchedulerExpected,
    running: debugScheduler.running,
    startedAt: debugScheduler.started_at,
    lastCycleAt: debugScheduler.last_cycle_at,
    totalCycles: debugScheduler.total_cycles,
    thresholdMs: debugSchedulerHeartbeatThresholdMs,
  });
  const debugSchedulerCritical = debugSchedulerExpected && runtimeConfig.systemMode === "live_enabled";
  const startedDebugScheduler = nowMs();
  timedCheck(
    checks,
    {
      name: "Autonomy debug scheduler running",
      category: "runtime",
      passed: !debugSchedulerExpected || debugScheduler.running,
      critical: debugSchedulerCritical,
      detail:
        `expected=${debugSchedulerExpected},running=${debugScheduler.running}` +
        `,status=${debugScheduler.last_status ?? "UNKNOWN"},last_error=${debugScheduler.last_error ?? "none"}`,
    },
    startedDebugScheduler,
  );

  const startedDebugSchedulerHeartbeat = nowMs();
  timedCheck(
    checks,
    {
      name: "Autonomy debug scheduler heartbeat fresh",
      category: "runtime",
      passed: debugSchedulerHeartbeat.passed,
      critical: debugSchedulerCritical,
      detail:
        `expected=${debugSchedulerExpected},running=${debugScheduler.running},` +
        debugSchedulerHeartbeat.detail,
    },
    startedDebugSchedulerHeartbeat,
  );

  return {
    killSwitch,
    breakerLevel: breaker.level,
    breakerMultiplier: breaker.position_size_multiplier,
    portfolioRiskState: portfolioRisk?.risk_state ?? null,
    supervisorRunning: supervisor.running,
    expectedServices,
    healthyServices,
    totalHealActions: supervisor.total_heal_actions,
    strategyGovernorRunning: governor.running,
    strategyGovernorLastError: governor.last_error,
    strategyAllocatorRunning: allocator.running,
    strategyAllocatorLastError: allocator.last_error,
    strategyEvolutionRunning: evolution.running,
    strategyEvolutionLastError: evolution.last_error,
    productionWatchdogRunning: watchdog.running,
    productionWatchdogLastError: watchdog.last_error,
    executionSafetySupervisorRunning: executionSafety.running,
    executionSafetySupervisorLastError: executionSafety.last_error,
    autonomySupervisorHeartbeatFresh: supervisorHeartbeat.passed,
    productionWatchdogHeartbeatFresh: watchdogHeartbeat.passed,
    executionSafetySupervisorHeartbeatFresh: executionSafetyHeartbeat.passed,
    autonomyDebugSchedulerExpected: debugSchedulerExpected,
    autonomyDebugSchedulerRunning: debugScheduler.running,
    autonomyDebugSchedulerLastError: debugScheduler.last_error,
    autonomyDebugSchedulerLastStatus: debugScheduler.last_status,
    autonomyDebugSchedulerHeartbeatFresh: debugSchedulerHeartbeat.passed,
    incidentGuardLevel: incidentGuard.level,
    incidentGuardHalt: incidentGuard.halt_active,
    autonomyGuardLevel: autonomyGuard.level,
    autonomyGuardHalt: autonomyGuard.halt_active,
    marketGuardLevel: marketGuard.level,
    marketGuardHalt: marketGuard.halt_active,
    idempotencyEntries: idempotency.entries,
    idempotencyRequireKeyLive: idempotency.policy.require_key_in_live_mode,
  };
}

function pushStartupChecks(checks: DeploymentReadinessCheck[], startup = getStartupSnapshot()): void {
  const startedAt = nowMs();
  const mlState = startup.mlBootstrap.state;
  const mlHealthy = mlState !== "failed";
  timedCheck(
    checks,
    {
      name: "ML bootstrap state",
      category: "startup",
      passed: mlHealthy,
      critical: true,
      detail: mlHealthy ? `state=${mlState}` : `state=${mlState}, error=${startup.mlBootstrap.error ?? "unknown"}`,
    },
    startedAt,
  );
}

function preflightFailureSummary(result: PreflightResult | null): string[] {
  if (!result) return [];
  return result.checks.filter((c) => c.critical && !c.passed).map((c) => c.name);
}

export async function getDeploymentReadinessReport(options?: {
  forceRefresh?: boolean;
  includePreflight?: boolean;
}): Promise<DeploymentReadinessReport> {
  const includePreflight = Boolean(options?.includePreflight);
  if (
    !options?.forceRefresh &&
    _cached &&
    _cached.includePreflight === includePreflight &&
    nowMs() - _cached.ts < CACHE_TTL_MS
  ) {
    return _cached.report;
  }

  const checks: DeploymentReadinessCheck[] = [];
  buildArtifactChecks(checks);
  envChecks(checks);
  await dependencyChecks(checks);
  const startup = getStartupSnapshot();
  pushStartupChecks(checks, startup);
  const runtime = runtimeChecks(checks);

  let preflight: PreflightResult | null = null;
  if (includePreflight) {
    const startedAt = nowMs();
    try {
      preflight = await runPreflight();
      timedCheck(
        checks,
        {
          name: "Preflight critical checks",
          category: "startup",
          passed: preflight.passed,
          critical: true,
          detail: preflight.passed
            ? `passed in ${preflight.duration_ms}ms`
            : `failed critical checks: ${preflightFailureSummary(preflight).join(", ") || "unknown"}`,
        },
        startedAt,
      );
    } catch (err) {
      timedCheck(
        checks,
        {
          name: "Preflight critical checks",
          category: "startup",
          passed: false,
          critical: true,
          detail: err instanceof Error ? err.message : String(err),
        },
        startedAt,
      );
    }
  }

  const report: DeploymentReadinessReport = {
    generated_at: new Date().toISOString(),
    status: readinessStatusFromChecks(checks),
    summary: summarize(checks),
    checks,
    startup,
    risk: {
      kill_switch_active: runtime.killSwitch,
      breaker_level: runtime.breakerLevel,
      breaker_position_multiplier: runtime.breakerMultiplier,
      portfolio_risk_state: runtime.portfolioRiskState,
      incident_guard_level: runtime.incidentGuardLevel,
      incident_guard_halt: runtime.incidentGuardHalt,
      autonomy_guard_level: runtime.autonomyGuardLevel,
      autonomy_guard_halt: runtime.autonomyGuardHalt,
      market_guard_level: runtime.marketGuardLevel,
      market_guard_halt: runtime.marketGuardHalt,
      idempotency_entries: runtime.idempotencyEntries,
      idempotency_require_key_live: runtime.idempotencyRequireKeyLive,
    },
    preflight: {
      included: includePreflight,
      passed: preflight?.passed ?? null,
      duration_ms: preflight?.duration_ms ?? null,
      failed_critical_checks: preflightFailureSummary(preflight),
    },
    autonomy: {
      supervisor_running: runtime.supervisorRunning,
      expected_services: runtime.expectedServices,
      healthy_services: runtime.healthyServices,
      total_heal_actions: runtime.totalHealActions,
      strategy_governor_running: runtime.strategyGovernorRunning,
      strategy_governor_last_error: runtime.strategyGovernorLastError,
      strategy_allocator_running: runtime.strategyAllocatorRunning,
      strategy_allocator_last_error: runtime.strategyAllocatorLastError,
      strategy_evolution_running: runtime.strategyEvolutionRunning,
      strategy_evolution_last_error: runtime.strategyEvolutionLastError,
      production_watchdog_running: runtime.productionWatchdogRunning,
      production_watchdog_last_error: runtime.productionWatchdogLastError,
      execution_safety_supervisor_running: runtime.executionSafetySupervisorRunning,
      execution_safety_supervisor_last_error: runtime.executionSafetySupervisorLastError,
      autonomy_supervisor_heartbeat_fresh: runtime.autonomySupervisorHeartbeatFresh,
      production_watchdog_heartbeat_fresh: runtime.productionWatchdogHeartbeatFresh,
      execution_safety_supervisor_heartbeat_fresh: runtime.executionSafetySupervisorHeartbeatFresh,
      autonomy_debug_scheduler_expected: runtime.autonomyDebugSchedulerExpected,
      autonomy_debug_scheduler_running: runtime.autonomyDebugSchedulerRunning,
      autonomy_debug_scheduler_last_error: runtime.autonomyDebugSchedulerLastError,
      autonomy_debug_scheduler_last_status: runtime.autonomyDebugSchedulerLastStatus,
      autonomy_debug_scheduler_heartbeat_fresh: runtime.autonomyDebugSchedulerHeartbeatFresh,
    },
    config: {
      system_mode: runtimeConfig.systemMode,
      node_env: runtimeConfig.nodeEnv,
      has_alpaca_keys: runtimeConfig.hasAlpacaKeys,
      has_operator_token: runtimeConfig.hasOperatorToken,
      has_anthropic_key: runtimeConfig.hasAnthropicKey,
    },
  };

  _cached = { report, ts: nowMs(), includePreflight };
  logger.info({ status: report.status, summary: report.summary }, "Deployment readiness evaluated");
  return report;
}

export function resetDeploymentReadinessCache(): void {
  _cached = null;
}

export function parseReadinessQuery(query: Record<string, unknown>): { forceRefresh: boolean; includePreflight: boolean } {
  return {
    forceRefresh: boolFromQuery(query.refresh) || boolFromQuery(query.force),
    includePreflight: boolFromQuery(query.include_preflight) || boolFromQuery(query.preflight),
  };
}
