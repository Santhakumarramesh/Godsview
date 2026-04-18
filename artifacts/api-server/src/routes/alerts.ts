/**
 * Alert & Execution API Routes
 *
 * Internal-shape endpoints (used by other api-server callers and tests):
 *   GET  /alerts              — Recent alert history (wrapped {alerts})
 *   GET  /alerts/active       — Unacknowledged alerts only (wrapped {alerts})
 *   POST /alerts/:ts/ack      — Acknowledge by ISO timestamp
 *
 * Alert Center dashboard endpoints (Phase 8 — wired to real state, no mocks):
 *   GET  /alerts/summary      — Totals + priority counts + system health
 *   GET  /alerts/active-feed  — Active alert array (CenterAlert shape)
 *   GET  /alerts/rules        — Per-type + per-SLO rule listing
 *   GET  /alerts/channels     — Delivery channels with real status
 *   GET  /alerts/anomalies    — Burn-rate metrics + recent anomalies
 *   GET  /alerts/escalation   — Escalation tier listing
 *   GET  /alerts/health       — Alert engine / dispatcher / router health
 *   POST /alerts/acknowledge  — Body-based alias: { timestamp }
 *   POST /alerts/resolve      — Body-based: { timestamp } → ack + tag resolvedAt
 *
 * Execution endpoints:
 *   GET  /execution/mode      — Current execution mode
 *   GET  /execution/gate      — Production gate stats
 *   GET  /execution/session   — Full session guard status
 */

import { Router, type IRouter } from "express";
import {
  getAlertHistory,
  getActiveAlerts,
  acknowledgeAlert,
} from "../lib/alerts";
import {
  buildSummary,
  buildActiveFeed,
  buildRules,
  buildChannels,
  buildAnomalies,
  buildEscalation,
  buildHealth,
} from "../lib/alerts/alert_center_view";
import { getExecutionMode } from "../lib/order_executor";
import { getProductionGateStats } from "../lib/production_gate";
import { getFullSessionStatus } from "../lib/session_guard";

const router: IRouter = Router();

// ── Internal-shape alert endpoints ───────────────────────────────────

router.get("/alerts", (req, res) => {
  const limit = Math.min(Number(req.query?.limit) || 50, 200);
  res.json({ alerts: getAlertHistory(limit) });
});
router.get("/alerts/active", (_req, res) => {
  res.json({ alerts: getActiveAlerts() });
});

router.post("/alerts/:ts/ack", (req, res) => {
  const ts = String(req.params.ts ?? "");
  if (!ts) {
    res.status(400).json({ error: "Timestamp parameter required" });
    return;
  }
  const acked = acknowledgeAlert(decodeURIComponent(ts));
  if (acked) {
    res.json({ acknowledged: true });
  } else {
    res.status(404).json({ error: "Alert not found" });
  }
});

// ── Alert Center dashboard endpoints (Phase 8) ───────────────────────

router.get("/alerts/summary", (_req, res) => {
  const s = buildSummary();
  // Dashboard expects the flat legacy shape; we keep the richer CenterSummary
  // under `.full` for anyone who wants it, but top-level fields match the
  // AlertSummaryBanner's reads directly.
  res.json({
    totalActive: s.active,
    p1Critical: s.byPriority.P1,
    p2High: s.byPriority.P2,
    acknowledged: s.acknowledged,
    escalated: s.escalated,
    healthScore: s.systemHealth,
    full: s,
  });
});

router.get("/alerts/active-feed", (_req, res) => {
  // Dashboard iterates the response directly (map over array), so return an
  // array at the top level. Each entry is the CenterAlert shape.
  res.json(buildActiveFeed());
});

