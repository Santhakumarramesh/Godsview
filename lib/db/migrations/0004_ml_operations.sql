-- Phase 14: ML Operational Maturity
-- Model versioning, feature catalog, evaluation tracking, retrain audit.

CREATE TABLE IF NOT EXISTS model_versions (
  id SERIAL PRIMARY KEY,
  model_name TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'trained',

  training_rows INTEGER,
  feature_count INTEGER,
  feature_names_json JSONB,
  config_json JSONB,

  accuracy NUMERIC(6,4),
  auc_roc NUMERIC(6,4),
  f1_score NUMERIC(6,4),
  brier_score NUMERIC(8,6),
  log_loss NUMERIC(8,6),
  precision_score NUMERIC(6,4),
  recall_score NUMERIC(6,4),

  live_accuracy NUMERIC(6,4),
  live_brier_score NUMERIC(8,6),
  live_trade_count INTEGER DEFAULT 0,
  live_win_rate NUMERIC(6,4),
  promoted_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  promoted_from_version INTEGER,
  promotion_reason TEXT,

  model_artifact_path TEXT,
  training_data_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_versions_name ON model_versions (model_name, version DESC);
CREATE INDEX idx_model_versions_status ON model_versions (status, model_name);
CREATE INDEX idx_model_versions_champion ON model_versions (model_name, status) WHERE status = 'champion';

CREATE TABLE IF NOT EXISTS feature_definitions (
  id SERIAL PRIMARY KEY,
  feature_name TEXT NOT NULL,
  feature_type TEXT NOT NULL,
  computation_source TEXT,
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  importance_rank INTEGER,
  avg_importance NUMERIC(8,6),
  staleness_threshold_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX idx_feature_name ON feature_definitions (feature_name);

CREATE TABLE IF NOT EXISTS model_evaluations (
  id SERIAL PRIMARY KEY,
  champion_version_id INTEGER NOT NULL,
  challenger_version_id INTEGER,
  evaluation_type TEXT NOT NULL,

  champion_accuracy NUMERIC(6,4),
  champion_brier NUMERIC(8,6),
  champion_trade_count INTEGER,
  champion_win_rate NUMERIC(6,4),

  challenger_accuracy NUMERIC(6,4),
  challenger_brier NUMERIC(8,6),
  challenger_trade_count INTEGER,
  challenger_win_rate NUMERIC(6,4),

  verdict TEXT NOT NULL,
  improvement_pct NUMERIC(8,4),
  action_taken TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_model_eval_champion ON model_evaluations (champion_version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS retrain_events (
  id SERIAL PRIMARY KEY,
  model_name TEXT NOT NULL,  trigger TEXT NOT NULL,
  status TEXT NOT NULL,

  training_rows INTEGER,
  new_rows_since_last INTEGER,
  data_hash TEXT,

  new_version_id INTEGER,
  accuracy_before NUMERIC(6,4),
  accuracy_after NUMERIC(6,4),
  improvement NUMERIC(8,4),

  duration_ms INTEGER,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_retrain_events_model ON retrain_events (model_name, created_at DESC);
CREATE INDEX idx_retrain_events_status ON retrain_events (status);
