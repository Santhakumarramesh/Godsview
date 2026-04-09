import crypto from "crypto";
import pino from "pino";

const logger = pino({ name: "audit-trail" });

// ── Types ──

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "execute"
  | "approve"
  | "reject"
  | "promote"
  | "demote"
  | "lock"
  | "unlock"
  | "login"
  | "logout"
  | "configure"
  | "deploy"
  | "rollback"
  | "emergency_stop";

export interface AuditEntry {
  id: string;
  timestamp: string;
  actor: string;
  actor_type: "operator" | "system" | "strategy" | "api";
  action: AuditAction;
  resource_type: string;
  resource_id: string;
  details: Record<string, any>;
  outcome: "success" | "failure" | "denied";
  ip_address?: string;
  session_id?: string;
  hash: string;
  previous_hash: string;
}

export interface ComplianceReport {
  id: string;
  report_type: "daily" | "weekly" | "monthly" | "on_demand";
  period_start: string;
  period_end: string;
  generated_at: string;
  generated_by: string;
  summary: ComplianceSummary;
  entries_count: number;
  violations: ComplianceViolation[];
  export_format?: "json" | "csv";
}

export interface ComplianceSummary {
  total_actions: number;
  by_actor_type: Record<string, number>;
  by_action: Record<string, number>;
  by_outcome: Record<string, number>;
  high_risk_actions: number;
  failed_actions: number;
  denied_actions: number;
}

export interface ComplianceViolation {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  rule: string;
  description: string;
  audit_entry_id: string;
  detected_at: string;
  resolved: boolean;
  resolved_by?: string;
  resolved_at?: string;
}

export interface RetentionPolicy {
  resource_type: string;
  retention_days: number;
  archive_after_days?: number;
  delete_after_days?: number;
  updated_at: string;
}

// ── High-risk actions ──

const HIGH_RISK_ACTIONS: AuditAction[] = [
  "delete",
  "execute",
  "deploy",
  "rollback",
  "emergency_stop",
  "promote",
  "demote",
];

// ── Storage ──

const auditEntries: AuditEntry[] = [];
const auditById = new Map<string, AuditEntry>();
const complianceReports = new Map<string, ComplianceReport>();
const violations = new Map<string, ComplianceViolation>();
const retentionPolicies = new Map<string, RetentionPolicy>();

// ── Hash chain helpers ──

function computeHash(
  previous_hash: string,
  action: string,
  resource_type: string,
  resource_id: string,
  actor: string,
  timestamp: string
): string {
  const data = `${previous_hash}${action}${resource_type}${resource_id}${actor}${timestamp}`;
  return crypto.createHash("sha256").update(data).digest("hex");
}

function getLastHash(): string {
  if (auditEntries.length === 0) return "genesis";
  return auditEntries[auditEntries.length - 1].hash;
}

// ── Functions ──

export function recordAudit(
  entry: Omit<AuditEntry, "id" | "timestamp" | "hash" | "previous_hash">
): AuditEntry {
  const id = `aud_${crypto.randomUUID()}`;
  const timestamp = new Date().toISOString();
  const previous_hash = getLastHash();
  const hash = computeHash(
    previous_hash,
    entry.action,
    entry.resource_type,
    entry.resource_id,
    entry.actor,
    timestamp
  );

  const auditEntry: AuditEntry = {
    id,
    timestamp,
    ...entry,
    hash,
    previous_hash,
  };

  auditEntries.push(auditEntry);
  auditById.set(id, auditEntry);
  logger.info({ id, action: entry.action, actor: entry.actor }, "Audit entry recorded");
  return auditEntry;
}

export function getAuditEntry(id: string): AuditEntry | undefined {
  return auditById.get(id);
}

export function getAuditsByActor(actor: string, limit?: number): AuditEntry[] {
  const results = auditEntries.filter((e) => e.actor === actor);
  return limit ? results.slice(-limit) : results;
}

export function getAuditsByResource(
  resource_type: string,
  resource_id: string
): AuditEntry[] {
  return auditEntries.filter(
    (e) => e.resource_type === resource_type && e.resource_id === resource_id
  );
}

export function getAuditsByAction(
  action: AuditAction,
  limit?: number
): AuditEntry[] {
  const results = auditEntries.filter((e) => e.action === action);
  return limit ? results.slice(-limit) : results;
}

export function getAuditsByDateRange(
  start: string,
  end: string
): AuditEntry[] {
  const startDate = new Date(start).getTime();
  const endDate = new Date(end).getTime();
  return auditEntries.filter((e) => {
    const t = new Date(e.timestamp).getTime();
    return t >= startDate && t <= endDate;
  });
}

export function getAllAudits(limit?: number): AuditEntry[] {
  if (limit) return auditEntries.slice(-limit);
  return [...auditEntries];
}

export function verifyChainIntegrity(): {
  valid: boolean;
  broken_at?: string;
  total_entries: number;
} {
  if (auditEntries.length === 0) {
    return { valid: true, total_entries: 0 };
  }

  for (let i = 0; i < auditEntries.length; i++) {
    const entry = auditEntries[i];
    const expectedPrevious = i === 0 ? "genesis" : auditEntries[i - 1].hash;

    if (entry.previous_hash !== expectedPrevious) {
      return {
        valid: false,
        broken_at: entry.id,
        total_entries: auditEntries.length,
      };
    }

    const expectedHash = computeHash(
      entry.previous_hash,
      entry.action,
      entry.resource_type,
      entry.resource_id,
      entry.actor,
      entry.timestamp
    );

    if (entry.hash !== expectedHash) {
      return {
        valid: false,
        broken_at: entry.id,
        total_entries: auditEntries.length,
      };
    }
  }

  return { valid: true, total_entries: auditEntries.length };
}

