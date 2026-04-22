import {
  getDeploymentReadinessReport,
  type DeploymentReadinessStatus,
} from "./deployment_readiness";
import {
  getAutonomySupervisorSnapshot,
  runAutonomySupervisorTick,
  shouldAutonomySupervisorAutoStart,
  startAutonomySupervisor,
} from "./autonomy_supervisor";
import {
  getStrategyGovernorSnapshot,
  runStrategyGovernorCycle,
  shouldStrategyGovernorAutoStart,
  startStrategyGovernor,
} from "./strategy_governor";
import {
  getStrategyAllocatorSnapshot,
  runStrategyAllocatorCycle,
  shouldStrategyAllocatorAutoStart,
  startStrategyAllocator,
} from "./strategy_allocator";
import {
  getStrategyEvolutionSnapshot,
  runStrategyEvolutionCycle,
  shouldStrategyEvolutionAutoStart,
  startStrategyEvolutionScheduler,
} from "./strategy_evolution_scheduler";
import {
  getProductionWatchdogSnapshot,
  runProductionWatchdogCycle,
  shouldProductionWatchdogAutoStart,
  startProductionWatchdog,
} from "./production_watchdog";
import {
  getExecutionSafetySupervisorSnapshot,
  runExecutionSafetySupervisorCycle,
  shouldExecutionSafetySupervisorAutoStart,
  startExecutionSafetySupervisor,
} from "./execution_safety_supervisor";
import { isKillSwitchActive } from "./risk_engine";
import { addOpsAlert } from "./ops_monitor";
import { logger } from "./logger";

export type AutonomyDebugSeverity = "warn" | "critical";
export type AutonomyDebugOverallStatus = "HEALTHY" | "DEGRADED" | "CRITICAL";
export type AutonomyDebugServiceName =
  | "autonomy_supervisor"
  | "strategy_governor"
  | "strategy_allocator"
  | "strategy_evolution"
  | "production_watchdog"
  | "execution_safety_supervisor";

export interface AutonomyDebugServiceState {
  name: AutonomyDebugServiceName;
  expected: boolean;
  running: boolean;
  last_error: string | null;
  last_cycle_at: string | null;
  detail: string;
}

export interface AutonomyDebugIssue {
  code: string;
  severity: AutonomyDebugSeverity;
  summary: string;
  detail: string;
  recommendation: string;
}

export interface AutonomyDebugSnapshot {
  generated_at: string;
  overall_status: AutonomyDebugOverallStatus;
  readiness_status: DeploymentReadinessStatus;
  readiness_summary: {
    failed_critical: number;
    failed_non_critical: number;
  };
  kill_switch_active: boolean;
  supervisor_health: {
    expected_services: number;
    healthy_services: number;
    ratio: number;
  };
  services: AutonomyDebugServiceState[];
  issues: AutonomyDebugIssue[];
  recommendations: string[];
}

export interface AutonomyDebugFixAction {
  service: AutonomyDebugServiceName;
  attempted: boolean;
  success: boolean;
  detail: string;
}

const SERVICE_STALE_MS: Record<AutonomyDebugServiceName, number> = {
  autonomy_supervisor: 5 * 60_000,
  strategy_governor: 30 * 60_000,
  strategy_allocator: 25 * 60_000,
  strategy_evolution: 45 * 60_000,
  production_watchdog: 3 * 60_000,
  execution_safety_supervisor: 3 * 60_000,
};

