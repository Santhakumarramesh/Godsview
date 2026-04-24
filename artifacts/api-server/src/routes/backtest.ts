import { Router, type IRouter, type Request, type Response } from "express";
import {
  runBacktest,
  startContinuousBacktest,
  stopContinuousBacktest,
  getContinuousBacktestStatus,
  getStrategyLeaderboard,
  runWalkForwardBacktest,
  runStrategyOptimization,
  getWalkForwardTierRegistry,
  getLatestWalkForward,
  type BacktestConfig,
  type WalkForwardConfig,
  type StrategyOptimizationConfig,
} from "../lib/backtester";

const router: IRouter = Router();

// Cache last backtest result to avoid re-running expensive queries
let cachedResult: { config: BacktestConfig; result: any; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function parseNum(input: unknown): number | undefined {
  if (input === undefined || input === null || input === "") return undefined;
  const n = Number(input);
  return Number.isFinite(n) ? n : undefined;
}

// ── POST /backtest/run ──────────────────────────────────────────────────────
// Run a full backtest comparison: baseline vs Super Intelligence
router.post("/backtest/run", async (req, res): Promise<void> => {
  try {
    const config: BacktestConfig = {
      lookback_days: req.body.lookback_days ?? 90,
      initial_equity: req.body.initial_equity ?? 10_000,
      mode: req.body.mode ?? "comparison",
      min_signals: req.body.min_signals ?? 50,
    };

    // Check cache
    if (cachedResult && Date.now() - cachedResult.ts < CACHE_TTL_MS
      && cachedResult.config.lookback_days === config.lookback_days) {
      res.json(cachedResult.result);
      return;
    }

    const result = await runBacktest(config);
    cachedResult = { config, result, ts: Date.now() };
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Backtest execution failed");
    res.status(503).json({ error: "backtest_failed", message: String(err) });
  }
});

// ── GET /backtest/quick ─────────────────────────────────────────────────────
// Quick 30-day backtest with defaults (for dashboard widget)
router.get("/backtest/quick", async (_req, res): Promise<void> => {
  try {
    if (cachedResult && Date.now() - cachedResult.ts < CACHE_TTL_MS) {
      res.json({
        baseline_win_rate: cachedResult.result.baseline.win_rate,
        si_win_rate: cachedResult.result.super_intelligence.win_rate,
        win_rate_delta: cachedResult.result.improvement.win_rate_delta,
        baseline_pf: cachedResult.result.baseline.profit_factor,
        si_pf: cachedResult.result.super_intelligence.profit_factor,
        baseline_sharpe: cachedResult.result.baseline.sharpe_ratio,
        si_sharpe: cachedResult.result.super_intelligence.sharpe_ratio,
        signals_filtered_pct: cachedResult.result.improvement.signals_filtered_pct,
        is_significant: cachedResult.result.significance.is_significant,
        confidence: cachedResult.result.significance.confidence_level,
        cached: true,
      });
      return;
    }

    const result = await runBacktest({
      lookback_days: 30,
      initial_equity: 10_000,
      mode: "comparison",
      min_signals: 20,
    });

    cachedResult = {
      config: { lookback_days: 30, initial_equity: 10_000, mode: "comparison" },
      result,
      ts: Date.now(),
    };

    res.json({
      baseline_win_rate: result.baseline.win_rate,
      si_win_rate: result.super_intelligence.win_rate,
      win_rate_delta: result.improvement.win_rate_delta,
      baseline_pf: result.baseline.profit_factor,
      si_pf: result.super_intelligence.profit_factor,
      baseline_sharpe: result.baseline.sharpe_ratio,
      si_sharpe: result.super_intelligence.sharpe_ratio,
      signals_filtered_pct: result.improvement.signals_filtered_pct,
      is_significant: result.significance.is_significant,
      confidence: result.significance.confidence_level,
      cached: false,
    });
  } catch (err) {
    res.status(503).json({ error: "quick_backtest_failed", message: String(err) });
  }
});

// ── POST /backtest/continuous/start ─────────────────────────────────────────
// Start continuous backtesting over expanding time horizons (30/60/90/180/365 days)
router.post("/backtest/continuous/start", async (_req, res): Promise<void> => {
  try {
    const result = await startContinuousBacktest();
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: "continuous_start_failed", message: String(err) });
  }
});

// ── POST /backtest/continuous/stop ──────────────────────────────────────────
// Stop continuous backtesting
router.post("/backtest/continuous/stop", async (_req, res): Promise<void> => {
  try {
    const result = stopContinuousBacktest();
    res.json(result);
  } catch (err) {
    res.status(503).json({ error: "continuous_stop_failed", message: String(err) });
  }
});

// ── GET /backtest/continuous/status ─────────────────────────────────────────
// Get continuous backtest status and statistics
router.get("/backtest/continuous/status", async (_req, res): Promise<void> => {
  try {
    const status = getContinuousBacktestStatus();
    res.json(status);
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get continuous backtest status" });
  }
});

