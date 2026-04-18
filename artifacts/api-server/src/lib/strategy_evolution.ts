/**
 * strategy_evolution.ts — GodsView Strategy Evolution Engine
 *
 * Strategies learn their own character over time — like a quant who
 * has traded for years and developed gut feelings backed by data.
 *
 * Each strategy has MUTABLE parameters that shift after every backtest:
 *   - Confirmation score threshold (raises if too many false positives)
 *   - MTF alignment requirement (becomes mandatory if MTF-divergent trades lose)
 *   - Regime filter (blocks regimes with poor win rate empirically)
 *   - Stop loss multiplier (widens/tightens based on MAE data)
 *   - Take profit multiplier (adjusts based on MFE capture ratio)
 *   - Minimum OB quality (filters weak order blocks)
 *   - Minimum CVD confirmation (orderflow requirement)
 *   - Lookback bars preference (expands when sample is thin)
 *
 * Evolution rules (empirical, not hypothetical):
 *   1. If win rate in regime X < 35% over 20+ trades → blacklist regime X
 *   2. If MTF-divergent WR < MTF-aligned WR by 15%+ → require MTF alignment
 *   3. If avg MAE > current SL × 0.8 → widen stop by 20%
 *   4. If MFE capture < 0.5 (taking only half of potential) → raise TP
 *   5. If Sharpe < 0.5 after 50 trades → raise confirmation threshold
 *   6. If consecutive losses > 5 → reduce size (kelly fraction)
 *   7. If win rate > 65% + Sharpe > 2 → mark strategy as ELITE
 *
 * All changes are logged with reasoning for full transparency.
 */

import { logger } from "./logger";
import { brainJobQueue, BrainJobs } from "./job_queue";
import {
  saveStrategyParams,
  loadAllStrategyParams,
} from "./brain_persistence.js";

// ── Strategy Parameter Set ─────────────────────────────────────────────────

export interface StrategyParams {
  /** Strategy identifier */
  strategyId: string;
  /** Human name */
  name: string;
  /** Symbol this instance is tuned for (or 'GLOBAL' for universal) */
  symbol: string;

  // ── Confirmation gate ────────────────────────────────────────────────────
  /** Minimum composite score to confirm a setup (0-1) */
  minConfirmationScore: number;
  /** Require MTF alignment? */
  requireMTFAlignment: boolean;
  /** Require BOS confirmation? */
  requireBOS: boolean;
  /** Require CHoCH confirmation? */
  requireCHoCH: boolean;
  /** Minimum OB quality score (0-1) */
  minOBQuality: number;
  /** Minimum CVD slope for orderflow confirmation */
  minCVDSlope: number;

  // ── Risk parameters ──────────────────────────────────────────────────────
  /** ATR multiplier for stop loss */
  stopATRMultiplier: number;
  /** ATR multiplier for take profit */
  takeProfitATRMultiplier: number;
  /** Kelly fraction cap (max position size as fraction of capital) */
  maxKellyFraction: number;
  /** R:R minimum requirement */
  minRR: number;

  // ── Regime filters ───────────────────────────────────────────────────────
  /** Regimes to trade in */
  allowedRegimes: string[];
  /** Regimes to avoid (empirically blacklisted) */
  blacklistedRegimes: string[];

  // ── Performance state ────────────────────────────────────────────────────
  /** Total trades this strategy has been evaluated on */
  totalTrades: number;
  /** Current win rate */
  winRate: number;
  /** Current Sharpe ratio */
  sharpeRatio: number;
  /** Current Sortino ratio */
  sortinoRatio: number;
  /** Current Calmar ratio */
  calmarRatio: number;
  /** Current max drawdown in R */
  maxDrawdownR: number;
  /** Strategy performance tier */
  tier: "SEED" | "LEARNING" | "PROVEN" | "ELITE" | "DEGRADING" | "SUSPENDED";
  /** Number of consecutive losses */
  consecutiveLosses: number;
  /** Number of consecutive wins */
  consecutiveWins: number;

