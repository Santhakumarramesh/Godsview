import { Router, type IRouter } from "express";
import {
  getProductionWatchdogSnapshot,
  resetProductionWatchdogState,
  runProductionWatchdogCycle,
  startProductionWatchdog,
  stopProductionWatchdog,
} from "../lib/production_watchdog";

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

router.get("/brain/production/watchdog/status", (_req, res) => {
  res.json(getProductionWatchdogSnapshot());
});

router.get("/ops/production/watchdog/status", (_req, res) => {
  res.json(getProductionWatchdogSnapshot());
});

router.post("/brain/production/watchdog/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate = parseBool(req.body?.run_immediate, true);
    const result = await startProductionWatchdog({
      intervalMs,
      runImmediate,
    });
    res.json({
      ...result,
      snapshot: getProductionWatchdogSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Production watchdog start failed");
    res.status(500).json({ error: "production_watchdog_start_failed", message: String(err) });
  }
});

router.post("/brain/production/watchdog/stop", (_req, res) => {
  const result = stopProductionWatchdog();
  res.json({
    ...result,
    snapshot: getProductionWatchdogSnapshot(),
  });
});

router.post("/brain/production/watchdog/run-once", async (_req, res) => {
  try {
    const snapshot = await runProductionWatchdogCycle("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: "production_watchdog_cycle_failed", message: String(err) });
  }
});

router.post("/brain/production/watchdog/reset", (_req, res) => {
  const snapshot = resetProductionWatchdogState();
  res.json({ ok: true, snapshot });
});

export default router;
