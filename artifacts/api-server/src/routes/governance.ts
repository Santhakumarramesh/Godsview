/**
 * Governance API routes — Policy management, audit trail, violations, reports
 * Phase 73 (Wave 4.2): Security & Governance
 */

import { Router, type Request, type Response } from "express";
import { getGovernanceEngine, type GovernancePolicy } from "../engines/governance_engine.js";
import { logger } from "../lib/logger.js";

const router = Router();
const governance = getGovernanceEngine();

// ── GET /api/governance/policy ─────────────────────────

/**
 * Retrieve current governance policy
 */
router.get("/api/governance/policy", (req: Request, res: Response) => {
  try {
    const policy = governance.getPolicy();
    res.json({
      status: "success",
      policy,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to get governance policy");
    res.status(500).json({ error: "Failed to retrieve policy" });
  }
});

// ── PUT /api/governance/policy ─────────────────────────

/**
 * Update governance policy (requires admin API key in production)
 */
router.put("/api/governance/policy", (req: Request, res: Response) => {
  try {
    const patch = req.body as Partial<GovernancePolicy>;

    // Validate patch
    if (typeof patch !== "object" || !patch) {
      res.status(400).json({ error: "Invalid policy patch" });
      return;
    }

    const updated = governance.updatePolicy(patch);
    res.json({
      status: "success",
      message: "Policy updated",
      policy: updated,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to update governance policy");
    res.status(500).json({ error: "Failed to update policy" });
  }
});

// ── GET /api/governance/report ─────────────────────────

/**
 * Get comprehensive governance report (daily activity, violations, suspicious activity)
 */
router.get("/api/governance/report", (req: Request, res: Response) => {
  try {
    const report = governance.getGovernanceReport();
    res.json({
      status: "success",
      report,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to generate governance report");
    res.status(500).json({ error: "Failed to generate report" });
  }
});

// ── GET /api/governance/violations ────────────────────

/**
 * Get recent governance violations
 * Query params:
 *   - hours: time window in hours (default 24)
 */
router.get("/api/governance/violations", (req: Request, res: Response) => {
  try {
    const hours = parseInt((req.query.hours as string) || "24", 10);

    if (isNaN(hours) || hours <= 0) {
      res.status(400).json({ error: "hours must be a positive number" });
      return;
    }

    const violations = governance.getViolations(hours);
    res.json({
      status: "success",
      violations,
      count: violations.length,
      window: `${hours} hours`,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to retrieve violations");
    res.status(500).json({ error: "Failed to retrieve violations" });
  }
});

// ── GET /api/governance/audit ──────────────────────────

/**
 * Query audit trail with optional filters
 * Query params:
 *   - hours: time window (default 24)
 *   - apiKey: filter by API key
 *   - path: filter by request path substring
 *   - status: filter by "allowed" or "blocked"
 */
router.get("/api/governance/audit", (req: Request, res: Response) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : undefined;
    const apiKey = req.query.apiKey as string | undefined;
    const path = req.query.path as string | undefined;
    const status = req.query.status as "allowed" | "blocked" | undefined;

    if (hours && (isNaN(hours) || hours <= 0)) {
      res.status(400).json({ error: "hours must be a positive number" });
      return;
    }

    const auditTrail = governance.getAuditTrail({ hours, apiKey, path, status });
    res.json({
      status: "success",
      auditTrail,
      count: auditTrail.length,
      filters: { hours, apiKey, path, status },
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    logger.error({ error: error.message }, "Failed to retrieve audit trail");
    res.status(500).json({ error: "Failed to retrieve audit trail" });
  }
});

// ── Health check ───────────────────────────────────────

router.get("/api/governance/health", (req: Request, res: Response) => {
  const policy = governance.getPolicy();
  const violations = governance.getViolations(1); // Last hour
  res.json({
    status: "healthy",
    policy: {
      requireApiKeyForWrites: policy.requireApiKeyForWrites,
      maxRequestsPerMinute: policy.maxRequestsPerMinute,
      ipWhitelist: policy.ipWhitelist ? "enabled" : "disabled",
      auditingEnabled: policy.auditAllRequests,
    },
    recentViolations: violations.length,
    timestamp: new Date().toISOString(),
  });
});

export default router;
