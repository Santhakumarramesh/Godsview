import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  getOpsSnapshot,
  addOpsAlert,
  getOpsAlerts,
  clearOpsAlerts,
} from "../lib/ops_monitor";

const router = Router();

// GET /ops/snapshot - returns full OpsSnapshot
router.get("/snapshot", (req: Request, res: Response) => {
  try {
    const snapshot = getOpsSnapshot();
    logger.info(`OPS snapshot requested`);
    res.json(snapshot);
  } catch (error) {
    logger.error(`Error fetching ops snapshot: ${error}`);
    res.status(503).json({
      error: "Failed to fetch ops snapshot",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /ops/health - returns just { status, uptime_ms, memory_used_mb }
router.get("/health", (req: Request, res: Response) => {
  try {
    const snapshot = getOpsSnapshot();
    res.json({
      status: snapshot.overall_status,
      uptime_ms: snapshot.system.uptime_ms,
      memory_used_mb: snapshot.system.memory_used_mb,
      timestamp: snapshot.timestamp,
    });
  } catch (error) {
    logger.error(`Error fetching ops health: ${error}`);
    res.status(503).json({
      error: "Failed to fetch ops health",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /ops/alerts - returns alerts, optional query `limit` (default 50)
router.get("/alerts", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const alerts = getOpsAlerts(limit);
    res.json({ alerts, count: alerts.length });
  } catch (error) {
    logger.error(`Error fetching ops alerts: ${error}`);
    res.status(503).json({
      error: "Failed to fetch ops alerts",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /ops/alerts - ingest an alert { level, message }
router.post("/alerts", (req: Request, res: Response) => {
  try {
    const { level, message } = req.body;

    if (!level || !message) {
      res.status(400).json({
        error: "Missing required fields: level, message",
      });
      return;
    }

    if (!["info", "warn", "critical"].includes(level)) {
      res.status(400).json({
        error: "Invalid level: must be 'info', 'warn', or 'critical'",
      });
      return;
    }

    addOpsAlert(level, message);
    logger.info(`Alert ingested: [${level}] ${message}`);

    res.status(201).json({
      success: true,
      alert: { level, message, timestamp: new Date().toISOString() },
    });
  } catch (error) {
    logger.error(`Error ingesting ops alert: ${error}`);
    res.status(503).json({
      error: "Failed to ingest alert",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// DELETE /ops/alerts - clear alerts
router.delete("/alerts", (req: Request, res: Response) => {
  try {
    clearOpsAlerts();
    logger.info(`Ops alerts cleared`);
    res.json({ success: true, message: "All alerts cleared" });
  } catch (error) {
    logger.error(`Error clearing ops alerts: ${error}`);
    res.status(503).json({
      error: "Failed to clear alerts",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
