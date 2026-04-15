/**
 * P1-12: Unified /api/quant-lab route backed by Phase 103 QuantLabUnified.
 *
 * Replaces the ad-hoc endpoints that godsview-dashboard/src/pages/quant-lab.tsx
 * used to hit. The dashboard now POSTs to /api/quant-lab/backtest/run and
 * /api/quant-lab/backtest/quick; existing /api/backtest paths are unaffected
 * and continue to work for legacy callers.
 */

import { Router, type Request, type Response } from "express";
import { getQuantLab } from "../lib/phase103/quant_lab_unified/index.js";
import { logger } from "../lib/logger";

const router = Router();

router.get("/strategies", (_req: Request, res: Response) => {
  res.json({ strategies: getQuantLab().listStrategies() });
});

router.get("/strategies/:id", (req: Request, res: Response) => {
  const strat = getQuantLab().getStrategy(String(req.params.id));
  if (!strat) return res.status(404).json({ error: "not_found" });
  res.json(strat);
});

router.post("/strategies", (req: Request, res: Response) => {
  try {
    const spec = getQuantLab().registerStrategy(req.body);
    res.status(201).json(spec);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "invalid strategy spec" });
  }
});

router.post("/experiments", (req: Request, res: Response) => {
  try {
    const rec = getQuantLab().recordBacktest(req.body);
    res.status(201).json(rec);
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "invalid backtest result" });
  }
});

router.post("/strategies/:id/promote", (req: Request, res: Response) => {
  const outcome = getQuantLab().promote(String(req.params.id));
  res.json(outcome);
});

router.get("/strategies/:id/promotion", (req: Request, res: Response) => {
  const ev = getQuantLab().evaluatePromotion(String(req.params.id));
  res.json(ev);
});

// ── Compatibility bridge for the dashboard (pages/quant-lab.tsx). ──────
// The dashboard still posts to /backtest/run and /backtest/quick; we expose
// both under /api/quant-lab so the migration from legacy endpoints is a
// one-line change in the page.

router.post("/backtest/run", async (req: Request, res: Response) => {
  try {
    const { runBacktest } = await import("../lib/backtest_engine");
    const payload = req.body ?? {};
    const result = await runBacktest({
      lookback_days: Number(payload.lookback_days ?? 30),
      initial_equity: Number(payload.initial_equity ?? 10_000),
      mode: payload.mode ?? "comparison",
    } as any);
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "quant-lab backtest run failed");
    res.status(500).json({ error: err.message ?? "backtest failed" });
  }
});

router.get("/backtest/quick", async (_req: Request, res: Response) => {
  try {
    const { runBacktest } = await import("../lib/backtest_engine");
    const result = await runBacktest({
      lookback_days: 30,
      initial_equity: 10_000,
      mode: "comparison",
    } as any);
    res.json(result);
  } catch (err: any) {
    logger.error({ err }, "quant-lab quick backtest failed");
    res.status(500).json({ error: err.message ?? "backtest failed" });
  }
});

export default router;
