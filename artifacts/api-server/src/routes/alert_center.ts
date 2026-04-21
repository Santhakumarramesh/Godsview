/**
 * Phase 106 — Alert Engine & Anomaly Detection API
 *
 * Endpoints:
 *   GET  /summary       — Alert summary with counts by priority
 *   GET  /active        — Active alerts feed
 *   GET  /rules         — Configured alert rules
 *   POST /rules         — Add a new alert rule
 *   POST /acknowledge   — Acknowledge an alert
 *   POST /resolve       — Resolve an alert
 *   GET  /channels      — Notification channels status
 *   POST /channels/test — Test a notification channel
 *   GET  /anomalies     — Anomaly detection panel data
 *   GET  /escalation    — Escalation chain config
 *   GET  /health        — Subsystem health
 */

import { Router, type Request, type Response } from "express";

const router = Router();

// ── Mock Alerts ─────────────────────────────────────────────────────────────
const activeAlerts = [
  { id: "alrt_001", ruleId: "rule_01", ruleName: "Drawdown > 5%", priority: "P1", category: "drawdown", status: "active", message: "Portfolio drawdown hit 6.2% — exceeds 5% threshold", details: { currentDrawdown: 0.062, threshold: 0.05 }, triggeredAt: new Date(Date.now() - 180_000).toISOString() },
  { id: "alrt_002", ruleId: "rule_06", ruleName: "Sentiment Extreme", priority: "P2", category: "sentiment", status: "active", message: "NVDA sentiment score 0.85 — extreme bullish reading", details: { symbol: "NVDA", score: 0.85 }, triggeredAt: new Date(Date.now() - 420_000).toISOString() },
  { id: "alrt_003", ruleId: "rule_04", ruleName: "Volume Spike", priority: "P3", category: "volume", status: "acknowledged", message: "TSLA volume 3.8x average — unusual activity detected", details: { symbol: "TSLA", multiplier: 3.8 }, triggeredAt: new Date(Date.now() - 900_000).toISOString(), acknowledgedAt: new Date(Date.now() - 600_000).toISOString() },
  { id: "alrt_004", ruleId: "rule_07", ruleName: "Fill Rate Below 90%", priority: "P2", category: "execution", status: "escalated", message: "Fill rate dropped to 87.3% over last 100 orders", details: { fillRate: 0.873, threshold: 0.90 }, triggeredAt: new Date(Date.now() - 1800_000).toISOString(), escalatedAt: new Date(Date.now() - 1200_000).toISOString() },
  { id: "alrt_005", ruleId: "rule_05", ruleName: "Regime Change", priority: "P3", category: "regime", status: "active", message: "Market regime shifted from trend_up to compression", details: { from: "trend_up", to: "compression" }, triggeredAt: new Date(Date.now() - 300_000).toISOString() },
  { id: "alrt_006", ruleId: "rule_08", ruleName: "System Latency", priority: "P3", category: "system", status: "resolved", message: "API latency spike to 680ms — resolved after 2 minutes", details: { latencyMs: 680, threshold: 500 }, triggeredAt: new Date(Date.now() - 3600_000).toISOString(), resolvedAt: new Date(Date.now() - 3480_000).toISOString() },
  { id: "alrt_007", ruleId: "rule_03", ruleName: "Win Rate Drop", priority: "P2", category: "execution", status: "active", message: "Win rate 38.2% over last 50 trades — below 40% threshold", details: { winRate: 0.382, trades: 50 }, triggeredAt: new Date(Date.now() - 600_000).toISOString() },
];

