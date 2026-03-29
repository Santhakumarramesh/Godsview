import * as schema from "./schema";

/**
 * Smart DB driver selection:
 * - If DATABASE_URL is set → use real PostgreSQL (Replit, Neon, etc.)
 * - If DATABASE_URL is empty/missing → use PGlite (in-process, zero setup)
 *
 * PGlite auto-creates tables on first run.
 */

let db: any;
let pool: any = { end: async () => {} };

const dbUrl = process.env.DATABASE_URL?.trim();

if (dbUrl) {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = await import("pg");
  const { Pool } = pg.default ?? pg;
  pool = new Pool({ connectionString: dbUrl });
  db = drizzle(pool, { schema });
  console.log("[db] Connected to PostgreSQL");
} else {
  const { drizzle } = await import("drizzle-orm/pglite");
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = process.env.PGLITE_DATA_DIR?.trim() || undefined;
  const client = new PGlite(dataDir);

  // Auto-create tables for PGlite on first run
  await client.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id SERIAL PRIMARY KEY,
      instrument TEXT NOT NULL,
      setup_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      structure_score NUMERIC(5,4) NOT NULL,
      order_flow_score NUMERIC(5,4) NOT NULL,
      recall_score NUMERIC(5,4) NOT NULL,
      ml_probability NUMERIC(5,4) NOT NULL,
      claude_score NUMERIC(5,4) NOT NULL,
      final_quality NUMERIC(5,4) NOT NULL,
      claude_verdict TEXT,
      claude_reasoning TEXT,
      entry_price NUMERIC(12,4),
      stop_loss NUMERIC(12,4),
      take_profit NUMERIC(12,4),
      session TEXT,
      regime TEXT,
      news_lockout BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS trades (
      id SERIAL PRIMARY KEY,
      signal_id INTEGER,
      instrument TEXT NOT NULL,
      setup_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      entry_price NUMERIC(12,4) NOT NULL,
      exit_price NUMERIC(12,4),
      stop_loss NUMERIC(12,4) NOT NULL,
      take_profit NUMERIC(12,4) NOT NULL,
      quantity NUMERIC(10,4) NOT NULL,
      pnl NUMERIC(12,4),
      pnl_pct NUMERIC(8,4),
      outcome TEXT NOT NULL DEFAULT 'open',
      mfe NUMERIC(12,4),
      mae NUMERIC(12,4),
      slippage NUMERIC(8,4),
      session TEXT,
      regime TEXT,
      notes TEXT,
      entry_time TIMESTAMPTZ,
      exit_time TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS market_bars (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      bar_time TIMESTAMPTZ NOT NULL,
      open NUMERIC(14,6) NOT NULL,
      high NUMERIC(14,6) NOT NULL,
      low NUMERIC(14,6) NOT NULL,
      close NUMERIC(14,6) NOT NULL,
      volume NUMERIC(18,2) NOT NULL,
      vwap NUMERIC(14,6),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS accuracy_results (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      setup_type TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      bar_time TIMESTAMPTZ NOT NULL,
      signal_detected TEXT NOT NULL,
      structure_score NUMERIC(5,4) NOT NULL,
      order_flow_score NUMERIC(5,4) NOT NULL,
      recall_score NUMERIC(5,4) NOT NULL,
      final_quality NUMERIC(5,4) NOT NULL,
      outcome TEXT,
      tp_ticks INTEGER,
      sl_ticks INTEGER,
      hit_tp TEXT,
      forward_bars_checked INTEGER,
      regime TEXT,
      direction TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      decision_state TEXT,
      system_mode TEXT,
      instrument TEXT,
      setup_type TEXT,
      symbol TEXT,
      actor TEXT NOT NULL DEFAULT 'system',
      reason TEXT,
      payload_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS brain_entities (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT 'stock',
      name TEXT,
      sector TEXT,
      regime TEXT,
      volatility NUMERIC(8,4),
      last_price NUMERIC(14,6),
      state_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brain_entities_symbol ON brain_entities(symbol);
    CREATE TABLE IF NOT EXISTS brain_relations (
      id SERIAL PRIMARY KEY,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      strength NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
      context_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brain_relations_source ON brain_relations(source_entity_id);
    CREATE INDEX IF NOT EXISTS idx_brain_relations_target ON brain_relations(target_entity_id);
    CREATE TABLE IF NOT EXISTS brain_memories (
      id SERIAL PRIMARY KEY,
      entity_id INTEGER NOT NULL,
      memory_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      signal_id INTEGER,
      trade_id INTEGER,
      confidence NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
      outcome_score NUMERIC(8,4),
      tags TEXT,
      context_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_brain_memories_entity ON brain_memories(entity_id);
    CREATE INDEX IF NOT EXISTS idx_brain_memories_created_at ON brain_memories(created_at);
  `);

  db = drizzle(client, { schema });
  console.log("[db] Using PGlite (in-process) — tables auto-created");
}

export { db, pool };
export * from "./schema";
