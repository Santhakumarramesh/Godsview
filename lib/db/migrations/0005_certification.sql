-- Phase 16: Strategy Certification
-- Formal evidence packets for strategy promotion.

CREATE TABLE IF NOT EXISTS strategy_certifications (
  id SERIAL PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  target_tier TEXT NOT NULL,
  current_tier TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',

  backtest_pass BOOLEAN,
  walkforward_pass BOOLEAN,
  stress_test_pass BOOLEAN,
  shadow_pass BOOLEAN,
  alignment_pass BOOLEAN,
  slippage_pass BOOLEAN,
  execution_quality_pass BOOLEAN,

  backtest_sharpe NUMERIC(8,4),
  backtest_win_rate NUMERIC(6,4),
  live_sharpe NUMERIC(8,4),
  live_win_rate NUMERIC(6,4),
  alignment_score NUMERIC(6,4),
  avg_slippage_bps NUMERIC(8,2),
  paper_trade_count INTEGER,
  paper_pnl NUMERIC(14,4),
  evidence_json JSONB,

  approved_by TEXT,
  rejection_reason TEXT,
  notes TEXT,

  initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cert_strategy ON strategy_certifications (strategy_id, created_at DESC);
CREATE INDEX idx_cert_status ON strategy_certifications (status);
CREATE INDEX idx_cert_tier ON strategy_certifications (target_tier, status);
