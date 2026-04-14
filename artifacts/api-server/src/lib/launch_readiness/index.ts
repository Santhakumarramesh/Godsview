/**
 * launch_readiness/index.ts — Phase 60: Launch Readiness
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. StagingEnvironmentManager — staging envs, promote/revert.
 *   2. LaunchChecklistEngine     — checklist templates + per-launch state.
 *   3. GoNoGoEngine              — aggregate signals → go / hold / no-go.
 *   4. LaunchRehearsalEngine     — rehearse launches with outcomes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Staging ────────────────────────────────────────────────────────────────

export type StagingStatus = "idle" | "deploying" | "active" | "failed" | "rolled_back";

export interface StagingEnvironment {
  id: string;
  name: string;
  activeVersion?: string;
  candidateVersion?: string;
  status: StagingStatus;
  lastDeployAt?: number;
  createdAt: number;
  health: "healthy" | "degraded" | "unhealthy" | "unknown";
}

export class StagingEnvironmentManager {
  private readonly envs = new Map<string, StagingEnvironment>();

  create(name: string): StagingEnvironment {
    const id = `stg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const env: StagingEnvironment = {
      id,
      name,
      status: "idle",
      createdAt: Date.now(),
      health: "unknown",
    };
    this.envs.set(id, env);
    return env;
  }

  deploy(id: string, candidateVersion: string): StagingEnvironment | null {
    const env = this.envs.get(id);
    if (!env) return null;
    env.candidateVersion = candidateVersion;
    env.status = "deploying";
    env.lastDeployAt = Date.now();
    logger.info({ envId: id, version: candidateVersion }, "[Staging] Deploy initiated");
    return env;
  }

  markActive(id: string, health: StagingEnvironment["health"] = "healthy"): StagingEnvironment | null {
    const env = this.envs.get(id);
    if (!env) return null;
    if (env.candidateVersion) env.activeVersion = env.candidateVersion;
    env.candidateVersion = undefined;
    env.status = "active";
    env.health = health;
    return env;
  }

  markFailed(id: string, note: string): StagingEnvironment | null {
    const env = this.envs.get(id);
    if (!env) return null;
    env.status = "failed";
    env.health = "unhealthy";
    logger.error({ envId: id, note }, "[Staging] Deploy failed");
    return env;
  }

  rollback(id: string): StagingEnvironment | null {
    const env = this.envs.get(id);
    if (!env) return null;
    env.candidateVersion = undefined;
    env.status = "rolled_back";
    return env;
  }

  list(): StagingEnvironment[] {
    return Array.from(this.envs.values());
  }

  get(id: string): StagingEnvironment | null {
    return this.envs.get(id) ?? null;
  }
}

// ── Checklists ─────────────────────────────────────────────────────────────

export type ChecklistItemStatus = "pending" | "passed" | "failed" | "skipped";

export interface ChecklistItem {
  id: string;
  title: string;
  category: "code" | "infra" | "data" | "risk" | "compliance" | "communication";
  critical: boolean;
  status: ChecklistItemStatus;
  notes: string;
  updatedAt: number;
}

export interface LaunchChecklist {
  id: string;
  name: string;
  createdAt: number;
  items: ChecklistItem[];
}

export const DEFAULT_CHECKLIST_TEMPLATE: Array<Omit<ChecklistItem, "id" | "status" | "notes" | "updatedAt">> = [
  { title: "All unit + integration tests passing", category: "code", critical: true },
  { title: "Typecheck clean across repo", category: "code", critical: true },
  { title: "No open P0 bugs", category: "code", critical: true },
  { title: "Backups verified within last 24h", category: "data", critical: true },
  { title: "Runbook for rollback published", category: "infra", critical: true },
  { title: "Feature flags default OFF", category: "code", critical: false },
  { title: "Oncall rota confirmed", category: "communication", critical: true },
  { title: "Circuit breakers armed", category: "risk", critical: true },
  { title: "Paper trading parity verified", category: "risk", critical: true },
  { title: "Risk limits configured", category: "risk", critical: true },
  { title: "Market-data feed redundancy verified", category: "data", critical: false },
  { title: "Latency SLO met in staging", category: "infra", critical: false },
  { title: "Alert routing verified", category: "infra", critical: false },
  { title: "Audit log retention policy active", category: "compliance", critical: false },
  { title: "Customer comms drafted", category: "communication", critical: false },
];

export class LaunchChecklistEngine {
  private readonly lists = new Map<string, LaunchChecklist>();

  create(name: string, template = DEFAULT_CHECKLIST_TEMPLATE): LaunchChecklist {
    const id = `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const list: LaunchChecklist = {
      id,
      name,
      createdAt: Date.now(),
      items: template.map((t, idx) => ({
        id: `${id}_item_${idx}`,
        title: t.title,
        category: t.category,
        critical: t.critical,
        status: "pending",
        notes: "",
        updatedAt: Date.now(),
      })),
    };
    this.lists.set(id, list);
    return list;
  }

  setItem(listId: string, itemId: string, status: ChecklistItemStatus, notes?: string): ChecklistItem | null {
    const list = this.lists.get(listId);
    if (!list) return null;
    const item = list.items.find((i) => i.id === itemId);
    if (!item) return null;
    item.status = status;
    if (notes !== undefined) item.notes = notes;
    item.updatedAt = Date.now();
    return item;
  }

  get(id: string): LaunchChecklist | null {
    return this.lists.get(id) ?? null;
  }

  list(): LaunchChecklist[] {
    return Array.from(this.lists.values());
  }

  summary(id: string): {
    total: number; passed: number; failed: number; pending: number; skipped: number;
    criticalBlocked: number;
  } | null {
    const list = this.lists.get(id);
    if (!list) return null;
    const total = list.items.length;
    const passed = list.items.filter((i) => i.status === "passed").length;
    const failed = list.items.filter((i) => i.status === "failed").length;
    const pending = list.items.filter((i) => i.status === "pending").length;
    const skipped = list.items.filter((i) => i.status === "skipped").length;
    const criticalBlocked = list.items.filter((i) => i.critical && i.status !== "passed" && i.status !== "skipped").length;
    return { total, passed, failed, pending, skipped, criticalBlocked };
  }
}

// ── Go / No-Go ─────────────────────────────────────────────────────────────

export type GoNoGoDecision = "go" | "hold" | "no_go";

export interface GoNoGoAssessment {
  decision: GoNoGoDecision;
  score: number; // 0-100
  blockers: string[];
  warnings: string[];
  checkedAt: number;
}

export class GoNoGoEngine {
  assess(inputs: {
    checklistSummary?: { total: number; passed: number; criticalBlocked: number } | null;
    stagingHealth?: StagingEnvironment["health"];
    resilienceScore?: number; // 0-100
    openIncidents?: number;
    marketOpen?: boolean;
  }): GoNoGoAssessment {
    const blockers: string[] = [];
    const warnings: string[] = [];

    if (inputs.checklistSummary && inputs.checklistSummary.criticalBlocked > 0) {
      blockers.push(`${inputs.checklistSummary.criticalBlocked} critical checklist items not passed`);
    }
    if (inputs.stagingHealth === "unhealthy") blockers.push("Staging environment unhealthy");
    if (inputs.stagingHealth === "degraded") warnings.push("Staging environment degraded");
    if (typeof inputs.resilienceScore === "number" && inputs.resilienceScore < 60) {
      blockers.push(`Resilience score ${inputs.resilienceScore.toFixed(1)} below 60`);
    } else if (typeof inputs.resilienceScore === "number" && inputs.resilienceScore < 80) {
      warnings.push(`Resilience score ${inputs.resilienceScore.toFixed(1)} below 80`);
    }
    if ((inputs.openIncidents ?? 0) > 0) warnings.push(`${inputs.openIncidents} open incident(s)`);
    if (inputs.marketOpen) warnings.push("Market is currently open — launch during low-activity windows");

    const pct = inputs.checklistSummary && inputs.checklistSummary.total > 0
      ? (inputs.checklistSummary.passed / inputs.checklistSummary.total) * 100
      : 50;
    const resilience = inputs.resilienceScore ?? 70;
    const score = Math.max(0, Math.min(100, pct * 0.6 + resilience * 0.4 - warnings.length * 5 - blockers.length * 20));

    const decision: GoNoGoDecision = blockers.length > 0 ? "no_go" : warnings.length > 0 ? "hold" : "go";

    return { decision, score, blockers, warnings, checkedAt: Date.now() };
  }
}

// ── Launch Rehearsal ───────────────────────────────────────────────────────

export type RehearsalOutcome = "success" | "partial" | "failure";

export interface LaunchRehearsal {
  id: string;
  launchName: string;
  rehearsedAt: number;
  scenarios: Array<{
    name: string;
    outcome: RehearsalOutcome;
    durationMs: number;
    notes: string;
  }>;
  overall: RehearsalOutcome;
}

export class LaunchRehearsalEngine {
  private readonly rehearsals = new Map<string, LaunchRehearsal>();

  record(launchName: string, scenarios: LaunchRehearsal["scenarios"]): LaunchRehearsal {
    const id = `rhs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const failures = scenarios.filter((s) => s.outcome === "failure").length;
    const partials = scenarios.filter((s) => s.outcome === "partial").length;
    const overall: RehearsalOutcome =
      failures > 0 ? "failure" : partials > 0 ? "partial" : "success";
    const rehearsal: LaunchRehearsal = {
      id,
      launchName,
      rehearsedAt: Date.now(),
      scenarios,
      overall,
    };
    this.rehearsals.set(id, rehearsal);
    return rehearsal;
  }

  list(): LaunchRehearsal[] {
    return Array.from(this.rehearsals.values());
  }

  get(id: string): LaunchRehearsal | null {
    return this.rehearsals.get(id) ?? null;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const stagingEnvironmentManager = new StagingEnvironmentManager();
export const launchChecklistEngine = new LaunchChecklistEngine();
export const goNoGoEngine = new GoNoGoEngine();
export const launchRehearsalEngine = new LaunchRehearsalEngine();
