// ── Phase 110: Backtest Credibility Upgrade API ──────────────────────────────
// Phase 2 hardening: routes now read from a runtime-populated results store
// instead of inline mock fixtures. In dev/test the store is seeded with a
// small demo set (stamped `_demo: true`); in production the store starts
// empty and is populated by EventDrivenBacktester / OverfitDetector runs.
// No more hardcoded "bt-001 / bt-002 / bt-003" rows in the route layer.

import { Router, type Request, type Response } from "express";
import { backtestResultsStore } from "../lib/backtest_v2/results_store";
import { hasLiveBroker, markDemoResponse } from "../lib/demo_mode";

const router = Router();

// Seed demo data once at module load (dev/test only; no-op in production).
backtestResultsStore.seedDemoData();

function stampDemoIfNeeded(res: Response): void {
  if (!hasLiveBroker()) markDemoResponse(res);
}

router.get("/results", (_req: Request, res: Response) => {
  const backtests = backtestResultsStore.listResults();
  stampDemoIfNeeded(res);
  res.json({ backtests, total: backtests.length, _demo: !hasLiveBroker() });
});

router.get("/credibility/:id", (req: Request, res: Response) => {
  const report = backtestResultsStore.getCredibility(req.params.id);
  if (!report) return res.status(404).json({ error: "Backtest not found" });
  stampDemoIfNeeded(res);
  res.json({ ...report, _demo: !hasLiveBroker() });
});

router.get("/overfit/:id", (req: Request, res: Response) => {
  const report = backtestResultsStore.getOverfit(req.params.id);
  if (!report) return res.status(404).json({ error: "Backtest not found" });
  stampDemoIfNeeded(res);
  res.json({ ...report, _demo: !hasLiveBroker() });
});

router.get("/leakage/:id", (req: Request, res: Response) => {
  const report = backtestResultsStore.getLeakage(req.params.id);
  if (!report) return res.status(404).json({ error: "Backtest not found" });
  stampDemoIfNeeded(res);
  res.json({ ...report, _demo: !hasLiveBroker() });
});

router.get("/walk-forward/:id", (req: Request, res: Response) => {
  const report = backtestResultsStore.getWalkForward(req.params.id);
  if (!report) return res.status(404).json({ error: "Walk-forward not available" });
  stampDemoIfNeeded(res);
  res.json({ ...report, _demo: !hasLiveBroker() });
});

router.get("/comparison/:id", (req: Request, res: Response) => {
  const report = backtestResultsStore.getComparison(req.params.id);
  if (!report) return res.status(404).json({ error: "Paper comparison not available" });
  stampDemoIfNeeded(res);
  res.json({ ...report, _demo: !hasLiveBroker() });
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    module: "backtest-v2",
    phase: 110,
    backtestsAvailable: backtestResultsStore.listResults().length,
    hasLiveBroker: hasLiveBroker(),
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

export default router;
