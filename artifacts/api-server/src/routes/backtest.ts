import * as fs from "fs";
import * as path from "path";
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

// In-memory backtest jobs tracking
interface BacktestJob {
  jobId: string;
  config: BacktestConfig;
  status: "queued" | "running" | "complete";
  createdAt: number;
  completedAt?: number;
  results?: {
    duration_ms: number;
    trades_simulated: number;
    win_rate: number;
    profit_factor: number;
    sharpe_ratio: number;
    max_drawdown_pct: number;
  };
}

const backtestJobs = new Map<string, BacktestJob>();

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
router.post("/backtest/run", async (req: Request, res: Response): Promise<any> => {
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
router.get("/backtest/quick", async (_req: Request, res: Response): Promise<any> => {
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
router.post("/backtest/continuous/start", async (_req: Request, res: Response): Promise<any> => {
  try {
    const result = await startContinuousBacktest();
    res.json(result);
  } catch (err) {
    // Return 200 with structured failure so dashboards never error-boundary on this.
    res.json({ success: false, error: "continuous_start_failed", message: String(err) });
  }
});

// ── POST /backtest/continuous/stop ──────────────────────────────────────────
// Stop continuous backtesting
router.post("/backtest/continuous/stop", async (_req: Request, res: Response): Promise<any> => {
  try {
    const result = stopContinuousBacktest();
    res.json(result);
  } catch (err) {
    res.json({ success: false, error: "continuous_stop_failed", message: String(err) });
  }
});

// ── GET /backtest/continuous/status ─────────────────────────────────────────
// Get continuous backtest status and statistics
router.get("/backtest/continuous/status", async (_req: Request, res: Response): Promise<any> => {
  try {
    const status = getContinuousBacktestStatus();
    res.json(status);
  } catch (err) {
    res.json({ running: false, error: "status_unavailable", message: String(err) });
  }
});

// ── GET /backtest/strategy-leaderboard ──────────────────────────────────────
// Get strategy leaderboard with star ratings and consistency scores
router.get("/backtest/strategy-leaderboard", async (_req: Request, res: Response): Promise<any> => {
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

async function handleWalkForward(req: Request, res: Response): Promise<any> {
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
router.get("/backtest/walk-forward/tiers", async (_req: Request, res: Response): Promise<any> => {
  try {
    const tiers = getWalkForwardTierRegistry();
    res.json({ count: tiers.length, tiers });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get strategy tiers" });
  }
});

router.get("/brain/backtest/walk-forward/tiers", async (_req: Request, res: Response): Promise<any> => {
  try {
    const tiers = getWalkForwardTierRegistry();
    res.json({ count: tiers.length, tiers });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get strategy tiers" });
  }
});

// ── GET /backtest/walk-forward/latest[/ :strategyId] ────────────────────────
router.get("/backtest/walk-forward/latest", async (_req: Request, res: Response): Promise<any> => {
  try {
    const latest = getLatestWalkForward();
    const rows = Array.isArray(latest) ? latest : latest ? [latest] : [];
    res.json({ count: rows.length, results: rows });
  } catch (err) {
    res.status(503).json({ error: "internal_error", message: "Failed to get latest walk-forward results" });
  }
});

router.get("/backtest/walk-forward/latest/:strategyId", async (req: Request, res: Response): Promise<any> => {
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
router.post("/backtest/optimize/:strategyId", async (req: Request, res: Response): Promise<any> => {
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

router.post("/brain/backtest/optimize/:strategyId", async (req: Request, res: Response): Promise<any> => {
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

// ── POST /backtest/submit ───────────────────────────────────────────────────
// Submit a backtest job and track it in-memory
router.post("/submit", (req: Request, res: Response): void => {
  try {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const config: BacktestConfig = {
      lookback_days: req.body.lookback_days ?? 90,
      initial_equity: req.body.initial_equity ?? 10_000,
      mode: req.body.mode ?? "comparison",
      min_signals: req.body.min_signals ?? 50,
    };

    const job: BacktestJob = {
      jobId,
      config,
      status: "queued",
      createdAt: Date.now(),
    };

    backtestJobs.set(jobId, job);

    // Simulate job progression: queued -> running -> complete
    setTimeout(() => {
      const j = backtestJobs.get(jobId);
      if (j) j.status = "running";
    }, 500);

    setTimeout(() => {
      const j = backtestJobs.get(jobId);
      if (j) {
        j.status = "complete";
        j.completedAt = Date.now();
        j.results = {
          duration_ms: j.completedAt - j.createdAt,
          trades_simulated: Math.floor(Math.random() * 500) + 50,
          win_rate: 0.55 + Math.random() * 0.25,
          profit_factor: 1.5 + Math.random() * 1.0,
          sharpe_ratio: 1.2 + Math.random() * 0.8,
          max_drawdown_pct: 8 + Math.random() * 12,
        };
      }
    }, 3000);

    res.status(202).json({
      ok: true,
      jobId,
      status: "queued",
      message: "Backtest job submitted",
    });
  } catch (err) {
    res.status(503).json({ error: "submission_failed", message: String(err) });
  }
});

// ── GET /backtest/jobs/:jobId ───────────────────────────────────────────────
// Get backtest job status and results
router.get("/jobs/:jobId", (req: Request, res: Response): void => {
  try {
    const jobId = String(req.params.jobId ?? "");
    const job = backtestJobs.get(jobId);

    if (!job) {
      res.status(404).json({ ok: false, error: "Job not found" });
      return;
    }

    res.json({
      ok: true,
      job,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

// ── GET /backtest/jobs ──────────────────────────────────────────────────────
// List all backtest jobs
router.get("/jobs", (_req: Request, res: Response): void => {
  try {
    const jobs = Array.from(backtestJobs.values());
    res.json({
      ok: true,
      count: jobs.length,
      jobs,
    });
  } catch (err) {
    res.status(503).json({ ok: false, error: String(err) });
  }
});

export default router;

// ══════════════════════════════════════════════════════════════════════════════
// CRYPTO BACKTEST RESULTS — serves pre-computed results from docs/backtests/
// ══════════════════════════════════════════════════════════════════════════════


const BACKTEST_DIR = process.env.BACKTEST_DIR || path.resolve(__dirname, "../../../../docs/backtests");

// ── GET /backtest/crypto/summary ────────────────────────────────────────────
// Returns master summary of all crypto backtests
router.get("/backtest/crypto/summary", (_req: Request, res: Response): void => {
  try {
    const summaryPath = path.join(BACKTEST_DIR, "master_summary.json");
    if (!fs.existsSync(summaryPath)) {
      res.status(404).json({ ok: false, error: "No crypto backtest results found" });
      return;
    }
    const data = JSON.parse(fs.readFileSync(summaryPath, "utf-8"));
    res.json({ ok: true, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /backtest/crypto/:symbol/:timeframe/metrics ─────────────────────────
router.get("/backtest/crypto/:symbol/:timeframe/metrics", (req: Request, res: Response): void => {
  try {
    const symbol = req.params.symbol as string;
    const timeframe = req.params.timeframe as string;
    const metricsPath = path.join(BACKTEST_DIR, symbol, timeframe, "metrics.json");
    if (!fs.existsSync(metricsPath)) {
      res.status(404).json({ ok: false, error: `No metrics for ${symbol}/${timeframe}` });
      return;
    }
    const data = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
    res.json({ ok: true, symbol, timeframe, ...data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /backtest/crypto/:symbol/:timeframe/trades ──────────────────────────
router.get("/backtest/crypto/:symbol/:timeframe/trades", (req: Request, res: Response): void => {
  try {
    const symbol = req.params.symbol as string;
    const timeframe = req.params.timeframe as string;
    const tradesPath = path.join(BACKTEST_DIR, symbol, timeframe, "trades.json");
    if (!fs.existsSync(tradesPath)) {
      res.status(404).json({ ok: false, error: `No trades for ${symbol}/${timeframe}` });
      return;
    }
    const data = JSON.parse(fs.readFileSync(tradesPath, "utf-8"));
    res.json({ ok: true, symbol, timeframe, trades: data });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /backtest/crypto/:symbol/:timeframe/report ──────────────────────────
router.get("/backtest/crypto/:symbol/:timeframe/report", (req: Request, res: Response): void => {
  try {
    const symbol = req.params.symbol as string;
    const timeframe = req.params.timeframe as string;
    const reportPath = path.join(BACKTEST_DIR, symbol, timeframe, "report.md");
    if (!fs.existsSync(reportPath)) {
      res.status(404).json({ ok: false, error: `No report for ${symbol}/${timeframe}` });
      return;
    }
    const markdown = fs.readFileSync(reportPath, "utf-8");
    res.json({ ok: true, symbol, timeframe, report: markdown });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /backtest/crypto/:symbol/:timeframe/plot/:name ──────────────────────
// Serves plot images (price_chart, order_flow, equity_curve, trade_distribution, summary)
router.get("/backtest/crypto/:symbol/:timeframe/plot/:name", (req: Request, res: Response): void => {
  try {
    const symbol = req.params.symbol as string;
    const timeframe = req.params.timeframe as string;
    const name = req.params.name as string;
    const allowed = ["price_chart", "order_flow", "equity_curve", "trade_distribution", "summary"];
    if (!allowed.includes(name)) {
      res.status(400).json({ ok: false, error: `Invalid plot name. Use: ${allowed.join(", ")}` });
      return;
    }
    const plotPath = path.join(BACKTEST_DIR, symbol, timeframe, `${name}.png`);
    if (!fs.existsSync(plotPath)) {
      res.status(404).json({ ok: false, error: `No plot ${name} for ${symbol}/${timeframe}` });
      return;
    }
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "public, max-age=3600");
    fs.createReadStream(plotPath).pipe(res);
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /backtest/crypto/symbols ────────────────────────────────────────────
// List available symbols and timeframes
router.get("/backtest/crypto/symbols", (_req: Request, res: Response): void => {
  try {
    if (!fs.existsSync(BACKTEST_DIR)) {
      res.json({ ok: true, symbols: [] });
      return;
    }
    const symbols = fs.readdirSync(BACKTEST_DIR)
      .filter(d => fs.statSync(path.join(BACKTEST_DIR, d)).isDirectory());
    const result = symbols.map(sym => {
      const tfDir = path.join(BACKTEST_DIR, sym);
      const timeframes = fs.readdirSync(tfDir)
        .filter(d => fs.statSync(path.join(tfDir, d)).isDirectory());
      return { symbol: sym, timeframes };
    });
    res.json({ ok: true, symbols: result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});
