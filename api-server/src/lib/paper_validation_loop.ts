import { accuracyResultsTable, db, siDecisionsTable } from "@workspace/db";
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { logger } from "./logger";

type OutcomeLabel = "win" | "loss";
type ValidationStatus = "INSUFFICIENT" | "HEALTHY" | "WATCH" | "DRIFT" | "CRITICAL";

interface PendingDecisionRow {
  id: number;
  symbol: string;
  setup_type: string;
  direction: string;
  entry_price: string;
  stop_loss: string;
  take_profit: string;
  suggested_qty: number;
  created_at: Date;
}

interface AccuracyOutcomeRow {
  id: number;
  symbol: string;
  setup_type: string;
  direction: string | null;
  outcome: string | null;
  created_at: Date;
}

interface ResolvedDecisionRow {
  id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  approved: boolean;
  win_probability: string;
  outcome: string | null;
  realized_pnl: string | null;
  created_at: Date;
}

interface ValidationSample {
  id: number;
  symbol: string;
  setup_type: string;
  regime: string;
  approved: boolean;
  probability: number;
  label: 0 | 1;
  outcome: OutcomeLabel;
  realizedPnl: number;
  createdAt: Date;
}

export interface BinaryValidationMetrics {
  sample_count: number;
  wins: number;
  losses: number;
  realized_win_rate: number;
  average_predicted_win_prob: number;
  calibration_bias: number;
  brier_score: number;
  log_loss: number;
  precision: number;
  recall: number;
  f1_score: number;
  specificity: number;
  false_positive_rate: number;
  expected_wins: number;
  actual_wins: number;
  win_delta: number;
  realized_pnl_total: number;
  realized_pnl_avg: number;
}

export interface ValidationGroupMetrics extends BinaryValidationMetrics {
  key: string;
  setup_type: string;
  regime: string;
}

export interface CalibrationBin {
  bucket: string;
  min_prob: number;
  max_prob: number;
  count: number;
  avg_pred: number;
  realized_win_rate: number;
}

export interface DriftSnapshot {
  older: BinaryValidationMetrics;
  newer: BinaryValidationMetrics;
  win_rate_delta: number;
  brier_delta: number;
  precision_delta: number;
}

export interface ValidationOptimizationAction {
  strategy_id: string;
  trigger: string;
  started_at: string;
  success: boolean;
  message: string;
  best_score?: number;
  next_tier?: string;
}

export interface PaperValidationReport {
  generated_at: string;
  days: number;
  status: ValidationStatus;
  threshold: number;
  reconciliation: {
    pending_before: number;
    matched: number;
    still_pending: number;
    scanned_accuracy_rows: number;
  };
  overall: BinaryValidationMetrics;
  approved: BinaryValidationMetrics;
  calibration_bins: CalibrationBin[];
  by_setup: ValidationGroupMetrics[];
  by_regime: ValidationGroupMetrics[];
  by_setup_regime: ValidationGroupMetrics[];
  drift: DriftSnapshot | null;
  optimization_actions: ValidationOptimizationAction[];
}

const HISTORY_LIMIT = 60;
const RECONCILIATION_MATCH_MS = 2 * 60 * 60 * 1000;
const DEFAULT_THRESHOLD = 0.55;
const DEFAULT_DAYS = 30;
const DEFAULT_INTERVAL_MS = 3 * 60 * 1000;
const OPTIMIZATION_COOLDOWN_MS = 30 * 60 * 1000;

let _loopRunning = false;
let _loopInterval: NodeJS.Timeout | null = null;
let _loopIntervalMs = Math.max(30_000, Number(process.env.PAPER_VALIDATION_INTERVAL_MS ?? DEFAULT_INTERVAL_MS));
let _cycleInFlight = false;
let _latestReport: PaperValidationReport | null = null;
let _history: PaperValidationReport[] = [];
let _lastCycleAt: string | null = null;
let _lastError: string | null = null;
const _lastOptimizationAt = new Map<string, number>();