  // ── Evolution metadata ───────────────────────────────────────────────────
  /** Version counter — increments with each evolution */
  version: number;
  /** Change log */
  changelog: StrategyChangeEntry[];
  /** When this strategy was created */
  createdAt: string;
  /** When this strategy was last evolved */
  lastEvolvedAt: string;
  /** When this strategy was last backtested */
  lastBacktestedAt: string;
}

export interface StrategyChangeEntry {
  version: number;
  timestamp: string;
  param: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string;
  evidence: string;
  tradeCount: number;
}

// ── Evolution Input ────────────────────────────────────────────────────────

export interface EvolutionInput {
  symbol: string;
  strategyId: string;
  metrics: {
    winRate: number;
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    profitFactor: number;
    expectancy: number;
    maxDrawdownR: number;
    totalTrades: number;
    avgMFE: number;
    avgMAE: number;
    mtfAlignedWR: number;
    mtfDivergentWR: number;
    winRateByRegime: Record<string, number>;
    tradesByRegime: Record<string, number>;
  };
  consecutiveLosses?: number;
  consecutiveWins?: number;
}

// ── Evolution Output ───────────────────────────────────────────────────────

export interface EvolutionOutput {
  strategyId: string;
  symbol: string;
  version: number;
  previousTier: StrategyParams["tier"];
  newTier: StrategyParams["tier"];
  changes: StrategyChangeEntry[];
  params: StrategyParams;
  summary: string;
  requiresRetraining: boolean;
}

// ── Default Strategy Parameters ────────────────────────────────────────────

function createDefaultStrategy(
  strategyId: string,
  symbol: string,
  name: string,
): StrategyParams {
  return {
    strategyId,
    name,
    symbol,
    minConfirmationScore: 0.55,
    requireMTFAlignment: false,
    requireBOS: true,
    requireCHoCH: false,
    minOBQuality: 0.4,
    minCVDSlope: 0.0,
    stopATRMultiplier: 1.5,
    takeProfitATRMultiplier: 3.0,
    maxKellyFraction: 0.1,
    minRR: 1.5,
    allowedRegimes: ["trend_up", "trend_down", "range", "expansion"],
    blacklistedRegimes: [],
    totalTrades: 0,
    winRate: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    calmarRatio: 0,
    maxDrawdownR: 0,
    tier: "SEED",
    consecutiveLosses: 0,
    consecutiveWins: 0,
    version: 1,
    changelog: [],
    createdAt: new Date().toISOString(),
    lastEvolvedAt: new Date().toISOString(),
    lastBacktestedAt: "",
  };
}

// ── Strategy Registry ─────────────────────────────────────────────────────

class StrategyRegistry {
  private strategies = new Map<string, StrategyParams>();

  getKey(strategyId: string, symbol: string): string {
    return `${strategyId}::${symbol}`;
  }

  get(strategyId: string, symbol: string): StrategyParams | undefined {
    return this.strategies.get(this.getKey(strategyId, symbol));
  }

  getOrCreate(strategyId: string, symbol: string, name: string): StrategyParams {
    const key = this.getKey(strategyId, symbol);
    if (!this.strategies.has(key)) {
      this.strategies.set(key, createDefaultStrategy(strategyId, symbol, name));
    }
    return this.strategies.get(key)!;
  }

  save(params: StrategyParams): void {
    this.strategies.set(this.getKey(params.strategyId, params.symbol), params);
    // Fire-and-forget DB persistence
    saveStrategyParams({
      symbol: params.symbol,
      strategy_id: params.strategyId,
      version: params.version,
      tier: params.tier,
      min_confirmation_score: String(params.minConfirmationScore),
      require_mtf_alignment: params.requireMTFAlignment,
      require_bos: params.requireBOS,
      min_ob_quality: String(params.minOBQuality),
      stop_atr_multiplier: String(params.stopATRMultiplier),
      take_profit_atr_multiplier: String(params.takeProfitATRMultiplier),
      max_kelly_fraction: String(params.maxKellyFraction),
      allowed_regimes: JSON.stringify(params.allowedRegimes),
      blacklisted_regimes: JSON.stringify(params.blacklistedRegimes),
      changelog: JSON.stringify(params.changelog.slice(-20)),
      is_active: true,
    }).catch(() => {/* logged inside */});
  }

