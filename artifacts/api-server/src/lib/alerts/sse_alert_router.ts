/**
 * SSE Alert Router (Phase 6) — Bridges Phase 5 SSE events into the alert
 * webhook pipeline and scans SLO tracker for burning objectives.
 */

import { logger } from "../logger";
import { signalStreamHub } from "../signal_stream";
import { fireAlert, type AlertSeverity, type AlertType } from "../alerts";
import { sloTracker } from "../slo/slo_tracker";

type PublishFn = (event: { id: string; type: string; data: unknown; timestamp: string }) => void;

interface HubLike {
  publish: PublishFn;
  __sseAlertRouterInstalled?: boolean;
  __originalPublish?: PublishFn;
}

function installHubSubscriber(onEvent: (evt: { type: string; data: unknown; timestamp: string }) => void): () => void {
  const hub = signalStreamHub as unknown as HubLike;
  const original = hub.__originalPublish ?? hub.publish.bind(hub);
  hub.__originalPublish = original;
  const wrapped: PublishFn = (event) => {
    try { original(event); } finally {
      try { onEvent({ type: event.type, data: event.data, timestamp: event.timestamp }); }
      catch (err: any) { logger.warn({ err: err?.message }, "SSE alert router subscriber failed"); }
    }
  };
  hub.publish = wrapped;
  hub.__sseAlertRouterInstalled = true;
  return () => {
    hub.publish = original;
    hub.__sseAlertRouterInstalled = false;
    delete hub.__originalPublish;
  };
}
interface ParsedPhase5Event {
  eventType: string; severity: AlertSeverity;
  message: string; details: Record<string, unknown>;
  alertType?: AlertType;
}

function parsePhase5Event(type: string, data: unknown): ParsedPhase5Event | null {
  if (type !== "alert") return null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const innerType = typeof d["type"] === "string" ? (d["type"] as string) : null;
  if (!innerType) return null;
  switch (innerType) {
    case "promotion_eligible": {
      const sid = typeof d["strategyId"] === "string" ? d["strategyId"] : "?";
      const tt = typeof d["targetTier"] === "string" ? d["targetTier"] : "?";
      return { eventType: "promotion_eligible", severity: "warning",
        message: `Strategy ${sid} eligible for promotion → ${tt}`, details: { strategyId: sid, targetTier: tt, payload: d } };
    }
    case "demotion_signal": {
      const sid = typeof d["strategyId"] === "string" ? d["strategyId"] : "?";
      const rs = typeof d["severity"] === "string" ? d["severity"].toLowerCase() : "medium";
      const mapped: AlertSeverity = rs === "critical" || rs === "high" ? "critical" : rs === "fatal" ? "fatal" : "warning";
      return { eventType: "demotion_signal", severity: mapped,
        message: `Strategy ${sid} demotion signal (${rs})`, details: { strategyId: sid, severity: rs, payload: d },
        alertType: "production_gate_block_streak" };
    }
    case "calibration_snapshot": {
      const score = typeof d["score"] === "number" ? d["score"] : null;
      return { eventType: "calibration_snapshot", severity: "warning",
        message: `Calibration snapshot captured (score=${score ?? "n/a"})`, details: { score, payload: d } };
    }
    case "calibration_drift": {
      const rs = typeof d["severity"] === "string" ? d["severity"].toLowerCase() : "high";
      const mapped: AlertSeverity = rs === "critical" ? "critical" : "warning";
      const dim = typeof d["dimension"] === "string" ? d["dimension"] : "unknown";
      const desc = typeof d["description"] === "string" ? d["description"] : "";
      return { eventType: "calibration_drift", severity: mapped,
        message: `Calibration drift on "${dim}": ${desc || "no description"}`, details: { dimension: dim, description: desc, payload: d },
        alertType: "ensemble_drift" };
    }
    default: return null;
  }
}
class SSEAlertRouter {
  private static instance: SSEAlertRouter | null = null;
  private uninstallHub: (() => void) | null = null;
  private sloScanTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sloScanIntervalMs = Math.max(
    5_000, parseInt(process.env["SLO_SCAN_INTERVAL_MS"] ?? "60000", 10) || 60_000,
  );
  private stats = {
    forwardedCount: 0, byEventType: {} as Record<string, number>,
    sloAlertsFired: 0, lastForwardTs: null as string | null,
  };

  static getInstance(): SSEAlertRouter {
    if (!SSEAlertRouter.instance) SSEAlertRouter.instance = new SSEAlertRouter();
    return SSEAlertRouter.instance;
  }

  start(): void {
    if (this.uninstallHub) return;
    this.uninstallHub = installHubSubscriber((evt) => this.handleEvent(evt));
    this.sloScanTimer = setInterval(() => this.scanSLOs(), this.sloScanIntervalMs);
    if (this.sloScanTimer.unref) this.sloScanTimer.unref();
    logger.info({ sloScanIntervalMs: this.sloScanIntervalMs },
      "SSE alert router started — Phase 5 events bridged + SLO scanner active");
  }

  stop(): void {
    if (this.uninstallHub) {
      try { this.uninstallHub(); } catch (err: any) {}
      this.uninstallHub = null;
    }
    if (this.sloScanTimer) { clearInterval(this.sloScanTimer); this.sloScanTimer = null; }
  }

  isRunning(): boolean { return this.uninstallHub !== null; }
  getStats() { return { ...this.stats, running: this.isRunning() }; }

  private handleEvent(evt: { type: string; data: unknown; timestamp: string }): void {
    const parsed = parsePhase5Event(evt.type, evt.data);
    if (!parsed) return;
    this.stats.forwardedCount++;
    this.stats.byEventType[parsed.eventType] = (this.stats.byEventType[parsed.eventType] ?? 0) + 1;
    this.stats.lastForwardTs = new Date().toISOString();
    if (parsed.alertType) {
      void fireAlert(parsed.alertType, parsed.severity, parsed.message, parsed.details);
    }
  }

  private scanSLOs(): void {
    try {
      const alerting = sloTracker.getAlertingSLOs();
      for (const burn of alerting) {
        this.stats.sloAlertsFired++;
        const severity: AlertSeverity = burn.tier === "critical" ? "critical" : "warning";
        void fireAlert("production_gate_block_streak", severity,
          `SLO "${burn.sloId}" burning at ${burn.burnRate.toFixed(2)}x (threshold ${burn.alertBurnRate}x)`,
          { sloId: burn.sloId, burnRate: burn.burnRate, alertBurnRate: burn.alertBurnRate,
            successRate: burn.successRate, objective: burn.objective, tier: burn.tier });
      }
    } catch (err: any) {
      logger.warn({ err: err?.message }, "SSE alert router SLO scan failed");
    }
  }
}

export const sseAlertRouter: SSEAlertRouter = SSEAlertRouter.getInstance();
export { SSEAlertRouter };
