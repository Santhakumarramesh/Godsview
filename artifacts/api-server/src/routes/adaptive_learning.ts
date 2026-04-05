/**
 * adaptive_learning.ts — Adaptive Learning Lifecycle API
 *
 * GET  /api/learning/snapshot           — full engine snapshot
 * POST /api/learning/compare            — champion vs challenger
 * POST /api/learning/record             — record strategy performance
 * POST /api/learning/attribute          — post-trade attribution
 * GET  /api/learning/triggers/:id       — get retrain triggers for strategy
 * GET  /api/learning/regime/:id         — regime performance for strategy
 * GET  /api/learning/retirement         — retirement candidates
 * POST /api/learning/reset              — reset all state
 */

import { Router, type Request, type Response } from "express";
import {
  getAdaptiveLearningSnapshot,
  compareStrategies,
  recordStrategyPerformance,
  attributeTrade,
  evaluateRetrainTriggers,
  getRegimePerformance,
  getRetirementCandidates,
  resetAdaptiveLearning,
} from "../lib/adaptive_learning_engine.js";

const router = Router();

router.get("/api/learning/snapshot", (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, snapshot: getAdaptiveLearningSnapshot() });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/learning/compare", (req: Request, res: Response) => {
  try {
    const { champion_id, challenger_id, regime } = req.body;
    if (!champion_id || !challenger_id) {
      res.status(400).json({ ok: false, error: "champion_id and challenger_id required" });
      return;
    }
    const result = compareStrategies(champion_id, challenger_id, regime ?? "ALL");
    res.json({ ok: true, result });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/learning/record", (req: Request, res: Response) => {
  try {
    const record = req.body;
    if (!record.strategyId) {
      res.status(400).json({ ok: false, error: "strategyId required" });
      return;
    }
    recordStrategyPerformance({
      strategyId: record.strategyId,
      version: Number(record.version ?? 1),
      regime: record.regime ?? "ALL",
      totalTrades: Number(record.totalTrades ?? 0),
      winRate: Number(record.winRate ?? 0),
      profitFactor: Number(record.profitFactor ?? 0),
      sharpeRatio: Number(record.sharpeRatio ?? 0),
      maxDrawdownPct: Number(record.maxDrawdownPct ?? 0),
      expectancy: Number(record.expectancy ?? 0),
      avgWin: Number(record.avgWin ?? 0),
      avgLoss: Number(record.avgLoss ?? 0),
      lastTradeAt: record.lastTradeAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    res.json({ ok: true, message: "Performance recorded" });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/learning/attribute", (req: Request, res: Response) => {
  try {
    const p = req.body;
    if (!p.tradeId || !p.strategyId || !p.symbol) {
      res.status(400).json({ ok: false, error: "tradeId, strategyId, symbol required" });
      return;
    }
    const result = attributeTrade({
      tradeId: p.tradeId,
      strategyId: p.strategyId,
      symbol: p.symbol,
      direction: p.direction ?? "long",
      pnl: Number(p.pnl ?? 0),
      entryPrice: Number(p.entryPrice ?? 0),
      exitPrice: Number(p.exitPrice ?? 0),
      entryTime: p.entryTime ?? new Date().toISOString(),
      exitTime: p.exitTime ?? new Date().toISOString(),
      regime: p.regime ?? "UNKNOWN",
      structureScore: p.structureScore != null ? Number(p.structureScore) : undefined,
      orderFlowScore: p.orderFlowScore != null ? Number(p.orderFlowScore) : undefined,
      contextFusionScore: p.contextFusionScore != null ? Number(p.contextFusionScore) : undefined,
      macroBiasAligned: p.macroBiasAligned ?? true,
      sentimentAligned: p.sentimentAligned ?? true,
    });
    res.json({ ok: true, attribution: result });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/learning/triggers/:strategyId", (req: Request, res: Response) => {
  try {
    const triggers = evaluateRetrainTriggers(String(req.params.strategyId));
    res.json({ ok: true, triggers });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/learning/regime/:strategyId", (req: Request, res: Response) => {
  try {
    const performance = getRegimePerformance(String(req.params.strategyId));
    res.json({ ok: true, performance });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/learning/retirement", (_req: Request, res: Response) => {
  try {
    res.json({ ok: true, candidates: getRetirementCandidates() });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/learning/reset", (_req: Request, res: Response) => {
  try {
    resetAdaptiveLearning();
    res.json({ ok: true, message: "Adaptive learning state reset" });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

export default router;
