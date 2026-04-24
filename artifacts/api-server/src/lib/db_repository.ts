import { logger } from "./logger";
import { pool } from "@workspace/db";

/* ── In-Memory Fallback Stores ──────────────────────────────────────── */

const memoryStores = {
  strategies: new Map<string, any>(),
  positions: new Map<string, any>(),
  fills: new Map<string, any>(),
  journalEntries: new Map<string, any>(),
  watchlist: new Map<string, any>(),
  auditEvents: new Map<string, any>(),
  setupMemories: new Map<string, any>(),
};

let dbHealthy = true;
let dbMode: "postgres" | "pglite" | "memory" = "memory";

/* ── Health Check ──────────────────────────────────────────────────── */

export async function getDbHealth(): Promise<{
  connected: boolean;
  mode: "postgres" | "pglite" | "memory";
}> {
  return { connected: dbHealthy, mode: dbMode };
}

async function probeDb(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

/* ── Initialization (lazy) ─────────────────────────────────────────── */

let initialized = false;
async function ensureInitialized() {
  if (initialized) return;
  initialized = true;
  try {
    const healthy = await probeDb();
    if (healthy) {
      dbHealthy = true;
      dbMode = "postgres";
      logger.info("[db] Connected to PostgreSQL");
    } else {
      dbHealthy = false;
      dbMode = "memory";
      logger.warn("[db] PostgreSQL unavailable, using in-memory storage");
    }
  } catch (err) {
    dbHealthy = false;
    dbMode = "memory";
    logger.warn(`[db] Failed to connect: ${(err as Error).message}`);
  }
}

/* ── 1. Strategy Registry ──────────────────────────────────────────── */

export async function dbSaveStrategy(strategy: {
  name: string;
  status: string;
  description?: string;
  dsl_payload?: any;
  version?: number;
}): Promise<string> {
  await ensureInitialized();
  const id = `strat_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO strategy_certifications (strategy_id, target_tier, current_tier, status, evidence_json, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          id,
          strategy.status,
          strategy.status,
          "initiated",
          JSON.stringify(strategy),
        ]
      );
      return id;
    } catch (err) {
      logger.error(`[db] Failed to save strategy: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  memoryStores.strategies.set(id, { id, ...strategy });
  logger.warn(`[memory] Strategy saved to in-memory store: ${id}`);
  return id;
}

export async function dbGetStrategies(): Promise<any[]> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        "SELECT strategy_id, current_tier, status, evidence_json FROM strategy_certifications ORDER BY created_at DESC LIMIT 100"
      );
      return result.rows;
    } catch (err) {
      logger.error(`[db] Failed to fetch strategies: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.strategies.values());
}

export async function dbUpdateStrategyStatus(
  id: string,
  status: string,
  reason?: string
): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        `UPDATE strategy_certifications SET current_tier = $1, rejection_reason = $2 WHERE strategy_id = $3`,
        [status, reason || null, id]
      );
      return;
    } catch (err) {
      logger.error(
        `[db] Failed to update strategy: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  const strat = memoryStores.strategies.get(id);
  if (strat) {
    strat.status = status;
    if (reason) strat.reason = reason;
  }
}

export async function dbLogPromotion(
  strategyId: string,
  fromStatus: string,
  toStatus: string,
  approvedBy: string,
  evidence?: any
): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO drift_events (strategy_id, event_type, severity, metric_name, action_taken, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          strategyId,
          "promotion",
          "info",
          `${fromStatus}_to_${toStatus}`,
          `Approved by ${approvedBy}`,
        ]
      );
      return;
    } catch (err) {
      logger.error(`[db] Failed to log promotion: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  logger.warn(`[memory] Logged promotion for strategy ${strategyId}`);
}

/* ── 2. Positions ────────────────────────────────────────────────────── */

export async function dbSavePosition(pos: {
  symbol: string;
  side: string;
  quantity: number;
  entry_price: number;
  stop_loss?: number;
  take_profit?: number;
}): Promise<string> {
  await ensureInitialized();
  const id = `pos_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO orders (order_uuid, symbol, side, direction, order_type, quantity, limit_price, expected_entry_price, status, execution_mode, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          id,
          pos.symbol,
          pos.side,
          pos.side,
          "limit",
          pos.quantity,
          pos.stop_loss || null,
          pos.entry_price,
          "accepted",
          "paper",
        ]
      );
      return id;
    } catch (err) {
      logger.error(`[db] Failed to save position: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  memoryStores.positions.set(id, { id, ...pos });
  logger.warn(`[memory] Position saved to in-memory store: ${id}`);
  return id;
}

export async function dbGetOpenPositions(): Promise<any[]> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        "SELECT order_uuid, symbol, side, filled_quantity, avg_fill_price, expected_entry_price FROM orders WHERE status = 'accepted' LIMIT 100"
      );
      return result.rows;
    } catch (err) {
      logger.error(
        `[db] Failed to fetch positions: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.positions.values());
}

