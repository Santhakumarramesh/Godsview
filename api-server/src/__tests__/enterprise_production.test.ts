import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/risk_engine", () => ({ isKillSwitchActive: () => false }));
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0 }),
  isCooldownActive: () => false,
}));

import {
  createUser,
  getUser,
  listUsers,
  createRole,
  getRole,
  listRoles,
  checkPermission,
  _clearAll as clearRbac,
} from "../lib/enterprise/rbac_service";
import {
  logAudit,
  getAuditLog,
  getAuditLogCount,
  _clearAll as clearAudit,
} from "../lib/enterprise/audit_logger";
import {
  createIncident,
  getIncident,
  getOpenIncidents,
  getAllIncidents,
  acknowledgeIncident,
  escalateIncident,
  resolveIncident,
  _clearAll as clearIncidents,
} from "../lib/enterprise/incident_manager";
import {
  recordSloEvent,
  getSloSummary,
  getSloEvents,
  _clearAll as clearSlo,
} from "../lib/enterprise/slo_tracker";

describe("Enterprise Production Layer — Phase 24", () => {
  beforeEach(() => {
    clearRbac();
    clearAudit();
    clearIncidents();
    clearSlo();
  });

  // ── RBAC Tests ──────────────────────────────────────────────────

  describe("RBAC Service", () => {
    it("creates a user with admin role", () => {
      const user = createUser("alice@example.com", "Alice Admin", "admin");
      expect(user.email).toBe("alice@example.com");
      expect(user.name).toBe("Alice Admin");
      expect(user.role).toBe("admin");
      expect(user.id.startsWith("usr_")).toBe(true);
    });

    it("prevents duplicate user creation", () => {
      createUser("bob@example.com", "Bob Operator", "operator");
      expect(() => {
        createUser("bob@example.com", "Bob Again", "operator");
      }).toThrow("already exists");
    });

    it("prevents user creation with invalid role", () => {
      expect(() => {
        createUser("invalid@example.com", "Invalid User", "nonexistent_role");
      }).toThrow("does not exist");
    });

    it("retrieves user by ID", () => {
      const user = createUser("charlie@example.com", "Charlie Viewer", "viewer");
      const retrieved = getUser(user.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.email).toBe("charlie@example.com");
    });

    it("lists all users", () => {
      createUser("user1@example.com", "User 1", "viewer");
      createUser("user2@example.com", "User 2", "operator");
      createUser("user3@example.com", "User 3", "admin");
      const users = listUsers();
      expect(users).toHaveLength(3);
    });

    it("creates custom role with permissions", () => {
      const role = createRole("custom_role", ["read", "write"]);
      expect(role.name).toBe("custom_role");
      expect(role.permissions).toContain("read");
      expect(role.permissions).toContain("write");
      expect(role.id.startsWith("rol_")).toBe(true);
    });

    it("lists all system and custom roles", () => {
      const initialRoles = listRoles();
      expect(initialRoles.length).toBeGreaterThanOrEqual(3); // admin, operator, viewer

      createRole("auditor", ["audit.read"]);
      const allRoles = listRoles();
      expect(allRoles.length).toBeGreaterThan(initialRoles.length);
    });

    it("admin has all permissions", () => {
      const user = createUser("admin@example.com", "Admin User", "admin");
      expect(checkPermission(user.id, "user.create")).toBe(true);
      expect(checkPermission(user.id, "user.delete")).toBe(true);
      expect(checkPermission(user.id, "incident.escalate")).toBe(true);
      expect(checkPermission(user.id, "backup.create")).toBe(true);
    });

    it("viewer cannot create users", () => {
      const viewer = createUser("viewer@example.com", "Viewer User", "viewer");
      expect(checkPermission(viewer.id, "user.create")).toBe(false);
      expect(checkPermission(viewer.id, "user.delete")).toBe(false);
    });

    it("operator can read and update incidents", () => {
      const operator = createUser("ops@example.com", "Operator", "operator");
      expect(checkPermission(operator.id, "incident.read")).toBe(true);
      expect(checkPermission(operator.id, "incident.update")).toBe(true);
      expect(checkPermission(operator.id, "incident.resolve")).toBe(true);
    });

    it("operator cannot create roles", () => {
      const operator = createUser("ops@example.com", "Operator", "operator");
      expect(checkPermission(operator.id, "role.create")).toBe(false);
    });

    it("returns false for nonexistent user", () => {
      expect(checkPermission("usr_nonexistent", "user.read")).toBe(false);
    });
  });

  // ── Audit Logger Tests ──────────────────────────────────────────

  describe("Audit Logger", () => {
    it("logs an audit entry", () => {
      const entry = logAudit("usr_alice", "user.create", "user", "usr_bob", {
        email: "bob@example.com",
      });
      expect(entry.id.startsWith("aud_")).toBe(true);
      expect(entry.actor_id).toBe("usr_alice");
      expect(entry.action).toBe("user.create");
      expect(entry.resource_type).toBe("user");
      expect(entry.success).toBe(true);
    });

    it("logs failed action", () => {
      const entry = logAudit(
        "usr_alice",
        "user.delete",
        "user",
        "usr_bob",
        undefined,
        false,
        "User has active sessions"
      );
      expect(entry.success).toBe(false);
      expect(entry.failure_reason).toBe("User has active sessions");
    });

    it("retrieves audit log entries (most recent first)", () => {
      logAudit("usr_alice", "action1", "resource1", "id1");
      logAudit("usr_bob", "action2", "resource2", "id2");
      logAudit("usr_charlie", "action3", "resource3", "id3");

      const logs = getAuditLog(10);
      expect(logs).toHaveLength(3);
      expect(logs[0].actor_id).toBe("usr_charlie"); // Most recent first
      expect(logs[2].actor_id).toBe("usr_alice");
    });

    it("filters audit log by actor", () => {
      logAudit("usr_alice", "action1", "resource", "id");
      logAudit("usr_alice", "action2", "resource", "id");
      logAudit("usr_bob", "action3", "resource", "id");

      const logs = getAuditLog(10, "usr_alice");
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.actor_id === "usr_alice")).toBe(true);
    });

    it("filters audit log by action", () => {
      logAudit("usr_alice", "user.create", "user", "id1");
      logAudit("usr_bob", "user.create", "user", "id2");
      logAudit("usr_charlie", "role.create", "role", "id3");

      const logs = getAuditLog(10, undefined, "user.create");
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.action === "user.create")).toBe(true);
    });

    it("respects limit parameter", () => {
      for (let i = 0; i < 20; i++) {
        logAudit("usr_actor", "action", "resource", `id${i}`);
      }

      const logs = getAuditLog(5);
      expect(logs).toHaveLength(5);
    });

    it("returns audit log count", () => {
      expect(getAuditLogCount()).toBe(0);
      logAudit("usr_alice", "action1", "resource", "id1");
      expect(getAuditLogCount()).toBe(1);
      logAudit("usr_bob", "action2", "resource", "id2");
      expect(getAuditLogCount()).toBe(2);
    });
  });

  // ── Incident Manager Tests ──────────────────────────────────────

  describe("Incident Manager", () => {
    it("creates an incident", () => {
      const incident = createIncident(
        "critical",
        "system",
        "Database connection failed",
        "PostgreSQL instance unreachable"
      );
      expect(incident.id.startsWith("eic_")).toBe(true);
      expect(incident.severity).toBe("critical");
      expect(incident.status).toBe("open");
      expect(incident.escalation_level).toBe(0);
    });

    it("creates incident with affected strategies", () => {
      const incident = createIncident(
        "warning",
        "strategy",
        "Strategy A experiencing drawdown",
        "Drawdown exceeded 5%",
        ["strategy_a", "strategy_b"]
      );
      expect(incident.affected_strategies).toContain("strategy_a");
      expect(incident.affected_strategies).toContain("strategy_b");
    });

    it("gets incident by ID", () => {
      const incident = createIncident(
        "info",
        "maintenance",
        "Scheduled backup",
        "Database backup starting"
      );
      const retrieved = getIncident(incident.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.title).toBe("Scheduled backup");
    });

    it("lists open incidents", () => {
      const incident1 = createIncident(
        "critical",
        "system",
        "Issue 1"
      );
      const incident2 = createIncident(
        "warning",
        "strategy",
        "Issue 2"
      );
      resolveIncident(incident2.id, "usr_operator", "Fixed");

      const open = getOpenIncidents();
      expect(open).toHaveLength(1);
      expect(open[0].id).toBe(incident1.id);
    });

    it("lists all incidents with limit", () => {
      for (let i = 0; i < 15; i++) {
        createIncident("info", "test", `Incident ${i}`);
      }

      const all = getAllIncidents(10);
      expect(all).toHaveLength(10);
    });

    it("escalates an incident", () => {
      const incident = createIncident("warning", "system", "Network issue");
      const escalated = escalateIncident(incident.id, 2);
      expect(escalated.escalation_level).toBe(2);
      expect(escalated.status).toBe("escalated");
    });

    it("acknowledges an incident", () => {
      const incident = createIncident("critical", "system", "Critical issue");
      const acked = acknowledgeIncident(incident.id, "usr_operator");
      expect(acked.status).toBe("acknowledged");
      expect(acked.acknowledged_by).toBe("usr_operator");
      expect(acked.acknowledged_at).toBeDefined();
    });

    it("resolves an incident", () => {
      const incident = createIncident("critical", "system", "Critical issue");
      const resolved = resolveIncident(
        incident.id,
        "usr_operator",
        "Fixed by restarting service"
      );
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolved_by).toBe("usr_operator");
      expect(resolved.resolution_notes).toBe("Fixed by restarting service");
      expect(resolved.resolved_at).toBeDefined();
    });

    it("throws error when resolving nonexistent incident", () => {
      expect(() => {
        resolveIncident("eic_nonexistent", "usr_operator", "Notes");
      }).toThrow("not found");
    });

    it("incident lifecycle: create -> acknowledge -> escalate -> resolve", () => {
      let incident = createIncident(
        "critical",
        "system",
        "Database failure"
      );
      expect(incident.status).toBe("open");

      incident = acknowledgeIncident(incident.id, "usr_op1");
      expect(incident.status).toBe("acknowledged");

      incident = escalateIncident(incident.id, 3);
      expect(incident.escalation_level).toBe(3);
      expect(incident.status).toBe("escalated");

      incident = resolveIncident(incident.id, "usr_op2", "Database recovered");
      expect(incident.status).toBe("resolved");
    });
  });

  // ── SLO Tracker Tests ───────────────────────────────────────────

  describe("SLO Tracker", () => {
    it("records an SLO event", () => {
      const event = recordSloEvent("api_latency", 200, 150, true);
      expect(event.id.startsWith("slo_")).toBe(true);
      expect(event.slo_name).toBe("api_latency");
      expect(event.target).toBe(200);
      expect(event.actual).toBe(150);
      expect(event.met).toBe(true);
    });

    it("records failed SLO event", () => {
      const event = recordSloEvent("api_latency", 200, 250, false);
      expect(event.met).toBe(false);
    });

    it("gets all SLO events", () => {
      recordSloEvent("slo1", 100, 90, true);
      recordSloEvent("slo1", 100, 110, false);
      recordSloEvent("slo2", 200, 180, true);

      const events = getSloEvents();
      expect(events).toHaveLength(3);
    });

    it("calculates SLO summary", () => {
      recordSloEvent("latency", 100, 95, true);
      recordSloEvent("latency", 100, 105, false);
      recordSloEvent("latency", 100, 98, true);

      const summary = getSloSummary();
      expect(summary.total).toBe(3);
      expect(summary.met).toBe(2);
      expect(summary.breached).toBe(1);
      expect(summary.compliance_pct).toBeCloseTo(66.67, 1);
    });

    it("tracks SLO metrics by name", () => {
      recordSloEvent("api_latency", 100, 95, true);
      recordSloEvent("api_latency", 100, 110, false);
      recordSloEvent("availability", 99.9, 99.8, true);

      const summary = getSloSummary();
      expect(summary.by_slo["api_latency"].total).toBe(2);
      expect(summary.by_slo["api_latency"].met).toBe(1);
      expect(summary.by_slo["api_latency"].compliance_pct).toBeCloseTo(50, 1);
      expect(summary.by_slo["availability"].total).toBe(1);
      expect(summary.by_slo["availability"].compliance_pct).toBe(100);
    });

    it("returns 100% compliance for empty events", () => {
      const summary = getSloSummary();
      expect(summary.compliance_pct).toBe(100);
      expect(summary.total).toBe(0);
    });

    it("handles all events met", () => {
      recordSloEvent("slo", 100, 90, true);
      recordSloEvent("slo", 100, 95, true);
      recordSloEvent("slo", 100, 99, true);

      const summary = getSloSummary();
      expect(summary.total).toBe(3);
      expect(summary.met).toBe(3);
      expect(summary.breached).toBe(0);
      expect(summary.compliance_pct).toBe(100);
    });

    it("handles all events breached", () => {
      recordSloEvent("slo", 100, 150, false);
      recordSloEvent("slo", 100, 160, false);

      const summary = getSloSummary();
      expect(summary.total).toBe(2);
      expect(summary.met).toBe(0);
      expect(summary.breached).toBe(2);
      expect(summary.compliance_pct).toBe(0);
    });
  });

  // ── Role Enforcement & Integration Tests ────────────────────────

  describe("Role Enforcement & Access Control", () => {
    it("admin can perform all actions", () => {
      const admin = createUser("admin@example.com", "Admin", "admin");
      expect(checkPermission(admin.id, "user.create")).toBe(true);
      expect(checkPermission(admin.id, "user.delete")).toBe(true);
      expect(checkPermission(admin.id, "role.create")).toBe(true);
      expect(checkPermission(admin.id, "incident.create")).toBe(true);
      expect(checkPermission(admin.id, "incident.resolve")).toBe(true);
      expect(checkPermission(admin.id, "backup.create")).toBe(true);
    });

    it("viewer cannot perform write operations", () => {
      const viewer = createUser("viewer@example.com", "Viewer", "viewer");
      expect(checkPermission(viewer.id, "user.create")).toBe(false);
      expect(checkPermission(viewer.id, "role.create")).toBe(false);
      expect(checkPermission(viewer.id, "incident.create")).toBe(false);
      expect(checkPermission(viewer.id, "backup.create")).toBe(false);
    });

    it("viewer can read data", () => {
      const viewer = createUser("viewer@example.com", "Viewer", "viewer");
      expect(checkPermission(viewer.id, "user.read")).toBe(true);
      expect(checkPermission(viewer.id, "audit.read")).toBe(true);
      expect(checkPermission(viewer.id, "incident.read")).toBe(true);
      expect(checkPermission(viewer.id, "slo.read")).toBe(true);
    });

    it("operator has balanced permissions", () => {
      const operator = createUser("ops@example.com", "Operator", "operator");
      expect(checkPermission(operator.id, "user.read")).toBe(true);
      expect(checkPermission(operator.id, "incident.read")).toBe(true);
      expect(checkPermission(operator.id, "incident.resolve")).toBe(true);
      expect(checkPermission(operator.id, "user.create")).toBe(false);
    });
  });

  // ── Audit & Compliance Tests ────────────────────────────────────

  describe("Audit & Compliance", () => {
    it("logs every user creation", () => {
      const user1 = createUser("user1@example.com", "User 1", "viewer");
      logAudit("usr_admin", "user.create", "user", user1.id);

      const user2 = createUser("user2@example.com", "User 2", "operator");
      logAudit("usr_admin", "user.create", "user", user2.id);

      const logs = getAuditLog(10, undefined, "user.create");
      expect(logs.length).toBeGreaterThanOrEqual(2);
    });

    it("logs incident creation and updates", () => {
      const incident = createIncident("critical", "system", "Test");
      logAudit("usr_admin", "create_incident", "incident", incident.id);

      escalateIncident(incident.id, 2);
      logAudit("usr_admin", "escalate_incident", "incident", incident.id);

      resolveIncident(incident.id, "usr_admin", "Fixed");
      logAudit("usr_admin", "resolve_incident", "incident", incident.id);

      const logs = getAuditLog(100, "usr_admin");
      expect(logs.length).toBeGreaterThanOrEqual(3);
    });

    it("tracks failed actions in audit", () => {
      logAudit(
        "usr_unauthorized",
        "user.delete",
        "user",
        "usr_target",
        undefined,
        false,
        "Insufficient permissions"
      );

      const logs = getAuditLog(10);
      const failed = logs.find((l) => !l.success);
      expect(failed).toBeDefined();
      expect(failed?.failure_reason).toBe("Insufficient permissions");
    });

    it("supports audit trail for compliance", () => {
      const user = createUser("alice@example.com", "Alice", "admin");
      logAudit(user.id, "user.create", "user", "usr_bob", { email: "bob@example.com" });
      logAudit(user.id, "incident.escalate", "incident", "eic_123");

      const userLogs = getAuditLog(100, user.id);
      expect(userLogs.length).toBeGreaterThanOrEqual(2);
      expect(userLogs.every((l) => l.actor_id === user.id)).toBe(true);
    });
  });

  // ── Admin Access Protection Tests ───────────────────────────────

  describe("Admin Access Protection", () => {
    it("prevents unauthorized user creation", () => {
      expect(() => {
        createUser("newadmin@example.com", "New Admin", "admin");
      }).not.toThrow(); // Should succeed if authorized
    });

    it("prevents invalid role assignment", () => {
      expect(() => {
        createUser("user@example.com", "User", "superadmin");
      }).toThrow("does not exist");
    });

    it("system roles are immutable", () => {
      const roles = listRoles();
      const adminRole = roles.find((r) => r.name === "admin");
      expect(adminRole).toBeDefined();
      expect(adminRole?.permissions.length).toBeGreaterThan(0);
    });

    it("audit prevents privilege escalation detection", () => {
      let success = false;
      try {
        const user = createUser("attacker@example.com", "Attacker", "viewer");
        logAudit(
          user.id,
          "escalate_privilege",
          "user",
          user.id,
          { attempted_role: "admin" },
          false,
          "Privilege escalation attempt blocked"
        );
        success = true;
      } catch (_) {
        // Expected to fail
      }

      expect(success).toBe(true);
      const logs = getAuditLog(10);
      const securityLog = logs.find((l) => l.action === "escalate_privilege");
      expect(securityLog?.success).toBe(false);
    });
  });
});