// ── Mock Rules ──────────────────────────────────────────────────────────────
const rules = [
  { id: "rule_01", name: "Drawdown > 5%", description: "Alert when portfolio drawdown exceeds 5%", enabled: true, priority: "P1", category: "drawdown", conditions: [{ field: "drawdown", operator: "gt", value: 0.05 }], actions: [{ type: "notify", params: {} }], cooldownMs: 300000, triggerCount: 12, lastTriggered: new Date(Date.now() - 180_000).toISOString() },
  { id: "rule_02", name: "Drawdown > 10% (HALT)", description: "Halt trading when drawdown exceeds 10%", enabled: true, priority: "P1", category: "drawdown", conditions: [{ field: "drawdown", operator: "gt", value: 0.10 }], actions: [{ type: "halt_trading", params: {} }], cooldownMs: 600000, triggerCount: 2, lastTriggered: new Date(Date.now() - 86400_000).toISOString() },
  { id: "rule_03", name: "Win Rate Drop", description: "Alert when win rate drops below 40%", enabled: true, priority: "P2", category: "execution", conditions: [{ field: "win_rate", operator: "lt", value: 0.40 }], actions: [{ type: "notify", params: {} }], cooldownMs: 600000, triggerCount: 5, lastTriggered: new Date(Date.now() - 600_000).toISOString() },
  { id: "rule_04", name: "Volume Spike", description: "Alert on volume 3x above average", enabled: true, priority: "P3", category: "volume", conditions: [{ field: "volume_ratio", operator: "gt", value: 3.0 }], actions: [{ type: "notify", params: {} }], cooldownMs: 300000, triggerCount: 28, lastTriggered: new Date(Date.now() - 900_000).toISOString() },
  { id: "rule_05", name: "Regime Change", description: "Alert on market regime transition", enabled: true, priority: "P3", category: "regime", conditions: [{ field: "regime_changed", operator: "eq", value: 1 }], actions: [{ type: "log", params: {} }], cooldownMs: 600000, triggerCount: 18, lastTriggered: new Date(Date.now() - 300_000).toISOString() },
  { id: "rule_06", name: "Sentiment Extreme", description: "Alert when sentiment |score| > 0.8", enabled: true, priority: "P2", category: "sentiment", conditions: [{ field: "sentiment_abs", operator: "gt", value: 0.8 }], actions: [{ type: "notify", params: {} }], cooldownMs: 1800000, triggerCount: 8, lastTriggered: new Date(Date.now() - 420_000).toISOString() },
  { id: "rule_07", name: "Fill Rate Below 90%", description: "Alert when fill rate drops below 90%", enabled: true, priority: "P2", category: "execution", conditions: [{ field: "fill_rate", operator: "lt", value: 0.90 }], actions: [{ type: "adjust_risk", params: { reduce: 0.5 } }], cooldownMs: 600000, triggerCount: 4, lastTriggered: new Date(Date.now() - 1800_000).toISOString() },
  { id: "rule_08", name: "System Latency", description: "Alert when API latency exceeds 500ms", enabled: true, priority: "P3", category: "system", conditions: [{ field: "latency_ms", operator: "gt", value: 500 }], actions: [{ type: "notify", params: {} }], cooldownMs: 120000, triggerCount: 15, lastTriggered: new Date(Date.now() - 3600_000).toISOString() },
];

// ── Mock Channels ───────────────────────────────────────────────────────────
const channels = [
  { id: "ch_dash", name: "Dashboard", type: "dashboard", enabled: true, priority: "all", status: "active", messagesSent: 342, failureRate: 0, lastSent: new Date(Date.now() - 60_000).toISOString() },
  { id: "ch_email", name: "Email", type: "email", enabled: true, priority: "P1-P2", status: "active", messagesSent: 87, failureRate: 0.012, lastSent: new Date(Date.now() - 420_000).toISOString() },
  { id: "ch_slack", name: "Slack #alerts", type: "slack", enabled: true, priority: "P1-P3", status: "active", messagesSent: 198, failureRate: 0.005, lastSent: new Date(Date.now() - 180_000).toISOString() },
  { id: "ch_sms", name: "SMS", type: "sms", enabled: true, priority: "P1", status: "active", messagesSent: 12, failureRate: 0.02, lastSent: new Date(Date.now() - 86400_000).toISOString() },
  { id: "ch_tg", name: "Telegram", type: "telegram", enabled: false, priority: "P1-P2", status: "inactive", messagesSent: 0, failureRate: 0, lastSent: null },
];

