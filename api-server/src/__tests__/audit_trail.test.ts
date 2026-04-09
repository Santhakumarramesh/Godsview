import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

import {
  recordAudit,
  getAuditEntry,
  getAuditsByActor,
  getAuditsByResource,
  getAuditsByAction,
  getAuditsByDateRange,
  getAllAudits,
  verifyChainIntegrity,
  generateComplianceReport,
  getComplianceReport,
  getAllComplianceReports,
  recordViolation,
  resolveViolation,
  getUnresolvedViolations,
  setRetentionPolicy,
  getRetentionPolicies,
  exportAuditData,
  _clearAudit,
} from "../lib/audit_trail";

describe("Phase 45 — Audit Trail & Compliance", () => {
  beforeEach(() => {
    _clearAudit();
  });

  // ── Audit Entry Recording ──

  describe("recordAudit", () => {
    it("should record an audit entry with auto-generated fields", () => {
      const entry = recordAudit({
        actor: "operator_1",
        actor_type: "operator",
        action: "create",
        resource_type: "strategy",
        resource_id: "strat_001",
        details: { name: "momentum" },
        outcome: "success",
      });

      expect(entry.id).toMatch(/^aud_/);
      expect(entry.timestamp).toBeTruthy();
      expect(entry.hash).toBeTruthy();
      expect(entry.previous_hash).toBe("genesis");
      expect(entry.actor).toBe("operator_1");
      expect(entry.action).toBe("create");
      expect(entry.outcome).toBe("success");
    });

    it("should chain hashes for consecutive entries", () => {
      const first = recordAudit({
        actor: "system",
        actor_type: "system",
        action: "execute",
        resource_type: "order",
        resource_id: "ord_001",
        details: {},
        outcome: "success",
      });

      const second = recordAudit({
        actor: "system",
        actor_type: "system",
        action: "execute",
        resource_type: "order",
        resource_id: "ord_002",
        details: {},
        outcome: "success",
      });

      expect(first.previous_hash).toBe("genesis");
      expect(second.previous_hash).toBe(first.hash);
      expect(second.hash).not.toBe(first.hash);
    });

    it("should include optional fields", () => {
      const entry = recordAudit({
        actor: "api_user",
        actor_type: "api",
        action: "login",
        resource_type: "session",
        resource_id: "sess_001",
        details: {},
        outcome: "success",
        ip_address: "192.168.1.1",
        session_id: "sess_abc",
      });

      expect(entry.ip_address).toBe("192.168.1.1");
      expect(entry.session_id).toBe("sess_abc");
    });

    it("should support all action types", () => {
      const actions = [
        "create", "update", "delete", "execute", "approve", "reject",
        "promote", "demote", "lock", "unlock", "login", "logout",
        "configure", "deploy", "rollback", "emergency_stop",
      ] as const;

      for (const action of actions) {
        const entry = recordAudit({
          actor: "test",
          actor_type: "system",
          action,
          resource_type: "test",
          resource_id: "t_001",
          details: {},
          outcome: "success",
        });
        expect(entry.action).toBe(action);
      }
    });

    it("should support all actor types", () => {
      const types = ["operator", "system", "strategy", "api"] as const;
      for (const actor_type of types) {
        const entry = recordAudit({
          actor: "test",
          actor_type,
          action: "create",
          resource_type: "test",
          resource_id: "t_001",
          details: {},
          outcome: "success",
        });
        expect(entry.actor_type).toBe(actor_type);
      }
    });

    it("should support all outcome types", () => {
      const outcomes = ["success", "failure", "denied"] as const;
      for (const outcome of outcomes) {
        const entry = recordAudit({
          actor: "test",
          actor_type: "system",
          action: "create",
          resource_type: "test",
          resource_id: "t_001",
          details: {},
          outcome,
        });
        expect(entry.outcome).toBe(outcome);
      }
    });
  });

  // ── Retrieval ──

  describe("getAuditEntry", () => {
    it("should retrieve entry by ID", () => {
      const entry = recordAudit({
        actor: "op1",
        actor_type: "operator",
        action: "create",
        resource_type: "strategy",
        resource_id: "s1",
        details: {},
        outcome: "success",
      });

      const found = getAuditEntry(entry.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(entry.id);
    });

    it("should return undefined for missing ID", () => {
      expect(getAuditEntry("aud_nonexistent")).toBeUndefined();
    });
  });

  describe("getAuditsByActor", () => {
    it("should filter by actor", () => {
      recordAudit({ actor: "alice", actor_type: "operator", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      recordAudit({ actor: "bob", actor_type: "operator", action: "update", resource_type: "s", resource_id: "2", details: {}, outcome: "success" });
      recordAudit({ actor: "alice", actor_type: "operator", action: "delete", resource_type: "s", resource_id: "3", details: {}, outcome: "success" });

      const aliceEntries = getAuditsByActor("alice");
      expect(aliceEntries).toHaveLength(2);
      expect(aliceEntries.every((e) => e.actor === "alice")).toBe(true);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        recordAudit({ actor: "alice", actor_type: "operator", action: "create", resource_type: "s", resource_id: `${i}`, details: {}, outcome: "success" });
      }
      const limited = getAuditsByActor("alice", 2);
      expect(limited).toHaveLength(2);
    });
  });

  describe("getAuditsByResource", () => {
    it("should filter by resource type and id", () => {
      recordAudit({ actor: "sys", actor_type: "system", action: "create", resource_type: "strategy", resource_id: "s1", details: {}, outcome: "success" });
      recordAudit({ actor: "sys", actor_type: "system", action: "update", resource_type: "strategy", resource_id: "s1", details: {}, outcome: "success" });
      recordAudit({ actor: "sys", actor_type: "system", action: "create", resource_type: "order", resource_id: "o1", details: {}, outcome: "success" });

      const results = getAuditsByResource("strategy", "s1");
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.resource_type === "strategy" && e.resource_id === "s1")).toBe(true);
    });
  });

  describe("getAuditsByAction", () => {
    it("should filter by action type", () => {
      recordAudit({ actor: "sys", actor_type: "system", action: "deploy", resource_type: "release", resource_id: "r1", details: {}, outcome: "success" });
      recordAudit({ actor: "sys", actor_type: "system", action: "create", resource_type: "strategy", resource_id: "s1", details: {}, outcome: "success" });
      recordAudit({ actor: "sys", actor_type: "system", action: "deploy", resource_type: "release", resource_id: "r2", details: {}, outcome: "success" });

      const deploys = getAuditsByAction("deploy");
      expect(deploys).toHaveLength(2);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 5; i++) {
        recordAudit({ actor: "sys", actor_type: "system", action: "execute", resource_type: "o", resource_id: `${i}`, details: {}, outcome: "success" });
      }
      expect(getAuditsByAction("execute", 3)).toHaveLength(3);
    });
  });

  describe("getAuditsByDateRange", () => {
    it("should filter by date range", () => {
      const e1 = recordAudit({ actor: "sys", actor_type: "system", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });

      const start = new Date(Date.now() - 60000).toISOString();
      const end = new Date(Date.now() + 60000).toISOString();

      const results = getAuditsByDateRange(start, end);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results.some((e) => e.id === e1.id)).toBe(true);
    });

    it("should return empty for out-of-range dates", () => {
      recordAudit({ actor: "sys", actor_type: "system", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });

      const results = getAuditsByDateRange("2020-01-01T00:00:00Z", "2020-01-02T00:00:00Z");
      expect(results).toHaveLength(0);
    });
  });

  describe("getAllAudits", () => {
    it("should return all entries", () => {
      recordAudit({ actor: "a", actor_type: "system", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      recordAudit({ actor: "b", actor_type: "system", action: "create", resource_type: "s", resource_id: "2", details: {}, outcome: "success" });

      expect(getAllAudits()).toHaveLength(2);
    });

    it("should respect limit", () => {
      for (let i = 0; i < 10; i++) {
        recordAudit({ actor: "sys", actor_type: "system", action: "create", resource_type: "s", resource_id: `${i}`, details: {}, outcome: "success" });
      }
      expect(getAllAudits(5)).toHaveLength(5);
    });
  });

  // ── Chain Integrity ──

  describe("verifyChainIntegrity", () => {
    it("should verify valid chain", () => {
      recordAudit({ actor: "a", actor_type: "system", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      recordAudit({ actor: "b", actor_type: "system", action: "update", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      recordAudit({ actor: "c", actor_type: "system", action: "delete", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });

      const result = verifyChainIntegrity();
      expect(result.valid).toBe(true);
      expect(result.total_entries).toBe(3);
      expect(result.broken_at).toBeUndefined();
    });

    it("should return valid for empty chain", () => {
      const result = verifyChainIntegrity();
      expect(result.valid).toBe(true);
      expect(result.total_entries).toBe(0);
    });

    it("should return valid for single entry", () => {
      recordAudit({ actor: "a", actor_type: "system", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });

      const result = verifyChainIntegrity();
      expect(result.valid).toBe(true);
      expect(result.total_entries).toBe(1);
    });

    it("should have genesis as first previous_hash", () => {
      const entry = recordAudit({ actor: "a", actor_type: "system", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      expect(entry.previous_hash).toBe("genesis");
    });
  });

  // ── Compliance Reports ──

  describe("generateComplianceReport", () => {
    it("should generate report with summary", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = new Date(now.getTime() + 3600000).toISOString();

      recordAudit({ actor: "op1", actor_type: "operator", action: "create", resource_type: "strategy", resource_id: "s1", details: {}, outcome: "success" });
      recordAudit({ actor: "sys", actor_type: "system", action: "execute", resource_type: "order", resource_id: "o1", details: {}, outcome: "success" });
      recordAudit({ actor: "op1", actor_type: "operator", action: "deploy", resource_type: "release", resource_id: "r1", details: {}, outcome: "failure" });

      const report = generateComplianceReport({
        report_type: "daily",
        period_start: start,
        period_end: end,
        generated_by: "compliance_officer",
      });

      expect(report.id).toMatch(/^cr_/);
      expect(report.report_type).toBe("daily");
      expect(report.generated_by).toBe("compliance_officer");
      expect(report.entries_count).toBe(3);
      expect(report.summary.total_actions).toBe(3);
      expect(report.summary.by_actor_type["operator"]).toBe(2);
      expect(report.summary.by_actor_type["system"]).toBe(1);
      expect(report.summary.by_action["create"]).toBe(1);
      expect(report.summary.by_action["execute"]).toBe(1);
      expect(report.summary.by_action["deploy"]).toBe(1);
      expect(report.summary.by_outcome["success"]).toBe(2);
      expect(report.summary.by_outcome["failure"]).toBe(1);
    });

    it("should count high-risk actions", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = new Date(now.getTime() + 3600000).toISOString();

      recordAudit({ actor: "op", actor_type: "operator", action: "delete", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      recordAudit({ actor: "op", actor_type: "operator", action: "execute", resource_type: "s", resource_id: "2", details: {}, outcome: "success" });
      recordAudit({ actor: "op", actor_type: "operator", action: "emergency_stop", resource_type: "s", resource_id: "3", details: {}, outcome: "success" });
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "4", details: {}, outcome: "success" });

      const report = generateComplianceReport({
        report_type: "on_demand",
        period_start: start,
        period_end: end,
        generated_by: "auditor",
      });

      expect(report.summary.high_risk_actions).toBe(3);
    });

    it("should count failed and denied actions", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = new Date(now.getTime() + 3600000).toISOString();

      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "failure" });
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "2", details: {}, outcome: "denied" });
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "3", details: {}, outcome: "denied" });
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "4", details: {}, outcome: "success" });

      const report = generateComplianceReport({
        report_type: "weekly",
        period_start: start,
        period_end: end,
        generated_by: "auditor",
      });

      expect(report.summary.failed_actions).toBe(1);
      expect(report.summary.denied_actions).toBe(2);
    });

    it("should include period violations", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = new Date(now.getTime() + 3600000).toISOString();

      const entry = recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });

      recordViolation({
        severity: "high",
        rule: "no_unauth_deploy",
        description: "Unauthorized deployment",
        audit_entry_id: entry.id,
      });

      const report = generateComplianceReport({
        report_type: "daily",
        period_start: start,
        period_end: end,
        generated_by: "auditor",
      });

      expect(report.violations.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("getComplianceReport", () => {
    it("should retrieve report by ID", () => {
      const now = new Date();
      const report = generateComplianceReport({
        report_type: "monthly",
        period_start: new Date(now.getTime() - 86400000).toISOString(),
        period_end: now.toISOString(),
        generated_by: "admin",
      });

      const found = getComplianceReport(report.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(report.id);
    });

    it("should return undefined for missing report", () => {
      expect(getComplianceReport("cr_nonexistent")).toBeUndefined();
    });
  });

  describe("getAllComplianceReports", () => {
    it("should list all reports", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = now.toISOString();

      generateComplianceReport({ report_type: "daily", period_start: start, period_end: end, generated_by: "a" });
      generateComplianceReport({ report_type: "weekly", period_start: start, period_end: end, generated_by: "b" });

      expect(getAllComplianceReports()).toHaveLength(2);
    });

    it("should respect limit", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = now.toISOString();

      for (let i = 0; i < 5; i++) {
        generateComplianceReport({ report_type: "daily", period_start: start, period_end: end, generated_by: `user_${i}` });
      }
      expect(getAllComplianceReports(3)).toHaveLength(3);
    });
  });

  // ── Violations ──

  describe("recordViolation", () => {
    it("should record a violation", () => {
      const v = recordViolation({
        severity: "critical",
        rule: "max_position_limit",
        description: "Position exceeded maximum size",
        audit_entry_id: "aud_123",
      });

      expect(v.id).toMatch(/^cv_/);
      expect(v.severity).toBe("critical");
      expect(v.rule).toBe("max_position_limit");
      expect(v.resolved).toBe(false);
      expect(v.detected_at).toBeTruthy();
    });
  });

  describe("resolveViolation", () => {
    it("should resolve a violation", () => {
      const v = recordViolation({
        severity: "high",
        rule: "test_rule",
        description: "Test",
        audit_entry_id: "aud_x",
      });

      const result = resolveViolation(v.id, "admin");
      expect(result.success).toBe(true);

      const unresolved = getUnresolvedViolations();
      expect(unresolved).toHaveLength(0);
    });

    it("should return error for missing violation", () => {
      const result = resolveViolation("cv_nonexistent", "admin");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Violation not found");
    });

    it("should return error for already resolved violation", () => {
      const v = recordViolation({
        severity: "low",
        rule: "test",
        description: "Test",
        audit_entry_id: "aud_x",
      });

      resolveViolation(v.id, "admin");
      const result = resolveViolation(v.id, "admin2");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Violation already resolved");
    });
  });

  describe("getUnresolvedViolations", () => {
    it("should return only unresolved violations", () => {
      const v1 = recordViolation({ severity: "high", rule: "r1", description: "d1", audit_entry_id: "a1" });
      recordViolation({ severity: "low", rule: "r2", description: "d2", audit_entry_id: "a2" });

      resolveViolation(v1.id, "admin");

      const unresolved = getUnresolvedViolations();
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].rule).toBe("r2");
    });
  });

  // ── Retention Policies ──

  describe("setRetentionPolicy", () => {
    it("should set a retention policy", () => {
      setRetentionPolicy({
        resource_type: "audit_entries",
        retention_days: 365,
        archive_after_days: 90,
        delete_after_days: 730,
      });

      const policies = getRetentionPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].resource_type).toBe("audit_entries");
      expect(policies[0].retention_days).toBe(365);
      expect(policies[0].archive_after_days).toBe(90);
      expect(policies[0].updated_at).toBeTruthy();
    });

    it("should overwrite existing policy for same resource type", () => {
      setRetentionPolicy({ resource_type: "logs", retention_days: 30 });
      setRetentionPolicy({ resource_type: "logs", retention_days: 60 });

      const policies = getRetentionPolicies();
      expect(policies).toHaveLength(1);
      expect(policies[0].retention_days).toBe(60);
    });

    it("should support multiple resource types", () => {
      setRetentionPolicy({ resource_type: "audit_entries", retention_days: 365 });
      setRetentionPolicy({ resource_type: "compliance_reports", retention_days: 730 });
      setRetentionPolicy({ resource_type: "violations", retention_days: 1095 });

      expect(getRetentionPolicies()).toHaveLength(3);
    });
  });

  // ── Export ──

  describe("exportAuditData", () => {
    it("should export to JSON format", () => {
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "1", details: { key: "val" }, outcome: "success" });

      const json = exportAuditData("json");
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].actor).toBe("op");
    });

    it("should export to CSV format", () => {
      recordAudit({ actor: "op1", actor_type: "operator", action: "create", resource_type: "strategy", resource_id: "s1", details: {}, outcome: "success" });
      recordAudit({ actor: "op2", actor_type: "operator", action: "update", resource_type: "strategy", resource_id: "s2", details: {}, outcome: "failure" });

      const csv = exportAuditData("csv");
      const lines = csv.split("\n");
      expect(lines.length).toBe(3); // header + 2 data rows
      expect(lines[0]).toContain("id,timestamp,actor");
      expect(lines[1]).toContain("op1");
      expect(lines[2]).toContain("op2");
    });

    it("should return empty string for empty CSV export", () => {
      const csv = exportAuditData("csv");
      expect(csv).toBe("");
    });

    it("should export JSON for empty data", () => {
      const json = exportAuditData("json");
      expect(JSON.parse(json)).toEqual([]);
    });

    it("should filter by date range", () => {
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });

      const futureStart = new Date(Date.now() + 86400000).toISOString();
      const futureEnd = new Date(Date.now() + 172800000).toISOString();

      const json = exportAuditData("json", { start: futureStart, end: futureEnd });
      expect(JSON.parse(json)).toHaveLength(0);
    });

    it("should handle CSV values with commas", () => {
      recordAudit({
        actor: "op,special",
        actor_type: "operator",
        action: "create",
        resource_type: "strategy",
        resource_id: "s1",
        details: {},
        outcome: "success",
      });

      const csv = exportAuditData("csv");
      expect(csv).toContain('"op,special"');
    });
  });

  // ── Integration ──

  describe("integration", () => {
    it("should maintain chain integrity across many entries", () => {
      for (let i = 0; i < 20; i++) {
        recordAudit({
          actor: `actor_${i % 3}`,
          actor_type: i % 2 === 0 ? "operator" : "system",
          action: i % 4 === 0 ? "deploy" : "create",
          resource_type: "resource",
          resource_id: `r_${i}`,
          details: { index: i },
          outcome: i % 5 === 0 ? "failure" : "success",
        });
      }

      const integrity = verifyChainIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.total_entries).toBe(20);
    });

    it("should support full audit-to-compliance workflow", () => {
      const now = new Date();
      const start = new Date(now.getTime() - 3600000).toISOString();
      const end = new Date(now.getTime() + 3600000).toISOString();

      // Record various actions
      const e1 = recordAudit({ actor: "op1", actor_type: "operator", action: "deploy", resource_type: "release", resource_id: "r1", details: {}, outcome: "success" });
      recordAudit({ actor: "sys", actor_type: "system", action: "execute", resource_type: "order", resource_id: "o1", details: {}, outcome: "success" });
      recordAudit({ actor: "op1", actor_type: "operator", action: "emergency_stop", resource_type: "system", resource_id: "sys1", details: {}, outcome: "success" });

      // Record a violation
      const violation = recordViolation({
        severity: "critical",
        rule: "unauthorized_deploy",
        description: "Deploy without approval",
        audit_entry_id: e1.id,
      });

      // Generate report
      const report = generateComplianceReport({
        report_type: "on_demand",
        period_start: start,
        period_end: end,
        generated_by: "compliance_team",
      });

      expect(report.entries_count).toBe(3);
      expect(report.summary.high_risk_actions).toBe(3); // deploy + execute + emergency_stop
      expect(report.violations.length).toBeGreaterThanOrEqual(1);

      // Resolve violation
      const resolved = resolveViolation(violation.id, "manager");
      expect(resolved.success).toBe(true);
      expect(getUnresolvedViolations()).toHaveLength(0);

      // Verify chain
      const chain = verifyChainIntegrity();
      expect(chain.valid).toBe(true);

      // Export
      const exported = exportAuditData("json");
      const data = JSON.parse(exported);
      expect(data).toHaveLength(3);
    });

    it("should clear all data", () => {
      recordAudit({ actor: "op", actor_type: "operator", action: "create", resource_type: "s", resource_id: "1", details: {}, outcome: "success" });
      recordViolation({ severity: "low", rule: "r", description: "d", audit_entry_id: "a" });
      setRetentionPolicy({ resource_type: "audit", retention_days: 30 });
      const now = new Date();
      generateComplianceReport({
        report_type: "daily",
        period_start: new Date(now.getTime() - 3600000).toISOString(),
        period_end: now.toISOString(),
        generated_by: "test",
      });

      _clearAudit();

      expect(getAllAudits()).toHaveLength(0);
      expect(getUnresolvedViolations()).toHaveLength(0);
      expect(getRetentionPolicies()).toHaveLength(0);
      expect(getAllComplianceReports()).toHaveLength(0);
      expect(verifyChainIntegrity().total_entries).toBe(0);
    });
  });
});
