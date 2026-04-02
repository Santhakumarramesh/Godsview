-- GodsView Migration 0001: Brain Knowledge Graph + SI Decision Log
-- Adds tables for the Super Intelligence persistence layer:
--   brain_entities   — tracked symbols and assets
--   brain_relations  — inter-asset correlation graph
--   brain_memories   — per-entity trade memories for pattern recall
--   si_decisions     — full audit trail of every SI evaluation

-- ── Brain knowledge graph ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "brain_entities" (
  "id" SERIAL PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL DEFAULT 'stock',
  "name" TEXT,
  "sector" TEXT,
  "regime" TEXT,
  "volatility" NUMERIC(8,4),
  "last_price" NUMERIC(14,6),
  "state_json" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "brain_relations" (
  "id" SERIAL PRIMARY KEY,
  "source_entity_id" INTEGER NOT NULL,
  "target_entity_id" INTEGER NOT NULL,
  "relation_type" TEXT NOT NULL,
  "strength" NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
  "context_json" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "brain_memories" (
  "id" SERIAL PRIMARY KEY,
  "entity_id" INTEGER NOT NULL,
  "memory_type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "signal_id" INTEGER,
  "trade_id" INTEGER,
  "confidence" NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
  "outcome_score" NUMERIC(8,4),
  "tags" TEXT,
  "context_json" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Super Intelligence decision log ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "si_decisions" (
  "id" SERIAL PRIMARY KEY,
  "symbol" TEXT NOT NULL,
  "setup_type" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "regime" TEXT NOT NULL,
  "approved" BOOLEAN NOT NULL,
  "win_probability" NUMERIC(5,4) NOT NULL,
  "edge_score" NUMERIC(6,4) NOT NULL,
  "enhanced_quality" NUMERIC(5,4) NOT NULL,
  "kelly_fraction" NUMERIC(5,4) NOT NULL,
  "confluence_score" NUMERIC(3,2) NOT NULL,
  "suggested_qty" INTEGER NOT NULL,
  "rejection_reason" TEXT,
  "entry_price" NUMERIC(12,4) NOT NULL,
  "stop_loss" NUMERIC(12,4) NOT NULL,
  "take_profit" NUMERIC(12,4) NOT NULL,
  "final_quality" NUMERIC(5,4) NOT NULL,
  "gate_action" TEXT,
  "gate_block_reasons" TEXT,
  "trailing_stop_json" TEXT,
  "profit_targets_json" TEXT,
  "outcome" TEXT,
  "realized_pnl" NUMERIC(12,2),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_brain_entities_symbol"      ON "brain_entities" ("symbol");
CREATE INDEX IF NOT EXISTS "idx_brain_relations_source"     ON "brain_relations" ("source_entity_id");
CREATE INDEX IF NOT EXISTS "idx_brain_relations_target"     ON "brain_relations" ("target_entity_id");
CREATE INDEX IF NOT EXISTS "idx_brain_memories_entity"      ON "brain_memories" ("entity_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_brain_memories_signal"      ON "brain_memories" ("signal_id");
CREATE INDEX IF NOT EXISTS "idx_si_decisions_symbol_setup"  ON "si_decisions" ("symbol", "setup_type", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_si_decisions_approved"      ON "si_decisions" ("approved", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_si_decisions_outcome"       ON "si_decisions" ("outcome");
