import { randomUUID } from "crypto";

export interface InternalOrder {
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  filled_quantity: number;
  avg_fill_price: number;
  status: "pending" | "partial" | "filled" | "canceled";
  strategy_id: string;
  submitted_at: string;
  last_updated: string;
}

export interface BrokerOrder {
  broker_order_id: string;
  internal_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  filled_quantity: number;
  avg_fill_price: number;
  status: "pending" | "partial" | "filled" | "canceled" | "rejected";
  reported_at: string;
}

export type ReconciliationStatus =
  | "matched"
  | "quantity_mismatch"
  | "price_mismatch"
  | "status_mismatch"
  | "missing_internal"
  | "missing_broker"
  | "position_drift";

export type SeverityLevel = "info" | "warning" | "critical" | "fatal";

export interface ReconciliationResult {
  id: string; // prefix "recon_"
  timestamp: string;
  internal_order_id: string;
  broker_order_id: string;
  status: ReconciliationStatus;
  internal_state: Partial<InternalOrder>;
  broker_state: Partial<BrokerOrder>;
  discrepancy_details: string;
  severity: SeverityLevel;
  auto_resolved: boolean;
  resolution_action?: string;
}

export interface PositionRecord {
  symbol: string;
  internal_quantity: number;
  broker_quantity: number;
  internal_cost_basis: number;
  broker_cost_basis: number;
  drift: number;
  drift_pct: number;
  last_reconciled: string;
}

export type OverallHealth = "healthy" | "degraded" | "critical";

export interface ReconciliationReport {
  id: string; // prefix "rr_"
  generated_at: string;
  period: string;
  total_orders_checked: number;
  matched: number;
  mismatches: ReconciliationResult[];
  position_drifts: PositionRecord[];
  overall_health: OverallHealth;
  auto_resolved_count: number;
}

export interface PnLSnapshot {
  strategy_id: string;
  internal_pnl: number;
  broker_pnl: number;
  divergence: number;
  divergence_pct: number;
  timestamp: string;
}

export class ExecutionReconciliationEngine {
  private internalOrders: Map<string, InternalOrder> = new Map();
  private brokerOrders: Map<string, BrokerOrder> = new Map();
  private reconciliationResults: Map<string, ReconciliationResult> = new Map();
  private reconciliationReports: Map<string, ReconciliationReport> = new Map();
  private positionRecords: Map<string, PositionRecord> = new Map();
  private pnlSnapshots: Map<string, PnLSnapshot[]> = new Map();

  registerInternalOrder(order: InternalOrder): void {
    this.internalOrders.set(order.order_id, order);
  }

  registerBrokerOrder(order: BrokerOrder): void {
    this.brokerOrders.set(order.broker_order_id, order);
  }

  reconcileOrder(internal_order_id: string): ReconciliationResult {
    const internalOrder = this.internalOrders.get(internal_order_id);
    const brokerOrder = Array.from(this.brokerOrders.values()).find(
      (bo) => bo.internal_order_id === internal_order_id
    );

    const timestamp = new Date().toISOString();
    const recon_id = `recon_${randomUUID()}`;

    let status: ReconciliationStatus;
    let discrepancy_details = "";
    let severity: SeverityLevel;
    let auto_resolved = false;

    if (!internalOrder && !brokerOrder) {
      // Should not happen in normal flow, but handle it
      status = "missing_internal";
      discrepancy_details = "No internal order found";
      severity = "critical";
    } else if (!internalOrder) {
      // Broker exists but internal doesn't
      status = "missing_internal";
      discrepancy_details = `Broker order exists but no internal order found for broker_order_id: ${brokerOrder!.broker_order_id}`;
      severity = "critical";
    } else if (!brokerOrder) {
      // Internal exists but broker doesn't
      status = "missing_broker";
      discrepancy_details = `Internal order exists but no broker order found for order_id: ${internalOrder.order_id}`;
      severity = "critical";
    } else {
      // Both exist, compare them
      const filled_qty_diff =
        internalOrder.filled_quantity !== brokerOrder.filled_quantity;
      const price_diff =
        internalOrder.avg_fill_price > 0
          ? Math.abs(
              (brokerOrder.avg_fill_price - internalOrder.avg_fill_price) /
                internalOrder.avg_fill_price
            ) * 100
          : 0;
      const price_mismatch = price_diff > 0.01;
      const status_mismatch = internalOrder.status !== brokerOrder.status;

      if (filled_qty_diff) {
        status = "quantity_mismatch";
        discrepancy_details = `Filled quantity mismatch: internal=${internalOrder.filled_quantity}, broker=${brokerOrder.filled_quantity}`;
        severity = "critical";
      } else if (price_mismatch) {
        status = "price_mismatch";
        discrepancy_details = `Avg fill price mismatch: internal=${internalOrder.avg_fill_price}, broker=${brokerOrder.avg_fill_price} (diff=${price_diff.toFixed(4)}%)`;
        severity = "warning";
      } else if (status_mismatch) {
        status = "status_mismatch";
        discrepancy_details = `Status mismatch: internal=${internalOrder.status}, broker=${brokerOrder.status}`;
        severity = "warning";
      } else {
        status = "matched";
        discrepancy_details = "Order state matches perfectly";
        severity = "info";
        auto_resolved = true;
      }
    }

    const result: ReconciliationResult = {
      id: recon_id,
      timestamp,
      internal_order_id,
      broker_order_id: brokerOrder?.broker_order_id || "",
      status,
      internal_state: internalOrder ? { ...internalOrder } : {},
      broker_state: brokerOrder ? { ...brokerOrder } : {},
      discrepancy_details,
      severity,
      auto_resolved,
    };

    this.reconciliationResults.set(recon_id, result);
    return result;
  }

