/**
 * brain_health_telemetry.ts — Phase 12D
 *
 * Pipeline health telemetry for the Brain Intelligence System.
 *
 * Tracks per-layer latency (p50, p95, p99), error rates, throughput,
 * and overall pipeline health score. Used by the BrainHealthPanel in
 * the dashboard and the /brain/health/telemetry API route.
 *
 * Usage (in brain_layers.ts / brain_orchestrator.ts):
 *   import { telemetry } from "./brain_health_telemetry.js";
 *   const timer = telemetry.startLayer("L1_PERCEPTION");
 *   // ... run layer
 *   timer.end("success"); // or timer.end("error")
 *
 * The singleton is module-level so all imports share the same state.
 */

import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type LayerName =
  | "L1_PERCEPTION"
  | "L2_STRUCTURE"
  | "L2.5_MTF"
  | "L3_CONTEXT"
  | "L4_MEMORY"
  | "L5_INTELLIGENCE"
  | "L6_EVOLUTION"
  | "L7_BACKTEST"
  | "L8_CHART"
  | "EXECUTION_BRIDGE"
  | "CIRCUIT_BREAKER"
  | "RULEBOOK"
  | "SI_V2"
  | string;

export type LayerStatus = "success" | "error" | "timeout" | "skipped";

export interface LayerTelemetry {
  layer: LayerName;
  totalCalls: number;
  successCount: number;
  errorCount: number;
  timeoutCount: number;
  skippedCount: number;
  successRate: number;       // 0–1
  avgLatencyMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxLatencyMs: number;
  lastRunAt: string | null;
  lastStatus: LayerStatus | null;
  lastErrorMsg: string | null;
  recentLatencies: number[]; // last 100 latencies (circular)
}

export interface PipelineTelemetry {
  layers: LayerTelemetry[];
  totalCycles: number;
  successfulCycles: number;
  cycleSuccessRate: number;
  avgCycleLatencyMs: number;
  p95CycleLatencyMs: number;
  throughputPerMin: number;   // cycles completed in last 60s
  healthScore: number;        // 0–100 composite
  healthTier: "EXCELLENT" | "GOOD" | "DEGRADED" | "CRITICAL";
  alertFlags: string[];
  uptimeMs: number;
  startedAt: string;
  snapshot_at: string;
}

// ── Circular buffer ────────────────────────────────────────────────────────────

class CircularBuffer {
  private buf: number[];
  private pos = 0;
  private count = 0;

  constructor(private readonly capacity: number) {
    this.buf = new Array(capacity).fill(0);
  }

  push(val: number): void {
    this.buf[this.pos] = val;
    this.pos = (this.pos + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  values(): number[] {
    if (this.count === 0) return [];
    if (this.count < this.capacity) return this.buf.slice(0, this.count);
    // Reorder from oldest to newest
    return [...this.buf.slice(this.pos), ...this.buf.slice(0, this.pos)];
  }

  get size(): number { return this.count; }
}

// ── Percentile helper ─────────────────────────────────────────────────────────

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(Math.floor(sorted.length * pct), sorted.length - 1);
  return sorted[idx]!;
}

// ── Layer recorder ─────────────────────────────────────────────────────────────

class LayerRecorder {
  totalCalls = 0;
  successCount = 0;
  errorCount = 0;
  timeoutCount = 0;
  skippedCount = 0;
  lastRunAt: string | null = null;
  lastStatus: LayerStatus | null = null;
  lastErrorMsg: string | null = null;
  private readonly latencies = new CircularBuffer(200);

  record(latencyMs: number, status: LayerStatus, errMsg?: string): void {
    this.totalCalls++;
    this.lastRunAt = new Date().toISOString();
    this.lastStatus = status;
    if (status === "success") this.successCount++;
    else if (status === "error") { this.errorCount++; this.lastErrorMsg = errMsg ?? null; }
    else if (status === "timeout") this.timeoutCount++;
    else if (status === "skipped") this.skippedCount++;
    this.latencies.push(latencyMs);
  }

  snapshot(layer: LayerName): LayerTelemetry {
    const vals = this.latencies.values();
    const sorted = [...vals].sort((a, b) => a - b);
    const avg = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return {
      layer,
      totalCalls: this.totalCalls,
      successCount: this.successCount,
      errorCount: this.errorCount,
      timeoutCount: this.timeoutCount,
      skippedCount: this.skippedCount,
      successRate: this.totalCalls > 0 ? this.successCount / this.totalCalls : 1,
      avgLatencyMs: Number(avg.toFixed(1)),
      p50Ms: percentile(sorted, 0.50),
      p95Ms: percentile(sorted, 0.95),
      p99Ms: percentile(sorted, 0.99),
      maxLatencyMs: sorted.length > 0 ? sorted[sorted.length - 1]! : 0,
      lastRunAt: this.lastRunAt,
      lastStatus: this.lastStatus,
      lastErrorMsg: this.lastErrorMsg,
      recentLatencies: vals.slice(-20),
    };
  }
}

// ── Pipeline telemetry class ───────────────────────────────────────────────────

class BrainHealthTelemetry {
  private readonly layers = new Map<LayerName, LayerRecorder>();
  private readonly cycleBuf = new CircularBuffer(200);
  private readonly cycleTimestamps: number[] = []; // rolling 60s window
  private totalCycles = 0;
  private successfulCycles = 0;
  private readonly startedAt = Date.now();

