/**
 * execution_intelligence.ts — Advanced Execution Intelligence API
 *
 * GET  /api/execution-intelligence/snapshot       — engine telemetry
 * POST /api/execution-intelligence/plan           — create execution plan
 * POST /api/execution-intelligence/slippage       — estimate slippage
 * POST /api/execution-intelligence/exit-ladder    — build exit ladder
 * POST /api/execution-intelligence/dynamic-stop   — compute dynamic stop
 * POST /api/execution-intelligence/quality-report — grade an execution
 * POST /api/execution-intelligence/reset          — reset telemetry
 */

import { Router, type Request, type Response } from "express";
import {
  estimateSlippage,
  createExecutionPlan,
  buildExitLadder,
  computeDynamicStop,
  reportExecutionQuality,
  getExecutionIntelligenceSnapshot,
  resetExecutionIntelligence,
} from "../lib/execution_intelligence.js";

const router = Router();

// GET /api/execution-intelligence/snapshot
router.get("/api/execution-intelligence/snapshot", async (_req: Request, res: Response) => {
  try {
    const snapshot = getExecutionIntelligenceSnapshot();
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/execution-intelligence/slippage
router.post("/api/execution-intelligence/slippage", async (req: Request, res: Response) => {
  try {
    const { symbol, direction, spread, price, volume, atr, orderSizeUsd } = req.body;
    if (!symbol) {
      res.status(400).json({ ok: false, error: "symbol required" });
      return;
    }
    const estimate = estimateSlippage({
      symbol, direction: direction ?? "long", spread, price, volume, atr, orderSizeUsd,
    });
    res.json({ ok: true, estimate });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/execution-intelligence/plan
router.post("/api/execution-intelligence/plan", async (req: Request, res: Response) => {
  try {
    const { symbol, direction, entryPrice, stopLoss, atr, spread, volume, equity, riskPct, riskReward } = req.body;
    if (!symbol || !entryPrice || !stopLoss || !atr) {
      res.status(400).json({ ok: false, error: "symbol, entryPrice, stopLoss, and atr required" });
      return;
    }
    const plan = createExecutionPlan({
      symbol, direction: direction ?? "long", entryPrice, stopLoss, atr,
      spread, volume, equity, riskPct, riskReward,
    });
    res.json({ ok: true, plan });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/execution-intelligence/exit-ladder
router.post("/api/execution-intelligence/exit-ladder", async (req: Request, res: Response) => {
  try {
    const { entryPrice, stopLoss, direction, targets, riskReward } = req.body;
    if (!entryPrice || !stopLoss) {
      res.status(400).json({ ok: false, error: "entryPrice and stopLoss required" });
      return;
    }
    const ladder = buildExitLadder({ entryPrice, stopLoss, direction: direction ?? "long", targets, riskReward });
    res.json({ ok: true, ladder });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/execution-intelligence/dynamic-stop
router.post("/api/execution-intelligence/dynamic-stop", async (req: Request, res: Response) => {
  try {
    const { entryPrice, currentPrice, initialStop, currentStop, direction, atr, atrMultiplier, highSinceEntry, lowSinceEntry } = req.body;
    if (!entryPrice || !currentPrice || !initialStop || currentStop == null || !atr) {
      res.status(400).json({ ok: false, error: "entryPrice, currentPrice, initialStop, currentStop, and atr required" });
      return;
    }
    const stop = computeDynamicStop({
      entryPrice, currentPrice, initialStop, currentStop,
      direction: direction ?? "long", atr, atrMultiplier, highSinceEntry, lowSinceEntry,
    });
    res.json({ ok: true, stop });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/execution-intelligence/quality-report
router.post("/api/execution-intelligence/quality-report", async (req: Request, res: Response) => {
  try {
    const { tradeId, symbol, expectedEntry, actualEntry, expectedExit, actualExit, fillTimeMs, orderType } = req.body;
    if (!symbol || !expectedEntry || !actualEntry) {
      res.status(400).json({ ok: false, error: "symbol, expectedEntry, actualEntry required" });
      return;
    }
    const report = reportExecutionQuality({
      tradeId: tradeId ?? `trade_${Date.now()}`,
      symbol, expectedEntry, actualEntry,
      expectedExit: expectedExit ?? actualExit ?? actualEntry,
      actualExit: actualExit ?? actualEntry,
      fillTimeMs: fillTimeMs ?? 0,
      orderType: orderType ?? "MARKET",
    });
    res.json({ ok: true, report });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// POST /api/execution-intelligence/reset
router.post("/api/execution-intelligence/reset", async (_req: Request, res: Response) => {
  try {
    resetExecutionIntelligence();
    res.json({ ok: true, message: "Execution intelligence state reset" });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

export default router;
