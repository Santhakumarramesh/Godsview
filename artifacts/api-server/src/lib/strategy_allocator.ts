import {
  getWalkForwardTierRegistry,
  type StrategyTier,
  type WalkForwardResult,
} from "./backtester";
import {
  getLatestPaperValidationReport,
  runPaperValidationCycle,
  type PaperValidationReport,
  type ValidationGroupMetrics,
} from "./paper_validation_loop";
import { logger as _logger } from "./logger";

type ValidationStatus = PaperValidationReport["status"];

const logger = _logger.child({ module: "strategy_allocator" });

const DEFAULT_INTERVAL_MS = 8 * 60_000;
const MIN_INTERVAL_MS = 60_000;
const MAX_INTERVAL_MS = 60 * 60_000;
const DEFAULT_MAX_VALIDATION_STALENESS_MS = 12 * 60_000;
const DEFAULT_MIN_VALIDATION_SAMPLES = 12;
const DEFAULT_BASE_RISK_PCT = 0.01;
const DEFAULT_MIN_MULTIPLIER = 0.2;
const DEFAULT_MAX_MULTIPLIER = 1.25;
const DEFAULT_SUSPEND_MULTIPLIER = 0;

const TIER_BASE_SCORE: Record<StrategyTier, number> = {
  SUSPENDED: 0.02,
  DEGRADING: 0.35,
  SEED: 0.45,
  LEARNING: 0.58,
  PROVEN: 0.74,
  ELITE: 0.9,
};

export interface StrategyAllocatorPolicy {
  auto_enforce: boolean;
  interval_ms: number;
  max_validation_staleness_ms: number;
  min_validation_samples: number;
  base_risk_pct: number;
  min_multiplier: number;
  max_multiplier: number;
  suspend_multiplier: number;
}

export interface StrategyAllocationEntry {
  strategy_id: string;
  setup_type: string | null;
  regime: string | null;
  symbol: string | null;
  tier: StrategyTier;
  validation_status: ValidationStatus;
  sample_count: number;
  score: number;
  multiplier: number;
  risk_budget_pct: number;
  walk_forward: WalkForwardResult["aggregate_oos"] | null;
  validation: {
    realized_win_rate: number;
    calibration_bias: number;
    brier_score: number;
    precision: number;
  } | null;
  source: "TIER" | "VALIDATION" | "HYBRID" | "FALLBACK";
  notes: string[];
  updated_at: string;
}

export type StrategyAllocationMatchLevel =
  | "EXACT"
  | "SETUP_REGIME"
  | "SETUP_ONLY"
  | "REGIME_ONLY"
  | "GLOBAL"
  | "NONE";

export interface StrategyAllocationMatch {
  matched: boolean;
  match_level: StrategyAllocationMatchLevel;
  strategy_id: string | null;
  multiplier: number;
  score: number;
  tier: StrategyTier | null;
  risk_budget_pct: number;
  source: StrategyAllocationEntry["source"] | "DEFAULT";
  entry: StrategyAllocationEntry | null;
}

export interface StrategyAllocatorSnapshot {
  running: boolean;
  cycle_in_flight: boolean;
  started_at: string | null;
  last_cycle_at: string | null;
  last_cycle_duration_ms: number | null;
  last_error: string | null;
  total_cycles: number;
  interval_ms: number;
  last_validation_status: ValidationStatus | null;
  last_validation_generated_at: string | null;
  policy: StrategyAllocatorPolicy;
  allocation_count: number;
  top_allocations: StrategyAllocationEntry[];
  allocations: StrategyAllocationEntry[];
}

interface CandidateContext {
  strategy_id: string;
  setup_type: string | null;
  regime: string | null;
  symbol: string | null;
  tier: StrategyTier;
  walk_forward: WalkForwardResult["aggregate_oos"] | null;
  validation: ValidationGroupMetrics | null;
}

