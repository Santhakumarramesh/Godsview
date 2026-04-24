/**
 * ops_security.ts — Phase 115: Ops, Security & Failure Testing Router
 *
 * Endpoints:
 *  - GET  /ops-security/security/audit           → run security audit
 *  - GET  /ops-security/security/score           → security score + breakdown
 *  - GET  /ops-security/security/history         → audit history
 *  - POST /ops-security/chaos/run                → run chaos test scenario
 *  - GET  /ops-security/chaos/results            → all chaos test results
 *  - GET  /ops-security/chaos/resiliency        → resiliency matrix
 *  - GET  /ops-security/chaos/recovery          → recovery metrics
 *  - GET  /ops-security/ops/snapshot             → current ops snapshot
 *  - GET  /ops-security/ops/incidents            → incident log
 *  - POST /ops-security/ops/incidents            → log incident
 *  - PATCH /ops-security/ops/incidents/:id/resolve → resolve incident
 *  - GET  /ops-security/ops/runbook/:component   → component runbook
 *  - GET  /ops-security/deploy/gate              → pre-deploy checks
 *  - GET  /ops-security/deploy/history           → deployment history
 *  - POST /ops-security/deploy/record            → record deployment
 */

import { Router, type Request, type Response } from "express";
import {
  SecurityAuditEngine,
  FailureTestEngine,
  OpsHealthEngine,
  DeploymentGateEngine,
} from "../lib/ops_security/index.js";

const router = Router();

// ── Engines ────────────────────────────────────────────────────────────────
const securityAudit = new SecurityAuditEngine();
const failureTest = new FailureTestEngine();
const opsHealth = new OpsHealthEngine();
const deploymentGate = new DeploymentGateEngine();

// ============================================================================
// SECURITY AUDIT ENDPOINTS
// ============================================================================

router.get("/ops-security/security/audit", (_req: Request, res: Response) => {
  try {
    const result = securityAudit.runSecurityAudit();
    res.json({
      ok: true,
      audit: result,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/security/score", (_req: Request, res: Response) => {
  try {
    const { score, breakdown } = securityAudit.getSecurityScore();
    res.json({
      ok: true,
      score,
      breakdown,
      riskLevel: score >= 80 ? "low" : score >= 60 ? "medium" : score >= 40 ? "high" : "critical",
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/security/history", (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const history = securityAudit.getAuditHistory(limit);
    res.json({
      ok: true,
      count: history.length,
      history,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// CHAOS TEST ENDPOINTS
// ============================================================================

router.post("/ops-security/chaos/run", (req: Request, res: Response) => {
  try {
    const { scenario } = req.body;

    if (!scenario) {
      res.status(400).json({ ok: false, error: "scenario required in body" });
      return;
    }

    failureTest.runChaosTest(scenario).then((result) => {
      res.json({
        ok: true,
        result,
      });
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/chaos/results", (_req: Request, res: Response) => {
  try {
    const results = failureTest.getTestResults();
    res.json({
      ok: true,
      count: results.length,
      results,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/chaos/resiliency", (_req: Request, res: Response) => {
  try {
    failureTest.runResiliencyMatrix().then((matrix) => {
      res.json({
        ok: true,
        matrix,
      });
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/chaos/recovery", (_req: Request, res: Response) => {
  try {
    const metrics = failureTest.getRecoveryMetrics();
    res.json({
      ok: true,
      count: metrics.length,
      metrics,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// OPS HEALTH ENDPOINTS
// ============================================================================

router.get("/ops-security/ops/snapshot", (_req: Request, res: Response) => {
  try {
    const snapshot = opsHealth.getOpsSnapshot();
    res.json({
      ok: true,
      snapshot,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/ops/incidents", (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const incidents = opsHealth.getIncidentLog(limit);
    res.json({
      ok: true,
      count: incidents.length,
      incidents,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.post("/ops-security/ops/incidents", (req: Request, res: Response) => {
  try {
    const { severity, title, description, component } = req.body;

    if (!severity || !title || !description || !component) {
      res.status(400).json({
        ok: false,
        error: "severity, title, description, component required",
      });
      return;
    }

    const incident = opsHealth.logIncident({
      severity,
      title,
      description,
      component,
    });

    res.status(201).json({
      ok: true,
      incident,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.patch("/ops-security/ops/incidents/:id/resolve", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const incident = opsHealth.resolveIncident(id);

    if (!incident) {
      res.status(404).json({ ok: false, error: `Incident ${id} not found` });
      return;
    }

    res.json({
      ok: true,
      incident,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/ops/runbook/:component", (req: Request, res: Response) => {
  try {
    const { component } = req.params;
    const runbook = opsHealth.getRunbook(component);

    if (!runbook) {
      res.status(404).json({
        ok: false,
        error: `No runbook found for component: ${component}`,
      });
      return;
    }

    res.json({
      ok: true,
      runbook,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// DEPLOYMENT GATE ENDPOINTS
// ============================================================================

router.get("/ops-security/deploy/gate", (_req: Request, res: Response) => {
  try {
    const checks = deploymentGate.runPreDeployChecks();
    const allChecksPassed = checks.every((c) => c.passed);

    res.json({
      ok: true,
      checks,
      allChecksPassed,
      readyToDeploy: allChecksPassed,
      blockers: checks.filter((c) => !c.passed).map((c) => c.name),
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.get("/ops-security/deploy/history", (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const history = deploymentGate.getDeploymentHistory(limit);

    res.json({
      ok: true,
      count: history.length,
      history: history.reverse(), // Most recent first
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

router.post("/ops-security/deploy/record", (req: Request, res: Response) => {
  try {
    const { version, commitHash, deployer, notes } = req.body;

    if (!version || !commitHash || !deployer) {
      res.status(400).json({
        ok: false,
        error: "version, commitHash, deployer required",
      });
      return;
    }

    const record = deploymentGate.recordDeployment({
      version,
      commitHash,
      deployer,
      notes: notes || "",
    });

    res.status(201).json({
      ok: true,
      record,
    });
  } catch (err: any) {
    res.status(503).json({ ok: false, error: err.message });
  }
});

export default router;
