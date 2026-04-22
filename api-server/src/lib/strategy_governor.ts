import {
  getWalkForwardTier,
  getWalkForwardTierRegistry,
  runWalkForwardBacktest,
  setWalkForwardTier,
  type StrategyTier,
  type WalkForwardResult,
} from "./backtester";
import {
  getLatestPaperValidationReport,
  runPaperValidationCycle,
  type PaperValidationReport,
} from "./paper_validation_loop";
import { getAutonomySupervisorSnapshot } from "./autonomy_supervisor";
import { logger } from "./logger";

type ValidationStatus = PaperValidationReport["status"];

export interface StrategyGovernorPolicy {
  auto_enforce: boolean;
  interval_ms: number;
  max_strategies_per_cycle: number;
  min_group_samples: number;
  max_validation_staleness_ms: number;
}

export interface StrategyGovernorAction {
  at: string;
  strategy_id: string;
  action: "WALK_FORWARD" | "OVERRIDE_TIER" | "SKIP";
  before_tier: StrategyTier;
  proposed_tier: StrategyTier;
  final_tier: StrategyTier;
  reason: string;
}

export interface StrategyGovernorSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  total_actions: number;
  interval_ms: number;
  last_validation_status: ValidationStatus | null;
  last_validation_generated_at: string | null;
  last_supervisor_health_ratio: number;
  policy: StrategyGovernorPolicy;
  evaluated_strategies: string[];
  recent_actions: StrategyGovernorAction[];
}

interface StrategyCandidate {
  strategy_id: string;
  score: number;
  source: "validation_group" | "tier_maintenance";
}

const DEFAULT_INTERVAL_MS = 12 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 60 * 60_000;
const DEFAULT_MAX_STRATEGIES_PER_CYCLE = 5;
const DEFAULT_MIN_GROUP_SAMPLES = 12;
const DEFAULT_MAX_VALIDATION_STALENESS_MS = 15 * 60_000;
const MAX_RECENT_ACTIONS = 150;

let _running = false;
let _cycleInFlight = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startedAtMs: number | null = null;
let _lastCycleAtMs: number | null = null;
let _lastCycleDurationMs: number | null = null;
let _lastError: string | null = null;
let _totalCycles = 0;
let _totalActions = 0;
let _intervalMs = parseIntervalMs(process.env.STRATEGY_GOVERNOR_INTERVAL_MS, DEFAULT_INTERVAL_MS);
let _lastValidationStatus: ValidationStatus | null = null;
let _lastValidationGeneratedAt: string | null = null;
let _lastSupervisorHealthRatio = 0;
let _evaluatedStrategies: string[] = [];
const _recentActions: StrategyGovernorAction[] = [];

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function parseIntEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function parseIntervalMs(value: string | undefined, fallback: number): number {
  return parseIntEnv(value, fallback, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
}

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function canonicalKey(value: string): string {
  const key = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_*]+/g, "_")
    .replace(/_+/g, "_");
  return key || "*";
}

function strategyIdFromSetupRegime(setup: string, regime: string): string {
  return `${canonicalKey(setup)}::${canonicalKey(regime)}::*`;
}

