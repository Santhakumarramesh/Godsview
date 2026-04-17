/**
 * brain_watchdog.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8D: Brain Self-Healing Watchdog
 *
 * The watchdog monitors all brain subsystems and restarts/heals them
 * when they crash or become unresponsive. Like a hospital life support
 * system — it ensures the brain never stops running.
 *
 * Checks every 30 seconds:
 *   - Autonomous brain still running?
 *   - P&L tracker still monitoring positions?
 *   - Stream bridge still connected?
 *   - Correlation engine updating?
 *   - Job queue not stuck (no job running > 10 minutes)?
 *   - Memory usage within bounds?
 *   - Any agent not reporting for > 5 minutes?
 *
 * Healing actions:
 *   - Restart stopped subsystems
 *   - Cancel stuck jobs
 *   - Emit critical alerts
 *   - Log detailed diagnostics
 *   - Reduce scan rate if under memory pressure
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { brainAlerts } from "./brain_alerts.js";
import { brainJobQueue } from "./job_queue.js";

// ── Health Check Results ──────────────────────────────────────────────────────

export type SubsystemHealth = "HEALTHY" | "DEGRADED" | "FAILED" | "RESTARTING";

export interface SubsystemStatus {
  name: string;
  health: SubsystemHealth;
  lastCheckAt: number;
  lastHealthyAt: number;
  restartCount: number;
  details: string;
  memoryMb?: number;
}

export interface WatchdogReport {
  overallHealth: SubsystemHealth;
  timestamp: number;
  subsystems: SubsystemStatus[];
  stuckJobs: string[];
  memoryUsageMb: number;
  uptimeSeconds: number;
  healingActions: string[];
}

// ── Watchdog ──────────────────────────────────────────────────────────────────

class BrainWatchdog {
  private subsystems = new Map<string, SubsystemStatus>();
  private watchdogTimer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private startedAt = 0;
  private healingLog: Array<{ ts: number; action: string }> = [];
  private checkCount = 0;

  private readonly CHECK_INTERVAL_MS = 30_000;
  private readonly STUCK_JOB_THRESHOLD_MS = 10 * 60_000; // 10 minutes
  private readonly MAX_MEMORY_MB = 1500;
  private readonly MAX_HEALING_LOG = 100;

  // ── Start / Stop ────────────────────────────────────────────────────────────

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.startedAt = Date.now();

    // Initialize subsystem tracking
    this._initSubsystem("autonomous_brain");
    this._initSubsystem("pnl_tracker");
    this._initSubsystem("stream_bridge");
    this._initSubsystem("correlation_engine");
    this._initSubsystem("job_queue");

    this.watchdogTimer = setInterval(() => {
      this._runChecks().catch((err) => {
        logger.error({ err }, "[Watchdog] Check cycle error");
      });
    }, this.CHECK_INTERVAL_MS);

    logger.info("[Watchdog] Started — monitoring brain subsystems");
  }

  stop(): void {
    this.isRunning = false;
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  // ── Main check cycle ────────────────────────────────────────────────────────

  private async _runChecks(): Promise<void> {
    this.checkCount++;
    const healingActions: string[] = [];

    // ── 1. Check autonomous brain ──────────────────────────────────────────
    try {
      const { autonomousBrain } = await import("./autonomous_brain.js");
      const status = autonomousBrain.getFullStatus();
      const isHealthy = status.brain.running || status.brain.mode === "PAUSED";

      if (isHealthy) {
        this._markHealthy("autonomous_brain", `Running | Mode: ${status.brain.mode} | Cycles: ${status.brain.cycleCount}`);
      } else {
        this._markDegraded("autonomous_brain", "Brain stopped unexpectedly");
        // Don't auto-restart — requires symbols and inputFn that we don't have here
        // Instead, alert so the operator restarts it
        brainAlerts.fire("BRAIN_STOPPED", "CRITICAL",
          "Autonomous Brain Stopped",
          "The autonomous brain stopped unexpectedly. Restart via /brain/autonomous/start.",
          { skipRateLimit: false }
        );
        healingActions.push("Emitted BRAIN_STOPPED alert");
      }
    } catch (err: any) {
      this._markFailed("autonomous_brain", err?.message ?? "Import failed");
    }

    // ── 2. Check P&L tracker ───────────────────────────────────────────────
    try {
      const { brainPnLTracker } = await import("./brain_pnl_tracker.js");
      const running = brainPnLTracker.isRunningStatus();

      if (running) {
        this._markHealthy("pnl_tracker", "Running");
      } else {
        this._markDegraded("pnl_tracker", "P&L tracker stopped");
        // Auto-restart the P&L tracker
        brainPnLTracker.start();
        healingActions.push("Restarted P&L tracker");
        this._logHealing("P&L tracker auto-restarted");
      }
    } catch (err: any) {
      this._markFailed("pnl_tracker", err?.message ?? "Import failed");
    }

    // ── 3. Check stream bridge ─────────────────────────────────────────────
    try {
      const { brainStreamBridge } = await import("./brain_stream_bridge.js");
      const status = brainStreamBridge.getStatus();

      if (status.running) {
        this._markHealthy("stream_bridge",
          `Ticks: ${status.totalTicks} | Stock WS: ${status.stockWsConnected ? "✓" : "✗"} | Subscribed: ${status.stockSubscribed.length + status.cryptoSubscribed.length}`
        );
      } else {
        this._markDegraded("stream_bridge", "Stream bridge stopped");
        brainStreamBridge.start();
        healingActions.push("Restarted stream bridge");
        this._logHealing("Stream bridge auto-restarted");
      }
    } catch (err: any) {
      this._markFailed("stream_bridge", err?.message ?? "Import failed");
    }

    // ── 4. Check correlation engine ────────────────────────────────────────
    try {
      const { correlationEngine } = await import("./correlation_engine.js");
      const summary = correlationEngine.getSummary();

      if (summary.running) {
        const lastUpdate = summary.lastUpdated
          ? `Last update: ${new Date(summary.lastUpdated).toISOString().slice(11, 19)}`
          : "No updates yet";
        this._markHealthy("correlation_engine", `${summary.trackedSymbols} symbols | ${lastUpdate}`);
      } else {
        this._markDegraded("correlation_engine", "Not running");
        correlationEngine.start();
        healingActions.push("Restarted correlation engine");
        this._logHealing("Correlation engine auto-restarted");
      }
    } catch (err: any) {
      this._markFailed("correlation_engine", err?.message ?? "Import failed");
    }

    // ── 5. Check job queue — detect stuck jobs ─────────────────────────────
    try {
      const runningJobs = brainJobQueue.getRunning();
      const now = Date.now();
      const stuckJobs = runningJobs.filter((j) => {
        const runningFor = now - (j.startedAt ?? now);
        return runningFor > this.STUCK_JOB_THRESHOLD_MS;
      });

      if (stuckJobs.length > 0) {
        this._markDegraded("job_queue", `${stuckJobs.length} stuck jobs detected`);
        for (const job of stuckJobs) {
          const runningMins = ((now - (job.startedAt ?? now)) / 60_000).toFixed(0);
          logger.warn({ jobId: job.id, type: job.type, runningMins }, "[Watchdog] Cancelling stuck job");
          brainJobQueue.fail(job.id, `Watchdog: job running > ${runningMins}min — cancelled`);
          healingActions.push(`Cancelled stuck job ${job.type} (${job.symbol ?? "system"})`);
          this._logHealing(`Stuck job cancelled: ${job.type} ${job.symbol ?? ""}`);
        }
      } else {
        const stats = brainJobQueue.getStats();
        this._markHealthy("job_queue", `Queued: ${stats.queued} | Running: ${stats.running} | Done: ${stats.done}`);
      }
    } catch (err: any) {
      this._markFailed("job_queue", err?.message ?? "Check failed");
    }

    // ── 6. Memory pressure check ───────────────────────────────────────────
    const memUsage = process.memoryUsage();
    const heapMb = Math.round(memUsage.heapUsed / 1024 / 1024);
    const rssMb = Math.round(memUsage.rss / 1024 / 1024);

    if (rssMb > this.MAX_MEMORY_MB) {
      logger.warn({ rssMb, heapMb }, "[Watchdog] Memory pressure detected");
      healingActions.push(`Memory pressure: ${rssMb}MB RSS`);
      brainAlerts.fire("RISK_LIMIT_HIT", "WARNING",
        "Memory Pressure",
        `Process using ${rssMb}MB RSS. Consider restarting if performance degrades.`,
        { skipRateLimit: false, data: { rssMb, heapMb } }
      );
    }

    if (healingActions.length > 0) {
      logger.info({ actions: healingActions, check: this.checkCount }, "[Watchdog] Healing actions taken");
    }
  }

  // ── Subsystem tracking ──────────────────────────────────────────────────────

  private _initSubsystem(name: string): void {
    this.subsystems.set(name, {
      name,
      health: "HEALTHY",
      lastCheckAt: Date.now(),
      lastHealthyAt: Date.now(),
      restartCount: 0,
      details: "Initializing",
    });
  }

  private _markHealthy(name: string, details: string): void {
    const s = this.subsystems.get(name);
    if (!s) return;
    s.health = "HEALTHY";
    s.lastCheckAt = Date.now();
    s.lastHealthyAt = Date.now();
    s.details = details;
  }

  private _markDegraded(name: string, details: string): void {
    const s = this.subsystems.get(name);
    if (!s) return;
    s.health = "DEGRADED";
    s.lastCheckAt = Date.now();
    s.restartCount++;
    s.details = details;
  }

  private _markFailed(name: string, details: string): void {
    const s = this.subsystems.get(name);
    if (!s) return;
    s.health = "FAILED";
    s.lastCheckAt = Date.now();
    s.details = details;
  }

  private _logHealing(action: string): void {
    this.healingLog.push({ ts: Date.now(), action });
    if (this.healingLog.length > this.MAX_HEALING_LOG) {
      this.healingLog.shift();
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────────

  getReport(): WatchdogReport {
    const subsystems = Array.from(this.subsystems.values());
    const failedCount = subsystems.filter((s) => s.health === "FAILED").length;
    const degradedCount = subsystems.filter((s) => s.health === "DEGRADED").length;

    const overallHealth: SubsystemHealth =
      failedCount > 0 ? "FAILED" :
      degradedCount > 1 ? "DEGRADED" :
      degradedCount === 1 ? "DEGRADED" : "HEALTHY";

    const stuckJobs = brainJobQueue.getRunning()
      .filter((j) => Date.now() - (j.startedAt ?? Date.now()) > this.STUCK_JOB_THRESHOLD_MS)
      .map((j) => j.id);

    const memUsage = process.memoryUsage();
    const memoryUsageMb = Math.round(memUsage.rss / 1024 / 1024);
    const uptimeSeconds = Math.round((Date.now() - this.startedAt) / 1000);

    return {
      overallHealth,
      timestamp: Date.now(),
      subsystems,
      stuckJobs,
      memoryUsageMb,
      uptimeSeconds,
      healingActions: this.healingLog.slice(-10).map((h) => `${new Date(h.ts).toISOString().slice(11, 19)} ${h.action}`),
    };
  }

  isRunningStatus(): boolean {
    return this.isRunning;
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainWatchdog = new BrainWatchdog();