function boolFromUnknown(value: unknown): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseIsoMs(value: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function staleAgeMs(service: AutonomyDebugServiceState): number | null {
  if (!service.expected || !service.running) return null;
  const lastCycleMs = parseIsoMs(service.last_cycle_at);
  if (!lastCycleMs) return null;
  const thresholdMs = SERVICE_STALE_MS[service.name];
  if (!Number.isFinite(thresholdMs) || thresholdMs <= 0) return null;
  const ageMs = Date.now() - lastCycleMs;
  return ageMs > thresholdMs ? ageMs : null;
}

function buildServices(): AutonomyDebugServiceState[] {
  const supervisor = getAutonomySupervisorSnapshot();
  const governor = getStrategyGovernorSnapshot();
  const allocator = getStrategyAllocatorSnapshot();
  const evolution = getStrategyEvolutionSnapshot();
  const watchdog = getProductionWatchdogSnapshot();
  const executionSafety = getExecutionSafetySupervisorSnapshot();

  return [
    {
      name: "autonomy_supervisor",
      expected: shouldAutonomySupervisorAutoStart(),
      running: supervisor.running,
      last_error: supervisor.last_error,
      last_cycle_at: supervisor.last_tick_at,
      detail: `services=${supervisor.services.filter((svc) => svc.expected && svc.health === "HEALTHY").length}/${supervisor.services.filter((svc) => svc.expected).length}`,
    },
    {
      name: "strategy_governor",
      expected: shouldStrategyGovernorAutoStart(),
      running: governor.running,
      last_error: governor.last_error,
      last_cycle_at: governor.last_cycle_at,
      detail: `validation=${governor.last_validation_status ?? "INSUFFICIENT"},cycles=${governor.total_cycles}`,
    },
    {
      name: "strategy_allocator",
      expected: shouldStrategyAllocatorAutoStart(),
      running: allocator.running,
      last_error: allocator.last_error,
      last_cycle_at: allocator.last_cycle_at,
      detail: `validation=${allocator.last_validation_status ?? "INSUFFICIENT"},alloc=${allocator.allocation_count}`,
    },
    {
      name: "strategy_evolution",
      expected: shouldStrategyEvolutionAutoStart(),
      running: evolution.running,
      last_error: evolution.last_error,
      last_cycle_at: evolution.last_cycle_at,
      detail: `evaluated=${evolution.evaluated_strategies.length},optimized=${evolution.optimized_strategies.length}`,
    },
    {
      name: "production_watchdog",
      expected: shouldProductionWatchdogAutoStart(),
      running: watchdog.running,
      last_error: watchdog.last_error,
      last_cycle_at: watchdog.last_cycle_at,
      detail: `status=${watchdog.last_status ?? "UNKNOWN"},escalation=${watchdog.escalation_active ? "on" : "off"}`,
    },
    {
      name: "execution_safety_supervisor",
      expected: shouldExecutionSafetySupervisorAutoStart(),
      running: executionSafety.running,
      last_error: executionSafety.last_error,
      last_cycle_at: executionSafety.last_cycle_at,
      detail:
        `blocked=${executionSafety.consecutive_blocked},warn=${executionSafety.consecutive_warn}` +
        `,incident=${executionSafety.last_summary?.incident_level ?? "NORMAL"}`,
    },
  ];
}

function buildIssues(input: {
  readinessStatus: DeploymentReadinessStatus;
  readinessCriticalFailed: number;
  readinessNonCriticalFailed: number;
  killSwitchActive: boolean;
  services: AutonomyDebugServiceState[];
  supervisorExpectedServices: number;
  supervisorHealthyServices: number;
}): AutonomyDebugIssue[] {
  const issues: AutonomyDebugIssue[] = [];

  if (input.readinessStatus === "NOT_READY") {
    issues.push({
      code: "READINESS_NOT_READY",
      severity: "critical",
      summary: "Deployment readiness is NOT_READY",
      detail: `critical_failed=${input.readinessCriticalFailed}, non_critical_failed=${input.readinessNonCriticalFailed}`,
      recommendation: "Run debug auto-fix, then inspect /ops/deployment/readiness for failing critical checks.",
    });
  } else if (input.readinessStatus === "DEGRADED") {
    issues.push({
      code: "READINESS_DEGRADED",
      severity: "warn",
      summary: "Deployment readiness is DEGRADED",
      detail: `non_critical_failed=${input.readinessNonCriticalFailed}`,
      recommendation: "Address degraded checks before promoting to live mode.",
    });
  }

  if (input.killSwitchActive) {
    issues.push({
      code: "KILL_SWITCH_ACTIVE",
      severity: "critical",
      summary: "Risk kill switch is active",
      detail: "Execution is blocked until manual release.",
      recommendation: "Confirm root-cause, then release kill switch from system controls when safe.",
    });
  }

  const supervisorRatio =
    input.supervisorExpectedServices > 0
      ? input.supervisorHealthyServices / input.supervisorExpectedServices
      : 1;
  if (supervisorRatio < 0.6) {
    issues.push({
      code: "SUPERVISOR_HEALTH_RATIO_LOW",
      severity: supervisorRatio < 0.35 ? "critical" : "warn",
      summary: "Autonomy supervisor health ratio is low",
      detail: `${input.supervisorHealthyServices}/${input.supervisorExpectedServices} healthy`,
      recommendation: "Run debug auto-fix and check the autonomy supervisor service list for persistent failures.",
    });
  }

  for (const service of input.services) {
    const staleMs = staleAgeMs(service);

    if (service.expected && !service.running) {
      issues.push({
        code: `${service.name.toUpperCase()}_STOPPED`,
        severity:
          service.name === "production_watchdog" ||
          service.name === "autonomy_supervisor" ||
          service.name === "execution_safety_supervisor"
            ? "critical"
            : "warn",
        summary: `${service.name.replaceAll("_", " ")} is stopped`,
        detail: service.detail,
        recommendation: "Run debug auto-fix to start this service.",
      });
    }

    if (service.last_error) {
      issues.push({
        code: `${service.name.toUpperCase()}_ERROR`,
        severity: "warn",
        summary: `${service.name.replaceAll("_", " ")} has a recent error`,
        detail: service.last_error,
        recommendation: "Inspect service logs and run the service cycle manually from brain controls.",
      });
    }

    if (staleMs !== null) {
      const thresholdMs = SERVICE_STALE_MS[service.name];
      const staleSeconds = Math.round(staleMs / 1000);
      const thresholdSeconds = Math.round(thresholdMs / 1000);
      issues.push({
        code: `${service.name.toUpperCase()}_STALE`,
        severity:
          service.name === "production_watchdog" ||
          service.name === "autonomy_supervisor" ||
          service.name === "execution_safety_supervisor"
            ? "critical"
            : "warn",
        summary: `${service.name.replaceAll("_", " ")} heartbeat is stale`,
        detail: `age=${staleSeconds}s threshold=${thresholdSeconds}s`,
        recommendation: "Run debug auto-fix to trigger a manual service cycle.",
      });
    }
  }

  return issues;
}

function summarizeStatus(issues: AutonomyDebugIssue[]): AutonomyDebugOverallStatus {
  if (issues.some((issue) => issue.severity === "critical")) return "CRITICAL";
  if (issues.length > 0) return "DEGRADED";
  return "HEALTHY";
}

function dedupeRecommendations(issues: AutonomyDebugIssue[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const issue of issues) {
    const recommendation = issue.recommendation.trim();
    if (!recommendation || seen.has(recommendation)) continue;
    seen.add(recommendation);
    out.push(recommendation);
  }
  return out;
}

export async function getAutonomyDebugSnapshot(options?: {
  includePreflight?: boolean;
  forceReadiness?: boolean;
}): Promise<AutonomyDebugSnapshot> {
  const readiness = await getDeploymentReadinessReport({
    includePreflight: Boolean(options?.includePreflight),
    forceRefresh: Boolean(options?.forceReadiness),
  });
  const killSwitchActive = isKillSwitchActive();
  const services = buildServices();
  const supervisor = getAutonomySupervisorSnapshot();
  const supervisorExpected = supervisor.services.filter((svc) => svc.expected).length;
  const supervisorHealthy = supervisor.services.filter((svc) => svc.expected && svc.health === "HEALTHY").length;

  const issues = buildIssues({
    readinessStatus: readiness.status,
    readinessCriticalFailed: readiness.summary.failed_critical,
    readinessNonCriticalFailed: readiness.summary.failed_non_critical,
    killSwitchActive,
    services,
    supervisorExpectedServices: supervisorExpected,
    supervisorHealthyServices: supervisorHealthy,
  });

  return {
    generated_at: new Date().toISOString(),
    overall_status: summarizeStatus(issues),
    readiness_status: readiness.status,
    readiness_summary: {
      failed_critical: readiness.summary.failed_critical,
      failed_non_critical: readiness.summary.failed_non_critical,
    },
    kill_switch_active: killSwitchActive,
    supervisor_health: {
      expected_services: supervisorExpected,
      healthy_services: supervisorHealthy,
      ratio: supervisorExpected > 0 ? supervisorHealthy / supervisorExpected : 1,
    },
    services,
    issues,
    recommendations: dedupeRecommendations(issues),
  };
}

async function startServiceForFix(service: AutonomyDebugServiceName): Promise<AutonomyDebugFixAction> {
  try {
    if (service === "autonomy_supervisor") {
      const result = await startAutonomySupervisor({ runImmediate: false });
      return { service, attempted: true, success: result.success, detail: result.message };
    }
    if (service === "strategy_governor") {
      const result = await startStrategyGovernor({ runImmediate: false });
      return { service, attempted: true, success: result.success, detail: result.message };
    }
    if (service === "strategy_allocator") {
      const result = await startStrategyAllocator({ runImmediate: false });
      return { service, attempted: true, success: result.success, detail: result.message };
    }
    if (service === "strategy_evolution") {
      const result = await startStrategyEvolutionScheduler({ runImmediate: false });
      return { service, attempted: true, success: result.success, detail: result.message };
    }
    if (service === "execution_safety_supervisor") {
      const result = await startExecutionSafetySupervisor({ runImmediate: false });
      return { service, attempted: true, success: result.success, detail: result.message };
    }
    const result = await startProductionWatchdog({ runImmediate: false });
    return { service, attempted: true, success: result.success, detail: result.message };
  } catch (err) {
    return {
      service,
      attempted: true,
      success: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function runServiceCycleForFix(service: AutonomyDebugServiceName): Promise<AutonomyDebugFixAction> {
  try {
    if (service === "autonomy_supervisor") {
      await runAutonomySupervisorTick("autonomy_debug_fix_stale");
      return { service, attempted: true, success: true, detail: "Autonomy supervisor cycle executed" };
    }
    if (service === "strategy_governor") {
      await runStrategyGovernorCycle("autonomy_debug_fix_stale");
      return { service, attempted: true, success: true, detail: "Strategy governor cycle executed" };
    }
    if (service === "strategy_allocator") {
      await runStrategyAllocatorCycle("autonomy_debug_fix_stale");
      return { service, attempted: true, success: true, detail: "Strategy allocator cycle executed" };
    }
    if (service === "strategy_evolution") {
      await runStrategyEvolutionCycle("autonomy_debug_fix_stale");
      return { service, attempted: true, success: true, detail: "Strategy evolution cycle executed" };
    }
    if (service === "production_watchdog") {
      await runProductionWatchdogCycle("autonomy_debug_fix_stale");
      return { service, attempted: true, success: true, detail: "Production watchdog cycle executed" };
    }
    await runExecutionSafetySupervisorCycle("autonomy_debug_fix_stale");
    return { service, attempted: true, success: true, detail: "Execution safety supervisor cycle executed" };
  } catch (err) {
    return {
      service,
      attempted: true,
      success: false,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runAutonomyDebugAutoFix(options?: {
  includePreflight?: boolean;
  forceReadiness?: boolean;
}): Promise<{ fixes: AutonomyDebugFixAction[]; snapshot: AutonomyDebugSnapshot }> {
  const before = await getAutonomyDebugSnapshot({
    includePreflight: options?.includePreflight,
    forceReadiness: options?.forceReadiness,
  });

  const fixes: AutonomyDebugFixAction[] = [];
  for (const service of before.services) {
    if (!service.expected) continue;
    if (!service.running) {
      fixes.push(await startServiceForFix(service.name));
      continue;
    }
    if (staleAgeMs(service) !== null) {
      fixes.push(await runServiceCycleForFix(service.name));
    }
  }

  const fixed = fixes.filter((fix) => fix.success).length;
  if (fixed > 0) {
    addOpsAlert("warn", `[autonomy-debugger] auto-fix started ${fixed} service(s)`);
  }
  if (fixes.some((fix) => !fix.success)) {
    addOpsAlert("critical", "[autonomy-debugger] auto-fix encountered failures");
  }

  logger.info(
    {
      attempted: fixes.length,
      succeeded: fixes.filter((fix) => fix.success).length,
      failed: fixes.filter((fix) => !fix.success).length,
    },
    "[autonomy-debugger] auto-fix run completed",
  );

  const snapshot = await getAutonomyDebugSnapshot({
    includePreflight: options?.includePreflight,
    forceReadiness: true,
  });
  return { fixes, snapshot };
}

export function parseAutonomyDebugQuery(query: Record<string, unknown>): {
  includePreflight: boolean;
  forceReadiness: boolean;
} {
  return {
    includePreflight: boolFromUnknown(query.include_preflight) || boolFromUnknown(query.preflight),
    forceReadiness: boolFromUnknown(query.refresh) || boolFromUnknown(query.force),
  };
}
