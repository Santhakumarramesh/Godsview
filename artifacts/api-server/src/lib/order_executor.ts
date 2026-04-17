/**
 * Order Executor — Hardened execution layer between Production Gate and Alpaca.
 *
 * Responsibilities:
 * 1. Paper vs Live routing with explicit mode check
 * 2. Pre-flight validation (symbol, qty, price sanity)
 * 3. Persist SI decision to database BEFORE order placement
 * 4. Position reconciliation after fill
 * 5. Alert integration for execution failures
 *
 * This is the ONLY module that should call placeOrder().
 */

import { logger } from "./logger";
import { alertKillSwitch } from "./alerts";
import type { ProductionDecision } from "./production_gate";
import type { SuperSignal } from "./super_intelligence";
import { db, siDecisionsTable } from "@workspace/db";
import {
  canWriteOrders,
  isLiveMode,
  resolveSystemMode,
} from "@workspace/strategy-core";
import { persistWrite, persistRead, persistAppend } from "./persistent_store";

// ── Types ──────────────────────────────────────────────────────────
export interface ExecutionRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  direction: "long" | "short";
  setup_type: string;
  regime: string;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  /** Full production gate decision */
  decision: ProductionDecision;
  /** Operator token for live execution */
  operator_token?: string;
}

export interface ExecutionResult {
  executed: boolean;
  order_id?: string;
  mode: "paper" | "live" | "dry_run";
  si_decision_id?: number;
  error?: string;
  details: Record<string, unknown>;
}

export interface ExecutionLogEntry {
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type?: string;
  execution_mode: "paper" | "live" | "dry_run";
  success: boolean;
  order_id?: string;
  error_message?: string;
  duration_ms: number;
}

export interface ExecutionHealthCheck {
  pending_orders: number;
  avg_latency_ms: number;
  error_rate_pct: number;
  total_execution_attempts: number;
  successful_executions: number;
  failed_executions: number;
  last_execution_at: string | null;
}

// ── Config ─────────────────────────────────────────────────────────

const LEGACY_LIVE = String(process.env.GODSVIEW_ENABLE_LIVE_TRADING ?? "").toLowerCase() === "true";
const SYSTEM_MODE = resolveSystemMode(process.env.GODSVIEW_SYSTEM_MODE, { liveTradingEnabled: LEGACY_LIVE });const OPERATOR_TOKEN = (process.env.GODSVIEW_OPERATOR_TOKEN ?? "").trim();
const MAX_SINGLE_ORDER_QTY = 100;
const MAX_SINGLE_ORDER_USD = 25_000;

// ── Pre-flight Validation ──────────────────────────────────────────

/**
 * Validate an execution request comprehensively
 */
export function validateExecutionRequest(req: ExecutionRequest): string[] {
  const errors: string[] = [];

  // Symbol validation
  if (!req.symbol || req.symbol.trim().length === 0) {
    errors.push("Symbol is required");
  } else if (!/^[A-Z0-9]{1,5}$/.test(req.symbol.trim())) {
    errors.push(`Invalid symbol format: ${req.symbol}`);
  }

  // Direction validation
  if (req.direction !== "long" && req.direction !== "short") {
    errors.push(`Invalid direction: ${req.direction}`);
  }

  // Side validation
  if (req.side !== "buy" && req.side !== "sell") {
    errors.push(`Invalid side: ${req.side}`);
  }

  // Quantity validation
  if (req.quantity <= 0 || !Number.isFinite(req.quantity)) {
    errors.push(`Invalid quantity: ${req.quantity}`);
  } else if (req.quantity > MAX_SINGLE_ORDER_QTY) {
    errors.push(`Quantity ${req.quantity} exceeds max ${MAX_SINGLE_ORDER_QTY}`);
  }

  // Price validation
  if (req.entry_price <= 0 || !Number.isFinite(req.entry_price)) {
    errors.push(`Invalid entry price: ${req.entry_price}`);
  }

  // Dollar value sanity check
  const dollarValue = req.quantity * req.entry_price;
  if (dollarValue > MAX_SINGLE_ORDER_USD) {
    errors.push(`Order value $${dollarValue.toFixed(2)} exceeds max $${MAX_SINGLE_ORDER_USD}`);
  }

  // Stop loss validation
  if (!Number.isFinite(req.stop_loss) || req.stop_loss <= 0) {
    errors.push(`Invalid stop loss: ${req.stop_loss}`);
  } else if (req.direction === "long" && req.stop_loss >= req.entry_price) {
    errors.push("Long stop loss must be below entry price");
  } else if (req.direction === "short" && req.stop_loss <= req.entry_price) {
    errors.push("Short stop loss must be above entry price");
  }

  // Take profit validation
  if (!Number.isFinite(req.take_profit) || req.take_profit <= 0) {
    errors.push(`Invalid take profit: ${req.take_profit}`);
  } else if (req.direction === "long" && req.take_profit <= req.entry_price) {
    errors.push("Long take profit must be above entry price");
  } else if (req.direction === "short" && req.take_profit >= req.entry_price) {
    errors.push("Short take profit must be below entry price");
  }

  // Production gate must have approved
  if (req.decision.action !== "EXECUTE") {
    errors.push(`Production gate blocked: ${req.decision.action}`);
  }

  return errors;
}

