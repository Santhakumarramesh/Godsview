/**
 * explain.ts — API Routes for Explainability System
 *
 * All routes return plain-English explanations of trading decisions:
 *   GET /api/explain/signal/:id - explain a signal decision
 *   GET /api/explain/trade/:id - explain a trade entry/exit
 *   GET /api/explain/strategy/:id - explain strategy quality
 *   GET /api/explain/no-trade/:symbol - explain why not trading
 *   GET /api/explain/attribution/:strategyId - return attribution
 *   GET /api/explain/fragility/:strategyId - fragility analysis
 *   GET /api/explain/report/:strategyId - full comprehensive report
 *   GET /api/explain/daily - daily report
 *   GET /api/explain/executive - executive summary
 */

import { Router, type IRouter } from "express";
import { explainabilitySystem } from "../lib/explain/index.js";
import { db, tradesTable, signalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Signal Explanation ────────────────────────────────────────────────────────

router.get("/signal/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Query database for actual signal data
    const dbSignal = await db.query.signalsTable.findFirst({
      where: eq(signalsTable.id, id),
    }).catch(() => null);

    if (!dbSignal) {
      return res.json({
        success: true,
        source: "database",
        message: "No signal found with this ID",
        data: null,
      });
    }

    const explanation = await explainabilitySystem.explain({
      type: "signal",
      context: { signal: dbSignal },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain signal");
    res.status(503).json({ error: "internal_error", message: "Failed to explain signal" });
  }
});

// ─── Trade Explanation ────────────────────────────────────────────────────────

router.get("/trade/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Query database for actual trade data
    const dbTrade = await db.query.tradesTable.findFirst({
      where: eq(tradesTable.id, id),
    }).catch(() => null);

    if (!dbTrade) {
      return res.json({
        success: true,
        source: "database",
        message: "No trade found with this ID",
        data: null,
      });
    }

    const explanation = await explainabilitySystem.explain({
      type: "trade",
      context: { trade: dbTrade },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain trade");
    res.status(503).json({ error: "internal_error", message: "Failed to explain trade" });
  }
});

// ─── Strategy Explanation ─────────────────────────────────────────────────────

router.get("/strategy/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Query database for strategy data
    const trades = await db.query.tradesTable.findMany({
      where: eq(tradesTable.strategyId, id),
    }).catch(() => []);

    if (trades.length === 0) {
      return res.json({
        success: true,
        source: "database",
        message: "No trades found for this strategy",
        data: null,
      });
    }

    const explanation = await explainabilitySystem.explain({
      type: "strategy",
      context: { trades },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain strategy");
    res.status(503).json({ error: "internal_error", message: "Failed to explain strategy" });
  }
});

// ─── No Trade Explanation ────────────────────────────────────────────────────

router.get("/no-trade/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;

    res.json({
      success: true,
      source: "database",
      symbol,
      message: "Connect real market data source to provide no-trade analysis",
      data: null,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to explain no-trade");
    res.status(503).json({ error: "internal_error", message: "Failed to explain no-trade" });
  }
});

// ─── Attribution Analysis ────────────────────────────────────────────────────

router.get("/attribution/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    // Query database for trades
    const trades = await db.query.tradesTable.findMany({
      where: eq(tradesTable.strategyId, strategyId),
    }).catch(() => []);

    if (trades.length === 0) {
      return res.json({
        success: true,
        source: "database",
        message: "No trades found for attribution analysis",
        data: null,
      });
    }

    const explanation = await explainabilitySystem.explain({
      type: "attribution",
      context: { trades },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze attribution");
    res.status(503).json({ error: "internal_error", message: "Failed to analyze attribution" });
  }
});

// ─── Fragility Analysis ──────────────────────────────────────────────────────

router.get("/fragility/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    // Query database for trades
    const trades = await db.query.tradesTable.findMany({
      where: eq(tradesTable.strategyId, strategyId),
    }).catch(() => []);

    if (trades.length === 0) {
      return res.json({
        success: true,
        source: "database",
        message: "No trades found for fragility analysis",
        data: null,
      });
    }

    const explanation = await explainabilitySystem.explain({
      type: "fragility",
      context: { trades },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze fragility");
    res.status(503).json({ error: "internal_error", message: "Failed to analyze fragility" });
  }
});

// ─── Comprehensive Strategy Report ───────────────────────────────────────────

router.get("/report/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    // Query database for trades
    const trades = await db.query.tradesTable.findMany({
      where: eq(tradesTable.strategyId, strategyId),
    }).catch(() => []);

    if (trades.length === 0) {
      return res.json({
        success: true,
        source: "database",
        message: "No trades found for comprehensive report",
        data: null,
      });
    }

    const explanation = await explainabilitySystem.generateComprehensiveReport(
      { id: strategyId },
      trades,
      {},
    );

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate strategy report");
    res.status(503).json({ error: "internal_error", message: "Failed to generate strategy report" });
  }
});

// ─── Daily Report ────────────────────────────────────────────────────────────

router.get("/daily", async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];

    // Query database for today's trades
    const trades = await db.query.tradesTable.findMany({
      limit: 100,
    }).catch(() => []);

    if (trades.length === 0) {
      return res.json({
        success: true,
        source: "database",
        message: "No trades found for daily report",
        date,
        data: null,
      });
    }

    const explanation = await explainabilitySystem.generateDailyReport(trades, date);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate daily report");
    res.status(503).json({ error: "internal_error", message: "Failed to generate daily report" });
  }
});

// ─── Performance Review ──────────────────────────────────────────────────────

