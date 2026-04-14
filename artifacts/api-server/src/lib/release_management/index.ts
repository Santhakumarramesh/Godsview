/**
 * release_management/index.ts — Phase 69: Release Management
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. VersionRegistry   — semver-compatible release versions.
 *   2. CanaryController  — weighted canary rollouts with health gates.
 *   3. BlueGreenManager  — blue/green swap + traffic cutover.
 *   4. ReleaseGate       — policy gates (tests/approvals/freeze windows).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Version Registry ───────────────────────────────────────────────────────

export type ReleaseChannel = "canary" | "beta" | "stable" | "hotfix";
export type ReleaseStatus = "draft" | "staged" | "canary" | "rolling_out" | "stable" | "rolled_back" | "archived";

export interface Release {
  id: string;
  component: string;
  version: string;     // semver: 1.2.3 / 1.2.3-rc.1
  channel: ReleaseChannel;
  status: ReleaseStatus;
  commitSha: string;
  buildId: string;
  author: string;
  changelog: string;
  createdAt: number;
  promotedAt?: number;
  rolledBackAt?: number;
  rollbackReason?: string;
}

export class VersionRegistry {
  private readonly releases = new Map<string, Release>();

  register(params: {
    component: string;
    version: string;
    channel: ReleaseChannel;
    commitSha: string;
    buildId: string;
    author: string;
    changelog?: string;
  }): Release {
    const id = `rel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const release: Release = {
      id,
      ...params,
      changelog: params.changelog ?? "",
      status: "draft",
      createdAt: Date.now(),
    };
    this.releases.set(id, release);
    return release;
  }

  promote(id: string, status: ReleaseStatus): Release | null {
    const r = this.releases.get(id);
    if (!r) return null;
    r.status = status;
    if (status === "stable") r.promotedAt = Date.now();
    return r;
  }

  rollback(id: string, reason: string): Release | null {
    const r = this.releases.get(id);
    if (!r) return null;
    r.status = "rolled_back";
    r.rolledBackAt = Date.now();
    r.rollbackReason = reason;
    logger.warn({ releaseId: id, reason }, "[Release] Rolled back");
    return r;
  }

  list(filter?: { component?: string; channel?: ReleaseChannel; status?: ReleaseStatus }): Release[] {
    let out = Array.from(this.releases.values());
    if (filter?.component) out = out.filter((r) => r.component === filter.component);
    if (filter?.channel) out = out.filter((r) => r.channel === filter.channel);
    if (filter?.status) out = out.filter((r) => r.status === filter.status);
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  current(component: string): Release | null {
    return this.list({ component, status: "stable" })[0] ?? null;
  }

  get(id: string): Release | null {
    return this.releases.get(id) ?? null;
  }
}

// ── Canary Controller ─────────────────────────────────────────────────────

export interface CanaryDeployment {
  id: string;
  releaseId: string;
  component: string;
  currentWeight: number;   // 0-100 (percentage of traffic)
  targetWeight: number;
  rampSteps: number[];     // e.g. [5, 25, 50, 100]
  currentStep: number;
  startedAt: number;
  lastAdvancedAt: number;
  status: "rolling" | "paused" | "aborted" | "completed";
  healthChecks: Array<{ at: number; passed: boolean; note: string }>;
}

export class CanaryController {
  private readonly deployments = new Map<string, CanaryDeployment>();

  start(params: { releaseId: string; component: string; rampSteps?: number[] }): CanaryDeployment {
    const rampSteps = params.rampSteps ?? [5, 25, 50, 100];
    const id = `cnr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const deployment: CanaryDeployment = {
      id,
      releaseId: params.releaseId,
      component: params.component,
      currentWeight: rampSteps[0]!,
      targetWeight: rampSteps[rampSteps.length - 1]!,
      rampSteps,
      currentStep: 0,
      startedAt: Date.now(),
      lastAdvancedAt: Date.now(),
      status: "rolling",
      healthChecks: [],
    };
    this.deployments.set(id, deployment);
    logger.info({ canaryId: id, initial: deployment.currentWeight }, "[Canary] Started");
    return deployment;
  }

  healthCheck(id: string, passed: boolean, note = ""): CanaryDeployment | null {
    const d = this.deployments.get(id);
    if (!d) return null;
    d.healthChecks.push({ at: Date.now(), passed, note });
    if (!passed && d.status === "rolling") {
      d.status = "paused";
      logger.warn({ canaryId: id, note }, "[Canary] Paused after failed health check");
    }
    return d;
  }

  advance(id: string): CanaryDeployment | null {
    const d = this.deployments.get(id);
    if (!d || d.status !== "rolling") return null;
    if (d.currentStep < d.rampSteps.length - 1) {
      d.currentStep++;
      d.currentWeight = d.rampSteps[d.currentStep]!;
      d.lastAdvancedAt = Date.now();
      if (d.currentWeight >= d.targetWeight) d.status = "completed";
    }
    return d;
  }

  abort(id: string): CanaryDeployment | null {
    const d = this.deployments.get(id);
    if (!d) return null;
    d.status = "aborted";
    d.currentWeight = 0;
    return d;
  }

  list(): CanaryDeployment[] {
    return Array.from(this.deployments.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): CanaryDeployment | null {
    return this.deployments.get(id) ?? null;
  }
}

// ── Blue/Green Manager ────────────────────────────────────────────────────

export type BGSlot = "blue" | "green";

export interface BlueGreenPair {
  component: string;
  blueReleaseId?: string;
  greenReleaseId?: string;
  liveSlot: BGSlot;
  lastSwapAt?: number;
}

export class BlueGreenManager {
  private readonly pairs = new Map<string, BlueGreenPair>();

  provision(component: string): BlueGreenPair {
    const pair: BlueGreenPair = this.pairs.get(component) ?? { component, liveSlot: "blue" };
    this.pairs.set(component, pair);
    return pair;
  }

  deploy(component: string, releaseId: string): BlueGreenPair | null {
    const pair = this.pairs.get(component);
    if (!pair) return null;
    const inactiveSlot: BGSlot = pair.liveSlot === "blue" ? "green" : "blue";
    if (inactiveSlot === "blue") pair.blueReleaseId = releaseId;
    else pair.greenReleaseId = releaseId;
    return pair;
  }

  swap(component: string): BlueGreenPair | null {
    const pair = this.pairs.get(component);
    if (!pair) return null;
    pair.liveSlot = pair.liveSlot === "blue" ? "green" : "blue";
    pair.lastSwapAt = Date.now();
    logger.info({ component, liveSlot: pair.liveSlot }, "[BlueGreen] Swapped");
    return pair;
  }

  get(component: string): BlueGreenPair | null {
    return this.pairs.get(component) ?? null;
  }

  list(): BlueGreenPair[] {
    return Array.from(this.pairs.values());
  }
}

// ── Release Gates ─────────────────────────────────────────────────────────

export interface ReleaseGateInput {
  testsPassed: boolean;
  approvals: string[];      // list of approver ids
  minApprovals?: number;
  freezeActive: boolean;
  overrideFreeze?: boolean;
  sloBurnRate?: number;     // if > threshold, block
}

export interface GateEvaluation {
  allowed: boolean;
  reasons: string[];
  warnings: string[];
}

export class ReleaseGate {
  evaluate(input: ReleaseGateInput): GateEvaluation {
    const reasons: string[] = [];
    const warnings: string[] = [];
    if (!input.testsPassed) reasons.push("tests not passing");
    const minApprovals = input.minApprovals ?? 1;
    if (input.approvals.length < minApprovals) reasons.push(`${minApprovals - input.approvals.length} more approval(s) required`);
    if (input.freezeActive && !input.overrideFreeze) reasons.push("release freeze active (no override)");
    if (input.freezeActive && input.overrideFreeze) warnings.push("freeze overridden — document reason");
    if (typeof input.sloBurnRate === "number" && input.sloBurnRate > 2.0) {
      reasons.push(`SLO burn rate ${input.sloBurnRate.toFixed(2)}x > 2.0x threshold`);
    } else if (typeof input.sloBurnRate === "number" && input.sloBurnRate > 1.0) {
      warnings.push(`SLO burn rate ${input.sloBurnRate.toFixed(2)}x elevated`);
    }
    return { allowed: reasons.length === 0, reasons, warnings };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const versionRegistry = new VersionRegistry();
export const canaryController = new CanaryController();
export const blueGreenManager = new BlueGreenManager();
export const releaseGate = new ReleaseGate();