function validatePreFlight(req: ExecutionRequest): string[] {
  return validateExecutionRequest(req);
}

// ── Persist SI Decision ────────────────────────────────────────────
async function persistSIDecision(
  req: ExecutionRequest,
  signal: SuperSignal,
  gateAction: string,
  blockReasons: string[],
): Promise<number | undefined> {
  try {
    const rows = await db.insert(siDecisionsTable).values({
      symbol: req.symbol,
      setup_type: req.setup_type,
      direction: req.direction,
      regime: req.regime,
      approved: signal.approved,
      win_probability: String(signal.win_probability),
      edge_score: String(signal.edge_score),
      enhanced_quality: String(signal.enhanced_quality),
      kelly_fraction: String(signal.kelly_fraction),
      confluence_score: String(signal.confluence_score),
      suggested_qty: signal.suggested_qty,
      rejection_reason: signal.rejection_reason ?? null,
      entry_price: String(req.entry_price),
      stop_loss: String(req.stop_loss),
      take_profit: String(req.take_profit),
      final_quality: String(signal.enhanced_quality),
      gate_action: gateAction,
      gate_block_reasons: blockReasons.length > 0 ? blockReasons.join("; ") : null,      trailing_stop_json: signal.trailing_stop ? JSON.stringify(signal.trailing_stop) : null,
      profit_targets_json: signal.profit_targets ? JSON.stringify(signal.profit_targets) : null,
    }).returning({ id: siDecisionsTable.id });

    return rows[0]?.id;
  } catch (err) {
    logger.error({ err, symbol: req.symbol }, "Failed to persist SI decision");
    return undefined;
  }
}

// ── Execution Log Management ──────────────────────────────────────

function recordExecutionLog(entry: ExecutionLogEntry): void {
  try {
    persistAppend("execution_log", entry, 5000);
  } catch (err) {
    logger.warn({ err }, "Failed to record execution log entry");
  }
}

export function getExecutionLog(symbol?: string, limit: number = 100): ExecutionLogEntry[] {
  try {
    const log = persistRead<ExecutionLogEntry[]>("execution_log", []);
    let filtered = log;
    if (symbol) {
      filtered = log.filter((entry) => entry.symbol === symbol);
    }
    return filtered.slice(-limit);
  } catch (err) {
    logger.warn({ err }, "Failed to retrieve execution log");
    return [];
  }
}

export function executionHealthCheck(): ExecutionHealthCheck {
  try {
    const log = persistRead<ExecutionLogEntry[]>("execution_log", []);
    const total = log.length;
    const successful = log.filter((e) => e.success).length;
    const failed = total - successful;
    const errorRate = total > 0 ? (failed / total) * 100 : 0;

    // Calculate average latency
    const avgLatency = total > 0
      ? log.reduce((sum, e) => sum + e.duration_ms, 0) / total
      : 0;

    // Get pending orders (recent unsuccessful executions)
    const pending = log.filter(
      (e) => !e.success && !e.error_message?.includes("blocked"),
    ).length;

    return {
      pending_orders: pending,
      avg_latency_ms: Math.round(avgLatency),
      error_rate_pct: Math.round(errorRate * 100) / 100,
      total_execution_attempts: total,
      successful_executions: successful,
      failed_executions: failed,
      last_execution_at: log.length > 0 ? log[log.length - 1].timestamp : null,
    };
  } catch (err) {
    logger.warn({ err }, "Failed to compute execution health check");
    return {
      pending_orders: 0,
      avg_latency_ms: 0,
      error_rate_pct: 0,
      total_execution_attempts: 0,
      successful_executions: 0,
      failed_executions: 0,
      last_execution_at: null,
    };
  }
}

// ── Main Execution Function ────────────────────────────────────────

