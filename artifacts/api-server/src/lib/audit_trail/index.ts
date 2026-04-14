/**
 * audit_trail/index.ts — Phase 62: Audit Trail + Compliance
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. AuditLogger          — append-only audit log with hash-chained integrity.
 *   2. RetentionPolicy      — TTL-based pruning with legal holds.
 *   3. ComplianceFrameworks — SOC2 / SEC / MiFID II / GDPR mappings.
 *   4. ComplianceEvaluator  — score current audit trail against frameworks.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash } from "crypto";
import { logger } from "../logger.js";

// ── Audit Logger ───────────────────────────────────────────────────────────

export type AuditAction =
  | "login"
  | "logout"
  | "config_change"
  | "trade_submit"
  | "trade_cancel"
  | "risk_override"
  | "role_change"
  | "data_export"
  | "data_access"
  | "strategy_publish"
  | "strategy_fork"
  | "admin_action";

export interface AuditRecord {
  id: string;
  at: number;
  actor: string;
  action: AuditAction;
  target: string;
  outcome: "success" | "failure" | "denied";
  metadata: Record<string, unknown>;
  prevHash: string;
  hash: string;
}

export class AuditLogger {
  private readonly records: AuditRecord[] = [];
  private readonly maxRecords = 500_000;

  append(params: {
    actor: string;
    action: AuditAction;
    target: string;
    outcome: AuditRecord["outcome"];
    metadata?: Record<string, unknown>;
  }): AuditRecord {
    const prevHash = this.records.length > 0 ? this.records[this.records.length - 1]!.hash : "genesis";
    const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const at = Date.now();
    const metadata = params.metadata ?? {};
    const payload = JSON.stringify({ id, at, ...params, metadata, prevHash });
    const hash = createHash("sha256").update(payload).digest("hex");
    const record: AuditRecord = {
      id, at,
      actor: params.actor,
      action: params.action,
      target: params.target,
      outcome: params.outcome,
      metadata,
      prevHash,
      hash,
    };
    this.records.push(record);
    if (this.records.length > this.maxRecords) this.records.shift();
    return record;
  }

  list(filter?: { actor?: string; action?: AuditAction; since?: number; until?: number; limit?: number }): AuditRecord[] {
    let out = this.records;
    if (filter?.actor) out = out.filter((r) => r.actor === filter.actor);
    if (filter?.action) out = out.filter((r) => r.action === filter.action);
    if (filter?.since) out = out.filter((r) => r.at >= filter.since!);
    if (filter?.until) out = out.filter((r) => r.at <= filter.until!);
    const limit = filter?.limit ?? 500;
    return out.slice(-limit).reverse();
  }

  verifyChain(): { valid: boolean; firstBrokenAt?: string } {
    let prev = "genesis";
    for (const r of this.records) {
      if (r.prevHash !== prev) return { valid: false, firstBrokenAt: r.id };
      const payload = JSON.stringify({
        id: r.id, at: r.at,
        actor: r.actor, action: r.action, target: r.target, outcome: r.outcome,
        metadata: r.metadata, prevHash: r.prevHash,
      });
      const computed = createHash("sha256").update(payload).digest("hex");
      if (computed !== r.hash) return { valid: false, firstBrokenAt: r.id };
      prev = r.hash;
    }
    return { valid: true };
  }

  size(): number {
    return this.records.length;
  }

  _records(): AuditRecord[] {
    return this.records;
  }
}

// ── Retention Policy ───────────────────────────────────────────────────────

export interface LegalHold {
  id: string;
  reason: string;
  placedAt: number;
  placedBy: string;
  scope: { actor?: string; action?: AuditAction };
  active: boolean;
}

export class RetentionPolicy {
  private readonly holds = new Map<string, LegalHold>();

  constructor(private readonly logger_: AuditLogger, private retentionDays = 2555 /* 7y */) {}

  setRetentionDays(days: number): void {
    this.retentionDays = Math.max(1, days | 0);
  }

  getRetentionDays(): number {
    return this.retentionDays;
  }

  placeHold(params: { reason: string; placedBy: string; scope?: LegalHold["scope"] }): LegalHold {
    const id = `hold_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const hold: LegalHold = {
      id,
      reason: params.reason,
      placedAt: Date.now(),
      placedBy: params.placedBy,
      scope: params.scope ?? {},
      active: true,
    };
    this.holds.set(id, hold);
    logger.warn({ holdId: id, reason: params.reason }, "[Audit] Legal hold placed");
    return hold;
  }

  releaseHold(id: string): boolean {
    const h = this.holds.get(id);
    if (!h) return false;
    h.active = false;
    return true;
  }

  activeHolds(): LegalHold[] {
    return Array.from(this.holds.values()).filter((h) => h.active);
  }

  isHeld(record: AuditRecord): boolean {
    for (const h of this.holds.values()) {
      if (!h.active) continue;
      if (h.scope.actor && h.scope.actor !== record.actor) continue;
      if (h.scope.action && h.scope.action !== record.action) continue;
      return true;
    }
    return false;
  }

  prune(): { pruned: number; kept: number } {
    const cutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000;
    const all = this.logger_._records();
    const keep: AuditRecord[] = [];
    let pruned = 0;
    for (const r of all) {
      if (r.at < cutoff && !this.isHeld(r)) { pruned++; continue; }
      keep.push(r);
    }
    all.length = 0;
    all.push(...keep);
    return { pruned, kept: keep.length };
  }
}

// ── Compliance Frameworks ──────────────────────────────────────────────────

export type ComplianceFramework = "SOC2" | "SEC_17a" | "MiFID_II" | "GDPR";

export interface ControlRequirement {
  id: string;
  framework: ComplianceFramework;
  title: string;
  description: string;
  requiredActions: AuditAction[];
  minOccurrencesPerDay?: number;
  requireOutcomeMix?: boolean;
}

export const CONTROLS: ControlRequirement[] = [
  // SOC2
  { id: "soc2.cc7.2", framework: "SOC2", title: "Access logging", description: "Log all authentication events",
    requiredActions: ["login", "logout"], minOccurrencesPerDay: 1 },
  { id: "soc2.cc8.1", framework: "SOC2", title: "Change management",
    description: "Record config changes with actor + outcome", requiredActions: ["config_change"] },
  { id: "soc2.cc6.6", framework: "SOC2", title: "Privileged action review",
    description: "All admin actions must be audited", requiredActions: ["admin_action", "role_change"] },
  // SEC 17a-4
  { id: "sec.17a-4.b", framework: "SEC_17a", title: "Trade record retention",
    description: "Retain trade records for 6+ years", requiredActions: ["trade_submit", "trade_cancel"] },
  { id: "sec.17a-4.f", framework: "SEC_17a", title: "Non-erasable storage",
    description: "Audit chain integrity must hold", requiredActions: ["trade_submit"] },
  // MiFID II
  { id: "mifid.rts25", framework: "MiFID_II", title: "Order-audit-trail with timestamps",
    description: "Millisecond timestamps on all orders", requiredActions: ["trade_submit"] },
  { id: "mifid.art16", framework: "MiFID_II", title: "Risk override logging",
    description: "All risk overrides recorded", requiredActions: ["risk_override"], requireOutcomeMix: true },
  // GDPR
  { id: "gdpr.art15", framework: "GDPR", title: "Right of access — data exports logged",
    description: "All data exports audited", requiredActions: ["data_export"] },
  { id: "gdpr.art17", framework: "GDPR", title: "Data access auditability",
    description: "Personal-data access logged", requiredActions: ["data_access"] },
];

// ── Compliance Evaluator ───────────────────────────────────────────────────

export interface ControlAssessment {
  control: ControlRequirement;
  status: "compliant" | "gap" | "at_risk";
  evidence: number;
  issues: string[];
}

export class ComplianceEvaluator {
  constructor(private readonly auditLogger: AuditLogger) {}

  evaluate(framework?: ComplianceFramework, windowDays = 30): {
    framework: ComplianceFramework | "all";
    overall: "compliant" | "at_risk" | "non_compliant";
    compliancePct: number;
    assessments: ControlAssessment[];
  } {
    const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    const records = this.auditLogger.list({ since, limit: 500_000 });
    const controls = framework ? CONTROLS.filter((c) => c.framework === framework) : CONTROLS;

    const assessments: ControlAssessment[] = controls.map((c) => {
      const matching = records.filter((r) => c.requiredActions.includes(r.action));
      const issues: string[] = [];
      if (c.minOccurrencesPerDay) {
        const perDay = matching.length / Math.max(1, windowDays);
        if (perDay < c.minOccurrencesPerDay) issues.push(`<${c.minOccurrencesPerDay}/day`);
      }
      if (c.requireOutcomeMix) {
        const outcomes = new Set(matching.map((r) => r.outcome));
        if (outcomes.size < 2) issues.push("outcome diversity low");
      }
      if (matching.length === 0) issues.push("no events in window");

      let status: ControlAssessment["status"] = "compliant";
      if (matching.length === 0) status = "gap";
      else if (issues.length > 0) status = "at_risk";

      return { control: c, status, evidence: matching.length, issues };
    });

    const compliantCount = assessments.filter((a) => a.status === "compliant").length;
    const gapCount = assessments.filter((a) => a.status === "gap").length;
    const compliancePct = assessments.length > 0 ? (compliantCount / assessments.length) * 100 : 0;

    const overall: "compliant" | "at_risk" | "non_compliant" =
      gapCount > 0 ? "non_compliant" : compliantCount === assessments.length ? "compliant" : "at_risk";

    return { framework: framework ?? "all", overall, compliancePct, assessments };
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const auditLogger = new AuditLogger();
export const retentionPolicy = new RetentionPolicy(auditLogger);
export const complianceEvaluator = new ComplianceEvaluator(auditLogger);
