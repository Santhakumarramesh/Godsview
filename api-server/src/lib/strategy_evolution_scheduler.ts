import {
  getContinuousBacktestStatus,
  getStrategyLeaderboard,
  getWalkForwardTierRegistry,
  runStrategyOptimization,
  runWalkForwardBacktest,
  startContinuousBacktest,
  type StrategyTier,
} from "./backtester";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "strategy_evolution_scheduler" });

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 4 * 60 * 60_000;
const DEFAULT_MAX_STRATEGIES_PER_CYCLE = 4;
const DEFAULT_MAX_OPTIMIZATIONS_PER_CYCLE = 2;
const DEFAULT_MIN_PASS_RATE = 0.6;
const DEFAULT_MIN_STABILITY = 0.55;
const DEFAULT_OPTIMIZATION_COOLDOWN_MS = 45 * 60_000;
const MAX_RECENT_ACTIONS = 150;

export interface StrategyEvolutionPolicy {
  auto_enforce: boolean;
  interval_ms: number;
  auto_start_continuous_backtest: boolean;
  max_strategies_per_cycle: number;
  max_optimizations_per_cycle: number;
  min_pass_rate: number;
  min_stability: number;
  optimization_cooldown_ms: number;
}

export interface StrategyEvolutionAction {
  at: string;
  strategy_id: string;
  action: "START_CONTINUOUS" | "WALK_FORWARD" | "OPTIMIZE" | "SKIP";
  success: boolean;
  detail: string;
}

export interface StrategyEvolutionSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  policy: StrategyEvolutionPolicy;
  evaluated_strategies: string[];
  optimized_strategies: string[];
  last_candidates: Array<{ strategy_id: string; score: number; source: string }>;
  recent_actions: StrategyEvolutionAction[];
}

interface StrategyCandidate {
  strategy_id: string;
  score: number;
  source: "tier_registry" | "leaderboard" | "fallback";
}

let _running = false;
let _cycleInFlight = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startedAtMs: number | null = null;
let _lastCycleAtMs: number | null = null;
let _lastCycleDurationMs: number | null = null;
let _lastError: string | null = null;
let _totalCycles = 0;
let _totalActions = 0;
let _intervalMs = parseIntervalMs(process.env.STRATEGY_EVOLUTION_INTERVAL_MS, DEFAULT_INTERVAL_MS);
let _evaluatedStrategies: string[] = [];
let _optimizedStrategies: string[] = [];
let _lastCandidates: StrategyCandidate[] = [];
const _recentActions: StrategyEvolutionAction[] = [];
const _lastOptimizedAtMs = new Map<string, number>();

