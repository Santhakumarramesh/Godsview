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
import { eq } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

// ─── Signal Explanation ────────────────────────────────────────────────────────

router.get("/explain/signal/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Mock signal data (would come from DB in production)
    const signal = {
      id,
      symbol: "SPY",
      setupType: "Breakout",
      direction: "long",
      timestamp: new Date().toISOString(),
    };

    const siResult = {
      structure_score: 0.78,
      order_flow_quality: 0.72,
      ml_confidence: 0.65,
    };

    const brainOutput = {
      mode: "NORMAL",
      consecutiveLosses: 0,
      recentWinRate: 0.54,
    };

    const explanation = await explainabilitySystem.explain({
      type: "signal",
      context: { signal, siResult, brainOutput },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain signal");
    res.status(500).json({ error: "internal_error", message: "Failed to explain signal" });
  }
});

// ─── Trade Explanation ────────────────────────────────────────────────────────

router.get("/explain/trade/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Mock trade data
    const trade = {
      id,
      symbol: "SPY",
      direction: "long",
      entryPrice: 450.25,
      exitPrice: 452.75,
      pnl: 2.5,
      enteredAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      exitedAt: new Date().toISOString(),
    };

    const context = {
      setupQuality: 0.78,
      macroBias: {
        bias: "uptrend",
        direction: "long",
        tailwind: true,
        conviction: "high",
      },
      exitType: "profit_target",
      targetPct: 2.5,
      riskAmount: 1.5,
      orderFlowQuality: 0.72,
      riskRewardRatio: 2.0,
      percentOfMove: 85,
    };

    const explanation = await explainabilitySystem.explain({
      type: "trade",
      context: { trade, context },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain trade");
    res.status(500).json({ error: "internal_error", message: "Failed to explain trade" });
  }
});

// ─── Strategy Explanation ─────────────────────────────────────────────────────

router.get("/explain/strategy/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Mock strategy data
    const strategy = {
      id,
      name: "Momentum Breakout",
      winRate: 0.542,
      profitFactor: 1.45,
      sharpeRatio: 1.2,
      maxDrawdown: 0.12,
      totalTrades: 125,
    };

    const metrics = {
      winRate: 0.542,
      profitFactor: 1.45,
      sharpeRatio: 1.2,
      maxDrawdown: 0.12,
      totalTrades: 125,
      entryQuality: 0.68,
      exitQuality: 0.61,
      riskManagementScore: 0.72,
      filterQuality: 0.65,
      robustnessScore: 0.58,
      meanReversionWins: 45,
      timingEdge: 0.18,
    };

    const explanation = await explainabilitySystem.explain({
      type: "strategy",
      context: { strategy, metrics },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain strategy");
    res.status(500).json({ error: "internal_error", message: "Failed to explain strategy" });
  }
});

// ─── No Trade Explanation ────────────────────────────────────────────────────

router.get("/explain/no-trade/:symbol", async (req, res) => {
  try {
    const { symbol } = req.params;

    const marketState = {
      trend: "flat",
      volatility: 1.8,
      orderFlowQuality: 0.45,
      price: 450.25,
    };

    const brainOutput = {
      mode: "NORMAL",
      running: true,
      consecutiveLosses: 0,
    };

    const explanation = await explainabilitySystem.explain({
      type: "no_trade",
      context: { symbol, marketState, brainOutput },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to explain no-trade");
    res.status(500).json({ error: "internal_error", message: "Failed to explain no-trade" });
  }
});

// ─── Attribution Analysis ────────────────────────────────────────────────────

router.get("/explain/attribution/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    // Mock trades
    const trades = [
      { symbol: "SPY", setupType: "Breakout", regime: "trending", pnl: 2.5, enteredAt: new Date().toISOString(), direction: "long" },
      { symbol: "QQQ", setupType: "MeanReversion", regime: "ranging", pnl: -1.2, enteredAt: new Date().toISOString(), direction: "short" },
      { symbol: "IWM", setupType: "Breakout", regime: "trending", pnl: 3.1, enteredAt: new Date().toISOString(), direction: "long" },
      { symbol: "SPY", setupType: "MeanReversion", regime: "choppy", pnl: 0.8, enteredAt: new Date().toISOString(), direction: "long" },
      { symbol: "QQQ", setupType: "Breakout", regime: "trending", pnl: 2.3, enteredAt: new Date().toISOString(), direction: "long" },
    ];

    const explanation = await explainabilitySystem.explain({
      type: "attribution",
      context: { trades },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze attribution");
    res.status(500).json({ error: "internal_error", message: "Failed to analyze attribution" });
  }
});

// ─── Fragility Analysis ──────────────────────────────────────────────────────

router.get("/explain/fragility/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    const strategy = {
      id: strategyId,
      name: "Momentum Breakout",
      stopLoss: 2.0,
      winRate: 0.542,
      totalReturn: 125,
    };

    const trades = [
      { symbol: "SPY", setupType: "Breakout", regime: "trending", pnl: 2.5 },
      { symbol: "QQQ", setupType: "Breakout", regime: "ranging", pnl: -1.2 },
      { symbol: "IWM", setupType: "Breakout", regime: "trending", pnl: 3.1 },
    ];

    const backtestResults = {
      sharpeRatio: 1.2,
      outOfSampleSharpe: 0.85,
      maxDrawdown: 0.12,
      tradesInBacktest: 125,
      totalReturn: 125,
    };

    const explanation = await explainabilitySystem.explain({
      type: "fragility",
      context: { strategy, trades, backtestResults },
    });

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to analyze fragility");
    res.status(500).json({ error: "internal_error", message: "Failed to analyze fragility" });
  }
});

