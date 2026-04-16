/**
 * brain_persistence.ts — Brain trade / chart snapshot persistence.
 *
 * This module provides fire-and-forget persistence hooks used by
 * brain_execution_bridge, strategy_evolution, super_intelligence_v2, and
 * brain_performance. The record interfaces are intentionally loose
 * (unknown + index signature) so callers can pass their own DB-row shapes
 * without schema drift blocking typecheck.
 *
 * Phase 119: Wired to real PostgreSQL via @workspace/db tradesTable.
 */

import { logger } from "./logger.js";

// Lazy DB import — avoid circular dependency at module load time
let _db: any = null;
let _tradesTable: any = null;
let _dbInitAttempted = false;

async function getDb() {
  if (_db) return { db: _db, tradesTable: _tradesTable };
  if (_dbInitAttempted) return null; // Already failed — don't retry every call
  _dbInitAttempted = true;
  try {
    const dbMod = await import("@workspace/db");
    _db = (dbMod as any).db;
    _tradesTable = (dbMod as any).tradesTable;
    if (!_db || !_tradesTable) {
      logger.warn("[brain_persistence] db or tradesTable not available — persistence disabled");
      return null;
    }
    logger.info("[brain_persistence] Connected to database for trade persistence");
    return { db: _db, tradesTable: _tradesTable };
  } catch (err) {
    logger.warn({ err }, "[brain_persistence] Failed to load @workspace/db — persistence disabled");
    return null;
  }
}

// ── Generic loose record type ────────────────────────────────────────────────

export type PersistenceRecord = Record<string, unknown>;

// ── Trade outcome ────────────────────────────────────────────────────────────

export interface TradeOutcomeRecord {
  symbol?: string;
  direction?: "long" | "short";
  [extra: string]: unknown;
}

/**
 * Persist a realized trade outcome. Fire-and-forget — callers should not await.
 */
export async function saveTradeOutcome(record: TradeOutcomeRecord | PersistenceRecord): Promise<void> {
  try {
    const conn = await getDb();
    if (!conn) {
      logger.debug({ record }, "[brain_persistence] saveTradeOutcome (no DB — skipped)");
      return;
    }

    const { db, tradesTable } = conn;
    const insertPayload: Record<string, unknown> = {
      instrument: String(record.symbol || "UNKNOWN"),
      setup_type: String(record.setupType || record.setup_type || "brain_outcome"),
      direction: String(record.direction || "long"),
      entry_price: String(Number(record.entryPrice || record.entry_price || 0)),
      stop_loss: String(Number(record.stopLoss || record.stop_loss || 0)),
      take_profit: String(Number(record.takeProfit || record.take_profit || 0)),
      quantity: String(Number(record.quantity || record.qty || 0)),
      outcome: String(record.outcome || "closed"),
      pnl: record.pnl != null ? String(Number(record.pnl)) : null,
      pnl_pct: record.pnlPct != null || record.pnl_pct != null
        ? String(Number(record.pnlPct || record.pnl_pct))
        : null,
      exit_price: record.exitPrice != null || record.exit_price != null
        ? String(Number(record.exitPrice || record.exit_price))
        : null,
      regime: record.regime ? String(record.regime) : null,
      session: record.session ? String(record.session) : null,
      notes: record.notes ? String(record.notes) : null,
    };

    await db.insert(tradesTable).values(insertPayload);
    logger.debug({ symbol: record.symbol }, "[brain_persistence] saveTradeOutcome persisted");
  } catch (err) {
    logger.warn({ err, record }, "[brain_persistence] saveTradeOutcome failed — data not persisted");
  }
}

// ── Chart snapshots ─────────────────────────────────────────────────────────

export interface ChartSnapshotRecord {
  symbol?: string;
  timeframe?: string;
  takenAt?: number | string;
  imageRef?: string;
  note?: string;
  [extra: string]: unknown;
}

// In-memory snapshot store (no dedicated chart_snapshots table yet)
const _chartSnapshots: ChartSnapshotRecord[] = [];
const MAX_SNAPSHOTS = 1000;

export async function saveChartSnapshot(record: ChartSnapshotRecord | PersistenceRecord): Promise<void> {
  try {
    _chartSnapshots.unshift({
      ...record,
      takenAt: record.takenAt || Date.now(),
    } as ChartSnapshotRecord);
    if (_chartSnapshots.length > MAX_SNAPSHOTS) {
      _chartSnapshots.length = MAX_SNAPSHOTS;
    }
    logger.debug({ symbol: record.symbol }, "[brain_persistence] saveChartSnapshot stored (in-memory)");
  } catch (err) {
    logger.warn({ err }, "[brain_persistence] saveChartSnapshot failed");
  }
}

export function getRecentSnapshots(limit = 50): ChartSnapshotRecord[] {
  return _chartSnapshots.slice(0, limit);
}

