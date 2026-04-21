/**
 * Unified Observability Layer for GodsView Trading Platform
 *
 * Provides:
 * - Structured logging with request context (correlation ID, service name, timestamps)
 * - Health check aggregator for all critical dependencies
 * - Readiness probe with version and uptime information
 * - Incident timeline recorder for forensic replay and root cause analysis
 * - SLO burn rate calculation and tracking
 */

import { randomUUID } from "node:crypto";
import pino from "pino";
import type { Logger as PinoLogger } from "pino";

// ═══════════════════════════════════════════════════════════════════════════
// ── STRUCTURED LOGGER WITH REQUEST CONTEXT ────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export interface LogContext {
  correlationId: string;
  service: string;
  timestamp: string;
  userId?: string;
  sessionId?: string;
  requestPath?: string;
  method?: string;
}

export interface StructuredLog extends LogContext {
  level: "debug" | "info" | "warn" | "error";
  message: string;
  data?: Record<string, unknown>;
}

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(process.env.NODE_ENV !== "production"
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }
    : {}),
});

let currentContext: Partial<LogContext> = {
  service: "godsview-api",
  correlationId: randomUUID(),
};

export function setLogContext(ctx: Partial<LogContext>): void {
  currentContext = { ...currentContext, ...ctx };
}

export function getLogContext(): LogContext {
  return {
    correlationId: currentContext.correlationId ?? randomUUID(),
    service: currentContext.service ?? "godsview-api",
    timestamp: new Date().toISOString(),
    userId: currentContext.userId,
    sessionId: currentContext.sessionId,
    requestPath: currentContext.requestPath,
    method: currentContext.method,
  };
}

export function createStructuredLogger(ctx?: Partial<LogContext>): PinoLogger {
  const context = { ...getLogContext(), ...ctx };
  return baseLogger.child(context);
}

