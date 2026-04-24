/**
 * Production Health Routes — Unified observability endpoints.
 *
 * GET  /production-health           — Full health report (all subsystems)
 * GET  /production-health/summary   — Concise operator summary
 * GET  /production-health/alerts    — Active production alerts
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  generateHealthReport,
  getOperatorSummary,
  ALERT_RULES,
} from "../lib/production_observability";

export const productionHealthRouter = Router();

productionHealthRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const report = generateHealthReport();
    const statusCode = report.overall_status === "critical" ? 503 : 200;
    res.status(statusCode).json(report);
  } catch (err) {
    logger.error({ err }, "Failed to generate health report");
    res.status(500).json({ error: "internal_error" });
  }
});

productionHealthRouter.get("/summary", async (_req: Request, res: Response) => {
  try {
    const summary = getOperatorSummary();
    res.type("text/plain").send(summary);
  } catch (err) {
    logger.error({ err }, "Failed to generate operator summary");
    res.status(500).json({ error: "internal_error" });
  }
});

productionHealthRouter.get("/alerts", async (_req: Request, res: Response) => {
  try {
    const alerts = [];
    for (const rule of ALERT_RULES) {
      const result = rule.check();
      if (result.triggered) {
        alerts.push({
          name: rule.name,
          subsystem: rule.subsystem,
          severity: result.severity,
          message: rule.message(result.value),
          value: result.value,
        });
      }
    }
    res.json({ alerts, count: alerts.length });
  } catch (err) {
    logger.error({ err }, "Failed to check alerts");
    res.status(500).json({ error: "internal_error" });
  }
});

export default productionHealthRouter;
