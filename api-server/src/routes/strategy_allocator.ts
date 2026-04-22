import { Router, type IRouter } from "express";
import {
  getStrategyAllocatorSnapshot,
  getStrategyAllocationForSignal,
  runStrategyAllocatorCycle,
  startStrategyAllocator,
  stopStrategyAllocator,
} from "../lib/strategy_allocator";

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

router.get("/brain/strategy/allocator/status", (_req, res) => {
  res.json(getStrategyAllocatorSnapshot());
});

router.get("/ops/strategy/allocator/status", (_req, res) => {
  res.json(getStrategyAllocatorSnapshot());
});

router.get("/brain/strategy/allocator/lookup", (req, res) => {
  const match = getStrategyAllocationForSignal({
    setup_type: typeof req.query.setup_type === "string" ? req.query.setup_type : undefined,
    regime: typeof req.query.regime === "string" ? req.query.regime : undefined,
    symbol: typeof req.query.symbol === "string" ? req.query.symbol : undefined,
  });
  res.json(match);
});

router.post("/brain/strategy/allocator/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate = parseBool(req.body?.run_immediate, true);
    const result = await startStrategyAllocator({ intervalMs, runImmediate });
    res.json({
      ...result,
      snapshot: getStrategyAllocatorSnapshot(),
    });
  } catch (err) {
    req.log.error({ err }, "Strategy allocator start failed");
    res.status(500).json({ error: "strategy_allocator_start_failed", message: String(err) });
  }
});

router.post("/brain/strategy/allocator/stop", (_req, res) => {
  const result = stopStrategyAllocator();
  res.json({
    ...result,
    snapshot: getStrategyAllocatorSnapshot(),
  });
});

router.post("/brain/strategy/allocator/run-once", async (_req, res) => {
  try {
    const snapshot = await runStrategyAllocatorCycle("manual_route");
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ error: "strategy_allocator_cycle_failed", message: String(err) });
  }
});

export default router;
