/**
 * brain_persistence — in-memory + best-effort durable persistence for brain data.
 *
 * Phase 2 hardening: the original module was an empty file, which meant every
 * import here returned `undefined` and crashed callers at runtime. This
 * implementation keeps a minimal in-memory store so the brain, rulebook,
 * strategy evolution, and SI model can all run without a database. Where the
 * filesystem is writable, we also append to `data/brain/*.jsonl` so state
 * survives restarts.
 *
 * All functions are async and non-throwing: persistence is always best-effort.
 */

import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

// ── Disk paths ────────────────────────────────────────────────────────────

const DATA_DIR = path.resolve(process.cwd(), "data", "brain");
try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  // fs may be read-only in some envs (e.g. container); we fall back to memory.
}

function appendJsonl(file: string, row: unknown): void {
  try {
    fs.appendFileSync(path.join(DATA_DIR, file), JSON.stringify(row) + "\n");
  } catch (err) {
    logger.debug({ err }, `brain_persistence: could not append to ${file}`);
  }
}

function readJsonl<T>(file: string, limit = 1000): T[] {
  try {
    const fp = path.join(DATA_DIR, file);
    if (!fs.existsSync(fp)) return [];
    const lines = fs
      .readFileSync(fp, "utf8")
      .split("\n")
      .filter((l) => l.trim().length > 0);
    const slice = lines.slice(-Math.max(1, limit));
    return slice
      .map((l) => {
        try {
          return JSON.parse(l) as T;
        } catch {
          return null;
        }
      })
      .filter((x): x is T => x !== null);
  } catch (err) {
    logger.debug({ err }, `brain_persistence: could not read ${file}`);
    return [];
  }
}

// ── Trade outcomes ────────────────────────────────────────────────────────

export interface TradeOutcome {
  symbol: string;
  strategyId?: string;
  entryAt?: string;
  exitAt?: string;
  entryPrice?: number;
  exitPrice?: number;
  pnl?: number;
  pnlPct?: number;
  rMultiple?: number;
  features?: Record<string, unknown>;
  context?: Record<string, unknown>;
  result?: "win" | "loss" | "scratch";
  [key: string]: unknown;
}

const tradeOutcomes: TradeOutcome[] = readJsonl<TradeOutcome>("trade_outcomes.jsonl", 5000);

export async function saveTradeOutcome(outcome: TradeOutcome): Promise<void> {
  const row = { ...outcome, _ts: new Date().toISOString() };
  tradeOutcomes.push(row);
  if (tradeOutcomes.length > 10_000) tradeOutcomes.shift();
  appendJsonl("trade_outcomes.jsonl", row);
}

export async function loadRecentOutcomes(
  symbol?: string,
  limit = 200,
): Promise<TradeOutcome[]> {
  const pool = symbol
    ? tradeOutcomes.filter((o) => o.symbol === symbol)
    : tradeOutcomes;
  return pool.slice(-Math.max(1, limit));
}

// ── Portfolio stats ───────────────────────────────────────────────────────

export interface PortfolioStats {
  tradesTotal: number;
  wins: number;
  losses: number;
  winRate: number;
  avgR: number;
  grossPnl: number;
  lastUpdatedAt: string;
}

export async function getPortfolioStats(): Promise<PortfolioStats> {
  const trades = tradeOutcomes;
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length;
  const losses = trades.filter((t) => (t.pnl ?? 0) < 0).length;
  const grossPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const rTotal = trades.reduce((s, t) => s + (t.rMultiple ?? 0), 0);
  return {
    tradesTotal: trades.length,
    wins,
    losses,
    winRate: trades.length ? wins / trades.length : 0,
    avgR: trades.length ? rTotal / trades.length : 0,
    grossPnl,
    lastUpdatedAt: new Date().toISOString(),
  };
}

// ── Chart snapshots ───────────────────────────────────────────────────────

export interface ChartSnapshot {
  symbol: string;
  capturedAt?: string;
  timeframe?: string;
  pngPath?: string;
  pngBase64?: string;
  annotations?: Record<string, unknown>;
  [key: string]: unknown;
}

export async function saveChartSnapshot(snap: ChartSnapshot): Promise<void> {
  appendJsonl("chart_snapshots.jsonl", { ...snap, _ts: new Date().toISOString() });
}