  // ── Timer API ──────────────────────────────────────────────────────────────

  startLayer(layer: LayerName): { end: (status: LayerStatus, errMsg?: string) => number } {
    const t0 = Date.now();
    return {
      end: (status: LayerStatus, errMsg?: string) => {
        const latency = Date.now() - t0;
        this._getOrCreate(layer).record(latency, status, errMsg);
        return latency;
      },
    };
  }

  recordCycle(totalLatencyMs: number, success: boolean): void {
    this.totalCycles++;
    if (success) this.successfulCycles++;
    this.cycleBuf.push(totalLatencyMs);
    const now = Date.now();
    this.cycleTimestamps.push(now);
    // Trim to last 60s
    while (this.cycleTimestamps.length > 0 && this.cycleTimestamps[0]! < now - 60_000) {
      this.cycleTimestamps.shift();
    }
  }

  // ── Snapshot API ───────────────────────────────────────────────────────────

  snapshot(): PipelineTelemetry {
    const layerSnapshots = Array.from(this.layers.entries())
      .map(([name, rec]) => rec.snapshot(name))
      .sort((a, b) => a.layer.localeCompare(b.layer));

    const cycleLats = this.cycleBuf.values();
    const sortedCycles = [...cycleLats].sort((a, b) => a - b);
    const avgCycle = cycleLats.length > 0 ? cycleLats.reduce((a, b) => a + b, 0) / cycleLats.length : 0;
    const p95Cycle = percentile(sortedCycles, 0.95);
    const throughput = this.cycleTimestamps.length; // cycles in last 60s

    // Health score (0–100)
    const alertFlags: string[] = [];
    let healthScore = 100;

    for (const ls of layerSnapshots) {
      if (ls.totalCalls < 1) continue;
      if (ls.successRate < 0.8) {
        healthScore -= 15;
        alertFlags.push(`${ls.layer} low success rate (${(ls.successRate * 100).toFixed(0)}%)`);
      } else if (ls.successRate < 0.95) {
        healthScore -= 5;
      }
      if (ls.p95Ms > 5_000) {
        healthScore -= 10;
        alertFlags.push(`${ls.layer} high p95 latency (${ls.p95Ms}ms)`);
      } else if (ls.p95Ms > 2_000) {
        healthScore -= 3;
      }
    }

    if (this.totalCycles > 5) {
      const cycleSuccessRate = this.successfulCycles / this.totalCycles;
      if (cycleSuccessRate < 0.8) {
        healthScore -= 20;
        alertFlags.push(`Low cycle success rate (${(cycleSuccessRate * 100).toFixed(0)}%)`);
      }
    }

    healthScore = Math.max(0, Math.min(100, healthScore));
    const healthTier: PipelineTelemetry["healthTier"] =
      healthScore >= 90 ? "EXCELLENT"
      : healthScore >= 70 ? "GOOD"
      : healthScore >= 50 ? "DEGRADED"
      : "CRITICAL";

    if (healthTier === "CRITICAL" || healthTier === "DEGRADED") {
      logger.warn({ healthScore, healthTier, alertFlags }, "[BrainHealth] Pipeline health degraded");
    }

    return {
      layers: layerSnapshots,
      totalCycles: this.totalCycles,
      successfulCycles: this.successfulCycles,
      cycleSuccessRate: this.totalCycles > 0 ? this.successfulCycles / this.totalCycles : 1,
      avgCycleLatencyMs: Number(avgCycle.toFixed(1)),
      p95CycleLatencyMs: p95Cycle,
      throughputPerMin: throughput,
      healthScore,
      healthTier,
      alertFlags,
      uptimeMs: Date.now() - this.startedAt,
      startedAt: new Date(this.startedAt).toISOString(),
      snapshot_at: new Date().toISOString(),
    };
  }

  /** Get a single layer's snapshot */
  layerSnapshot(layer: LayerName): LayerTelemetry | null {
    const rec = this.layers.get(layer);
    return rec ? rec.snapshot(layer) : null;
  }

  /** Reset all metrics */
  reset(): void {
    this.layers.clear();
    this.totalCycles = 0;
    this.successfulCycles = 0;
    this.cycleTimestamps.length = 0;
    logger.info("[BrainHealth] Telemetry reset");
  }

  private _getOrCreate(layer: LayerName): LayerRecorder {
    let rec = this.layers.get(layer);
    if (!rec) { rec = new LayerRecorder(); this.layers.set(layer, rec); }
    return rec;
  }
}

export const telemetry = new BrainHealthTelemetry();
