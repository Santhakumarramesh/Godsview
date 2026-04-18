/**
 * retrain_scheduler.ts — Phase 36
 *
 * Automatic ML model retraining loop.
 *
 * The scheduler polls the accuracy_results table every POLL_INTERVAL_MS and
 * triggers retrainModel() whenever enough new labeled outcomes have accumulated
 * since the last retraining run.
 *
 * Design decisions:
 *   - Uses a simple "high water mark" (last seen max id) to detect new rows
 *   - Minimum batch size (NEW_DATA_THRESHOLD) prevents wasted CPU on tiny deltas
 *   - Absolute interval cap (MAX_INTERVAL_MS) ensures periodic retraining even
 *     in low-traffic environments
 *   - All state is in-memory — no DB writes required
 *   - Non-blocking: retraining runs asynchronously; the scheduler never blocks
 *     the event loop
 */

import { db, accuracyResultsTable } from "@workspace/db";
import { sql, desc } from "@workspace/db";
import { retrainModel, getModelStatus } from "./ml_model";
import { logger } from "./logger";

// ── Configuration ─────────────────────────────────────────────────────────────

/** How often to check for new data (30 minutes) */
const POLL_INTERVAL_MS = 30 * 60 * 1000;

/** Trigger retrain if at least this many new rows appeared */
const NEW_DATA_THRESHOLD = 100;

/** Force retrain even without new data after this interval (6 hours) */
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000;

// ── Scheduler State ───────────────────────────────────────────────────────────

let schedulerTimer: ReturnType<typeof setInterval> | null = null;
let isRetraining  = false;
let highWaterMark = 0;   // Highest accuracy_results.id seen at last poll
let lastTrainedAt = 0;   // Epoch ms of last completed retrain

// Stats exposed via getSchedulerStats()
export interface SchedulerStats {
  running:          boolean;
  isRetraining:     boolean;
  highWaterMark:    number;
  lastTrainedAt:    string | null;
  totalRetrains:    number;
  pollIntervalMs:   number;
  newDataThreshold: number;
}

let totalRetrains = 0;

// ── Internal helpers ──────────────────────────────────────────────────────────

async function getLatestId(): Promise<number> {
  const [row] = await db
    .select({ maxId: sql<number>`coalesce(max(id), 0)::int` })
    .from(accuracyResultsTable);
  return row?.maxId ?? 0;
}

async function getTotalRows(): Promise<number> {
  const [row] = await db
    .select({ cnt: sql<number>`count(*)::int` })
    .from(accuracyResultsTable);
  return row?.cnt ?? 0;
}

async function maybeTriggerRetrain(): Promise<void> {
  if (isRetraining) {
    logger.debug("[retrain-scheduler] retrain already in progress — skipping poll");
    return;
  }

  try {
    const currentMax    = await getLatestId();
    const newRows       = currentMax - highWaterMark;
    const msSinceRetrain = Date.now() - lastTrainedAt;
    const forceRetrain  = lastTrainedAt > 0 && msSinceRetrain >= MAX_INTERVAL_MS;
    const hasEnoughNew  = newRows >= NEW_DATA_THRESHOLD;

    if (!hasEnoughNew && !forceRetrain) {
      logger.debug(
        { newRows, msSinceRetrain, threshold: NEW_DATA_THRESHOLD },
        "[retrain-scheduler] not enough new data yet"
      );
      return;
    }

    const reason = forceRetrain ? "max_interval_exceeded" : "new_data_threshold";
    const totalRows = await getTotalRows();
    logger.info(
      { newRows, totalRows, reason, highWaterMark, currentMax },
      "[retrain-scheduler] triggering model retrain"
    );

    isRetraining = true;
    const t0 = Date.now();

    try {
      const result = await retrainModel();
      const duration = Date.now() - t0;
      totalRetrains++;
      highWaterMark = currentMax;
      lastTrainedAt = Date.now();

      logger.info(
        {
          success:  result.success,
          message:  result.message,
          duration,
          totalRetrains,
          newRows,
        },
        "[retrain-scheduler] retrain complete"
      );

      // Log model status after retraining
      const modelStatus = getModelStatus();
      logger.info(
        { status: modelStatus.status, message: modelStatus.message, trainedAt: modelStatus.meta?.trainedAt },
        "[retrain-scheduler] model status after retrain"
      );

    } catch (err) {
      logger.error({ err }, "[retrain-scheduler] retrain threw an error");
    } finally {
      isRetraining = false;
    }

  } catch (err) {
    logger.error({ err }, "[retrain-scheduler] poll failed");
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the auto-retrain scheduler.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function startRetrainScheduler(): Promise<void> {
  if (schedulerTimer !== null) {
    logger.debug("[retrain-scheduler] already running");
    return;
  }

  // Initialize high water mark from current DB state (don't retrain on startup
  // if index.ts already called trainModel())
  try {
    highWaterMark = await getLatestId();
    lastTrainedAt = Date.now();
    logger.info(
      { highWaterMark, pollIntervalMs: POLL_INTERVAL_MS, newDataThreshold: NEW_DATA_THRESHOLD },
      "[retrain-scheduler] started"
    );
  } catch (err) {
    logger.error({ err }, "[retrain-scheduler] failed to initialize high water mark");
    highWaterMark = 0;
  }

  schedulerTimer = setInterval(() => {
    maybeTriggerRetrain().catch((err) =>
      logger.error({ err }, "[retrain-scheduler] unhandled poll error")
    );
  }, POLL_INTERVAL_MS);

  // Prevent the interval from keeping the process alive if server shuts down
  if (schedulerTimer.unref) {
    schedulerTimer.unref();
  }
}

/**
 * Stop the scheduler (called during graceful shutdown).
 */
export function stopRetrainScheduler(): void {
  if (schedulerTimer !== null) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
    logger.info("[retrain-scheduler] stopped");
  }
}

/**
 * Export scheduler statistics for the /api/system/status endpoint.
 */
export function getSchedulerStats(): SchedulerStats {
  return {
    running:          schedulerTimer !== null,
    isRetraining,
    highWaterMark,
    lastTrainedAt:    lastTrainedAt > 0 ? new Date(lastTrainedAt).toISOString() : null,
    totalRetrains,
    pollIntervalMs:   POLL_INTERVAL_MS,
    newDataThreshold: NEW_DATA_THRESHOLD,
  };
}