router.get("/alerts/rules", (_req, res) => {
  // Dashboard reads `rule.name`, `rule.category`, `rule.priority`,
  // `rule.conditions`, `rule.enabled`, `rule.triggerCount`,
  // `rule.lastTriggered`. Our CenterRule carries `description` where the
  // dashboard expects `conditions` — alias it in the response so the page
  // renders without mocks, while still emitting the full CenterRule under
  // a sibling field for downstream consumers.
  const rules = buildRules().map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    priority: r.priority,
    conditions: r.description,
    enabled: r.enabled,
    triggerCount: r.triggerCount,
    lastTriggered: r.lastTriggered ?? null,
    source: r.source,
    cooldownMs: r.cooldownMs ?? null,
  }));
  res.json(rules);
});

router.get("/alerts/channels", (_req, res) => {
  const view = buildChannels();
  // Dashboard iterates the array directly.
  const channels = view.channels.map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    status: c.status,
    messagesSent: c.messagesSent,
    // Dashboard renders as a percentage with `.toFixed(1)`. Our view module
    // records a fraction; multiply by 100 so the rendered value is correct.
    failureRate: c.failureRate * 100,
    lastSent: c.lastSent ?? null,
    priority: c.priority,
    enabled: c.enabled,
  }));
  res.json(channels);
});

router.get("/alerts/anomalies", (_req, res) => {
  const a = buildAnomalies();
  // Dashboard reads `.metrics` (each with `current`, `baseline`, `zScore`,
  // `anomalous`) and `.recent` (each with `severity`, `description`, `time`).
  res.json({
    metrics: a.metrics.map((m, i) => ({
      id: i + 1,
      name: m.name,
      current: m.currentValue,
      baseline: m.baseline,
      zScore: m.zScore,
      anomalous: m.isAnomaly,
    })),
    recent: a.recentAnomalies.map((ra) => ({
      id: ra.id,
      severity:
        ra.severity === "high" ? "Critical" : ra.severity === "medium" ? "High" : "Medium",
      description: ra.description,
      time: ra.detectedAt,
    })),
    systemHealth: a.systemHealth,
    monitoredCount: a.monitoredCount,
    anomalousCount: a.anomalousCount,
  });
});

router.get("/alerts/escalation", (_req, res) => {
  // Dashboard iterates the array directly.
  const levels = buildEscalation().map((l) => ({
    level: l.level,
    channel: l.channels[0] ?? "—",
    channels: l.channels,
    delay: l.delayMs === 0 ? "0m" : `${Math.round(l.delayMs / 60_000)}m`,
    delayMs: l.delayMs,
    description: l.description,
    active: l.active,
  }));
  res.json(levels);
});

router.get("/alerts/health", (_req, res) => {
  res.json(buildHealth());
});

router.post("/alerts/acknowledge", (req, res) => {
  const body = req.body as { timestamp?: string } | undefined;
  const ts = String(body?.timestamp ?? "");
  if (!ts) {
    res.status(400).json({ error: "timestamp body field required" });
    return;
  }
  const acked = acknowledgeAlert(ts);
  if (acked) {
    res.json({ acknowledged: true, timestamp: ts });
  } else {
    res.status(404).json({ error: "Alert not found" });
  }
});

router.post("/alerts/resolve", (req, res) => {
  // Internal Alert buffer has no `resolved` state; semantically we treat
  // resolve as "acknowledged + stamped resolvedAt". Callers that care about
  // the resolution should consume the /alerts/active-feed response, which
  // filters out acknowledged alerts once the Alert Center view is rebuilt.
  const body = req.body as { timestamp?: string } | undefined;
  const ts = String(body?.timestamp ?? "");
  if (!ts) {
    res.status(400).json({ error: "timestamp body field required" });
    return;
  }
  const acked = acknowledgeAlert(ts);
  if (acked) {
    res.json({ resolved: true, timestamp: ts, resolvedAt: new Date().toISOString() });
  } else {
    res.status(404).json({ error: "Alert not found" });
  }
});

// ── Execution Endpoints ──────────────────────────────────────

router.get("/execution/mode", (_req, res) => {
  res.json(getExecutionMode());
});

router.get("/execution/gate", (_req, res) => {
  res.json(getProductionGateStats());
});

router.get("/execution/session", (_req, res) => {
  res.json(getFullSessionStatus());
});

export default router;