  /** Warm-load all strategy params from DB on brain startup */
  async warmLoad(): Promise<void> {
    try {
      const rows = await loadAllStrategyParams();
      for (const row of rows) {
        const key = this.getKey(row.strategy_id, row.symbol);
        if (!this.strategies.has(key)) {
          const defaultParams = createDefaultStrategy(row.strategy_id, row.symbol, row.strategy_id);
          const merged: StrategyParams = {
            ...defaultParams,
            minConfirmationScore: Number(row.min_confirmation_score),
            requireMTFAlignment: row.require_mtf_alignment,
            requireBOS: row.require_bos,
            minOBQuality: Number(row.min_ob_quality),
            stopATRMultiplier: Number(row.stop_atr_multiplier),
            takeProfitATRMultiplier: Number(row.take_profit_atr_multiplier),
            maxKellyFraction: Number(row.max_kelly_fraction),
            allowedRegimes: row.allowed_regimes ? JSON.parse(row.allowed_regimes) : defaultParams.allowedRegimes,
            blacklistedRegimes: row.blacklisted_regimes ? JSON.parse(row.blacklisted_regimes) : [],
            changelog: row.changelog ? JSON.parse(row.changelog) : [],
            tier: (row.tier as StrategyParams["tier"]) ?? "SEED",
            version: row.version,
          };
          this.strategies.set(key, merged);
        }
      }
      logger.info(`[StrategyRegistry] Warm-loaded ${rows.length} strategy param sets from DB`);
    } catch (err) {
      logger.warn({ err: err }, "[StrategyRegistry] warmLoad failed — using in-memory defaults:");
    }
  }

  getAll(): StrategyParams[] {
    return Array.from(this.strategies.values());
  }

  getAllForSymbol(symbol: string): StrategyParams[] {
    return this.getAll().filter((s) => s.symbol === symbol || s.symbol === "GLOBAL");
  }

  getSummary(): Array<{ strategyId: string; symbol: string; tier: string; version: number; winRate: number; sharpe: number; trades: number }> {
    return this.getAll().map((s) => ({
      strategyId: s.strategyId,
      symbol: s.symbol,
      tier: s.tier,
      version: s.version,
      winRate: s.winRate,
      sharpe: s.sharpeRatio,
      trades: s.totalTrades,
    }));
  }
}

export const strategyRegistry = new StrategyRegistry();

// ── Evolution Engine ──────────────────────────────────────────────────────

function recordChange(
  params: StrategyParams,
  param: string,
  oldValue: unknown,
  newValue: unknown,
  reason: string,
  evidence: string,
): StrategyChangeEntry {
  const entry: StrategyChangeEntry = {
    version: params.version + 1,
    timestamp: new Date().toISOString(),
    param,
    oldValue,
    newValue,
    reason,
    evidence,
    tradeCount: params.totalTrades,
  };
  params.changelog.push(entry);
  if (params.changelog.length > 100) {
    params.changelog = params.changelog.slice(-100);
  }
  return entry;
}

/**
 * Run the evolution engine on a strategy.
 * Applies all adaptation rules and returns what changed.
 */
