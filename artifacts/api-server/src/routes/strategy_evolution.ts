import { Router, type IRouter } from "express";
import {
  getStrategyEvolutionSnapshot,
  resetStrategyEvolutionState,
  runStrategyEvolutionCycle,
  startStrategyEvolutionScheduler,
  stopStrategyEvolutionScheduler,
} from "../lib/strategy_evolution_scheduler";

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

router.get("/brain/strategy/evolution/status", (_req, res) => {
  res.json(getStrategyEvolutionSnapshot());
});

router.get("/ops/strategy/evolution/status", (_req, res) => {
  res.json(getStrategyEvolutionSnapshot());
});

router.post("/brain/strategy/evolution/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate = parseBool(req.body?.run_immediate, true);
    const result = await startStrategyEvolutionScheduler({ intervalMs, runImmediate });
    res.json({
      ...result,
      snapshot: getStrategyEvolutionSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Strategy evolution scheduler start failed");
    res.status(500).json({ error: "strategy_evolution_start_failed", message: String(err) });
  }
});

router.post("/brain/strategy/evolution/stop", (_req, res) => {
  const result = stopStrategyEvolutionScheduler();
  res.json({
    ...result,
    snapshot: getStrategyEvolutionSnapshot(),
  });
});

router.post("/brain/strategy/evolution/run-once", async (_req, res) => {
  try {
    const snapshot = await runStrategyEvolutionCycle("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: "strategy_evolution_cycle_failed", message: String(err) });
  }
});

router.post("/brain/strategy/evolution/reset", (_req, res) => {
  const snapshot = resetStrategyEvolutionState();
  res.json({ ok: true, snapshot });
});

export default router;