// ── Mock Anomalies ──────────────────────────────────────────────────────────
const monitoredMetrics = [
  { name: "latency", currentValue: 145, baseline: 120, stdDev: 35, zScore: 0.71, isAnomaly: false },
  { name: "fill_rate", currentValue: 0.873, baseline: 0.945, stdDev: 0.022, zScore: -3.27, isAnomaly: true },
  { name: "slippage", currentValue: 1.8, baseline: 1.2, stdDev: 0.4, zScore: 1.50, isAnomaly: false },
  { name: "drawdown", currentValue: 0.062, baseline: 0.028, stdDev: 0.012, zScore: 2.83, isAnomaly: true },
  { name: "win_rate", currentValue: 0.382, baseline: 0.618, stdDev: 0.085, zScore: -2.78, isAnomaly: true },
  { name: "pnl", currentValue: -420, baseline: 280, stdDev: 350, zScore: -2.00, isAnomaly: false },
  { name: "volume", currentValue: 4280, baseline: 2100, stdDev: 680, zScore: 3.21, isAnomaly: true },
  { name: "spread", currentValue: 0.045, baseline: 0.032, stdDev: 0.008, zScore: 1.63, isAnomaly: false },
  { name: "order_reject_rate", currentValue: 0.035, baseline: 0.012, stdDev: 0.008, zScore: 2.88, isAnomaly: true },
  { name: "position_concentration", currentValue: 0.42, baseline: 0.28, stdDev: 0.06, zScore: 2.33, isAnomaly: false },
];

const recentAnomalies = [
  { id: "anom_001", metricName: "fill_rate", value: 0.873, expected: 0.945, zScore: -3.27, method: "z_score", severity: "high", description: "Fill rate dropped 7.2% below baseline", detectedAt: new Date(Date.now() - 300_000).toISOString() },
  { id: "anom_002", metricName: "volume", value: 4280, expected: 2100, zScore: 3.21, method: "ewma", severity: "high", description: "Volume surged 3.2σ above EWMA baseline", detectedAt: new Date(Date.now() - 600_000).toISOString() },
  { id: "anom_003", metricName: "drawdown", value: 0.062, expected: 0.028, zScore: 2.83, method: "z_score", severity: "medium", description: "Drawdown 2.8σ above normal range", detectedAt: new Date(Date.now() - 900_000).toISOString() },
  { id: "anom_004", metricName: "win_rate", value: 0.382, expected: 0.618, zScore: -2.78, method: "iqr", severity: "medium", description: "Win rate fell below IQR lower fence", detectedAt: new Date(Date.now() - 1200_000).toISOString() },
  { id: "anom_005", metricName: "order_reject_rate", value: 0.035, expected: 0.012, zScore: 2.88, method: "rate_of_change", severity: "medium", description: "Reject rate accelerating — 2.9x normal change rate", detectedAt: new Date(Date.now() - 1500_000).toISOString() },
];

// ── GET /summary ────────────────────────────────────────────────────────────
router.get("/summary", (_req: Request, res: Response) => {
  const active = activeAlerts.filter((a) => a.status === "active").length;
  const acknowledged = activeAlerts.filter((a) => a.status === "acknowledged").length;
  const escalated = activeAlerts.filter((a) => a.status === "escalated").length;
  const p1 = activeAlerts.filter((a) => a.priority === "P1" && a.status !== "resolved").length;
  const p2 = activeAlerts.filter((a) => a.priority === "P2" && a.status !== "resolved").length;
  const anomalyCount = monitoredMetrics.filter((m) => m.isAnomaly).length;
  res.json({
    total: activeAlerts.length, active, acknowledged, escalated,
    resolved: activeAlerts.filter((a) => a.status === "resolved").length,
    byPriority: { P1: p1, P2: p2, P3: activeAlerts.filter((a) => a.priority === "P3").length, P4: 0 },
    systemHealth: Math.max(0, 100 - (p1 * 20) - (p2 * 10) - (anomalyCount * 5)),
    topRules: rules.sort((a, b) => b.triggerCount - a.triggerCount).slice(0, 5).map((r) => ({ ruleId: r.id, name: r.name, triggerCount: r.triggerCount })),
  });
});

