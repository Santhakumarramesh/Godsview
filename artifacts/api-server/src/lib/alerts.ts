/**
 * Alert Engine — Monitors critical trading conditions and fires
 * webhook/log notifications when thresholds are breached.
 *
 * Alert channels:
 * 1. Logger (always) — pino structured logs at "warn" or "fatal"
 * 2. Webhook (optional) — POST to GODSVIEW_ALERT_WEBHOOK_URL
 * 3. SSE broadcast — pushes to connected dashboard clients
 *
 * Alert types:
 * - daily_loss_breach   — Daily P&L exceeds configured limit
 * - ensemble_drift      — Model accuracy drops below threshold
 * - kill_switch_fired   — Trading kill switch activated
 * - consecutive_losses  — N consecutive losing trades
 * - si_rejection_streak — SI blocks N signals in a row
 * - connection_lost     — Alpaca/market data feed disconnected
 * - memory_pressure     — RSS exceeds configured threshold
 */

import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────
export type AlertSeverity = "warning" | "critical" | "fatal";

export type AlertType =
  | "daily_loss_breach"
  | "ensemble_drift"
  | "kill_switch_fired"
  | "consecutive_losses"
  | "si_rejection_streak"
  | "connection_lost"
  | "memory_pressure"
  | "production_gate_block_streak";

export interface Alert {
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  timestamp: string;
  acknowledged: boolean;
}

// ── State ──────────────────────────────────────────────────────────

const WEBHOOK_URL = process.env["GODSVIEW_ALERT_WEBHOOK_URL"] ?? "";
const ALERT_HISTORY_MAX = 200;
const alertHistory: Alert[] = [];
const cooldowns = new Map<AlertType, number>();
// Cooldown per alert type (ms) to prevent alert storms
const COOLDOWN_MS: Record<AlertType, number> = {
  daily_loss_breach: 300_000,     // 5 min
  ensemble_drift: 600_000,        // 10 min
  kill_switch_fired: 60_000,      // 1 min
  consecutive_losses: 300_000,    // 5 min
  si_rejection_streak: 300_000,   // 5 min
  connection_lost: 120_000,       // 2 min
  memory_pressure: 600_000,       // 10 min
  production_gate_block_streak: 300_000,
};

// ── Core Alert Function ────────────────────────────────────────────

export async function fireAlert(
  type: AlertType,
  severity: AlertSeverity,
  message: string,
  details: Record<string, unknown> = {},
): Promise<void> {
  // Check cooldown
  const now = Date.now();
  const lastFired = cooldowns.get(type) ?? 0;
  if (now - lastFired < COOLDOWN_MS[type]) return;
  cooldowns.set(type, now);

  const alert: Alert = {
    type,
    severity,
    message,
    details,    timestamp: new Date().toISOString(),
    acknowledged: false,
  };

  // Store in history (ring buffer)
  alertHistory.push(alert);
  if (alertHistory.length > ALERT_HISTORY_MAX) {
    alertHistory.shift();
  }

  // Log at appropriate level
  const logPayload = { alertType: type, severity, ...details };
  if (severity === "fatal") {
    logger.fatal(logPayload, `ALERT: ${message}`);
  } else if (severity === "critical") {
    logger.error(logPayload, `ALERT: ${message}`);
  } else {
    logger.warn(logPayload, `ALERT: ${message}`);
  }

  // Broadcast to SSE clients
  try {
    const { broadcast } = await import("./signal_stream");
    broadcast({
      type: "si_decision",
      data: {
        symbol: "SYSTEM",
        setup_type: "alert",
        direction: "long" as const,        approved: false,
        win_probability: 0,
        edge_score: 0,
        enhanced_quality: 0,
        kelly_pct: 0,
        regime: "alert",
        rejection_reason: `[${severity.toUpperCase()}] ${message}`,
        timestamp: new Date().toISOString(),
      },
    });
  } catch { /* SSE not loaded yet */ }

  // Fire webhook (non-blocking)
  if (WEBHOOK_URL) {
    sendWebhook(alert).catch((e) => logger.debug({ err: e }, "[Alerts] webhook delivery failed"));
  }
}

// ── Webhook Delivery ───────────────────────────────────────────────

async function sendWebhook(alert: Alert): Promise<void> {
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 *GodsView Alert* [${alert.severity.toUpperCase()}]\n${alert.message}`,
        alert,      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status, alertType: alert.type }, "Alert webhook delivery failed");
    }
  } catch (err) {
    logger.warn({ err, alertType: alert.type }, "Alert webhook unreachable");
  }
}

// ── Convenience Alert Triggers ─────────────────────────────────────

/** Fire when daily P&L breaches the configured limit */
export function alertDailyLossBreach(currentPnl: number, limit: number): void {
  fireAlert("daily_loss_breach", "critical",
    `Daily loss $${Math.abs(currentPnl).toFixed(2)} exceeds limit $${limit}`,
    { currentPnl, limit });
}

/** Fire when ensemble model accuracy drifts below threshold */
export function alertEnsembleDrift(accuracy: number, threshold = 0.52): void {
  if (accuracy < threshold) {
    fireAlert("ensemble_drift", "warning",
      `Ensemble accuracy ${(accuracy * 100).toFixed(1)}% below ${(threshold * 100).toFixed(0)}% threshold`,
      { accuracy, threshold });
  }
}
/** Fire when kill switch is activated */
export function alertKillSwitch(reason: string, actor: string): void {
  fireAlert("kill_switch_fired", "fatal",
    `Kill switch activated by ${actor}: ${reason}`,
    { reason, actor });
}

/** Fire after N consecutive losing trades */
export function alertConsecutiveLosses(count: number, threshold = 3): void {
  if (count >= threshold) {
    fireAlert("consecutive_losses", "critical",
      `${count} consecutive losing trades`,
      { count, threshold });
  }
}

/** Fire after N consecutive SI rejections */
export function alertSIRejectionStreak(count: number, threshold = 10): void {
  if (count >= threshold) {
    fireAlert("si_rejection_streak", "warning",
      `${count} consecutive signals rejected by Super Intelligence`,
      { count, threshold });
  }
}

/** Fire on memory pressure */
export function checkMemoryPressure(thresholdMB = 512): void {
  const rssMB = Math.round(process.memoryUsage.rss() / 1024 / 1024);
  if (rssMB > thresholdMB) {    fireAlert("memory_pressure", "warning",
      `Memory usage ${rssMB}MB exceeds ${thresholdMB}MB threshold`,
      { rssMB, thresholdMB });
  }
}

// ── Query API ──────────────────────────────────────────────────────

/** Get recent alerts (newest first) */
export function getAlertHistory(limit = 50): Alert[] {
  return alertHistory.slice(-limit).reverse();
}

/** Get unacknowledged alerts */
export function getActiveAlerts(): Alert[] {
  return alertHistory.filter((a) => !a.acknowledged).reverse();
}

/** Acknowledge an alert by index */
export function acknowledgeAlert(timestamp: string): boolean {
  const alert = alertHistory.find((a) => a.timestamp === timestamp);
  if (alert) {
    alert.acknowledged = true;
    return true;
  }
  return false;
}

// ── Background Monitor ─────────────────────────────────────────────

const MONITOR_INTERVAL_MS = 60_000; // Check every 60s
const monitorTimer = setInterval(() => {
  checkMemoryPressure();
}, MONITOR_INTERVAL_MS);
monitorTimer.unref();