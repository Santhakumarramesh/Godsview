/**
 * job_queue.ts — GodsView Brain Job Scheduler
 *
 * The Brain acts like a senior portfolio manager who distributes work
 * across a team of specialist analysts. Each analyst (agent) gets typed
 * jobs with full context — not vague orders, but precise specs.
 *
 * Job lifecycle:
 *   Brain creates job → queued → agent picks it up → running →
 *   done/failed → result stored → Brain reads result → creates follow-up jobs
 *
 * Job types:
 *   SCAN_SYMBOL       — L1-L6 real-time cycle for one symbol
 *   BACKTEST          — L7 walk-forward backtest for a symbol
 *   CHART_SNAPSHOT    — L8 annotated chart generation
 *   EVOLVE_STRATEGY   — adapt strategy parameters from backtest feedback
 *   RETRAIN_ML        — update the ML model weights from new outcomes
 *   ANALYZE_REGIME    — deep regime analysis (cross-symbol)
 *   MONITOR_POSITION  — watch an open position for exit signals
 *   BUILD_RULEBOOK    — synthesize empirical rules from multiple backtests
 *   RANK_SYMBOLS      — score and rank all tracked symbols for opportunity
 *
 * Priority:
 *   CRITICAL (0) — open position risk, circuit breaker, stop hit
 *   HIGH (1)     — strong signal confirmed, entry opportunity
 *   NORMAL (2)   — scheduled backtest, routine scan
 *   LOW (3)      — maintenance, ML retraining, rulebook rebuild
 *   BACKGROUND (4) — chart generation, evolution analysis
 */

import { brainEventBus } from "./brain_event_bus";
import { saveJobHistory } from "./brain_persistence.js";

// ── Job Types ──────────────────────────────────────────────────────────────

export type JobType =
  | "SCAN_SYMBOL"
  | "BACKTEST"
  | "CHART_SNAPSHOT"
  | "EVOLVE_STRATEGY"
  | "RETRAIN_ML"
  | "ANALYZE_REGIME"
  | "MONITOR_POSITION"
  | "BUILD_RULEBOOK"
  | "RANK_SYMBOLS";

export type JobPriority = 0 | 1 | 2 | 3 | 4; // 0=CRITICAL, 4=BACKGROUND

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export const JOB_PRIORITY_LABELS: Record<JobPriority, string> = {
  0: "CRITICAL",
  1: "HIGH",
  2: "NORMAL",
  3: "LOW",
  4: "BACKGROUND",
};

// ── Job Payload Shapes ─────────────────────────────────────────────────────

export interface ScanSymbolPayload   { symbol: string; reason: string }
export interface BacktestPayload     { symbol: string; lookbackBars: number; strategy?: string }
export interface ChartSnapshotPayload { symbol: string; confirmationIds: string[] }
export interface EvolveStrategyPayload { symbol: string; strategy: string; backtestMetrics: Record<string, number> }
export interface RetrainMLPayload    { symbol?: string; newOutcomes: number; triggerReason: string }
export interface AnalyzeRegimePayload { symbols: string[]; depth: "quick" | "deep" }
export interface MonitorPositionPayload { symbol: string; direction: "long" | "short"; entryPrice: number; stopLoss: number; takeProfit: number; openedAt: string }
export interface BuildRulebookPayload { symbols: string[]; minSampleSize: number }
export interface RankSymbolsPayload  { symbols: string[]; sortBy: "score" | "sharpe" | "winRate" }

export type JobPayload =
  | ScanSymbolPayload
  | BacktestPayload
  | ChartSnapshotPayload
  | EvolveStrategyPayload
  | RetrainMLPayload
  | AnalyzeRegimePayload
  | MonitorPositionPayload
  | BuildRulebookPayload
  | RankSymbolsPayload;

// ── Job Record ────────────────────────────────────────────────────────────

let _jobSeq = 0;

export interface BrainJob {
  id: string;
  type: JobType;
  priority: JobPriority;
  status: JobStatus;

  /** Symbol this job concerns (if any) */
  symbol?: string;
  /** Human-readable reason the brain created this job */
  reason: string;
  /** Full typed payload for the assigned agent */
  payload: JobPayload;

  /** Who created this job */
  createdBy: "brain" | "scheduler" | "user" | "feedback_loop";
  /** Which agent is running it */
  assignedTo?: string;

  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  /** Retry count */
  attempts: number;
  maxAttempts: number;

  /** Result from the agent */
  result?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;

  /** Optional: follow-up jobs to create when this one finishes */
  followUpJobs?: Array<{
    type: JobType;
    priority: JobPriority;
    reason: string;
    payload: Partial<JobPayload>;
  }>;
}