export async function executeOrder(req: ExecutionRequest): Promise<ExecutionResult> {
  const logCtx = { symbol: req.symbol, side: req.side, qty: req.quantity, setup: req.setup_type };
  const startTime = Date.now();

  // 1. Pre-flight validation
  const errors = validatePreFlight(req);
  if (errors.length > 0) {
    logger.warn({ ...logCtx, errors }, "Pre-flight validation failed");
    const duration = Date.now() - startTime;
    recordExecutionLog({
      timestamp: new Date().toISOString(),
      symbol: req.symbol,
      side: req.side,
      quantity: req.quantity,
      execution_mode: "dry_run",
      success: false,
      error_message: errors[0],
      duration_ms: duration,
    });
    return {
      executed: false,
      mode: "dry_run",
      error: errors.join("; "),
      details: { validation_errors: errors },
    };
  }
  // 2. Persist SI decision BEFORE placing order
  const siDecisionId = await persistSIDecision(
    req, req.decision.signal, req.decision.action, req.decision.block_reasons,
  );
  logger.info({ ...logCtx, siDecisionId }, "SI decision persisted");

  // 3. Mode check — can we actually write orders?
  if (!canWriteOrders(SYSTEM_MODE)) {
    logger.info({ ...logCtx, mode: SYSTEM_MODE }, "Dry run — order writing disabled");
    const duration = Date.now() - startTime;
    recordExecutionLog({
      timestamp: new Date().toISOString(),
      symbol: req.symbol,
      side: req.side,
      quantity: req.quantity,
      execution_mode: "dry_run",
      success: false,
      error_message: "Order writing not enabled",
      duration_ms: duration,
    });
    return {
      executed: false,
      mode: "dry_run",
      si_decision_id: siDecisionId,
      details: { system_mode: SYSTEM_MODE, reason: "Order writing not enabled" },
    };
  }

  // 4. Live mode requires operator token
  if (isLiveMode(SYSTEM_MODE)) {
    if (!OPERATOR_TOKEN) {
      logger.error(logCtx, "Live mode but no GODSVIEW_OPERATOR_TOKEN configured");
      alertKillSwitch("Live mode without operator token", "order_executor");
      const duration = Date.now() - startTime;
      recordExecutionLog({
        timestamp: new Date().toISOString(),
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        execution_mode: "live",
        success: false,
        error_message: "Operator token required for live trading",
        duration_ms: duration,
      });
      return {
        executed: false,
        mode: "live",
        si_decision_id: siDecisionId,
        error: "Operator token required for live trading",
        details: {},
      };
    }
    if (req.operator_token !== OPERATOR_TOKEN) {
      logger.warn(logCtx, "Invalid operator token for live execution");
      const duration = Date.now() - startTime;
      recordExecutionLog({
        timestamp: new Date().toISOString(),
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        execution_mode: "live",
        success: false,
        error_message: "Invalid operator token",
        duration_ms: duration,
      });
      return {
        executed: false,
        mode: "live",
        si_decision_id: siDecisionId,
        error: "Invalid operator token",
        details: {},
      };
    }
  }

  // 5. Place order via Alpaca
  const mode = isLiveMode(SYSTEM_MODE) ? "live" as const : "paper" as const;
  try {
    const { placeOrder } = await import("./alpaca");
    const order = await placeOrder({
      symbol: req.symbol,
      qty: req.quantity,
      side: req.side,
      type: "limit",
      limit_price: req.entry_price,
      time_in_force: "day",
    });

    const duration = Date.now() - startTime;
    recordExecutionLog({
      timestamp: new Date().toISOString(),
      symbol: req.symbol,
      side: req.side,
      quantity: req.quantity,
      order_type: "limit",
      execution_mode: mode,
      success: true,
      order_id: order?.id,
      duration_ms: duration,
    });

    logger.info(
      { ...logCtx, orderId: order?.id, mode },
      "Order placed successfully",
    );

    // Update metrics
    try {
      const { tradesExecutedTotal } = await import("./metrics");
      tradesExecutedTotal.inc({ mode, symbol: req.symbol, setup: req.setup_type });
    } catch { /* metrics not critical */ }

    return {
      executed: true,
      order_id: order?.id,
      mode,
      si_decision_id: siDecisionId,
      details: {
        symbol: req.symbol,
        side: req.side,
        quantity: req.quantity,
        entry_price: req.entry_price,
        submitted_limit_price: req.entry_price,
        filled_avg_price: order?.filled_avg_price ? Number(order.filled_avg_price) : null,
        broker_status: order?.status ?? null,
        stop_loss: req.stop_loss,
        take_profit: req.take_profit,
        kelly_pct: req.decision.meta.kelly_pct,
        win_probability: req.decision.meta.win_probability,
        edge_score: req.decision.meta.edge_score,
      },
    };
  } catch (err: any) {
    const duration = Date.now() - startTime;
    recordExecutionLog({
      timestamp: new Date().toISOString(),
      symbol: req.symbol,
      side: req.side,
      quantity: req.quantity,
      execution_mode: mode,
      success: false,
      error_message: err.message ?? "Unknown execution error",
      duration_ms: duration,
    });
    logger.error({ ...logCtx, err, mode }, "Order placement failed");
    return {
      executed: false,
      mode,
      si_decision_id: siDecisionId,
      error: err.message ?? "Unknown execution error",
      details: { raw_error: String(err) },
    };
  }
}

/** Get the current execution mode */
export function getExecutionMode(): { mode: string; canWrite: boolean; isLive: boolean } {
  return {
    mode: SYSTEM_MODE,
    canWrite: canWriteOrders(SYSTEM_MODE),
    isLive: isLiveMode(SYSTEM_MODE),
  };
}
