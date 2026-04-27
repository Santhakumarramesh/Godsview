import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  computeFeatures,
  computeFeatureSeries,
  computeRSI,
  computeATR,
  getSessionLabel,
  type OHLCV,
} from "../lib/feature_pipeline";
import { markEngineRun, markEngineError } from "../lib/ops_monitor";
import { getBars } from "../lib/alpaca";

const router = Router();

// POST /features/compute — single feature vector from bars
router.post("/compute", (req: Request, res: Response): void => {
  const start = Date.now();
  try {
    const { bars, symbol, timeframe } = req.body;

    if (!bars || !Array.isArray(bars) || bars.length === 0) {
      res.status(400).json({ error: "bars array required (OHLCV[])" });
      return;
    }
    if (!symbol || typeof symbol !== "string") {
      res.status(400).json({ error: "symbol string required" });
      return;
    }

    const tf = timeframe ?? "1m";
    const validBars: OHLCV[] = bars.map((b: any) => ({
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume ?? 0),
      timestamp: b.timestamp ?? new Date().toISOString(),
    }));

    const features = computeFeatures(validBars, symbol.toUpperCase(), tf);
    markEngineRun("feature-pipeline");

    res.json({
      features,
      bars_used: validBars.length,
      latency_ms: Date.now() - start,
    });
  } catch (error) {
    markEngineError("feature-pipeline");
    logger.error(`Feature compute failed: ${error}`);
    res.status(503).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// POST /features/series — feature vectors for a sliding window
router.post("/series", (req: Request, res: Response): void => {
  const start = Date.now();
  try {
    const { bars, symbol, timeframe } = req.body;

    if (!bars || !Array.isArray(bars) || bars.length < 21) {
      res.status(400).json({ error: "At least 21 bars required for series computation" });
      return;
    }

    const tf = timeframe ?? "1m";
    const validBars: OHLCV[] = bars.map((b: any) => ({
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume ?? 0),
      timestamp: b.timestamp ?? new Date().toISOString(),
    }));

    const series = computeFeatureSeries(validBars, symbol.toUpperCase(), tf);
    markEngineRun("feature-pipeline");

    res.json({
      series,
      count: series.length,
      bars_used: validBars.length,
      latency_ms: Date.now() - start,
    });
  } catch (error) {
    markEngineError("feature-pipeline");
    logger.error(`Feature series failed: ${error}`);
    res.status(503).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /features/indicators — standalone indicator computation
router.get("/indicators", (req: Request, res: Response): void => {
  try {
    const { type, values, period } = req.query;

    if (!type || !values) {
      res.status(400).json({ error: "type and values query params required" });
      return;
    }

    const nums = String(values).split(",").map(Number).filter((n) => !isNaN(n));
    const p = Number(period) || 14;

    switch (String(type).toLowerCase()) {
      case "rsi":
        res.json({ indicator: "rsi", period: p, value: computeRSI(nums, p) });
        break;
      case "session":
        res.json({ indicator: "session", value: getSessionLabel(new Date().toISOString()) });
        break;
      default:
        res.status(400).json({ error: `Unknown indicator type: ${type}` });
    }
  } catch (error) {
    logger.error(`Indicator compute failed: ${error}`);
    res.status(503).json({
      error: error instanceof Error ? error.message : "Internal server error",
    });
  }
});

// GET /features/:symbol — fetch latest bars from Alpaca, return current
// feature vector for the symbol. Powers footprint-delta,
// absorption-detector, imbalance-engine, and execution-pressure pages.
//
// IMPORTANT: this is a catch-all path param and MUST stay below the more
// specific routes above (/compute, /series, /indicators) so they aren't
// shadowed.
//
// Query params:
//   timeframe — Alpaca bar TF (1Min|5Min|15Min|1Hour|1Day, default 1Min)
//   bars     — bar count to fetch (default 200, min 50, max 1000)
router.get("/:symbol", async (req: Request, res: Response): Promise<void> => {
  const start = Date.now();
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: "symbol path param required" });
    return;
  }

  const timeframeRaw = String(req.query.timeframe ?? "1Min");
  const allowedTfs = ["1Min", "5Min", "15Min", "1Hour", "1Day"] as const;
  const timeframe = (allowedTfs as readonly string[]).includes(timeframeRaw)
    ? (timeframeRaw as (typeof allowedTfs)[number])
    : "1Min";

  const requestedBars = Number(req.query.bars ?? 200);
  const barCount = Math.max(50, Math.min(1000, isNaN(requestedBars) ? 200 : requestedBars));

  try {
    const bars = await getBars(symbol, timeframe, barCount);
    if (!bars || bars.length === 0) {
      res.status(503).json({
        error: "no_bars",
        message: `No bars returned for ${symbol} (${timeframe})`,
      });
      return;
    }

    const validBars: OHLCV[] = bars.map((b: any) => ({
      open: Number(b.open ?? b.o),
      high: Number(b.high ?? b.h),
      low: Number(b.low ?? b.l),
      close: Number(b.close ?? b.c),
      volume: Number(b.volume ?? b.v ?? 0),
      timestamp: b.timestamp ?? b.t ?? new Date().toISOString(),
    }));

    const features = computeFeatures(validBars, symbol, timeframe);
    markEngineRun("feature-pipeline");

    res.json({
      symbol,
      timeframe,
      features,
      bars_used: validBars.length,
      generated_at: new Date().toISOString(),
      latency_ms: Date.now() - start,
    });
  } catch (error) {
    markEngineError("feature-pipeline");
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`[features] GET /:symbol failed for ${symbol}: ${msg}`);
    res.status(503).json({
      error: "feature_compute_failed",
      message: msg,
      symbol,
      timeframe,
    });
  }
});

export default router;