function parseNum(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeOutcome(value: unknown): OutcomeLabel | null {
  const s = String(value ?? "").toLowerCase();
  if (s === "win") return "win";
  if (s === "loss") return "loss";
  return null;
}

function probabilityFromDb(value: unknown): number {
  const n = parseNum(value);
  if (n > 1.000001) return clamp01(n / 100);
  return clamp01(n);
}

function computeMetrics(samples: ValidationSample[], threshold = DEFAULT_THRESHOLD): BinaryValidationMetrics {
  if (samples.length === 0) {
    return {
      sample_count: 0,
      wins: 0,
      losses: 0,
      realized_win_rate: 0,
      average_predicted_win_prob: 0,
      calibration_bias: 0,
      brier_score: 0,
      log_loss: 0,
      precision: 0,
      recall: 0,
      f1_score: 0,
      specificity: 0,
      false_positive_rate: 0,
      expected_wins: 0,
      actual_wins: 0,
      win_delta: 0,
      realized_pnl_total: 0,
      realized_pnl_avg: 0,
    };
  }

  let wins = 0;
  let expectedWins = 0;
  let brier = 0;
  let logLoss = 0;
  let totalPnl = 0;
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  const eps = 1e-6;

  for (const sample of samples) {
    const p = clamp01(sample.probability);
    const y = sample.label;
    wins += y;
    expectedWins += p;
    const err = p - y;
    brier += err * err;
    const safeP = Math.min(1 - eps, Math.max(eps, p));
    logLoss += -(y * Math.log(safeP) + (1 - y) * Math.log(1 - safeP));
    totalPnl += sample.realizedPnl;

    const pred = p >= threshold ? 1 : 0;
    if (pred === 1 && y === 1) tp += 1;
    else if (pred === 1 && y === 0) fp += 1;
    else if (pred === 0 && y === 1) fn += 1;
    else tn += 1;
  }

  const count = samples.length;
  const losses = count - wins;
  const winRate = wins / count;
  const avgPred = expectedWins / count;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const specificity = tn + fp > 0 ? tn / (tn + fp) : 0;
  const fpr = tn + fp > 0 ? fp / (tn + fp) : 0;

  return {
    sample_count: count,
    wins,
    losses,
    realized_win_rate: winRate,
    average_predicted_win_prob: avgPred,
    calibration_bias: avgPred - winRate,
    brier_score: brier / count,
    log_loss: logLoss / count,
    precision,
    recall,
    f1_score: f1,
    specificity,
    false_positive_rate: fpr,
    expected_wins: expectedWins,
    actual_wins: wins,
    win_delta: expectedWins - wins,
    realized_pnl_total: totalPnl,
    realized_pnl_avg: totalPnl / count,
  };
}

function groupMetrics(
  samples: ValidationSample[],
  keySelector: (s: ValidationSample) => string,
  minSamples = 8,
): ValidationGroupMetrics[] {
  const groups = new Map<string, ValidationSample[]>();
  for (const sample of samples) {
    const key = keySelector(sample);
    const arr = groups.get(key);
    if (arr) arr.push(sample);
    else groups.set(key, [sample]);
  }

  const results: ValidationGroupMetrics[] = [];
  for (const [key, rows] of groups.entries()) {
    if (rows.length < minSamples) continue;
    const metrics = computeMetrics(rows);
    const first = rows[0];
    results.push({
      key,
      setup_type: first.setup_type,
      regime: first.regime,
      ...metrics,
    });
  }

  return results.sort((a, b) => b.sample_count - a.sample_count);
}

function buildCalibrationBins(samples: ValidationSample[]): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < 10; i++) {
    const min = i / 10;
    const max = (i + 1) / 10;
    const inBin = samples.filter((sample) => {
      if (i === 9) return sample.probability >= min && sample.probability <= max;
      return sample.probability >= min && sample.probability < max;
    });
    const count = inBin.length;
    const avgPred = count > 0 ? inBin.reduce((s, sample) => s + sample.probability, 0) / count : 0;
    const realized = count > 0 ? inBin.reduce((s, sample) => s + sample.label, 0) / count : 0;
    bins.push({
      bucket: `${Math.round(min * 100)}-${Math.round(max * 100)}%`,
      min_prob: min,
      max_prob: max,
      count,
      avg_pred: avgPred,
      realized_win_rate: realized,
    });
  }
  return bins;
}

function classifyStatus(metrics: BinaryValidationMetrics): ValidationStatus {
  if (metrics.sample_count < 20) return "INSUFFICIENT";
  const bias = Math.abs(metrics.calibration_bias);
  if (metrics.brier_score <= 0.18 && bias <= 0.05 && metrics.precision >= 0.56) return "HEALTHY";
  if (metrics.brier_score <= 0.24 && bias <= 0.1 && metrics.precision >= 0.5) return "WATCH";
  if (metrics.brier_score <= 0.30) return "DRIFT";
  return "CRITICAL";
}