// ─── Comprehensive Strategy Report ───────────────────────────────────────────

router.get("/explain/report/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    const strategy = {
      id: strategyId,
      name: "Momentum Breakout",
      period: "Full History",
    };

    const results = {
      totalTrades: 125,
      wins: 68,
      losses: 57,
      winRate: 0.542,
      totalReturn: 125.5,
      avgWin: 2.45,
      avgLoss: 1.8,
      profitFactor: 1.45,
      sharpeRatio: 1.2,
      maxDrawdown: 0.12,
      calmarRatio: 10.4,
      sortinoRatio: 1.65,
      bestSetup: "Breakout",
      bestRegime: "Trending",
      skillComponent: 85,
      luckComponent: 40.5,
      fragilityScore: 35,
      topRisk: "Concentration in 3 symbols",
    };

    const explanation = await explainabilitySystem.generateComprehensiveReport(
      strategy,
      [],
      results,
    );

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate strategy report");
    res.status(500).json({ error: "internal_error", message: "Failed to generate strategy report" });
  }
});

// ─── Daily Report ────────────────────────────────────────────────────────────

router.get("/explain/daily", async (req, res) => {
  try {
    const date = new Date().toISOString().split("T")[0];

    const trades = [
      { symbol: "SPY", direction: "long", entryPrice: 450.25, exitPrice: 452.75, pnl: 2.5, enteredAt: new Date().toISOString(), setupType: "Breakout", outcome: "win" },
      { symbol: "QQQ", direction: "short", entryPrice: 380.5, exitPrice: 379.8, pnl: 0.7, enteredAt: new Date().toISOString(), setupType: "MeanReversion", outcome: "win" },
      { symbol: "IWM", direction: "long", entryPrice: 205.25, exitPrice: 204.1, pnl: -1.15, enteredAt: new Date().toISOString(), setupType: "Breakout", outcome: "loss" },
    ];

    const explanation = await explainabilitySystem.generateDailyReport(trades, date);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate daily report");
    res.status(500).json({ error: "internal_error", message: "Failed to generate daily report" });
  }
});

// ─── Performance Review ──────────────────────────────────────────────────────

router.get("/explain/performance", async (req, res) => {
  try {
    const period = req.query.period as string || "Q1 2025";

    const explanation = await explainabilitySystem.generatePerformanceReview(period);

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate performance review");
    res.status(500).json({ error: "internal_error", message: "Failed to generate performance review" });
  }
});

// ─── Executive Summary ───────────────────────────────────────────────────────

router.get("/explain/executive", async (req, res) => {
  try {
    const explanation = await explainabilitySystem.generateExecutiveSummary();

    res.json(explanation);
  } catch (err) {
    req.log.error({ err }, "Failed to generate executive summary");
    res.status(500).json({ error: "internal_error", message: "Failed to generate executive summary" });
  }
});

// ─── Skill vs Luck Decomposition ────────────────────────────────────────────

router.get("/explain/skill-luck", async (req, res) => {
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
    res.status(500).json({ error: "internal_error", message: "Failed to decompose skill/luck" });
  }
});

// ─── Regime Attribution ──────────────────────────────────────────────────────

router.get("/explain/regime-attribution", async (req, res) => {
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
    res.status(500).json({ error: "internal_error", message: "Failed to analyze regime attribution" });
  }
});

// ─── Temporal Patterns ───────────────────────────────────────────────────────

router.get("/explain/temporal-patterns", async (req, res) => {
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
    res.status(500).json({ error: "internal_error", message: "Failed to analyze temporal patterns" });
  }
});

// ─── Entry/Exit Quality ─────────────────────────────────────────────────────

router.get("/explain/entry-exit-quality", async (req, res) => {
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
    res.status(500).json({ error: "internal_error", message: "Failed to analyze entry/exit quality" });
  }
});

// ─── Factor Analysis ────────────────────────────────────────────────────────

router.get("/explain/factor-analysis", async (req, res) => {
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
    res.status(500).json({ error: "internal_error", message: "Failed to analyze factors" });
  }
});

export default router;
