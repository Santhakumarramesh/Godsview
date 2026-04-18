/**
 * ML Operations — Production model lifecycle management.
 *
 * Manages:
 * 1. Model version registration and promotion (trained → shadow → champion → retired)
 * 2. Champion/challenger evaluation with evidence-based promotion
 * 3. Feature catalog with importance tracking
 * 4. Retrain event logging
 * 5. Live performance feedback from execution truth layer
 *
 * This module bridges the gap between model training (ml_model.ts, trainer.py)
 * and production deployment, adding governance and auditability.
 */

import { logger } from "./logger";
import {
  db,
  modelVersionsTable,
  featureDefinitionsTable,
  modelEvaluationsTable,
  retrainEventsTable,
} from "@workspace/db";
import { desc, eq, and, sql } from "@workspace/db";

// ── Types ──────────────────────────────────────────────────────

export type ModelStatus = "trained" | "shadow" | "champion" | "retired" | "rolled_back";

export interface ModelMetrics {
  accuracy: number;
  auc_roc?: number;
  f1_score?: number;
  brier_score?: number;
  log_loss?: number;
  precision_score?: number;
  recall_score?: number;
}

export interface LivePerformance {
  accuracy: number;
  brier_score: number;
  trade_count: number;
  win_rate: number;
}

export interface EvaluationVerdict {
  verdict: "champion_holds" | "challenger_wins" | "insufficient_data" | "draw";
  improvement_pct: number;
  reason: string;
}

// ── Configuration ──────────────────────────────────────────────

export const ML_OPS_CONFIG = {
  /** Minimum trades for a meaningful evaluation */
  MIN_EVALUATION_TRADES: 30,
  /** Challenger must beat champion by this % to be promoted */
  PROMOTION_THRESHOLD_PCT: 2.0,
  /** Shadow period minimum days before promotion eligibility */
  SHADOW_MIN_DAYS: 3,
  /** Maximum retired versions to keep per model */
  MAX_RETIRED_VERSIONS: 10,
};

// ── Model Version Management ───────────────────────────────────

/**
 * Register a new model version after training.
 */
export async function registerModelVersion(
  modelName: string,
  metrics: ModelMetrics,
  config: {
    training_rows: number;
    feature_count: number;
    feature_names: string[];
    hyperparams: Record<string, unknown>;
    data_hash?: string;
    artifact_path?: string;
  },
): Promise<number | null> {
  try {
    // Get next version number
    const latest = await db.select({ version: modelVersionsTable.version })
      .from(modelVersionsTable)
      .where(eq(modelVersionsTable.model_name, modelName))
      .orderBy(desc(modelVersionsTable.version))
      .limit(1);

    const nextVersion = (latest[0]?.version ?? 0) + 1;

    const rows = await db.insert(modelVersionsTable).values({
      model_name: modelName,
      version: nextVersion,
      status: "trained",
      training_rows: config.training_rows,
      feature_count: config.feature_count,
      feature_names_json: config.feature_names,
      config_json: config.hyperparams,
      accuracy: String(metrics.accuracy),
      auc_roc: metrics.auc_roc != null ? String(metrics.auc_roc) : null,
      f1_score: metrics.f1_score != null ? String(metrics.f1_score) : null,
      brier_score: metrics.brier_score != null ? String(metrics.brier_score) : null,
      log_loss: metrics.log_loss != null ? String(metrics.log_loss) : null,
      precision_score: metrics.precision_score != null ? String(metrics.precision_score) : null,
      recall_score: metrics.recall_score != null ? String(metrics.recall_score) : null,
      model_artifact_path: config.artifact_path,
      training_data_hash: config.data_hash,
    }).returning({ id: modelVersionsTable.id });

    const id = rows[0]?.id ?? null;
    logger.info({ modelName, version: nextVersion, id, accuracy: metrics.accuracy }, "Model version registered");
    return id;
  } catch (err) {
    logger.error({ err, modelName }, "Failed to register model version");
    return null;
  }
}

/**
 * Get the current champion for a model.
 */
