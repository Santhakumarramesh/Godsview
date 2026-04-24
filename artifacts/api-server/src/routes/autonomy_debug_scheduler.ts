import { Router, type IRouter } from "express";
import {
  getAutonomyDebugSchedulerSnapshot,
  resetAutonomyDebugSchedulerState,
  runAutonomyDebugSchedulerCycle,
  startAutonomyDebugScheduler,
  stopAutonomyDebugScheduler,
} from "../lib/autonomy_debug_scheduler";

const router: IRouter = Router();

function parseNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return fallback;
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

router.get("/brain/autonomy/debug/scheduler/status", (_req, res) => {
  res.json(getAutonomyDebugSchedulerSnapshot());
});

router.get("/ops/autonomy/debug/scheduler/status", (_req, res) => {
  res.json(getAutonomyDebugSchedulerSnapshot());
});

router.post("/brain/autonomy/debug/scheduler/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate = parseBool(req.body?.run_immediate, true);
    const result = await startAutonomyDebugScheduler({
      intervalMs,
      runImmediate,
    });
    res.json({
      ...result,
      snapshot: getAutonomyDebugSchedulerSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Autonomy debug scheduler start failed");
    res.status(503).json({ error: "autonomy_debug_scheduler_start_failed", message: String(err) });
  }
});

router.post("/brain/autonomy/debug/scheduler/stop", (_req, res) => {
  const result = stopAutonomyDebugScheduler();
  res.json({
    ...result,
    snapshot: getAutonomyDebugSchedulerSnapshot(),
  });
});

router.post("/brain/autonomy/debug/scheduler/run-once", async (_req, res) => {
  try {
    const snapshot = await runAutonomyDebugSchedulerCycle("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(503).json({ error: "autonomy_debug_scheduler_cycle_failed", message: String(err) });
  }
});

router.post("/brain/autonomy/debug/scheduler/reset", (_req, res) => {
  const snapshot = resetAutonomyDebugSchedulerState();
  res.json({ ok: true, snapshot });
});

export default router;
