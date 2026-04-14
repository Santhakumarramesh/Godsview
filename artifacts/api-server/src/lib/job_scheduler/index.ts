/**
 * job_scheduler/index.ts — Phase 80: Job Scheduler + Background Tasks
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. JobQueue        — priority + delayed job queue with locks.
 *   2. JobWorker       — pull-based worker loop, dispatches handlers.
 *   3. CronScheduler   — cron-style scheduling for recurring jobs.
 *   4. JobMetrics      — per-handler stats (success/failure/duration).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Jobs ───────────────────────────────────────────────────────────────────

export type JobStatus = "pending" | "scheduled" | "running" | "succeeded" | "failed" | "dead_letter";
export type JobPriority = "low" | "normal" | "high" | "urgent";

export interface Job {
  id: string;
  handler: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: JobPriority;
  enqueuedAt: number;
  runAfter: number;
  startedAt?: number;
  finishedAt?: number;
  attempts: number;
  maxAttempts: number;
  lockedBy?: string;
  lockedUntil?: number;
  result?: unknown;
  error?: string;
}

export interface EnqueueParams {
  handler: string;
  payload?: Record<string, unknown>;
  priority?: JobPriority;
  delayMs?: number;
  maxAttempts?: number;
}

export class JobQueue {
  private readonly jobs = new Map<string, Job>();

  enqueue(params: EnqueueParams): Job {
    const id = `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const runAfter = now + (params.delayMs ?? 0);
    const job: Job = {
      id,
      handler: params.handler,
      payload: params.payload ?? {},
      status: params.delayMs ? "scheduled" : "pending",
      priority: params.priority ?? "normal",
      enqueuedAt: now,
      runAfter,
      attempts: 0,
      maxAttempts: params.maxAttempts ?? 3,
    };
    this.jobs.set(id, job);
    return job;
  }

  pick(workerId: string, lockMs = 60_000): Job | null {
    const now = Date.now();
    const order: JobPriority[] = ["urgent", "high", "normal", "low"];
    for (const p of order) {
      const candidates = Array.from(this.jobs.values())
        .filter((j) => j.priority === p)
        .filter((j) => (j.status === "pending" || j.status === "scheduled") && j.runAfter <= now)
        .filter((j) => !j.lockedUntil || j.lockedUntil < now)
        .sort((a, b) => a.enqueuedAt - b.enqueuedAt);
      if (candidates.length > 0) {
        const job = candidates[0]!;
        job.status = "running";
        job.attempts++;
        job.startedAt = now;
        job.lockedBy = workerId;
        job.lockedUntil = now + lockMs;
        return job;
      }
    }
    return null;
  }

  succeed(id: string, result: unknown): Job | null {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.status = "succeeded";
    j.result = result;
    j.finishedAt = Date.now();
    j.lockedBy = undefined;
    j.lockedUntil = undefined;
    return j;
  }

  fail(id: string, error: string): Job | null {
    const j = this.jobs.get(id);
    if (!j) return null;
    j.error = error;
    j.lockedBy = undefined;
    j.lockedUntil = undefined;
    if (j.attempts >= j.maxAttempts) {
      j.status = "dead_letter";
      j.finishedAt = Date.now();
    } else {
      j.status = "pending";
      j.runAfter = Date.now() + Math.min(60_000, 2 ** j.attempts * 1000);
    }
    return j;
  }

  list(filter?: { status?: JobStatus; handler?: string }): Job[] {
    let out = Array.from(this.jobs.values());
    if (filter?.status) out = out.filter((j) => j.status === filter.status);
    if (filter?.handler) out = out.filter((j) => j.handler === filter.handler);
    return out.sort((a, b) => b.enqueuedAt - a.enqueuedAt);
  }

  get(id: string): Job | null {
    return this.jobs.get(id) ?? null;
  }

  retryDeadLetter(id: string): Job | null {
    const j = this.jobs.get(id);
    if (!j || j.status !== "dead_letter") return null;
    j.status = "pending";
    j.attempts = 0;
    j.runAfter = Date.now();
    j.error = undefined;
    return j;
  }

  stats(): { pending: number; scheduled: number; running: number; succeeded: number; failed: number; dead_letter: number } {
    const out = { pending: 0, scheduled: 0, running: 0, succeeded: 0, failed: 0, dead_letter: 0 };
    for (const j of this.jobs.values()) out[j.status]++;
    return out;
  }
}

// ── Worker ────────────────────────────────────────────────────────────────

export type JobHandlerFn = (job: Job) => Promise<unknown>;

export class JobWorker {
  private readonly handlers = new Map<string, JobHandlerFn>();

  constructor(
    private readonly queue: JobQueue,
    private readonly metrics: JobMetrics,
  ) {}

  register(handler: string, fn: JobHandlerFn): void {
    this.handlers.set(handler, fn);
  }

  async pickAndRun(workerId: string): Promise<{ job: Job | null; outcome: "success" | "failure" | "no_job" }> {
    const job = this.queue.pick(workerId);
    if (!job) return { job: null, outcome: "no_job" };
    const fn = this.handlers.get(job.handler);
    if (!fn) {
      this.queue.fail(job.id, `no handler registered for ${job.handler}`);
      this.metrics.record(job.handler, "failure", 0);
      return { job, outcome: "failure" };
    }
    const start = Date.now();
    try {
      const result = await fn(job);
      const dur = Date.now() - start;
      this.queue.succeed(job.id, result);
      this.metrics.record(job.handler, "success", dur);
      return { job: this.queue.get(job.id), outcome: "success" };
    } catch (err) {
      const dur = Date.now() - start;
      this.queue.fail(job.id, String((err as Error).message ?? err));
      this.metrics.record(job.handler, "failure", dur);
      logger.error({ jobId: job.id, err }, "[JobWorker] Handler failed");
      return { job: this.queue.get(job.id), outcome: "failure" };
    }
  }

  registeredHandlers(): string[] {
    return Array.from(this.handlers.keys());
  }
}

// ── Cron Scheduler ────────────────────────────────────────────────────────

export interface CronSchedule {
  id: string;
  cron: string;       // 5-field cron expression
  handler: string;
  payload: Record<string, unknown>;
  priority: JobPriority;
  enabled: boolean;
  lastFiredAt?: number;
  createdAt: number;
}

export class CronScheduler {
  private readonly schedules = new Map<string, CronSchedule>();

  constructor(private readonly queue: JobQueue) {}

  schedule(params: { cron: string; handler: string; payload?: Record<string, unknown>; priority?: JobPriority }): CronSchedule {
    const id = `crn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const schedule: CronSchedule = {
      id,
      cron: params.cron,
      handler: params.handler,
      payload: params.payload ?? {},
      priority: params.priority ?? "normal",
      enabled: true,
      createdAt: Date.now(),
    };
    this.schedules.set(id, schedule);
    return schedule;
  }

  list(): CronSchedule[] {
    return Array.from(this.schedules.values());
  }

  setEnabled(id: string, enabled: boolean): CronSchedule | null {
    const s = this.schedules.get(id);
    if (!s) return null;
    s.enabled = enabled;
    return s;
  }

  delete(id: string): boolean {
    return this.schedules.delete(id);
  }

  // tick(): evaluate all schedules and enqueue jobs for those that match the current minute.
  tick(at: Date = new Date()): Job[] {
    const fired: Job[] = [];
    for (const s of this.schedules.values()) {
      if (!s.enabled) continue;
      // Avoid double-firing within the same minute
      if (s.lastFiredAt && Math.floor(s.lastFiredAt / 60_000) === Math.floor(at.getTime() / 60_000)) continue;
      if (this._matches(s.cron, at)) {
        const job = this.queue.enqueue({ handler: s.handler, payload: s.payload, priority: s.priority });
        fired.push(job);
        s.lastFiredAt = at.getTime();
      }
    }
    return fired;
  }

  private _matches(cron: string, at: Date): boolean {
    const fields = cron.trim().split(/\s+/);
    if (fields.length !== 5) return false;
    return (
      this._matchField(fields[0]!, at.getMinutes()) &&
      this._matchField(fields[1]!, at.getHours()) &&
      this._matchField(fields[2]!, at.getDate()) &&
      this._matchField(fields[3]!, at.getMonth() + 1) &&
      this._matchField(fields[4]!, at.getDay())
    );
  }

  private _matchField(field: string, value: number): boolean {
    if (field === "*") return true;
    for (const part of field.split(",")) {
      if (part.includes("/")) {
        const [base, stepStr] = part.split("/");
        const step = parseInt(stepStr ?? "1", 10);
        if (base === "*" && value % step === 0) return true;
      } else if (part.includes("-")) {
        const [a, b] = part.split("-").map(Number);
        if (a !== undefined && b !== undefined && value >= a && value <= b) return true;
      } else if (Number(part) === value) return true;
    }
    return false;
  }
}

// ── Metrics ───────────────────────────────────────────────────────────────

export interface JobHandlerStats {
  handler: string;
  success: number;
  failure: number;
  totalDurationMs: number;
  avgDurationMs: number;
  lastRunAt?: number;
}

export class JobMetrics {
  private readonly stats = new Map<string, JobHandlerStats>();

  record(handler: string, outcome: "success" | "failure", durationMs: number): void {
    let s = this.stats.get(handler);
    if (!s) {
      s = { handler, success: 0, failure: 0, totalDurationMs: 0, avgDurationMs: 0 };
      this.stats.set(handler, s);
    }
    if (outcome === "success") s.success++;
    else s.failure++;
    s.totalDurationMs += durationMs;
    const total = s.success + s.failure;
    s.avgDurationMs = total > 0 ? s.totalDurationMs / total : 0;
    s.lastRunAt = Date.now();
  }

  list(): JobHandlerStats[] {
    return Array.from(this.stats.values()).sort((a, b) => (b.lastRunAt ?? 0) - (a.lastRunAt ?? 0));
  }

  get(handler: string): JobHandlerStats | null {
    return this.stats.get(handler) ?? null;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const jobQueue = new JobQueue();
export const jobMetrics = new JobMetrics();
export const jobWorker = new JobWorker(jobQueue, jobMetrics);
export const cronScheduler = new CronScheduler(jobQueue);

// Built-in handler so a basic /api/jobs/run flow works out of the box
jobWorker.register("noop", async () => ({ ok: true }));

logger.info("[JobScheduler] Module initialized");
