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
import { getAutonomySupervisorSnapshot } from "./autonomy_supervisor";

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

function nowMs(): number {
  return Date.now();
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

function buildArtifactChecks(checks: DeploymentReadinessCheck[]): void {
  const root = process.cwd();
  const files: Array<{ rel: string; critical: boolean; label: string }> = [
    { rel: "artifacts/api-server/dist/index.mjs", critical: true, label: "API build bundle" },
    { rel: "artifacts/godsview-dashboard/dist/public/index.html", critical: true, label: "Dashboard build output" },
    { rel: "Dockerfile", critical: false, label: "Dockerfile" },
    { rel: "docker-entrypoint.sh", critical: false, label: "Docker entrypoint" },
    { rel: "replit-start.sh", critical: false, label: "Replit start script" },
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
    const supportedMode = ["dry_run", "paper_enabled", "live_enabled"].includes(runtimeConfig.systemMode);
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
} {
  const startedKillSwitch = nowMs();
  const killSwitch = isKillSwitchActive();
  timedCheck(
    checks,
    {
      name: "Kill switch is inactive",
      category: "runtime",
      passed: !killSwitch,
      critical: false,
      detail: killSwitch ? "Kill switch active" : "Inactive",
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

  const supervisor = getAutonomySupervisorSnapshot();
  const expectedServices = supervisor.services.filter((svc) => svc.expected).length;
  const healthyServices = supervisor.services.filter((svc) => svc.expected && svc.health === "HEALTHY").length;
  const healthRatio = expectedServices > 0 ? healthyServices / expectedServices : 1;

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

  return {
    killSwitch,
    breakerLevel: breaker.level,
    breakerMultiplier: breaker.position_size_multiplier,
    portfolioRiskState: portfolioRisk?.risk_state ?? null,
    supervisorRunning: supervisor.running,
    expectedServices,
    healthyServices,
    totalHealActions: supervisor.total_heal_actions,
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