function makeJobId(type: JobType): string {
  _jobSeq++;
  return `${type.toLowerCase().slice(0, 3)}_${Date.now()}_${_jobSeq}`;
}

// ── Queue ─────────────────────────────────────────────────────────────────

class BrainJobQueue {
  private queue: BrainJob[] = [];
  private completed: BrainJob[] = [];
  private maxCompleted = 500;
  private listeners = new Map<string, Set<(job: BrainJob) => void>>();

  // ── Enqueue ───────────────────────────────────────────────────────────────

  enqueue(
    type: JobType,
    payload: JobPayload,
    options: {
      priority?: JobPriority;
      symbol?: string;
      reason?: string;
      createdBy?: BrainJob["createdBy"];
      followUpJobs?: BrainJob["followUpJobs"];
      maxAttempts?: number;
    } = {},
  ): BrainJob {
    const job: BrainJob = {
      id: makeJobId(type),
      type,
      priority: options.priority ?? 2,
      status: "queued",
      symbol: options.symbol,
      reason: options.reason ?? `${type} requested`,
      payload,
      createdBy: options.createdBy ?? "brain",
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: options.maxAttempts ?? 3,
      followUpJobs: options.followUpJobs,
    };

    // Dedup: skip if same type + symbol is already queued or running
    if (options.symbol) {
      const exists = this.queue.find(
        (j) => j.type === type && j.symbol === options.symbol && (j.status === "queued" || j.status === "running"),
      );
      if (exists) {
        // Upgrade priority if new request is more urgent
        if (job.priority < exists.priority) {
          exists.priority = job.priority;
          exists.reason = job.reason;
          this._sortQueue();
        }
        return exists;
      }
    }

    this.queue.push(job);
    this._sortQueue();
    this._emit("enqueued", job);
    return job;
  }

  /**
   * Enqueue a batch of jobs (e.g. scan all symbols).
   * Deduplication still applies.
   */
  enqueueBatch(
    jobs: Array<Parameters<BrainJobQueue["enqueue"]>>,
  ): BrainJob[] {
    return jobs.map((args) => this.enqueue(...args));
  }

  // ── Claim ─────────────────────────────────────────────────────────────────

  /** Agent claims the next available job (highest priority first) */
  claim(agentId: string, types?: JobType[]): BrainJob | null {
    const eligible = this.queue.filter(
      (j) => j.status === "queued" && (!types || types.includes(j.type)),
    );
    if (eligible.length === 0) return null;

    const job = eligible[0]; // already sorted by priority
    job.status = "running";
    job.assignedTo = agentId;
    job.startedAt = Date.now();
    job.attempts++;
    this._emit("claimed", job);
    return job;
  }

  // ── Complete / Fail ───────────────────────────────────────────────────────

  complete(jobId: string, result: Record<string, unknown>): void {
    const job = this._findActive(jobId);
    if (!job) return;

    job.status = "done";
    job.result = result;
    job.finishedAt = Date.now();

    this._moveToCompleted(job);
    this._emit("completed", job);

    // Persist to DB (fire-and-forget). JobHistoryRow has an open index
    // signature so extra job_* columns are fine, but `id`, `type`,
    // `status` are required.
    saveJobHistory({
      id: job.id,
      type: job.type,
      status: "completed",
      job_id: job.id,
      job_type: job.type,
      symbol: job.symbol,
      priority: job.priority,
      payload: JSON.stringify(job.payload),
      result: JSON.stringify(result),
      queued_at: new Date(job.createdAt).toISOString(),
      started_at: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
      completed_at: new Date(job.finishedAt).toISOString(),
      latencyMs: job.finishedAt - (job.startedAt ?? job.createdAt),
    }).catch(() => {/* logged */});

    // Auto-create follow-up jobs
    if (job.followUpJobs) {
      for (const fu of job.followUpJobs) {
        this.enqueue(
          fu.type,
          { ...fu.payload, symbol: job.symbol } as JobPayload,
          { priority: fu.priority, symbol: job.symbol, reason: fu.reason, createdBy: "feedback_loop" },
        );
      }
    }

    // Emit brain event
    brainEventBus.agentReport({
      agentId: "brain",
      symbol: job.symbol ?? "system",
      status: "done",
      confidence: 1,
      score: 1,
      verdict: `Job ${job.type} completed in ${((job.finishedAt - (job.startedAt ?? job.finishedAt)) / 1000).toFixed(1)}s`,
      data: { jobId: job.id, type: job.type, symbol: job.symbol, result },
      flags: [],
      timestamp: Date.now(),
      latencyMs: job.finishedAt - (job.startedAt ?? job.createdAt),
    });
  }