async function reconcilePendingOutcomes(days = DEFAULT_DAYS): Promise<{
  pending_before: number;
  matched: number;
  still_pending: number;
  scanned_accuracy_rows: number;
}> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const pending = await db
    .select({
      id: siDecisionsTable.id,
      symbol: siDecisionsTable.symbol,
      setup_type: siDecisionsTable.setup_type,
      direction: siDecisionsTable.direction,
      entry_price: siDecisionsTable.entry_price,
      stop_loss: siDecisionsTable.stop_loss,
      take_profit: siDecisionsTable.take_profit,
      suggested_qty: siDecisionsTable.suggested_qty,
      created_at: siDecisionsTable.created_at,
    })
    .from(siDecisionsTable)
    .where(
      and(
        eq(siDecisionsTable.approved, true),
        isNull(siDecisionsTable.outcome),
        gte(siDecisionsTable.created_at, cutoff),
      ),
    )
    .orderBy(asc(siDecisionsTable.created_at))
    .limit(250);

  const pendingRows = pending as PendingDecisionRow[];
  if (pendingRows.length === 0) {
    return {
      pending_before: 0,
      matched: 0,
      still_pending: 0,
      scanned_accuracy_rows: 0,
    };
  }

  const minCreated = pendingRows[0].created_at.getTime() - 6 * 60 * 60 * 1000;
  const symbols = [...new Set(pendingRows.map((row) => row.symbol))];

  const accuracyRowsRaw = await db
    .select({
      id: accuracyResultsTable.id,
      symbol: accuracyResultsTable.symbol,
      setup_type: accuracyResultsTable.setup_type,
      direction: accuracyResultsTable.direction,
      outcome: accuracyResultsTable.outcome,
      created_at: accuracyResultsTable.created_at,
    })
    .from(accuracyResultsTable)
    .where(
      and(
        gte(accuracyResultsTable.created_at, new Date(minCreated)),
        lte(accuracyResultsTable.created_at, new Date()),
        or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
      ),
    )
    .orderBy(asc(accuracyResultsTable.created_at))
    .limit(50_000);

  const accuracyRows = (accuracyRowsRaw as AccuracyOutcomeRow[])
    .filter((row) => symbols.includes(row.symbol));

  let matched = 0;
  const usedAccuracyIds = new Set<number>();
  for (const row of pendingRows) {
    let best: { candidate: AccuracyOutcomeRow; diff: number } | null = null;
    for (const candidate of accuracyRows) {
      if (usedAccuracyIds.has(candidate.id)) continue;
      if (candidate.symbol !== row.symbol) continue;
      if (candidate.setup_type !== row.setup_type) continue;
      if (candidate.direction && row.direction && candidate.direction !== row.direction) continue;
      const outcome = normalizeOutcome(candidate.outcome);
      if (!outcome) continue;
      const diff = Math.abs(candidate.created_at.getTime() - row.created_at.getTime());
      if (diff > RECONCILIATION_MATCH_MS) continue;
      if (!best || diff < best.diff) {
        best = { candidate, diff };
      }
    }

    if (!best) continue;

    const outcome = normalizeOutcome(best.candidate.outcome);
    if (!outcome) continue;
    const entry = parseNum(row.entry_price);
    const stop = parseNum(row.stop_loss);
    const take = parseNum(row.take_profit);
    const qty = Math.max(0, parseNum(row.suggested_qty));
    const risk = Math.abs(entry - stop) * qty;
    const reward = Math.abs(take - entry) * qty;
    const pnl = outcome === "win" ? reward : -risk;

    const updatePayload: Partial<typeof siDecisionsTable.$inferInsert> = {
      outcome,
    };
    if (Number.isFinite(pnl) && pnl !== 0) {
      updatePayload.realized_pnl = pnl.toFixed(4);
    }

    await db
      .update(siDecisionsTable)
      .set(updatePayload)
      .where(eq(siDecisionsTable.id, row.id));

    usedAccuracyIds.add(best.candidate.id);
    matched += 1;
  }

  const stillPendingRow = await db
    .select({ count: siDecisionsTable.id })
    .from(siDecisionsTable)
    .where(
      and(
        eq(siDecisionsTable.approved, true),
        isNull(siDecisionsTable.outcome),
        gte(siDecisionsTable.created_at, cutoff),
      ),
    )
    .limit(10_000);

  const stillPending = stillPendingRow.length;
  return {
    pending_before: pendingRows.length,
    matched,
    still_pending: stillPending,
    scanned_accuracy_rows: accuracyRows.length,
  };
}

