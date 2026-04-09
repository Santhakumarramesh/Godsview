/**
 * reconciliation_service.ts — Broker Reconciliation Service
 *
 * Compares internal ledger state against broker-reported positions and orders.
 * Detects mismatches and generates reconciliation reports.
 */

import { randomUUID } from "crypto";
import { logger } from "../logger";
import { executionLedgerStore, ExecutionLedgerEntry } from "./ledger_store";

export type MismatchType =
  | "missing_order"
  | "quantity_mismatch"
  | "fill_price_mismatch"
  | "position_mismatch"
  | "stale_state";

export interface Mismatch {
  mismatch_id: string;
  type: MismatchType;
  entry_id?: string;
  internal_value?: unknown;
  broker_value?: unknown;
  severity: "low" | "medium" | "high" | "critical";
  details: string;
  detected_at: number;
}

export interface ReconciliationResult {
  recon_id: string;
  timestamp: number;
  entries_checked: number;
  mismatches_found: number;
  mismatches: Mismatch[];
  status: "clean" | "issues_found";
}

export interface BrokerOrder {
  broker_order_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  filled_quantity: number;
  fill_price?: number;
  status: string;
}

export interface BrokerPosition {
  symbol: string;
  quantity: number;
  avg_fill_price: number;
}

class ReconciliationService {
  private reconciliations: Map<string, ReconciliationResult> = new Map();
  private openMismatches: Map<string, Mismatch> = new Map();

  /**
   * Run reconciliation between internal ledger and broker state
   */
  runReconciliation(
    broker_orders: BrokerOrder[],
    broker_positions: BrokerPosition[]
  ): ReconciliationResult {
    const recon_id = `recon_${randomUUID()}`;
    const timestamp = Date.now();
    const mismatches: Mismatch[] = [];

    const internalEntries = executionLedgerStore.getAllEntries();
    const entries_checked = internalEntries.length;

    // Build broker order map for quick lookup
    const brokerOrderMap = new Map<string, BrokerOrder>();
    for (const order of broker_orders) {
      brokerOrderMap.set(order.broker_order_id, order);
    }

    // Build broker position map
    const brokerPositionMap = new Map<string, BrokerPosition>();
    for (const pos of broker_positions) {
      brokerPositionMap.set(pos.symbol, pos);
    }

    // Check each internal entry
    for (const entry of internalEntries) {
      // 1. Check for missing orders (orders in internal ledger but not in broker)
      if (entry.broker_order_id && !brokerOrderMap.has(entry.broker_order_id)) {
        if (
          ["order_submitted", "broker_accepted", "partially_filled", "filled"].includes(
            entry.order_lifecycle_status
          )
        ) {
          mismatches.push(
            this.createMismatch(
              "missing_order",
              entry.entry_id,
              entry.broker_order_id,
              "not_found_on_broker",
              "high",
              `Order ${entry.broker_order_id} missing from broker`,
              timestamp
            )
          );
        }
      }

      // 2. Check quantity mismatches
      if (entry.broker_order_id && brokerOrderMap.has(entry.broker_order_id)) {
        const brokerOrder = brokerOrderMap.get(entry.broker_order_id)!;
        if (entry.fill_quantity !== brokerOrder.filled_quantity) {
          mismatches.push(
            this.createMismatch(
              "quantity_mismatch",
              entry.entry_id,
              entry.fill_quantity,
              brokerOrder.filled_quantity,
              "high",
              `Quantity mismatch: internal=${entry.fill_quantity}, broker=${brokerOrder.filled_quantity}`,
              timestamp
            )
          );
        }
      }

      // 3. Check fill price mismatches (allow small variance)
      if (entry.fill_price && entry.broker_order_id && brokerOrderMap.has(entry.broker_order_id)) {
        const brokerOrder = brokerOrderMap.get(entry.broker_order_id)!;
        if (brokerOrder.fill_price) {
          const priceDiff = Math.abs(entry.fill_price - brokerOrder.fill_price);
          if (priceDiff > 0.01) {
            // More than 1 cent difference
            mismatches.push(
              this.createMismatch(
                "fill_price_mismatch",
                entry.entry_id,
                entry.fill_price,
                brokerOrder.fill_price,
                "medium",
                `Fill price mismatch: internal=${entry.fill_price}, broker=${brokerOrder.fill_price}`,
                timestamp
              )
            );
          }
        }
      }
    }

    // 4. Check position mismatches
    for (const [symbol, brokerPos] of brokerPositionMap.entries()) {
      const internalEntries = executionLedgerStore.getEntriesBySymbol(symbol);
      let internalQty = 0;

      for (const entry of internalEntries) {
        if (["filled", "partially_filled"].includes(entry.order_lifecycle_status)) {
          const direction = entry.side === "buy" ? 1 : -1;
          internalQty += entry.fill_quantity * direction;
        }
      }

      if (internalQty !== brokerPos.quantity) {
        mismatches.push(
          this.createMismatch(
            "position_mismatch",
            undefined,
            internalQty,
            brokerPos.quantity,
            "critical",
            `Position mismatch for ${symbol}: internal=${internalQty}, broker=${brokerPos.quantity}`,
            timestamp
          )
        );
      }
    }

    // 5. Check for stale states (entries stuck in intermediate states)
    const staleThreshold = 3600000; // 1 hour
    for (const entry of internalEntries) {
      const intermediateStates = ["order_submitted", "broker_accepted", "partially_filled"];
      if (intermediateStates.includes(entry.order_lifecycle_status)) {
        const lastUpdate =
          entry.timestamps[entry.order_lifecycle_status as keyof typeof entry.timestamps] || 0;
        if (timestamp - lastUpdate > staleThreshold) {
          mismatches.push(
            this.createMismatch(
              "stale_state",
              entry.entry_id,
              entry.order_lifecycle_status,
              `stale for ${Math.round((timestamp - lastUpdate) / 60000)} minutes`,
              "medium",
              `Entry ${entry.entry_id} stuck in ${entry.order_lifecycle_status}`,
              timestamp
            )
          );
        }
      }
    }

    // Store mismatches
    for (const mismatch of mismatches) {
      this.openMismatches.set(mismatch.mismatch_id, mismatch);
    }

    const result: ReconciliationResult = {
      recon_id,
      timestamp,
      entries_checked,
      mismatches_found: mismatches.length,
      mismatches,
      status: mismatches.length === 0 ? "clean" : "issues_found",
    };

    this.reconciliations.set(recon_id, result);
    logger.info(
      { recon_id, entries_checked, mismatches_found: mismatches.length },
      "Reconciliation completed"
    );

    return result;
  }

