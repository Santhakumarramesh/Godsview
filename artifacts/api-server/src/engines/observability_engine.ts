/**
 * observability_engine.ts — Phase 72 (Wave 4.1): Comprehensive Observability
 *
 * Unified observability engine that aggregates health/metrics data across all subsystems.
 *
 * Components:
 * - SystemHealthReport: comprehensive snapshot of all component health
 * - collectSystemHealth(): query and aggregate health from all subsystems
 * - getHealthTimeline(): retrieve historical health snapshots
 * - MetricsAggregator: rolling counters and gauge values with rolling window calculation
 * - AlertManager: lifecycle management for system alerts with auto-escalation
 *
 * Persistence: uses persistent_store for health_snapshots, metrics_snapshots, system_alerts
 */

import { logger } from "../lib/logger";
import {
  persistWrite,
  persistRead,
  persistAppend,
  getCollectionSize,
} from "../lib/persistent_store";
import { getOpsSnapshot } from "../lib/ops_monitor";
import { collectMetrics } from "../lib/metrics";

/* ─────────────────────────────────────────────────────────────────────────── */
/* Types                                                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

export interface ComponentHealth {
  status: "up" | "degraded" | "down";
  latency?: number;
  lastCheck: string;
  details?: string;
}

export interface SystemHealthReport {
  timestamp: string;
  uptime: number;
  version: string;
  components: Map<string, ComponentHealth>;
  alerts: Alert[];
  metrics: {
    signalsPerMin: number;
    tradesPerMin: number;
    ordersPerMin: number;
    errorsPerMin: number;
    equity: number;
    drawdown: number;
    openPositions: number;
    pendingOrders: number;
  };
}

export interface HealthSnapshot {
  timestamp: string;
  overall_status: "green" | "yellow" | "red";
  components: Record<string, ComponentHealth>;
  metrics: SystemHealthReport["metrics"];
  alerts_count: number;
}

export interface Alert {
  id: string;
  timestamp: string;
  severity: "info" | "warning" | "critical";
  category: string;
  message: string;
  details?: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedAt?: string;
  resolved: boolean;
  resolvedAt?: string;
}

export interface MetricValue {
  timestamp: string;
  name: string;
  value: number;
  labels?: Record<string, string>;
}

export interface MetricsSummary {
  timestamp: string;
  counters: Record<string, number>;
  gauges: Record<string, number>;
  rollups: {
    "1min": Record<string, number>;
    "5min": Record<string, number>;
    "1hr": Record<string, number>;
  };
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* MetricsAggregator Class                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

class MetricsAggregator {
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private history: MetricValue[] = [];
  private readonly maxHistorySize = 10000;

  recordMetric(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels);

    // Auto-detect counter vs gauge behavior based on name
    if (
      name.includes("total") ||
      name.includes("processed") ||
      name.includes("executed")
    ) {
      const current = this.counters.get(key) ?? 0;
      this.counters.set(key, current + value);
    } else {
      this.gauges.set(key, value);
    }

    this.history.push({
      timestamp: new Date().toISOString(),
      name,
      value,
      labels,
    });

    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  incrementCounter(name: string, amount: number = 1, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + amount);
  }

  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.makeKey(name, labels);
    this.gauges.set(key, value);
  }

  getMetricsSummary(): MetricsSummary {
    const now = new Date();
    const oneMinAgo = new Date(now.getTime() - 60 * 1000);
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    const last1min = this.history.filter((m) => new Date(m.timestamp) > oneMinAgo);
    const last5min = this.history.filter((m) => new Date(m.timestamp) > fiveMinAgo);
    const last1hour = this.history.filter((m) => new Date(m.timestamp) > oneHourAgo);

    return {
      timestamp: now.toISOString(),
      counters: Object.fromEntries(this.counters),
      gauges: Object.fromEntries(this.gauges),
      rollups: {
        "1min": this.sumMetrics(last1min),
        "5min": this.sumMetrics(last5min),
        "1hr": this.sumMetrics(last1hour),
      },
    };
  }

  private makeKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}=${v}`)
      .join(",");
    return `${name}{${labelStr}}`;
  }

  private sumMetrics(metrics: MetricValue[]): Record<string, number> {
    const sums: Record<string, number> = {};
    for (const m of metrics) {
      const key = this.makeKey(m.name, m.labels);
      sums[key] = (sums[key] ?? 0) + m.value;
    }
    return sums;
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* AlertManager Class                                                          */
/* ─────────────────────────────────────────────────────────────────────────── */

class AlertManager {
  private alerts: Map<string, Alert> = new Map();
  private escalationTimeouts: Map<string, NodeJS.Timeout> = new Map();
  private readonly escalationDelay = 5 * 60 * 1000; // 5 minutes

  raiseAlert(
    severity: "info" | "warning" | "critical",
    category: string,
    message: string,
    details?: Record<string, unknown>
  ): string {
    const id = this.generateAlertId();
    const alert: Alert = {
      id,
      timestamp: new Date().toISOString(),
      severity,
      category,
      message,
      details,
      acknowledged: false,
      resolved: false,
    };

    this.alerts.set(id, alert);
    logger.warn(`[ALERT] ${severity.toUpperCase()}: ${message}`);

    // Set up auto-escalation for critical unacknowledged alerts
    if (severity === "critical") {
      this.scheduleEscalation(id);
    }

    // Persist to store
    persistAppend("system_alerts", alert, 10000);

    return id;
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();

    // Clear escalation timeout
    const timeout = this.escalationTimeouts.get(alertId);
    if (timeout) {
      clearTimeout(timeout);
      this.escalationTimeouts.delete(alertId);
    }

    return true;
  }

  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString();