export async function dbClosePosition(
  id: string,
  exitPrice: number,
  realizedPnl: number
): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        `UPDATE orders SET status = 'completed', avg_fill_price = $1, realized_pnl = $2, completed_at = NOW() WHERE order_uuid = $3`,
        [exitPrice, realizedPnl, id]
      );
      return;
    } catch (err) {
      logger.error(`[db] Failed to close position: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  const pos = memoryStores.positions.get(id);
  if (pos) {
    pos.exit_price = exitPrice;
    pos.realized_pnl = realizedPnl;
    pos.closed = true;
  }
}

/* ── 3. Fills / Reconciliation ──────────────────────────────────────── */

export async function dbSaveFill(fill: {
  order_id: string;
  symbol: string;
  side: string;
  quantity: number;
  price: number;
  realized_pnl?: number;
}): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO fills (broker_fill_id, symbol, side, quantity, price, slippage, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          `fill_${Date.now()}`,
          fill.symbol,
          fill.side,
          fill.quantity,
          fill.price,
          0,
        ]
      );
      return;
    } catch (err) {
      logger.error(`[db] Failed to save fill: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  memoryStores.fills.set(fill.order_id, fill);
  logger.warn(`[memory] Fill saved to in-memory store: ${fill.order_id}`);
}

export async function dbGetRecentFills(limit: number): Promise<any[]> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        "SELECT broker_fill_id, symbol, side, quantity, price, filled_at FROM fills ORDER BY filled_at DESC LIMIT $1",
        [limit]
      );
      return result.rows;
    } catch (err) {
      logger.error(`[db] Failed to fetch fills: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.fills.values()).slice(0, limit);
}

export async function dbGetDailyPnl(): Promise<number> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        `SELECT COALESCE(SUM(realized_pnl), 0) as total_pnl FROM fills
         WHERE filled_at >= NOW() - INTERVAL '1 day'`
      );
      return parseFloat(result.rows[0]?.total_pnl || 0);
    } catch (err) {
      logger.error(`[db] Failed to get daily PnL: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  let total = 0;
  memoryStores.fills.forEach((fill) => {
    total += fill.realized_pnl || 0;
  });
  return total;
}

/* ── 4. Trade Journal ───────────────────────────────────────────────── */

export async function dbSaveJournalEntry(entry: {
  symbol: string;
  direction: string;
  entry_price: number;
  exit_price?: number;
  pnl?: number;
  notes?: string;
  tags?: string[];
}): Promise<string> {
  await ensureInitialized();
  const id = `je_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO brain_memories (entity_id, memory_type, title, content, confidence, tags, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          1,
          "trade_journal",
          entry.symbol,
          JSON.stringify(entry),
          0.8,
          entry.tags?.join(",") || null,
        ]
      );
      return id;
    } catch (err) {
      logger.error(
        `[db] Failed to save journal entry: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  memoryStores.journalEntries.set(id, { id, ...entry });
  logger.warn(`[memory] Journal entry saved: ${id}`);
  return id;
}

export async function dbGetJournalEntries(limit: number): Promise<any[]> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        "SELECT title, content, tags, created_at FROM brain_memories WHERE memory_type = 'trade_journal' ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
      return result.rows.map((row: any) => ({
        ...JSON.parse(row.content),
        tags: row.tags?.split(",") || [],
      }));
    } catch (err) {
      logger.error(
        `[db] Failed to fetch journal entries: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.journalEntries.values()).slice(0, limit);
}

/* ── 5. Watchlist ──────────────────────────────────────────────────── */

export async function dbSaveWatchlistItem(item: {
  symbol: string;
  priority?: number;
  tags?: string[];
}): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO brain_entities (symbol, entity_type, state_json, created_at, updated_at)
         VALUES ($1, $2, $3, NOW(), NOW())
         ON CONFLICT (symbol) DO UPDATE SET updated_at = NOW()`,
        [item.symbol, "watchlist", JSON.stringify(item)]
      );
      return;
    } catch (err) {
      logger.error(
        `[db] Failed to save watchlist item: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  memoryStores.watchlist.set(item.symbol, item);
  logger.warn(`[memory] Watchlist item saved: ${item.symbol}`);
}

export async function dbGetWatchlist(): Promise<any[]> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        "SELECT symbol, state_json FROM brain_entities WHERE entity_type = 'watchlist' ORDER BY updated_at DESC"
      );
      return result.rows.map((row: any) => ({
        symbol: row.symbol,
        ...JSON.parse(row.state_json),
      }));
    } catch (err) {
      logger.error(`[db] Failed to fetch watchlist: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.watchlist.values());
}

