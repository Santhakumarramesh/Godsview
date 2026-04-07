-- Phase 134: Orders, Positions, and Risk Assessments tables
-- Matches shared data contracts (shared_contracts.ts / shared_contracts.py)

DO $$ BEGIN
  CREATE TYPE "order_side" AS ENUM('buy', 'sell');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "order_type" AS ENUM('market', 'limit', 'stop', 'stop_limit');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "order_tif" AS ENUM('day', 'gtc', 'ioc', 'fok');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "order_status" AS ENUM('pending', 'submitted', 'partial', 'filled', 'cancelled', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "position_side" AS ENUM('long', 'short');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "orders" (
  "order_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "symbol" text NOT NULL,
  "side" "order_side" NOT NULL,
  "order_type" "order_type" NOT NULL,
  "quantity" double precision NOT NULL,
  "price" double precision,
  "stop_price" double precision,
  "time_in_force" "order_tif" NOT NULL DEFAULT 'day',
  "status" "order_status" NOT NULL DEFAULT 'pending',
  "filled_qty" double precision NOT NULL DEFAULT 0,
  "avg_fill_price" double precision,
  "signal_id" uuid,
  "broker" text NOT NULL DEFAULT 'alpaca',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "positions" (
  "position_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "symbol" text NOT NULL,
  "side" "position_side" NOT NULL,
  "quantity" double precision NOT NULL,
  "entry_price" double precision NOT NULL,
  "current_price" double precision NOT NULL,
  "unrealized_pnl" double precision NOT NULL DEFAULT 0,
  "realized_pnl" double precision NOT NULL DEFAULT 0,
  "stop_loss" double precision,
  "take_profit" double precision,
  "opened_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "risk_assessments" (
  "assessment_id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "portfolio_var_95" double precision NOT NULL,
  "portfolio_var_99" double precision NOT NULL,
  "max_drawdown" double precision NOT NULL,
  "current_drawdown" double precision NOT NULL,
  "exposure_pct" double precision NOT NULL,
  "margin_used_pct" double precision NOT NULL,
  "risk_score" double precision NOT NULL,
  "circuit_breaker_active" boolean NOT NULL DEFAULT false,
  "warnings" text[],
  "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_orders_symbol" ON "orders" ("symbol");
CREATE INDEX IF NOT EXISTS "idx_orders_status" ON "orders" ("status");
CREATE INDEX IF NOT EXISTS "idx_orders_created_at" ON "orders" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_positions_symbol" ON "positions" ("symbol");
CREATE INDEX IF NOT EXISTS "idx_positions_opened_at" ON "positions" ("opened_at");
CREATE INDEX IF NOT EXISTS "idx_risk_created_at" ON "risk_assessments" ("created_at");
