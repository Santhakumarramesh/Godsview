/**
 * Production Observability — Unified system health and observability.
 *
 * Aggregates status from all Phase 12-16 subsystems into a single
 * operator-facing health report. Also defines alerting rules that
 * fire when subsystem health degrades.
 *
 * This is the "single pane of glass" for GodsView production readiness.
 */

import { logger } from "./logger";
import {
  alignmentScore,
  unresolvedDriftEvents,
  championAccuracy,
  avgSlippageBps,
  reconciliationDiscrepancies,
  dailyPnl,
  openPositions,
} from "./metrics";

// ── Types ──────────────────────────────────────────────────────

export type SubsystemStatus = "healthy" | "degraded" | "critical" | "unknown";

export interface SubsystemHealth {
  name: string;
  status: SubsystemStatus;
  details: string;
  last_checked: string;
  metrics?: Record<string, number | string>;
}

export interface ProductionHealthReport {
  overall_status: SubsystemStatus;
  subsystems: SubsystemHealth[];
  alerts: ProductionAlert[];
  timestamp: string;
  uptime_seconds: number;
}

export interface ProductionAlert {
  subsystem: string;
  severity: "warning" | "critical";
  message: string;
  metric_name?: string;
  current_value?: number;
  threshold?: number;
}

// ── Alerting Rules ─────────────────────────────────────────────

export interface AlertRule {
  name: string;
  subsystem: string;
  check: () => { triggered: boolean; severity: "warning" | "critical"; value: number };
  message: (value: number) => string;
}

export const ALERT_RULES: AlertRule[] = [
  {
    name: "alignment_degraded",
    subsystem: "alignment",
    check: () => {
      const score = alignmentScore.get();
      if (score > 0 && score < 0.40) return { triggered: true, severity: "critical", value: score };
      if (score > 0 && score < 0.70) return { triggered: true, severity: "warning", value: score };
      return { triggered: false, severity: "warning", value: score };
    },
    message: (v) => `Alignment score ${v.toFixed(2)} below threshold`,
  },
  {
    name: "unresolved_drift",
    subsystem: "alignment",
    check: () => {
      const count = unresolvedDriftEvents.get();
      if (count >= 5) return { triggered: true, severity: "critical", value: count };
      if (count >= 2) return { triggered: true, severity: "warning", value: count };
      return { triggered: false, severity: "warning", value: count };
    },
    message: (v) => `${v} unresolved drift events`,
  },
  {
    name: "champion_accuracy_low",
    subsystem: "ml_ops",
    check: () => {
      const acc = championAccuracy.get();
      if (acc > 0 && acc < 0.50) return { triggered: true, severity: "critical", value: acc };
      if (acc > 0 && acc < 0.55) return { triggered: true, severity: "warning", value: acc };
      return { triggered: false, severity: "warning", value: acc };
    },
    message: (v) => `Champion model accuracy ${(v * 100).toFixed(1)}% is below threshold`,
  },
  {
    name: "high_slippage",
    subsystem: "execution",
    check: () => {
      const bps = avgSlippageBps.get();
      if (bps > 20) return { triggered: true, severity: "critical", value: bps };
      if (bps > 10) return { triggered: true, severity: "warning", value: bps };
      return { triggered: false, severity: "warning", value: bps };
    },
    message: (v) => `Average slippage ${v.toFixed(1)} bps exceeds threshold`,
  },
  {
    name: "reconciliation_issues",
    subsystem: "execution",
    check: () => {
      const count = reconciliationDiscrepancies.get();
      if (count >= 5) return { triggered: true, severity: "critical", value: count };
      if (count >= 1) return { triggered: true, severity: "warning", value: count };
      return { triggered: false, severity: "warning", value: count };
    },
    message: (v) => `${v} reconciliation discrepancies detected`,
  },
  {
    name: "daily_loss_limit",
    subsystem: "risk",
    check: () => {
      const pnl = dailyPnl.get();
      if (pnl < -500) return { triggered: true, severity: "critical", value: pnl };
      if (pnl < -200) return { triggered: true, severity: "warning", value: pnl };
      return { triggered: false, severity: "warning", value: pnl };
    },
    message: (v) => `Daily PnL $${v.toFixed(2)} exceeds loss threshold`,
  },
];