  /**
   * Get reconciliation result by ID
   */
  getReconciliation(recon_id: string): ReconciliationResult | null {
    return this.reconciliations.get(recon_id) || null;
  }

  /**
   * Get open mismatches
   */
  getOpenMismatches(): Mismatch[] {
    return Array.from(this.openMismatches.values());
  }

  /**
   * Get daily report (summary of reconciliations today)
   */
  getDailyReport(): {
    date: string;
    reconciliations_run: number;
    total_entries_checked: number;
    total_mismatches: number;
    high_severity_count: number;
    critical_severity_count: number;
    last_clean_run?: number;
  } {
    const now = Date.now();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const dayStartMs = dayStart.getTime();

    let reconciliations_run = 0;
    let total_entries_checked = 0;
    let total_mismatches = 0;
    let high_severity_count = 0;
    let critical_severity_count = 0;
    let last_clean_run: number | undefined;

    for (const recon of this.reconciliations.values()) {
      if (recon.timestamp >= dayStartMs) {
        reconciliations_run++;
        total_entries_checked += recon.entries_checked;
        total_mismatches += recon.mismatches_found;

        if (recon.status === "clean") {
          last_clean_run = recon.timestamp;
        }

        for (const mismatch of recon.mismatches) {
          if (mismatch.severity === "high") high_severity_count++;
          if (mismatch.severity === "critical") critical_severity_count++;
        }
      }
    }

    return {
      date: new Date(dayStartMs).toISOString().split("T")[0],
      reconciliations_run,
      total_entries_checked,
      total_mismatches,
      high_severity_count,
      critical_severity_count,
      last_clean_run,
    };
  }

  /**
   * Clear reconciliation history (for testing)
   */
  _clearReconciliations(): void {
    this.reconciliations.clear();
    this.openMismatches.clear();
    logger.debug("Reconciliations cleared");
  }

  /**
   * Helper to create a mismatch record
   */
  private createMismatch(
    type: MismatchType,
    entry_id: string | undefined,
    internal_value: unknown,
    broker_value: unknown,
    severity: "low" | "medium" | "high" | "critical",
    details: string,
    timestamp: number
  ): Mismatch {
    return {
      mismatch_id: `mm_${randomUUID()}`,
      type,
      entry_id,
      internal_value,
      broker_value,
      severity,
      details,
      detected_at: timestamp,
    };
  }
}

export const reconciliationService = new ReconciliationService();
