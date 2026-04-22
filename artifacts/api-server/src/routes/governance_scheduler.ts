/**
 * Governance Scheduler routes (Phase 5)
 *
 *   GET  /api/governance/scheduler/status        — current state, cycle count, interval
 *   GET  /api/governance/scheduler/history       — ring buffer of cycle results
 *   GET  /api/governance/scheduler/current       — cycle in flight, if any
 *   POST /api/governance/scheduler/force         — operator-gated, runs an out-of-band cycle
 */

import { Router, type Request, type Response } from "express";
import { GovernanceScheduler } from "../lib/governance/governance_scheduler";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";

const router: Router = Router();

function snapshot() {
  const sched = GovernanceScheduler.getInstance();
  return {
    running: sched.isRunning(),
    cycleCount: sched.getCycleCount(),
    intervalMs: sched.getIntervalMs(),
    historyLength: sched.getHistory().length,
    hasCycleInFlight: sched.getCurrentCycle() !== null,
  };
}
router.get("/api/governance/scheduler/status", (_req: Request, res: Response) => {
  res.json({
    status: "success",
    scheduler: snapshot(),
    timestamp: new Date().toISOString(),
  });
});

router.get("/api/governance/scheduler/history", (req: Request, res: Response) => {
  const limit = Math.max(
    1,
    Math.min(500, parseInt((req.query.limit as string) ?? "50", 10) || 50),
  );
  const history = GovernanceScheduler.getInstance().getHistory().slice(0, limit);
  res.json({
    status: "success",
    count: history.length,
    cycles: history,
    timestamp: new Date().toISOString(),
  });
});

router.get("/api/governance/scheduler/current", (_req: Request, res: Response) => {
  const cycle = GovernanceScheduler.getInstance().getCurrentCycle();
  res.json({
    status: "success",
    cycle,
    timestamp: new Date().toISOString(),
  });
});
router.post(
  "/api/governance/scheduler/force",
  requireOperator,
  async (_req: Request, res: Response) => {
    try {
      const result = await GovernanceScheduler.getInstance().forceCycle();
      res.json({
        status: "success",
        message: "Governance cycle executed",
        cycle: result,
        scheduler: snapshot(),
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      logger.error(
        { err: err?.message ?? String(err) },
        "Governance force-cycle failed",
      );
      res.status(500).json({
        error: "force_cycle_failed",
        message: err?.message ?? "Unknown error",
      });
    }
  },
);

export default router;
