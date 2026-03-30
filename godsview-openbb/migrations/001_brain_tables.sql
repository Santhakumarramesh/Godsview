-- Godsview Brain Storage (Phase: brain-node persistence)
-- Safe to run repeatedly via IF NOT EXISTS guards.

CREATE TABLE IF NOT EXISTS brain_entities (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  entity_type TEXT NOT NULL DEFAULT 'stock',
  name TEXT,
  sector TEXT,
  regime TEXT,
  volatility NUMERIC(10, 6),
  last_price NUMERIC(16, 6),
  state_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_relations (
  id SERIAL PRIMARY KEY,
  source_entity_id INTEGER NOT NULL REFERENCES brain_entities(id) ON DELETE CASCADE,
  target_entity_id INTEGER NOT NULL REFERENCES brain_entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL,
  strength NUMERIC(10, 6) NOT NULL DEFAULT 0.5,
  context_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_memories (
  id SERIAL PRIMARY KEY,
  entity_id INTEGER NOT NULL REFERENCES brain_entities(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  signal_id INTEGER,
  trade_id INTEGER,
  confidence NUMERIC(10, 6) NOT NULL DEFAULT 0.5,
  outcome_score NUMERIC(10, 6),
  tags TEXT,
  context_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_cycles (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  status TEXT NOT NULL,
  blocked BOOLEAN NOT NULL DEFAULT FALSE,
  block_reason TEXT,
  command TEXT,
  output_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_consciousness_snapshots (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  attention_score NUMERIC(10, 6),
  readiness TEXT NOT NULL,
  setup_family TEXT,
  direction TEXT,
  structure_score NUMERIC(10, 6),
  orderflow_score NUMERIC(10, 6),
  context_score NUMERIC(10, 6),
  memory_score NUMERIC(10, 6),
  reasoning_score NUMERIC(10, 6),
  risk_score NUMERIC(10, 6),
  block_reason TEXT,
  payload_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_evolution_reviews (
  id SERIAL PRIMARY KEY,
  symbol TEXT NOT NULL,
  setup_family TEXT,
  verdict TEXT,
  summary TEXT,
  suggestions_json TEXT,
  metrics_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_brain_entities_symbol ON brain_entities(symbol);
CREATE INDEX IF NOT EXISTS idx_brain_relations_source ON brain_relations(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_relations_target ON brain_relations(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_memories_entity ON brain_memories(entity_id);
CREATE INDEX IF NOT EXISTS idx_brain_memories_created ON brain_memories(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_cycles_symbol_created ON brain_cycles(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_consciousness_symbol_created ON brain_consciousness_snapshots(symbol, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_brain_evolution_symbol_created ON brain_evolution_reviews(symbol, created_at DESC);

