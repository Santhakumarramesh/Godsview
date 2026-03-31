import * as schema from "./schema";

/**
 * Smart DB driver selection with production-grade connection management:
 * - DATABASE_URL set → real PostgreSQL with connection pool + retry
 * - DATABASE_URL empty → PGlite (in-process, zero setup)
 *
 * Production pool settings:
 *   - min 2 / max 10 connections (tunable via DB_POOL_MAX)
 *   - 30s idle timeout, 10s connection timeout
 *   - Automatic reconnect on pool error
 */

let db: any;
let pool: any = { end: async () => {} };
let _driver: "pg" | "pglite" = "pglite";

const dbUrl = process.env.DATABASE_URL?.trim();

if (dbUrl) {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pg = await import("pg");
  const { Pool } = pg.default ?? pg;

  const poolMax = Math.min(
    Math.max(parseInt(process.env.DB_POOL_MAX || "10", 10) || 10, 1),
    50,
  );

  pool = new Pool({
    connectionString: dbUrl,
    max: poolMax,
    min: 2,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  /* Log pool errors but don't crash — pg Pool auto-reconnects */
  pool.on("error", (err: Error) => {
    console.error(`[db] Pool background error: ${err.message}`);
  });

  db = drizzle(pool, { schema });
  _driver = "pg";
  console.log(`[db] Connected to PostgreSQL (pool max=${poolMax})`);
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
      order_id TEXT,
      operator_id TEXT,
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
    CREATE TABLE IF NOT EXISTS trading_sessions (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      system_mode TEXT NOT NULL,
      operator_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      trades_executed INTEGER DEFAULT 0,
      signals_generated INTEGER DEFAULT 0,
      realized_pnl NUMERIC(12,4),
      peak_drawdown_pct NUMERIC(8,4),
      breaker_triggered BOOLEAN DEFAULT false,
      kill_switch_used BOOLEAN DEFAULT false,
      exit_reason TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS breaker_events (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      level TEXT NOT NULL,
      previous_level TEXT,
      trigger TEXT NOT NULL,
      daily_pnl NUMERIC(12,4),
      consecutive_losses INTEGER,
      position_size_multiplier NUMERIC(5,4),
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  db = drizzle(client, { schema });
  _driver = "pglite";
  console.log("[db] Using PGlite (in-process) — tables auto-created");
}

/* ── Health Check ──────────────────────────────────────────────────── */

export interface DbHealthResult {
  ok: boolean;
  driver: "pg" | "pglite";
  latencyMs: number;
  poolTotal?: number;
  poolIdle?: number;
  poolWaiting?: number;
  error?: string;
}

/**
 * Lightweight health probe — runs SELECT 1 and reports pool stats.
 * Used by preflight checks and /health endpoint.
 */
export async function checkDbHealth(): Promise<DbHealthResult> {
  const start = performance.now();
  try {
    await db.execute(/* sql */ "SELECT 1");
    const latencyMs = Math.round(performance.now() - start);
    const result: DbHealthResult = { ok: true, driver: _driver, latencyMs };
    if (_driver === "pg" && pool.totalCount !== undefined) {
      result.poolTotal = pool.totalCount;
      result.poolIdle = pool.idleCount;
      result.poolWaiting = pool.waitingCount;
    }
    return result;
  } catch (err: any) {
    return {
      ok: false,
      driver: _driver,
      latencyMs: Math.round(performance.now() - start),
      error: err.message,
    };
  }
}

/* ── Graceful Shutdown ─────────────────────────────────────────────── */

/**
 * Drain the connection pool. Call this during server shutdown.
 */
export async function closePool(): Promise<void> {
  try {
    await pool.end();
    console.log("[db] Connection pool closed");
  } catch (err: any) {
    console.error(`[db] Error closing pool: ${err.message}`);
  }
}

/* ── Exports ───────────────────────────────────────────────────────── */

export { db, pool };
export * from "./schema";
