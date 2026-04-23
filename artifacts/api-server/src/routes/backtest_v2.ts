/**
 * routes/backtest_v2.ts — Phase 2: Backtest Credibility API (Real Computation)
 *
 * Replaces hardcoded mock data with real credibility scoring engine.
 *
 * Routes:
 *   POST /api/backtest-v2/analyze        — Run full analysis on a backtest result
 *   GET  /api/backtest-v2/results        — List all registered backtests
 *   GET  /api/backtest-v2/credibility    — All credibility reports
 *   GET  /api/backtest-v2/credibility/:id — Single credibility report
 *   GET  /api/backtest-v2/overfit/:id    — Overfitting analysis
 *   GET  /api/backtest-v2/leakage/:id    — Data leakage detection
 *   GET  /api/backtest-v2/promotion/:id  — Promotion decision
 *   GET  /api/backtest-v2/promotions     — Promotion history
 *   GET  /api/backtest-v2/summary        — Aggregate summary
 *   GET  /api/backtest-v2/health         — Health check
 */

import { Router, type Request, type Response } from "express";
import {
  runFullAnalysis,
  computeCredibility,
  computeOverfitRisk,
  detectLeakage,
  evaluatePromotion,
  registerBacktestResult,
  getBacktestResult,
  getCredibilityReport,
  getOverfitReport,
  getLeakageReport,
  getAllCredibilityReports,
  getPromotionHistory,
  getBacktestSummary,
  type BacktestResult,
} from "../lib/backtest_credibility_engine";

const router = Router();

/**
 * POST /api/backtest-v2/analyze
 * Run full credibility + overfit + leakage + promotion analysis
 */
router.post("/analyze", (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<BacktestResult>;

    const required = ["id", "strategy", "totalTrades", "winRate", "sharpeRatio", "maxDrawdown", "profitFactor"];
    const missing = required.filter((f) => !(f in body));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing: ${missing.join(", ")}` });
    }

    const bt: BacktestResult = {
      id: body.id!,
      strategy: body.strategy!,
      symbol: body.symbol ?? "MULTI",
      timeframe: body.timeframe ?? "5m",
      startDate: body.startDate ?? new Date(Date.now() - 90 * 86400000).toISOString(),
      endDate: body.endDate ?? new Date().toISOString(),
      totalTrades: body.totalTrades!,
      winRate: body.winRate!,
      profitFactor: body.profitFactor!,
      sharpeRatio: body.sharpeRatio!,
      maxDrawdown: body.maxDrawdown!,
      avgHoldMinutes: body.avgHoldMinutes ?? 45,
      expectancy: body.expectancy ?? (body.winRate! * (body.profitFactor! - 1) - (1 - body.winRate!)),
      inSampleSharpe: body.inSampleSharpe ?? body.sharpeRatio!,
      outOfSampleSharpe: body.outOfSampleSharpe ?? body.sharpeRatio! * 0.7,
      walkForwardWindows: body.walkForwardWindows ?? [],
      parameterCount: body.parameterCount ?? 5,
      regimePerformance: body.regimePerformance ?? {},
      feeModel: body.feeModel ?? "per_share",
      feePerShare: body.feePerShare ?? 0.005,
      slippageModel: body.slippageModel ?? "fixed_bps",
      slippageBps: body.slippageBps ?? 5,
      fillModel: body.fillModel ?? "next_bar",
      latencyMs: body.latencyMs ?? 50,
    };

    const analysis = runFullAnalysis(bt);
    res.json({ success: true, analysis, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/results
 */
router.get("/results", (_req: Request, res: Response) => {
  try {
    const summary = getBacktestSummary();
    res.json({ success: true, ...summary });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/credibility
 */
router.get("/credibility", (_req: Request, res: Response) => {
  try {
    const reports = getAllCredibilityReports();
    res.json({ success: true, count: reports.length, reports });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/credibility/:id
 */
router.get("/credibility/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const report = getCredibilityReport(id);
    if (!report) {
      return res.status(404).json({ error: `No credibility report for ${id}` });
    }
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/overfit/:id
 */
router.get("/overfit/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const report = getOverfitReport(id);
    if (!report) {
      return res.status(404).json({ error: `No overfit report for ${id}` });
    }
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/leakage/:id
 */
router.get("/leakage/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const report = getLeakageReport(id);
    if (!report) {
      return res.status(404).json({ error: `No leakage report for ${id}` });
    }
    res.json({ success: true, report });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/promotion/:id
 */
router.get("/promotion/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const bt = getBacktestResult(id);
    if (!bt) {
      return res.status(404).json({ error: `No backtest found for ${id}` });
    }
    const decision = evaluatePromotion(bt);
    res.json({ success: true, decision });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/promotions
 */
router.get("/promotions", (_req: Request, res: Response) => {
  try {
    const history = getPromotionHistory();
    res.json({ success: true, count: history.length, promotions: history });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/summary
 */
router.get("/summary", (_req: Request, res: Response) => {
  try {
    const summary = getBacktestSummary();
    res.json({ success: true, ...summary, timestamp: new Date().toISOString() });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest-v2/health
 */
router.get("/health", (_req: Request, res: Response) => {
  try {
    const summary = getBacktestSummary();
    res.json({
      success: true,
      engine: "backtest_credibility_v2",
      version: "2.0.0",
      total: summary.total,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
