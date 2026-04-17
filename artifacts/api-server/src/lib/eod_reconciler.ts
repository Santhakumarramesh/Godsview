/**
 * EOD Reconciler — End-of-day reconciliation between local order state and broker.
 *
 * Compares:
 * 1. Local open orders against Alpaca open orders
 * 2. Local position counts against Alpaca positions
 * 3. Detects orphaned orders (local without broker match)
 * 4. Detects unknown positions (broker without local order)
 * 5. Validates quantity consistency
 *
 * Logs all discrepancies to reconciliation_events table and audit_events.
 */

import { logger } from "./logger";
import {
  getOpenOrders,
  recordReconciliationEvent,
} from "./execution_store";

interface BrokerPosition {
  symbol: string;
  qty: number;
  side: string;
  avg_entry_price: number;
}

interface ReconciliationResult {
  status: "clean" | "discrepancy_found" | "error";
  local_position_count: number;
  broker_position_count: number;
  orphaned_local_orders: number;
  unknown_broker_positions: number;
  quantity_mismatches: number;
  details: {
    orphaned: Array<{ order_id: number; symbol: string; status: string }>;
    unknown: Array<{ symbol: string; qty: number }>;
    mismatches: Array<{ symbol: string; local_qty: number; broker_qty: number }>;
  };
}

/**
 * Run end-of-day reconciliation.
 * Should be called after market close or on a schedule.
 */
export async function runEodReconciliation(): Promise<ReconciliationResult> {
  const startTime = Date.now();
  logger.info("Starting EOD reconciliation");

  try {
    // 1. Get local open orders
    const localOrders = await getOpenOrders();

    // 2. Get broker positions and orders
    let brokerPositions: BrokerPosition[] = [];
    let brokerOrderIds = new Set<string>();

    try {
      const { getTypedPositions, getOrders } = await import("./alpaca");

      const positions = await getTypedPositions();
      brokerPositions = positions.map((p: any) => ({
        symbol: p.symbol,
        qty: Math.abs(Number(p.qty) || 0),
        side: Number(p.qty) > 0 ? "long" : "short",
        avg_entry_price: Number(p.avg_entry_price) || 0,
      }));

      const orders = await getOrders({ status: "open" });
      for (const o of orders) {
        if (o.id) brokerOrderIds.add(o.id);
      }
    } catch (err) {
      logger.error({ err }, "EOD reconciliation: failed to fetch broker state");
      const result: ReconciliationResult = {
        status: "error",
        local_position_count: localOrders.length,
        broker_position_count: 0,
        orphaned_local_orders: 0,
        unknown_broker_positions: 0,
        quantity_mismatches: 0,
        details: { orphaned: [], unknown: [], mismatches: [] },
      };
      await recordReconciliationEvent({
        event_type: "eod_reconciliation",
        status: "error",
        local_position_count: localOrders.length,
        broker_position_count: 0,
        details_json: JSON.stringify({ error: String(err) }),
      });
      return result;
    }

    // 3. Find orphaned local orders (local has broker_order_id but broker doesn't know it)
    const orphaned: Array<{ order_id: number; symbol: string; status: string }> = [];
    for (const order of localOrders) {
      if (order.broker_order_id && !brokerOrderIds.has(order.broker_order_id)) {
        orphaned.push({
          order_id: order.id,
          symbol: order.symbol,
          status: order.status,
        });
      }
    }

    // 4. Find unknown broker positions (broker has position but no matching local order)
    const localSymbols = new Set(localOrders.map(o => o.symbol));
    const unknown: Array<{ symbol: string; qty: number }> = [];
    for (const pos of brokerPositions) {
      if (!localSymbols.has(pos.symbol)) {
        unknown.push({ symbol: pos.symbol, qty: pos.qty });
      }
    }

    // 5. Quantity mismatches
    const mismatches: Array<{ symbol: string; local_qty: number; broker_qty: number }> = [];
    for (const pos of brokerPositions) {
      const matchingOrders = localOrders.filter(o => o.symbol === pos.symbol);
      if (matchingOrders.length > 0) {
        const localQty = matchingOrders.reduce((sum, o) => sum + (Number(o.filled_quantity) || 0), 0);
        if (Math.abs(localQty - pos.qty) > 0.01) {
          mismatches.push({
            symbol: pos.symbol,
            local_qty: localQty,
            broker_qty: pos.qty,
          });
        }
      }
    }

    const hasDiscrepancy = orphaned.length > 0 || unknown.length > 0 || mismatches.length > 0;
    const status = hasDiscrepancy ? "discrepancy_found" as const : "clean" as const;

    const result: ReconciliationResult = {
      status,
      local_position_count: localOrders.length,
      broker_position_count: brokerPositions.length,
      orphaned_local_orders: orphaned.length,
      unknown_broker_positions: unknown.length,
      quantity_mismatches: mismatches.length,
      details: { orphaned, unknown, mismatches },
    };

    // Persist to DB
    await recordReconciliationEvent({
      event_type: "eod_reconciliation",
      status,
      local_position_count: localOrders.length,
      broker_position_count: brokerPositions.length,
      orphaned_local_orders: orphaned.length,
      unknown_broker_positions: unknown.length,
      quantity_mismatches: mismatches.length,
      details_json: JSON.stringify(result.details),
    });

    const duration = Date.now() - startTime;
    if (hasDiscrepancy) {
      logger.warn({
        status,
        orphaned: orphaned.length,
        unknown: unknown.length,
        mismatches: mismatches.length,
        durationMs: duration,
      }, "EOD reconciliation found discrepancies");
    } else {
      logger.info({ status, durationMs: duration }, "EOD reconciliation clean");
    }

    return result;
  } catch (err) {
    logger.error({ err }, "EOD reconciliation failed");
    return {
      status: "error",
      local_position_count: 0,
      broker_position_count: 0,
      orphaned_local_orders: 0,
      unknown_broker_positions: 0,
      quantity_mismatches: 0,
      details: { orphaned: [], unknown: [], mismatches: [] },
    };
  }
}
