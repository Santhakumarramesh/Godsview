-- ============================================================================
-- Migration: 0001_brain_intelligence
-- Phase 7+8: Brain Intelligence Persistence Layer
-- Tables: strategy_params, trade_outcomes, job_history, chart_snapshots, si_model_state
-- ============================================================================

-- ── strategy_params ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "strategy_params" (
  "id"                        SERIAL PRIMARY KEY,
  "symbol"                    TEXT NOT NULL,
  "strategy_id"               TEXT NOT NULL,
  "version"                   INTEGER NOT NULL DEFAULT 1,
  "tier"                      TEXT NOT NULL DEFAULT 'SEED',

  -- Core strategy parameters (evolved over time)
  "min_confirmation_score"    NUMERIC(5, 4) NOT NULL DEFAULT 0.6500,
  "require_mtf_alignment"     BOOLEAN NOT NULL DEFAULT FALSE,
  "require_bos"               BOOLEAN NOT NULL DEFAULT TRUE,
  "min_ob_quality"            NUMERIC(5, 4) NOT NULL DEFAULT 0.5000,
  "stop_atr_multiplier"       NUMERIC(5, 3) NOT NULL DEFAULT 1.500,
  "take_profit_atr_multiplier" NUMERIC(5, 3) NOT NULL DEFAULT 3.000,
  "max_kelly_fraction"        NUMERIC(5, 4) NOT NULL DEFAULT 0.2500,

  -- Regime rules (JSON arrays)
  "allowed_regimes"           TEXT,
  "blacklisted_regimes"       TEXT,

  -- Evolution changelog (JSON array of ChangelogEntry)
  "changelog"                 TEXT,
  "is_active"                 BOOLEAN NOT NULL DEFAULT TRUE,

  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "strategy_params_symbol_strategy_idx"
  ON "strategy_params" ("symbol", "strategy_id");
CREATE INDEX IF NOT EXISTS "strategy_params_tier_idx"
  ON "strategy_params" ("tier");
CREATE INDEX IF NOT EXISTS "strategy_params_active_idx"
  ON "strategy_params" ("is_active") WHERE "is_active" = TRUE;

-- ── trade_outcomes ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "trade_outcomes" (
  "id"                  SERIAL PRIMARY KEY,
  "symbol"              TEXT NOT NULL,
  "strategy_id"         TEXT,
  "confirmation_id"     TEXT,
  "direction"           TEXT NOT NULL,   -- LONG | SHORT

  -- Setup context
  "regime"              TEXT,
  "mtf_aligned"         BOOLEAN,
  "confirmation_score"  NUMERIC(5, 4),
  "ob_quality"          NUMERIC(5, 4),
  "bos_confirmed"       BOOLEAN,
  "fvg_present"         BOOLEAN,

  -- Execution prices
  "entry_price"         NUMERIC(14, 6) NOT NULL,
  "stop_loss"           NUMERIC(14, 6) NOT NULL,
  "take_profit"         NUMERIC(14, 6) NOT NULL,
  "exit_price"          NUMERIC(14, 6),
  "quantity"            NUMERIC(12, 4),

  -- Result
  "outcome"             TEXT,           -- WIN | LOSS | BREAKEVEN | PARTIAL
  "pnl_usd"             NUMERIC(14, 4),
  "pnl_r"               NUMERIC(8, 4),  -- multiples of 1R
  "mfe_r"               NUMERIC(8, 4),  -- max favorable excursion in R
  "mae_r"               NUMERIC(8, 4),  -- max adverse excursion in R
  "hold_bars"           INTEGER,

  -- SI prediction metadata
  "si_win_probability"  NUMERIC(5, 4),
  "si_confidence"       NUMERIC(5, 4),
  "si_model_votes"      TEXT,           -- JSON {m1..m5}

  -- Timing
  "entry_time"          TIMESTAMPTZ,
  "exit_time"           TIMESTAMPTZ,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "trade_outcomes_symbol_idx"
  ON "trade_outcomes" ("symbol");
CREATE INDEX IF NOT EXISTS "trade_outcomes_created_idx"
  ON "trade_outcomes" ("created_at" DESC);
CREATE INDEX IF NOT EXISTS "trade_outcomes_outcome_idx"
  ON "trade_outcomes" ("outcome");
CREATE INDEX IF NOT EXISTS "trade_outcomes_strategy_idx"
  ON "trade_outcomes" ("strategy_id");
CREATE INDEX IF NOT EXISTS "trade_outcomes_regime_idx"
  ON "trade_outcomes" ("regime");

-- ── job_history ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "job_history" (
  "id"            SERIAL PRIMARY KEY,
  "job_id"        TEXT NOT NULL,
  "job_type"      TEXT NOT NULL,
  "symbol"        TEXT,
  "priority"      INTEGER NOT NULL DEFAULT 2,
  "status"        TEXT NOT NULL,        -- completed | failed | cancelled
  "payload"       TEXT,                 -- JSON
  "result"        TEXT,                 -- JSON summary
  "error"         TEXT,
  "queued_at"     TIMESTAMPTZ,
  "started_at"    TIMESTAMPTZ,
  "completed_at"  TIMESTAMPTZ,
  "latency_ms"    INTEGER,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "job_history_job_id_idx"
  ON "job_history" ("job_id");
CREATE INDEX IF NOT EXISTS "job_history_type_idx"
  ON "job_history" ("job_type");
CREATE INDEX IF NOT EXISTS "job_history_status_idx"
  ON "job_history" ("status");
CREATE INDEX IF NOT EXISTS "job_history_symbol_idx"
  ON "job_history" ("symbol");
CREATE INDEX IF NOT EXISTS "job_history_created_idx"
  ON "job_history" ("created_at" DESC);

-- ── chart_snapshots ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chart_snapshots" (
  "id"                  SERIAL PRIMARY KEY,
  "confirmation_id"     TEXT NOT NULL,
  "symbol"              TEXT NOT NULL,
  "direction"           TEXT,
  "regime"              TEXT,
  "confirmation_score"  NUMERIC(5, 4),
  "svg_chart"           TEXT NOT NULL,  -- full SVG string
  "html_report"         TEXT,           -- optional HTML wrapper
  "bar_count"           INTEGER,
  "annotation_count"    INTEGER,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "chart_snapshots_symbol_idx"
  ON "chart_snapshots" ("symbol");
CREATE INDEX IF NOT EXISTS "chart_snapshots_confirmation_idx"
  ON "chart_snapshots" ("confirmation_id");
CREATE INDEX IF NOT EXISTS "chart_snapshots_created_idx"
  ON "chart_snapshots" ("created_at" DESC);

-- ── si_model_state ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "si_model_state" (
  "id"                   SERIAL PRIMARY KEY,
  "symbol"               TEXT NOT NULL,
  "model_version"        INTEGER NOT NULL DEFAULT 1,

  -- 5-model ensemble weights (must sum to 1.0)
  "weight_m1"            NUMERIC(6, 5) NOT NULL DEFAULT 0.20000,  -- Structure
  "weight_m2"            NUMERIC(6, 5) NOT NULL DEFAULT 0.20000,  -- Regime
  "weight_m3"            NUMERIC(6, 5) NOT NULL DEFAULT 0.20000,  -- Orderflow
  "weight_m4"            NUMERIC(6, 5) NOT NULL DEFAULT 0.20000,  -- Memory
  "weight_m5"            NUMERIC(6, 5) NOT NULL DEFAULT 0.20000,  -- Momentum

  -- Platt calibration parameters (sigmoid: P = 1/(1 + exp(a*x + b)))
  "platt_a"              NUMERIC(8, 5) NOT NULL DEFAULT 1.00000,
  "platt_b"              NUMERIC(8, 5) NOT NULL DEFAULT 0.00000,

  -- Performance tracking
  "brier_score"          NUMERIC(6, 5),
  "total_outcomes"       INTEGER NOT NULL DEFAULT 0,

  -- Per-regime calibration overrides (JSON)
  "regime_calibration"   TEXT,

  "is_active"            BOOLEAN NOT NULL DEFAULT TRUE,
  "updated_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "created_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "si_model_state_symbol_active_idx"
  ON "si_model_state" ("symbol") WHERE "is_active" = TRUE;
CREATE INDEX IF NOT EXISTS "si_model_state_symbol_idx"
  ON "si_model_state" ("symbol");