  reconcileAllOrders(): ReconciliationResult[] {
    const results: ReconciliationResult[] = [];
    const allInternalOrderIds = Array.from(this.internalOrders.keys());

    for (const internal_order_id of allInternalOrderIds) {
      const result = this.reconcileOrder(internal_order_id);
      results.push(result);
    }

    return results;
  }

  registerPosition(
    symbol: string,
    internal_qty: number,
    broker_qty: number,
    internal_cost: number,
    broker_cost: number
  ): PositionRecord {
    const drift = broker_qty - internal_qty;
    const drift_pct =
      (drift / Math.max(Math.abs(internal_qty), 1)) * 100;

    const record: PositionRecord = {
      symbol,
      internal_quantity: internal_qty,
      broker_quantity: broker_qty,
      internal_cost_basis: internal_cost,
      broker_cost_basis: broker_cost,
      drift,
      drift_pct,
      last_reconciled: new Date().toISOString(),
    };

    this.positionRecords.set(symbol, record);
    return record;
  }

  reconcilePositions(): PositionRecord[] {
    return Array.from(this.positionRecords.values()).filter(
      (pos) => pos.drift !== 0
    );
  }

  recordPnLSnapshot(snapshot: PnLSnapshot): void {
    const { strategy_id } = snapshot;
    if (!this.pnlSnapshots.has(strategy_id)) {
      this.pnlSnapshots.set(strategy_id, []);
    }
    this.pnlSnapshots.get(strategy_id)!.push(snapshot);
  }

  getPnLDivergence(strategy_id: string): PnLSnapshot[] {
    return this.pnlSnapshots.get(strategy_id) || [];
  }

  generateReconciliationReport(period: string): ReconciliationReport {
    const results = this.reconcileAllOrders();
    const driftPositions = this.reconcilePositions();

    const matched = results.filter((r) => r.status === "matched").length;
    const mismatches = results.filter((r) => r.status !== "matched");
    const auto_resolved_count = results.filter(
      (r) => r.auto_resolved
    ).length;

    // Derive overall health
    let overall_health: OverallHealth = "healthy";
    const critical_count = results.filter((r) => r.severity === "critical")
      .length;
    const fatal_count = results.filter((r) => r.severity === "fatal").length;

    if (fatal_count > 0) {
      overall_health = "critical";
    } else if (critical_count > 0 || driftPositions.length > 0) {
      overall_health = "degraded";
    }

    const report: ReconciliationReport = {
      id: `rr_${randomUUID()}`,
      generated_at: new Date().toISOString(),
      period,
      total_orders_checked: results.length,
      matched,
      mismatches,
      position_drifts: driftPositions,
      overall_health,
      auto_resolved_count,
    };

    this.reconciliationReports.set(report.id, report);
    return report;
  }

  getReconciliationReport(id: string): ReconciliationReport | undefined {
    return this.reconciliationReports.get(id);
  }

  getAllReports(limit?: number): ReconciliationReport[] {
    const reports = Array.from(this.reconciliationReports.values());
    if (limit) {
      return reports.slice(-limit);
    }
    return reports;
  }

  getUnresolvedMismatches(): ReconciliationResult[] {
    return Array.from(this.reconciliationResults.values()).filter(
      (r) => r.status !== "matched" && !r.auto_resolved
    );
  }

  resolveDiscrepancy(
    recon_id: string,
    resolution: string
  ): { success: boolean; error?: string } {
    const result = this.reconciliationResults.get(recon_id);
    if (!result) {
      return {
        success: false,
        error: `Reconciliation result with id ${recon_id} not found`,
      };
    }

    result.auto_resolved = true;
    result.resolution_action = resolution;
    this.reconciliationResults.set(recon_id, result);

    return { success: true };
  }

  _clearReconciliation(): void {
    this.internalOrders.clear();
    this.brokerOrders.clear();
    this.reconciliationResults.clear();
    this.reconciliationReports.clear();
    this.positionRecords.clear();
    this.pnlSnapshots.clear();
  }
}

export const engine = new ExecutionReconciliationEngine();