export function evolveStrategy(input: EvolutionInput): EvolutionOutput {
  const { symbol, strategyId, metrics } = input;
  const stratName = strategyId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const params = strategyRegistry.getOrCreate(strategyId, symbol, stratName);
  const prevTier = params.tier;
  const changes: StrategyChangeEntry[] = [];
  let requiresRetraining = false;

  function change(param: keyof StrategyParams, newVal: unknown, reason: string, evidence: string): void {
    const old = params[param];
    if (JSON.stringify(old) === JSON.stringify(newVal)) return;
    const entry = recordChange(params, param, old, newVal, reason, evidence);
    changes.push(entry);
    (params as any)[param] = newVal;
  }

  // Only evolve with sufficient data
  const hasEnoughData = metrics.totalTrades >= 10;

  if (hasEnoughData) {
    // ── Rule 1: Regime blacklist ────────────────────────────────────────────
    for (const [regime, wr] of Object.entries(metrics.winRateByRegime)) {
      const trades = metrics.tradesByRegime[regime] ?? 0;
      if (trades >= 15 && wr < 0.35 && !params.blacklistedRegimes.includes(regime)) {
        const newBlacklist = [...params.blacklistedRegimes, regime];
        change(
          "blacklistedRegimes", newBlacklist,
          `Blacklist regime "${regime}" — win rate too low`,
          `${(wr * 100).toFixed(0)}% WR over ${trades} trades (< 35% threshold)`,
        );
      }
    }

    // ── Rule 2: Require MTF alignment ──────────────────────────────────────
    const mtfDiff = metrics.mtfAlignedWR - metrics.mtfDivergentWR;
    if (mtfDiff > 0.15 && metrics.totalTrades >= 20 && !params.requireMTFAlignment) {
      change(
        "requireMTFAlignment", true,
        "MTF alignment is significantly improving win rate",
        `Aligned ${(metrics.mtfAlignedWR * 100).toFixed(0)}% vs Divergent ${(metrics.mtfDivergentWR * 100).toFixed(0)}% (+${(mtfDiff * 100).toFixed(0)}pp)`,
      );
    }

    // ── Rule 3: Widen stop loss if MAE keeps stopping out ─────────────────
    const currentStopATR = params.stopATRMultiplier;
    if (metrics.avgMAE > 0.8 && currentStopATR < 2.5) {
      const newStop = Math.min(2.5, Math.round((currentStopATR * 1.2) * 10) / 10);
      change(
        "stopATRMultiplier", newStop,
        "Trades frequently hit stop before recovering — widen stop",
        `avg MAE ${metrics.avgMAE.toFixed(2)}R > 0.8R threshold`,
      );
    }
    // Tighten stop if MAE is small (protecting profits earlier)
    if (metrics.avgMAE < 0.25 && currentStopATR > 1.2 && metrics.totalTrades >= 30) {
      const newStop = Math.max(1.0, Math.round((currentStopATR * 0.9) * 10) / 10);
      change(
        "stopATRMultiplier", newStop,
        "MAE is small — tighten stop to lock in P&L",
        `avg MAE ${metrics.avgMAE.toFixed(2)}R < 0.25R — room to tighten`,
      );
    }

    // ── Rule 4: Raise TP if MFE capture is too low ─────────────────────────
    if (metrics.avgMFE > 0) {
      const mfeCaptureRatio = (metrics.avgMFE > 0 && params.takeProfitATRMultiplier > 0)
        ? (params.takeProfitATRMultiplier / metrics.avgMFE)
        : 1;
      if (mfeCaptureRatio < 0.5 && metrics.avgMFE > 2.5) {
        const newTP = Math.min(6.0, Math.round(metrics.avgMFE * 0.75 * 10) / 10);
        change(
          "takeProfitATRMultiplier", newTP,
          "Leaving too much profit on the table — raise TP",
          `avg MFE ${metrics.avgMFE.toFixed(2)}R, TP only capturing ${(mfeCaptureRatio * 100).toFixed(0)}% of potential`,
        );
      }
    }

    // ── Rule 5: Raise confirmation threshold if Sharpe is poor ─────────────
    if (metrics.sharpeRatio < 0.5 && metrics.totalTrades >= 50) {
      const newThresh = Math.min(0.75, params.minConfirmationScore + 0.05);
      if (newThresh > params.minConfirmationScore) {
        change(
          "minConfirmationScore", newThresh,
          "Sharpe too low — raise confirmation bar to filter weak setups",
          `Sharpe ${metrics.sharpeRatio.toFixed(2)} < 0.5 over ${metrics.totalTrades} trades`,
        );
        requiresRetraining = true;
      }
    }
    // Lower threshold if Sharpe is great (we might be too selective)
    if (metrics.sharpeRatio > 2.0 && metrics.winRate > 0.65 && metrics.totalTrades >= 50) {
      const newThresh = Math.max(0.45, params.minConfirmationScore - 0.03);
      if (newThresh < params.minConfirmationScore) {
        change(
          "minConfirmationScore", newThresh,
          "Performance is excellent — slightly lower threshold to find more setups",
          `Sharpe ${metrics.sharpeRatio.toFixed(2)}, WR ${(metrics.winRate * 100).toFixed(0)}%`,
        );
        requiresRetraining = true;
      }
    }

    // ── Rule 6: Reduce Kelly size on losing streak ─────────────────────────
    const consLoss = input.consecutiveLosses ?? 0;
    if (consLoss >= 5 && params.maxKellyFraction > 0.03) {
      const newKelly = Math.max(0.02, params.maxKellyFraction * 0.5);
      change(
        "maxKellyFraction", newKelly,
        `Consecutive loss streak (${consLoss}) — halve position size`,
        `${consLoss} consecutive losses triggered defensive sizing`,
      );
    }
    // Restore Kelly after winning streak
    const consWin = input.consecutiveWins ?? 0;
    if (consWin >= 8 && params.maxKellyFraction < 0.1) {
      const newKelly = Math.min(0.1, params.maxKellyFraction * 1.5);
      change(
        "maxKellyFraction", newKelly,
        `Strong winning streak (${consWin}) — carefully restore size`,
        `${consWin} consecutive wins, risk can be modestly increased`,
      );
    }
  }

  // ── Rule 7: Update tier ────────────────────────────────────────────────────
  const newTier = computeTier(params, metrics);
  if (newTier !== params.tier) {
    change(
      "tier", newTier,
      `Performance tier upgrade: ${params.tier} → ${newTier}`,
      `WR ${(metrics.winRate * 100).toFixed(0)}%, Sharpe ${metrics.sharpeRatio.toFixed(2)}, ${metrics.totalTrades} trades`,
    );
  }

  // ── Update live metrics ────────────────────────────────────────────────────
  params.totalTrades = metrics.totalTrades;
  params.winRate = metrics.winRate;
  params.sharpeRatio = metrics.sharpeRatio;
  params.sortinoRatio = metrics.sortinoRatio;
  params.calmarRatio = metrics.calmarRatio;
  params.maxDrawdownR = metrics.maxDrawdownR;
  params.consecutiveLosses = input.consecutiveLosses ?? 0;
  params.consecutiveWins = input.consecutiveWins ?? 0;
  params.version = changes.length > 0 ? params.version + 1 : params.version;
  params.lastEvolvedAt = new Date().toISOString();
  params.lastBacktestedAt = new Date().toISOString();

  strategyRegistry.save(params);

  const summary = changes.length > 0
    ? `v${params.version}: ${changes.length} parameter changes — ${changes.map((c) => c.param).join(", ")}`
    : `v${params.version}: No changes needed — performance within tolerance`;

  // If significant changes, trigger ML retraining
  if (requiresRetraining && metrics.totalTrades >= 50) {
    BrainJobs.retrainML(
      `Strategy ${strategyId} evolved confirmation threshold`,
      metrics.totalTrades,
      symbol,
    );
  }

  return {
    strategyId,
    symbol,
    version: params.version,
    previousTier: prevTier,
    newTier: params.tier,
    changes,
    params,
    summary,
    requiresRetraining,
  };
}