function tierRank(tier: StrategyTier): number {
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

function policy(): StrategyGovernorPolicy {
  return {
    auto_enforce: boolEnv(process.env.STRATEGY_GOVERNOR_AUTO_ENFORCE, true),
    interval_ms: _intervalMs,
    max_strategies_per_cycle: parseIntEnv(process.env.STRATEGY_GOVERNOR_MAX_STRATEGIES, DEFAULT_MAX_STRATEGIES_PER_CYCLE, 1, 20),
    min_group_samples: parseIntEnv(process.env.STRATEGY_GOVERNOR_MIN_GROUP_SAMPLES, DEFAULT_MIN_GROUP_SAMPLES, 5, 100),
    max_validation_staleness_ms: parseIntEnv(
      process.env.STRATEGY_GOVERNOR_MAX_VALIDATION_STALENESS_MS,
      DEFAULT_MAX_VALIDATION_STALENESS_MS,
      60_000,
      120 * 60_000,
    ),
  };
}

function pushAction(action: StrategyGovernorAction): void {
  _recentActions.unshift(action);
  if (_recentActions.length > MAX_RECENT_ACTIONS) {
    _recentActions.pop();
  }
  _totalActions += 1;
}

function supervisorHealthRatio(): number {
  const supervisor = getAutonomySupervisorSnapshot();
  const expected = supervisor.services.filter((svc) => svc.expected).length;
  if (expected === 0) return 1;
  const healthy = supervisor.services.filter((svc) => svc.expected && svc.health === "HEALTHY").length;
  return healthy / expected;
}

async function getFreshValidationReport(maxAgeMs: number): Promise<PaperValidationReport> {
  const latest = getLatestPaperValidationReport();
  if (!latest) {
    return runPaperValidationCycle({ enableAutoOptimization: true });
  }

  const ageMs = Math.max(0, Date.now() - Date.parse(latest.generated_at));
  if (Number.isFinite(ageMs) && ageMs <= maxAgeMs) {
    return latest;
  }

  return runPaperValidationCycle({ enableAutoOptimization: true });
}

function buildCandidates(
  report: PaperValidationReport,
  maxStrategies: number,
  minSamples: number,
): StrategyCandidate[] {
  const weighted = new Map<string, StrategyCandidate>();
  const add = (candidate: StrategyCandidate): void => {
    const existing = weighted.get(candidate.strategy_id);
    if (!existing || candidate.score > existing.score) {
      weighted.set(candidate.strategy_id, candidate);
    }
  };

  for (const group of report.by_setup_regime) {
    if (group.sample_count < minSamples) continue;
    const strategy_id = strategyIdFromSetupRegime(group.setup_type, group.regime);
    const riskPenalty =
      (group.realized_win_rate < 0.5 ? 2 : 0) +
      (Math.abs(group.calibration_bias) > 0.1 ? 1 : 0) +
      (group.brier_score > 0.24 ? 1 : 0);
    const score = group.sample_count + riskPenalty * 40;
    add({ strategy_id, score, source: "validation_group" });
  }

  for (const row of getWalkForwardTierRegistry()) {
    if (row.tier !== "PROVEN" && row.tier !== "ELITE") continue;
    const score = 60 + row.aggregate_oos.trades;
    add({ strategy_id: row.strategy_id, score, source: "tier_maintenance" });
  }

  return Array.from(weighted.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxStrategies);
}

function clampTierByPolicy(
  proposed: StrategyTier,
  current: StrategyTier,
  reportStatus: ValidationStatus,
  supervisorRatio: number,
  wf: WalkForwardResult,
): { tier: StrategyTier; reason: string | null } {
  if (supervisorRatio < 0.5 && tierRank(proposed) > tierRank(current)) {
    return { tier: current, reason: "promotion_blocked_supervisor_degraded" };
  }

  if (reportStatus === "CRITICAL") {
    if (wf.aggregate_oos.win_rate < 0.48 || wf.aggregate_oos.profit_factor < 0.95) {
      return { tier: "SUSPENDED", reason: "critical_validation_suspend" };
    }
    if (tierRank(proposed) > tierRank("DEGRADING")) {
      return { tier: "DEGRADING", reason: "critical_validation_degrade" };
    }
  }

  if (reportStatus === "DRIFT" && tierRank(proposed) > tierRank("LEARNING")) {
    return { tier: "LEARNING", reason: "drift_validation_hold_learning" };
  }

  if (reportStatus === "WATCH" && proposed === "ELITE" && wf.aggregate_oos.pass_rate < 0.72) {
    return { tier: "PROVEN", reason: "watch_validation_block_elite" };
  }

  return { tier: proposed, reason: null };
}

async function runCycleInternal(reason: string): Promise<void> {
  const p = policy();
  const report = await getFreshValidationReport(p.max_validation_staleness_ms);
  _lastValidationStatus = report.status;
  _lastValidationGeneratedAt = report.generated_at;
  _lastSupervisorHealthRatio = supervisorHealthRatio();

  const candidates = buildCandidates(report, p.max_strategies_per_cycle, p.min_group_samples);
  _evaluatedStrategies = candidates.map((c) => c.strategy_id);

  for (const candidate of candidates) {
    const currentTier = getWalkForwardTier(candidate.strategy_id)?.tier ?? "SEED";
    const wf = await runWalkForwardBacktest({
      strategy_id: candidate.strategy_id,
      persist_result: true,
      lookback_days: 240,
      train_days: 60,
      test_days: 20,
      step_days: 20,
      min_train_samples: 24,
      min_test_samples: 8,
      min_win_rate: report.status === "HEALTHY" ? 0.56 : 0.54,
      min_profit_factor: report.status === "HEALTHY" ? 1.15 : 1.05,
      max_drawdown_pct: 20,
    });

    const proposedTier = wf.promotion.next_tier;
    const override = clampTierByPolicy(
      proposedTier,
      currentTier,
      report.status,
      _lastSupervisorHealthRatio,
      wf,
    );
    const finalTier = p.auto_enforce ? override.tier : proposedTier;

    pushAction({
      at: new Date().toISOString(),
      strategy_id: candidate.strategy_id,
      action: "WALK_FORWARD",
      before_tier: currentTier,
      proposed_tier: proposedTier,
      final_tier: finalTier,
      reason: `source=${candidate.source},cycle=${reason}`,
    });

    if (p.auto_enforce && finalTier !== proposedTier) {
      setWalkForwardTier({
        strategy_id: candidate.strategy_id,
        tier: finalTier,
        notes: [...wf.promotion.reasons, `governor_override:${override.reason ?? "policy"}`],
        aggregate_oos: wf.aggregate_oos,
      });
      pushAction({
        at: new Date().toISOString(),
        strategy_id: candidate.strategy_id,
        action: "OVERRIDE_TIER",
        before_tier: proposedTier,
        proposed_tier: proposedTier,
        final_tier: finalTier,
        reason: override.reason ?? "governor_override",
      });
    }
  }
}

export async function runStrategyGovernorCycle(reason = "manual"): Promise<StrategyGovernorSnapshot> {
  if (_cycleInFlight) return getStrategyGovernorSnapshot();
  _cycleInFlight = true;
  const startedMs = Date.now();
  try {
    await runCycleInternal(reason);
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[strategy-governor] cycle failed");
  } finally {
    _cycleInFlight = false;
    _lastCycleAtMs = Date.now();
    _lastCycleDurationMs = Math.max(0, Date.now() - startedMs);
    _totalCycles += 1;
  }
  return getStrategyGovernorSnapshot();
}

export async function startStrategyGovernor(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
}): Promise<{ success: boolean; message: string; interval_ms: number }> {
  if (Number.isFinite(options?.intervalMs)) {
    _intervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(options?.intervalMs ?? DEFAULT_INTERVAL_MS)));
  }

  if (_running) {
    return { success: false, message: "Strategy governor already running", interval_ms: _intervalMs };
  }

  _running = true;
  _startedAtMs = Date.now();
  _timer = setInterval(() => {
    runStrategyGovernorCycle("scheduled").catch((err) => {
      logger.error({ err }, "[strategy-governor] scheduled cycle failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runStrategyGovernorCycle("start");
  }

  logger.info({ intervalMs: _intervalMs }, "[strategy-governor] started");
  return { success: true, message: "Strategy governor started", interval_ms: _intervalMs };
}

export function stopStrategyGovernor(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Strategy governor not running" };
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[strategy-governor] stopped");
  return { success: true, message: "Strategy governor stopped" };
}

export function getStrategyGovernorSnapshot(): StrategyGovernorSnapshot {
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
    last_validation_status: _lastValidationStatus,
    last_validation_generated_at: _lastValidationGeneratedAt,
    last_supervisor_health_ratio: _lastSupervisorHealthRatio,
    policy: policy(),
    evaluated_strategies: [..._evaluatedStrategies],
    recent_actions: [..._recentActions],
  };
}

export function shouldStrategyGovernorAutoStart(): boolean {
  return boolEnv(process.env.STRATEGY_GOVERNOR_AUTO_START, true);
}
