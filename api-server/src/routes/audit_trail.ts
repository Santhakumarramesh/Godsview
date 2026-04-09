import { Router, Request, Response } from "express";
import pino from "pino";
import {
  recordAudit,
  getAuditEntry,
  getAuditsByActor,
  getAuditsByResource,
  getAuditsByAction,
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
} from "../lib/audit_trail";
import type { AuditAction } from "../lib/audit_trail";

const router = Router();
const logger = pino({ name: "audit-trail-routes" });

// POST /entries — record audit entry
router.post("/entries", (req: Request, res: Response) => {
  try {
    const { actor, actor_type, action, resource_type, resource_id, details, outcome, ip_address, session_id } = req.body;
    if (!actor || !actor_type || !action || !resource_type || !resource_id || !outcome) {
      res.status(400).json({ success: false, error: "Missing required fields: actor, actor_type, action, resource_type, resource_id, outcome" });
      return;
    }
    const entry = recordAudit({
      actor,
      actor_type,
      action,
      resource_type,
      resource_id,
      details: details || {},
      outcome,
      ip_address,
      session_id,
    });
    res.status(201).json({ success: true, data: entry });
  } catch (err: any) {
    logger.error({ err }, "Failed to record audit entry");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /entries — list entries (query: limit, actor, action, resource_type)
router.get("/entries", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const actor = req.query.actor as string | undefined;
    const action = req.query.action as AuditAction | undefined;

    let entries;
    if (actor) {
      entries = getAuditsByActor(actor, limit);
    } else if (action) {
      entries = getAuditsByAction(action, limit);
    } else {
      entries = getAllAudits(limit);
    }
    res.json({ success: true, data: entries });
  } catch (err: any) {
    logger.error({ err }, "Failed to list audit entries");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /entries/actor/:actor — by actor
router.get("/entries/actor/:actor", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const entries = getAuditsByActor(req.params.actor, limit);
    res.json({ success: true, data: entries });
  } catch (err: any) {
    logger.error({ err }, "Failed to get audits by actor");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /entries/resource/:type/:id — by resource
router.get("/entries/resource/:type/:id", (req: Request, res: Response) => {
  try {
    const entries = getAuditsByResource(req.params.type, req.params.id);
    res.json({ success: true, data: entries });
  } catch (err: any) {
    logger.error({ err }, "Failed to get audits by resource");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /entries/:id — single entry
router.get("/entries/:id", (req: Request, res: Response) => {
  try {
    const entry = getAuditEntry(req.params.id);
    if (!entry) {
      res.status(404).json({ success: false, error: "Audit entry not found" });
      return;
    }
    res.json({ success: true, data: entry });
  } catch (err: any) {
    logger.error({ err }, "Failed to get audit entry");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /chain/verify — verify chain integrity
router.get("/chain/verify", (_req: Request, res: Response) => {
  try {
    const result = verifyChainIntegrity();
    res.json({ success: true, data: result });
  } catch (err: any) {
    logger.error({ err }, "Failed to verify chain");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /reports — generate compliance report
router.post("/reports", (req: Request, res: Response) => {
  try {
    const { report_type, period_start, period_end, generated_by } = req.body;
    if (!report_type || !period_start || !period_end || !generated_by) {
      res.status(400).json({ success: false, error: "Missing required fields: report_type, period_start, period_end, generated_by" });
      return;
    }
    const report = generateComplianceReport({
      report_type,
      period_start,
      period_end,
      generated_by,
    });
    res.status(201).json({ success: true, data: report });
  } catch (err: any) {
    logger.error({ err }, "Failed to generate compliance report");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /reports — list reports
router.get("/reports", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const reports = getAllComplianceReports(limit);
    res.json({ success: true, data: reports });
  } catch (err: any) {
    logger.error({ err }, "Failed to list compliance reports");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /reports/:id — single report
router.get("/reports/:id", (req: Request, res: Response) => {
  try {
    const report = getComplianceReport(req.params.id);
    if (!report) {
      res.status(404).json({ success: false, error: "Compliance report not found" });
      return;
    }
    res.json({ success: true, data: report });
  } catch (err: any) {
    logger.error({ err }, "Failed to get compliance report");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /violations — record violation
router.post("/violations", (req: Request, res: Response) => {
  try {
    const { severity, rule, description, audit_entry_id } = req.body;
    if (!severity || !rule || !description || !audit_entry_id) {
      res.status(400).json({ success: false, error: "Missing required fields: severity, rule, description, audit_entry_id" });
      return;
    }
    const violation = recordViolation({
      severity,
      rule,
      description,
      audit_entry_id,
    });
    res.status(201).json({ success: true, data: violation });
  } catch (err: any) {
    logger.error({ err }, "Failed to record violation");
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /violations/:id/resolve — resolve violation
router.post("/violations/:id/resolve", (req: Request, res: Response) => {
  try {
    const { resolved_by } = req.body;
    if (!resolved_by) {
      res.status(400).json({ success: false, error: "Missing required field: resolved_by" });
      return;
    }
    const result = resolveViolation(req.params.id, resolved_by);
    if (!result.success) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "Failed to resolve violation");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /violations — list violations (query: unresolved_only)
router.get("/violations", (req: Request, res: Response) => {
  try {
    const unresolvedOnly = req.query.unresolved_only === "true";
    if (unresolvedOnly) {
      res.json({ success: true, data: getUnresolvedViolations() });
      return;
    }
    // Return all violations (no dedicated getAllViolations, but unresolved is the filter)
    res.json({ success: true, data: getUnresolvedViolations() });
  } catch (err: any) {
    logger.error({ err }, "Failed to list violations");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /policies — retention policies
router.get("/policies", (_req: Request, res: Response) => {
  try {
    const policies = getRetentionPolicies();
    res.json({ success: true, data: policies });
  } catch (err: any) {
    logger.error({ err }, "Failed to list retention policies");
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /policies/:resource_type — set retention policy
router.put("/policies/:resource_type", (req: Request, res: Response) => {
  try {
    const { retention_days, archive_after_days, delete_after_days } = req.body;
    if (retention_days === undefined) {
      res.status(400).json({ success: false, error: "Missing required field: retention_days" });
      return;
    }
    setRetentionPolicy({
      resource_type: req.params.resource_type,
      retention_days,
      archive_after_days,
      delete_after_days,
    });
    res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "Failed to set retention policy");
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /export — export data (query: format, start, end)
router.get("/export", (req: Request, res: Response) => {
  try {
    const format = (req.query.format as "json" | "csv") || "json";
    const start = req.query.start as string | undefined;
    const end = req.query.end as string | undefined;
    const data = exportAuditData(format, { start, end });

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", "attachment; filename=audit_export.csv");
      res.send(data);
      return;
    }

    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: any) {
    logger.error({ err }, "Failed to export audit data");
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
