-- Phase 12: Execution Truth Layer
-- Persistent order lifecycle, fill tracking, execution quality metrics, reconciliation events

CREATE TABLE IF NOT EXISTS "orders" (
  "id" serial PRIMARY KEY,
  "order_uuid" text NOT NULL,
  "broker_order_id" text,
  "signal_id" integer,
  "si_decision_id" integer,
  "strategy_id" text,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "direction" text NOT NULL,
  "order_type" text NOT NULL DEFAULT 'limit',
  "quantity" numeric(12, 4) NOT NULL,
  "limit_price" numeric(14, 6),
  "stop_price" numeric(14, 6) NOT NULL,
  "target_price" numeric(14, 6) NOT NULL,
  "expected_entry_price" numeric(14, 6) NOT NULL,
  "status" text NOT NULL DEFAULT 'intent_created',
  "execution_mode" text NOT NULL DEFAULT 'paper',
  "idempotency_key" text,
  "intent_at" timestamp with time zone NOT NULL DEFAULT now(),
  "submitted_at" timestamp with time zone,
  "accepted_at" timestamp with time zone,
  "first_fill_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "filled_quantity" numeric(12, 4) DEFAULT '0',
  "avg_fill_price" numeric(14, 6),
  "total_commission" numeric(10, 4) DEFAULT '0',
  "rejection_reason" text,
  "cancel_reason" text,
  "setup_type" text,
  "regime" text,
  "operator_notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "fills" (
  "id" serial PRIMARY KEY,
  "order_id" integer,
  "broker_fill_id" text NOT NULL,
  "broker_order_id" text,
  "symbol" text NOT NULL,
  "side" text NOT NULL,
  "quantity" numeric(12, 4) NOT NULL,
  "price" numeric(14, 6) NOT NULL,
  "commission" numeric(10, 4) DEFAULT '0',
  "expected_price" numeric(14, 6),
  "slippage" numeric(10, 6),
  "slippage_bps" numeric(8, 2),
  "matched_to_position" boolean NOT NULL DEFAULT false,
  "realized_pnl" numeric(14, 4),
  "filled_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "execution_metrics" (
  "id" serial PRIMARY KEY,
  "order_id" integer,
  "symbol" text NOT NULL,
  "strategy_id" text,
  "execution_mode" text NOT NULL,
  "total_fills" integer NOT NULL DEFAULT 0,
  "avg_fill_price" numeric(14, 6),
  "expected_price" numeric(14, 6),
  "realized_slippage_bps" numeric(8, 2),
  "submit_to_first_fill_ms" integer,
  "submit_to_complete_ms" integer,
  "regime" text,
  "setup_type" text,
  "order_outcome" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS "reconciliation_events" (
  "id" serial PRIMARY KEY,
  "event_type" text NOT NULL,
  "status" text NOT NULL,
  "local_position_count" integer,
  "broker_position_count" integer,
  "orphaned_local_orders" integer DEFAULT 0,
  "unknown_broker_positions" integer DEFAULT 0,
  "quantity_mismatches" integer DEFAULT 0,
  "details_json" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS "idx_orders_symbol_status" ON "orders" ("symbol", "status");
CREATE INDEX IF NOT EXISTS "idx_orders_uuid" ON "orders" ("order_uuid");
CREATE INDEX IF NOT EXISTS "idx_orders_broker_id" ON "orders" ("broker_order_id");
CREATE INDEX IF NOT EXISTS "idx_orders_created" ON "orders" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_fills_order_id" ON "fills" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_fills_broker_fill_id" ON "fills" ("broker_fill_id");
CREATE INDEX IF NOT EXISTS "idx_fills_symbol_filled" ON "fills" ("symbol", "filled_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_exec_metrics_order" ON "execution_metrics" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_exec_metrics_symbol" ON "execution_metrics" ("symbol", "created_at" DESC);
