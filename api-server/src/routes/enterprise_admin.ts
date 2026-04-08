/**
 * Enterprise Admin Routes — Phase 24
 *
 * Manages:
 *   Users & Roles       — /users, /roles, /permissions/check
 *   Audit Logging       — /audit
 *   Incidents           — /incidents, /incidents/:id/resolve, /incidents/:id/escalate
 *   SLOs                — /slos/summary, /slos/events
 *   Backups             — /backups
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import {
  createUser,
  getUser,
  listUsers,
  createRole,
  getRole,
  listRoles,
  checkPermission,
} from "../lib/enterprise/rbac_service";
import {
  logAudit,
  getAuditLog,
} from "../lib/enterprise/audit_logger";
import {
  createIncident,
  getIncident,
  getOpenIncidents,
  getAllIncidents,
  acknowledgeIncident,
  escalateIncident,
  resolveIncident,
} from "../lib/enterprise/incident_manager";
import {
  recordSloEvent,
  getSloSummary,
  getSloEvents,
} from "../lib/enterprise/slo_tracker";

const router = Router();

// ── Users ────────────────────────────────────────────────────────

router.post("/users", requireOperator, async (req: Request, res: Response) => {
  try {
    const { email, name, role, actor_id } = req.body;
    if (!email || !name || !role) {
      logAudit(
        actor_id || "unknown",
        "create_user",
        "user",
        undefined,
        { email, name, role },
        false,
        "Missing required fields: email, name, role"
      );
      res.status(400).json({ error: "validation_error", message: "Required: email, name, role" });
      return;
    }

    const user = createUser(email, name, role);
    logAudit(actor_id || "unknown", "create_user", "user", user.id, { email, name, role }, true);
    res.status(201).json(user);
  } catch (err) {
    logger.error({ err }, "Create user error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.get("/users", async (req: Request, res: Response) => {
  try {
    const users = listUsers();
    res.json({ users, count: users.length });
  } catch (err) {
    logger.error({ err }, "List users error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.get("/users/:id", async (req: Request, res: Response) => {
  try {
    const user = getUser(req.params.id);
    if (!user) {
      res.status(404).json({ error: "not_found", message: "User not found" });
      return;
    }
    res.json(user);
  } catch (err) {
    logger.error({ err }, "Get user error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Roles ────────────────────────────────────────────────────────

router.post("/roles", requireOperator, async (req: Request, res: Response) => {
  try {
    const { name, permissions, actor_id } = req.body;
    if (!name || !permissions) {
      logAudit(
        actor_id || "unknown",
        "create_role",
        "role",
        undefined,
        { name, permissions },
        false,
        "Missing required fields: name, permissions"
      );
      res.status(400).json({ error: "validation_error", message: "Required: name, permissions" });
      return;
    }

    const role = createRole(name, permissions);
    logAudit(actor_id || "unknown", "create_role", "role", role.id, { name, permissions }, true);
    res.status(201).json(role);
  } catch (err) {
    logger.error({ err }, "Create role error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.get("/roles", async (req: Request, res: Response) => {
  try {
    const roles = listRoles();
    res.json({ roles, count: roles.length });
  } catch (err) {
    logger.error({ err }, "List roles error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Permissions Check ────────────────────────────────────────────

router.get("/permissions/check", async (req: Request, res: Response) => {
  try {
    const { user_id, permission } = req.query;
    if (!user_id || !permission) {
      res.status(400).json({ error: "validation_error", message: "Required: user_id, permission" });
      return;
    }

    const allowed = checkPermission(user_id as string, permission as string);
    res.json({ user_id, permission, allowed });
  } catch (err) {
    logger.error({ err }, "Check permission error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Audit ────────────────────────────────────────────────────────

router.get("/audit", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const actor_id = req.query.actor_id as string | undefined;
    const action = req.query.action as string | undefined;

    const logs = getAuditLog(limit, actor_id, action);
    res.json({ logs, count: logs.length });
  } catch (err) {
    logger.error({ err }, "Get audit log error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Incidents ────────────────────────────────────────────────────

router.post("/incidents", requireOperator, async (req: Request, res: Response) => {
  try {
    const { severity, category, title, description, affected_strategies, actor_id } = req.body;
    if (!severity || !category || !title) {
      logAudit(
        actor_id || "unknown",
        "create_incident",
        "incident",
        undefined,
        { severity, category, title },
        false,
        "Missing required fields: severity, category, title"
      );
      res.status(400).json({ error: "validation_error", message: "Required: severity, category, title" });
      return;
    }

    const incident = createIncident(severity, category, title, description, affected_strategies);
    logAudit(actor_id || "unknown", "create_incident", "incident", incident.id,
      { severity, category, title }, true);
    res.status(201).json(incident);
  } catch (err) {
    logger.error({ err }, "Create incident error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.get("/incidents", async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const incidents = getAllIncidents(limit);
    res.json({ incidents, count: incidents.length });
  } catch (err) {
    logger.error({ err }, "Get incidents error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.get("/incidents/open", async (req: Request, res: Response) => {
  try {
    const incidents = getOpenIncidents();
    res.json({ incidents, count: incidents.length });
  } catch (err) {
    logger.error({ err }, "Get open incidents error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.post("/incidents/:id/resolve", requireOperator, async (req: Request, res: Response) => {
  try {
    const { resolved_by, notes, actor_id } = req.body;
    if (!resolved_by) {
      logAudit(
        actor_id || "unknown",
        "resolve_incident",
        "incident",
        req.params.id,
        { resolved_by },
        false,
        "Missing required field: resolved_by"
      );
      res.status(400).json({ error: "validation_error", message: "Required: resolved_by" });
      return;
    }

    const incident = resolveIncident(req.params.id, resolved_by, notes);
    logAudit(actor_id || "unknown", "resolve_incident", "incident", incident.id,
      { resolved_by, notes }, true);
    res.json(incident);
  } catch (err) {
    logger.error({ err }, "Resolve incident error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.post("/incidents/:id/escalate", requireOperator, async (req: Request, res: Response) => {
  try {
    const { new_level, actor_id } = req.body;
    if (new_level === undefined) {
      logAudit(
        actor_id || "unknown",
        "escalate_incident",
        "incident",
        req.params.id,
        { new_level },
        false,
        "Missing required field: new_level"
      );
      res.status(400).json({ error: "validation_error", message: "Required: new_level" });
      return;
    }

    const incident = escalateIncident(req.params.id, new_level);
    logAudit(actor_id || "unknown", "escalate_incident", "incident", incident.id,
      { new_level }, true);
    res.json(incident);
  } catch (err) {
    logger.error({ err }, "Escalate incident error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── SLOs ─────────────────────────────────────────────────────────

router.get("/slos/summary", async (req: Request, res: Response) => {
  try {
    const summary = getSloSummary();
    res.json(summary);
  } catch (err) {
    logger.error({ err }, "Get SLO summary error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.post("/slos/events", requireOperator, async (req: Request, res: Response) => {
  try {
    const { slo_name, target, actual, met, actor_id } = req.body;
    if (!slo_name || target === undefined || actual === undefined || met === undefined) {
      logAudit(
        actor_id || "unknown",
        "record_slo_event",
        "slo_event",
        undefined,
        { slo_name, target, actual, met },
        false,
        "Missing required fields: slo_name, target, actual, met"
      );
      res.status(400).json({ error: "validation_error", message: "Required: slo_name, target, actual, met" });
      return;
    }

    const event = recordSloEvent(slo_name, target, actual, met);
    logAudit(actor_id || "unknown", "record_slo_event", "slo_event", event.id,
      { slo_name, target, actual, met }, true);
    res.status(201).json(event);
  } catch (err) {
    logger.error({ err }, "Record SLO event error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Backups (stub) ───────────────────────────────────────────────

interface BackupJob {
  job_id: string;
  backup_type: string;
  status: string;
  started_at: Date;
  created_at: Date;
}

let backupJobs: BackupJob[] = [];

router.get("/backups", async (req: Request, res: Response) => {
  try {
    res.json({ backups: backupJobs, count: backupJobs.length });
  } catch (err) {
    logger.error({ err }, "Get backups error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

router.post("/backups", requireOperator, async (req: Request, res: Response) => {
  try {
    const { backup_type, actor_id } = req.body;
    const job_id = `bkp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const backup: BackupJob = {
      job_id,
      backup_type: backup_type || "full",
      status: "pending",
      started_at: new Date(),
      created_at: new Date(),
    };

    backupJobs.push(backup);
    logAudit(actor_id || "unknown", "trigger_backup", "backup_job", job_id,
      { backup_type }, true);
    res.status(201).json(backup);
  } catch (err) {
    logger.error({ err }, "Trigger backup error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

export default router;