export async function getChampion(modelName: string): Promise<any | null> {
  const rows = await db.select()
    .from(modelVersionsTable)
    .where(and(
      eq(modelVersionsTable.model_name, modelName),
      eq(modelVersionsTable.status, "champion"),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Get the current shadow (challenger) for a model.
 */
export async function getShadow(modelName: string): Promise<any | null> {
  const rows = await db.select()
    .from(modelVersionsTable)
    .where(and(
      eq(modelVersionsTable.model_name, modelName),
      eq(modelVersionsTable.status, "shadow"),
    ))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Promote a trained model to shadow (challenger) status.
 */
export async function promoteToShadow(versionId: number): Promise<boolean> {
  try {
    const version = await db.select()
      .from(modelVersionsTable)
      .where(eq(modelVersionsTable.id, versionId))
      .limit(1);

    if (!version[0] || version[0].status !== "trained") {
      logger.warn({ versionId }, "Cannot promote to shadow: not in 'trained' status");
      return false;
    }

    // Retire any existing shadow for this model
    await db.update(modelVersionsTable)
      .set({ status: "retired", retired_at: new Date() })
      .where(and(
        eq(modelVersionsTable.model_name, version[0].model_name),
        eq(modelVersionsTable.status, "shadow"),
      ));

    await db.update(modelVersionsTable)
      .set({ status: "shadow" })
      .where(eq(modelVersionsTable.id, versionId));

    logger.info({ versionId, model: version[0].model_name }, "Model promoted to shadow");
    return true;
  } catch (err) {
    logger.error({ err, versionId }, "Failed to promote to shadow");
    return false;
  }
}

/**
 * Promote shadow to champion, retiring the current champion.
 */
export async function promoteToChampion(
  versionId: number,
  reason: string,
): Promise<boolean> {
  try {
    const version = await db.select()
      .from(modelVersionsTable)
      .where(eq(modelVersionsTable.id, versionId))
      .limit(1);

    if (!version[0] || version[0].status !== "shadow") {
      logger.warn({ versionId }, "Cannot promote to champion: not in 'shadow' status");
      return false;
    }

    // Get current champion
    const currentChampion = await getChampion(version[0].model_name);

    // Retire current champion
    if (currentChampion) {
      await db.update(modelVersionsTable)
        .set({ status: "retired", retired_at: new Date() })
        .where(eq(modelVersionsTable.id, currentChampion.id));
    }

    // Promote shadow to champion
    await db.update(modelVersionsTable)
      .set({
        status: "champion",
        promoted_at: new Date(),
        promoted_from_version: currentChampion?.version,
        promotion_reason: reason,
      })
      .where(eq(modelVersionsTable.id, versionId));

    logger.info({
      versionId,
      model: version[0].model_name,
      previousChampion: currentChampion?.version,
      reason,
    }, "Model promoted to champion");
    return true;
  } catch (err) {
    logger.error({ err, versionId }, "Failed to promote to champion");
    return false;
  }
}

/**
 * Update live performance metrics for a model version.
 */
export async function updateLivePerformance(
  versionId: number,
  perf: LivePerformance,
): Promise<boolean> {
  try {
    await db.update(modelVersionsTable)
      .set({
        live_accuracy: String(perf.accuracy),
        live_brier_score: String(perf.brier_score),
        live_trade_count: perf.trade_count,
        live_win_rate: String(perf.win_rate),
      })
      .where(eq(modelVersionsTable.id, versionId));
    return true;
  } catch (err) {
    logger.error({ err, versionId }, "Failed to update live performance");
    return false;
  }
}

// ── Champion/Challenger Evaluation ─────────────────────────────

/**
 * Compare champion vs challenger metrics and produce a verdict.
 * Pure function — does not read from DB.
 */
export function evaluateChampionVsChallenger(
  champion: LivePerformance,
  challenger: LivePerformance,
): EvaluationVerdict {
  if (champion.trade_count < ML_OPS_CONFIG.MIN_EVALUATION_TRADES ||
      challenger.trade_count < ML_OPS_CONFIG.MIN_EVALUATION_TRADES) {
    return {
      verdict: "insufficient_data",
      improvement_pct: 0,
      reason: `Need ${ML_OPS_CONFIG.MIN_EVALUATION_TRADES} trades each; champion=${champion.trade_count}, challenger=${challenger.trade_count}`,
    };
  }

  // Primary metric: Brier score (lower is better)
  const brierImprovement = champion.brier_score > 0
    ? ((champion.brier_score - challenger.brier_score) / champion.brier_score) * 100
    : 0;

  // Secondary metric: accuracy
  const accImprovement = champion.accuracy > 0
    ? ((challenger.accuracy - champion.accuracy) / champion.accuracy) * 100
    : 0;

  // Combined score: 60% Brier improvement + 40% accuracy improvement
  const combinedImprovement = round4(brierImprovement * 0.6 + accImprovement * 0.4);

  if (combinedImprovement >= ML_OPS_CONFIG.PROMOTION_THRESHOLD_PCT) {
    return {
      verdict: "challenger_wins",
      improvement_pct: combinedImprovement,
      reason: `Challenger improves by ${combinedImprovement.toFixed(1)}% (Brier: ${brierImprovement.toFixed(1)}%, Acc: ${accImprovement.toFixed(1)}%)`,
    };
  }

  if (Math.abs(combinedImprovement) < ML_OPS_CONFIG.PROMOTION_THRESHOLD_PCT) {
    return {
      verdict: "draw",
      improvement_pct: combinedImprovement,
      reason: `Within threshold (${combinedImprovement.toFixed(1)}% vs ${ML_OPS_CONFIG.PROMOTION_THRESHOLD_PCT}% required)`,
    };
  }

  return {
    verdict: "champion_holds",
    improvement_pct: combinedImprovement,
    reason: `Champion still better by ${(-combinedImprovement).toFixed(1)}%`,
  };
}

/**
 * Run a full evaluation and persist results.
 */
export async function runEvaluation(
  modelName: string,
  evaluationType: string = "periodic_review",
): Promise<EvaluationVerdict | null> {
  try {
    const champion = await getChampion(modelName);
    const shadow = await getShadow(modelName);

    if (!champion) {
      logger.info({ modelName }, "No champion found for evaluation");
      return null;
    }

    const championPerf: LivePerformance = {
      accuracy: Number(champion.live_accuracy ?? champion.accuracy ?? 0),
      brier_score: Number(champion.live_brier_score ?? champion.brier_score ?? 1),
      trade_count: Number(champion.live_trade_count ?? 0),
      win_rate: Number(champion.live_win_rate ?? 0),
    };

    const challengerPerf: LivePerformance = shadow ? {
      accuracy: Number(shadow.live_accuracy ?? shadow.accuracy ?? 0),
      brier_score: Number(shadow.live_brier_score ?? shadow.brier_score ?? 1),
      trade_count: Number(shadow.live_trade_count ?? 0),
      win_rate: Number(shadow.live_win_rate ?? 0),
    } : { accuracy: 0, brier_score: 1, trade_count: 0, win_rate: 0 };

    const verdict = evaluateChampionVsChallenger(championPerf, challengerPerf);

    // Persist evaluation
    await db.insert(modelEvaluationsTable).values({
      champion_version_id: champion.id,
      challenger_version_id: shadow?.id,
      evaluation_type: evaluationType,
      champion_accuracy: String(championPerf.accuracy),
      champion_brier: String(championPerf.brier_score),
      champion_trade_count: championPerf.trade_count,
      champion_win_rate: String(championPerf.win_rate),
      challenger_accuracy: shadow ? String(challengerPerf.accuracy) : null,
      challenger_brier: shadow ? String(challengerPerf.brier_score) : null,
      challenger_trade_count: shadow ? challengerPerf.trade_count : null,
      challenger_win_rate: shadow ? String(challengerPerf.win_rate) : null,
      verdict: verdict.verdict,
      improvement_pct: String(verdict.improvement_pct),
      notes: verdict.reason,
    });

    // Auto-promote if challenger wins
    if (verdict.verdict === "challenger_wins" && shadow) {
      await promoteToChampion(shadow.id, verdict.reason);
      // Update evaluation with action taken
      logger.info({ modelName, verdict: verdict.verdict }, "Auto-promoted challenger to champion");
    }

    return verdict;
  } catch (err) {
    logger.error({ err, modelName }, "Model evaluation failed");
    return null;
  }
}

// ── Feature Catalog ────────────────────────────────────────────

/**
 * Register or update a feature definition.
 */
export async function registerFeature(
  featureName: string,
  featureType: string,
  options?: {
    source?: string;
    description?: string;
    importance_rank?: number;
    avg_importance?: number;
    staleness_ms?: number;
  },
): Promise<number | null> {
  try {
    // Upsert: try insert, update on conflict
    const existing = await db.select()
      .from(featureDefinitionsTable)
      .where(eq(featureDefinitionsTable.feature_name, featureName))
      .limit(1);

    if (existing[0]) {
      await db.update(featureDefinitionsTable)
        .set({
          feature_type: featureType,
          computation_source: options?.source,
          description: options?.description,
          importance_rank: options?.importance_rank,
          avg_importance: options?.avg_importance != null ? String(options.avg_importance) : undefined,
          staleness_threshold_ms: options?.staleness_ms,
          updated_at: new Date(),
        })
        .where(eq(featureDefinitionsTable.id, existing[0].id));
      return existing[0].id;
    }

    const rows = await db.insert(featureDefinitionsTable).values({
      feature_name: featureName,
      feature_type: featureType,
      computation_source: options?.source,
      description: options?.description,
      importance_rank: options?.importance_rank,
      avg_importance: options?.avg_importance != null ? String(options.avg_importance) : null,
      staleness_threshold_ms: options?.staleness_ms,
    }).returning({ id: featureDefinitionsTable.id });

    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err, featureName }, "Failed to register feature");
    return null;
  }
}

/**
 * Get all active feature definitions.
 */
export async function getActiveFeatures(): Promise<any[]> {
  return db.select()
    .from(featureDefinitionsTable)
    .where(eq(featureDefinitionsTable.is_active, true))
    .orderBy(featureDefinitionsTable.importance_rank);
}

// ── Retrain Event Logging ──────────────────────────────────────

/**
 * Log the start of a retrain event.
 */
export async function logRetrainStart(
  modelName: string,
  trigger: string,
  context: { training_rows?: number; new_rows?: number; data_hash?: string },
): Promise<number | null> {
  try {
    const rows = await db.insert(retrainEventsTable).values({
      model_name: modelName,
      trigger,
      status: "started",
      training_rows: context.training_rows,
      new_rows_since_last: context.new_rows,
      data_hash: context.data_hash,
    }).returning({ id: retrainEventsTable.id });
    return rows[0]?.id ?? null;
  } catch (err) {
    logger.error({ err, modelName }, "Failed to log retrain start");
    return null;
  }
}

/**
 * Log completion of a retrain event.
 */
export async function logRetrainComplete(
  eventId: number,
  result: {
    new_version_id?: number;
    accuracy_before?: number;
    accuracy_after?: number;
    duration_ms: number;
    error?: string;
  },
): Promise<void> {
  try {
    const status = result.error ? "failed" : "completed";
    const improvement = result.accuracy_before && result.accuracy_after
      ? round4(result.accuracy_after - result.accuracy_before)
      : null;

    await db.update(retrainEventsTable)
      .set({
        status,
        new_version_id: result.new_version_id,
        accuracy_before: result.accuracy_before != null ? String(result.accuracy_before) : null,
        accuracy_after: result.accuracy_after != null ? String(result.accuracy_after) : null,
        improvement: improvement != null ? String(improvement) : null,
        duration_ms: result.duration_ms,
        error_message: result.error,
      })
      .where(eq(retrainEventsTable.id, eventId));
  } catch (err) {
    logger.error({ err, eventId }, "Failed to log retrain completion");
  }
}

// ── Query Helpers ──────────────────────────────────────────────

/**
 * Get version history for a model.
 */
export async function getModelVersionHistory(
  modelName: string,
  limit: number = 20,
): Promise<any[]> {
  return db.select()
    .from(modelVersionsTable)
    .where(eq(modelVersionsTable.model_name, modelName))
    .orderBy(desc(modelVersionsTable.version))
    .limit(limit);
}

/**
 * Get recent retrain events.
 */
export async function getRetrainHistory(
  modelName?: string,
  limit: number = 20,
): Promise<any[]> {
  const conditions = modelName ? [eq(retrainEventsTable.model_name, modelName)] : [];
  return db.select()
    .from(retrainEventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(retrainEventsTable.created_at))
    .limit(limit);
}

/**
 * Get recent model evaluations.
 */
export async function getEvaluationHistory(limit: number = 20): Promise<any[]> {
  return db.select()
    .from(modelEvaluationsTable)
    .orderBy(desc(modelEvaluationsTable.created_at))
    .limit(limit);
}

// ── Utility ────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
