/**
 * routes/portfolio_optimizer.ts — Phase 86 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  equalWeightOptimizer,
  riskParityOptimizer,
  kellyOptimizer,
  meanVarianceOptimizer,
  type StrategyStats,
} from "../lib/portfolio_optimizer";

const router = Router();

router.post("/api/optimize/equal-weight", (req: Request, res: Response) => {
  const { stats } = req.body ?? {};
  if (!Array.isArray(stats)) return res.status(400).json({ error: "Missing stats[]" });
  return res.json(equalWeightOptimizer.optimize(stats as StrategyStats[]));
});

router.post("/api/optimize/risk-parity", (req: Request, res: Response) => {
  const { stats } = req.body ?? {};
  if (!Array.isArray(stats)) return res.status(400).json({ error: "Missing stats[]" });
  return res.json(riskParityOptimizer.optimize(stats as StrategyStats[]));
});

router.post("/api/optimize/kelly", (req: Request, res: Response) => {
  const { stats, fraction } = req.body ?? {};
  if (!Array.isArray(stats)) return res.status(400).json({ error: "Missing stats[]" });
  return res.json(kellyOptimizer.optimize(stats as StrategyStats[], fraction ?? 0.5));
});

router.post("/api/optimize/mean-variance", (req: Request, res: Response) => {
  const { stats, steps } = req.body ?? {};
  if (!Array.isArray(stats)) return res.status(400).json({ error: "Missing stats[]" });
  return res.json(meanVarianceOptimizer.optimize(stats as StrategyStats[], steps ?? 11));
});

router.post("/api/optimize/compare", (req: Request, res: Response) => {
  const { stats } = req.body ?? {};
  if (!Array.isArray(stats)) return res.status(400).json({ error: "Missing stats[]" });
  const arr = stats as StrategyStats[];
  return res.json({
    equalWeight: equalWeightOptimizer.optimize(arr),
    riskParity: riskParityOptimizer.optimize(arr),
    kelly: kellyOptimizer.optimize(arr),
    meanVariance: meanVarianceOptimizer.optimize(arr),
  });
});

export default router;
