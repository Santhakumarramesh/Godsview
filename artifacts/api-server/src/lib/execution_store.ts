/**
 * Execution Store — Persistent DB-backed order and fill management.
 *
 * This module is the ONLY source of truth for order lifecycle and fill events.
 * All execution state survives restarts because it lives in PostgreSQL.
 *
 * Responsibilities:
 * 1. Create orders with intent_created status BEFORE broker submission
 * 2. Track order state transitions with timestamps
 * 3. Persist fills with deduplication by broker_fill_id
 * 4. Compute and persist execution metrics (slippage, latency)
 * 5. Support EOD reconciliation queries
 */

import { logger } from "./logger";
import {
  db,
  ordersTable,
  fillsTable,
  executionMetricsTable,
  reconciliationEventsTable,
} from "@workspace/db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type {
  Order,
  InsertOrder,
  Fill,
  InsertFill,
  ExecutionMetric,
  InsertExecutionMetric,
  InsertReconciliationEvent,
} from "@workspace/db";

// ── Valid Order Status Transitions ──────────────────────────────────

const VALID_TRANSITIONS: Record<string, string[]> = {
  intent_created: ["submitted", "cancelled"],
  submitted: ["accepted", "rejected", "cancelled", "expired"],
  accepted: ["partial_fill", "filled", "cancelled", "expired", "failed_reconciliation"],
  partial_fill: ["partial_fill", "filled", "cancelled", "failed_reconciliation"],
  // Terminal states: filled, cancelled, rejected, expired, failed_reconciliation
};

export function isValidTransition(from: string, to: string): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Order Operations ────────────────────────────────────────────────

/**
 * Create a new order with intent_created status.
 * MUST be called BEFORE submitting to broker.
 */
export async function createOrder(data: InsertOrder): Promise<Order | null> {
  try {
    const rows = await db.insert(ordersTable).values(data).returning();
    const order = rows[0] ?? null;
    if (order) {
      logger.info({
        order_id: order.id,
        order_uuid: order.order_uuid,
        symbol: order.symbol,
        side: order.side,
        status: order.status,
      }, "Order created (intent)");
    }
    return order;
  } catch (err) {
    logger.error({ err, symbol: data.symbol }, "Failed to create order");
    return null;
  }
}

/**
 * Transition order to a new status with validation.
 * Returns updated order or null if transition is invalid.
 */
export async function transitionOrder(
  orderId: number,
  newStatus: string,
  updates: Partial<{
    broker_order_id: string;
    submitted_at: Date;
    accepted_at: Date;
    first_fill_at: Date;
    completed_at: Date;
    filled_quantity: string;
    avg_fill_price: string;
    total_commission: string;
    rejection_reason: string;
    cancel_reason: string;
  }> = {},
): Promise<Order | null> {
  try {
    // Fetch current state
    const current = await db.select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId))
      .limit(1);

    if (current.length === 0) {
      logger.warn({ orderId, newStatus }, "Order not found for transition");
      return null;
    }

    const currentStatus = current[0].status;

    if (!isValidTransition(currentStatus, newStatus)) {
      logger.warn({
        orderId,
        currentStatus,
        newStatus,
      }, "Invalid order state transition");
      return null;
    }

    const rows = await db.update(ordersTable)
      .set({
        status: newStatus,
        updated_at: new Date(),
        ...updates,
      })
      .where(and(
        eq(ordersTable.id, orderId),
        eq(ordersTable.status, currentStatus), // Optimistic lock
      ))
      .returning();

    const updated = rows[0] ?? null;
    if (updated) {
      logger.info({
        order_id: orderId,
        from: currentStatus,
        to: newStatus,
        symbol: updated.symbol,
      }, "Order state transition");
    } else {
      logger.warn({ orderId, currentStatus, newStatus }, "Order transition failed (concurrent modification)");
    }
    return updated;
  } catch (err) {
    logger.error({ err, orderId, newStatus }, "Failed to transition order");
    return null;
  }
}

/**
 * Find order by broker_order_id.
 */
export async function findOrderByBrokerId(brokerOrderId: string): Promise<Order | null> {
  try {
    const rows = await db.select()
      .from(ordersTable)
      .where(eq(ordersTable.broker_order_id, brokerOrderId))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    logger.error({ err, brokerOrderId }, "Failed to find order by broker ID");
    return null;
  }
}

/**
 * Find order by local UUID.
 */
export async function findOrderByUuid(orderUuid: string): Promise<Order | null> {
  try {
    const rows = await db.select()
      .from(ordersTable)
      .where(eq(ordersTable.order_uuid, orderUuid))
      .limit(1);
    return rows[0] ?? null;
  } catch (err) {
    logger.error({ err, orderUuid }, "Failed to find order by UUID");
    return null;
  }
}

/**
 * Get open orders (non-terminal status).
 */
