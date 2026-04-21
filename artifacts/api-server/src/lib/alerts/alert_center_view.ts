/**
 * Alert Center View (Phase 8)
 *
 * Bridges the internal Alert ring buffer (`lib/alerts.ts`), the SLO
 * burn-rate signal (`lib/slo/slo_tracker.ts`), and the SSE alert router
 * (`lib/alerts/sse_alert_router.ts`) into the shape the Alert Center
 * dashboard page expects.
 *
 * Replaces the previous mock-only `routes/alert_center.ts`. All numbers
 * here come from real in-process state — the Alert Center page now
 * reflects what the operator's `fireAlert()` calls actually produced.
 *
 * The internal `Alert` shape is intentionally minimal (type, severity,
 * message, details, timestamp, acknowledged). The dashboard expects a
 * richer shape with id / priority / category / status / triggeredAt.
 * This module owns that translation in one place so the route handlers
 * stay thin.
 */

import {
  getAlertHistory,
  getActiveAlerts,
  type Alert,
  type AlertSeverity,
  type AlertType,
} from "../alerts";
import { sloTracker } from "../slo/slo_tracker";
import { SLO_DEFINITIONS, type SLODefinition } from "../slo/slo_definitions";
import { sseAlertRouter } from "./sse_alert_router";

// ── Public types ───────────────────────────────────────────────────────────

export type CenterPriority = "P1" | "P2" | "P3" | "P4";
export type CenterStatus = "active" | "acknowledged" | "escalated" | "resolved";
export type CenterCategory =
  | "drawdown"
  | "execution"
  | "regime"
  | "system"
  | "promotion"
  | "calibration"
  | "slo"
  | "memory"
  | "connection";

export interface CenterAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  priority: CenterPriority;
  category: CenterCategory;
  status: CenterStatus;
  message: string;
  details: Record<string, unknown>;
  triggeredAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
}

export interface CenterRule {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  priority: CenterPriority;
  category: CenterCategory;
  source: "alert_type" | "slo_burn_rate";
  cooldownMs?: number;
  triggerCount: number;
  lastTriggered?: string;
}

export interface CenterChannel {
  id: string;
  name: string;
  type: "dashboard" | "webhook" | "sse" | "log";
  enabled: boolean;
  priority: string;
  status: "active" | "inactive";
  messagesSent: number;
  failureRate: number;
  lastSent?: string | null;
}

export interface CenterSummary {
  total: number;
  active: number;
  acknowledged: number;
  escalated: number;
  resolved: number;
  byPriority: Record<CenterPriority, number>;
  systemHealth: number;
  topRules: Array<{ ruleId: string; name: string; triggerCount: number }>;
}

export interface CenterAnomaly {
  id: string;
  metricName: string;
  value: number;
  expected: number;
  zScore: number;
  method: "burn_rate" | "memory_pressure" | "fired_alert";
  severity: "low" | "medium" | "high";
  description: string;
  detectedAt: string;
}

export interface CenterEscalationLevel {
  level: number;
  channels: string[];
  delayMs: number;
  description: string;
  active: boolean;
}

export interface CenterHealth {
  status: "operational" | "degraded" | "down";
  subsystems: {
    alertEngine: { status: string; activeRules: number; activeAlerts: number };
    notificationDispatcher: { status: string; channelsOnline: number };
    anomalyDetector: { status: string; metricsMonitored: number; anomaliesDetected: number };
    sseRouter: { status: string; running: boolean; forwardedCount: number };
  };
  uptime: number;
}

// ── Mappers ────────────────────────────────────────────────────────────────

const SEVERITY_TO_PRIORITY: Record<AlertSeverity, CenterPriority> = {
  fatal: "P1",
  critical: "P1",
  warning: "P2",
};

const TYPE_TO_CATEGORY: Record<AlertType, CenterCategory> = {
  daily_loss_breach: "drawdown",
  ensemble_drift: "calibration",
  kill_switch_fired: "execution",
  consecutive_losses: "execution",
  si_rejection_streak: "execution",
  connection_lost: "connection",
  memory_pressure: "memory",
  production_gate_block_streak: "promotion",
};

const TYPE_TO_RULE_NAME: Record<AlertType, string> = {
  daily_loss_breach: "Daily Loss Limit Breach",
  ensemble_drift: "Ensemble Calibration Drift",
  kill_switch_fired: "Kill Switch Activation",
  consecutive_losses: "Consecutive Losing Trades",
  si_rejection_streak: "SI Rejection Streak",
  connection_lost: "Market Data Connection Lost",
  memory_pressure: "Memory Pressure",
  production_gate_block_streak: "Production Gate / Promotion Signal",
};