async function fetchResolvedSamples(days = DEFAULT_DAYS): Promise<ValidationSample[]> {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      id: siDecisionsTable.id,
      symbol: siDecisionsTable.symbol,
      setup_type: siDecisionsTable.setup_type,
      regime: siDecisionsTable.regime,
      approved: siDecisionsTable.approved,
      win_probability: siDecisionsTable.win_probability,
      outcome: siDecisionsTable.outcome,
      realized_pnl: siDecisionsTable.realized_pnl,
      created_at: siDecisionsTable.created_at,
    })
    .from(siDecisionsTable)
    .where(
      and(
        gte(siDecisionsTable.created_at, cutoff),
        or(eq(siDecisionsTable.outcome, "win"), eq(siDecisionsTable.outcome, "loss")),
      ),
    )
    .orderBy(asc(siDecisionsTable.created_at))
    .limit(200_000);

  const samples: ValidationSample[] = [];
  for (const row of rows as ResolvedDecisionRow[]) {
    const outcome = normalizeOutcome(row.outcome);
    if (!outcome) continue;
    samples.push({
      id: row.id,
      symbol: row.symbol,
      setup_type: row.setup_type,
      regime: row.regime || "unknown",
      approved: Boolean(row.approved),
      probability: probabilityFromDb(row.win_probability),
      label: outcome === "win" ? 1 : 0,
      outcome,
      realizedPnl: parseNum(row.realized_pnl),
      createdAt: new Date(row.created_at),
    });
  }
  return samples;
}

function computeDrift(samples: ValidationSample[], threshold: number): DriftSnapshot | null {
  if (samples.length < 30) return null;
  const midpoint = Math.floor(samples.length / 2);
  const older = computeMetrics(samples.slice(0, midpoint), threshold);
  const newer = computeMetrics(samples.slice(midpoint), threshold);
  return {
    older,
    newer,
    win_rate_delta: newer.realized_win_rate - older.realized_win_rate,
    brier_delta: newer.brier_score - older.brier_score,
    precision_delta: newer.precision - older.precision,
  };
}

async function maybeAutoOptimize(
  report: PaperValidationReport,
  maxActions = 1,
): Promise<ValidationOptimizationAction[]> {
  if (report.status !== "DRIFT" && report.status !== "CRITICAL") {
    return [];
  }

  const candidates = report.by_setup_regime
    .filter((group) => group.sample_count >= 20)
    .map((group) => ({
      strategy_id: `${group.setup_type}::${group.regime}`,
      overconfidence: group.calibration_bias,
      brier: group.brier_score,
      score: group.calibration_bias + group.brier_score * 0.35,
    }))
    .filter((group) => group.overconfidence > 0.08 || group.brier > 0.24)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return [];

  const actions: ValidationOptimizationAction[] = [];
  for (const candidate of candidates.slice(0, maxActions)) {
    const lastAt = _lastOptimizationAt.get(candidate.strategy_id);
    const now = Date.now();
    if (lastAt && now - lastAt < OPTIMIZATION_COOLDOWN_MS) {
      continue;
    }

    const started = new Date().toISOString();
    try {
      const { runStrategyOptimization } = await import("./backtester");
      const result = await runStrategyOptimization({
        strategy_id: candidate.strategy_id,
        lookback_days: 180,
        min_train_samples: 18,
        min_test_samples: 8,
      });
      _lastOptimizationAt.set(candidate.strategy_id, now);
      actions.push({
        strategy_id: candidate.strategy_id,
        trigger: `status=${report.status},bias=${candidate.overconfidence.toFixed(3)},brier=${candidate.brier.toFixed(3)}`,
        started_at: started,
        success: true,
        message: `Optimization applied over ${result.evaluated_candidates} candidates.`,
        best_score: result.best_score,
        next_tier: result.applied_result.promotion.next_tier,
      });
    } catch (err) {
      actions.push({
        strategy_id: candidate.strategy_id,
        trigger: `status=${report.status},bias=${candidate.overconfidence.toFixed(3)},brier=${candidate.brier.toFixed(3)}`,
        started_at: started,
        success: false,
        message: err instanceof Error ? err.message : "optimization_failed",
      });
      logger.error({ err, strategy: candidate.strategy_id }, "[paper-validation] auto optimization failed");
    }
  }

  return actions;
}

