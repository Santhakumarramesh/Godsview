import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 12 — Execution truth persistence schema.
 *
 * Kept as a dedicated schema module because many API modules import these
 * exact table/type names from `@workspace/db`.
 */
export const ordersTable = pgTable(
  "orders",
  {
    id: serial("id").primaryKey(),
    order_uuid: text("order_uuid").notNull(),
    broker_order_id: text("broker_order_id"),
    signal_id: integer("signal_id"),
    si_decision_id: integer("si_decision_id"),
    strategy_id: text("strategy_id"),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    direction: text("direction").notNull(),
    order_type: text("order_type").notNull().default("limit"),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    limit_price: numeric("limit_price", { precision: 14, scale: 6 }),
    stop_price: numeric("stop_price", { precision: 14, scale: 6 }),
    target_price: numeric("target_price", { precision: 14, scale: 6 }),
    expected_entry_price: numeric("expected_entry_price", { precision: 14, scale: 6 }),
    status: text("status").notNull().default("intent_created"),
    execution_mode: text("execution_mode").notNull().default("paper"),
    idempotency_key: text("idempotency_key"),
    intent_at: timestamp("intent_at", { withTimezone: true }).notNull().defaultNow(),
    submitted_at: timestamp("submitted_at", { withTimezone: true }),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
    first_fill_at: timestamp("first_fill_at", { withTimezone: true }),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    filled_quantity: numeric("filled_quantity", { precision: 12, scale: 4 }).default("0"),
    avg_fill_price: numeric("avg_fill_price", { precision: 14, scale: 6 }),
    total_commission: numeric("total_commission", { precision: 10, scale: 4 }).default("0"),
    realized_pnl: numeric("realized_pnl", { precision: 14, scale: 4 }),
    rejection_reason: text("rejection_reason"),
    cancel_reason: text("cancel_reason"),
    error_message: text("error_message"),
    setup_type: text("setup_type"),
    regime: text("regime"),
    operator_notes: text("operator_notes"),
    metadata_json: text("metadata_json"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_orders_symbol_status").on(table.symbol, table.status),
    index("idx_orders_uuid").on(table.order_uuid),
    index("idx_orders_broker_id").on(table.broker_order_id),
    index("idx_orders_created").on(table.created_at),
  ],
);

export const fillsTable = pgTable(
  "fills",
  {
    id: serial("id").primaryKey(),
    order_id: integer("order_id"),
    broker_fill_id: text("broker_fill_id").notNull(),
    broker_order_id: text("broker_order_id"),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    quantity: numeric("quantity", { precision: 12, scale: 4 }).notNull(),
    price: numeric("price", { precision: 14, scale: 6 }).notNull(),
    commission: numeric("commission", { precision: 10, scale: 4 }).default("0"),
    expected_price: numeric("expected_price", { precision: 14, scale: 6 }),
    slippage: numeric("slippage", { precision: 10, scale: 6 }),
    slippage_bps: numeric("slippage_bps", { precision: 8, scale: 2 }),
    matched_to_position: boolean("matched_to_position").notNull().default(false),
    realized_pnl: numeric("realized_pnl", { precision: 14, scale: 4 }),
    filled_at: timestamp("filled_at", { withTimezone: true }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_fills_order_id").on(table.order_id),
    index("idx_fills_broker_fill_id").on(table.broker_fill_id),
    index("idx_fills_symbol_filled").on(table.symbol, table.filled_at),
  ],
);

export const executionMetricsTable = pgTable(
  "execution_metrics",
  {
    id: serial("id").primaryKey(),
    order_id: integer("order_id").notNull(),
    symbol: text("symbol").notNull(),
    strategy_id: text("strategy_id"),
    execution_mode: text("execution_mode"),
    total_fills: integer("total_fills").notNull().default(0),
    fill_count: integer("fill_count").notNull().default(1),
    avg_fill_price: numeric("avg_fill_price", { precision: 14, scale: 6 }),
    expected_price: numeric("expected_price", { precision: 14, scale: 6 }),
    realized_slippage_bps: numeric("realized_slippage_bps", { precision: 8, scale: 2 }),
    submit_to_first_fill_ms: integer("submit_to_first_fill_ms"),
    submit_to_complete_ms: integer("submit_to_complete_ms"),
    total_commission: numeric("total_commission", { precision: 10, scale: 4 }).default("0"),
    regime: text("regime"),
    setup_type: text("setup_type"),
    order_outcome: text("order_outcome"),
    created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_exec_metrics_order").on(table.order_id),
    index("idx_exec_metrics_symbol").on(table.symbol, table.created_at),
  ],
);

export const reconciliationEventsTable = pgTable("reconciliation_events", {
  id: serial("id").primaryKey(),
  event_type: text("event_type").notNull(),
  status: text("status").notNull(),
  local_position_count: integer("local_position_count"),
  broker_position_count: integer("broker_position_count"),
  orphaned_local_orders: integer("orphaned_local_orders").default(0),
  unknown_broker_positions: integer("unknown_broker_positions").default(0),
  quantity_mismatches: integer("quantity_mismatches").default(0),
  details_json: text("details_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertOrderSchema = createInsertSchema(ordersTable);
export const insertFillSchema = createInsertSchema(fillsTable);
export const insertExecutionMetricSchema = createInsertSchema(executionMetricsTable);
export const insertReconciliationEventSchema = createInsertSchema(reconciliationEventsTable);

export type Order = typeof ordersTable.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Fill = typeof fillsTable.$inferSelect;
export type InsertFill = z.infer<typeof insertFillSchema>;
export type ExecutionMetric = typeof executionMetricsTable.$inferSelect;
export type InsertExecutionMetric = z.infer<typeof insertExecutionMetricSchema>;
export type ReconciliationEvent = typeof reconciliationEventsTable.$inferSelect;
export type InsertReconciliationEvent = z.infer<typeof insertReconciliationEventSchema>;