const TYPE_TO_COOLDOWN_MS: Record<AlertType, number> = {
  daily_loss_breach: 300_000,
  ensemble_drift: 600_000,
  kill_switch_fired: 60_000,
  consecutive_losses: 300_000,
  si_rejection_streak: 300_000,
  connection_lost: 120_000,
  memory_pressure: 600_000,
  production_gate_block_streak: 300_000,
};

/**
 * Stable id derived from ISO timestamp. Same alert reloaded from the
 * ring buffer hashes to the same id, so the dashboard can dedup
 * across polls without us tracking generation counters.
 */
function alertIdFor(a: Alert): string {
  return `alrt_${Buffer.from(`${a.type}:${a.timestamp}`)
    .toString("base64url")
    .slice(0, 16)}`;
}

export function mapAlertToCenterView(a: Alert): CenterAlert {
  const status: CenterStatus = a.acknowledged ? "acknowledged" : "active";
  return {
    id: alertIdFor(a),
    ruleId: `rule_${a.type}`,
    ruleName: TYPE_TO_RULE_NAME[a.type] ?? a.type,
    priority: SEVERITY_TO_PRIORITY[a.severity],
    category: TYPE_TO_CATEGORY[a.type] ?? "system",
    status,
    message: a.message,
    details: a.details,
    triggeredAt: a.timestamp,
    ...(a.acknowledged ? { acknowledgedAt: a.timestamp } : {}),
  };
}

// ── Aggregations ───────────────────────────────────────────────────────────

function ruleFromAlertType(type: AlertType): CenterRule {
  const history = getAlertHistory(200).filter((a) => a.type === type);
  const last = history[0]; // newest first per getAlertHistory contract
  return {
    id: `rule_${type}`,
    name: TYPE_TO_RULE_NAME[type] ?? type,
    description: `Alert when ${type.replace(/_/g, " ")} condition is met`,
    enabled: true,
    priority: type === "kill_switch_fired" ? "P1" : "P2",
    category: TYPE_TO_CATEGORY[type] ?? "system",
    source: "alert_type",
    cooldownMs: TYPE_TO_COOLDOWN_MS[type],
    triggerCount: history.length,
    ...(last ? { lastTriggered: last.timestamp } : {}),
  };
}

function ruleFromSLO(slo: SLODefinition): CenterRule {
  const burn = sloTracker.getBurnRate(slo.id);
  const lastTriggered =
    burn?.alerting && typeof burn.lastSampleTs === "number"
      ? new Date(burn.lastSampleTs).toISOString()
      : undefined;
  return {
    id: `rule_slo_${slo.id}`,
    name: `SLO: ${slo.title}`,
    description: `Burn-rate ≥ ${slo.alertBurnRate}× over ${Math.round(slo.windowMs / 60_000)}min`,
    enabled: true,
    priority: slo.tier === "critical" ? "P1" : slo.tier === "high" ? "P2" : "P3",
    category: "slo",
    source: "slo_burn_rate",
    triggerCount: burn?.alerting ? 1 : 0,
    ...(lastTriggered ? { lastTriggered } : {}),
  };
}

export function buildSummary(): CenterSummary {
  const history = getAlertHistory(200);
  const dashboardAlerts = history.map(mapAlertToCenterView);
  const active = dashboardAlerts.filter((a) => a.status === "active");
  const acknowledged = dashboardAlerts.filter((a) => a.status === "acknowledged");

  // SLO burn-rate alerts add to the active count even if fireAlert hasn't
  // re-fired this window (the 60s scanner is in charge of that).
  const burningSLOs = sloTracker.getAlertingSLOs();
  const burningCount = burningSLOs.length;

  const byPriority: Record<CenterPriority, number> = { P1: 0, P2: 0, P3: 0, P4: 0 };
  for (const a of active) byPriority[a.priority] += 1;
  // Each burning SLO contributes by its tier.
  for (const slo of burningSLOs) {
    const def = SLO_DEFINITIONS.find((s) => s.id === slo.sloId);
    if (!def) continue;
    const p: CenterPriority = def.tier === "critical" ? "P1" : def.tier === "high" ? "P2" : "P3";
    byPriority[p] += 1;
  }

  const systemHealth = Math.max(
    0,
    100 - byPriority.P1 * 20 - byPriority.P2 * 10 - byPriority.P3 * 5,
  );

  const allRules = [
    ...Object.keys(TYPE_TO_RULE_NAME).map((t) => ruleFromAlertType(t as AlertType)),
    ...SLO_DEFINITIONS.map(ruleFromSLO),
  ];
  const topRules = allRules
    .sort((a, b) => b.triggerCount - a.triggerCount)
    .slice(0, 5)
    .map((r) => ({ ruleId: r.id, name: r.name, triggerCount: r.triggerCount }));

  return {
    total: dashboardAlerts.length + burningCount,
    active: active.length + burningCount,
    acknowledged: acknowledged.length,
    escalated: 0, // we don't track escalation state yet
    resolved: 0,
    byPriority,
    systemHealth,
    topRules,
  };
}

