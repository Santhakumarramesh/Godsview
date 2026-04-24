/**
 * SI Supervisor — Orchestration, Health Monitoring, and Auto-Retrain Engine
 *
 * Provides institutional-grade ensemble orchestration:
 * 1. Health checks — ensemble training status, model age, prediction accuracy
 * 2. Drift detection — monitor win rate and quality degradation
 * 3. Retrain triggers — automatic model retraining when performance degrades
 * 4. Ensemble status — aggregated view of all model states
 *
 * Runs periodic supervisor cycles to:
 * - Check model health (age, accuracy, drift)
 * - Evaluate retrain need (drift, freshness, accuracy drop)
 * - Trigger retrain if high/critical urgency
 * - Persist reports for audit trail
 */

import {
  predictWinProbability,
  getModelStatus,
  getModelDriftStatus,
  retrainModel,
  getModelDiagnostics,
} from "../lib/ml_model";
import { persistRead, persistWrite, persistAppend, getCollectionSize } from "../lib/persistent_store";
import { logger } from "../lib/logger";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SISupervisorConfig {
  /** Accuracy drop % to trigger retrain (default 5%) */
  retrainThreshold: number;
  /** Health check interval in ms (default 300_000 = 5 min) */
  healthCheckIntervalMs: number;
  /** Maximum model age in days (default 7) */
  maxModelAgeDays: number;
  /** Minimum ensemble models required (default 2) */
  ensembleMinModels: number;
  /** Drift alert threshold (default 0.1 = 10%) */
  driftAlertThreshold: number;
}

export interface SIHealthIssue {
  severity: "warning" | "critical";
  code: string;
  message: string;
  metric?: number;
  threshold?: number;
}

export interface SIHealthReport {
  status: "healthy" | "degraded" | "critical";
  checkTime: string;
  modelStatus: string;
  modelAge: {
    trainedAt: string;
    ageDays: number;
    warning: boolean;
  };
  accuracy: {
    current: number;
    baseline: number;
    delta: number;
    threshold: number;
  };
  drift: {
    status: "stable" | "watch" | "drift";
    winRateDelta: number;
    qualityDelta: number;
  };
  ensemble: {
    trained: boolean;
    members: number;
    minRequired: number;
  };
  issues: SIHealthIssue[];
}

export interface RetrainDecision {
  shouldRetrain: boolean;
  reason: string;
  urgency: "low" | "medium" | "high" | "critical";
  metrics: {
    accuracyDrop: number;
    driftStatus: string;
    modelAgeExceeded: boolean;
    dataFreshness: number;
  };
}

export interface SupervisorCycleResult {
  cycleTime: string;
  health: SIHealthReport;
  retrainDecision: RetrainDecision;
  retrainExecuted: boolean;
  retrainResult?: { success: boolean; message: string };
}

export interface SupervisorReport extends SupervisorCycleResult {
  cycleNumber: number;
  duration_ms: number;
}

// ── Configuration ──────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SISupervisorConfig = {
  retrainThreshold: 5,
  healthCheckIntervalMs: 300_000,
  maxModelAgeDays: 7,
  ensembleMinModels: 2,
  driftAlertThreshold: 0.1,
};

let _config: SISupervisorConfig = DEFAULT_CONFIG;
let _supervisorActive = false;
let _supervisorIntervalId: NodeJS.Timeout | null = null;
let _cycleCount = 0;

// ── Health Check ───────────────────────────────────────────────────────────────

