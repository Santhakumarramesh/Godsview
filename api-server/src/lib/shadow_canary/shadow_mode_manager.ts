/**
 * shadow_mode_manager.ts — Shadow Mode & Hypothetical Order Tracking
 *
 * Manages shadow sessions that track hypothetical trades without actual execution.
 * Used for strategy validation and performance comparison before live canary deployment.
 *
 * Features:
 *   - Create isolated shadow sessions per strategy/symbol
 *   - Record hypothetical orders with market prices at signal, 1m, 5m
 *   - Automatic profit/loss calculation against actual market outcomes
 *   - Session lifecycle: active → completed/aborted
 */

import { randomUUID } from "crypto";
import { logger as _logger } from "../logger";

const logger = _logger.child({ module: "shadow_mode" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type ShadowSessionStatus = "active" | "completed" | "aborted";
export type ShadowMode = "shadow" | "canary";
export type OrderSide = "buy" | "sell";

export interface HypotheticalOrder {
  order_id: string;
  side: OrderSide;
  quantity: number;
  price: number;
  timestamp: string;
  market_price_at_signal: number;
  market_price_after_1m: number | null;
  market_price_after_5m: number | null;
  would_have_profit: boolean | null;
}

export interface ComparisonResult {
  hypothetical_pnl: number;
  hypothetical_return_pct: number;
  actual_market_return_pct: number;
  accuracy_score: number; // 0-1: how well the order matched actual market move
  timing_quality: string; // "early" | "perfect" | "late" | "missed"
}

export interface ShadowSession {
  session_id: string;
  strategy_id: string;
  symbol: string;
  status: ShadowSessionStatus;
  mode: ShadowMode;
  hypothetical_orders: HypotheticalOrder[];
  actual_market_outcomes: Array<{
    timestamp: string;
    price: number;
    volume?: number;
  }>;
  comparison_results: ComparisonResult | null;
  pnl_if_executed: number;
  created_at: string;
  completed_at: string | null;
}

// ─── State ────────────────────────────────────────────────────────────────────

const _sessions = new Map<string, ShadowSession>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new shadow session for a strategy/symbol pair.
 */
export function createShadowSession(opts: {
  strategy_id: string;
  symbol: string;
  mode?: ShadowMode;
}): { success: boolean; data?: ShadowSession; error?: string } {
  try {
    const session_id = `shd_${randomUUID()}`;
    const now = new Date().toISOString();

    const session: ShadowSession = {
      session_id,
      strategy_id: opts.strategy_id,
      symbol: opts.symbol,
      status: "active",
      mode: opts.mode ?? "shadow",
      hypothetical_orders: [],
      actual_market_outcomes: [],
      comparison_results: null,
      pnl_if_executed: 0,
      created_at: now,
      completed_at: null,
    };

    _sessions.set(session_id, session);
    logger.info(`[shadow] Created session ${session_id} for ${opts.strategy_id}/${opts.symbol}`);

    return { success: true, data: session };
  } catch (err) {
    logger.error({ err }, "[shadow] createShadowSession error");
    return { success: false, error: String(err) };
  }
}

/**
 * Add a hypothetical order to an active session.
 */
export function addHypotheticalOrder(
  session_id: string,
  order: Omit<HypotheticalOrder, "order_id">
): { success: boolean; data?: HypotheticalOrder; error?: string } {
  try {
    const session = _sessions.get(session_id);
    if (!session) {
      return { success: false, error: "session_not_found" };
    }

    if (session.status !== "active") {
      return { success: false, error: "session_not_active" };
    }

    const order_id = `ord_${randomUUID()}`;
    const hyp_order: HypotheticalOrder = {
      ...order,
      order_id,
    };

    session.hypothetical_orders.push(hyp_order);

    // Update session PnL based on signal price vs market at signal
    const pnl = calculateOrderPnL(hyp_order);
    session.pnl_if_executed += pnl;

    logger.info(
      `[shadow] Added order ${order_id} to session ${session_id}: ${order.side} ${order.quantity} @ ${order.price}`
    );

    return { success: true, data: hyp_order };
  } catch (err) {
    logger.error({ err }, "[shadow] addHypotheticalOrder error");
    return { success: false, error: String(err) };
  }
}

/**
 * Record actual market outcomes for the shadow session.
 */
export function recordMarketOutcome(
  session_id: string,
  outcome: { timestamp: string; price: number; volume?: number }
): { success: boolean; error?: string } {
  try {
    const session = _sessions.get(session_id);
    if (!session) {
      return { success: false, error: "session_not_found" };
    }

    if (session.status !== "active") {
      return { success: false, error: "session_not_active" };
    }

    session.actual_market_outcomes.push(outcome);
    logger.info(`[shadow] Recorded market outcome for ${session_id}: ${outcome.price} @ ${outcome.timestamp}`);

    return { success: true };
  } catch (err) {
    logger.error({ err }, "[shadow] recordMarketOutcome error");
    return { success: false, error: String(err) };
  }
}

/**
 * Complete a shadow session and calculate comparison results.
 */
export function completeShadowSession(
  session_id: string,
  status: "completed" | "aborted" = "completed"
): { success: boolean; data?: ShadowSession; error?: string } {
  try {
    const session = _sessions.get(session_id);
    if (!session) {
      return { success: false, error: "session_not_found" };
    }

    if (session.status !== "active") {
      return { success: false, error: "session_not_active" };
    }

    session.status = status;
    session.completed_at = new Date().toISOString();

    // Calculate comparison results if we have data
    if (session.hypothetical_orders.length > 0 && session.actual_market_outcomes.length > 0) {
      const comparison = calculateComparison(session);
      session.comparison_results = comparison;
    }

    logger.info(`[shadow] Completed session ${session_id} with status ${status}`);

    return { success: true, data: session };
  } catch (err) {
    logger.error({ err }, "[shadow] completeShadowSession error");
    return { success: false, error: String(err) };
  }
}

/**
 * Get a single shadow session by ID.
 */
export function getShadowSession(session_id: string): ShadowSession | null {
  return _sessions.get(session_id) ?? null;
}

/**
 * Get all shadow sessions for a specific strategy.
 */
export function getShadowSessionsByStrategy(strategy_id: string): ShadowSession[] {
  return Array.from(_sessions.values()).filter((s) => s.strategy_id === strategy_id);
}

/**
 * Get all active shadow sessions.
 */
export function getActiveShadowSessions(): ShadowSession[] {
  return Array.from(_sessions.values()).filter((s) => s.status === "active");
}

/**
 * Get all shadow sessions.
 */
export function getAllShadowSessions(): ShadowSession[] {
  return Array.from(_sessions.values());
}

/**
 * Clear all sessions (for testing).
 */
export function _clearSessions(): void {
  _sessions.clear();
  logger.info("[shadow] Cleared all sessions");
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function calculateOrderPnL(order: HypotheticalOrder): number {
  const entryPrice = order.price;
  const market5mPrice = order.market_price_after_5m ?? order.market_price_after_1m ?? order.market_price_at_signal;

  if (!market5mPrice) return 0;

  const priceDiff = market5mPrice - entryPrice;
  const pnl = order.side === "buy" ? priceDiff * order.quantity : -priceDiff * order.quantity;

  return pnl;
}

function calculateComparison(session: ShadowSession): ComparisonResult {
  const firstOrderPrice = session.hypothetical_orders[0]?.price ?? 0;
  const lastMarketPrice = session.actual_market_outcomes[session.actual_market_outcomes.length - 1]?.price ?? 0;

  const hypothetical_pnl = session.pnl_if_executed;
  const hypothetical_return_pct = firstOrderPrice ? (hypothetical_pnl / (firstOrderPrice * session.hypothetical_orders[0].quantity)) * 100 : 0;

  const firstMarketPrice = session.actual_market_outcomes[0]?.price ?? firstOrderPrice;
  const actual_market_return_pct = firstMarketPrice ? ((lastMarketPrice - firstMarketPrice) / firstMarketPrice) * 100 : 0;

  // Accuracy: how close hypothetical return is to actual return
  const returnDiff = Math.abs(hypothetical_return_pct - actual_market_return_pct);
  const accuracy_score = Math.max(0, 1 - returnDiff / 100);

  // Timing quality
  let timing_quality = "missed";
  if (session.hypothetical_orders.length > 0) {
    const orderTime = new Date(session.hypothetical_orders[0].timestamp).getTime();
    const outcomeTime = new Date(session.actual_market_outcomes[0]?.timestamp ?? "").getTime();
    const timeDiff = Math.abs(orderTime - outcomeTime);

    if (timeDiff < 60000) {
      timing_quality = hypothetical_pnl > 0 ? "perfect" : "early";
    } else if (timeDiff < 300000) {
      timing_quality = "late";
    }
  }

  return {
    hypothetical_pnl,
    hypothetical_return_pct,
    actual_market_return_pct,
    accuracy_score,
    timing_quality,
  };
}