export async function getOpenOrders(symbol?: string): Promise<Order[]> {
  try {
    const terminalStatuses = ["filled", "cancelled", "rejected", "expired", "failed_reconciliation"];
    let query = db.select()
      .from(ordersTable)
      .where(
        sql`${ordersTable.status} NOT IN (${sql.join(terminalStatuses.map(s => sql`${s}`), sql`, `)})`,
      )
      .orderBy(desc(ordersTable.created_at))
      .limit(100);

    const rows = await query;
    if (symbol) {
      return rows.filter((r: any) => r.symbol === symbol);
    }
    return rows;
  } catch (err) {
    logger.error({ err }, "Failed to get open orders");
    return [];
  }
}

/**
 * Get recent orders for a symbol.
 */
export async function getRecentOrders(symbol: string, limit = 50): Promise<Order[]> {
  try {
    return await db.select()
      .from(ordersTable)
      .where(eq(ordersTable.symbol, symbol))
      .orderBy(desc(ordersTable.created_at))
      .limit(limit);
  } catch (err) {
    logger.error({ err, symbol }, "Failed to get recent orders");
    return [];
  }
}

// ── Fill Operations ─────────────────────────────────────────────────

/**
 * Record a fill with deduplication.
 * Returns the fill if inserted, null if duplicate.
 */
export async function recordFill(data: InsertFill): Promise<Fill | null> {
  try {
    // Check for duplicate by broker_fill_id
    const existing = await db.select({ id: fillsTable.id })
      .from(fillsTable)
      .where(eq(fillsTable.broker_fill_id, data.broker_fill_id))
      .limit(1);

    if (existing.length > 0) {
      return null; // Duplicate fill, skip
    }

    const rows = await db.insert(fillsTable).values(data).returning();
    const fill = rows[0] ?? null;
    if (fill) {
      logger.info({
        fill_id: fill.id,
        broker_fill_id: fill.broker_fill_id,
        symbol: fill.symbol,
        side: fill.side,
        quantity: fill.quantity,
        price: fill.price,
        slippage_bps: fill.slippage_bps,
      }, "Fill recorded");
    }
    return fill;
  } catch (err) {
    logger.error({ err, broker_fill_id: data.broker_fill_id }, "Failed to record fill");
    return null;
  }
}

/**
 * Get fills for a specific order.
 */
export async function getFillsForOrder(orderId: number): Promise<Fill[]> {
  try {
    return await db.select()
      .from(fillsTable)
      .where(eq(fillsTable.order_id, orderId))
      .orderBy(desc(fillsTable.filled_at));
  } catch (err) {
    logger.error({ err, orderId }, "Failed to get fills for order");
    return [];
  }
}

/**
 * Get today's fills.
 */
export async function getTodayFillsFromDb(): Promise<Fill[]> {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return await db.select()
      .from(fillsTable)
      .where(sql`${fillsTable.filled_at} >= ${today.toISOString()}`)
      .orderBy(desc(fillsTable.filled_at))
      .limit(500);
  } catch (err) {
    logger.error({ err }, "Failed to get today's fills");
    return [];
  }
}

/**
 * Compute slippage for a fill.
 */
export function computeSlippage(
  fillPrice: number,
  expectedPrice: number,
  side: "buy" | "sell",
): { slippage: number; slippage_bps: number } {
  // For buys: positive slippage = paid more than expected (unfavorable)
  // For sells: positive slippage = received less than expected (unfavorable)
  const rawSlippage = side === "buy"
    ? fillPrice - expectedPrice
    : expectedPrice - fillPrice;

  const slippageBps = expectedPrice > 0
    ? (rawSlippage / expectedPrice) * 10_000
    : 0;

  return {
    slippage: rawSlippage,
    slippage_bps: Math.round(slippageBps * 100) / 100,
  };
}

// ── Execution Metrics ───────────────────────────────────────────────

/**
 * Compute and persist execution metrics for a completed order.
 */
export async function computeAndPersistMetrics(orderId: number): Promise<ExecutionMetric | null> {
  try {
    const orderRows = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId)).limit(1);
    const order = orderRows[0];
    if (!order) return null;

    const fills = await getFillsForOrder(orderId);
    if (fills.length === 0) return null;

    // Compute volume-weighted average fill price
    let totalQtyPrice = 0;
    let totalQty = 0;
    for (const fill of fills) {
      const qty = Number(fill.quantity) || 0;
      const price = Number(fill.price) || 0;
      totalQtyPrice += qty * price;
      totalQty += qty;
    }
    const avgFillPrice = totalQty > 0 ? totalQtyPrice / totalQty : 0;
    const expectedPrice = Number(order.expected_entry_price) || 0;

    // Slippage
    const side = order.side as "buy" | "sell";
    const { slippage_bps } = computeSlippage(avgFillPrice, expectedPrice, side);

    // Latency
    const submittedAt = order.submitted_at ? new Date(order.submitted_at).getTime() : 0;
    const firstFillAt = order.first_fill_at ? new Date(order.first_fill_at).getTime() : 0;
    const completedAt = order.completed_at ? new Date(order.completed_at).getTime() : 0;

    const submitToFirstFillMs = submittedAt > 0 && firstFillAt > 0
      ? firstFillAt - submittedAt : null;
    const submitToCompleteMs = submittedAt > 0 && completedAt > 0
      ? completedAt - submittedAt : null;

    const metric: InsertExecutionMetric = {
      order_id: orderId,
      symbol: order.symbol,
      strategy_id: order.strategy_id,
      execution_mode: order.execution_mode,
      total_fills: fills.length,
      avg_fill_price: String(avgFillPrice),
      expected_price: String(expectedPrice),
      realized_slippage_bps: String(slippage_bps),
      submit_to_first_fill_ms: submitToFirstFillMs,
      submit_to_complete_ms: submitToCompleteMs,
      regime: order.regime,
      setup_type: order.setup_type,
      order_outcome: order.status,
    };

    const rows = await db.insert(executionMetricsTable).values(metric).returning();
    const result = rows[0] ?? null;

    if (result) {
      logger.info({
        order_id: orderId,
        symbol: order.symbol,
        avg_fill_price: avgFillPrice.toFixed(4),
        slippage_bps: slippage_bps.toFixed(2),
        total_fills: fills.length,
      }, "Execution metrics computed");
    }

    return result;
  } catch (err) {
    logger.error({ err, orderId }, "Failed to compute execution metrics");
    return null;
  }
}