  fail(jobId: string, error: string): void {
    const job = this._findActive(jobId);
    if (!job) return;

    job.error = error;

    if (job.attempts < job.maxAttempts) {
      // Retry
      job.status = "queued";
      job.assignedTo = undefined;
      job.startedAt = undefined;
      this._emit("retrying", job);
    } else {
      job.status = "failed";
      job.finishedAt = Date.now();
      this._moveToCompleted(job);
      this._emit("failed", job);

      // Persist failure to DB
      saveJobHistory({
        id: job.id,
        type: job.type,
        status: "failed",
        job_id: job.id,
        job_type: job.type,
        symbol: job.symbol,
        priority: job.priority,
        payload: JSON.stringify(job.payload),
        error,
        queued_at: new Date(job.createdAt).toISOString(),
        started_at: job.startedAt ? new Date(job.startedAt).toISOString() : undefined,
        completed_at: new Date(job.finishedAt).toISOString(),
        latencyMs: job.finishedAt - (job.startedAt ?? job.createdAt),
      }).catch(() => {/* logged */});
    }
  }

  cancel(jobId: string): void {
    const idx = this.queue.findIndex((j) => j.id === jobId);
    if (idx !== -1) {
      this.queue[idx].status = "cancelled";
      this.queue[idx].finishedAt = Date.now();
      this._moveToCompleted(this.queue[idx]);
      this.queue.splice(idx, 1);
    }
  }

  // ── Inspection ────────────────────────────────────────────────────────────

  getQueue(): BrainJob[] {
    return [...this.queue];
  }

  getCompleted(limit = 50): BrainJob[] {
    return this.completed.slice(-limit);
  }

  getRunning(): BrainJob[] {
    return this.queue.filter((j) => j.status === "running");
  }

  getQueuedCount(): number {
    return this.queue.filter((j) => j.status === "queued").length;
  }

  getStats(): {
    queued: number;
    running: number;
    done: number;
    failed: number;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
  } {
    const all = [...this.queue, ...this.completed];
    const byPriority: Record<string, number> = {};
    const byType: Record<string, number> = {};

    for (const j of this.queue) {
      const pl = JOB_PRIORITY_LABELS[j.priority];
      byPriority[pl] = (byPriority[pl] ?? 0) + 1;
      byType[j.type] = (byType[j.type] ?? 0) + 1;
    }

    return {
      queued: this.queue.filter((j) => j.status === "queued").length,
      running: this.queue.filter((j) => j.status === "running").length,
      done: this.completed.filter((j) => j.status === "done").length,
      failed: this.completed.filter((j) => j.status === "failed").length,
      byPriority,
      byType,
    };
  }

  // ── Subscription ──────────────────────────────────────────────────────────

