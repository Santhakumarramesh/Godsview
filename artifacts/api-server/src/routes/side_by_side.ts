/**
 * routes/side_by_side.ts — Side-by-Side Backtest REST API
 *
 * Endpoints:
 *   GET  /api/side-by-side/snapshot — Current state
 *   POST /api/side-by-side/start — Start (body: SideBySideConfig)
 *   POST /api/side-by-side/stop — Stop
 *   POST /api/side-by-side/pause — Pause
 *   POST /api/side-by-side/resume — Resume
 *   POST /api/side-by-side/reset — Reset
 */

import { Router } from "express";
import {
  startSideBySide,
  stopSideBySide,
  pauseSideBySide,
  resumeSideBySide,
  getSideBySideSnapshot,
  resetSideBySide,
  updateBacktestProgress,
  type SideBySideConfig,
} from "../engines/side_by_side_backtest.js";

const router = Router();

/**
 * GET /api/side-by-side/snapshot
 * Get current side-by-side state
 */
router.get("/api/side-by-side/snapshot", (_req, res) => {
  const snapshot = getSideBySideSnapshot();
  if (!snapshot) {
    res.status(404).json({ error: "not_running", message: "No active side-by-side run" });
    return;
  }
  res.json(snapshot);
});

/**
 * POST /api/side-by-side/start
 * Start a new side-by-side run
 * Body: { symbols, historicalDays, strategies, updateIntervalMs }
 */
router.post("/api/side-by-side/start", (req, res) => {
  const config = req.body as SideBySideConfig;

  if (!config || !Array.isArray(config.symbols) || config.symbols.length === 0) {
    res.status(400).json({ error: "invalid_config", message: "symbols array is required" });
    return;
  }

  if (typeof config.historicalDays !== "number" || config.historicalDays < 1) {
    res.status(400).json({ error: "invalid_config", message: "historicalDays must be >= 1" });
    return;
  }

  if (!Array.isArray(config.strategies) || config.strategies.length === 0) {
    res.status(400).json({ error: "invalid_config", message: "strategies array is required" });
    return;
  }

  if (typeof config.updateIntervalMs !== "number" || config.updateIntervalMs < 100) {
    res.status(400).json({ error: "invalid_config", message: "updateIntervalMs must be >= 100" });
    return;
  }

  try {
    const snapshot = startSideBySide(config);
    res.json(snapshot);

    // Kick off async backtest simulation
    (async () => {
      try {
        const totalSteps = 20;
        for (let step = 1; step <= totalSteps; step++) {
          await new Promise((r) => setTimeout(r, 2000));
          const s = getSideBySideSnapshot();
          if (!s || s.status !== "running") break;
          const trades = step * 3;
          const wins = 0;
          const pnl = 0;
          updateBacktestProgress(trades, wins, pnl, trades * 2, (step / totalSteps) * 100);
        }
      } catch {
        /* best effort */
      }
    })();
  } catch (err: any) {
    res.status(503).json({ error: "start_failed", message: err.message });
  }
});

/**
 * POST /api/side-by-side/stop
 * Stop the active side-by-side run
 */
router.post("/api/side-by-side/stop", (_req, res) => {
  const snapshot = stopSideBySide();
  if (!snapshot) {
    res.status(404).json({ error: "not_running" });
    return;
  }
  res.json(snapshot);
});

/**
 * POST /api/side-by-side/pause
 * Pause the active side-by-side run
 */
router.post("/api/side-by-side/pause", (_req, res) => {
  const snapshot = pauseSideBySide();
  if (!snapshot) {
    res.status(404).json({ error: "not_running" });
    return;
  }
  res.json(snapshot);
});

/**
 * POST /api/side-by-side/resume
 * Resume the paused side-by-side run
 */
router.post("/api/side-by-side/resume", (_req, res) => {
  const snapshot = resumeSideBySide();
  if (!snapshot) {
    res.status(404).json({ error: "not_running" });
    return;
  }
  res.json(snapshot);
});

/**
 * POST /api/side-by-side/reset
 * Reset side-by-side state
 */
router.post("/api/side-by-side/reset", (_req, res) => {
  resetSideBySide();
  res.json({ status: "reset" });
});

export default router;
