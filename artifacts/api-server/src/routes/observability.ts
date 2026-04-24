/**
 * observability.ts — Phase 72 (Wave 4.1): Observability Routes
 *
 * REST API endpoints for querying system health, metrics, and alerts:
 *
 * GET  /api/observability/health             — full system health report
 * GET  /api/observability/health/timeline    — historical health snapshots
 * GET  /api/observability/metrics            — current metrics summary
 * GET  /api/observability/alerts             — active alerts
 * GET  /api/observability/alerts/history     — historical alerts
 * POST /api/observability/alerts             — raise a new alert
 * POST /api/observability/alerts/:id/acknowledge — acknowledge alert
 * POST /api/observability/alerts/:id/resolve     — resolve alert
 */

import { Router, Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";
import {
  collectSystemHealth,
  getHealthTimeline,
  getMetricsSummary,
  getAlertManager,
  raiseAlert,
} from "../engines/observability_engine";

const router = Router();

/* ────────────────────────────────────────────────────────────────────────── */
/* Middleware                                                                 */
/* ────────────────────────────────────────────────────────────────────────── */

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/* ────────────────────────────────────────────────────────────────────────── */
/* Health Endpoints                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/observability/health
 * Returns comprehensive system health report
 */
router.get(
  "/api/observability/health",
  asyncHandler(async (req: Request, res: Response) => {
    const health = await collectSystemHealth();
    res.json(health);
  })
);

/**
 * GET /api/observability/health/timeline?hours=24
 * Returns historical health snapshots
 */
router.get(
  "/api/observability/health/timeline",
  asyncHandler(async (req: Request, res: Response) => {
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 720); // Max 30 days
    const timeline = await getHealthTimeline(hours);
    res.json({
      hours,
      count: timeline.length,
      snapshots: timeline,
    });
  })
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Metrics Endpoints                                                          */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/observability/metrics
 * Returns current metrics summary with rolling window calculations
 */
router.get(
  "/api/observability/metrics",
  asyncHandler(async (req: Request, res: Response) => {
    const summary = getMetricsSummary();
    res.json(summary);
  })
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Alerts Endpoints                                                           */
/* ────────────────────────────────────────────────────────────────────────── */

/**
 * GET /api/observability/alerts
 * Returns all active (unresolved) alerts
 */
router.get(
  "/api/observability/alerts",
  asyncHandler(async (req: Request, res: Response) => {
    const manager = getAlertManager();
    const alerts = manager.getActiveAlerts();
    res.json({
      count: alerts.length,
      alerts,
    });
  })
);

/**
 * GET /api/observability/alerts/history?hours=24
 * Returns historical alert records
 */
router.get(
  "/api/observability/alerts/history",
  asyncHandler(async (req: Request, res: Response) => {
    const hours = Math.min(parseInt(req.query.hours as string) || 24, 720);
    const manager = getAlertManager();
    const history = manager.getAlertHistory(hours);
    res.json({
      hours,
      count: history.length,
      alerts: history,
    });
  })
);

/**
 * POST /api/observability/alerts
 * Raise a new system alert
 *
 * Body:
 * {
 *   severity: "info" | "warning" | "critical",
 *   category: string,
 *   message: string,
 *   details?: Record<string, unknown>
 * }
 */
router.post(
  "/api/observability/alerts",
  asyncHandler(async (req: Request, res: Response) => {
    const { severity, category, message, details } = req.body;

    if (!severity || !category || !message) {
      res.status(400).json({
        error: "Missing required fields: severity, category, message",
      });
      return;
    }

    const validSeverities = ["info", "warning", "critical"];
    if (!validSeverities.includes(severity)) {
      res.status(400).json({
        error: "Invalid severity. Must be one of: info, warning, critical",
      });
      return;
    }

    const manager = getAlertManager();
    const alertId = manager.raiseAlert(severity, category, message, details);

    res.status(201).json({
      alertId,
      message: "Alert raised successfully",
    });
  })
);

/**
 * POST /api/observability/alerts/:id/acknowledge
 * Acknowledge an alert (mark as seen/acknowledged)
 */
router.post(
  "/api/observability/alerts/:id/acknowledge",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const manager = getAlertManager();
    const success = manager.acknowledgeAlert(id);

    if (!success) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    res.json({
      message: "Alert acknowledged",
      alertId: id,
    });
  })
);

/**
 * POST /api/observability/alerts/:id/resolve
 * Resolve an alert (mark as resolved/closed)
 */
router.post(
  "/api/observability/alerts/:id/resolve",
  asyncHandler(async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const manager = getAlertManager();
    const success = manager.resolveAlert(id);

    if (!success) {
      res.status(404).json({ error: "Alert not found" });
      return;
    }

    res.json({
      message: "Alert resolved",
      alertId: id,
    });
  })
);

/* ────────────────────────────────────────────────────────────────────────── */
/* Error Handler                                                              */
/* ────────────────────────────────────────────────────────────────────────── */

router.use(
  (
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    logger.error({ err }, "Observability route error");
    res.status(503).json({
      error: "Internal server error",
      message: err.message,
    });
  }
);

export default router;
