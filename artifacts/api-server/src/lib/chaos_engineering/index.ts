/**
 * chaos_engineering/index.ts — Phase 59: Chaos Engineering
 * ─────────────────────────────────────────────────────────────────────────────
 * Safely rehearse production failures.
 *
 *   1. ChaosOrchestrator        — 8 experiment types, safe defaults.
 *   2. ResilienceScorer         — 5-dimension scoring.
 *   3. RollbackEngine           — snapshot / restore state.
 *   4. DependencyFaultSimulator — fake DB / broker / feed failures.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Experiments ────────────────────────────────────────────────────────────

export type ExperimentType =
  | "latency_injection"
  | "error_injection"
  | "dependency_failure"
  | "resource_exhaustion"
  | "network_partition"
  | "clock_skew"
  | "data_corruption"
  | "full_outage";

export type ExperimentStatus = "pending" | "running" | "completed" | "aborted" | "failed";

export interface Experiment {
  id: string;
  name: string;
  type: ExperimentType;
  target: string;
  params: Record<string, number | string | boolean>;
  status: ExperimentStatus;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  observations: Array<{ at: number; note: string; metrics?: Record<string, number> }>;
  outcome?: "pass" | "fail" | "inconclusive";
  notes: string;
}

export class ChaosOrchestrator {
  private readonly experiments = new Map<string, Experiment>();
  private running: string | null = null;

  plan(params: {
    name: string;
    type: ExperimentType;
    target: string;
    params?: Record<string, number | string | boolean>;
    notes?: string;
  }): Experiment {
    const id = `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const exp: Experiment = {
      id,
      name: params.name,
      type: params.type,
      target: params.target,
      params: params.params ?? {},
      status: "pending",
      observations: [],
      notes: params.notes ?? "",
    };
    this.experiments.set(id, exp);
    return exp;
  }

  start(id: string): Experiment | null {
    if (this.running) {
      logger.warn({ running: this.running }, "[Chaos] Cannot start — another experiment in progress");
      return null;
    }
    const exp = this.experiments.get(id);
    if (!exp || exp.status !== "pending") return null;
    exp.status = "running";
    exp.startedAt = Date.now();
    this.running = id;
    logger.info({ expId: id, type: exp.type }, "[Chaos] Experiment started");
    return exp;
  }

  observe(id: string, note: string, metrics?: Record<string, number>): void {
    const exp = this.experiments.get(id);
    if (!exp) return;
    exp.observations.push({ at: Date.now(), note, metrics });
  }

  complete(id: string, outcome: "pass" | "fail" | "inconclusive", notes?: string): Experiment | null {
    const exp = this.experiments.get(id);
    if (!exp) return null;
    exp.status = "completed";
    exp.finishedAt = Date.now();
    exp.durationMs = exp.startedAt ? exp.finishedAt - exp.startedAt : 0;
    exp.outcome = outcome;
    if (notes) exp.notes = notes;
    if (this.running === id) this.running = null;
    logger.info({ expId: id, outcome }, "[Chaos] Experiment completed");
    return exp;
  }

  abort(id: string, reason: string): Experiment | null {
    const exp = this.experiments.get(id);
    if (!exp) return null;
    exp.status = "aborted";
    exp.finishedAt = Date.now();
    exp.durationMs = exp.startedAt ? exp.finishedAt - exp.startedAt : 0;
    exp.notes = reason;
    if (this.running === id) this.running = null;
    logger.warn({ expId: id, reason }, "[Chaos] Experiment aborted");
    return exp;
  }

  list(): Experiment[] {
    return Array.from(this.experiments.values());
  }

  get(id: string): Experiment | null {
    return this.experiments.get(id) ?? null;
  }

  currentlyRunning(): Experiment | null {
    return this.running ? this.experiments.get(this.running) ?? null : null;
  }
}

// ── Resilience Scoring ─────────────────────────────────────────────────────

export interface ResilienceScores {
  availability: number;    // 0-100 — how often stayed up
  latency: number;         // 0-100 — how well latency held
  correctness: number;     // 0-100 — did we serve correct data
  recovery: number;        // 0-100 — recovered quickly
  blastRadius: number;     // 0-100 — kept failures contained
  overall: number;         // weighted average
}

export class ResilienceScorer {
  score(exp: Experiment): ResilienceScores {
    // Naive heuristic: pass → 90, inconclusive → 70, fail → 40, aborted → 0.
    const base =
      exp.outcome === "pass" ? 90 :
      exp.outcome === "inconclusive" ? 70 :
      exp.outcome === "fail" ? 40 :
      exp.status === "aborted" ? 0 : 50;

    const typeModifier: Partial<Record<ExperimentType, Partial<ResilienceScores>>> = {
      latency_injection: { latency: base - 10, recovery: base + 5 },
      error_injection: { correctness: base - 5, availability: base },
      dependency_failure: { blastRadius: base - 10, recovery: base },
      resource_exhaustion: { availability: base - 10 },
      network_partition: { availability: base - 15, recovery: base - 5 },
      clock_skew: { correctness: base - 10 },
      data_corruption: { correctness: base - 20 },
      full_outage: { availability: 0, recovery: base - 20 },
    };

    const clamp = (v: number): number => Math.max(0, Math.min(100, v));
    const defaults: ResilienceScores = {
      availability: base,
      latency: base,
      correctness: base,
      recovery: base,
      blastRadius: base,
      overall: 0,
    };
    const mods = typeModifier[exp.type] ?? {};
    const merged: ResilienceScores = { ...defaults, ...(mods as Partial<ResilienceScores>) };
    for (const k of Object.keys(merged) as Array<keyof ResilienceScores>) {
      merged[k] = clamp(merged[k]);
    }
    merged.overall = clamp(
      (merged.availability + merged.latency + merged.correctness + merged.recovery + merged.blastRadius) / 5,
    );
    return merged;
  }

  aggregate(experiments: Experiment[]): ResilienceScores {
    if (experiments.length === 0) {
      return { availability: 0, latency: 0, correctness: 0, recovery: 0, blastRadius: 0, overall: 0 };
    }
    const scores = experiments.map((e) => this.score(e));
    const avg = (pick: (s: ResilienceScores) => number): number =>
      scores.reduce((sum, s) => sum + pick(s), 0) / scores.length;
    return {
      availability: avg((s) => s.availability),
      latency: avg((s) => s.latency),
      correctness: avg((s) => s.correctness),
      recovery: avg((s) => s.recovery),
      blastRadius: avg((s) => s.blastRadius),
      overall: avg((s) => s.overall),
    };
  }
}

// ── Rollback Engine ────────────────────────────────────────────────────────

export interface Snapshot {
  id: string;
  label: string;
  at: number;
  data: Record<string, unknown>;
}

export class RollbackEngine {
  private readonly snapshots = new Map<string, Snapshot>();

  snapshot(label: string, data: Record<string, unknown>): Snapshot {
    const id = `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const snap: Snapshot = { id, label, at: Date.now(), data: { ...data } };
    this.snapshots.set(id, snap);
    return snap;
  }

  restore(id: string): Snapshot | null {
    const s = this.snapshots.get(id);
    if (!s) return null;
    logger.info({ snapshotId: id, label: s.label }, "[Chaos] Snapshot restored");
    return { ...s, data: { ...s.data } };
  }

  list(): Snapshot[] {
    return Array.from(this.snapshots.values()).sort((a, b) => b.at - a.at);
  }

  delete(id: string): boolean {
    return this.snapshots.delete(id);
  }
}

// ── Dependency Fault Simulator ─────────────────────────────────────────────

export type DependencyKind = "database" | "broker" | "market_feed" | "cache" | "queue" | "external_api";

export interface ActiveFault {
  id: string;
  dependency: DependencyKind;
  kind: "slow" | "error" | "unavailable" | "intermittent";
  delayMs?: number;
  errorRate?: number; // 0-1
  startedAt: number;
  expiresAt: number;
}

export class DependencyFaultSimulator {
  private readonly faults = new Map<string, ActiveFault>();

  injectSlow(dependency: DependencyKind, delayMs: number, durationMs: number): ActiveFault {
    return this._add({ dependency, kind: "slow", delayMs, durationMs });
  }

  injectError(dependency: DependencyKind, errorRate: number, durationMs: number): ActiveFault {
    return this._add({ dependency, kind: "error", errorRate: Math.max(0, Math.min(1, errorRate)), durationMs });
  }

  injectUnavailable(dependency: DependencyKind, durationMs: number): ActiveFault {
    return this._add({ dependency, kind: "unavailable", durationMs });
  }

  injectIntermittent(dependency: DependencyKind, errorRate: number, durationMs: number): ActiveFault {
    return this._add({ dependency, kind: "intermittent", errorRate: Math.max(0, Math.min(1, errorRate)), durationMs });
  }

  active(): ActiveFault[] {
    this._purge();
    return Array.from(this.faults.values());
  }

  shouldFail(dependency: DependencyKind): boolean {
    this._purge();
    for (const f of this.faults.values()) {
      if (f.dependency !== dependency) continue;
      if (f.kind === "unavailable") return true;
      if (f.kind === "error" || f.kind === "intermittent") {
        if (Math.random() < (f.errorRate ?? 0)) return true;
      }
    }
    return false;
  }

  clear(id: string): boolean {
    return this.faults.delete(id);
  }

  clearAll(): void {
    this.faults.clear();
  }

  private _add(params: {
    dependency: DependencyKind;
    kind: ActiveFault["kind"];
    delayMs?: number;
    errorRate?: number;
    durationMs: number;
  }): ActiveFault {
    const id = `flt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const fault: ActiveFault = {
      id,
      dependency: params.dependency,
      kind: params.kind,
      delayMs: params.delayMs,
      errorRate: params.errorRate,
      startedAt: now,
      expiresAt: now + params.durationMs,
    };
    this.faults.set(id, fault);
    logger.warn({ faultId: id, dep: params.dependency, kind: params.kind }, "[Chaos] Dependency fault injected");
    return fault;
  }

  private _purge(): void {
    const now = Date.now();
    for (const [id, f] of this.faults) {
      if (f.expiresAt <= now) this.faults.delete(id);
    }
  }
}

// ── Singletons ──────────────────────────────────────────────────────────────

export const chaosOrchestrator = new ChaosOrchestrator();
export const resilienceScorer = new ResilienceScorer();
export const rollbackEngine = new RollbackEngine();
export const dependencyFaultSimulator = new DependencyFaultSimulator();