// ── Reconciliation ──────────────────────────────────────────────────

/**
 * Record a reconciliation event.
 */
export async function recordReconciliationEvent(
  data: InsertReconciliationEvent,
): Promise<void> {
  try {
    await db.insert(reconciliationEventsTable).values(data);
    logger.info({
      event_type: data.event_type,
      status: data.status,
      orphaned: data.orphaned_local_orders,
      unknown: data.unknown_broker_positions,
    }, "Reconciliation event recorded");
  } catch (err) {
    logger.error({ err }, "Failed to record reconciliation event");
  }
}

// ── Slippage Report ─────────────────────────────────────────────────

export interface SlippageReport {
  symbol: string;
  total_orders: number;
  avg_slippage_bps: number;
  max_slippage_bps: number;
  min_slippage_bps: number;
  p50_slippage_bps: number;
  by_regime: Record<string, { avg_bps: number; count: number }>;
  by_setup: Record<string, { avg_bps: number; count: number }>;
}

export async function getSlippageReport(
  symbol?: string,
  days = 30,
): Promise<SlippageReport[]> {
  try {
    const since = new Date();
    since.setDate(since.getDate() - days);

    let metrics: ExecutionMetric[];
    if (symbol) {
      metrics = await db.select()
        .from(executionMetricsTable)
        .where(and(
          eq(executionMetricsTable.symbol, symbol),
          sql`${executionMetricsTable.created_at} >= ${since.toISOString()}`,
        ))
        .orderBy(desc(executionMetricsTable.created_at))
        .limit(1000);
    } else {
      metrics = await db.select()
        .from(executionMetricsTable)
        .where(sql`${executionMetricsTable.created_at} >= ${since.toISOString()}`)
        .orderBy(desc(executionMetricsTable.created_at))
        .limit(1000);
    }

    // Group by symbol
    const bySymbol = new Map<string, ExecutionMetric[]>();
    for (const m of metrics) {
      const arr = bySymbol.get(m.symbol) ?? [];
      arr.push(m);
      bySymbol.set(m.symbol, arr);
    }

    const reports: SlippageReport[] = [];
    for (const [sym, items] of bySymbol) {
      const slippages = items
        .map(i => Number(i.realized_slippage_bps) || 0)
        .sort((a, b) => a - b);

      const byRegime: Record<string, { total: number; count: number }> = {};
      const bySetup: Record<string, { total: number; count: number }> = {};

      for (const item of items) {
        const s = Number(item.realized_slippage_bps) || 0;
        const regime = item.regime ?? "unknown";
        const setup = item.setup_type ?? "unknown";

        byRegime[regime] = byRegime[regime] ?? { total: 0, count: 0 };
        byRegime[regime].total += s;
        byRegime[regime].count++;

        bySetup[setup] = bySetup[setup] ?? { total: 0, count: 0 };
        bySetup[setup].total += s;
        bySetup[setup].count++;
      }

      reports.push({
        symbol: sym,
        total_orders: items.length,
        avg_slippage_bps: slippages.length > 0
          ? slippages.reduce((a, b) => a + b, 0) / slippages.length : 0,
        max_slippage_bps: slippages.length > 0 ? slippages[slippages.length - 1] : 0,
        min_slippage_bps: slippages.length > 0 ? slippages[0] : 0,
        p50_slippage_bps: slippages.length > 0
          ? slippages[Math.floor(slippages.length / 2)] : 0,
        by_regime: Object.fromEntries(
          Object.entries(byRegime).map(([k, v]) => [k, { avg_bps: v.total / v.count, count: v.count }]),
        ),
        by_setup: Object.fromEntries(
          Object.entries(bySetup).map(([k, v]) => [k, { avg_bps: v.total / v.count, count: v.count }]),
        ),
      });
    }

    return reports;
  } catch (err) {
    logger.error({ err }, "Failed to generate slippage report");
    return [];
  }
}