  on(event: string, listener: (job: BrainJob) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return () => this.listeners.get(event)?.delete(listener);
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _sortQueue(): void {
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });
  }

  private _findActive(jobId: string): BrainJob | undefined {
    return this.queue.find((j) => j.id === jobId);
  }

  private _moveToCompleted(job: BrainJob): void {
    const idx = this.queue.indexOf(job);
    if (idx !== -1) this.queue.splice(idx, 1);
    this.completed.push(job);
    if (this.completed.length > this.maxCompleted) {
      this.completed = this.completed.slice(-this.maxCompleted);
    }
  }

  private _emit(event: string, job: BrainJob): void {
    this.listeners.get(event)?.forEach((fn) => {
      try { fn(job); } catch {}
    });
    this.listeners.get("*")?.forEach((fn) => {
      try { fn(job); } catch {}
    });
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────

export const brainJobQueue = new BrainJobQueue();

// ── Brain Job Factory ─────────────────────────────────────────────────────
// Convenience functions — the Brain calls these to create jobs

export const BrainJobs = {

  scanSymbol(symbol: string, reason = "scheduled scan", priority: JobPriority = 2): BrainJob {
    return brainJobQueue.enqueue(
      "SCAN_SYMBOL",
      { symbol, reason } satisfies ScanSymbolPayload,
      { symbol, reason, priority, createdBy: "brain" },
    );
  },

  backtest(symbol: string, lookbackBars = 2000, reason = "strategy validation", priority: JobPriority = 3): BrainJob {
    return brainJobQueue.enqueue(
      "BACKTEST",
      { symbol, lookbackBars } satisfies BacktestPayload,
      {
        symbol, reason, priority, createdBy: "brain",
        followUpJobs: [
          { type: "CHART_SNAPSHOT", priority: 4, reason: "chart top setups from backtest", payload: {} },
          { type: "EVOLVE_STRATEGY", priority: 3, reason: "adapt parameters from backtest", payload: { strategy: "smc_ob_fvg", backtestMetrics: {} } },
        ],
      },
    );
  },

  chartSnapshot(symbol: string, confirmationIds: string[], reason = "document setup", priority: JobPriority = 4): BrainJob {
    return brainJobQueue.enqueue(
      "CHART_SNAPSHOT",
      { symbol, confirmationIds } satisfies ChartSnapshotPayload,
      { symbol, reason, priority, createdBy: "brain" },
    );
  },

  evolveStrategy(symbol: string, strategy: string, metrics: Record<string, number>, reason = "feedback adaptation"): BrainJob {
    return brainJobQueue.enqueue(
      "EVOLVE_STRATEGY",
      { symbol, strategy, backtestMetrics: metrics } satisfies EvolveStrategyPayload,
      { symbol, reason, priority: 3, createdBy: "feedback_loop" },
    );
  },

  retrainML(triggerReason: string, newOutcomes: number, symbol?: string): BrainJob {
    return brainJobQueue.enqueue(
      "RETRAIN_ML",
      { symbol, newOutcomes, triggerReason } satisfies RetrainMLPayload,
      { symbol, reason: triggerReason, priority: 3, createdBy: "feedback_loop" },
    );
  },

  analyzeRegime(symbols: string[], depth: "quick" | "deep" = "quick", priority: JobPriority = 2): BrainJob {
    return brainJobQueue.enqueue(
      "ANALYZE_REGIME",
      { symbols, depth } satisfies AnalyzeRegimePayload,
      { reason: `Regime analysis (${depth})`, priority, createdBy: "brain" },
    );
  },

  monitorPosition(
    symbol: string, direction: "long" | "short",
    entryPrice: number, stopLoss: number, takeProfit: number,
    openedAt: string,
  ): BrainJob {
    return brainJobQueue.enqueue(
      "MONITOR_POSITION",
      { symbol, direction, entryPrice, stopLoss, takeProfit, openedAt } satisfies MonitorPositionPayload,
      { symbol, reason: `Monitor ${direction} position on ${symbol}`, priority: 1, createdBy: "brain", maxAttempts: 999 },
    );
  },

  buildRulebook(symbols: string[], minSampleSize = 20, reason = "rulebook synthesis"): BrainJob {
    return brainJobQueue.enqueue(
      "BUILD_RULEBOOK",
      { symbols, minSampleSize } satisfies BuildRulebookPayload,
      { reason, priority: 3, createdBy: "brain" },
    );
  },

  rankSymbols(symbols: string[], sortBy: "score" | "sharpe" | "winRate" = "score"): BrainJob {
    return brainJobQueue.enqueue(
      "RANK_SYMBOLS",
      { symbols, sortBy } satisfies RankSymbolsPayload,
      { reason: `Rank ${symbols.length} symbols by ${sortBy}`, priority: 2, createdBy: "brain" },
    );
  },
};

// ── Brain Job Dispatcher ──────────────────────────────────────────────────
// Executes jobs as they come off the queue using the full agent pipeline

export type JobDispatchHandler<T extends JobPayload = JobPayload> = (
  job: BrainJob & { payload: T }
) => Promise<Record<string, unknown>>;

const handlers = new Map<JobType, JobDispatchHandler<any>>();

export function registerJobHandler<T extends JobPayload>(
  type: JobType,
  handler: JobDispatchHandler<T>,
): void {
  handlers.set(type, handler as JobDispatchHandler<any>);
}

/** Run the next available job for a given set of types */
export async function dispatchNextJob(
  agentId: string,
  types?: JobType[],
): Promise<{ ran: boolean; jobId?: string; type?: string; latencyMs?: number }> {
  const job = brainJobQueue.claim(agentId, types);
  if (!job) return { ran: false };

  const handler = handlers.get(job.type);
  if (!handler) {
    brainJobQueue.fail(job.id, `No handler registered for ${job.type}`);
    return { ran: false };
  }

  const start = Date.now();
  try {
    const result = await handler(job as any);
    brainJobQueue.complete(job.id, result);
    return { ran: true, jobId: job.id, type: job.type, latencyMs: Date.now() - start };
  } catch (err) {
    brainJobQueue.fail(job.id, err instanceof Error ? err.message : String(err));
    return { ran: false, jobId: job.id };
  }
}

/** Run all available jobs matching the given types (up to maxBatch) */
export async function dispatchBatch(
  agentId: string,
  types?: JobType[],
  maxBatch = 5,
): Promise<number> {
  let ran = 0;
  while (ran < maxBatch) {
    const result = await dispatchNextJob(agentId, types);
    if (!result.ran) break;
    ran++;
  }
  return ran;
}
