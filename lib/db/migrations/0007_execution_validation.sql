-- Phase 19: Execution Validation Layer
-- Creates tables for execution quality validation, slippage analysis, and drift detection

CREATE TABLE IF NOT EXISTS execution_validations (
  id SERIAL PRIMARY KEY,
  order_uuid TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  expected_price NUMERIC NOT NULL,
  actual_price NUMERIC NOT NULL,
  expected_qty NUMERIC NOT NULL,
  actual_qty NUMERIC NOT NULL,
  slippage_bps NUMERIC NOT NULL,
  latency_ms INTEGER NOT NULL,
  fill_quality_score NUMERIC(4,3) NOT NULL CHECK (fill_quality_score >= 0 AND fill_quality_score <= 1),
  venue TEXT NOT NULL,
  validated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_execution_validations_strategy_id
  ON execution_validations(strategy_id);
CREATE INDEX IF NOT EXISTS idx_execution_validations_symbol
  ON execution_validations(symbol);
CREATE INDEX IF NOT EXISTS idx_execution_validations_validated_at
  ON execution_validations(validated_at);
CREATE INDEX IF NOT EXISTS idx_execution_validations_strategy_symbol
  ON execution_validations(strategy_id, symbol);


CREATE TABLE IF NOT EXISTS slippage_distributions (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  period_start TIMESTAMP NOT NULL,
  period_end TIMESTAMP NOT NULL,
  sample_count INTEGER NOT NULL,
  mean_slippage_bps NUMERIC NOT NULL,
  median_slippage_bps NUMERIC NOT NULL,
  p95_slippage_bps NUMERIC NOT NULL,
  p99_slippage_bps NUMERIC NOT NULL,
  std_dev_bps NUMERIC NOT NULL,
  favorable_pct NUMERIC NOT NULL CHECK (favorable_pct >= 0 AND favorable_pct <= 100),
  computed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_slippage_distributions_strategy_id
  ON slippage_distributions(strategy_id);
CREATE INDEX IF NOT EXISTS idx_slippage_distributions_symbol
  ON slippage_distributions(symbol);
CREATE INDEX IF NOT EXISTS idx_slippage_distributions_period
  ON slippage_distributions(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_slippage_distributions_strategy_symbol
  ON slippage_distributions(strategy_id, symbol);


CREATE TABLE IF NOT EXISTS execution_drift_events (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  drift_type TEXT NOT NULL CHECK (drift_type IN ('slippage_spike', 'latency_spike', 'fill_rate_drop', 'venue_degradation')),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  observed_value NUMERIC NOT NULL,
  expected_range_low NUMERIC NOT NULL,
  expected_range_high NUMERIC NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  detected_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_execution_drift_events_strategy_id
  ON execution_drift_events(strategy_id);
CREATE INDEX IF NOT EXISTS idx_execution_drift_events_drift_type
  ON execution_drift_events(drift_type);
CREATE INDEX IF NOT EXISTS idx_execution_drift_events_severity
  ON execution_drift_events(severity);
CREATE INDEX IF NOT EXISTS idx_execution_drift_events_detected_at
  ON execution_drift_events(detected_at);
CREATE INDEX IF NOT EXISTS idx_execution_drift_events_strategy_detected
  ON execution_drift_events(strategy_id, detected_at);
