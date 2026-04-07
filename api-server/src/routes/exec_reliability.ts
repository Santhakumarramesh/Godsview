// ── Phase 111: Execution Reliability Layer API ───────────────────────────────
// 7 endpoints for failsafe state, order lifecycle, reconciliation, rules, settlements, history

import { Router, type Request, type Response } from "express";

const router = Router();

const now = Date.now();

// ── Mock: Failsafe State ────────────────────────────────────────────────────

const FAILSAFE_STATE = {
  mode: "normal" as const,
  activeFailures: [] as Array<{ type: string; since: number; severity: string; detail: string }>,
  canTrade: true,
  canOpenNew: true,
  sizeMultiplier: 1.0,
  escalationLevel: 0,
  actionsExecuted: [
    { action: "alert_operator", timestamp: now - 7200000, trigger: "high_latency", detail: "Latency spike 520ms" },
    { action: "reduce_size", timestamp: now - 7200000, trigger: "high_latency", detail: "Size reduced to 50%" },
    { action: "log_only", timestamp: now - 3600000, trigger: "high_latency", detail: "Latency normalized, sizes restored" },
  ],
  lastEscalation: now - 7200000,
  recovery: { stage: "normal", stageEnteredAt: now - 3600000, stabilityTimerMs: 0, progress: 100 },
};

// ── Mock: Orders ────────────────────────────────────────────────────────────

const ORDERS = [
  { id: "ord_001", clientOrderId: "cli_001", symbol: "AAPL", side: "buy", type: "limit", quantity: 100, filledQuantity: 100, price: 198.50, state: "FILLED", retryCount: 0, venue: "alpaca", createdAt: now - 3600000, updatedAt: now - 3540000 },
  { id: "ord_002", clientOrderId: "cli_002", symbol: "MSFT", side: "buy", type: "market", quantity: 50, filledQuantity: 35, price: 425.30, state: "PARTIAL_FILL", retryCount: 0, venue: "alpaca", createdAt: now - 1800000, updatedAt: now - 1200000 },
  { id: "ord_003", clientOrderId: "cli_003", symbol: "TSLA", side: "sell", type: "limit", quantity: 75, filledQuantity: 0, price: 248.00, state: "ACKNOWLEDGED", retryCount: 0, venue: "alpaca", createdAt: now - 900000, updatedAt: now - 880000 },
  { id: "ord_004", clientOrderId: "cli_004", symbol: "NVDA", side: "buy", type: "stop_limit", quantity: 30, filledQuantity: 0, price: 890.00, state: "SUBMITTED", retryCount: 1, venue: "alpaca", createdAt: now - 600000, updatedAt: now - 550000 },
  { id: "ord_005", clientOrderId: "cli_005", symbol: "GOOGL", side: "sell", type: "market", quantity: 40, filledQuantity: 40, price: 178.20, state: "FILLED", retryCount: 0, venue: "alpaca", createdAt: now - 7200000, updatedAt: now - 7150000 },
  { id: "ord_006", clientOrderId: "cli_006", symbol: "META", side: "buy", type: "limit", quantity: 60, filledQuantity: 0, price: 510.00, state: "CANCELLED", retryCount: 0, venue: "alpaca", createdAt: now - 5400000, updatedAt: now - 5000000 },
  { id: "ord_007", clientOrderId: "cli_007", symbol: "BTC/USD", side: "buy", type: "market", quantity: 0.5, filledQuantity: 0.5, price: 67432.50, state: "FILLED", retryCount: 0, venue: "alpaca", createdAt: now - 4200000, updatedAt: now - 4180000 },
  { id: "ord_008", clientOrderId: "cli_008", symbol: "ETH/USD", side: "sell", type: "limit", quantity: 5, filledQuantity: 0, price: 3500.00, state: "REJECTED", retryCount: 2, venue: "alpaca", createdAt: now - 3000000, updatedAt: now - 2800000, lastError: "insufficient_funds" },
];

const stateDistribution = {
  CREATED: 0, VALIDATING: 0, SUBMITTED: 1, ACKNOWLEDGED: 1, PARTIAL_FILL: 1,
  FILLED: 3, CANCELLED: 1, REJECTED: 1, EXPIRED: 0, FAILED: 0,
};

