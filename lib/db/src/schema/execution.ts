/**
 * Execution Truth Layer — persistent order, fill, metric, reconciliation schema.
 *
 * This is the ONLY orders/fills table in the workspace. It replaces the
 * earlier legacy orders.ts stub and is the source of truth for:
 *   - Order lifecycle (intent_created -> submitted -> filled/etc.)
 *   - Fill events with dedup by broker_fill_id
 *   - Post-execution metrics (slippage, latency, VWAP)
 *   - EOD / mid-session reconciliation events
 *
 * All tables use serial integer primary keys so execution_store.ts can
 * reference orders by numeric `id`. An `order_uuid` column gives an
 * idempotent external handle used by MCP/UI/broker bridge code.
 */

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── Orders ───────────────────────────────────────────────────────────────────

export const ordersTable = pgTable(
  "orders_v2",
  {
    id: serial("id").primaryKey(),
    order_uuid: text("order_uuid").notNull(),
    broker_order_id: text("broker_order_id"),
    strategy_id: text("strategy_id").notNull(),
    execution_mode: text("execution_mode").notNull().default("paper"),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    order_type: text("order_type").notNull().default("market"),
    quantity: numeric("quantity").notNull(),
    limit_price: numeric("limit_price"),
    stop_price: numeric("stop_price"),
    expected_entry_price: numeric("expected_entry_price"),
    status: text("status").notNull().default("intent_created"),
    rejection_reason: text("rejection_reason"),
    filled_quantity: numeric("filled_quantity").notNull().default("0"),
    avg_fill_price: numeric("avg_fill_price"),
    total_commission: numeric("total_commission").notNull().default("0"),
    regime: text("regime"),
    setup_type: text("setup_type"),
    signal_id: text("signal_id"),
    metadata: jsonb("metadata").default({}).notNull(),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    first_fill_at: timestamp("first_fill_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_orders_order_uuid").on(table.order_uuid),
    index("idx_orders_broker_order_id").on(table.broker_order_id),
    index("idx_orders_strategy_id").on(table.strategy_id),
    index("idx_orders_symbol_created").on(table.symbol, table.created_at),
    index("idx_orders_status").on(table.status),
    index("idx_orders_completed_at").on(table.completed_at),
  ]
);

export type Order = typeof ordersTable.$inferSelect;
export type NewOrder = typeof ordersTable.$inferInsert;
export type InsertOrder = typeof ordersTable.$inferInsert;

// ── Fills ────────────────────────────────────────────────────────────────────

export const fillsTable = pgTable(
  "fills",
  {
    id: serial("id").primaryKey(),
    order_id: integer("order_id").notNull(),
    broker_fill_id: text("broker_fill_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    quantity: numeric("quantity").notNull(),
    price: numeric("price").notNull(),
    commission: numeric("commission").notNull().default("0"),
    slippage_bps: numeric("slippage_bps"),
    liquidity: text("liquidity"),
    venue: text("venue"),
    filled_at: timestamp("filled_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").default({}).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("idx_fills_broker_fill_id").on(table.broker_fill_id),
    index("idx_fills_order_id").on(table.order_id),
    index("idx_fills_symbol_filled_at").on(table.symbol, table.filled_at),
    index("idx_fills_filled_at").on(table.filled_at),
  ]
);

export type Fill = typeof fillsTable.$inferSelect;
export type NewFill = typeof fillsTable.$inferInsert;
export type InsertFill = typeof fillsTable.$inferInsert;

// ── Execution Metrics ────────────────────────────────────────────────────────

export const executionMetricsTable = pgTable(
  "execution_metrics",
  {
    id: serial("id").primaryKey(),
    order_id: integer("order_id").notNull(),
    symbol: text("symbol").notNull(),
    strategy_id: text("strategy_id").notNull(),
    execution_mode: text("execution_mode").notNull().default("paper"),
    total_fills: integer("total_fills").notNull().default(0),
    avg_fill_price: numeric("avg_fill_price").notNull(),
    expected_price: numeric("expected_price").notNull(),
    realized_slippage_bps: numeric("realized_slippage_bps").notNull(),
    submit_to_first_fill_ms: integer("submit_to_first_fill_ms"),
    submit_to_complete_ms: integer("submit_to_complete_ms"),
    regime: text("regime"),
    setup_type: text("setup_type"),
    order_outcome: text("order_outcome").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_exec_metrics_order_id").on(table.order_id),
    index("idx_exec_metrics_symbol_created").on(table.symbol, table.created_at),
    index("idx_exec_metrics_strategy_id").on(table.strategy_id),
    index("idx_exec_metrics_regime").on(table.regime),
  ]
);

export type ExecutionMetric = typeof executionMetricsTable.$inferSelect;
export type NewExecutionMetric = typeof executionMetricsTable.$inferInsert;
export type InsertExecutionMetric = typeof executionMetricsTable.$inferInsert;

// ── Reconciliation Events ────────────────────────────────────────────────────

export const reconciliationEventsTable = pgTable(
  "reconciliation_events",
  {
    id: serial("id").primaryKey(),
    event_type: text("event_type").notNull(),
    status: text("status").notNull(),
    local_orders_checked: integer("local_orders_checked").notNull().default(0),
    broker_positions_checked: integer("broker_positions_checked").notNull().default(0),
    orphaned_local_orders: integer("orphaned_local_orders").notNull().default(0),
    unknown_broker_positions: integer("unknown_broker_positions").notNull().default(0),
    mismatched_orders: integer("mismatched_orders").notNull().default(0),
    discrepancy_total_usd: numeric("discrepancy_total_usd").notNull().default("0"),
    details: jsonb("details").default({}).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_reconciliation_created_at").on(table.created_at),
    index("idx_reconciliation_event_type").on(table.event_type),
    index("idx_reconciliation_status").on(table.status),
  ]
);

export type ReconciliationEvent = typeof reconciliationEventsTable.$inferSelect;
export type NewReconciliationEvent = typeof reconciliationEventsTable.$inferInsert;
export type InsertReconciliationEvent = typeof reconciliationEventsTable.$inferInsert;