    // Clear escalation timeout
    const timeout = this.escalationTimeouts.get(alertId);
    if (timeout) {
      clearTimeout(timeout);
      this.escalationTimeouts.delete(alertId);
    }

    return true;
  }

  getActiveAlerts(): Alert[] {
    return Array.from(this.alerts.values()).filter((a) => !a.resolved);
  }

  getAlertHistory(hours: number = 24): Alert[] {
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    return Array.from(this.alerts.values()).filter(
      (a) => new Date(a.timestamp) > cutoff
    );
  }

  loadAlertsFromStore(): void {
    const stored = persistRead<Alert[]>("system_alerts", []);
    for (const alert of stored) {
      this.alerts.set(alert.id, alert);
      if (!alert.acknowledged && !alert.resolved && alert.severity === "critical") {
        this.scheduleEscalation(alert.id);
      }
    }
  }

  private scheduleEscalation(alertId: string): void {
    const timeout = setTimeout(() => {
      const alert = this.alerts.get(alertId);
      if (alert && !alert.acknowledged && !alert.resolved) {
        logger.error(`[ESCALATION] Unacknowledged CRITICAL alert: ${alert.message}`);
      }
    }, this.escalationDelay);

    this.escalationTimeouts.set(alertId, timeout);
  }

  clearAlerts(): void {
    for (const timeout of this.escalationTimeouts.values()) {
      clearTimeout(timeout);
    }
    this.escalationTimeouts.clear();
    this.alerts.clear();
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Singleton Instances                                                         */
/* ─────────────────────────────────────────────────────────────────────────── */

const metricsAggregator = new MetricsAggregator();
const alertManager = new AlertManager();

// Load persisted alerts on startup
alertManager.loadAlertsFromStore();

/* ─────────────────────────────────────────────────────────────────────────── */
/* Health Collection                                                           */
/* ─────────────────────────────────────────────────────────────────────────── */

export async function collectSystemHealth(): Promise<SystemHealthReport> {
  const opsSnapshot = getOpsSnapshot();
  const components = new Map<string, ComponentHealth>();

  // Map ops_monitor services to component health
  if (opsSnapshot.services) {
    for (const service of opsSnapshot.services) {
      components.set(service.name, {
        status: (service.status as "up" | "degraded" | "down") || "down",
        latency: service.latency_ms ?? undefined,
        lastCheck: service.last_check,
        details: service.details,
      });
    }
  }

  // Add engine status as additional components
  for (const [name, status] of Object.entries(opsSnapshot.engine_status || {})) {
    components.set(`engine_${name}`, {
      status:
        status.error_count === 0
          ? "up"
          : status.error_count > 5
            ? "down"
            : "degraded",
      lastCheck: status.last_run || new Date().toISOString(),
      details: `errors: ${status.error_count}`,
    });
  }

  // Collect metrics from system
  const summary = metricsAggregator.getMetricsSummary();
  const last1min = summary.rollups["1min"];

  const report: SystemHealthReport = {
    timestamp: new Date().toISOString(),
    uptime: opsSnapshot.system.uptime_ms,
    version: process.env.APP_VERSION || "unknown",
    components,
    alerts: alertManager.getActiveAlerts(),
    metrics: {
      signalsPerMin: last1min["signals_processed_total"] ?? 0,
      tradesPerMin: last1min["trades_executed_total"] ?? 0,
      ordersPerMin: last1min["orders_total"] ?? 0,
      errorsPerMin: last1min["errors_total"] ?? 0,
      equity: summary.gauges["equity"] ?? 0,
      drawdown: summary.gauges["drawdown"] ?? 0,
      openPositions: summary.gauges["open_positions"] ?? 0,
      pendingOrders: summary.gauges["pending_orders"] ?? 0,
    },
  };

  // Persist snapshot
  persistAppend("health_snapshots", {
    timestamp: report.timestamp,
    overall_status: calculateOverallStatus(report),
    components: Object.fromEntries(components),
    metrics: report.metrics,
    alerts_count: report.alerts.length,
  } as HealthSnapshot, 1000);

  return report;
}

export async function getHealthTimeline(hours: number = 24): Promise<HealthSnapshot[]> {
  const allSnapshots = persistRead<HealthSnapshot[]>("health_snapshots", []);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  return allSnapshots.filter((s) => new Date(s.timestamp) > cutoff);
}

function calculateOverallStatus(
  report: SystemHealthReport
): "green" | "yellow" | "red" {
  const statuses = Array.from(report.components.values()).map((c) => c.status);
  if (statuses.some((s) => s === "down")) return "red";
  if (statuses.some((s) => s === "degraded")) return "yellow";
  return "green";
}

/* ─────────────────────────────────────────────────────────────────────────── */
/* Exports                                                                     */
/* ─────────────────────────────────────────────────────────────────────────── */

export { metricsAggregator, alertManager };

export function getMetricsAggregator(): MetricsAggregator {
  return metricsAggregator;
}

export function getAlertManager(): AlertManager {
  return alertManager;
}

export function recordMetric(
  name: string,
  value: number,
  labels?: Record<string, string>
): void {
  metricsAggregator.recordMetric(name, value, labels);
}

export function raiseAlert(
  severity: "info" | "warning" | "critical",
  category: string,
  message: string,
  details?: Record<string, unknown>
): string {
  return alertManager.raiseAlert(severity, category, message, details);
}

export function getMetricsSummary(): MetricsSummary {
  return metricsAggregator.getMetricsSummary();
}
