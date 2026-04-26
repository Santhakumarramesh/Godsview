-- 0009: Add columns for continuous learning pipeline
-- source: track whether data came from live, paper, or backtest
-- entry_price, stop_loss, take_profit, realized_pnl: trade-level details

ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'live';
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS entry_price NUMERIC(14, 6);
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS stop_loss NUMERIC(14, 6);
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS take_profit NUMERIC(14, 6);
ALTER TABLE accuracy_results ADD COLUMN IF NOT EXISTS realized_pnl NUMERIC(14, 4);

-- Index for learning queries
CREATE INDEX IF NOT EXISTS idx_accuracy_results_source ON accuracy_results(source);
CREATE INDEX IF NOT EXISTS idx_accuracy_results_outcome_source ON accuracy_results(outcome, source);

-- Strategy promotion tracking table
CREATE TABLE IF NOT EXISTS strategy_promotions (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  setup_type TEXT NOT NULL,
  from_tier TEXT NOT NULL,
  to_tier TEXT NOT NULL,
  win_rate NUMERIC(5, 4) NOT NULL,
  profit_factor NUMERIC(8, 4),
  sample_count INTEGER NOT NULL,
  promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_strategy_promotions_setup ON strategy_promotions(setup_type);

-- Learning loop state tracking
CREATE TABLE IF NOT EXISTS learning_events (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,  -- 'retrain', 'drift_detected', 'promotion', 'degradation'
  trigger TEXT NOT NULL,     -- 'scheduled', 'drift_detected', 'backtest_ingestion', 'manual'
  details JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_learning_events_type ON learning_events(event_type);
CREATE INDEX IF NOT EXISTS idx_learning_events_created ON learning_events(created_at);
