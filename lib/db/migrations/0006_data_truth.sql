-- Phase 18: Data Truth Layer
-- Unified data consistency and quality tracking system

CREATE TABLE IF NOT EXISTS data_quality_scores (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  source VARCHAR(20) NOT NULL CHECK (source IN ('backtest', 'paper', 'live')),
  quality_score REAL NOT NULL CHECK (quality_score >= 0 AND quality_score <= 1),
  freshness_score REAL NOT NULL CHECK (freshness_score >= 0 AND freshness_score <= 1),
  completeness_score REAL NOT NULL CHECK (completeness_score >= 0 AND completeness_score <= 1),
  consistency_score REAL NOT NULL CHECK (consistency_score >= 0 AND consistency_score <= 1),
  gap_count INTEGER NOT NULL DEFAULT 0,
  stale_bar_count INTEGER NOT NULL DEFAULT 0,
  total_bars INTEGER NOT NULL DEFAULT 0,
  scored_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_quality_scores_symbol_timeframe
  ON data_quality_scores(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_data_quality_scores_source
  ON data_quality_scores(source);
CREATE INDEX IF NOT EXISTS idx_data_quality_scores_scored_at
  ON data_quality_scores(scored_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_quality_scores_quality_score
  ON data_quality_scores(quality_score DESC);

CREATE TABLE IF NOT EXISTS data_feed_health (
  id SERIAL PRIMARY KEY,
  feed_name VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'stale', 'dead')),
  last_tick_at TIMESTAMP WITH TIME ZONE,
  avg_latency_ms REAL NOT NULL DEFAULT 0,
  gap_events_24h INTEGER NOT NULL DEFAULT 0,
  uptime_pct_24h REAL NOT NULL DEFAULT 100 CHECK (uptime_pct_24h >= 0 AND uptime_pct_24h <= 100),
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  details JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_feed_health_status
  ON data_feed_health(status);
CREATE INDEX IF NOT EXISTS idx_data_feed_health_checked_at
  ON data_feed_health(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_feed_health_feed_name
  ON data_feed_health(feed_name);

CREATE TABLE IF NOT EXISTS data_consistency_checks (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  timeframe VARCHAR(10) NOT NULL,
  check_type VARCHAR(30) NOT NULL CHECK (check_type IN ('cross_source', 'temporal', 'schema')),
  source_a VARCHAR(20),
  source_b VARCHAR(20),
  divergence_score REAL NOT NULL CHECK (divergence_score >= 0 AND divergence_score <= 1),
  divergence_details JSONB,
  checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_consistency_checks_symbol_timeframe
  ON data_consistency_checks(symbol, timeframe);
CREATE INDEX IF NOT EXISTS idx_data_consistency_checks_check_type
  ON data_consistency_checks(check_type);
CREATE INDEX IF NOT EXISTS idx_data_consistency_checks_checked_at
  ON data_consistency_checks(checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_consistency_checks_divergence_score
  ON data_consistency_checks(divergence_score DESC);
CREATE INDEX IF NOT EXISTS idx_data_consistency_checks_sources
  ON data_consistency_checks(source_a, source_b);
