/**
 * routes/live_launch.ts — Live Launch API Routes (Phase 75)
 */

import { Router, type Request, type Response } from "express";
import {
  runPreFlightChecks,
  liveSafetyCheck,
  emergencyShutdown,
  getLiveLaunchState,
  initiateLiveLaunch,
  terminateLiveLaunch,
  updateConfig,
  getConfig,
  resetDailyMetrics,
} from "../engines/live_launch_engine";

const router = Router();

// GET /api/live/preflight — run pre-flight checks
router.get("/api/live/preflight", async (req: Request, res: Response) => {
  try {
    const result = await runPreFlightChecks();
    res.status(200).json(result);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// GET /api/live/state — get live launch state
router.get("/api/live/state", (req: Request, res: Response) => {
  try {
    const state = getLiveLaunchState();
    res.status(200).json(state);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// GET /api/live/safety-check — run safety check
router.get("/api/live/safety-check", (req: Request, res: Response) => {
  try {
    const result = liveSafetyCheck();
    res.status(200).json(result);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// POST /api/live/initiate — initiate live launch
router.post("/api/live/initiate", async (req: Request, res: Response) => {
  try {
    const config = req.body?.config ?? undefined;
    const result = await initiateLiveLaunch(config);
    res.status(result.success ? 200 : 400).json(result);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// POST /api/live/terminate — terminate live launch
router.post("/api/live/terminate", (req: Request, res: Response) => {
  try {
    terminateLiveLaunch();
    res.status(200).json({ success: true, message: "Live launch terminated" });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// POST /api/live/emergency-shutdown — emergency shutdown
router.post("/api/live/emergency-shutdown", (req: Request, res: Response) => {
  try {
    const reason = String(req.body?.reason ?? "emergency_shutdown_triggered");
    emergencyShutdown(reason);
    res.status(200).json({ success: true, message: "Emergency shutdown activated", reason });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// POST /api/live/config — update config
router.post("/api/live/config", (req: Request, res: Response) => {
  try {
    const newConfig = req.body?.config ?? {};
    updateConfig(newConfig);
    const config = getConfig();
    res.status(200).json({ success: true, config });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// GET /api/live/config — get config
router.get("/api/live/config", (req: Request, res: Response) => {
  try {
    const config = getConfig();
    res.status(200).json(config);
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

// POST /api/live/reset-daily-metrics — reset daily metrics
router.post("/api/live/reset-daily-metrics", (req: Request, res: Response) => {
  try {
    resetDailyMetrics();
    const state = getLiveLaunchState();
    res.status(200).json({ success: true, state });
    return;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
    return;
  }
});

export default router;
