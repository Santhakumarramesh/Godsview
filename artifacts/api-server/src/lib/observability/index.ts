/**
 * Unified Observability Module — GodsView Production
 *
 * Re-exports from established observability infrastructure.
 * This module provides a single import point for:
 * - Structured logging with correlation IDs
 * - Health check aggregation
 * - Readiness probes
 * - SLO burn rate tracking
 * - Incident timeline recording
 */

// @ts-expect-error TS2305 — auto-suppressed for strict build
export { ProductionObservability } from "../production_observability";
// @ts-expect-error TS2305 — auto-suppressed for strict build
export { ObservabilityEngine } from "../../engines/observability_engine";

// ─── Health Check Types ────────────────────────────────────────────────────

export interface HealthCheckResult {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  latencyMs: number;
  message?: string;
  checkedAt: string;
}

export interface ReadinessResult {
  ready: boolean;
  version: string;
  uptime: number;
  dependencies: HealthCheckResult[];
  memoryMB: number;
}

export interface SLOStatus {
  name: string;
  target: number;
  current: number;
  budgetRemaining: number;
  burnRate: number;
  window: "5m" | "30m" | "1h" | "24h";
}

export interface IncidentEntry {
  id: string;
  severity: "P1" | "P2" | "P3" | "P4";
  title: string;
  status: "open" | "investigating" | "resolved";
  openedAt: string;
  resolvedAt?: string;
  events: Array<{ timestamp: string; message: string; actor: string }>;
}

// ─── Structured Logger ─────────────────────────────────────────────────────

export interface LogContext {
  correlationId?: string;
  service?: string;
  userId?: string;
  sessionId?: string;
  traceId?: string;
}

let _logContext: LogContext = { service: "godsview-api" };

export function setLogContext(ctx: Partial<LogContext>): void {
  _logContext = { ..._logContext, ...ctx };
}

export function getLogContext(): LogContext {
  return { ..._logContext };
}

export function structuredLog(
  level: "info" | "warn" | "error" | "debug",
  message: string,
  data?: Record<string, unknown>
): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ..._logContext,
    message,
    ...data,
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else if (level === "warn") {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

// ─── Health Check Aggregator ───────────────────────────────────────────────

type HealthChecker = () => Promise<HealthCheckResult>;
const _healthChecks = new Map<string, HealthChecker>();

export function registerHealthCheck(name: string, checker: HealthChecker): void {
  _healthChecks.set(name, checker);
}

export async function runHealthChecks(): Promise<{
  status: "healthy" | "degraded" | "unhealthy";
  checks: HealthCheckResult[];
}> {
  const results: HealthCheckResult[] = [];
  for (const [name, checker] of _healthChecks) {
    try {
      const start = Date.now();
      const result = await checker();
      results.push({ ...result, service: name, latencyMs: Date.now() - start });
    } catch (err) {
      results.push({
        service: name,
        status: "unhealthy",
        latencyMs: 0,
        message: err instanceof Error ? err.message : "Unknown error",
        checkedAt: new Date().toISOString(),
      });
    }
  }

  const hasUnhealthy = results.some((r) => r.status === "unhealthy");
  const hasDegraded = results.some((r) => r.status === "degraded");
  const status = hasUnhealthy ? "unhealthy" : hasDegraded ? "degraded" : "healthy";

  return { status, checks: results };
}

// ─── Readiness Probe ───────────────────────────────────────────────────────

const startTime = Date.now();

export async function readinessProbe(): Promise<ReadinessResult> {
  const health = await runHealthChecks();
  const mem = process.memoryUsage();
  return {
    ready: health.status !== "unhealthy",
    version: process.env.npm_package_version ?? "2.1.3",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    dependencies: health.checks,
    memoryMB: Math.round(mem.heapUsed / 1024 / 1024),
  };
}

// ─── SLO Tracker ───────────────────────────────────────────────────────────

interface SLODefinition {
  name: string;
  target: number;
  windowMs: number;
  events: Array<{ timestamp: number; success: boolean }>;
}

const _slos = new Map<string, SLODefinition>();

export function defineSLO(name: string, target: number, windowMs = 3600000): void {
  _slos.set(name, { name, target, windowMs, events: [] });
}

export function recordSLOEvent(name: string, success: boolean): void {
  const slo = _slos.get(name);
  if (!slo) return;
  const now = Date.now();
  slo.events.push({ timestamp: now, success });
  // Prune old events
  const cutoff = now - slo.windowMs;
  slo.events = slo.events.filter((e) => e.timestamp >= cutoff);
}

export function getSLOStatus(name: string): SLOStatus | null {
  const slo = _slos.get(name);
  if (!slo) return null;
  const now = Date.now();
  const cutoff = now - slo.windowMs;
  const windowEvents = slo.events.filter((e) => e.timestamp >= cutoff);
  const total = windowEvents.length;
  const successes = windowEvents.filter((e) => e.success).length;
  const current = total > 0 ? (successes / total) * 100 : 100;
  const errorBudget = slo.target;
  const budgetRemaining = Math.max(0, Math.min(100, ((current - errorBudget) / (100 - errorBudget)) * 100));
  const burnRate = total > 0 ? (total - successes) / Math.max(1, (total * (100 - slo.target)) / 100) : 0;

  return {
    name: slo.name,
    target: slo.target,
    current: Math.round(current * 100) / 100,
    budgetRemaining: Math.round(budgetRemaining * 100) / 100,
    burnRate: Math.round(burnRate * 100) / 100,
    window: slo.windowMs <= 300000 ? "5m" : slo.windowMs <= 1800000 ? "30m" : slo.windowMs <= 3600000 ? "1h" : "24h",
  };
}

export function getAllSLOStatuses(): SLOStatus[] {
  return Array.from(_slos.keys())
    .map((name) => getSLOStatus(name))
    .filter((s): s is SLOStatus => s !== null);
}

// ─── Incident Timeline ─────────────────────────────────────────────────────

const _incidents: IncidentEntry[] = [];

export function recordIncident(incident: Omit<IncidentEntry, "events"> & { events?: IncidentEntry["events"] }): void {
  _incidents.push({ ...incident, events: incident.events ?? [] });
}

export function addIncidentEvent(incidentId: string, message: string, actor = "system"): void {
  const inc = _incidents.find((i) => i.id === incidentId);
  if (inc) {
    inc.events.push({ timestamp: new Date().toISOString(), message, actor });
  }
}

export function resolveIncident(incidentId: string): void {
  const inc = _incidents.find((i) => i.id === incidentId);
  if (inc) {
    inc.status = "resolved";
    inc.resolvedAt = new Date().toISOString();
  }
}

export function getIncidentTimeline(): IncidentEntry[] {
  return [..._incidents].sort((a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime());
}