export async function siHealthCheck(): Promise<SIHealthReport> {
  const checkTime = new Date().toISOString();
  const issues: SIHealthIssue[] = [];

  // Get model status and diagnostics
  const modelStatus = getModelStatus();
  const diagnostics = await getModelDiagnostics();
  const drift = diagnostics.drift;

  // Extract model metadata
  const meta = diagnostics.status.meta;
  const trained = meta !== null && meta !== undefined;
  const members = meta?.setupModelsTrained ?? 0;
  const currentAccuracy = meta?.accuracy ?? 0;
  const baselineAccuracy = meta?.accuracy ?? 0; // Could be from historical baseline
  const accuracyDelta = currentAccuracy - baselineAccuracy;

  // Check 1: Ensemble training status
  if (modelStatus.status !== "active") {
    issues.push({
      severity: "warning",
      code: "ENSEMBLE_NOT_READY",
      message: modelStatus.message,
    });
  }

  // Check 2: Model age (if trained)
  let modelAgeWarning = false;
  let trainedAtStr = "never";
  let ageDays = Infinity;

  if (meta) {
    trainedAtStr = meta.trainedAt;
    const trainedAt = new Date(meta.trainedAt);
    const now = new Date();
    ageDays = (now.getTime() - trainedAt.getTime()) / (1000 * 60 * 60 * 24);

    if (ageDays > _config.maxModelAgeDays) {
      modelAgeWarning = true;
      issues.push({
        severity: "warning",
        code: "MODEL_AGE_EXCEEDED",
        message: `Model is ${ageDays.toFixed(1)} days old (threshold: ${_config.maxModelAgeDays} days)`,
        metric: ageDays,
        threshold: _config.maxModelAgeDays,
      });
    }
  }

  // Check 3: Accuracy drop
  if (accuracyDelta < -(_config.retrainThreshold / 100)) {
    issues.push({
      severity: "critical",
      code: "ACCURACY_DROP",
      message: `Accuracy dropped by ${Math.abs(accuracyDelta * 100).toFixed(1)}% (threshold: ${_config.retrainThreshold}%)`,
      metric: accuracyDelta * 100,
      threshold: -_config.retrainThreshold,
    });
  }

  // Check 4: Drift detection
  const driftStatus = drift?.status ?? "stable";
  let driftIssue: SIHealthIssue | null = null;

  if (driftStatus === "drift") {
    driftIssue = {
      severity: "critical",
      code: "CONCEPT_DRIFT",
      message: `Concept drift detected: win rate delta ${(drift!.winRateDelta * 100).toFixed(1)}%, quality delta ${(drift!.qualityDelta * 100).toFixed(1)}%`,
      metric: drift!.winRateDelta,
      threshold: -_config.driftAlertThreshold,
    };
    issues.push(driftIssue);
  } else if (driftStatus === "watch") {
    issues.push({
      severity: "warning",
      code: "DRIFT_WARNING",
      message: `Drift warning: win rate delta ${(drift!.winRateDelta * 100).toFixed(1)}%, quality delta ${(drift!.qualityDelta * 100).toFixed(1)}%`,
      metric: drift!.winRateDelta,
      threshold: -_config.driftAlertThreshold * 0.5,
    });
  }

  // Check 5: Ensemble minimum members
  if (trained && members < _config.ensembleMinModels) {
    issues.push({
      severity: "warning",
      code: "ENSEMBLE_INCOMPLETE",
      message: `Only ${members} setup models trained (minimum: ${_config.ensembleMinModels})`,
      metric: members,
      threshold: _config.ensembleMinModels,
    });
  }

  // Determine overall status
  const hasCritical = issues.some((i) => i.severity === "critical");
  const hasWarning = issues.some((i) => i.severity === "warning");
  const status = hasCritical ? "critical" : hasWarning ? "degraded" : "healthy";

  return {
    status,
    checkTime,
    modelStatus: modelStatus.message,
    modelAge: {
      trainedAt: trainedAtStr,
      ageDays,
      warning: modelAgeWarning,
    },
    accuracy: {
      current: currentAccuracy,
      baseline: baselineAccuracy,
      delta: accuracyDelta,
      threshold: _config.retrainThreshold / 100,
    },
    drift: {
      status: driftStatus as "stable" | "watch" | "drift",
      winRateDelta: drift?.winRateDelta ?? 0,
      qualityDelta: drift?.qualityDelta ?? 0,
    },
    ensemble: {
      trained,
      members,
      minRequired: _config.ensembleMinModels,
    },
    issues,
  };
}

// ── Retrain Evaluation ─────────────────────────────────────────────────────────

export async function evaluateRetrainNeed(): Promise<RetrainDecision> {
  const health = await siHealthCheck();
  const drift = health.drift;

  const accuracyDrop = Math.abs(health.accuracy.delta) * 100;
  const shouldRetrain =
    health.status === "critical" ||
    drift.status === "drift" ||
    health.modelAge.warning ||
    accuracyDrop >= _config.retrainThreshold;

  let urgency: "low" | "medium" | "high" | "critical" = "low";
  const reasons: string[] = [];

  if (drift.status === "drift") {
    urgency = "critical";
    reasons.push(
      `Concept drift detected: win rate delta ${(drift.winRateDelta * 100).toFixed(1)}%`
    );
  } else if (drift.status === "watch") {
    urgency = "high";
    reasons.push(
      `Drift warning: win rate delta ${(drift.winRateDelta * 100).toFixed(1)}%`
    );
  }

  if (accuracyDrop >= _config.retrainThreshold) {
    if (accuracyDrop >= 10) {
      urgency = urgency === "low" ? "high" : urgency;
    } else if (urgency === "low") {
      urgency = "medium";
    }
    reasons.push(`Accuracy dropped by ${accuracyDrop.toFixed(1)}%`);
  }

  if (health.modelAge.warning) {
    urgency = urgency === "low" ? "medium" : urgency;
    reasons.push(`Model age (${health.modelAge.ageDays.toFixed(1)} days) exceeds threshold`);
  }

  return {
    shouldRetrain,
    reason: reasons.length > 0 ? reasons.join("; ") : "No retrain needed",
    urgency,
    metrics: {
      accuracyDrop: accuracyDrop,
      driftStatus: drift.status,
      modelAgeExceeded: health.modelAge.warning,
      dataFreshness: health.modelAge.ageDays,
    },
  };
}

// ── Supervisor Cycle ───────────────────────────────────────────────────────────