// ── Job history ───────────────────────────────────────────────────────────

export interface JobHistoryRow {
  id: string;
  type: string;
  status: string;
  latencyMs?: number;
  error?: string;
  result?: unknown;
  startedAt?: string;
  finishedAt?: string;
  [key: string]: unknown;
}

export async function saveJobHistory(job: JobHistoryRow): Promise<void> {
  appendJsonl("job_history.jsonl", { ...job, _ts: new Date().toISOString() });
}

// ── Strategy params ───────────────────────────────────────────────────────

export interface PersistedStrategyParams {
  symbol: string;
  strategy_id: string;
  version: number | string;
  tier?: string;
  min_confirmation_score?: string;
  require_mtf_alignment?: boolean;
  require_bos?: boolean;
  min_ob_quality?: string;
  stop_atr_multiplier?: string;
  take_profit_atr_multiplier?: string;
  max_kelly_fraction?: string;
  allowed_regimes?: string;
  blacklisted_regimes?: string;
  changelog?: string;
  is_active?: boolean;
  [key: string]: unknown;
}

const strategyParamsRows: PersistedStrategyParams[] = readJsonl<PersistedStrategyParams>(
  "strategy_params.jsonl",
  1000,
);

function strategyKey(row: { strategy_id: string; symbol: string }): string {
  return `${row.strategy_id}::${row.symbol}`;
}

export async function saveStrategyParams(
  params: PersistedStrategyParams,
): Promise<void> {
  const key = strategyKey(params);
  const idx = strategyParamsRows.findIndex((r) => strategyKey(r) === key);
  const row = { ...params, _ts: new Date().toISOString() };
  if (idx >= 0) strategyParamsRows[idx] = row;
  else strategyParamsRows.push(row);
  appendJsonl("strategy_params.jsonl", row);
}

export async function loadAllStrategyParams(): Promise<PersistedStrategyParams[]> {
  return [...strategyParamsRows];
}

// ── SI model state ────────────────────────────────────────────────────────

export interface PersistedSiModelState {
  symbol: string;
  model_version: number | string;
  weight_m1: string;
  weight_m2: string;
  weight_m3: string;
  weight_m4: string;
  weight_m5: string;
  platt_a: string;
  platt_b: string;
  brier_score?: string;
  total_outcomes?: number;
  regime_calibration?: string;
  is_active?: boolean;
  [key: string]: unknown;
}

const siModelStateRows: PersistedSiModelState[] = readJsonl<PersistedSiModelState>(
  "si_model_state.jsonl",
  500,
);

export async function saveSiModelState(
  state: PersistedSiModelState,
): Promise<void> {
  const idx = siModelStateRows.findIndex((r) => r.symbol === state.symbol);
  const row = { ...state, _ts: new Date().toISOString() };
  if (idx >= 0) siModelStateRows[idx] = row;
  else siModelStateRows.push(row);
  appendJsonl("si_model_state.jsonl", row);
}

export async function loadAllSiModelStates(): Promise<PersistedSiModelState[]> {
  return [...siModelStateRows];
}

// ── Aggregate façade (used by legacy routes/governance.ts) ────────────────

export interface BrainPersistence {
  saveTradeOutcome: typeof saveTradeOutcome;
  loadRecentOutcomes: typeof loadRecentOutcomes;
  getPortfolioStats: typeof getPortfolioStats;
  saveChartSnapshot: typeof saveChartSnapshot;
  saveJobHistory: typeof saveJobHistory;
  saveStrategyParams: typeof saveStrategyParams;
  loadAllStrategyParams: typeof loadAllStrategyParams;
  saveSiModelState: typeof saveSiModelState;
  loadAllSiModelStates: typeof loadAllSiModelStates;
}

let _singleton: BrainPersistence | null = null;

export function getBrainPersistence(): BrainPersistence {
  if (!_singleton) {
    _singleton = {
      saveTradeOutcome,
      loadRecentOutcomes,
      getPortfolioStats,
      saveChartSnapshot,
      saveJobHistory,
      saveStrategyParams,
      loadAllStrategyParams,
      saveSiModelState,
      loadAllSiModelStates,
    };
  }
  return _singleton;
}
