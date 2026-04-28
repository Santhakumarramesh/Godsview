import { Router, type IRouter } from "express";
import {
  getStrategyGovernorSnapshot,
  runStrategyGovernorCycle,
  startStrategyGovernor,
  stopStrategyGovernor,
} from "../lib/strategy_governor";

const router: IRouter = Router();

function parseNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  const v = String(value).trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

router.get("/brain/strategy/governor/status", (_req, res) => {
  try {
    res.json(getStrategyGovernorSnapshot());
  } catch (err) {
    res.json({ running: false, error: "snapshot_unavailable", message: String(err) });
  }
});

router.get("/ops/strategy/governor/status", (_req, res) => {
  try {
    res.json(getStrategyGovernorSnapshot());
  } catch (err) {
    res.json({ running: false, error: "snapshot_unavailable", message: String(err) });
  }
});

function safeGovernorSnapshot(): unknown {
  try {
    return getStrategyGovernorSnapshot();
  } catch (err) {
    return { running: false, error: "snapshot_unavailable", message: String(err) };
  }
}

router.post("/brain/strategy/governor/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    // Default run_immediate to FALSE so /start never blocks the event loop.
    const runImmediate = parseBool(req.body?.run_immediate, false);
    const result = await startStrategyGovernor({ intervalMs, runImmediate });
    res.json({
      ...result,
      snapshot: safeGovernorSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Strategy governor start failed");
    res.json({ success: false, error: "strategy_governor_start_failed", message: String(err) });
  }
});

router.post("/brain/strategy/governor/stop", (_req, res) => {
  try {
    const result = stopStrategyGovernor();
    res.json({
      ...result,
      snapshot: safeGovernorSnapshot(),
    });
  } catch (err) {
    res.json({ success: false, error: "strategy_governor_stop_failed", message: String(err) });
  }
});

router.post("/brain/strategy/governor/run-once", async (_req, res) => {
  try {
    const snapshot = await runStrategyGovernorCycle("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.json({ ok: false, error: "strategy_governor_cycle_failed", message: String(err) });
  }
});

export default router;