function computeTier(params: StrategyParams, metrics: EvolutionInput["metrics"]): StrategyParams["tier"] {
  const { totalTrades, winRate, sharpeRatio, calmarRatio, maxDrawdownR } = metrics;

  if (totalTrades < 10) return "SEED";
  if (totalTrades < 30) return "LEARNING";

  // Suspended if in deep drawdown
  if (maxDrawdownR > 8 && totalTrades >= 20) return "SUSPENDED";
  // Degrading if Sharpe dropped badly
  if (sharpeRatio < 0.2 && totalTrades >= 30) return "DEGRADING";
  // Elite tier
  if (winRate >= 0.62 && sharpeRatio >= 1.8 && calmarRatio >= 1.5 && totalTrades >= 50) return "ELITE";
  // Proven tier
  if (winRate >= 0.52 && sharpeRatio >= 0.8 && totalTrades >= 30) return "PROVEN";
  return "LEARNING";
}

// ── Multi-Symbol Strategy Ranking ─────────────────────────────────────────

export interface StrategyRanking {
  rank: number;
  symbol: string;
  strategyId: string;
  tier: StrategyParams["tier"];
  compositeScore: number;
  winRate: number;
  sharpeRatio: number;
  totalTrades: number;
  version: number;
}

/**
 * Rank all known strategies by composite score.
 * Brain uses this to decide which symbols to focus on.
 */