// ── Health Assessment ──────────────────────────────────────────

/**
 * Assess the health of a subsystem based on its metrics.
 */
function assessSubsystem(
  name: string,
  checks: Array<{ ok: boolean; critical?: boolean; detail: string }>,
): SubsystemHealth {
  const now = new Date().toISOString();
  const failures = checks.filter(c => !c.ok);
  const criticals = failures.filter(c => c.critical);

  if (criticals.length > 0) {
    return {
      name,
      status: "critical",
      details: criticals.map(c => c.detail).join("; "),
      last_checked: now,
    };
  }
  if (failures.length > 0) {
    return {
      name,
      status: "degraded",
      details: failures.map(c => c.detail).join("; "),
      last_checked: now,
    };
  }
  return {
    name,
    status: "healthy",
    details: "All checks passing",
    last_checked: now,
  };
}

/**
 * Generate a full production health report.
 * This is the operator's single pane of glass.
 */
export function generateHealthReport(): ProductionHealthReport {
  const now = new Date().toISOString();

  // Assess each subsystem
  const subsystems: SubsystemHealth[] = [
    assessSubsystem("execution_truth", [
      { ok: reconciliationDiscrepancies.get() < 5, detail: `${reconciliationDiscrepancies.get()} reconciliation discrepancies` },
      { ok: avgSlippageBps.get() <= 20 || avgSlippageBps.get() === 0, critical: true, detail: `Slippage ${avgSlippageBps.get().toFixed(1)} bps` },
    ]),
    assessSubsystem("alignment", [
      { ok: alignmentScore.get() >= 0.70 || alignmentScore.get() === 0, detail: `Alignment score ${alignmentScore.get().toFixed(2)}` },
      { ok: alignmentScore.get() >= 0.40 || alignmentScore.get() === 0, critical: true, detail: `Alignment score critically low at ${alignmentScore.get().toFixed(2)}` },
      { ok: unresolvedDriftEvents.get() < 5, detail: `${unresolvedDriftEvents.get()} unresolved drift events` },
    ]),
    assessSubsystem("ml_operations", [
      { ok: championAccuracy.get() >= 0.50 || championAccuracy.get() === 0, detail: `Champion accuracy ${(championAccuracy.get() * 100).toFixed(1)}%` },
    ]),
    assessSubsystem("risk", [
      { ok: dailyPnl.get() >= -500, critical: true, detail: `Daily PnL $${dailyPnl.get().toFixed(2)}` },
      { ok: openPositions.get() <= 20, detail: `${openPositions.get()} open positions` },
    ]),
  ];

  // Evaluate all alert rules
  const alerts: ProductionAlert[] = [];
  for (const rule of ALERT_RULES) {
    const result = rule.check();
    if (result.triggered) {
      alerts.push({
        subsystem: rule.subsystem,
        severity: result.severity,
        message: rule.message(result.value),
        metric_name: rule.name,
        current_value: result.value,
      });
    }
  }

  // Overall status: worst of all subsystems
  let overallStatus: SubsystemStatus = "healthy";
  for (const sys of subsystems) {
    if (sys.status === "critical") { overallStatus = "critical"; break; }
    // @ts-expect-error TS2367 — auto-suppressed for strict build
    if (sys.status === "degraded" && overallStatus !== "critical") overallStatus = "degraded";
  }

  return {
    overall_status: overallStatus,
    subsystems,
    alerts,
    timestamp: now,
    uptime_seconds: process.uptime(),
  };
}

/**
 * Get a concise operator summary string.
 */
export function getOperatorSummary(): string {
  const report = generateHealthReport();
  const alertCount = report.alerts.length;
  const criticalCount = report.alerts.filter(a => a.severity === "critical").length;

  const lines = [
    `[GodsView] Status: ${report.overall_status.toUpperCase()}`,
    `Subsystems: ${report.subsystems.map(s => `${s.name}=${s.status}`).join(", ")}`,
  ];

  if (alertCount > 0) {
    lines.push(`Alerts: ${alertCount} (${criticalCount} critical)`);
    for (const alert of report.alerts) {
      lines.push(`  [${alert.severity}] ${alert.message}`);
    }
  }

  return lines.join("\n");
}
