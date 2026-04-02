import { Router, type IRouter } from "express";
import { runBacktest, type BacktestConfig } from "../lib/backtester";
import { runMarketBacktest, type MarketBacktestConfig, SUPPORTED_TIMEFRAMES } from "../lib/market_backtester";

const router: IRouter = Router();

// Cache last statistical backtest result
let cachedResult: { config: BacktestConfig; result: any; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

// Per-symbol real-data market backtest cache
const marketCache = new Map<string, { result: any; ts: number }>();
const MARKET_CACHE_TTL_MS = 10 * 60_000; // 10 minutes

// ── POST /backtest/run ──────────────────────────────────────────────────────
router.post("/backtest/run", async (req, res): Promise<void> => {
  try {
    const config: BacktestConfig = {
      lookback_days: req.body.lookback_days ?? 90,
      initial_equity: req.body.initial_equity ?? 10_000,
      mode: req.body.mode ?? "comparison",
      min_signals: req.body.min_signals ?? 50,
    };
    if (cachedResult && Date.now() - cachedResult.ts < CACHE_TTL_MS
      && cachedResult.config.lookback_days === config.lookback_days) {
      res.json(cachedResult.result); return;
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
router.get("/backtest/quick", async (_req, res): Promise<void> => {
  try {
    if (cachedResult && Date.now() - cachedResult.ts < CACHE_TTL_MS) {
      res.json({
        baseline_win_rate: cachedResult.result.baseline?.win_rate,
        si_win_rate: cachedResult.result.super_intelligence?.win_rate,
        win_rate_delta: cachedResult.result.improvement?.win_rate_delta,
        cached: true,
      }); return;
    }
    const result = await runBacktest({ lookback_days: 30, initial_equity: 10_000, mode: "comparison", min_signals: 20 });
    cachedResult = { config: { lookback_days: 30, initial_equity: 10_000, mode: "comparison" }, result, ts: Date.now() };
    res.json({
      baseline_win_rate: result.baseline?.win_rate,
      si_win_rate: result.super_intelligence?.win_rate,
      win_rate_delta: result.improvement?.win_rate_delta,
      cached: false,
    });
  } catch (err) {
    res.status(500).json({ error: "quick_backtest_failed", message: String(err) });
  }
});

// ── GET /backtest/timeframes ────────────────────────────────────────────────
router.get("/backtest/timeframes", (_req, res) => {
  res.json({ timeframes: SUPPORTED_TIMEFRAMES });
});

// ── GET /backtest/market/quick ──────────────────────────────────────────────
// Real-data BTC daily backtest, 365 days — for dashboard widget
router.get("/backtest/market/quick", async (_req, res): Promise<void> => {
  try {
    const cacheKey = "BTCUSD:1day:365";
    const cached = marketCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL_MS) {
      res.json({ ...cached.result, cached: true }); return;
    }
    const result = await runMarketBacktest({
      symbol: "BTCUSD", timeframe: "1day", lookback_days: 365,
      initial_equity: 10_000, risk_per_trade_pct: 0.01, use_si_filter: true,
    });
    marketCache.set(cacheKey, { result, ts: Date.now() });
    res.json({ ...result, cached: false });
  } catch (err) {
    res.status(500).json({ error: "market_quick_failed", message: String(err) });
  }
});

// ── POST /backtest/market ───────────────────────────────────────────────────
// Full real-data market backtest via Tiingo → AlphaVantage → Finnhub.
// Uses every available bar from the past year. No synthetic data.
router.post("/backtest/market", async (req, res): Promise<void> => {
  try {
    const config: MarketBacktestConfig = {
      symbol:             (req.body.symbol ?? "BTCUSD").toUpperCase(),
      timeframe:          req.body.timeframe ?? "1day",
      lookback_days:      req.body.lookback_days ?? 365,
      initial_equity:     req.body.initial_equity ?? 10_000,
      risk_per_trade_pct: req.body.risk_per_trade_pct ?? 0.01,
      use_si_filter:      req.body.use_si_filter !== false,
    };

    const cacheKey = `${config.symbol}:${config.timeframe}:${config.lookback_days}`;
    const cached = marketCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < MARKET_CACHE_TTL_MS) {
      res.json({ ...cached.result, cached: true }); return;
    }

    const result = await runMarketBacktest(config);
    marketCache.set(cacheKey, { result, ts: Date.now() });
    res.json({ ...result, cached: false });
  } catch (err) {
    req.log.error({ err }, "Market backtest failed");
    res.status(500).json({ error: "market_backtest_failed", message: String(err) });
  }
});

export default router;
