-- GodsView Initial Schema Migration
-- Generated from Drizzle ORM schema definitions
-- Run: DATABASE_URL=postgres://... pnpm --filter @workspace/db migrate

CREATE TABLE IF NOT EXISTS "signals" (
  "id" SERIAL PRIMARY KEY,
  "instrument" TEXT NOT NULL,
  "setup_type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "structure_score" NUMERIC(5,4) NOT NULL,
  "order_flow_score" NUMERIC(5,4) NOT NULL,
  "recall_score" NUMERIC(5,4) NOT NULL,
  "ml_probability" NUMERIC(5,4) NOT NULL,
  "claude_score" NUMERIC(5,4) NOT NULL,
  "final_quality" NUMERIC(5,4) NOT NULL,
  "claude_verdict" TEXT,
  "claude_reasoning" TEXT,
  "entry_price" NUMERIC(12,4),
  "stop_loss" NUMERIC(12,4),
  "take_profit" NUMERIC(12,4),
  "session" TEXT,
  "regime" TEXT,
  "news_lockout" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "trades" (
  "id" SERIAL PRIMARY KEY,
  "signal_id" INTEGER,
  "instrument" TEXT NOT NULL,
  "setup_type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "entry_price" NUMERIC(12,4) NOT NULL,
  "exit_price" NUMERIC(12,4),
  "stop_loss" NUMERIC(12,4) NOT NULL,
  "take_profit" NUMERIC(12,4) NOT NULL,
  "quantity" NUMERIC(10,4) NOT NULL,
  "pnl" NUMERIC(12,4),
  "pnl_pct" NUMERIC(8,4),
  "outcome" TEXT NOT NULL DEFAULT 'open',
  "mfe" NUMERIC(12,4),
  "mae" NUMERIC(12,4),
  "slippage" NUMERIC(8,4),
  "session" TEXT,
  "regime" TEXT,
  "notes" TEXT,
  "order_id" TEXT,
  "operator_id" TEXT,
  "entry_time" TIMESTAMPTZ,
  "exit_time" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "market_bars" (
  "id" SERIAL PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "bar_time" TIMESTAMPTZ NOT NULL,
  "open" NUMERIC(14,6) NOT NULL,
  "high" NUMERIC(14,6) NOT NULL,
  "low" NUMERIC(14,6) NOT NULL,
  "close" NUMERIC(14,6) NOT NULL,
  "volume" NUMERIC(18,2) NOT NULL,
  "vwap" NUMERIC(14,6),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "accuracy_results" (
  "id" SERIAL PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "setup_type" TEXT NOT NULL,
  "timeframe" TEXT NOT NULL,
  "bar_time" TIMESTAMPTZ NOT NULL,
  "signal_detected" TEXT NOT NULL,
  "structure_score" NUMERIC(5,4) NOT NULL,
  "order_flow_score" NUMERIC(5,4) NOT NULL,
  "recall_score" NUMERIC(5,4) NOT NULL,
  "final_quality" NUMERIC(5,4) NOT NULL,
  "outcome" TEXT,
  "tp_ticks" INTEGER,
  "sl_ticks" INTEGER,
  "hit_tp" TEXT,
  "forward_bars_checked" INTEGER,
  "regime" TEXT,
  "direction" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "audit_events" (
  "id" SERIAL PRIMARY KEY,
  "event_type" TEXT NOT NULL,
  "decision_state" TEXT,
  "system_mode" TEXT,
  "instrument" TEXT,
  "setup_type" TEXT,
  "symbol" TEXT,
  "actor" TEXT NOT NULL DEFAULT 'system',
  "reason" TEXT,
  "payload_json" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "trading_sessions" (
  "id" SERIAL PRIMARY KEY,
  "session_id" TEXT NOT NULL UNIQUE,
  "system_mode" TEXT NOT NULL,
  "operator_id" TEXT,
  "started_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "ended_at" TIMESTAMPTZ,
  "trades_executed" INTEGER DEFAULT 0,
  "signals_generated" INTEGER DEFAULT 0,
  "realized_pnl" NUMERIC(12,4),
  "peak_drawdown_pct" NUMERIC(8,4),
  "breaker_triggered" BOOLEAN DEFAULT false,
  "kill_switch_used" BOOLEAN DEFAULT false,
  "exit_reason" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "breaker_events" (
  "id" SERIAL PRIMARY KEY,
  "session_id" TEXT,
  "level" TEXT NOT NULL,
  "previous_level" TEXT,
  "trigger" TEXT NOT NULL,
  "daily_pnl" NUMERIC(12,4),
  "consecutive_losses" INTEGER,
  "position_size_multiplier" NUMERIC(5,4),
  "details" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS "idx_signals_instrument_created" ON "signals" ("instrument", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_signals_status" ON "signals" ("status");
CREATE INDEX IF NOT EXISTS "idx_trades_instrument_created" ON "trades" ("instrument", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_trades_outcome" ON "trades" ("outcome");
CREATE INDEX IF NOT EXISTS "idx_trades_order_id" ON "trades" ("order_id");
CREATE INDEX IF NOT EXISTS "idx_market_bars_symbol_tf_time" ON "market_bars" ("symbol", "timeframe", "bar_time" DESC);
CREATE INDEX IF NOT EXISTS "idx_accuracy_symbol_setup" ON "accuracy_results" ("symbol", "setup_type");
CREATE INDEX IF NOT EXISTS "idx_audit_event_type_created" ON "audit_events" ("event_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_audit_instrument" ON "audit_events" ("instrument");
CREATE INDEX IF NOT EXISTS "idx_trading_sessions_session_id" ON "trading_sessions" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_breaker_events_session" ON "breaker_events" ("session_id", "created_at" DESC);