export function rankStrategies(symbols?: string[]): StrategyRanking[] {
  const all = strategyRegistry.getAll();
  const filtered = symbols ? all.filter((s) => symbols.includes(s.symbol)) : all;

  const ranked = filtered.map((s) => {
    const tierBonus: Record<StrategyParams["tier"], number> = {
      ELITE: 1.0,
      PROVEN: 0.7,
      LEARNING: 0.4,
      SEED: 0.2,
      DEGRADING: 0.1,
      SUSPENDED: 0.0,
    };
    const compositeScore =
      s.winRate * 0.30 +
      Math.min(1, s.sharpeRatio / 3) * 0.35 +
      Math.min(1, s.calmarRatio / 2) * 0.15 +
      tierBonus[s.tier] * 0.20;

    return {
      symbol: s.symbol,
      strategyId: s.strategyId,
      tier: s.tier,
      compositeScore: Math.round(compositeScore * 1000) / 1000,
      winRate: s.winRate,
      sharpeRatio: s.sharpeRatio,
      totalTrades: s.totalTrades,
      version: s.version,
    };
  });

  ranked.sort((a, b) => b.compositeScore - a.compositeScore);
  return ranked.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ── Continuous Evolution Loop ──────────────────────────────────────────────

/**
 * Process an evolution job from the job queue.
 * Called by the autonomous brain's job dispatcher.
 */
export async function processEvolutionJob(
  symbol: string,
  strategyId: string,
  backtestMetrics: Record<string, number>,
): Promise<EvolutionOutput> {
  const input: EvolutionInput = {
    symbol,
    strategyId,
    metrics: {
      winRate: backtestMetrics.winRate ?? 0.5,
      sharpeRatio: backtestMetrics.sharpeRatio ?? 0,
      sortinoRatio: backtestMetrics.sortinoRatio ?? 0,
      calmarRatio: backtestMetrics.calmarRatio ?? 0,
      profitFactor: backtestMetrics.profitFactor ?? 1,
      expectancy: backtestMetrics.expectancy ?? 0,
      maxDrawdownR: backtestMetrics.maxDrawdownR ?? 0,
      totalTrades: backtestMetrics.totalTrades ?? 0,
      avgMFE: backtestMetrics.avgMFE ?? 0,
      avgMAE: backtestMetrics.avgMAE ?? 0,
      mtfAlignedWR: backtestMetrics.mtfAlignedWR ?? 0.5,
      mtfDivergentWR: backtestMetrics.mtfDivergentWR ?? 0.5,
      winRateByRegime: {},
      tradesByRegime: {},
    },
  };

  return evolveStrategy(input);
}