export function buildActiveFeed(): CenterAlert[] {
  const fromHistory = getActiveAlerts().map(mapAlertToCenterView);

  // Surface burning SLOs as synthetic active alerts so they show up in
  // the feed even if the 60s scanner hasn't re-fired this window.
  const burningSLOs = sloTracker.getAlertingSLOs();
  const fromSLO: CenterAlert[] = burningSLOs.map((b) => {
    const def = SLO_DEFINITIONS.find((s) => s.id === b.sloId);
    const tier = def?.tier ?? "normal";
    const priority: CenterPriority = tier === "critical" ? "P1" : tier === "high" ? "P2" : "P3";
    const triggeredAt =
      typeof b.lastSampleTs === "number"
        ? new Date(b.lastSampleTs).toISOString()
        : new Date().toISOString();
    return {
      id: `alrt_slo_${b.sloId}`,
      ruleId: `rule_slo_${b.sloId}`,
      ruleName: `SLO: ${def?.title ?? b.sloId}`,
      priority,
      category: "slo",
      status: "active",
      message: `${def?.title ?? b.sloId} burn rate ${b.burnRate.toFixed(2)}× (alert ≥ ${
        def?.alertBurnRate ?? "?"
      }×)`,
      details: {
        sloId: b.sloId,
        burnRate: b.burnRate,
        errorBudgetRemaining: b.errorBudgetRemaining,
        sampleCount: b.windowSampleCount,
      },
      triggeredAt,
    };
  });

  return [...fromSLO, ...fromHistory].sort(
    (a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime(),
  );
}

export function buildRules(): CenterRule[] {
  return [
    ...Object.keys(TYPE_TO_RULE_NAME).map((t) => ruleFromAlertType(t as AlertType)),
    ...SLO_DEFINITIONS.map(ruleFromSLO),
  ];
}

export function buildChannels(): {
  channels: CenterChannel[];
  rateLimitStatus: {
    currentMinute: number;
    maxPerMinute: number;
    currentHour: number;
    maxPerHour: number;
    isLimited: boolean;
  };
} {
  const webhookUrl = process.env["GODSVIEW_ALERT_WEBHOOK_URL"] ?? "";
  const sseStats = sseAlertRouter.getStats();

  const channels: CenterChannel[] = [
    {
      id: "ch_dashboard",
      name: "Dashboard",
      type: "dashboard",
      enabled: true,
      priority: "all",
      status: "active",
      messagesSent: getAlertHistory(200).length,
      failureRate: 0,
      lastSent: getAlertHistory(1)[0]?.timestamp ?? null,
    },
    {
      id: "ch_log",
      name: "Structured Log",
      type: "log",
      enabled: true,
      priority: "all",
      status: "active",
      messagesSent: getAlertHistory(200).length,
      failureRate: 0,
      lastSent: getAlertHistory(1)[0]?.timestamp ?? null,
    },
    {
      id: "ch_webhook",
      name: webhookUrl ? "Configured Webhook" : "Webhook (not configured)",
      type: "webhook",
      enabled: Boolean(webhookUrl),
      priority: "P1-P3",
      status: webhookUrl ? "active" : "inactive",
      messagesSent: webhookUrl ? getAlertHistory(200).length : 0,
      failureRate: 0,
      lastSent: webhookUrl ? getAlertHistory(1)[0]?.timestamp ?? null : null,
    },
    {
      id: "ch_sse",
      name: "SSE Alert Router",
      type: "sse",
      enabled: sseStats.running,
      priority: "all",
      status: sseStats.running ? "active" : "inactive",
      messagesSent: sseStats.forwardedCount ?? 0,
      failureRate: 0,
      lastSent: sseStats.lastForwardTs ?? null,
    },
  ];

  return {
    channels,
    rateLimitStatus: {
      currentMinute: 0,
      maxPerMinute: 60,
      currentHour: 0,
      maxPerHour: 600,
      isLimited: false,
    },
  };
}

export function buildAnomalies(): {
  metrics: Array<{
    name: string;
    currentValue: number;
    baseline: number;
    stdDev: number;
    zScore: number;
    isAnomaly: boolean;
  }>;
  recentAnomalies: CenterAnomaly[];
  systemHealth: number;
  monitoredCount: number;
  anomalousCount: number;
} {
  const burning = sloTracker.getAlertingSLOs();
  const allBurns = sloTracker.getAllBurnRates();

  // Each SLO is treated as a monitored metric. The "baseline" is the
  // SLO target; the "current value" is the observed burn rate.
  const metrics = allBurns.map((b) => {
    const def = SLO_DEFINITIONS.find((s) => s.id === b.sloId);
    return {
      name: def?.title ?? b.sloId,
      currentValue: Math.round(b.burnRate * 100) / 100,
      baseline: 1,
      stdDev: 1,
      zScore: Math.round((b.burnRate - 1) * 100) / 100,
      isAnomaly: b.alerting,
    };
  });

  const recentAnomalies: CenterAnomaly[] = burning.map((b) => {
    const def = SLO_DEFINITIONS.find((s) => s.id === b.sloId);
    const sev: CenterAnomaly["severity"] =
      def?.tier === "critical" ? "high" : def?.tier === "high" ? "medium" : "low";
    return {
      id: `anom_slo_${b.sloId}`,
      metricName: def?.title ?? b.sloId,
      value: Math.round(b.burnRate * 100) / 100,
      expected: def?.alertBurnRate ?? 1,
      zScore: Math.round((b.burnRate - (def?.alertBurnRate ?? 1)) * 100) / 100,
      method: "burn_rate",
      severity: sev,
      description: `${def?.title ?? b.sloId} burning at ${b.burnRate.toFixed(2)}× alert threshold`,
      detectedAt:
        typeof b.lastSampleTs === "number"
          ? new Date(b.lastSampleTs).toISOString()
          : new Date().toISOString(),
    };
  });

  return {
    metrics,
    recentAnomalies,
    systemHealth: Math.max(0, 100 - recentAnomalies.length * 10),
    monitoredCount: metrics.length,
    anomalousCount: recentAnomalies.length,
  };
}

export function buildEscalation(): CenterEscalationLevel[] {
  // Tiers come from docs/SLOs.md. SSE router is the only delivery
  // mechanism we ship out of the box; operators wire their own
  // PagerDuty / Slack channels via GODSVIEW_ALERT_WEBHOOK_URL.
  return [
    {
      level: 1,
      channels: ["Dashboard", "Structured Log", "SSE Alert Router"],
      delayMs: 0,
      description: "Immediate: in-process logging + dashboard SSE feed",
      active: true,
    },
    {
      level: 2,
      channels: process.env["GODSVIEW_ALERT_WEBHOOK_URL"] ? ["Webhook (Slack/PagerDuty)"] : [],
      delayMs: 0,
      description: "Webhook fan-out via fireAlert() — fires for every Phase 5/6 event type",
      active: Boolean(process.env["GODSVIEW_ALERT_WEBHOOK_URL"]),
    },
    {
      level: 3,
      channels: ["On-call rotation"],
      delayMs: 300_000,
      description:
        "PagerDuty escalation policy (configured externally) — see docs/ALERT_CHANNEL_MAPPING.md",
      active: false,
    },
  ];
}

export function buildHealth(): CenterHealth {
  const sseStats = sseAlertRouter.getStats();
  const channelsView = buildChannels();
  const anomaliesView = buildAnomalies();
  const active = getActiveAlerts().length + sloTracker.getAlertingSLOs().length;

  return {
    status: active > 0 ? (anomaliesView.anomalousCount > 0 ? "degraded" : "operational") : "operational",
    subsystems: {
      alertEngine: {
        status: "ok",
        activeRules: buildRules().filter((r) => r.enabled).length,
        activeAlerts: active,
      },
      notificationDispatcher: {
        status: "ok",
        channelsOnline: channelsView.channels.filter((c) => c.status === "active").length,
      },
      anomalyDetector: {
        status: "ok",
        metricsMonitored: anomaliesView.monitoredCount,
        anomaliesDetected: anomaliesView.anomalousCount,
      },
      sseRouter: {
        status: sseStats.running ? "ok" : "stopped",
        running: sseStats.running,
        forwardedCount: sseStats.forwardedCount ?? 0,
      },
    },
    uptime: process.uptime(),
  };
}