let _running = false;
let _cycleInFlight = false;
let _timer: ReturnType<typeof setInterval> | null = null;
let _startedAtMs: number | null = null;
let _lastCycleAtMs: number | null = null;
let _lastCycleDurationMs: number | null = null;
let _lastError: string | null = null;
let _totalCycles = 0;
let _intervalMs = parseIntEnv(process.env.STRATEGY_ALLOCATOR_INTERVAL_MS, DEFAULT_INTERVAL_MS, MIN_INTERVAL_MS, MAX_INTERVAL_MS);
let _lastValidationStatus: ValidationStatus | null = null;
let _lastValidationGeneratedAt: string | null = null;

const _allocationMap = new Map<string, StrategyAllocationEntry>();

function toIso(ms: number | null): string | null {
  return ms ? new Date(ms).toISOString() : null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

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

function parseFloatEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return clamp(parsed, min, max);
}

function canonicalToken(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || null;
}

function canonicalSymbol(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = String(value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  return normalized || null;
}

function canonicalStrategyId(
  setupType: string | null | undefined,
  regime: string | null | undefined,
  symbol: string | null | undefined,
): string {
  const setup = canonicalToken(setupType) ?? "*";
  const reg = canonicalToken(regime) ?? "*";
  const sym = canonicalSymbol(symbol) ?? "*";
  return `${setup}::${reg}::${sym}`;
}

function parseStrategyId(strategyId: string): {
  strategy_id: string;
  setup_type: string | null;
  regime: string | null;
  symbol: string | null;
} {
  const parts = String(strategyId ?? "")
    .split("::")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const setup = parts[0] && parts[0] !== "*" ? canonicalToken(parts[0]) : null;
  const regime = parts[1] && parts[1] !== "*" ? canonicalToken(parts[1]) : null;
  const symbol = parts[2] && parts[2] !== "*" ? canonicalSymbol(parts[2]) : null;
  return {
    strategy_id: canonicalStrategyId(setup, regime, symbol),
    setup_type: setup,
    regime,
    symbol,
  };
}

function statusMultiplier(status: ValidationStatus): number {
  switch (status) {
    case "HEALTHY": return 1;
    case "WATCH": return 0.9;
    case "DRIFT": return 0.74;
    case "CRITICAL": return 0.48;
    case "INSUFFICIENT":
    default:
      return 0.68;
  }
}

function policy(): StrategyAllocatorPolicy {
  const minMultiplier = parseFloatEnv(process.env.STRATEGY_ALLOCATOR_MIN_MULTIPLIER, DEFAULT_MIN_MULTIPLIER, 0, 2);
  const maxMultiplierRaw = parseFloatEnv(process.env.STRATEGY_ALLOCATOR_MAX_MULTIPLIER, DEFAULT_MAX_MULTIPLIER, 0.1, 2.5);
  const maxMultiplier = Math.max(minMultiplier, maxMultiplierRaw);
  return {
    auto_enforce: boolEnv(process.env.STRATEGY_ALLOCATOR_AUTO_ENFORCE, true),
    interval_ms: _intervalMs,
    max_validation_staleness_ms: parseIntEnv(
      process.env.STRATEGY_ALLOCATOR_MAX_VALIDATION_STALENESS_MS,
      DEFAULT_MAX_VALIDATION_STALENESS_MS,
      60_000,
      120 * 60_000,
    ),
    min_validation_samples: parseIntEnv(
      process.env.STRATEGY_ALLOCATOR_MIN_VALIDATION_SAMPLES,
      DEFAULT_MIN_VALIDATION_SAMPLES,
      5,
      200,
    ),
    base_risk_pct: parseFloatEnv(
      process.env.STRATEGY_ALLOCATOR_BASE_RISK_PCT ?? process.env.GODSVIEW_MAX_RISK_PER_TRADE_PCT,
      DEFAULT_BASE_RISK_PCT,
      0.001,
      0.05,
    ),
    min_multiplier: minMultiplier,
    max_multiplier: maxMultiplier,
    suspend_multiplier: parseFloatEnv(process.env.STRATEGY_ALLOCATOR_SUSPEND_MULTIPLIER, DEFAULT_SUSPEND_MULTIPLIER, 0, 1),
  };
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

function computeWalkForwardScore(aggregate: WalkForwardResult["aggregate_oos"] | null): number {
  if (!aggregate || aggregate.trades <= 0) return 0.45;
  const winScore = clamp01((aggregate.win_rate - 0.45) / 0.25);
  const pfScore = clamp01((aggregate.profit_factor - 0.9) / 0.8);
  const passScore = clamp01(aggregate.pass_rate);
  const drawdownPenalty = clamp01((aggregate.max_drawdown_pct - 14) / 24);
  const raw = winScore * 0.38 + pfScore * 0.32 + passScore * 0.3;
  return clamp01(raw * (1 - drawdownPenalty * 0.35));
}

function computeValidationScore(validation: ValidationGroupMetrics | null, minSamples: number): number {
  if (!validation) return 0.5;
  const sampleConfidence = clamp01(validation.sample_count / Math.max(1, minSamples));
  const winScore = clamp01((validation.realized_win_rate - 0.45) / 0.25);
  const precisionScore = clamp01((validation.precision - 0.45) / 0.35);
  const calibrationPenalty = clamp01(Math.abs(validation.calibration_bias) / 0.2);
  const brierPenalty = clamp01((validation.brier_score - 0.18) / 0.18);
  const raw = winScore * 0.45 + precisionScore * 0.25 + sampleConfidence * 0.3;
  return clamp01(raw * (1 - calibrationPenalty * 0.3 - brierPenalty * 0.35));
}

function toAllocation(
  candidate: CandidateContext,
  reportStatus: ValidationStatus,
  p: StrategyAllocatorPolicy,
): StrategyAllocationEntry {
  const tierScore = TIER_BASE_SCORE[candidate.tier] ?? 0.45;
  const wfScore = computeWalkForwardScore(candidate.walk_forward);
  const valScore = computeValidationScore(candidate.validation, p.min_validation_samples);
  const hasWf = Boolean(candidate.walk_forward && candidate.walk_forward.trades > 0);
  const hasValidation = Boolean(candidate.validation);

  let score =
    hasWf && hasValidation
      ? tierScore * 0.3 + wfScore * 0.4 + valScore * 0.3
      : hasWf
      ? tierScore * 0.45 + wfScore * 0.55
      : hasValidation
      ? tierScore * 0.5 + valScore * 0.5
      : tierScore;

  if (hasValidation && (candidate.validation?.sample_count ?? 0) < p.min_validation_samples) {
    score *= 0.88;
  }
  if (candidate.tier === "DEGRADING") {
    score *= 0.72;
  }
  if (reportStatus === "CRITICAL" && (candidate.tier === "PROVEN" || candidate.tier === "ELITE")) {
    score *= 0.75;
  }

  score = clamp01(score * statusMultiplier(reportStatus));

  let multiplier = p.min_multiplier + score * (p.max_multiplier - p.min_multiplier);
  if (candidate.tier === "SUSPENDED") {
    multiplier = p.suspend_multiplier;
  } else if (candidate.tier === "DEGRADING") {
    multiplier = Math.min(multiplier, 0.55);
  }
  if (!p.auto_enforce) {
    multiplier = 1;
  }
  multiplier = clamp(multiplier, 0, p.max_multiplier);

  const source: StrategyAllocationEntry["source"] =
    hasWf && hasValidation ? "HYBRID" : hasWf ? "TIER" : hasValidation ? "VALIDATION" : "FALLBACK";

  const notes: string[] = [];
  if (!hasWf) notes.push("wf_missing");
  if (!hasValidation) notes.push("validation_missing");
  if (candidate.tier === "SUSPENDED") notes.push("tier_suspended");
  if (candidate.validation && candidate.validation.sample_count < p.min_validation_samples) {
    notes.push(`low_samples:${candidate.validation.sample_count}`);
  }

  return {
    strategy_id: candidate.strategy_id,
    setup_type: candidate.setup_type,
    regime: candidate.regime,
    symbol: candidate.symbol,
    tier: candidate.tier,
    validation_status: reportStatus,
    sample_count: candidate.validation?.sample_count ?? candidate.walk_forward?.trades ?? 0,
    score,
    multiplier,
    risk_budget_pct: p.base_risk_pct * multiplier,
    walk_forward: candidate.walk_forward,
    validation: candidate.validation
      ? {
          realized_win_rate: candidate.validation.realized_win_rate,
          calibration_bias: candidate.validation.calibration_bias,
          brier_score: candidate.validation.brier_score,
          precision: candidate.validation.precision,
        }
      : null,
    source,
    notes,
    updated_at: new Date().toISOString(),
  };
}

function buildCandidateMap(report: PaperValidationReport): Map<string, CandidateContext> {
  const map = new Map<string, CandidateContext>();

  const getOrCreate = (strategyId: string): CandidateContext => {
    const existing = map.get(strategyId);
    if (existing) return existing;
    const parsed = parseStrategyId(strategyId);
    const created: CandidateContext = {
      strategy_id: parsed.strategy_id,
      setup_type: parsed.setup_type,
      regime: parsed.regime,
      symbol: parsed.symbol,
      tier: "SEED",
      walk_forward: null,
      validation: null,
    };
    map.set(strategyId, created);
    return created;
  };

  for (const row of getWalkForwardTierRegistry()) {
    const parsed = parseStrategyId(row.strategy_id);
    const entry = getOrCreate(parsed.strategy_id);
    entry.tier = row.tier;
    entry.walk_forward = row.aggregate_oos;
    entry.setup_type = parsed.setup_type;
    entry.regime = parsed.regime;
    entry.symbol = parsed.symbol;
  }

  for (const group of report.by_setup_regime) {
    const strategyId = canonicalStrategyId(group.setup_type, group.regime, null);
    const entry = getOrCreate(strategyId);
    entry.validation = group;
    if (!entry.setup_type) entry.setup_type = canonicalToken(group.setup_type);
    if (!entry.regime) entry.regime = canonicalToken(group.regime);
  }

  return map;
}

async function runCycleInternal(reason: string): Promise<void> {
  const p = policy();
  const report = await getFreshValidationReport(p.max_validation_staleness_ms);
  _lastValidationStatus = report.status;
  _lastValidationGeneratedAt = report.generated_at;

  const candidateMap = buildCandidateMap(report);
  const next = new Map<string, StrategyAllocationEntry>();

  for (const candidate of candidateMap.values()) {
    const allocation = toAllocation(candidate, report.status, p);
    next.set(allocation.strategy_id, allocation);
  }

  if (!next.has("*::*::*")) {
    const fallbackScore = clamp01(0.62 * statusMultiplier(report.status));
    const fallbackMultiplier = p.auto_enforce
      ? clamp(p.min_multiplier + fallbackScore * (p.max_multiplier - p.min_multiplier), p.min_multiplier, p.max_multiplier)
      : 1;
    next.set("*::*::*", {
      strategy_id: "*::*::*",
      setup_type: null,
      regime: null,
      symbol: null,
      tier: report.status === "CRITICAL" ? "DEGRADING" : "LEARNING",
      validation_status: report.status,
      sample_count: report.overall.sample_count,
      score: fallbackScore,
      multiplier: fallbackMultiplier,
      risk_budget_pct: p.base_risk_pct * fallbackMultiplier,
      walk_forward: null,
      validation: {
        realized_win_rate: report.overall.realized_win_rate,
        calibration_bias: report.overall.calibration_bias,
        brier_score: report.overall.brier_score,
        precision: report.overall.precision,
      },
      source: "FALLBACK",
      notes: [`cycle_reason:${reason}`],
      updated_at: new Date().toISOString(),
    });
  }

  _allocationMap.clear();
  for (const [key, value] of next.entries()) {
    _allocationMap.set(key, value);
  }
}

function lookupCandidates(
  setupType?: string,
  regime?: string,
  symbol?: string,
): Array<{ id: string; level: StrategyAllocationMatchLevel }> {
  const setup = canonicalToken(setupType) ?? "*";
  const reg = canonicalToken(regime) ?? "*";
  const sym = canonicalSymbol(symbol) ?? "*";
  return [
    { id: canonicalStrategyId(setup, reg, sym), level: "EXACT" },
    { id: canonicalStrategyId(setup, reg, null), level: "SETUP_REGIME" },
    { id: canonicalStrategyId(setup, null, null), level: "SETUP_ONLY" },
    { id: canonicalStrategyId(null, reg, null), level: "REGIME_ONLY" },
    { id: canonicalStrategyId(null, null, null), level: "GLOBAL" },
  ];
}

export function getStrategyAllocationForSignal(input: {
  setup_type?: string;
  regime?: string;
  symbol?: string;
}): StrategyAllocationMatch {
  const candidates = lookupCandidates(input.setup_type, input.regime, input.symbol);
  for (const candidate of candidates) {
    const entry = _allocationMap.get(candidate.id);
    if (!entry) continue;
    return {
      matched: true,
      match_level: candidate.level,
      strategy_id: entry.strategy_id,
      multiplier: entry.multiplier,
      score: entry.score,
      tier: entry.tier,
      risk_budget_pct: entry.risk_budget_pct,
      source: entry.source,
      entry,
    };
  }

  return {
    matched: false,
    match_level: "NONE",
    strategy_id: null,
    multiplier: 1,
    score: 0.5,
    tier: null,
    risk_budget_pct: policy().base_risk_pct,
    source: "DEFAULT",
    entry: null,
  };
}

export async function runStrategyAllocatorCycle(reason = "manual"): Promise<StrategyAllocatorSnapshot> {
  if (_cycleInFlight) return getStrategyAllocatorSnapshot();
  _cycleInFlight = true;
  const startedMs = Date.now();
  try {
    await runCycleInternal(reason);
    _lastError = null;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[strategy-allocator] cycle failed");
  } finally {
    _cycleInFlight = false;
    _lastCycleAtMs = Date.now();
    _lastCycleDurationMs = Math.max(0, Date.now() - startedMs);
    _totalCycles += 1;
  }
  return getStrategyAllocatorSnapshot();
}

export async function startStrategyAllocator(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
}): Promise<{ success: boolean; message: string; interval_ms: number }> {
  if (Number.isFinite(options?.intervalMs)) {
    _intervalMs = Math.max(MIN_INTERVAL_MS, Math.min(MAX_INTERVAL_MS, Math.round(options?.intervalMs ?? DEFAULT_INTERVAL_MS)));
  }

  if (_running) {
    return { success: false, message: "Strategy allocator already running", interval_ms: _intervalMs };
  }

  _running = true;
  _startedAtMs = Date.now();
  _timer = setInterval(() => {
    runStrategyAllocatorCycle("scheduled").catch((err) => {
      logger.error({ err }, "[strategy-allocator] scheduled cycle failed");
    });
  }, _intervalMs);
  if (_timer.unref) _timer.unref();

  if (options?.runImmediate !== false) {
    await runStrategyAllocatorCycle("start");
  }

  logger.info({ intervalMs: _intervalMs }, "[strategy-allocator] started");
  return { success: true, message: "Strategy allocator started", interval_ms: _intervalMs };
}

export function stopStrategyAllocator(): { success: boolean; message: string } {
  if (!_running) {
    return { success: false, message: "Strategy allocator not running" };
  }
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
  logger.info("[strategy-allocator] stopped");
  return { success: true, message: "Strategy allocator stopped" };
}

export function getStrategyAllocatorSnapshot(): StrategyAllocatorSnapshot {
  const allocations = Array.from(_allocationMap.values()).sort((a, b) => {
    if (b.multiplier !== a.multiplier) return b.multiplier - a.multiplier;
    return b.score - a.score;
  });
  return {
    running: _running,
    cycle_in_flight: _cycleInFlight,
    started_at: toIso(_startedAtMs),
    last_cycle_at: toIso(_lastCycleAtMs),
    last_cycle_duration_ms: _lastCycleDurationMs,
    last_error: _lastError,
    total_cycles: _totalCycles,
    interval_ms: _intervalMs,
    last_validation_status: _lastValidationStatus,
    last_validation_generated_at: _lastValidationGeneratedAt,
    policy: policy(),
    allocation_count: allocations.length,
    top_allocations: allocations.slice(0, 20),
    allocations,
  };
}

export function shouldStrategyAllocatorAutoStart(): boolean {
  return boolEnv(process.env.STRATEGY_ALLOCATOR_AUTO_START, true);
}