export async function dbRemoveWatchlistItem(symbol: string): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        "DELETE FROM brain_entities WHERE symbol = $1 AND entity_type = 'watchlist'",
        [symbol]
      );
      return;
    } catch (err) {
      logger.error(
        `[db] Failed to remove watchlist item: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  memoryStores.watchlist.delete(symbol);
  logger.warn(`[memory] Watchlist item removed: ${symbol}`);
}

/* ── 6. Audit Events ────────────────────────────────────────────────── */

export async function dbLogAudit(event: {
  event_type: string;
  actor?: string;
  instrument?: string;
  reason?: string;
  payload?: any;
}): Promise<void> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO audit_events (event_type, actor, instrument, reason, payload_json, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          event.event_type,
          event.actor || "system",
          event.instrument || null,
          event.reason || null,
          event.payload ? JSON.stringify(event.payload) : null,
        ]
      );
      return;
    } catch (err) {
      logger.error(`[db] Failed to log audit: ${(err as Error).message}`);
      dbHealthy = false;
    }
  }

  const id = `audit_${Date.now()}`;
  memoryStores.auditEvents.set(id, { id, ...event });
  logger.warn(`[memory] Audit event logged: ${id}`);
}

export async function dbGetAuditEvents(limit: number): Promise<any[]> {
  await ensureInitialized();

  if (dbHealthy) {
    try {
      const result = await pool.query(
        "SELECT event_type, actor, instrument, reason, payload_json, created_at FROM audit_events ORDER BY created_at DESC LIMIT $1",
        [limit]
      );
      return result.rows;
    } catch (err) {
      logger.error(
        `[db] Failed to fetch audit events: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.auditEvents.values()).slice(0, limit);
}

/* ── 7. Memory / Recall ─────────────────────────────────────────────── */

export async function dbSaveSetupMemory(memory: {
  symbol: string;
  setup_type: string;
  context: any;
  outcome?: string;
  screenshot_url?: string;
}): Promise<string> {
  await ensureInitialized();
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  if (dbHealthy) {
    try {
      await pool.query(
        `INSERT INTO brain_memories (entity_id, memory_type, title, content, confidence, outcome_score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          1,
          "setup_memory",
          `${memory.symbol}_${memory.setup_type}`,
          JSON.stringify(memory),
          0.9,
          memory.outcome ? 0.8 : null,
        ]
      );
      return id;
    } catch (err) {
      logger.error(
        `[db] Failed to save setup memory: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  memoryStores.setupMemories.set(id, { id, ...memory });
  logger.warn(`[memory] Setup memory saved: ${id}`);
  return id;
}

export async function dbSearchSimilarSetups(
  symbol: string,
  setup_type?: string,
  limit?: number
): Promise<any[]> {
  await ensureInitialized();
  const lim = limit || 10;

  if (dbHealthy) {
    try {
      const query = setup_type
        ? `SELECT title, content, confidence, outcome_score, created_at FROM brain_memories
           WHERE memory_type = 'setup_memory' AND (title LIKE $1 OR title LIKE $2)
           ORDER BY created_at DESC LIMIT $3`
        : `SELECT title, content, confidence, outcome_score, created_at FROM brain_memories
           WHERE memory_type = 'setup_memory' AND title LIKE $1
           ORDER BY created_at DESC LIMIT $2`;

      const params = setup_type
        ? [`%${symbol}%`, `%${setup_type}%`, lim]
        : [`%${symbol}%`, lim];

      const result = await pool.query(query, params);
      return result.rows.map((row: any) => JSON.parse(row.content));
    } catch (err) {
      logger.error(
        `[db] Failed to search setups: ${(err as Error).message}`
      );
      dbHealthy = false;
    }
  }

  return Array.from(memoryStores.setupMemories.values())
    .filter(
      (mem) =>
        mem.symbol === symbol &&
        (!setup_type || mem.setup_type === setup_type)
    )
    .slice(0, lim);
}