export async function runPaperValidationCycle(options?: {
  days?: number;
  threshold?: number;
  enableAutoOptimization?: boolean;
}): Promise<PaperValidationReport> {
  if (_cycleInFlight && _latestReport) {
    return _latestReport;
  }
  _cycleInFlight = true;
  try {
    const days = Math.max(7, Math.min(120, Math.round(parseNum(options?.days) || DEFAULT_DAYS)));
    const threshold = clamp01(parseNum(options?.threshold) || DEFAULT_THRESHOLD);

    const reconciliation = await reconcilePendingOutcomes(days);
    const samples = await fetchResolvedSamples(days);
    const approvedSamples = samples.filter((sample) => sample.approved);

    const overall = computeMetrics(samples, threshold);
    const approved = computeMetrics(approvedSamples, threshold);
    const bySetup = groupMetrics(approvedSamples, (sample) => `${sample.setup_type}::all`);
    const byRegime = groupMetrics(approvedSamples, (sample) => `all::${sample.regime}`);
    const bySetupRegime = groupMetrics(approvedSamples, (sample) => `${sample.setup_type}::${sample.regime}`);
    const drift = computeDrift(approvedSamples, threshold);
    const status = classifyStatus(approved);

    const report: PaperValidationReport = {
      generated_at: new Date().toISOString(),
      days,
      status,
      threshold,
      reconciliation,
      overall,
      approved,
      calibration_bins: buildCalibrationBins(approvedSamples),
      by_setup: bySetup.map((row) => ({
        ...row,
        key: row.key.replace("::all", ""),
      })),
      by_regime: byRegime.map((row) => ({
        ...row,
        key: row.key.replace("all::", ""),
      })),
      by_setup_regime: bySetupRegime,
      drift,
      optimization_actions: [],
    };

    if (options?.enableAutoOptimization !== false) {
      report.optimization_actions = await maybeAutoOptimize(report, 1);
    }

    _latestReport = report;
    _lastCycleAt = report.generated_at;
    _lastError = null;
    _history = [report, ..._history].slice(0, HISTORY_LIMIT);
    return report;
  } catch (err) {
    _lastError = err instanceof Error ? err.message : String(err);
    logger.error({ err }, "[paper-validation] cycle failed");
    throw err;
  } finally {
    _cycleInFlight = false;
  }
}

export async function startPaperValidationLoop(options?: {
  intervalMs?: number;
  runImmediate?: boolean;
}): Promise<{ success: boolean; message: string; interval_ms: number }> {
  if (_loopRunning) {
    return { success: false, message: "Paper validation loop already running", interval_ms: _loopIntervalMs };
  }

  if (options?.intervalMs && Number.isFinite(options.intervalMs)) {
    _loopIntervalMs = Math.max(30_000, Math.round(options.intervalMs));
  }

  _loopRunning = true;
  _loopInterval = setInterval(() => {
    runPaperValidationCycle({ enableAutoOptimization: true }).catch((err) => {
      logger.error({ err }, "[paper-validation] scheduled cycle failed");
    });
  }, _loopIntervalMs);

  if (options?.runImmediate !== false) {
    await runPaperValidationCycle({ enableAutoOptimization: true }).catch((err) => {
      logger.error({ err }, "[paper-validation] immediate cycle failed");
    });
  }

  return { success: true, message: "Paper validation loop started", interval_ms: _loopIntervalMs };
}

export function stopPaperValidationLoop(): { success: boolean; message: string } {
  if (!_loopRunning) {
    return { success: false, message: "Paper validation loop not running" };
  }
  if (_loopInterval) {
    clearInterval(_loopInterval);
    _loopInterval = null;
  }
  _loopRunning = false;
  return { success: true, message: "Paper validation loop stopped" };
}

export function getPaperValidationStatus(): {
  running: boolean;
  interval_ms: number;
  last_cycle_at: string | null;
  last_error: string | null;
  history_size: number;
  latest_status: ValidationStatus | null;
  latest_sample_count: number;
} {
  return {
    running: _loopRunning,
    interval_ms: _loopIntervalMs,
    last_cycle_at: _lastCycleAt,
    last_error: _lastError,
    history_size: _history.length,
    latest_status: _latestReport?.status ?? null,
    latest_sample_count: _latestReport?.approved.sample_count ?? 0,
  };
}

export function getLatestPaperValidationReport(): PaperValidationReport | null {
  return _latestReport;
}

export function getPaperValidationHistory(limit = 20): PaperValidationReport[] {
  const safeLimit = Math.max(1, Math.min(HISTORY_LIMIT, Math.round(limit)));
  return _history.slice(0, safeLimit);
}