const duplicateRejections = 12;
const orphanOrders = 0;
const orphanPositions = 0;

// ── Mock: Reconciliation ────────────────────────────────────────────────────

const RECONCILIATION = {
  id: "recon_047",
  timestamp: now - 120000,
  duration: 1842,
  internalOrders: 8,
  brokerOrders: 8,
  matched: 7,
  mismatched: 1,
  missingFromBroker: 0,
  missingFromInternal: 0,
  score: 94,
  status: "warnings" as const,
  discrepancies: [
    { orderId: "ord_002", field: "filledQuantity", internalValue: "35", brokerValue: "38", severity: "warning", resolution: "pending" },
    { orderId: "ord_004", field: "state", internalValue: "SUBMITTED", brokerValue: "ACKNOWLEDGED", severity: "info", resolution: "auto_corrected" },
  ],
  positionMismatches: [
    { symbol: "MSFT", internalQty: 35, brokerQty: 38, delta: 3, marketValue: 1275.90, riskExposure: 0.02, action: "investigate" },
  ],
  history: [
    { id: "recon_046", timestamp: now - 180000, score: 97, status: "clean" },
    { id: "recon_045", timestamp: now - 240000, score: 92, status: "warnings" },
    { id: "recon_044", timestamp: now - 300000, score: 98, status: "clean" },
    { id: "recon_043", timestamp: now - 360000, score: 85, status: "warnings" },
    { id: "recon_042", timestamp: now - 420000, score: 100, status: "clean" },
  ],
};

// ── Mock: Failsafe Rules ────────────────────────────────────────────────────

const RULES = [
  { id: "fs_01", trigger: "broker_disconnect", condition: "Connection lost", action: "halt_new_orders", priority: 1, cooldownMs: 5000, lastTriggered: now - 86400000, triggerCount: 3, enabled: true },
  { id: "fs_02", trigger: "broker_disconnect", condition: ">30s disconnected", action: "cancel_pending", priority: 2, cooldownMs: 30000, lastTriggered: now - 86400000, triggerCount: 1, enabled: true },
  { id: "fs_03", trigger: "broker_disconnect", condition: ">60s disconnected", action: "flatten_all", priority: 3, cooldownMs: 60000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_04", trigger: "db_unavailable", condition: "DB connection lost", action: "switch_paper", priority: 1, cooldownMs: 10000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_05", trigger: "feed_stale", condition: ">15s no data", action: "halt_new_orders", priority: 1, cooldownMs: 15000, lastTriggered: now - 43200000, triggerCount: 7, enabled: true },
  { id: "fs_06", trigger: "high_latency", condition: ">500ms response", action: "reduce_size", priority: 1, cooldownMs: 30000, lastTriggered: now - 7200000, triggerCount: 12, enabled: true },
  { id: "fs_07", trigger: "memory_pressure", condition: ">90% memory", action: "graceful_shutdown", priority: 1, cooldownMs: 60000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_08", trigger: "clock_skew", condition: ">5s skew", action: "halt_new_orders", priority: 1, cooldownMs: 10000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_09", trigger: "api_timeout", condition: "3 consecutive timeouts", action: "switch_paper", priority: 2, cooldownMs: 60000, lastTriggered: now - 172800000, triggerCount: 2, enabled: true },
  { id: "fs_10", trigger: "partial_system", condition: "Critical module down", action: "reduce_size", priority: 1, cooldownMs: 30000, lastTriggered: now - 259200000, triggerCount: 1, enabled: true },
  { id: "fs_11", trigger: "unknown", condition: "Unclassified error", action: "alert_operator", priority: 1, cooldownMs: 60000, lastTriggered: now - 604800000, triggerCount: 4, enabled: true },
  { id: "fs_12", trigger: "unknown", condition: "Repeated unknown errors", action: "reduce_size", priority: 2, cooldownMs: 120000, lastTriggered: 0, triggerCount: 0, enabled: true },
];

