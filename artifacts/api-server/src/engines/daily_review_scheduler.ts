/**
 * engines/daily_review_scheduler.ts — Auto Daily Review Scheduler
 *
 * Generates daily reviews for all watchlist symbols at end of day.
 * Runs on a configurable timer interval and tracks execution history.
 *
 * Exports:
 *   - startDailyReviewScheduler(intervalMs): void
 *   - stopDailyReviewScheduler(): void
 *   - isSchedulerRunning(): boolean
 *   - getSchedulerHistory(): { running: boolean; lastRunDate: string | null; history: SchedulerRun[] }
 *   - runDailyReviews(date?): Promise<DailyReview[]>
 *   - resetScheduler(): void
 */

import {
  generateDailyReview,
  saveDailyReview,
  type DailyReview,
} from "./daily_review_engine.js";

/**
 * Scheduler run history entry
 */
export interface SchedulerRun {
  date: string;
  symbols: number;
  reviews: number;
  errors: string[];
}

let schedulerInterval: ReturnType<typeof setInterval> | null = null;
let lastRunDate: string | null = null;
const runHistory: SchedulerRun[] = [];

/**
 * Start the daily review scheduler
 * Runs every intervalMs milliseconds, checking if it's a new day
 * Default: every hour (3600_000ms)
 */
export function startDailyReviewScheduler(intervalMs: number = 3600_000): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== lastRunDate) {
      runDailyReviews(today).catch(() => {});
    }
  }, intervalMs);
}

/**
 * Stop the daily review scheduler
 */
export function stopDailyReviewScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

/**
 * Check if scheduler is currently running
 */
export function isSchedulerRunning(): boolean {
  return schedulerInterval !== null;
}

/**
 * Get scheduler history and status
 */
export function getSchedulerHistory() {
  return {
    running: isSchedulerRunning(),
    lastRunDate,
    history: runHistory.slice(-30), // Last 30 runs
  };
}

/**
 * Run daily reviews for all watchlist symbols
 * Can be called manually or by the scheduler
 */
export async function runDailyReviews(date?: string): Promise<DailyReview[]> {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const errors: string[] = [];
  const reviews: DailyReview[] = [];

  // Get watchlist symbols
  let symbols: string[] = ["BTCUSD", "ETHUSD", "SPY", "QQQ"];
  try {
    const { listWatchlist } = await import("../lib/watchlist.js");
    const wl = listWatchlist();
    if (Array.isArray(wl) && wl.length > 0) {
      symbols = wl
        .filter((s: any) => s.enabled !== false)
        .map((s: any) => s.symbol || s)
        .filter((s: any) => typeof s === "string");
    }
  } catch {
    /* use defaults */
  }

  // Generate reviews for each symbol
  for (const symbol of symbols) {
    try {
      const review = generateDailyReview(symbol, targetDate, [], [], {
        htfBias: "ranging",
        keyLevels: [],
        orderBlocksActive: 0,
        abcdPatternsActive: 0,
      });
      saveDailyReview(review);
      reviews.push(review);
    } catch (err: any) {
      errors.push(`${symbol}: ${err.message}`);
    }
  }

  // Track run
  lastRunDate = targetDate;
  runHistory.push({
    date: targetDate,
    symbols: symbols.length,
    reviews: reviews.length,
    errors,
  });

  // Keep last 50 runs in memory
  if (runHistory.length > 50) {
    runHistory.shift();
  }

  return reviews;
}

/**
 * Reset scheduler state
 */
export function resetScheduler(): void {
  stopDailyReviewScheduler();
  lastRunDate = null;
  runHistory.length = 0;
}
