import { Router, type IRouter } from "express";
import {
  getAutonomySupervisorSnapshot,
  runAutonomySupervisorTick,
  startAutonomySupervisor,
  stopAutonomySupervisor,
} from "../lib/autonomy_supervisor";

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

router.get("/brain/autonomy/supervisor/status", (_req, res) => {
  res.json(getAutonomySupervisorSnapshot());
});

router.get("/ops/autonomy/supervisor/status", (_req, res) => {
  res.json(getAutonomySupervisorSnapshot());
});

router.post("/brain/autonomy/supervisor/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate = parseBool(req.body?.run_immediate, true);
    const result = await startAutonomySupervisor({ intervalMs, runImmediate });
    res.json({
      ...result,
      snapshot: getAutonomySupervisorSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Autonomy supervisor start failed");
    res.status(503).json({ error: "autonomy_supervisor_start_failed", message: String(err) });
  }
});

router.post("/brain/autonomy/supervisor/stop", (_req, res) => {
  const result = stopAutonomySupervisor();
  res.json({
    ...result,
    snapshot: getAutonomySupervisorSnapshot(),
  });
});

router.post("/brain/autonomy/supervisor/tick", async (_req, res) => {
  try {
    const snapshot = await runAutonomySupervisorTick("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(503).json({ error: "autonomy_supervisor_tick_failed", message: String(err) });
  }
});

export default router;
