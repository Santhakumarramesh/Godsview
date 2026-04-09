/**
 * ledger_store.ts — Execution Ledger Store
 *
 * In-memory store for tracking order lifecycle from signal creation through fills.
 * Each entry follows the complete order_lifecycle_status state machine.
 *
 * Lifecycle states:
 *   signal_created → approval_passed → order_submitted → broker_accepted →
 *   partially_filled → filled → [canceled → rejected → flattened → closed]
 */

import { randomUUID } from "crypto";
import { logger } from "../logger";

export type OrderLifecycleStatus =
  | "signal_created"
  | "approval_passed"
  | "order_submitted"
  | "broker_accepted"
  | "partially_filled"
  | "filled"
  | "canceled"
  | "rejected"
  | "flattened"
  | "closed";

export interface OrderTimestamps {
  signal_created: number;
  approval_passed?: number;
  order_submitted?: number;
  broker_accepted?: number;
  partially_filled?: number;
  filled?: number;
  canceled?: number;
  rejected?: number;
  flattened?: number;
  closed?: number;
}

export interface ExecutionLedgerEntry {
  entry_id: string;
  strategy_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_lifecycle_status: OrderLifecycleStatus;
  internal_order_id: string;
  broker_order_id?: string;
  signal_price: number;
  submitted_price?: number;
  fill_price?: number;
  fill_quantity: number;
  slippage_bps: number;
  timestamps: OrderTimestamps;
  decision_packet_id: string;
  session_id: string;
  metadata?: Record<string, unknown>;
}

export interface CreateEntryInput {
  strategy_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  signal_price: number;
  decision_packet_id: string;
  session_id: string;
  metadata?: Record<string, unknown>;
}

class ExecutionLedgerStore {
  private ledger: Map<string, ExecutionLedgerEntry> = new Map();

  /**
   * Create a new ledger entry
   */
  createEntry(input: CreateEntryInput): ExecutionLedgerEntry {
    const entry_id = `el_${randomUUID()}`;
    const internal_order_id = `io_${randomUUID()}`;
    const now = Date.now();

    const entry: ExecutionLedgerEntry = {
      entry_id,
      strategy_id: input.strategy_id,
      symbol: input.symbol,
      side: input.side,
      quantity: input.quantity,
      order_lifecycle_status: "signal_created",
      internal_order_id,
      broker_order_id: undefined,
      signal_price: input.signal_price,
      submitted_price: undefined,
      fill_price: undefined,
      fill_quantity: 0,
      slippage_bps: 0,
      timestamps: {
        signal_created: now,
      },
      decision_packet_id: input.decision_packet_id,
      session_id: input.session_id,
      metadata: input.metadata || {},
    };

    this.ledger.set(entry_id, entry);
    logger.debug({ entry_id, symbol: input.symbol }, "Ledger entry created");

    return entry;
  }

  /**
   * Update entry status with lifecycle validation
   */
  updateEntryStatus(
    entry_id: string,
    new_status: OrderLifecycleStatus,
    updates?: {
      broker_order_id?: string;
      submitted_price?: number;
      fill_price?: number;
      fill_quantity?: number;
    }
  ): ExecutionLedgerEntry | null {
    const entry = this.ledger.get(entry_id);
    if (!entry) {
      logger.warn({ entry_id }, "Entry not found for status update");
      return null;
    }

    // Validate state transition
    if (!this.isValidTransition(entry.order_lifecycle_status, new_status)) {
      logger.warn(
        { entry_id, from: entry.order_lifecycle_status, to: new_status },
        "Invalid lifecycle transition"
      );
      return null;
    }

    const now = Date.now();

    // Apply updates
    if (updates?.broker_order_id) {
      entry.broker_order_id = updates.broker_order_id;
    }
    if (updates?.submitted_price !== undefined) {
      entry.submitted_price = updates.submitted_price;
      if (entry.signal_price > 0) {
        entry.slippage_bps = Math.round(
          ((updates.submitted_price - entry.signal_price) / entry.signal_price) *
            10000
        );
      }
    }
    if (updates?.fill_price !== undefined) {
      entry.fill_price = updates.fill_price;
    }
    if (updates?.fill_quantity !== undefined) {
      entry.fill_quantity = updates.fill_quantity;
    }

    // Update status and timestamp
    entry.order_lifecycle_status = new_status;
    (entry.timestamps as Record<string, number>)[new_status] = now;

    logger.debug(
      { entry_id, symbol: entry.symbol, status: new_status },
      "Entry status updated"
    );

    return entry;
  }

  /**
   * Get single entry by ID
   */
  getEntry(entry_id: string): ExecutionLedgerEntry | null {
    return this.ledger.get(entry_id) || null;
  }

  /**
   * Get all entries for a strategy
   */
  getEntriesByStrategy(strategy_id: string): ExecutionLedgerEntry[] {
    return Array.from(this.ledger.values()).filter(
      (e) => e.strategy_id === strategy_id
    );
  }

  /**
   * Get all entries for a symbol
   */
  getEntriesBySymbol(symbol: string): ExecutionLedgerEntry[] {
    return Array.from(this.ledger.values()).filter((e) => e.symbol === symbol);
  }

  /**
   * Get open entries (not yet closed)
   */
  getOpenEntries(): ExecutionLedgerEntry[] {
    const closedStatuses: OrderLifecycleStatus[] = ["filled", "canceled", "rejected"];
    return Array.from(this.ledger.values()).filter(
      (e) => !closedStatuses.includes(e.order_lifecycle_status)
    );
  }

  /**
   * Get all entries
   */
  getAllEntries(): ExecutionLedgerEntry[] {
    return Array.from(this.ledger.values());
  }

  /**
   * Get entries by status
   */
  getEntriesByStatus(status: OrderLifecycleStatus): ExecutionLedgerEntry[] {
    return Array.from(this.ledger.values()).filter(
      (e) => e.order_lifecycle_status === status
    );
  }

  /**
   * Clear ledger (for testing)
   */
  _clearLedger(): void {
    this.ledger.clear();
    logger.debug("Ledger cleared");
  }

  /**
   * Validate state transition
   */
  private isValidTransition(from: OrderLifecycleStatus, to: OrderLifecycleStatus): boolean {
    const validTransitions: Record<OrderLifecycleStatus, OrderLifecycleStatus[]> = {
      signal_created: ["approval_passed"],
      approval_passed: ["order_submitted"],
      order_submitted: ["broker_accepted", "rejected"],
      broker_accepted: ["partially_filled", "filled", "canceled", "rejected"],
      partially_filled: ["partially_filled", "filled", "canceled", "rejected"],
      filled: ["flattened", "closed"],
      canceled: ["closed"],
      rejected: ["closed"],
      flattened: ["closed"],
      closed: [],
    };

    return validTransitions[from]?.includes(to) ?? false;
  }
}

export const executionLedgerStore = new ExecutionLedgerStore();
