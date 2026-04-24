/**
 * SI Supervisor Routes — Health monitoring and orchestration endpoints
 */

import { Router, type Request, type Response } from "express";
import {
  siHealthCheck,
  evaluateRetrainNeed,
  runSupervisorCycle,
  startSISupervisor,
  stopSISupervisor,
  getSupervisorHistory,
  getSupervisorStats,
  getEnsembleStatus,
  getSISupervisorConfig,
  setSISupervisorConfig,
  isSISupervisorActive,
} from "../engines/si_supervisor";
import { logger } from "../lib/logger";

const router = Router();

// GET /api/si/supervisor/health — Health check
router.get("/api/si/supervisor/health", async (req: Request, res: Response) => {
  try {
    const health = await siHealthCheck();
    res.json({
      success: true,
      data: health,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get SI health");
    res.status(503).json({
      success: false,
      error: "Health check failed",
      details: String(error),
    });
  }
});

// GET /api/si/supervisor/retrain-eval — Evaluate retrain need
router.get("/api/si/supervisor/retrain-eval", async (req: Request, res: Response) => {
  try {
    const decision = await evaluateRetrainNeed();
    res.json({
      success: true,
      data: decision,
    });
  } catch (error) {
    logger.error({ error }, "Failed to evaluate retrain need");
    res.status(503).json({
      success: false,
      error: "Retrain eval failed",
      details: String(error),
    });
  }
});

// POST /api/si/supervisor/cycle — Run supervisor cycle
router.post("/api/si/supervisor/cycle", async (req: Request, res: Response) => {
  try {
    const result = await runSupervisorCycle();
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error({ error }, "Failed to run supervisor cycle");
    res.status(503).json({
      success: false,
      error: "Cycle failed",
      details: String(error),
    });
  }
});

// POST /api/si/supervisor/start — Start supervisor
router.post("/api/si/supervisor/start", (req: Request, res: Response) => {
  try {
    const config = req.body?.config ?? {};
    startSISupervisor(config);
    res.json({
      success: true,
      message: "SI Supervisor started",
      active: isSISupervisorActive(),
      config: getSISupervisorConfig(),
    });
  } catch (error) {
    logger.error({ error }, "Failed to start SI Supervisor");
    res.status(503).json({
      success: false,
      error: "Start failed",
      details: String(error),
    });
  }
});

// POST /api/si/supervisor/stop — Stop supervisor
router.post("/api/si/supervisor/stop", (req: Request, res: Response) => {
  try {
    stopSISupervisor();
    res.json({
      success: true,
      message: "SI Supervisor stopped",
      active: isSISupervisorActive(),
    });
  } catch (error) {
    logger.error({ error }, "Failed to stop SI Supervisor");
    res.status(503).json({
      success: false,
      error: "Stop failed",
      details: String(error),
    });
  }
});

// GET /api/si/supervisor/history — Get supervisor history
router.get("/api/si/supervisor/history", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
    const history = getSupervisorHistory(limit);
    const stats = getSupervisorStats();
    res.json({
      success: true,
      data: {
        history,
        stats,
      },
    });
  } catch (error) {
    logger.error({ error }, "Failed to get supervisor history");
    res.status(503).json({
      success: false,
      error: "History fetch failed",
      details: String(error),
    });
  }
});

// GET /api/si/supervisor/status — Get ensemble and supervisor status
router.get("/api/si/supervisor/status", async (req: Request, res: Response) => {
  try {
    const status = await getEnsembleStatus();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get ensemble status");
    res.status(503).json({
      success: false,
      error: "Status fetch failed",
      details: String(error),
    });
  }
});

// GET /api/si/supervisor/config — Get supervisor config
router.get("/api/si/supervisor/config", (req: Request, res: Response) => {
  try {
    const config = getSISupervisorConfig();
    res.json({
      success: true,
      data: config,
    });
  } catch (error) {
    logger.error({ error }, "Failed to get supervisor config");
    res.status(503).json({
      success: false,
      error: "Config fetch failed",
      details: String(error),
    });
  }
});

// PUT /api/si/supervisor/config — Update supervisor config
router.put("/api/si/supervisor/config", (req: Request, res: Response) => {
  try {
    const newConfig = req.body;
    setSISupervisorConfig(newConfig);
    const updated = getSISupervisorConfig();
    res.json({
      success: true,
      message: "Config updated",
      data: updated,
    });
  } catch (error) {
    logger.error({ error }, "Failed to update supervisor config");
    res.status(503).json({
      success: false,
      error: "Config update failed",
      details: String(error),
    });
  }
});

export default router;
