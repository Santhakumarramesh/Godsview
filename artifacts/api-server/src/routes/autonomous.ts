/**
 * routes/autonomous.ts — Autonomous Mode API Routes (Phase 76)
 */

import { Router, type Request, type Response } from "express";
import {
  startAutonomousMode,
  stopAutonomousMode,
  getAutonomousState,
  runAutonomousCycle,
  getAutonomousReport,
  updateConfig,
  getConfig,
} from "../engines/autonomous_mode_engine";

const router = Router();

// POST /api/autonomous/start — start autonomous mode
router.post("/api/autonomous/start", async (req: Request, res: Response) => {
  try {
    const config = req.body?.config ?? undefined;
    const result = await startAutonomousMode(config);
    res.status(result.success ? 200 : 400).json(result);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

// POST /api/autonomous/stop — stop autonomous mode
router.post("/api/autonomous/stop", async (req: Request, res: Response) => {
  try {
    const reason = req.body?.reason ?? undefined;
    const result = await stopAutonomousMode(reason);
    res.status(result.success ? 200 : 400).json(result);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

// GET /api/autonomous/state — get current state
router.get("/api/autonomous/state", (req: Request, res: Response) => {
  try {
    const state = getAutonomousState();
    res.status(200).json(state);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

// POST /api/autonomous/cycle — run one cycle manually
router.post("/api/autonomous/cycle", async (req: Request, res: Response) => {
  try {
    const report = await runAutonomousCycle();
    res.status(200).json(report);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

// GET /api/autonomous/report — get aggregated report
router.get("/api/autonomous/report", async (req: Request, res: Response) => {
  try {
    const hours = req.query?.hours ? Number(String(req.query.hours)) : undefined;
    const report = await getAutonomousReport(hours);
    res.status(200).json(report);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

// POST /api/autonomous/config — update config
router.post("/api/autonomous/config", (req: Request, res: Response) => {
  try {
    const newConfig = req.body?.config ?? {};
    updateConfig(newConfig);
    const config = getConfig();
    res.status(200).json({ success: true, config });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

// GET /api/autonomous/config — get current config
router.get("/api/autonomous/config", (req: Request, res: Response) => {
  try {
    const config = getConfig();
    res.status(200).json(config);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(503).json({ error: message });
    return;
  }
});

export default router;
