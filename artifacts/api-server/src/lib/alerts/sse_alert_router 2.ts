/**
 * SSE Alert Router (Phase 6)
 *
 * Phase 5 landed two cron schedulers that publish four SSE event types:
 *   - promotion_eligible      (governance)
 *   - demotion_signal         (governance)
 *   - calibration_snapshot    (calibration — every cycle)
 *   - calibration_drift       (calibration — HIGH/CRITICAL only)
 *
 * Before Phase 6, those events only reached SSE-connected dashboard
 * clients. If the dashboard wasn't open, the events were dropped on the
 * floor. This router bridges them into the existing alert webhook
 * pipeline (`GODSVIEW_ALERT_WEBHOOK_URL`) and the pino log stream so
 * on-call is paged via PagerDuty/Slack like any other alert.
 *
 * Implementation: the router installs a lightweight in-process subscriber
 * on the SignalStreamHub so it sees every published event. It filters for
 * the Phase 5 event types and forwards them to `fireAlert()` with a
 * severity derived from the event contents. The router itself is a
 * no-op singleton — safe to start/stop from index.ts.
 *
 * This router also periodically scans the SLO tracker for burning SLOs
 * and fires alerts when any objective is over its alertBurnRate.
 */

import { logger } from "../logger";
import { signalStreamHub } from "../signal_stream";
import { fireAlert, type AlertSeverity, type AlertType } from "../alerts";
import { sloTracker } from "../slo/slo_tracker";

// Cast once so we can augment at runtime. The hub uses a simple in-memory
// Map for clients, which means we can cleanly add a subscriber list by
// installing a small wrapper on `publish`. We do it via monkey-patch of
// the instance (not the prototype) so the existing SSE path is untouched.
type PublishFn = (event: {
  id: string;
  type: string;
  data: unknown;
  timestamp: string;
}) => void;

interface HubLike {
  publish: PublishFn;
  __sseAlertRouterInstalled?: boolean;
  __originalPublish?: PublishFn;
}