export function generateComplianceReport(config: {
  report_type: ComplianceReport["report_type"];
  period_start: string;
  period_end: string;
  generated_by: string;
}): ComplianceReport {
  const id = `cr_${crypto.randomUUID()}`;
  const periodEntries = getAuditsByDateRange(
    config.period_start,
    config.period_end
  );

  const by_actor_type: Record<string, number> = {};
  const by_action: Record<string, number> = {};
  const by_outcome: Record<string, number> = {};
  let high_risk_actions = 0;
  let failed_actions = 0;
  let denied_actions = 0;

  for (const entry of periodEntries) {
    by_actor_type[entry.actor_type] =
      (by_actor_type[entry.actor_type] || 0) + 1;
    by_action[entry.action] = (by_action[entry.action] || 0) + 1;
    by_outcome[entry.outcome] = (by_outcome[entry.outcome] || 0) + 1;

    if (HIGH_RISK_ACTIONS.includes(entry.action)) {
      high_risk_actions++;
    }
    if (entry.outcome === "failure") failed_actions++;
    if (entry.outcome === "denied") denied_actions++;
  }

  const summary: ComplianceSummary = {
    total_actions: periodEntries.length,
    by_actor_type,
    by_action,
    by_outcome,
    high_risk_actions,
    failed_actions,
    denied_actions,
  };

  // Collect violations in the period
  const periodViolations: ComplianceViolation[] = [];
  for (const v of violations.values()) {
    const detected = new Date(v.detected_at).getTime();
    const start = new Date(config.period_start).getTime();
    const end = new Date(config.period_end).getTime();
    if (detected >= start && detected <= end) {
      periodViolations.push(v);
    }
  }

  const report: ComplianceReport = {
    id,
    report_type: config.report_type,
    period_start: config.period_start,
    period_end: config.period_end,
    generated_at: new Date().toISOString(),
    generated_by: config.generated_by,
    summary,
    entries_count: periodEntries.length,
    violations: periodViolations,
  };

  complianceReports.set(id, report);
  logger.info({ id, entries: periodEntries.length }, "Compliance report generated");
  return report;
}

export function getComplianceReport(id: string): ComplianceReport | undefined {
  return complianceReports.get(id);
}

export function getAllComplianceReports(limit?: number): ComplianceReport[] {
  const all = Array.from(complianceReports.values());
  if (limit) return all.slice(-limit);
  return all;
}

export function recordViolation(
  violation: Omit<
    ComplianceViolation,
    "id" | "detected_at" | "resolved" | "resolved_by" | "resolved_at"
  >
): ComplianceViolation {
  const id = `cv_${crypto.randomUUID()}`;
  const entry: ComplianceViolation = {
    id,
    ...violation,
    detected_at: new Date().toISOString(),
    resolved: false,
  };
  violations.set(id, entry);
  logger.info({ id, rule: violation.rule, severity: violation.severity }, "Violation recorded");
  return entry;
}

export function resolveViolation(
  violation_id: string,
  resolved_by: string
): { success: boolean; error?: string } {
  const violation = violations.get(violation_id);
  if (!violation) {
    return { success: false, error: "Violation not found" };
  }
  if (violation.resolved) {
    return { success: false, error: "Violation already resolved" };
  }
  violation.resolved = true;
  violation.resolved_by = resolved_by;
  violation.resolved_at = new Date().toISOString();
  logger.info({ id: violation_id, resolved_by }, "Violation resolved");
  return { success: true };
}

export function getUnresolvedViolations(): ComplianceViolation[] {
  return Array.from(violations.values()).filter((v) => !v.resolved);
}

export function setRetentionPolicy(
  policy: Omit<RetentionPolicy, "updated_at">
): void {
  const entry: RetentionPolicy = {
    ...policy,
    updated_at: new Date().toISOString(),
  };
  retentionPolicies.set(policy.resource_type, entry);
  logger.info(
    { resource_type: policy.resource_type, retention_days: policy.retention_days },
    "Retention policy set"
  );
}

export function getRetentionPolicies(): RetentionPolicy[] {
  return Array.from(retentionPolicies.values());
}

export function exportAuditData(
  format: "json" | "csv",
  opts?: { start?: string; end?: string }
): string {
  let entries = [...auditEntries];

  if (opts?.start && opts?.end) {
    entries = getAuditsByDateRange(opts.start, opts.end);
  } else if (opts?.start) {
    const startTime = new Date(opts.start).getTime();
    entries = entries.filter(
      (e) => new Date(e.timestamp).getTime() >= startTime
    );
  } else if (opts?.end) {
    const endTime = new Date(opts.end).getTime();
    entries = entries.filter(
      (e) => new Date(e.timestamp).getTime() <= endTime
    );
  }

  if (format === "json") {
    return JSON.stringify(entries, null, 2);
  }

  // CSV format
  if (entries.length === 0) return "";
  const headers = [
    "id",
    "timestamp",
    "actor",
    "actor_type",
    "action",
    "resource_type",
    "resource_id",
    "outcome",
    "ip_address",
    "session_id",
    "hash",
    "previous_hash",
  ];
  const rows = entries.map((e) =>
    headers
      .map((h) => {
        const val = (e as any)[h];
        if (val === undefined || val === null) return "";
        const str = String(val);
        if (str.includes(",") || str.includes('"') || str.includes("\n")) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      })
      .join(",")
  );
  return [headers.join(","), ...rows].join("\n");
}

export function _clearAudit(): void {
  auditEntries.length = 0;
  auditById.clear();
  complianceReports.clear();
  violations.clear();
  retentionPolicies.clear();
}
