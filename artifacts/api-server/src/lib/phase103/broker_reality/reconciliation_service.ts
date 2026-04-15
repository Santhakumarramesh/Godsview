/**
 * Phase 103 — Reconciliation Service
 * ==================================
 * Compares internal lifecycle state against broker-reported state and
 * emits structured drift records. Designed to run on every WS message
 * and on a periodic poll, so divergence between expected and realized
 * positions/PnL is surfaced immediately.
 */

import { OrderLifecycle, OrderRecord } from "./order_lifecycle.js";

export interface BrokerSnapshot {
  positions: Array<{
    symbol: string;
    qty: number;
    avg_price: number;
    realized_pnl?: number;
    unrealized_pnl?: number;
  }>;
  orders: Array<{
    client_order_id?: string;
    broker_order_id: string;
    symbol: string;
    qty: number;
    filled_qty: number;
    avg_fill_price: number;
    status: string;
  }>;
  cash?: number;
  equity?: number;
  timestamp: number;
}

export interface InternalPosition {
  symbol: string;
  qty: number;
  avg_price: number;
}

export interface DriftRecord {
  symbol: string;
  field: "qty" | "avg_price" | "fill_state" | "missing_internal" | "missing_broker";
  internal: number | string | null;
  broker: number | string | null;
  delta?: number;
  severity: "info" | "warn" | "critical";
  message: string;
  timestamp: number;
}

export interface ReconciliationReport {
  timestamp: number;
  total_drifts: number;
  critical_count: number;
  drifts: DriftRecord[];
  expected_pnl: number;
  broker_pnl: number;
  pnl_delta: number;
}

const QTY_TOLERANCE = 1e-6;
const PRICE_TOLERANCE_BPS = 5; // 0.05% — broker rounding tolerance

export class ReconciliationService {
  constructor(
    private readonly lifecycle: OrderLifecycle,
    private readonly internalPositions: () => InternalPosition[],
    private readonly expectedPnL: () => number,
  ) {}

  reconcile(snap: BrokerSnapshot): ReconciliationReport {
    const drifts: DriftRecord[] = [];
    const ts = snap.timestamp || Date.now();

    const intPos = new Map<string, InternalPosition>();
    for (const p of this.internalPositions()) intPos.set(p.symbol, p);

    const brkPos = new Map<string, BrokerSnapshot["positions"][number]>();
    for (const p of snap.positions) brkPos.set(p.symbol, p);

    // Position diffs
    const allSymbols = new Set<string>([...intPos.keys(), ...brkPos.keys()]);
    for (const sym of allSymbols) {
      const i = intPos.get(sym);
      const b = brkPos.get(sym);
      if (i && !b) {
        if (Math.abs(i.qty) > QTY_TOLERANCE) {
          drifts.push({
            symbol: sym,
            field: "missing_broker",
            internal: i.qty,
            broker: null,
            severity: "critical",
            message: `Position ${sym} qty=${i.qty} present internally but missing at broker`,
            timestamp: ts,
          });
        }
        continue;
      }
      if (!i && b) {
        if (Math.abs(b.qty) > QTY_TOLERANCE) {
          drifts.push({
            symbol: sym,
            field: "missing_internal",
            internal: null,
            broker: b.qty,
            severity: "critical",
            message: `Position ${sym} qty=${b.qty} present at broker but missing internally`,
            timestamp: ts,
          });
        }
        continue;
      }
      if (i && b) {
        const dq = Math.abs(i.qty - b.qty);
        if (dq > QTY_TOLERANCE) {
          drifts.push({
            symbol: sym,
            field: "qty",
            internal: i.qty,
            broker: b.qty,
            delta: i.qty - b.qty,
            severity: dq > 1 ? "critical" : "warn",
            message: `Quantity drift on ${sym}: internal=${i.qty} broker=${b.qty}`,
            timestamp: ts,
          });
        }
        if (Math.abs(b.qty) > QTY_TOLERANCE && b.avg_price > 0) {
          const ref = (i.avg_price + b.avg_price) / 2;
          const bps = ref > 0 ? (Math.abs(i.avg_price - b.avg_price) / ref) * 10_000 : 0;
          if (bps > PRICE_TOLERANCE_BPS) {
            drifts.push({
              symbol: sym,
              field: "avg_price",
              internal: i.avg_price,
              broker: b.avg_price,
              delta: i.avg_price - b.avg_price,
              severity: bps > 25 ? "critical" : "warn",
              message: `Avg price drift on ${sym}: internal=${i.avg_price} broker=${b.avg_price} (${bps.toFixed(1)}bps)`,
              timestamp: ts,
            });
          }
        }
      }
    }

    // Order-state diffs
    const internalById = new Map<string, OrderRecord>();
    for (const o of this.lifecycle.list()) {
      if (o.broker_order_id) internalById.set(o.broker_order_id, o);
    }
    for (const bo of snap.orders) {
      const internal = internalById.get(bo.broker_order_id);
      if (!internal) {
        drifts.push({
          symbol: bo.symbol,
          field: "missing_internal",
          internal: null,
          broker: bo.broker_order_id,
          severity: "warn",
          message: `Broker order ${bo.broker_order_id} not tracked internally`,
          timestamp: ts,
        });
        continue;
      }
      const dq = Math.abs(internal.filled_qty - bo.filled_qty);
      if (dq > QTY_TOLERANCE) {
        drifts.push({
          symbol: bo.symbol,
          field: "fill_state",
          internal: internal.filled_qty,
          broker: bo.filled_qty,
          delta: internal.filled_qty - bo.filled_qty,
          severity: dq > 1 ? "critical" : "warn",
          message: `Fill drift on order ${bo.broker_order_id}`,
          timestamp: ts,
        });
      }
    }

    const expectedPnl = this.expectedPnL();
    const brokerPnl = snap.positions.reduce(
      (acc, p) => acc + (p.realized_pnl ?? 0) + (p.unrealized_pnl ?? 0),
      0,
    );

    return {
      timestamp: ts,
      total_drifts: drifts.length,
      critical_count: drifts.filter((d) => d.severity === "critical").length,
      drifts,
      expected_pnl: expectedPnl,
      broker_pnl: brokerPnl,
      pnl_delta: expectedPnl - brokerPnl,
    };
  }
}

/** Convenience factory wired to the lifecycle singleton + a positions provider. */
export function createReconciliationService(
  lifecycle: OrderLifecycle,
  positions: () => InternalPosition[],
  expectedPnL: () => number,
): ReconciliationService {
  return new ReconciliationService(lifecycle, positions, expectedPnL);
}
