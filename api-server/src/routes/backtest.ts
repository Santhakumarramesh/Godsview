import { Router, type IRouter } from "express";
import { runBacktest, type BacktestConfig } from "../lib/backtester";

const router: IRouter = Router();

// Cache last backtest result to avoid re-running expensive queries
let cachedResult: { config: BacktestConfig; result: any; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

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
    res.status(500).json({ error: "backtest_failed", message: String(err) });
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
    res.status(500).json({ error: "quick_backtest_failed", message: String(err) });
  }
});

export default router;
