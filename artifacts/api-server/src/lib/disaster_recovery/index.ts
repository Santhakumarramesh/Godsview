/**
 * disaster_recovery/index.ts — Phase 66: Disaster Recovery
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. BackupManager       — full / incremental / snapshot backups with checksums.
 *   2. RestoreEngine       — restore to point-in-time with verification.
 *   3. RPOTRacker          — per-workload Recovery Point Objective tracking.
 *   4. RTOSimulator        — Recovery Time Objective drill simulation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "crypto";
import { logger } from "../logger.js";

// ── Backups ────────────────────────────────────────────────────────────────

export type BackupKind = "full" | "incremental" | "snapshot";

export interface Backup {
  id: string;
  workload: string;
  kind: BackupKind;
  sizeBytes: number;
  checksum: string;
  createdAt: number;
  durationMs: number;
  status: "in_progress" | "succeeded" | "failed" | "verified" | "corrupted";
  parentBackupId?: string; // for incrementals
  retentionUntil: number;
  metadata: Record<string, string>;
}

export class BackupManager {
  private readonly backups = new Map<string, Backup>();

  start(params: {
    workload: string;
    kind: BackupKind;
    retentionDays?: number;
    parentBackupId?: string;
    metadata?: Record<string, string>;
  }): Backup {
    const id = `bkp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const backup: Backup = {
      id,
      workload: params.workload,
      kind: params.kind,
      sizeBytes: 0,
      checksum: "",
      createdAt: now,
      durationMs: 0,
      status: "in_progress",
      parentBackupId: params.parentBackupId,
      retentionUntil: now + (params.retentionDays ?? 30) * 24 * 60 * 60 * 1000,
      metadata: params.metadata ?? {},
    };
    this.backups.set(id, backup);
    logger.info({ backupId: id, workload: params.workload, kind: params.kind }, "[DR] Backup started");
    return backup;
  }

  complete(id: string, sizeBytes: number, content: string): Backup | null {
    const b = this.backups.get(id);
    if (!b) return null;
    b.sizeBytes = sizeBytes;
    b.checksum = createHash("sha256").update(content).digest("hex");
    b.status = "succeeded";
    b.durationMs = Date.now() - b.createdAt;
    return b;
  }

  fail(id: string, reason: string): Backup | null {
    const b = this.backups.get(id);
    if (!b) return null;
    b.status = "failed";
    b.durationMs = Date.now() - b.createdAt;
    b.metadata.failure_reason = reason;
    logger.error({ backupId: id, reason }, "[DR] Backup failed");
    return b;
  }

  verify(id: string, actualContent: string): Backup | null {
    const b = this.backups.get(id);
    if (!b) return null;
    const h = createHash("sha256").update(actualContent).digest("hex");
    b.status = h === b.checksum ? "verified" : "corrupted";
    return b;
  }

  list(workload?: string): Backup[] {
    const all = Array.from(this.backups.values()).sort((a, b) => b.createdAt - a.createdAt);
    return workload ? all.filter((b) => b.workload === workload) : all;
  }

  get(id: string): Backup | null {
    return this.backups.get(id) ?? null;
  }

  expire(): { expired: number } {
    const now = Date.now();
    let expired = 0;
    for (const [id, b] of this.backups) {
      if (b.retentionUntil < now) {
        this.backups.delete(id);
        expired++;
      }
    }
    return { expired };
  }

  latestFull(workload: string): Backup | null {
    return this.list(workload).find((b) => b.kind === "full" && (b.status === "succeeded" || b.status === "verified")) ?? null;
  }
}

// ── Restore Engine ─────────────────────────────────────────────────────────

export type RestoreStatus = "pending" | "restoring" | "verifying" | "succeeded" | "failed";

export interface RestoreJob {
  id: string;
  backupId: string;
  target: string;
  startedAt: number;
  finishedAt?: number;
  status: RestoreStatus;
  bytesRestored: number;
  error?: string;
  verification?: { expectedChecksum: string; actualChecksum: string; matched: boolean };
}

export class RestoreEngine {
  private readonly jobs = new Map<string, RestoreJob>();

  constructor(private readonly backupManager: BackupManager) {}

  start(backupId: string, target: string): RestoreJob | null {
    const backup = this.backupManager.get(backupId);
    if (!backup) return null;
    const id = `rst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const job: RestoreJob = {
      id,
      backupId,
      target,
      startedAt: Date.now(),
      status: "restoring",
      bytesRestored: 0,
    };
    this.jobs.set(id, job);
    logger.info({ jobId: id, backupId, target }, "[DR] Restore started");
    return job;
  }

  progress(id: string, bytesRestored: number): RestoreJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.bytesRestored = bytesRestored;
    return job;
  }

  complete(id: string, actualContent: string): RestoreJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    const backup = this.backupManager.get(job.backupId);
    if (backup) {
      const actual = createHash("sha256").update(actualContent).digest("hex");
      job.verification = {
        expectedChecksum: backup.checksum,
        actualChecksum: actual,
        matched: actual === backup.checksum,
      };
      job.status = job.verification.matched ? "succeeded" : "failed";
      if (!job.verification.matched) job.error = "checksum mismatch";
    } else {
      job.status = "failed";
      job.error = "backup not found";
    }
    job.finishedAt = Date.now();
    return job;
  }

  fail(id: string, reason: string): RestoreJob | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.status = "failed";
    job.error = reason;
    job.finishedAt = Date.now();
    return job;
  }

  list(): RestoreJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): RestoreJob | null {
    return this.jobs.get(id) ?? null;
  }
}

// ── RPO Tracker ────────────────────────────────────────────────────────────

export interface RPOPolicy {
  workload: string;
  maxDataLossMinutes: number;
  maxRecoveryMinutes: number; // RTO target
}

export interface RPOStatus {
  workload: string;
  lastBackupAt: number | null;
  ageMinutes: number | null;
  within: boolean;
  policy: RPOPolicy;
  lastFullBackupId?: string;
}

export class RPOTracker {
  private readonly policies = new Map<string, RPOPolicy>();

  constructor(private readonly backupManager: BackupManager) {}

  setPolicy(policy: RPOPolicy): void {
    this.policies.set(policy.workload, policy);
  }

  getPolicy(workload: string): RPOPolicy | null {
    return this.policies.get(workload) ?? null;
  }

  listPolicies(): RPOPolicy[] {
    return Array.from(this.policies.values());
  }

  status(workload: string): RPOStatus | null {
    const policy = this.policies.get(workload);
    if (!policy) return null;
    const latest = this.backupManager.latestFull(workload);
    const lastBackupAt = latest?.createdAt ?? null;
    const ageMinutes = lastBackupAt ? (Date.now() - lastBackupAt) / 60_000 : null;
    const within = ageMinutes === null ? false : ageMinutes <= policy.maxDataLossMinutes;
    return {
      workload,
      lastBackupAt,
      ageMinutes,
      within,
      policy,
      lastFullBackupId: latest?.id,
    };
  }

  statusAll(): RPOStatus[] {
    return this.listPolicies()
      .map((p) => this.status(p.workload))
      .filter((s): s is RPOStatus => s !== null);
  }
}

// ── RTO Simulator ──────────────────────────────────────────────────────────

export interface DrillResult {
  id: string;
  workload: string;
  scenario: "datacenter_loss" | "corruption" | "accidental_deletion" | "ransomware" | "partition";
  drilledAt: number;
  rtoActualMinutes: number;
  rtoTargetMinutes: number;
  rpoActualMinutes: number;
  rpoTargetMinutes: number;
  success: boolean;
  findings: string[];
}

export class RTOSimulator {
  private readonly drills: DrillResult[] = [];

  constructor(private readonly rpoTracker: RPOTracker) {}

  simulate(params: {
    workload: string;
    scenario: DrillResult["scenario"];
    actualRecoveryMinutes: number;
    findings?: string[];
  }): DrillResult {
    const status = this.rpoTracker.status(params.workload);
    const policy = status?.policy ?? { workload: params.workload, maxDataLossMinutes: 60, maxRecoveryMinutes: 240 };
    const rpoActual = status?.ageMinutes ?? 0;
    const id = `drl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const result: DrillResult = {
      id,
      workload: params.workload,
      scenario: params.scenario,
      drilledAt: Date.now(),
      rtoActualMinutes: params.actualRecoveryMinutes,
      rtoTargetMinutes: policy.maxRecoveryMinutes,
      rpoActualMinutes: rpoActual,
      rpoTargetMinutes: policy.maxDataLossMinutes,
      success: params.actualRecoveryMinutes <= policy.maxRecoveryMinutes && rpoActual <= policy.maxDataLossMinutes,
      findings: params.findings ?? [],
    };
    this.drills.push(result);
    if (this.drills.length > 1000) this.drills.shift();
    return result;
  }

  list(): DrillResult[] {
    return [...this.drills].reverse();
  }

  get(id: string): DrillResult | null {
    return this.drills.find((d) => d.id === id) ?? null;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const backupManager = new BackupManager();
export const restoreEngine = new RestoreEngine(backupManager);
export const rpoTracker = new RPOTracker(backupManager);
export const rtoSimulator = new RTOSimulator(rpoTracker);