export const structuredLogger = {
  debug: (message: string, data?: Record<string, unknown>) => {
    const ctx = getLogContext();
    baseLogger.debug({ ...ctx, data }, message);
  },
  info: (message: string, data?: Record<string, unknown>) => {
    const ctx = getLogContext();
    baseLogger.info({ ...ctx, data }, message);
  },
  warn: (message: string, data?: Record<string, unknown>) => {
    const ctx = getLogContext();
    baseLogger.warn({ ...ctx, data }, message);
  },
  error: (message: string, data?: Record<string, unknown>, error?: Error) => {
    const ctx = getLogContext();
    baseLogger.error({ ...ctx, data, err: error }, message);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// ── HEALTH CHECK AGGREGATOR ──────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export interface DependencyHealth {
  status: "ok" | "degraded" | "error" | "skipped";
  latencyMs?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  checks: Record<string, DependencyHealth>;
  allHealthy: boolean;
}

const healthChecks: Record<
  string,
  () => Promise<DependencyHealth>
> = {};

export function registerHealthCheck(
  name: string,
  check: () => Promise<DependencyHealth>,
): void {
  healthChecks[name] = check;
}

export async function runHealthChecks(): Promise<HealthCheckResult> {
  const checks: Record<string, DependencyHealth> = {};
  let allHealthy = true;

  // Default checks
  if (!healthChecks["api-server"]) {
    registerHealthCheck("api-server", async () => ({
      status: "ok",
      latencyMs: 0,
    }));
  }

  // Database check (if available)
  if (!healthChecks["database"]) {
    registerHealthCheck("database", async () => {
      try {
        const { checkDbHealth } = await import("@workspace/db");
        const dbHealth = await checkDbHealth();
        return {
          status: dbHealth.ok ? "ok" : "error",
          latencyMs: dbHealth.latencyMs,
          error: dbHealth.error,
          details: {
            driver: dbHealth.driver,
            poolTotal: dbHealth.poolTotal,
            poolIdle: dbHealth.poolIdle,
            poolWaiting: dbHealth.poolWaiting,
          },
        };
      } catch (err: any) {
        return {
          status: "error",
          error: err.message,
        };
      }
    });
  }

  // Redis check (stub — would connect to real Redis in production)
  if (!healthChecks["redis"]) {
    registerHealthCheck("redis", async () => ({
      status: process.env.REDIS_URL ? "ok" : "skipped",
      error: process.env.REDIS_URL ? undefined : "REDIS_URL not configured",
    }));
  }

  // Message broker check (stub)
  if (!healthChecks["broker"]) {
    registerHealthCheck("broker", async () => ({
      status: process.env.AMQP_URL ? "ok" : "skipped",
      error: process.env.AMQP_URL ? undefined : "AMQP_URL not configured",
    }));
  }

  // Run all registered checks
  const checkEntries = Object.entries(healthChecks);
  for (let i = 0; i < checkEntries.length; i++) {
    const [name, check] = checkEntries[i];
    try {
      checks[name] = await check();
      if (checks[name]!.status === "error") {
        allHealthy = false;
      }
    } catch (err: any) {
      checks[name] = {
        status: "error",
        error: err.message,
      };
      allHealthy = false;
    }
  }

  return {
    status: allHealthy ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    checks,
    allHealthy,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── READINESS PROBE ──────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export interface ReadinessProbe {
  ready: boolean;
  timestamp: string;
  version: string;
  uptime: number;
  dependencies: Record<string, DependencyHealth>;
  nodeVersion: string;
  memoryMB: number;
  eventLoopLagMs: number;
}

export async function readinessProbe(): Promise<ReadinessProbe> {
  const health = await runHealthChecks();

  // Measure event loop lag
  const lagStart = Date.now();
  await new Promise((resolve) => setImmediate(resolve));
  const eventLoopLagMs = Date.now() - lagStart;

  // Get version from package.json (or use default)
  const version = process.env.npm_package_version ?? "0.0.0";

  return {
    ready: health.allHealthy && eventLoopLagMs < 100,
    timestamp: health.timestamp,
    version,
    uptime: process.uptime(),
    dependencies: health.checks,
    nodeVersion: process.version,
    memoryMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    eventLoopLagMs,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ── INCIDENT TIMELINE RECORDER ──────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export interface IncidentEvent {
  timestamp: string;
  correlationId: string;
  eventType:
    | "signal_generated"
    | "signal_rejected"
    | "trade_executed"
    | "trade_failed"
    | "health_degraded"
    | "error_occurred"
    | "recovery"
    | "gate_triggered";
  severity: "info" | "warning" | "critical";
  component: string;
  message: string;
  data?: Record<string, unknown>;
  stackTrace?: string;
}

export interface IncidentTimeline {
  incidentId: string;
  startTime: string;
  endTime?: string;
  severity: "info" | "warning" | "critical";
  events: IncidentEvent[];
  resolved: boolean;
}

// In-memory incident recorder (production would use persistent storage)
const incidents: Map<string, IncidentTimeline> = new Map();
const currentIncidents: Map<string, string> = new Map(); // component → incidentId

export function recordIncidentEvent(event: Omit<IncidentEvent, "timestamp">): string {
  const correlationId = event.correlationId || getLogContext().correlationId;
  const timestamp = new Date().toISOString();

  // Get or create incident for this component
  let incidentId = currentIncidents.get(event.component);
  if (!incidentId) {
    incidentId = `incident-${Date.now()}-${randomUUID().substring(0, 8)}`;
    currentIncidents.set(event.component, incidentId);
    incidents.set(incidentId, {
      incidentId,
      startTime: timestamp,
      severity: event.severity,
      events: [],
      resolved: false,
    });
  }

  const incident = incidents.get(incidentId)!;
  const fullEvent: IncidentEvent = {
    ...event,
    timestamp,
    correlationId,
  };

  incident.events.push(fullEvent);
  incident.severity =
    event.severity === "critical" || incident.severity === "critical"
      ? "critical"
      : event.severity === "warning" || incident.severity === "warning"
        ? "warning"
        : "info";

  // Log the event
  structuredLogger.warn(`Incident event recorded: ${event.eventType}`, {
    incidentId,
    ...fullEvent,
  });

  return incidentId;
}

export function resolveIncident(incidentId: string): IncidentTimeline | null {
  const incident = incidents.get(incidentId);
  if (incident) {
    incident.endTime = new Date().toISOString();
    incident.resolved = true;

    // Clear from current incidents
    const entries = Array.from(currentIncidents.entries());
    for (const [comp, id] of entries) {
      if (id === incidentId) {
        currentIncidents.delete(comp);
      }
    }

    structuredLogger.info("Incident resolved", { incidentId, endTime: incident.endTime });
  }
  return incident || null;
}

export function getIncidentTimeline(incidentId: string): IncidentTimeline | null {
  return incidents.get(incidentId) || null;
}

export function getRecentIncidents(limit: number = 20): IncidentTimeline[] {
  const entries = Array.from(incidents.values());
  return entries
    .sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    )
    .slice(0, limit);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── SLO BURN RATE CALCULATION ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export interface SLOTarget {
  name: string;
  target: number; // percentage (0-100)
  window: "5m" | "30m" | "1h" | "24h";
}

export interface SLOBurnRate {
  target: string;
  window: string;
  currentBurnRate: number; // percentage per unit time
  budgetRemaining: number; // percentage
  isErroring: boolean;
  threshold: number; // burn rate threshold for alert
}

const sloTargets: Map<string, SLOTarget> = new Map([
  [
    "api-availability",
    { name: "API Availability", target: 99.9, window: "24h" },
  ],
  [
    "signal-processing",
    { name: "Signal Processing", target: 99.5, window: "24h" },
  ],
  ["trade-execution", { name: "Trade Execution", target: 99.9, window: "24h" }],
]);

const windowToMs: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
};

// Track errors per window
const errorTracking: Map<
  string,
  { window: number; errors: number; total: number }[]
> = new Map();

export function recordSLOEvent(sloName: string, success: boolean): void {
  const target = sloTargets.get(sloName);
  if (!target) {
    structuredLogger.warn(`Unknown SLO: ${sloName}`);
    return;
  }

  if (!errorTracking.has(sloName)) {
    errorTracking.set(sloName, []);
  }

  const tracking = errorTracking.get(sloName)!;
  const now = Date.now();
  const windowMs = windowToMs[target.window];

  // Prune old windows
  const validWindow = tracking.filter((w) => w.window > now - windowMs);
  validWindow.push({ window: now, errors: success ? 0 : 1, total: 1 });

  errorTracking.set(sloName, validWindow);
}

export function calculateSLOBurnRate(sloName: string): SLOBurnRate | null {
  const target = sloTargets.get(sloName);
  if (!target) return null;

  const tracking = errorTracking.get(sloName) || [];
  const windowMs = windowToMs[target.window] ?? (24 * 60 * 60 * 1000);
  const now = Date.now();

  // Sum events in window
  let totalErrors = 0;
  let totalEvents = 0;

  for (let i = 0; i < tracking.length; i++) {
    const w = tracking[i];
    if (w && w.window > now - windowMs) {
      totalErrors += w.errors;
      totalEvents += w.total;
    }
  }

  if (totalEvents === 0) {
    return {
      target: sloName,
      window: target.window,
      currentBurnRate: 0,
      budgetRemaining: 100,
      isErroring: false,
      threshold: (100 - target.target) * 10, // 10x error budget
    };
  }

  const errorRate = (totalErrors / totalEvents) * 100;
  const budgetRemaining = target.target - (100 - errorRate);
  const burnRate = (errorRate / target.target) * 100;
  const threshold = (100 - target.target) * 10;

  return {
    target: sloName,
    window: target.window,
    currentBurnRate: burnRate,
    budgetRemaining: Math.max(0, budgetRemaining),
    isErroring: burnRate > threshold,
    threshold,
  };
}

export function getSLOStatus(): SLOBurnRate[] {
  const keys = Array.from(sloTargets.keys());
  const results = keys
    .map((name) => calculateSLOBurnRate(name))
    .filter((rate): rate is SLOBurnRate => rate !== null);
  return results;
}

export function registerSLOTarget(slo: SLOTarget): void {
  sloTargets.set(slo.name.toLowerCase().replace(/\s+/g, "-"), slo);
}

// ═══════════════════════════════════════════════════════════════════════════
// ── EXPORTS ──────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

export default {
  logger: structuredLogger,
  setLogContext,
  getLogContext,
  createStructuredLogger,
  registerHealthCheck,
  runHealthChecks,
  readinessProbe,
  recordIncidentEvent,
  resolveIncident,
  getIncidentTimeline,
  getRecentIncidents,
  recordSLOEvent,
  calculateSLOBurnRate,
  getSLOStatus,
  registerSLOTarget,
};
