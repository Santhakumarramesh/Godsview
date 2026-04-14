/**
 * brain_persistence.ts — Stub for brain trade / chart snapshot persistence.
 *
 * This module provides fire-and-forget persistence hooks used by
 * brain_execution_bridge, strategy_evolution, super_intelligence_v2, and
 * brain_performance. The record interfaces are intentionally loose
 * (unknown + index signature) so callers can pass their own DB-row shapes
 * without schema drift blocking typecheck.
 */

import { logger } from "./logger.js";

// ── Generic loose record type ────────────────────────────────────────────────

export type PersistenceRecord = Record<string, unknown>;

// ── Trade outcome ────────────────────────────────────────────────────────────

export interface TradeOutcomeRecord {
  symbol?: string;
  direction?: "long" | "short";
  [extra: string]: unknown;
}

/**
 * Persist a realized trade outcome. Returns void — callers should not await.
 */
export async function saveTradeOutcome(record: TradeOutcomeRecord | PersistenceRecord): Promise<void> {
  try {
    logger.debug({ record }, "[brain_persistence] saveTradeOutcome");
    // TODO: wire to database when persistence layer is ready
  } catch (err) {
    logger.warn({ err }, "[brain_persistence] saveTradeOutcome failed");
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

export async function saveChartSnapshot(record: ChartSnapshotRecord | PersistenceRecord): Promise<void> {
  try {
    logger.debug({ record }, "[brain_persistence] saveChartSnapshot");
  } catch (err) {
    logger.warn({ err }, "[brain_persistence] saveChartSnapshot failed");
  }
}

// ── Read-side stubs ──────────────────────────────────────────────────────────

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
  return [];
}

export async function getPortfolioStats(): Promise<PortfolioStatRow[]> {
  return [];
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

export async function saveSiModelState(_record: SiModelStateRecord | PersistenceRecord): Promise<void> {
  // Stub — no-op until persistence layer wired
}

export async function loadAllSiModelStates(): Promise<SiModelStateRecord[]> {
  return [];
}

// ── Strategy params ──────────────────────────────────────────────────────────

export interface StrategyParamsRecord {
  strategyId?: string;
  params?: Record<string, unknown>;
  updatedAt?: number | string;
  [extra: string]: unknown;
}

export async function saveStrategyParams(_record: StrategyParamsRecord | PersistenceRecord): Promise<void> {
  // Stub — no-op
}

export async function loadAllStrategyParams(): Promise<StrategyParamsRecord[]> {
  return [];
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

export async function saveJobHistory(_record: JobHistoryRecord | PersistenceRecord): Promise<void> {
  // Stub — no-op. Jobs are tracked in-memory; DB persistence wired later.
}
