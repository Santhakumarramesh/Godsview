/**
 * walk_forward_stress.ts — Walk-Forward + Stress Testing API (Phase 52)
 */
import { Router, type Request, type Response } from "express";
import {
  runWalkForward, runStressTest, runValidationGate,
  getWalkForwardStressSnapshot, resetWalkForwardStress,
  type StressScenario,
} from "../lib/walk_forward_stress.js";

const router = Router();

router.get("/api/validation/snapshot", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, snapshot: getWalkForwardStressSnapshot() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/validation/walk-forward", async (req: Request, res: Response) => {
  try {
    const { strategyId, baseSharpe, baseWinRate, windows } = req.body;
    if (!strategyId) { res.status(400).json({ ok: false, error: "strategyId required" }); return; }
    res.json({ ok: true, result: runWalkForward({ strategyId, baseSharpe, baseWinRate, windows }) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/validation/stress-test", async (req: Request, res: Response) => {
  try {
    const { strategyId, baseSharpe, baseMaxDD, scenarios } = req.body;
    if (!strategyId) { res.status(400).json({ ok: false, error: "strategyId required" }); return; }
    res.json({ ok: true, result: runStressTest({ strategyId, baseSharpe, baseMaxDD, scenarios }) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/validation/gate", async (req: Request, res: Response) => {
  try {
    const { strategyId, baseSharpe, baseWinRate, baseMaxDD } = req.body;
    if (!strategyId) { res.status(400).json({ ok: false, error: "strategyId required" }); return; }
    res.json({ ok: true, result: runValidationGate({ strategyId, baseSharpe, baseWinRate, baseMaxDD }) });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/validation/reset", async (_req: Request, res: Response) => {
  try { resetWalkForwardStress(); res.json({ ok: true, message: "Validation engine reset" }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

export default router;