// ── GET /backtest/strategy-leaderboard ──────────────────────────────────────
// Get strategy leaderboard with star ratings and consistency scores
router.get("/backtest/strategy-leaderboard", async (_req, res): Promise<void> => {
  try {
    const leaderboard = getStrategyLeaderboard();
    res.json({
      count: leaderboard.length,
      strategies: leaderboard,
    });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get strategy leaderboard" });
  }
});

async function handleWalkForward(req: Request, res: Response): Promise<void> {
  try {
    const strategyId = String(req.params.strategyId ?? "").trim();
    if (!strategyId) {
      res.status(400).json({ error: "validation_error", message: "strategyId path param is required" });
      return;
    }

    const merged = { ...(req.query ?? {}), ...(req.body ?? {}) };
    const config: WalkForwardConfig = {
      strategy_id: strategyId,
      lookback_days: parseNum(merged.lookback_days),
      train_days: parseNum(merged.train_days),
      test_days: parseNum(merged.test_days),
      step_days: parseNum(merged.step_days),
      min_train_samples: parseNum(merged.min_train_samples),
      min_test_samples: parseNum(merged.min_test_samples),
      min_win_rate: parseNum(merged.min_win_rate),
      min_profit_factor: parseNum(merged.min_profit_factor),
      max_drawdown_pct: parseNum(merged.max_drawdown_pct),
    };

    const result = await runWalkForwardBacktest(config);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Walk-forward backtest failed");
    res.status(503).json({ error: "walk_forward_failed", message: String(err) });
  }
}

// ── GET|POST /backtest/walk-forward/:strategyId ─────────────────────────────
router.get("/backtest/walk-forward/:strategyId", handleWalkForward);
router.post("/backtest/walk-forward/:strategyId", handleWalkForward);

// Alias under brain namespace for dashboard composition compatibility
router.get("/brain/backtest/walk-forward/:strategyId", handleWalkForward);
router.post("/brain/backtest/walk-forward/:strategyId", handleWalkForward);

// ── GET /backtest/walk-forward/tiers ────────────────────────────────────────
router.get("/backtest/walk-forward/tiers", async (_req, res): Promise<void> => {
  try {
    const tiers = getWalkForwardTierRegistry();
    res.json({ count: tiers.length, tiers });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get strategy tiers" });
  }
});

router.get("/brain/backtest/walk-forward/tiers", async (_req, res): Promise<void> => {
  try {
    const tiers = getWalkForwardTierRegistry();
    res.json({ count: tiers.length, tiers });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get strategy tiers" });
  }
});

// ── GET /backtest/walk-forward/latest[/ :strategyId] ────────────────────────
router.get("/backtest/walk-forward/latest", async (_req, res): Promise<void> => {
  try {
    const latest = getLatestWalkForward();
    const rows = Array.isArray(latest) ? latest : latest ? [latest] : [];
    res.json({ count: rows.length, results: rows });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get latest walk-forward results" });
  }
});

router.get("/backtest/walk-forward/latest/:strategyId", async (req, res): Promise<void> => {
  try {
    const latest = getLatestWalkForward(String(req.params.strategyId ?? ""));
    if (!latest) {
      res.status(404).json({ error: "not_found", message: "No walk-forward result for strategy" });
      return;
    }
    res.json(latest);
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get walk-forward result" });
  }
});

// ── POST /backtest/optimize/:strategyId ─────────────────────────────────────
router.post("/backtest/optimize/:strategyId", async (req, res): Promise<void> => {
  try {
    const strategyId = String(req.params.strategyId ?? "").trim();
    if (!strategyId) {
      res.status(400).json({ error: "validation_error", message: "strategyId path param is required" });
      return;
    }

    const body = req.body ?? {};
    const config: StrategyOptimizationConfig = {
      strategy_id: strategyId,
      lookback_days: parseNum(body.lookback_days),
      min_train_samples: parseNum(body.min_train_samples),
      min_test_samples: parseNum(body.min_test_samples),
    };

    const result = await runStrategyOptimization(config);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Strategy optimization failed");
    res.status(503).json({ error: "strategy_optimization_failed", message: String(err) });
  }
});

router.post("/brain/backtest/optimize/:strategyId", async (req, res): Promise<void> => {
  try {
    const strategyId = String(req.params.strategyId ?? "").trim();
    if (!strategyId) {
      res.status(400).json({ error: "validation_error", message: "strategyId path param is required" });
      return;
    }

    const body = req.body ?? {};
    const config: StrategyOptimizationConfig = {
      strategy_id: strategyId,
      lookback_days: parseNum(body.lookback_days),
      min_train_samples: parseNum(body.min_train_samples),
      min_test_samples: parseNum(body.min_test_samples),
    };

    const result = await runStrategyOptimization(config);
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Brain strategy optimization failed");
    res.status(503).json({ error: "strategy_optimization_failed", message: String(err) });
  }
});

export default router;
