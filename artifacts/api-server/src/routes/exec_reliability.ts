// ── Phase 111: Execution Reliability Layer API ───────────────────────────────
// 7 endpoints for failsafe state, order lifecycle, reconciliation, rules, settlements, history

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getRiskEngineSnapshot } from "../lib/risk_engine";

const router = Router();

// ── Failsafe state tracking (in-memory) ────────────────────────────────────
interface FailsafeAction {
  action: string;
  timestamp: number;
  trigger: string;
  detail: string;
}

interface RecoveryStage {
  stage: "normal" | "degraded" | "recovery";
  stageEnteredAt: number;
  stabilityTimerMs: number;
  progress: number;
}

interface FailsafeStateType {
  mode: "normal" | "degraded" | "failsafe";
  activeFailures: Array<{ type: string; since: number; severity: string; detail: string }>;
  canTrade: boolean;
  canOpenNew: boolean;
  sizeMultiplier: number;
  escalationLevel: number;
  actionsExecuted: FailsafeAction[];
  lastEscalation: number;
  recovery: RecoveryStage;
}

const stateStartTime = Date.now();
const actionsLog: FailsafeAction[] = [];

function getFailsafeState(): FailsafeStateType {
  const uptime = Date.now() - stateStartTime;
  const risk = getRiskEngineSnapshot();
  const isHalted = risk.runtime.killSwitchActive;

  // Compute mode based on risk snapshot
  let mode: "normal" | "degraded" | "failsafe" = "normal";
  let sizeMultiplier = 1.0;

  if (isHalted) {
    mode = "failsafe";
    sizeMultiplier = 0;
  } else if (risk.config.newsLockoutActive) {
    mode = "degraded";
    sizeMultiplier = 0.5;
  }

  const escalationLevel = isHalted ? 3 : mode === "degraded" ? 1 : 0;

  return {
    mode,
    activeFailures: isHalted ? [{ type: "kill_switch", since: stateStartTime, severity: "critical", detail: "Kill switch active" }] : [],
    canTrade: !isHalted,
    canOpenNew: !isHalted && mode !== "degraded",
    sizeMultiplier,
    escalationLevel,
    actionsExecuted: actionsLog.slice(-10),
    lastEscalation: actionsLog.length > 0 ? actionsLog[actionsLog.length - 1]?.timestamp ?? 0 : 0,
    recovery: {
      stage: mode === "normal" ? "normal" : mode === "degraded" ? "degraded" : "recovery",
      stageEnteredAt: stateStartTime,
      stabilityTimerMs: Math.max(0, 300000 - uptime),
      progress: Math.min(100, Math.round((uptime / 300000) * 100)),
    },
  };
}

// ── Order lifecycle tracking ───────────────────────────────────────────────
interface OrderRecord {
  id: string;
  clientOrderId: string;
  symbol: string;
  side: "buy" | "sell";
  type: string;
  quantity: number;
  filledQuantity: number;
  price: number;
  state: string;
  retryCount: number;
  venue: string;
  createdAt: number;
  updatedAt: number;
  lastError?: string;
}

const ordersLog: OrderRecord[] = [];

function getOrdersSnapshot() {
  const now = Date.now();
  // Return orders created in last 24 hours
  const recentOrders = ordersLog.filter(o => (now - o.createdAt) < 86400000).slice(-50);
  
  const stateDistribution: Record<string, number> = {
    CREATED: 0, VALIDATING: 0, SUBMITTED: 0, ACKNOWLEDGED: 0, PARTIAL_FILL: 0,
    FILLED: 0, CANCELLED: 0, REJECTED: 0, EXPIRED: 0, FAILED: 0,
  };
  
  recentOrders.forEach(o => {
    if (stateDistribution.hasOwnProperty(o.state)) {
      stateDistribution[o.state]++;
    }
  });
  
  return {
    orders: recentOrders,
    stateDistribution,
    duplicateRejections: recentOrders.filter(o => o.retryCount > 1).length,
    orphanOrders: 0,
    orphanPositions: 0,
    totalRetries: recentOrders.reduce((s, o) => s + o.retryCount, 0),
  };
}

// ── Reconciliation state tracking ──────────────────────────────────────────
import { getReconciliationSnapshot } from "../lib/fill_reconciler";

function getReliabilityReconciliation() {
  const snap = getReconciliationSnapshot();
  const fillsToday = snap.fills_today ?? 0;
  const unmatched = snap.unmatched_fills ?? 0;
  const matched = Math.max(0, fillsToday - unmatched);
  const score = fillsToday > 0 ? Math.round((matched / fillsToday) * 100) : 100;

  return {
    id: `recon_${Date.now().toString(36)}`,
    timestamp: Date.now(),
    duration: 0,
    internalOrders: snap.processed_fill_ids ?? 0,
    brokerOrders: fillsToday,
    matched,
    mismatched: unmatched,
    missingFromBroker: 0,
    missingFromInternal: unmatched,
    score,
    status: score > 98 ? "clean" : score > 90 ? "warnings" : "critical",
    realizedPnlToday: snap.realized_pnl_today ?? 0,
    lastPollAt: snap.last_poll_at,
    isRunning: snap.is_running,
    discrepancies: [],
    positionMismatches: [],
    history: [],
  };
}

// ── Failsafe Rules (configuration + stats) ────────────────────────────────
interface FailsafeRule {
  id: string;
  trigger: string;
  condition: string;
  action: string;
  priority: number;
  cooldownMs: number;
  lastTriggered: number;
  triggerCount: number;
  enabled: boolean;
}

