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
    CREATE TABLE IF NOT EXISTS brain_relations (
      id SERIAL PRIMARY KEY,
      source_entity_id INTEGER NOT NULL,
      target_entity_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL,
      strength NUMERIC(6,4) NOT NULL DEFAULT 0.5000,
      context_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
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
    CREATE TABLE IF NOT EXISTS si_decisions (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      setup_type TEXT NOT NULL,
      direction TEXT NOT NULL,
      regime TEXT NOT NULL,
      approved BOOLEAN NOT NULL,
      win_probability NUMERIC(5,4) NOT NULL,
      edge_score NUMERIC(6,4) NOT NULL,
      enhanced_quality NUMERIC(5,4) NOT NULL,
      kelly_fraction NUMERIC(5,4) NOT NULL,
      confluence_score NUMERIC(3,2) NOT NULL,
      suggested_qty INTEGER NOT NULL,
      rejection_reason TEXT,
      entry_price NUMERIC(12,4) NOT NULL,
      stop_loss NUMERIC(12,4) NOT NULL,
      take_profit NUMERIC(12,4) NOT NULL,
      final_quality NUMERIC(5,4) NOT NULL,
      gate_action TEXT,
      gate_block_reasons TEXT,
      trailing_stop_json TEXT,
      profit_targets_json TEXT,
      outcome TEXT,
      realized_pnl NUMERIC(12,2),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Phase 12: Execution truth layer
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_uuid TEXT NOT NULL,
      broker_order_id TEXT,
      signal_id INTEGER,
      si_decision_id INTEGER,
      strategy_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      direction TEXT NOT NULL,
      order_type TEXT NOT NULL DEFAULT 'limit',
      quantity NUMERIC(12,4) NOT NULL,
      limit_price NUMERIC(14,6),
      stop_price NUMERIC(14,6),
      expected_entry_price NUMERIC(14,6),
      filled_quantity NUMERIC(12,4) DEFAULT 0,
      avg_fill_price NUMERIC(14,6),
      realized_pnl NUMERIC(14,4),
      status TEXT NOT NULL DEFAULT 'intent_created',
      execution_mode TEXT NOT NULL DEFAULT 'paper',
      rejection_reason TEXT,
      error_message TEXT,
      intent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      submitted_at TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      first_fill_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      metadata_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS fills (
      id SERIAL PRIMARY KEY,
      order_id INTEGER,
      broker_fill_id TEXT NOT NULL,
      broker_order_id TEXT,
      symbol TEXT NOT NULL,
      side TEXT NOT NULL,
      quantity NUMERIC(12,4) NOT NULL,
      price NUMERIC(14,6) NOT NULL,
      commission NUMERIC(10,4) DEFAULT 0,
      expected_price NUMERIC(14,6),
      slippage NUMERIC(10,6),
      slippage_bps NUMERIC(8,2),
      matched_to_position BOOLEAN DEFAULT FALSE,
      realized_pnl NUMERIC(14,4),
      filled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS execution_metrics (
      id SERIAL PRIMARY KEY,
      order_id INTEGER NOT NULL,
      symbol TEXT NOT NULL,
      strategy_id TEXT,
      avg_fill_price NUMERIC(14,6),
      expected_price NUMERIC(14,6),
      realized_slippage_bps NUMERIC(8,2),
      submit_to_first_fill_ms INTEGER,
      submit_to_complete_ms INTEGER,
      fill_count INTEGER DEFAULT 1,
      total_commission NUMERIC(10,4) DEFAULT 0,
      execution_mode TEXT,
      regime TEXT,
      setup_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reconciliation_events (
      id SERIAL PRIMARY KEY,
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      local_position_count INTEGER DEFAULT 0,
      broker_position_count INTEGER DEFAULT 0,
      orphaned_local_orders INTEGER DEFAULT 0,
      unknown_broker_positions INTEGER DEFAULT 0,
      quantity_mismatches INTEGER DEFAULT 0,
      details_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Phase 13: Alignment layer
    CREATE TABLE IF NOT EXISTS alignment_snapshots (
      id SERIAL PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      symbol TEXT,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      bt_win_rate NUMERIC(6,4),
      bt_avg_pnl NUMERIC(12,4),
      bt_sharpe NUMERIC(8,4),
      bt_max_drawdown_pct NUMERIC(8,4),
      bt_avg_slippage_bps NUMERIC(8,2),
      bt_trade_count INTEGER,
      live_win_rate NUMERIC(6,4),
      live_avg_pnl NUMERIC(12,4),
      live_sharpe NUMERIC(8,4),
      live_max_drawdown_pct NUMERIC(8,4),
      live_avg_slippage_bps NUMERIC(8,2),
      live_trade_count INTEGER,
      win_rate_divergence NUMERIC(8,4),
      pnl_divergence NUMERIC(8,4),
      sharpe_divergence NUMERIC(8,4),
      slippage_divergence NUMERIC(8,4),
      composite_alignment_score NUMERIC(6,4),
      verdict TEXT NOT NULL,
      drift_direction TEXT,
      regime TEXT,
      details_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS slippage_calibration (
      id SERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      assumed_slippage_bps NUMERIC(8,2),
      actual_avg_slippage_bps NUMERIC(8,2),
      actual_p50_slippage_bps NUMERIC(8,2),
      actual_p95_slippage_bps NUMERIC(8,2),
      actual_max_slippage_bps NUMERIC(8,2),
      fill_count INTEGER,
      calibration_error_bps NUMERIC(8,2),
      recommended_slippage_bps NUMERIC(8,2),
      is_calibrated BOOLEAN DEFAULT FALSE,
      regime TEXT,
      setup_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS drift_events (
      id SERIAL PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      symbol TEXT,
      event_type TEXT NOT NULL,
      severity TEXT NOT NULL,
      metric_name TEXT NOT NULL,
      backtest_value NUMERIC(12,4),
      live_value NUMERIC(12,4),
      divergence NUMERIC(8,4),
      threshold NUMERIC(8,4),
      action_taken TEXT,
      resolved BOOLEAN DEFAULT FALSE,
      resolved_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    -- Phase 14: ML Operations
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
    CREATE TABLE IF NOT EXISTS retrain_events (
      id SERIAL PRIMARY KEY,
      model_name TEXT NOT NULL,
      trigger TEXT NOT NULL,
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

    -- Phase 16: Strategy Certification
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

    -- Phase 20: Certification Run Orchestration
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
    CREATE TABLE IF NOT EXISTS certification_run_steps (
      id SERIAL PRIMARY KEY,
      run_id TEXT NOT NULL,
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