// ── GET /active ─────────────────────────────────────────────────────────────
router.get("/active", (req: Request, res: Response) => {
  let filtered = [...activeAlerts];
  const { priority, category } = req.query;
  if (priority) filtered = filtered.filter((a) => a.priority === priority);
  if (category) filtered = filtered.filter((a) => a.category === category);
  res.json({ alerts: filtered, total: filtered.length });
});

// ── GET /rules ──────────────────────────────────────────────────────────────
router.get("/rules", (_req: Request, res: Response) => { res.json({ rules, total: rules.length }); });

// ── POST /rules ─────────────────────────────────────────────────────────────
router.post("/rules", (req: Request, res: Response) => {
  const { name, priority, category, conditions, cooldownMs } = req.body || {};
  const rule = { id: `rule_${String(rules.length + 1).padStart(2, "0")}`, name: name ?? "New Rule", description: "", enabled: true, priority: priority ?? "P3", category: category ?? "custom", conditions: conditions ?? [], actions: [{ type: "notify", params: {} }], cooldownMs: cooldownMs ?? 300000, triggerCount: 0 };
  rules.push(rule as any);
  res.json({ success: true, rule });
});

// ── POST /acknowledge & /resolve ────────────────────────────────────────────
router.post("/acknowledge", (req: Request, res: Response) => {
  const alert = activeAlerts.find((a) => a.id === req.body?.alertId);
  if (alert && alert.status === "active") { alert.status = "acknowledged"; (alert as any).acknowledgedAt = new Date().toISOString(); res.json({ success: true }); }
  else res.status(404).json({ success: false, error: "Not found or not active" });
});

router.post("/resolve", (req: Request, res: Response) => {
  const alert = activeAlerts.find((a) => a.id === req.body?.alertId);
  if (alert && alert.status !== "resolved") { alert.status = "resolved"; (alert as any).resolvedAt = new Date().toISOString(); res.json({ success: true }); }
  else res.status(404).json({ success: false, error: "Not found or already resolved" });
});

// ── GET /channels ───────────────────────────────────────────────────────────
router.get("/channels", (_req: Request, res: Response) => {
  res.json({ channels, rateLimitStatus: { currentMinute: 8, maxPerMinute: 30, currentHour: 42, maxPerHour: 200, isLimited: false } });
});

router.post("/channels/test", (req: Request, res: Response) => {
  const ch = channels.find((c) => c.id === req.body?.channelId);
  if (ch) res.json({ success: true, channel: ch.name, latencyMs: Math.round(50 + Math.random() * 200) });
  else res.status(404).json({ success: false, error: "Channel not found" });
});

// ── GET /anomalies ──────────────────────────────────────────────────────────
router.get("/anomalies", (_req: Request, res: Response) => {
  res.json({ metrics: monitoredMetrics, recentAnomalies, systemHealth: Math.max(0, 100 - (recentAnomalies.length * 8)), monitoredCount: monitoredMetrics.length, anomalousCount: monitoredMetrics.filter((m) => m.isAnomaly).length });
});

// ── GET /escalation ─────────────────────────────────────────────────────────
router.get("/escalation", (_req: Request, res: Response) => {
  res.json({ levels: [
    { level: 1, channels: ["Dashboard", "Slack"], delayMs: 0, description: "Immediate: Dashboard + Slack notification", active: true },
    { level: 2, channels: ["Email", "Telegram"], delayMs: 300000, description: "5 min: Email + Telegram if unacknowledged", active: false },
    { level: 3, channels: ["SMS"], delayMs: 900000, description: "15 min: SMS escalation to on-call", active: false },
    { level: 4, channels: ["Phone"], delayMs: 1800000, description: "30 min: Phone call to team lead", active: false },
  ] });
});

// ── GET /health ─────────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    subsystems: {
      alertEngine: { status: "ok", activeRules: rules.filter((r) => r.enabled).length, activeAlerts: activeAlerts.filter((a) => a.status === "active").length },
      notificationDispatcher: { status: "ok", channelsOnline: channels.filter((c) => c.status === "active").length },
      anomalyDetector: { status: "ok", metricsMonitored: monitoredMetrics.length, anomaliesDetected: recentAnomalies.length },
    },
    uptime: process.uptime(),
  });
});

export default router;
