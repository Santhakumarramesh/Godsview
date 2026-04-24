import { Router, type IRouter } from "express";
import {
  getExecutionSafetySupervisorSnapshot,
  resetExecutionSafetySupervisorState,
  runExecutionSafetySupervisorCycle,
  startExecutionSafetySupervisor,
  stopExecutionSafetySupervisor,
} from "../lib/execution_safety_supervisor";

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

router.get("/brain/execution/safety-supervisor/status", (_req, res) => {
  res.json(getExecutionSafetySupervisorSnapshot());
});

router.get("/ops/execution/safety-supervisor/status", (_req, res) => {
  res.json(getExecutionSafetySupervisorSnapshot());
});

router.post("/brain/execution/safety-supervisor/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate = parseBool(req.body?.run_immediate, true);
    const heartbeatSymbol = typeof req.body?.heartbeat_symbol === "string"
      ? req.body.heartbeat_symbol
      : undefined;
    const result = await startExecutionSafetySupervisor({
      intervalMs,
      runImmediate,
      heartbeatSymbol,
    });
    res.json({
      ...result,
      snapshot: getExecutionSafetySupervisorSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Execution safety supervisor start failed");
    res.status(503).json({ error: "execution_safety_supervisor_start_failed", message: String(err) });
  }
});

router.post("/brain/execution/safety-supervisor/stop", (_req, res) => {
  const result = stopExecutionSafetySupervisor();
  res.json({
    ...result,
    snapshot: getExecutionSafetySupervisorSnapshot(),
  });
});

router.post("/brain/execution/safety-supervisor/run-once", async (_req, res) => {
  try {
    const snapshot = await runExecutionSafetySupervisorCycle("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(503).json({ error: "execution_safety_supervisor_cycle_failed", message: String(err) });
  }
});

router.post("/brain/execution/safety-supervisor/reset", (_req, res) => {
  const snapshot = resetExecutionSafetySupervisorState();
  res.json({ ok: true, snapshot });
});

export default router;

