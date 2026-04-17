-- Phase 20: Certification Run Orchestration
-- Formal run/session storage for end-to-end certification attempts.

CREATE TABLE IF NOT EXISTS certification_runs (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL UNIQUE,
  strategy_id TEXT NOT NULL,
  strategy_name TEXT NOT NULL,
  target_tier TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'initiated',

  config_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  operator_id TEXT,

  backtest_started_at TIMESTAMPTZ,
  backtest_completed_at TIMESTAMPTZ,
  backtest_result_json JSONB,
  backtest_sharpe NUMERIC(8,4),
  backtest_win_rate NUMERIC(6,4),
  backtest_trade_count INTEGER,
  backtest_max_dd NUMERIC(8,4),
  backtest_profit_factor NUMERIC(8,4),

  wf_started_at TIMESTAMPTZ,
  wf_completed_at TIMESTAMPTZ,
  wf_result_json JSONB,
  wf_pass_rate NUMERIC(6,4),
  wf_oos_sharpe NUMERIC(8,4),

  stress_started_at TIMESTAMPTZ,
  stress_completed_at TIMESTAMPTZ,
  stress_result_json JSONB,
  stress_survival_rate NUMERIC(6,4),
  stress_worst_dd NUMERIC(8,4),

  shadow_started_at TIMESTAMPTZ,
  shadow_completed_at TIMESTAMPTZ,
  shadow_trade_count INTEGER DEFAULT 0,
  shadow_win_rate NUMERIC(6,4),
  shadow_pnl NUMERIC(14,4),
  shadow_result_json JSONB,

  alignment_score NUMERIC(6,4),
  avg_slippage_bps NUMERIC(8,2),
  execution_fill_rate NUMERIC(6,4),
  execution_avg_latency_ms INTEGER,

  drift_score NUMERIC(6,4),
  drift_status TEXT,

  evidence_packet_json JSONB,
  gate_results_json JSONB,

  governance_verdict TEXT,
  governance_reason TEXT,
  approved_by TEXT,
  rejection_reason TEXT,

  incidents_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_runs_strategy
  ON certification_runs(strategy_id);
CREATE INDEX IF NOT EXISTS idx_cert_runs_status
  ON certification_runs(status);
CREATE INDEX IF NOT EXISTS idx_cert_runs_run_id
  ON certification_runs(run_id);

CREATE TABLE IF NOT EXISTS certification_run_steps (
  id SERIAL PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES certification_runs(run_id) ON DELETE CASCADE,
  step_name TEXT NOT NULL,
  step_order INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  result_json JSONB,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_steps_run
  ON certification_run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_cert_steps_status
  ON certification_run_steps(status);