router.get("/performance", async (req, res) => {
  try {
    const period = req.query.period as string || "Q1 2025";

    const explanation = await explainabilitySystem.generatePerformanceReview(period);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate performance review");
    res.status(503).json({ error: "internal_error", message: "Failed to generate performance review" });
  }
});

// ─── Executive Summary ───────────────────────────────────────────────────────

router.get("/executive", async (req, res) => {
  try {
    const explanation = await explainabilitySystem.generateExecutiveSummary();

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate executive summary");
    res.status(503).json({ error: "internal_error", message: "Failed to generate executive summary" });
  }
});

// ─── Skill vs Luck Decomposition ────────────────────────────────────────────

router.get("/skill-luck", async (req, res) => {
  try {
    const trades = [
      { symbol: "SPY", pnl: 2.5, direction: "long", outcome: "win" },
      { symbol: "QQQ", pnl: -1.2, direction: "short", outcome: "loss" },
      { symbol: "SPY", pnl: 3.1, direction: "long", outcome: "win" },
      { symbol: "IWM", pnl: 0.8, direction: "long", outcome: "win" },
      { symbol: "QQQ", pnl: 2.3, direction: "short", outcome: "win" },
      { symbol: "SPY", pnl: -0.9, direction: "short", outcome: "loss" },
      { symbol: "IWM", pnl: 1.5, direction: "long", outcome: "win" },
      { symbol: "QQQ", pnl: -2.1, direction: "long", outcome: "loss" },
    ];

    const explanation = await explainabilitySystem.decomposeSkillLuck(trades);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to decompose skill/luck");
    res.status(503).json({ error: "internal_error", message: "Failed to decompose skill/luck" });
  }
});

// ─── Regime Attribution ──────────────────────────────────────────────────────

router.get("/regime-attribution", async (req, res) => {
  try {
    const trades = [
      { symbol: "SPY", pnl: 2.5, regime: "trending", setupType: "Breakout", outcome: "win" },
      { symbol: "QQQ", pnl: -1.2, regime: "ranging", setupType: "MeanReversion", outcome: "loss" },
      { symbol: "SPY", pnl: 3.1, regime: "trending", setupType: "Breakout", outcome: "win" },
      { symbol: "IWM", pnl: 0.8, regime: "choppy", setupType: "Breakout", outcome: "win" },
      { symbol: "QQQ", pnl: 2.3, regime: "ranging", setupType: "Breakout", outcome: "win" },
    ];

    const explanation = await explainabilitySystem.analyzeRegimeAttribution(trades);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze regime attribution");
    res.status(503).json({ error: "internal_error", message: "Failed to analyze regime attribution" });
  }
});

// ─── Temporal Patterns ───────────────────────────────────────────────────────

router.get("/temporal-patterns", async (req, res) => {
  try {
    const trades = [
      { symbol: "SPY", pnl: 2.5, enteredAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), outcome: "win" },
      { symbol: "QQQ", pnl: -1.2, enteredAt: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), outcome: "loss" },
      { symbol: "SPY", pnl: 3.1, enteredAt: new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString(), outcome: "win" },
      { symbol: "IWM", pnl: 0.8, enteredAt: new Date(Date.now() - 16 * 60 * 60 * 1000).toISOString(), outcome: "win" },
    ];

    const explanation = await explainabilitySystem.analyzeTemporalPatterns(trades);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze temporal patterns");
    res.status(503).json({ error: "internal_error", message: "Failed to analyze temporal patterns" });
  }
});

// ─── Entry/Exit Quality ─────────────────────────────────────────────────────

router.get("/entry-exit-quality", async (req, res) => {
  try {
    const trades = [
      { symbol: "SPY", pnl: 2.5, entryType: "BreakoutAbove", exitType: "ProfitTarget", entryQualityScore: 0.8, exitQualityScore: 0.75, barsToProfit: 5, percentOfMoveCapured: 0.85 },
      { symbol: "QQQ", pnl: -1.2, entryType: "MeanReversion", exitType: "StopLoss", entryQualityScore: 0.6, exitQualityScore: 0.5, barsToProfit: 3, percentOfMoveCapured: 0.4 },
      { symbol: "SPY", pnl: 3.1, entryType: "BreakoutAbove", exitType: "ProfitTarget", entryQualityScore: 0.85, exitQualityScore: 0.8, barsToProfit: 6, percentOfMoveCapured: 0.9 },
    ];

    const explanation = await explainabilitySystem.analyzeEntryExitQuality(trades);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze entry/exit quality");
    res.status(503).json({ error: "internal_error", message: "Failed to analyze entry/exit quality" });
  }
});

// ─── Factor Analysis ────────────────────────────────────────────────────────

router.get("/factor-analysis", async (req, res) => {
  try {
    const trades = [
      { symbol: "SPY", pnl: 2.5, volatility: 0.18, trend: 1.5, momentum: 0.85 },
      { symbol: "QQQ", pnl: -1.2, volatility: 0.22, trend: -0.5, momentum: 0.3 },
      { symbol: "SPY", pnl: 3.1, volatility: 0.16, trend: 2.1, momentum: 0.9 },
      { symbol: "IWM", pnl: 0.8, volatility: 0.2, trend: 0.8, momentum: 0.6 },
    ];

    const factors = ["volatility", "trend", "momentum"];

    const explanation = await explainabilitySystem.analyzeFactor(trades, factors);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze factors");
    res.status(503).json({ error: "internal_error", message: "Failed to analyze factors" });
  }
});

export default router;
