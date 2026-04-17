/**
 * strategy_params_store.ts — Phase 11B
 *
 * Per-strategy parameter override store.
 * Allows the operator to tune individual strategy thresholds at runtime
 * without restarting the server or editing environment variables.
 *
 * Overrides layer on top of the defaults baked into strategy_evolution.ts.
 * The execution bridge checks this store before evaluating a signal.
 *
 * Persistence: writes to a lightweight JSON file in the workspace so overrides
 * survive restarts (no DB migration required).
 */

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface StrategyParamOverride {
  strategyId: string;
  /** Minimum confirmation score to execute (0–1) */
  minScore?: number;
  /** Minimum SI win probability to execute (0–1) */
  minWinProb?: number;
  /** Max Kelly fraction multiplier (0–1) */
  maxKellyFraction?: number;
  /** ATR multiplier for stop-loss distance */
  atrMultiplierSL?: number;
  /** ATR multiplier for take-profit target */
  atrMultiplierTP?: number;
  /** Whether this strategy is manually disabled */
  enabled?: boolean;
  /** Regimes this strategy should avoid (overrides default blacklist) */
  blacklistedRegimes?: string[];
  /** ISO timestamp of last update */
  updatedAt?: string;
  /** Free-text operator note */
  note?: string;
}

export interface StrategyParamSnapshot {
  overrides: StrategyParamOverride[];
  count: number;
  persistedAt: string | null;
}

// ── Persistence path ───────────────────────────────────────────────────────────

const PERSIST_PATH = join(
  process.env.GODSVIEW_DATA_DIR ?? process.cwd(),
  "strategy_params_overrides.json",
);

// ── Store ──────────────────────────────────────────────────────────────────────

class StrategyParamsStore {
  private overrides = new Map<string, StrategyParamOverride>();
  private persistedAt: string | null = null;

  constructor() {
    this._load();
  }

  /** Get override for a strategy. Returns undefined if no override set. */
  get(strategyId: string): StrategyParamOverride | undefined {
    return this.overrides.get(strategyId);
  }

  /** List all active overrides */
  list(): StrategyParamOverride[] {
    return Array.from(this.overrides.values());
  }

  /** Set or merge override for a strategy */
  set(strategyId: string, patch: Partial<Omit<StrategyParamOverride, "strategyId">>): StrategyParamOverride {
    const existing = this.overrides.get(strategyId) ?? { strategyId };
    const updated: StrategyParamOverride = {
      ...existing,
      ...patch,
      strategyId,
      updatedAt: new Date().toISOString(),
    };
    this.overrides.set(strategyId, updated);
    this._persist();
    logger.info({ strategyId, patch }, "[StrategyParamsStore] Override saved");
    return updated;
  }

  /** Delete override — strategy reverts to defaults */
  reset(strategyId: string): boolean {
    const had = this.overrides.has(strategyId);
    this.overrides.delete(strategyId);
    if (had) {
      this._persist();
      logger.info({ strategyId }, "[StrategyParamsStore] Override reset to defaults");
    }
    return had;
  }

  /** Clear all overrides */
  resetAll(): void {
    this.overrides.clear();
    this._persist();
    logger.info("[StrategyParamsStore] All overrides cleared");
  }

  /** Full snapshot for API/UI */
  snapshot(): StrategyParamSnapshot {
    return {
      overrides: this.list(),
      count: this.overrides.size,
      persistedAt: this.persistedAt,
    };
  }

  // ── Score/prob gate helpers ─────────────────────────────────────────────────

  /** Effective min score for a strategy (override or system default) */
  effectiveMinScore(strategyId: string, systemDefault: number): number {
    return this.get(strategyId)?.minScore ?? systemDefault;
  }

  /** Effective min win prob for a strategy */
  effectiveMinWinProb(strategyId: string, systemDefault: number): number {
    return this.get(strategyId)?.minWinProb ?? systemDefault;
  }

  /** Whether this strategy is enabled (default: true) */
  isEnabled(strategyId: string): boolean {
    return this.get(strategyId)?.enabled ?? true;
  }

  /** Effective max Kelly fraction */
  effectiveMaxKelly(strategyId: string, systemDefault: number): number {
    return this.get(strategyId)?.maxKellyFraction ?? systemDefault;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private _persist(): void {
    try {
      const data = {
        overrides: this.list(),
        savedAt: new Date().toISOString(),
      };
      writeFileSync(PERSIST_PATH, JSON.stringify(data, null, 2), "utf-8");
      this.persistedAt = data.savedAt;
    } catch (err) {
      logger.warn({ err, path: PERSIST_PATH }, "[StrategyParamsStore] Failed to persist overrides");
    }
  }

  private _load(): void {
    try {
      if (!existsSync(PERSIST_PATH)) return;
      const raw = readFileSync(PERSIST_PATH, "utf-8");
      const data = JSON.parse(raw) as { overrides: StrategyParamOverride[]; savedAt?: string };
      for (const o of data.overrides ?? []) {
        if (o.strategyId) this.overrides.set(o.strategyId, o);
      }
      this.persistedAt = data.savedAt ?? null;
      logger.info({ count: this.overrides.size }, "[StrategyParamsStore] Loaded overrides from disk");
    } catch (err) {
      logger.warn({ err }, "[StrategyParamsStore] Could not load persisted overrides — starting fresh");
    }
  }
}

export const strategyParamsStore = new StrategyParamsStore();
