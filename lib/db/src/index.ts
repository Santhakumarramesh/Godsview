/**
 * Smart database driver: uses PostgreSQL if DATABASE_URL is set,
 * otherwise falls back to PGlite (in-process WASM PostgreSQL).
 */
import * as schema from "./schema";

let db: any;
let pool: any = null;

const DATABASE_URL = process.env.DATABASE_URL?.trim();

if (DATABASE_URL) {
  // ── PostgreSQL mode ──
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = await import("pg");
  const { Pool } = pg.default;
  pool = new Pool({ connectionString: DATABASE_URL });
  db = drizzle(pool, { schema });
  console.log("[db] Connected to PostgreSQL");
} else {
  // ── PGlite mode (zero-setup, in-process) ──
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const pglite = new PGlite();

  // Auto-create tables matching the Drizzle schema
  await pglite.exec(`
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
      news_lockout BOOLEAN NOT NULL DEFAULT FALSE,
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
  `);

  db = drizzle(pglite, { schema });
  console.log("[db] Using PGlite (in-process) — tables auto-created");
}

export { db, pool };
export * from "./schema";