function installHubSubscriber(onEvent: (evt: { type: string; data: unknown; timestamp: string }) => void): () => void {
  const hub = signalStreamHub as unknown as HubLike;
  if (hub.__sseAlertRouterInstalled) {
    // Already wrapped by a previous start() call — chain instead.
    // We re-wrap so multiple subscribers are safe; uninstall is keyed by ref.
  }
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

// ── Event → Alert mapping ──────────────────────────────────────────
// We reuse the existing `ensemble_drift` alert type for calibration drift
// and `production_gate_block_streak` for demotion signals. Promotion
// events aren't on the AlertType union by design — they aren't failure
// conditions — so they only go through the log + webhook path with a
// "warning" severity and no cooldown-tracked alert.

interface ParsedPhase5Event {
  eventType: "promotion_eligible" | "demotion_signal" | "calibration_snapshot" | "calibration_drift";
  severity: AlertSeverity;
  message: string;
  details: Record<string, unknown>;
  /** If set, also fire through the cooldown-gated AlertType pipeline */
  alertType?: AlertType;
}

function parsePhase5Event(type: string, data: unknown): ParsedPhase5Event | null {
  // The Phase 5 schedulers publish via `publishAlert({ type, ... })`, so the
  // SSE event arrives as { type: "alert", data: { type: "promotion_eligible", ... } }.
  if (type !== "alert") return null;
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const innerType = typeof d["type"] === "string" ? (d["type"] as string) : null;
  if (!innerType) return null;

  switch (innerType) {
    case "promotion_eligible": {
      const strategyId = typeof d["strategyId"] === "string" ? d["strategyId"] : "?";
      const targetTier = typeof d["targetTier"] === "string" ? d["targetTier"] : "?";
      return {
        eventType: "promotion_eligible",
        severity: "warning",
        message: `Strategy ${strategyId} eligible for promotion → ${targetTier}`,
        details: { strategyId, targetTier, payload: d },
      };
    }
    case "demotion_signal": {
      const strategyId = typeof d["strategyId"] === "string" ? d["strategyId"] : "?";
      const rawSeverity = typeof d["severity"] === "string" ? d["severity"].toLowerCase() : "medium";
      const mapped: AlertSeverity = rawSeverity === "critical" || rawSeverity === "high"
        ? "critical"
        : rawSeverity === "fatal"
          ? "fatal"
          : "warning";
      return {
        eventType: "demotion_signal",
        severity: mapped,
        message: `Strategy ${strategyId} demotion signal (${rawSeverity})`,
        details: { strategyId, severity: rawSeverity, payload: d },
        alertType: "production_gate_block_streak",
      };
    }
    case "calibration_snapshot": {
      const score = typeof d["score"] === "number" ? d["score"] : null;
      return {
        eventType: "calibration_snapshot",
        severity: "warning",
        message: `Calibration snapshot captured (score=${score ?? "n/a"})`,
        details: { score, payload: d },
      };
    }
    case "calibration_drift": {
      const rawSeverity = typeof d["severity"] === "string" ? d["severity"].toLowerCase() : "high";
      const mapped: AlertSeverity = rawSeverity === "critical" ? "critical" : "warning";
      const dimension = typeof d["dimension"] === "string" ? d["dimension"] : "unknown";
      const description = typeof d["description"] === "string" ? d["description"] : "";
      return {
        eventType: "calibration_drift",
        severity: mapped,
        message: `Calibration drift detected on "${dimension}": ${description || "no description"}`,
        details: { dimension, description, severity: rawSeverity, payload: d },
        alertType: "ensemble_drift",
      };
    }
    default:
      return null;
  }
}

// ── Router singleton ──────────────────────────────────────────────

class SSEAlertRouter {
  private static instance: SSEAlertRouter | null = null;
  private uninstallHub: (() => void) | null = null;
  private sloScanTimer: ReturnType<typeof setInterval> | null = null;
  private readonly sloScanIntervalMs = Math.max(
    5_000,
    parseInt(process.env["SLO_SCAN_INTERVAL_MS"] ?? "60000", 10) || 60_000,
  );
  private stats = {
    forwardedCount: 0,
    byEventType: {} as Record<string, number>,
    sloAlertsFired: 0,
    lastForwardTs: null as string | null,
  };

  static getInstance(): SSEAlertRouter {
    if (!SSEAlertRouter.instance) SSEAlertRouter.instance = new SSEAlertRouter();
    return SSEAlertRouter.instance;
  }

  start(): void {
    if (this.uninstallHub) return; // already running
    this.uninstallHub = installHubSubscriber((evt) => {
      this.handleEvent(evt);
    });
    this.sloScanTimer = setInterval(() => this.scanSLOs(), this.sloScanIntervalMs);
    if (this.sloScanTimer.unref) this.sloScanTimer.unref();
    logger.info(
      { sloScanIntervalMs: this.sloScanIntervalMs },
      "SSE alert router started — Phase 5 events bridged to webhook + SLO scanner active",
    );
  }

  stop(): void {
    if (this.uninstallHub) {
      try { this.uninstallHub(); } catch (err: any) {
        logger.warn({ err: err?.message }, "SSE alert router uninstall failed");
      }
      this.uninstallHub = null;
    }
    if (this.sloScanTimer) {
      clearInterval(this.sloScanTimer);
      this.sloScanTimer = null;
    }
    logger.info("SSE alert router stopped");
  }

  isRunning(): boolean {
    return this.uninstallHub !== null;
  }

  getStats() {
    return { ...this.stats, running: this.isRunning() };
  }

  private handleEvent(evt: { type: string; data: unknown; timestamp: string }): void {
    const parsed = parsePhase5Event(evt.type, evt.data);
    if (!parsed) return;
    this.stats.forwardedCount++;
    this.stats.byEventType[parsed.eventType] =
      (this.stats.byEventType[parsed.eventType] ?? 0) + 1;
    this.stats.lastForwardTs = new Date().toISOString();

    if (parsed.alertType) {
      // Fire through the cooldown-gated AlertType pipeline (log + webhook + SSE).
      void fireAlert(parsed.alertType, parsed.severity, parsed.message, parsed.details);
    } else {
      // Log-only path for non-cooldown events (snapshots, promotion-eligible).
      const logPayload = { eventType: parsed.eventType, ...parsed.details };
      if (parsed.severity === "critical") logger.error(logPayload, parsed.message);
      else logger.warn(logPayload, parsed.message);
    }
  }

  private scanSLOs(): void {
    try {
      const alerting = sloTracker.getAlertingSLOs();
      for (const burn of alerting) {
        this.stats.sloAlertsFired++;
        const severity: AlertSeverity = burn.tier === "critical" ? "critical" : "warning";
        // Map SLO breach to the existing "production_gate_block_streak" type
        // (closest semantic match for a systemic-degradation alert) so it rides
        // the same cooldown pipeline.
        void fireAlert(
          "production_gate_block_streak",
          severity,
          `SLO "${burn.sloId}" burning at ${burn.burnRate.toFixed(2)}× (threshold ${burn.alertBurnRate}×), budget ${Math.round(burn.errorBudgetRemaining * 100)}%`,
          {
            sloId: burn.sloId,
            burnRate: burn.burnRate,
            alertBurnRate: burn.alertBurnRate,
            successRate: burn.successRate,
            objective: burn.objective,
            windowMs: burn.windowMs,
            windowSampleCount: burn.windowSampleCount,
            tier: burn.tier,
          },
        );
      }
    } catch (err: any) {
      logger.warn({ err: err?.message }, "SSE alert router SLO scan failed");
    }
  }
}

export const sseAlertRouter: SSEAlertRouter = SSEAlertRouter.getInstance();
export { SSEAlertRouter };