const RULES: FailsafeRule[] = [
  { id: "fs_01", trigger: "broker_disconnect", condition: "Connection lost", action: "halt_new_orders", priority: 1, cooldownMs: 5000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_02", trigger: "broker_disconnect", condition: ">30s disconnected", action: "cancel_pending", priority: 2, cooldownMs: 30000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_03", trigger: "broker_disconnect", condition: ">60s disconnected", action: "flatten_all", priority: 3, cooldownMs: 60000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_04", trigger: "db_unavailable", condition: "DB connection lost", action: "switch_paper", priority: 1, cooldownMs: 10000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_05", trigger: "feed_stale", condition: ">15s no data", action: "halt_new_orders", priority: 1, cooldownMs: 15000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_06", trigger: "high_latency", condition: ">500ms response", action: "reduce_size", priority: 1, cooldownMs: 30000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_07", trigger: "memory_pressure", condition: ">90% memory", action: "graceful_shutdown", priority: 1, cooldownMs: 60000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_08", trigger: "clock_skew", condition: ">5s skew", action: "halt_new_orders", priority: 1, cooldownMs: 10000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_09", trigger: "api_timeout", condition: "3 consecutive timeouts", action: "switch_paper", priority: 2, cooldownMs: 60000, lastTriggered: 0, triggerCount: 0, enabled: true },
  { id: "fs_10", trigger: "partial_system", condition: "Critical module down", action: "reduce_size", priority: 1, cooldownMs: 30000, lastTriggered: 0, triggerCount: 0, enabled: true },
];

// ── Settlement tracking ───────────────────────────────────────────────────
interface Settlement {
  orderId: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  fillPrice: number;
  tradeDate: string;
  settlementDate: string;
  status: "pending" | "settled" | "failed";
  daysRemaining: number;
}

const settlementsLog: Settlement[] = [];

function getSettlementsSnapshot() {
  const now = new Date();
  const todayStr = now.toISOString().split("T")[0];
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().split("T")[0];
  
  // Crypto settles T+0, equities settle T+2
  const recentSettlements = settlementsLog.slice(-20);
  const pending = recentSettlements.filter(s => s.status === "pending");
  const settled = recentSettlements.filter(s => s.status === "settled");
  
  return {
    settlements: recentSettlements,
    pending: pending.length,
    settled: settled.length,
    failed: recentSettlements.filter(s => s.status === "failed").length,
  };
}

// ── Failure history tracking ───────────────────────────────────────────────
interface FailureEvent {
  id: string;
  type: string;
  timestamp: number;
  severity: "info" | "warning" | "critical";
  duration: number;
  actions: string[];
  resolution: string;
  escalationLevel: number;
}

const failureHistory: FailureEvent[] = [];

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/state", (_req: Request, res: Response) => {
  try {
    const state = getFailsafeState();
    res.status(200).json(state);
  } catch (err) {
    logger.error({ err }, "[exec_reliability] State error");
    res.status(503).json({ error: "Failed to get failsafe state" });
  }
});

router.get("/orders", (_req: Request, res: Response) => {
  try {
    const snapshot = getOrdersSnapshot();
    res.status(200).json(snapshot);
  } catch (err) {
    logger.error({ err }, "[exec_reliability] Orders error");
    res.status(503).json({ error: "Failed to get order state" });
  }
});

router.get("/reconciliation", (_req: Request, res: Response) => {
  try {
    const recon = getReliabilityReconciliation();
    res.status(200).json(recon);
  } catch (err) {
    logger.error({ err }, "[exec_reliability] Reconciliation error");
    res.status(503).json({ error: "Failed to get reconciliation snapshot" });
  }
});

router.get("/rules", (_req: Request, res: Response) => {
  try {
    res.status(200).json({ 
      rules: RULES, 
      total: RULES.length, 
      enabled: RULES.filter(r => r.enabled).length,
      triggered: RULES.filter(r => r.lastTriggered > 0).length,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error({ err }, "[exec_reliability] Rules error");
    res.status(503).json({ error: "Failed to get rules" });
  }
});

router.get("/settlements", (_req: Request, res: Response) => {
  try {
    const snapshot = getSettlementsSnapshot();
    res.status(200).json({
      ...snapshot,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error({ err }, "[exec_reliability] Settlements error");
    res.status(503).json({ error: "Failed to get settlements" });
  }
});

router.get("/history", (_req: Request, res: Response) => {
  try {
    res.status(200).json({ 
      events: failureHistory.slice(-50), 
      total: failureHistory.length,
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error({ err }, "[exec_reliability] History error");
    res.status(503).json({ error: "Failed to get failure history" });
  }
});

router.get("/health", (_req: Request, res: Response) => {
  try {
    const failsafeState = getFailsafeState();
    const recon = getReliabilityReconciliation();
    
    res.status(200).json({
      status: failsafeState.mode === "normal" ? "operational" : failsafeState.mode === "degraded" ? "degraded" : "critical",
      module: "exec-reliability",
      phase: 111,
      mode: failsafeState.mode,
      canTrade: failsafeState.canTrade,
      reconScore: recon.score,
      uptime: process.uptime(),
      timestamp: Date.now(),
    });
  } catch (err) {
    logger.error({ err }, "[exec_reliability] Health error");
    res.status(503).json({ 
      status: "degraded",
      error: "Health check failed",
      timestamp: Date.now(),
    });
  }
});

export default router;