export async function runSupervisorCycle(): Promise<SupervisorCycleResult> {
  const cycleStart = Date.now();
  const cycleTime = new Date().toISOString();

  try {
    // Step 1: Run health check
    const health = await siHealthCheck();
    logger.info(`[si-supervisor] Health check: ${health.status}`);

    // Step 2: Evaluate retrain need
    const retrainDecision = await evaluateRetrainNeed();
    logger.info(`[si-supervisor] Retrain eval: ${retrainDecision.reason} (urgency: ${retrainDecision.urgency})`);

    // Step 3: Execute retrain if needed
    let retrainExecuted = false;
    let retrainResult: { success: boolean; message: string } | undefined;

    if (
      retrainDecision.shouldRetrain &&
      (retrainDecision.urgency === "high" || retrainDecision.urgency === "critical")
    ) {
      logger.info(`[si-supervisor] Triggering retrain (urgency: ${retrainDecision.urgency})`);
      retrainResult = await retrainModel();
      retrainExecuted = true;
      logger.info(
        `[si-supervisor] Retrain ${retrainResult.success ? "succeeded" : "failed"}: ${retrainResult.message}`
      );
    }

    const result: SupervisorCycleResult = {
      cycleTime,
      health,
      retrainDecision,
      retrainExecuted,
      retrainResult,
    };

    // Step 4: Persist supervisor report
    _cycleCount += 1;
    const report: SupervisorReport = {
      ...result,
      cycleNumber: _cycleCount,
      duration_ms: Date.now() - cycleStart,
    };

    persistAppend<SupervisorReport>("si_supervisor_reports", report, Math.floor(5000));
    logger.info(`[si-supervisor] Cycle ${_cycleCount} completed in ${report.duration_ms}ms`);

    return result;
  } catch (error) {
    logger.error({ error }, "[si-supervisor] Cycle failed");
    throw error;
  }
}

// ── Supervisor Lifecycle ───────────────────────────────────────────────────────

export function startSISupervisor(config: Partial<SISupervisorConfig> = {}): void {
  if (_supervisorActive) {
    logger.warn("[si-supervisor] Already running");
    return;
  }

  _config = { ...DEFAULT_CONFIG, ...config };
  _supervisorActive = true;
  _cycleCount = 0;

  logger.info(
    { config: _config },
    "[si-supervisor] Starting with config"
  );

  // Run first cycle immediately, then periodically
  runSupervisorCycle().catch((err) => logger.error({ err }, "[si-supervisor] Initial cycle failed"));

  _supervisorIntervalId = setInterval(() => {
    runSupervisorCycle().catch((err) => logger.error({ err }, "[si-supervisor] Periodic cycle failed"));
  }, _config.healthCheckIntervalMs);
}

export function stopSISupervisor(): void {
  if (!_supervisorActive) {
    logger.warn("[si-supervisor] Not running");
    return;
  }

  if (_supervisorIntervalId) {
    clearInterval(_supervisorIntervalId);
    _supervisorIntervalId = null;
  }

  _supervisorActive = false;
  logger.info("[si-supervisor] Stopped");
}

export function isSISupervisorActive(): boolean {
  return _supervisorActive;
}

// ── History and Status ─────────────────────────────────────────────────────────

export function getSupervisorHistory(limit: number = 100): SupervisorReport[] {
  const reports = persistRead<SupervisorReport[]>("si_supervisor_reports", []);
  if (limit > 0) {
    return reports.slice(-limit);
  }
  return reports;
}

export function getSupervisorStats(): {
  totalCycles: number;
  retrainsTriggered: number;
  retrainsSuccessful: number;
  healthDistribution: Record<string, number>;
  urgencyDistribution: Record<string, number>;
} {
  const reports = persistRead<SupervisorReport[]>("si_supervisor_reports", []);

  let retrainsTriggered = 0;
  let retrainsSuccessful = 0;
  const healthDistribution: Record<string, number> = {};
  const urgencyDistribution: Record<string, number> = {};

  for (const report of reports) {
    if (report.retrainExecuted) {
      retrainsTriggered += 1;
      if (report.retrainResult?.success) {
        retrainsSuccessful += 1;
      }
    }
    healthDistribution[report.health.status] =
      (healthDistribution[report.health.status] ?? 0) + 1;
    urgencyDistribution[report.retrainDecision.urgency] =
      (urgencyDistribution[report.retrainDecision.urgency] ?? 0) + 1;
  }

  return {
    totalCycles: reports.length,
    retrainsTriggered,
    retrainsSuccessful,
    healthDistribution,
    urgencyDistribution,
  };
}

export async function getEnsembleStatus() {
  const modelStatus = getModelStatus();
  const diagnostics = await getModelDiagnostics();
  const health = await siHealthCheck();

  const meta = diagnostics.status.meta;
  const drift = diagnostics.drift;

  return {
    model: {
      status: modelStatus.status,
      message: modelStatus.message,
      meta,
    },
    drift,
    health,
    supervisor: {
      active: _supervisorActive,
      cycleCount: _cycleCount,
      reportCount: getCollectionSize("si_supervisor_reports"),
      config: _config,
    },
  };
}

// ── Configuration Management ───────────────────────────────────────────────────

export function getSISupervisorConfig(): SISupervisorConfig {
  return { ..._config };
}

export function setSISupervisorConfig(config: Partial<SISupervisorConfig>): void {
  _config = { ..._config, ...config };
  logger.info({ config: _config }, "[si-supervisor] Config updated");
}
