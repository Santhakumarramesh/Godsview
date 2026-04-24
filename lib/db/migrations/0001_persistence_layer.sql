-- GodsView Phase 2: Persistence Layer Migration
-- Creates tables for data previously stored only in-memory

-- Positions table
CREATE TABLE IF NOT EXISTS positions (
  position_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('long','short')),
  quantity DOUBLE PRECISION NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  current_price DOUBLE PRECISION NOT NULL DEFAULT 0,
  unrealized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  realized_pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
  stop_loss DOUBLE PRECISION,
  take_profit DOUBLE PRECISION,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ
);

-- Watchlist table
CREATE TABLE IF NOT EXISTS watchlist (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  priority INTEGER DEFAULT 0,
  tags TEXT,
  notes TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trade journal
CREATE TABLE IF NOT EXISTS trade_journal (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price DOUBLE PRECISION NOT NULL,
  exit_price DOUBLE PRECISION,
  pnl DOUBLE PRECISION,
  pnl_pct DOUBLE PRECISION,
  notes TEXT,
  tags TEXT,
  setup_type TEXT,
  regime TEXT,
  lessons TEXT,
  screenshot_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Setup memories for recall engine
CREATE TABLE IF NOT EXISTS setup_memories (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  setup_type TEXT NOT NULL,
  direction TEXT,
  context_json JSONB,
  outcome TEXT,
  pnl DOUBLE PRECISION,
  screenshot_url TEXT,
  similarity_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strategy registry
CREATE TABLE IF NOT EXISTS strategies (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  dsl_payload JSONB,
  raw_input TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  parent_id UUID,
  created_by TEXT DEFAULT 'system',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Promotion events
CREATE TABLE IF NOT EXISTS promotion_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  strategy_id UUID NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  evidence_packet JSONB,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Kill switch log
CREATE TABLE IF NOT EXISTS kill_switch_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  mode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions (symbol);
CREATE INDEX IF NOT EXISTS idx_positions_open ON positions (closed_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_watchlist_symbol ON watchlist (symbol);
CREATE INDEX IF NOT EXISTS idx_trade_journal_symbol ON trade_journal (symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_setup_memories_symbol ON setup_memories (symbol, setup_type);
CREATE INDEX IF NOT EXISTS idx_strategies_status ON strategies (status);
CREATE INDEX IF NOT EXISTS idx_promotion_events_strategy ON promotion_events (strategy_id, created_at DESC);