// ── Mock: Settlements ───────────────────────────────────────────────────────

const SETTLEMENTS = [
  { orderId: "ord_001", symbol: "AAPL", side: "buy", quantity: 100, fillPrice: 198.50, tradeDate: "2026-04-06", settlementDate: "2026-04-07", status: "pending", daysRemaining: 1 },
  { orderId: "ord_005", symbol: "GOOGL", side: "sell", quantity: 40, fillPrice: 178.20, tradeDate: "2026-04-06", settlementDate: "2026-04-07", status: "pending", daysRemaining: 1 },
  { orderId: "ord_007", symbol: "BTC/USD", side: "buy", quantity: 0.5, fillPrice: 67432.50, tradeDate: "2026-04-06", settlementDate: "2026-04-06", status: "settled", daysRemaining: 0 },
  { orderId: "prev_001", symbol: "MSFT", side: "buy", quantity: 50, fillPrice: 424.80, tradeDate: "2026-04-04", settlementDate: "2026-04-07", status: "pending", daysRemaining: 1 },
  { orderId: "prev_002", symbol: "NVDA", side: "sell", quantity: 25, fillPrice: 895.40, tradeDate: "2026-04-03", settlementDate: "2026-04-04", status: "settled", daysRemaining: 0 },
];

// ── Mock: Failure History ───────────────────────────────────────────────────

const FAILURE_HISTORY = [
  { id: "fail_01", type: "high_latency", timestamp: now - 7200000, severity: "warning", duration: 180000, actions: ["reduce_size", "alert_operator"], resolution: "Latency normalized after CDN recovery", escalationLevel: 2 },
  { id: "fail_02", type: "feed_stale", timestamp: now - 43200000, severity: "warning", duration: 45000, actions: ["halt_new_orders"], resolution: "Feed reconnected automatically", escalationLevel: 1 },
  { id: "fail_03", type: "broker_disconnect", timestamp: now - 86400000, severity: "critical", duration: 28000, actions: ["halt_new_orders", "cancel_pending"], resolution: "Broker API restored", escalationLevel: 2 },
  { id: "fail_04", type: "api_timeout", timestamp: now - 172800000, severity: "warning", duration: 120000, actions: ["switch_paper", "alert_operator"], resolution: "Rate limit resolved, switched back to live", escalationLevel: 2 },
  { id: "fail_05", type: "partial_system", timestamp: now - 259200000, severity: "warning", duration: 300000, actions: ["reduce_size"], resolution: "Sentiment module restarted", escalationLevel: 1 },
  { id: "fail_06", type: "unknown", timestamp: now - 604800000, severity: "info", duration: 15000, actions: ["log_only"], resolution: "Transient error, no recurrence", escalationLevel: 1 },
];

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/state", (_req: Request, res: Response) => {
  res.json(FAILSAFE_STATE);
});

router.get("/orders", (_req: Request, res: Response) => {
  res.json({
    orders: ORDERS,
    stateDistribution,
    duplicateRejections,
    orphanOrders,
    orphanPositions,
    totalRetries: ORDERS.reduce((s, o) => s + o.retryCount, 0),
  });
});

router.get("/reconciliation", (_req: Request, res: Response) => {
  res.json(RECONCILIATION);
});

router.get("/rules", (_req: Request, res: Response) => {
  res.json({ rules: RULES, total: RULES.length, enabled: RULES.filter(r => r.enabled).length });
});

router.get("/settlements", (_req: Request, res: Response) => {
  const pending = SETTLEMENTS.filter(s => s.status === "pending");
  const settled = SETTLEMENTS.filter(s => s.status === "settled");
  res.json({ settlements: SETTLEMENTS, pending: pending.length, settled: settled.length, failed: 0 });
});

router.get("/history", (_req: Request, res: Response) => {
  res.json({ events: FAILURE_HISTORY, total: FAILURE_HISTORY.length });
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    module: "exec-reliability",
    phase: 111,
    mode: FAILSAFE_STATE.mode,
    canTrade: FAILSAFE_STATE.canTrade,
    reconScore: RECONCILIATION.score,
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

export default router;