function boolEnv(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const value = raw.trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseNumEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(String(raw ?? ""));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function parseIntervalMs(raw: string | undefined, fallback: number): number {
  return parseIntEnv(raw, fallback, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function strategyTierRank(tier: StrategyTier): number {
  switch (tier) {
    case "SUSPENDED": return -1;
    case "SEED": return 0;
    case "LEARNING": return 1;
    case "DEGRADING": return 1;
    case "PROVEN": return 2;
    case "ELITE": return 3;
    default: return 0;
  }
}

function normalizeStrategyId(input: string): string {
  const raw = String(input ?? "").trim();
  if (!raw) return "*::*::*";
  const parts = raw
    .split("::")
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return "*::*::*";
  if (parts.length === 1) return `${parts[0]}::*::*`;
  if (parts.length === 2) return `${parts[0]}::${parts[1]}::*`;
  return `${parts[0]}::${parts[1]}::${parts[2]}`;
}

function policy(): StrategyEvolutionPolicy {
  return {
    auto_enforce: boolEnv(process.env.STRATEGY_EVOLUTION_AUTO_ENFORCE, true),
    interval_ms: _intervalMs,
    auto_start_continuous_backtest: boolEnv(process.env.STRATEGY_EVOLUTION_AUTO_START_CONTINUOUS, true),
    max_strategies_per_cycle: parseIntEnv(
      process.env.STRATEGY_EVOLUTION_MAX_STRATEGIES_PER_CYCLE,
      DEFAULT_MAX_STRATEGIES_PER_CYCLE,
      1,
      20,
    ),
    max_optimizations_per_cycle: parseIntEnv(
      process.env.STRATEGY_EVOLUTION_MAX_OPTIMIZATIONS_PER_CYCLE,
      DEFAULT_MAX_OPTIMIZATIONS_PER_CYCLE,
      0,
      10,
    ),
    min_pass_rate: parseNumEnv(process.env.STRATEGY_EVOLUTION_MIN_PASS_RATE, DEFAULT_MIN_PASS_RATE, 0.3, 0.95),
    min_stability: parseNumEnv(process.env.STRATEGY_EVOLUTION_MIN_STABILITY, DEFAULT_MIN_STABILITY, 0.3, 0.95),
    optimization_cooldown_ms: parseIntEnv(
      process.env.STRATEGY_EVOLUTION_OPTIMIZATION_COOLDOWN_MS,
      DEFAULT_OPTIMIZATION_COOLDOWN_MS,
      5 * 60_000,
      24 * 60 * 60_000,
    ),
  };
}

function pushAction(action: StrategyEvolutionAction): void {
  _recentActions.unshift(action);
  if (_recentActions.length > MAX_RECENT_ACTIONS) {
    _recentActions.pop();
  }
  _totalActions += 1;
}

function addCandidate(
  candidates: Map<string, StrategyCandidate>,
  strategy_id: string,
  score: number,
  source: StrategyCandidate["source"],
): void {
  const normalized = normalizeStrategyId(strategy_id);
  const next: StrategyCandidate = {
    strategy_id: normalized,
    score,
    source,
  };
  const existing = candidates.get(normalized);
  if (!existing || next.score > existing.score) {
    candidates.set(normalized, next);
  }
}

function buildCandidates(maxStrategies: number): StrategyCandidate[] {
  const candidates = new Map<string, StrategyCandidate>();

  for (const row of getWalkForwardTierRegistry()) {
    const rank = strategyTierRank(row.tier);
    const score =
      rank * 120 +
      row.aggregate_oos.trades * 0.2 +
      row.aggregate_oos.pass_rate * 100 +
      row.aggregate_oos.win_rate * 60 +
      row.aggregate_oos.profit_factor * 10;
    addCandidate(candidates, row.strategy_id, score, "tier_registry");
  }

  for (const row of getStrategyLeaderboard()) {
    const score =
      row.stars * 30 +
      row.win_rate * 120 +
      row.consistency_score * 80 +
      row.profit_factor * 8;
    addCandidate(candidates, `${row.setup_type}::*::*`, score, "leaderboard");
  }

  const fallback = [
    "sweep_reclaim::*::*",
    "fvg_reclaim::*::*",
    "breakout_pullback::*::*",
    "liquidity_sweep::*::*",
  ];
  for (let i = 0; i < fallback.length; i++) {
    addCandidate(candidates, fallback[i], 10 - i, "fallback");
  }

  return Array.from(candidates.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxStrategies);
}

function shouldOptimizeStrategy(
  strategyId: string,
  nowMs: number,
  p: StrategyEvolutionPolicy,
  aggregate: { pass_rate: number; win_rate: number; profit_factor: number; max_drawdown_pct: number },
  stability: { score: number },
  promotion: { action: string },
): boolean {
  const lastOptimizedAt = _lastOptimizedAtMs.get(strategyId) ?? 0;
  if (nowMs - lastOptimizedAt < p.optimization_cooldown_ms) {
    return false;
  }

  if (promotion.action === "DEGRADE" || promotion.action === "SUSPEND") return true;
  if (aggregate.pass_rate < p.min_pass_rate) return true;
  if (stability.score < p.min_stability) return true;
  if (aggregate.profit_factor < 1.1) return true;
  if (aggregate.win_rate < 0.54) return true;
  if (aggregate.max_drawdown_pct > 20) return true;

  return false;
}

async function runCycleInternal(reason: string): Promise<void> {
  const p = policy();
  const nowMs = Date.now();

  if (p.auto_enforce && p.auto_start_continuous_backtest) {
    const status = getContinuousBacktestStatus();
    if (!status.running) {
      const result = await startContinuousBacktest();
      pushAction({
        at: new Date().toISOString(),
        strategy_id: "*::*::*",
        action: "START_CONTINUOUS",
        success: result.success,
        detail: `${reason}: ${result.message}`,
      });
    }
  }

  const candidates = buildCandidates(p.max_strategies_per_cycle);
  _lastCandidates = candidates;
  _evaluatedStrategies = [];
  _optimizedStrategies = [];

  let optimizationsUsed = 0;

  for (const candidate of candidates) {
    _evaluatedStrategies.push(candidate.strategy_id);
    try {
      const wf = await runWalkForwardBacktest({
        strategy_id: candidate.strategy_id,
        persist_result: true,
        lookback_days: 240,
        train_days: 60,
        test_days: 20,
        step_days: 20,
        min_train_samples: 24,
        min_test_samples: 8,
        min_win_rate: 0.56,
        min_profit_factor: 1.15,
        max_drawdown_pct: 18,
      });

      pushAction({
        at: new Date().toISOString(),
        strategy_id: candidate.strategy_id,
        action: "WALK_FORWARD",
        success: true,
        detail: `pass=${(wf.aggregate_oos.pass_rate * 100).toFixed(1)}%, stability=${(wf.stability.score * 100).toFixed(1)}%, tier=${wf.promotion.next_tier}`,
      });

      const wantsOptimize = shouldOptimizeStrategy(
        candidate.strategy_id,
        nowMs,
        p,
        wf.aggregate_oos,
        wf.stability,
        wf.promotion,
      );

      if (!wantsOptimize) {
        pushAction({
          at: new Date().toISOString(),
          strategy_id: candidate.strategy_id,
          action: "SKIP",
          success: true,
          detail: "optimization_not_needed",
        });
        continue;
      }

      if (!p.auto_enforce) {
        pushAction({
          at: new Date().toISOString(),
          strategy_id: candidate.strategy_id,
          action: "SKIP",
          success: true,
          detail: "auto_enforce_disabled",
        });
        continue;
      }

      if (optimizationsUsed >= p.max_optimizations_per_cycle) {
        pushAction({
          at: new Date().toISOString(),
          strategy_id: candidate.strategy_id,
          action: "SKIP",
          success: true,
          detail: "optimization_budget_exhausted",
        });
        continue;
      }

      const opt = await runStrategyOptimization({
        strategy_id: candidate.strategy_id,
        lookback_days: 240,
        min_train_samples: 24,
        min_test_samples: 8,
      });

      _lastOptimizedAtMs.set(candidate.strategy_id, Date.now());
      _optimizedStrategies.push(candidate.strategy_id);
      optimizationsUsed += 1;

      pushAction({
        at: new Date().toISOString(),
        strategy_id: candidate.strategy_id,
        action: "OPTIMIZE",
        success: true,
        detail: `best_score=${opt.best_score.toFixed(4)}, next_tier=${opt.applied_result.promotion.next_tier}, candidates=${opt.evaluated_candidates}`,
      });
    } catch (err) {
      pushAction({
        at: new Date().toISOString(),
        strategy_id: candidate.strategy_id,
        action: "SKIP",
        success: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export async function runStrategyEvolutionCycle(reason = "manual"): Promise<StrategyEvolutionSnapshot> {
  if (_cycleInFlight) return getStrategyEvolutionSnapshot();
  _cycleInFlight = true;
  const startedMs = Date.now();

  try {
    await runCycleInternal(reason);
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[strategy-evolution] cycle failed");
  } finally {
    _cycleInFlight = false;
    _lastCycleAtMs = Date.now();
    _lastCycleDurationMs = Math.max(0, Date.now() - startedMs);
    _totalCycles += 1;
  }

  return getStrategyEvolutionSnapshot();
}

export async function startStrategyEvolutionScheduler(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
}): Promise<{ success: boolean; message: string; interval_ms: number }> {
  if (Number.isFinite(options?.intervalMs)) {
    _intervalMs = Math.max(
      MIN_INTERVAL_MS,
      Math.min(MAX_INTERVAL_MS, Math.round(options?.intervalMs ?? DEFAULT_INTERVAL_MS)),
    );
  }

  if (_running) {
    return { success: false, message: "Strategy evolution scheduler already running", interval_ms: _intervalMs };
  }

  _running = true;
  _startedAtMs = Date.now();

  _timer = setInterval(() => {
    runStrategyEvolutionCycle("scheduled").catch((err) => {
      logger.error({ err }, "[strategy-evolution] scheduled cycle failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runStrategyEvolutionCycle("start");
  }

  logger.info({ intervalMs: _intervalMs }, "[strategy-evolution] started");
  return { success: true, message: "Strategy evolution scheduler started", interval_ms: _intervalMs };
}

export function stopStrategyEvolutionScheduler(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Strategy evolution scheduler not running" };
  }

  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[strategy-evolution] stopped");
  return { success: true, message: "Strategy evolution scheduler stopped" };
}

export function resetStrategyEvolutionState(): StrategyEvolutionSnapshot {
  _lastError = null;
  _lastCycleAtMs = null;
  _lastCycleDurationMs = null;
  _totalCycles = 0;
  _totalActions = 0;
  _evaluatedStrategies = [];
  _optimizedStrategies = [];
  _lastCandidates = [];
  _recentActions.length = 0;
  _lastOptimizedAtMs.clear();
  if (!_running) {
    _startedAtMs = null;
  }
  return getStrategyEvolutionSnapshot();
}

export function getStrategyEvolutionSnapshot(): StrategyEvolutionSnapshot {
  return {
    running: _running,
    cycle_in_flight: _cycleInFlight,
    started_at: toIso(_startedAtMs),
    last_cycle_at: toIso(_lastCycleAtMs),
    last_cycle_duration_ms: _lastCycleDurationMs,
    last_error: _lastError,
    total_cycles: _totalCycles,
    total_actions: _totalActions,
    interval_ms: _intervalMs,
    policy: policy(),
    evaluated_strategies: [..._evaluatedStrategies],
    optimized_strategies: [..._optimizedStrategies],
    last_candidates: _lastCandidates.map((c) => ({ ...c })),
    recent_actions: [..._recentActions],
  };
}

export function shouldStrategyEvolutionAutoStart(): boolean {
  return boolEnv(process.env.STRATEGY_EVOLUTION_AUTO_START, true);
}

