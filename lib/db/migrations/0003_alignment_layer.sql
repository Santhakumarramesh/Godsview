-- Phase 13: Backtest↔Live Alignment Layer
-- Tracks alignment between backtest assumptions and actual execution outcomes.

CREATE TABLE IF NOT EXISTS alignment_snapshots (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  bt_win_rate NUMERIC(6,4),
  bt_avg_pnl NUMERIC(12,4),
  bt_sharpe NUMERIC(8,4),
  bt_max_drawdown_pct NUMERIC(8,4),
  bt_avg_slippage_bps NUMERIC(8,2),
  bt_trade_count INTEGER,

  live_win_rate NUMERIC(6,4),
  live_avg_pnl NUMERIC(12,4),
  live_sharpe NUMERIC(8,4),
  live_max_drawdown_pct NUMERIC(8,4),
  live_avg_slippage_bps NUMERIC(8,2),
  live_trade_count INTEGER,

  win_rate_divergence NUMERIC(8,4),
  pnl_divergence NUMERIC(8,4),
  sharpe_divergence NUMERIC(8,4),
  slippage_divergence NUMERIC(8,4),
  composite_alignment_score NUMERIC(6,4),
  verdict TEXT NOT NULL,
  drift_direction TEXT,
  regime TEXT,
  details_json JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alignment_strategy ON alignment_snapshots (strategy_id, created_at DESC);
CREATE INDEX idx_alignment_symbol ON alignment_snapshots (symbol, created_at DESC);
CREATE INDEX idx_alignment_verdict ON alignment_snapshots (verdict);

CREATE TABLE IF NOT EXISTS slippage_calibration (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,

  assumed_slippage_bps NUMERIC(8,2),
  actual_avg_slippage_bps NUMERIC(8,2),
  actual_p50_slippage_bps NUMERIC(8,2),
  actual_p95_slippage_bps NUMERIC(8,2),
  actual_max_slippage_bps NUMERIC(8,2),
  fill_count INTEGER,

  calibration_error_bps NUMERIC(8,2),
  recommended_slippage_bps NUMERIC(8,2),
  is_calibrated BOOLEAN DEFAULT FALSE,
  regime TEXT,
  setup_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_slippage_cal_symbol ON slippage_calibration (symbol, created_at DESC);
CREATE INDEX idx_slippage_cal_regime ON slippage_calibration (regime, symbol);

CREATE TABLE IF NOT EXISTS drift_events (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  symbol TEXT,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,

  metric_name TEXT NOT NULL,
  backtest_value NUMERIC(12,4),
  live_value NUMERIC(12,4),
  divergence NUMERIC(8,4),
  threshold NUMERIC(8,4),

  action_taken TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  resolved_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_drift_strategy ON drift_events (strategy_id, created_at DESC);
CREATE INDEX idx_drift_unresolved ON drift_events (resolved, severity);
