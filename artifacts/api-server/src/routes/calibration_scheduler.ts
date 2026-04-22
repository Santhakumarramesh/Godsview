/**
 * Calibration Scheduler routes (Phase 5)
 *
 *   GET  /api/calibration/scheduler/status   — current state, cycle count, interval
 *   GET  /api/calibration/scheduler/history  — ring buffer of cycle results
 *   GET  /api/calibration/scheduler/current  — cycle in flight, if any
 *   GET  /api/calibration/scheduler/score    — current calibration score (0-100)
 *   POST /api/calibration/scheduler/force    — operator-gated, runs an out-of-band cycle
 */

import { Router, type Request, type Response } from "express";
import {
  CalibrationScheduler,
  getCalibrationTracker,
} from "../lib/eval/calibration_scheduler";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";

const router: Router = Router();

function snapshot() {
  const sched = CalibrationScheduler.getInstance();
  return {
    running: sched.isRunning(),
    cycleCount: sched.getCycleCount(),
    intervalMs: sched.getIntervalMs(),
    historyLength: sched.getHistory().length,
    hasCycleInFlight: sched.getCurrentCycle() !== null,
  };
}
router.get("/api/calibration/scheduler/status", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    scheduler: snapshot(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/api/calibration/scheduler/history", (req: Request, res: Response) => {
  const limit = Math.max(
    1,
    Math.min(500, parseInt((req.query.limit as string) ?? "50", 10) || 50),
  );
  const history = CalibrationScheduler.getInstance().getHistory().slice(0, limit);
  res.json({
    status: "success",
    count: history.length,
    cycles: history,
    timestamp: new Date().toISOString(),
  });
});

router.get("/api/calibration/scheduler/current", (_req: Request, res: Response) => {
  const cycle = CalibrationScheduler.getInstance().getCurrentCycle();
  res.json({
    status: "success",
    cycle,
    timestamp: new Date().toISOString(),
  });
});
router.get("/api/calibration/scheduler/score", (_req: Request, res: Response) => {
  try {
    const tracker = getCalibrationTracker();
    const score = tracker.getCalibrationScore();
    const driftAlert = tracker.getDriftAlert();
    res.json({
      status: "success",
      score,
      driftAlert,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error(
      { err: err?.message ?? String(err) },
      "Calibration score lookup failed",
    );
    res.status(500).json({
      error: "score_lookup_failed",
      message: err?.message ?? "Unknown error",
    });
  }
});

router.post(
  "/api/calibration/scheduler/force",
  requireOperator,
  async (_req: Request, res: Response) => {
    try {
      const result = await CalibrationScheduler.getInstance().forceCycle();
      res.json({
        status: "success",
        message: "Calibration cycle executed",
        cycle: result,
        scheduler: snapshot(),
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error(
        { err: err?.message ?? String(err) },
        "Calibration force-cycle failed",
      );
      res.status(500).json({
        error: "force_cycle_failed",
        message: err?.message ?? "Unknown error",
      });
    }
  },
);

export default router;
