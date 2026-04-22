/**
 * strategy_prompt.ts — Phase 149: Strategy Prompt Engine API
 *
 * POST /strategy-prompt/backtest — NLP prompt → multi-TF backtest
 * POST /strategy-prompt/parse    — NLP prompt → parsed strategy (no backtest)
 * GET  /strategy-prompt/templates — pre-built strategy templates
 */

import { Router, type Request, type Response } from "express";
import { runStrategyBacktest, parseStrategyPrompt, type Timeframe } from "../lib/strategy_prompt_engine.js";

const router = Router();

// POST /strategy-prompt/backtest
router.post("/backtest", (req: Request, res: Response) => {
  const { prompt, symbol, timeframes } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required (string)" });
    return;
  }
  const sym = (symbol ?? "SPY").toUpperCase();
  const tfs = Array.isArray(timeframes) ? timeframes as Timeframe[] : undefined;
  const result = runStrategyBacktest(prompt, sym, tfs);
  res.json(result);
});

// POST /strategy-prompt/parse
router.post("/parse", (req: Request, res: Response) => {
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }
  res.json(parseStrategyPrompt(prompt));
});

// GET /strategy-prompt/templates
router.get("/templates", (_req: Request, res: Response) => {
  res.json([
    { id: "rsi_mean_reversion", name: "RSI Mean Reversion", prompt: "Buy when RSI < 30 and price above SMA 200, sell when RSI > 70", category: "mean_reversion" },
    { id: "macd_trend", name: "MACD Trend Follower", prompt: "Buy on MACD crossover above signal line with ADX > 25, exit on MACD crossover below", category: "trend" },
    { id: "smc_ob_fvg", name: "SMC Order Block + FVG", prompt: "SMC order block long with FVG confirmation and break of structure confirmed", category: "smc" },
    { id: "ict_killzone", name: "ICT Kill Zone Breakout", prompt: "ICT London kill zone breakout with stop hunt sweep and optimal trade entry", category: "ict" },
    { id: "vwap_bounce", name: "VWAP Bounce Scalper", prompt: "Mean reversion VWAP bounce with Bollinger squeeze on 5m timeframe", category: "scalp" },
    { id: "momentum_breakout", name: "Momentum Breakout", prompt: "Momentum breakout above resistance with volume confirmation and ADX > 30", category: "breakout" },
    { id: "orderflow_absorption", name: "Order Flow Absorption", prompt: "Order flow absorption detected at key level with delta divergence and footprint imbalance", category: "orderflow" },
    { id: "ichimoku_cloud", name: "Ichimoku Cloud Trend", prompt: "Buy when price above Ichimoku cloud with tenkan above kijun and supertrend bullish", category: "trend" },
  ]);
});

export default router;