// ── Read-side ───────────────────────────────────────────────────────────────

export interface PortfolioStatRow {
  symbol: string;
  trades: number;
  wins: number;
  losses: number;
  pnl: number;
  pnlR: number;
  // Legacy aliases used by brain_performance.ts
  totalTrades?: number;
  winRate?: number;
  totalPnlR?: number;
  [extra: string]: unknown;
}

export async function loadRecentOutcomes(
  _symbol?: string | undefined,
  _limit: number = 500,
): Promise<Array<TradeOutcomeRecord & Record<string, any>>> {
  try {
    const conn = await getDb();
    if (!conn) return [];
    const { db, tradesTable } = conn;

    // Use raw SQL for flexible filtering — tradesTable.select() is fine too
    const { desc, eq } = await import("drizzle-orm");
    let query = db.select().from(tradesTable).orderBy(desc(tradesTable.created_at)).limit(_limit);
    if (_symbol) {
      query = query.where(eq(tradesTable.instrument, _symbol));
    }
    const rows = await query;
    return rows.map((r: any) => ({
      symbol: r.instrument,
      direction: r.direction,
      outcome: r.outcome,
      pnl: Number(r.pnl ?? 0),
      entryPrice: Number(r.entry_price ?? 0),
      exitPrice: Number(r.exit_price ?? 0),
      regime: r.regime,
      session: r.session,
      ...r,
    }));
  } catch (err) {
    logger.warn({ err }, "[brain_persistence] loadRecentOutcomes failed");
    return [];
  }
}

export async function getPortfolioStats(): Promise<PortfolioStatRow[]> {
  try {
    const conn = await getDb();
    if (!conn) return [];
    const { db } = conn;

    // Aggregate by instrument
    const result = await db.execute(
      `SELECT instrument AS symbol,
              COUNT(*)::int AS trades,
              COUNT(*) FILTER (WHERE outcome = 'win')::int AS wins,
              COUNT(*) FILTER (WHERE outcome = 'loss')::int AS losses,
              COALESCE(SUM(pnl::numeric), 0)::float AS pnl,
              COALESCE(SUM(pnl_pct::numeric), 0)::float AS "pnlR"
       FROM trades
       WHERE outcome IN ('win', 'loss', 'closed')
       GROUP BY instrument
       ORDER BY trades DESC`
    );
    return (result.rows || []) as PortfolioStatRow[];
  } catch (err) {
    logger.warn({ err }, "[brain_persistence] getPortfolioStats failed");
    return [];
  }
}

// ── SI model state ───────────────────────────────────────────────────────────

export interface SiModelStateRecord {
  strategyId?: string;
  regime?: string;
  symbol?: string;
  state?: unknown;
  updatedAt?: number | string;
  [extra: string]: unknown;
}

// In-memory store for SI model state (no dedicated table yet)
const _siModelStates = new Map<string, SiModelStateRecord>();

export async function saveSiModelState(record: SiModelStateRecord | PersistenceRecord): Promise<void> {
  const key = String(record.strategyId || "default");
  _siModelStates.set(key, { ...record, updatedAt: Date.now() } as SiModelStateRecord);
}

export async function loadAllSiModelStates(): Promise<SiModelStateRecord[]> {
  return Array.from(_siModelStates.values());
}

// ── Strategy params ──────────────────────────────────────────────────────────

export interface StrategyParamsRecord {
  strategyId?: string;
  params?: Record<string, unknown>;
  updatedAt?: number | string;
  [extra: string]: unknown;
}

const _strategyParams = new Map<string, StrategyParamsRecord>();

export async function saveStrategyParams(record: StrategyParamsRecord | PersistenceRecord): Promise<void> {
  const key = String(record.strategyId || "default");
  _strategyParams.set(key, { ...record, updatedAt: Date.now() } as StrategyParamsRecord);
}

export async function loadAllStrategyParams(): Promise<StrategyParamsRecord[]> {
  return Array.from(_strategyParams.values());
}

// ── Job history ──────────────────────────────────────────────────────────────

export interface JobHistoryRecord {
  jobId?: string;
  type?: string;
  status?: string;
  payload?: unknown;
  result?: unknown;
  error?: string;
  startedAt?: number | string;
  finishedAt?: number | string;
  durationMs?: number;
  [extra: string]: unknown;
}

const _jobHistory: JobHistoryRecord[] = [];
const MAX_JOB_HISTORY = 500;

export async function saveJobHistory(record: JobHistoryRecord | PersistenceRecord): Promise<void> {
  _jobHistory.unshift({ ...record, finishedAt: record.finishedAt || Date.now() } as JobHistoryRecord);
  if (_jobHistory.length > MAX_JOB_HISTORY) {
    _jobHistory.length = MAX_JOB_HISTORY;
  }
}

export function getRecentJobHistory(limit = 50): JobHistoryRecord[] {
  return _jobHistory.slice(0, limit);
}
