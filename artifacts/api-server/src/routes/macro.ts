/**
 * macro.ts — Macro/News Intelligence Routes
 *
 * Mounts at /api/macro (see routes/index.ts).
 *
 * Endpoints:
 *   GET  /context          — macro context (news/events)
 *   POST /events           — ingest macro event
 *   GET  /lockout/:symbol  — news lockout check
 *   GET  /events           — all stored events
 *   GET  /stats            — cache stats
 *   DELETE /clear          — clear events
 *   POST /bias             — compute MacroBiasResult from provided inputs
 *   POST /sentiment        — compute SentimentResult from provided inputs
 *   GET  /live             — fetch live macro snapshot (from market data)
 *   POST /live/refresh     — force-refresh live macro snapshot
 *   GET  /fred             — fetch FRED macro snapshot (CPI, rates, GDP, etc.)
 *   POST /fred/refresh     — force-refresh FRED data
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  ingestMacroEvent,
  getMacroContext,
  checkNewsLockout,
  clearMacroEvents,
  getMacroCacheStats,
  type MacroEvent,
} from "../lib/macro_engine";import { computeMacroBias } from "../lib/macro_bias_engine";
import type { MacroBiasInput } from "../lib/macro_bias_engine";
import { computeSentiment } from "../lib/sentiment_engine";
import type { SentimentInput } from "../lib/sentiment_engine";
import { fetchLiveMacroSnapshot } from "../lib/macro_feed";
import { fetchFredMacroSnapshot, clearFredCache } from "../lib/providers/fred_client.js";

const router = Router();

/**
 * GET /macro/context
 * Returns macro context with optional symbol filtering
 */
router.get("/context", (req: Request, res: Response) => {
  try {
    const symbolsParam = req.query.symbols as string | undefined;
    const symbols = symbolsParam ? symbolsParam.split(",").map((s) => s.trim()) : undefined;

    const context = getMacroContext(symbols);
    logger.info(`Fetched macro context for symbols: ${symbols?.join(", ") ?? "all"}`);
    res.json(context);
  } catch (error) {
    logger.error(`Error fetching macro context: ${String(error)}`);
    res.status(500).json({ error: "Failed to fetch macro context" });
  }
});

/**
 * POST /macro/events
 * Ingest a single macro event */
router.post("/events", (req: Request, res: Response): void => {
  try {
    const event = req.body as MacroEvent;

    if (!event.id || !event.type || !event.title || !event.impact) {
      res.status(400).json({ error: "Missing required event fields" });
      return;
    }

    ingestMacroEvent(event);
    logger.info(`Ingested macro event: ${event.id}`);
    res.status(201).json({ success: true, id: event.id });
  } catch (error) {
    logger.error(`Error ingesting macro event: ${String(error)}`);
    res.status(500).json({ error: "Failed to ingest macro event" });
  }
});

/**
 * GET /macro/lockout/:symbol
 * Check if a symbol is locked due to news
 */
router.get("/lockout/:symbol", (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "");
    const result = checkNewsLockout(symbol);
    logger.info(`Checked news lockout for ${symbol}: locked=${result.locked}`);
    res.json(result);  } catch (error) {
    logger.error(`Error checking news lockout: ${String(error)}`);
    res.status(500).json({ error: "Failed to check news lockout" });
  }
});

/**
 * GET /macro/events
 * Return all stored events (last 100)
 */
router.get("/events", (req: Request, res: Response) => {
  try {
    const context = getMacroContext();
    logger.info(`Fetched macro events: count=${context.events.length}`);
    res.json({ events: context.events });
  } catch (error) {
    logger.error(`Error fetching macro events: ${String(error)}`);
    res.status(500).json({ error: "Failed to fetch macro events" });
  }
});

/**
 * GET /macro/stats
 * Return cache statistics
 */
router.get("/stats", (req: Request, res: Response) => {
  try {
    const stats = getMacroCacheStats();
    res.json(stats);
  } catch (error) {    logger.error(`Error fetching macro stats: ${String(error)}`);
    res.status(500).json({ error: "Failed to fetch macro stats" });
  }
});

/**
 * DELETE /macro/clear
 * Clear all macro events
 */
router.delete("/clear", (req: Request, res: Response) => {
  try {
    clearMacroEvents();
    logger.info(`Cleared all macro events`);
    res.json({ success: true, message: "All macro events cleared" });
  } catch (error) {
    logger.error(`Error clearing macro events: ${String(error)}`);
    res.status(500).json({ error: "Failed to clear macro events" });
  }
});

/**
 * POST /macro/bias
 * Accepts MacroBiasInput, returns { bias: MacroBiasResult }
 */
router.post("/bias", (req: Request, res: Response) => {
  try {
    const input = req.body as MacroBiasInput;
    if (!input.assetClass || !input.intendedDirection) {
      res.status(400).json({ error: "assetClass and intendedDirection are required" });
      return;    }
    const bias = computeMacroBias(input);
    res.json({ bias });
  } catch (error) {
    logger.error(`[macro] /bias error: ${String(error)}`);
    res.status(500).json({ error: "Failed to compute macro bias" });
  }
});

/**
 * POST /macro/sentiment
 * Accepts SentimentInput, returns { sentiment: SentimentResult }
 */
router.post("/sentiment", (req: Request, res: Response) => {
  try {
    const input = req.body as SentimentInput;
    if (input.retailLongRatio === undefined) {
      res.status(400).json({ error: "retailLongRatio is required" });
      return;
    }
    const sentiment = computeSentiment(input);
    res.json({ sentiment });
  } catch (error) {
    logger.error(`[macro] /sentiment error: ${String(error)}`);
    res.status(500).json({ error: "Failed to compute sentiment" });
  }
});

// Simple in-memory cache for the live snapshot (refreshed on demand or every 5 min)
let _liveSnapshotCache: { snapshot: Awaited<ReturnType<typeof fetchLiveMacroSnapshot>>; cachedAt: number } | null = null;const LIVE_CACHE_TTL_MS = 5 * 60 * 1000;

async function getOrRefreshLiveSnapshot(force = false) {
  const now = Date.now();
  if (!force && _liveSnapshotCache && now - _liveSnapshotCache.cachedAt < LIVE_CACHE_TTL_MS) {
    return _liveSnapshotCache.snapshot;
  }
  const snapshot = await fetchLiveMacroSnapshot();
  _liveSnapshotCache = { snapshot, cachedAt: now };
  return snapshot;
}

/**
 * GET /macro/live
 * Returns the latest live macro snapshot (VIX, DXY, CVD, funding, etc.)
 * Cached for 5 minutes; serves stale on fetch failure.
 */
/**
 * GET /macro/sentiment — Returns current macro sentiment snapshot
 */
router.get("/sentiment", async (_req: Request, res: Response) => {
  try {
    const snapshot = await getOrRefreshLiveSnapshot();
    res.json({
      sentiment: {
        vix: snapshot?.vix ?? 18.5,
        dxy: snapshot?.dxy ?? 104.2,
        bias: "neutral",
        confidence: 0.6,
        source: "macro-live",
      },
    });
  } catch (error) {
    logger.error(`[macro] GET /sentiment error: ${String(error)}`);
    res.status(500).json({ error: "Failed to get sentiment" });
  }
});

router.get("/live", async (_req: Request, res: Response) => {
  try {
    const snapshot = await getOrRefreshLiveSnapshot();
    res.json({ context: snapshot });
  } catch (error) {
    logger.error(`[macro] /live error: ${String(error)}`);
    // Return stale cache if available
    if (_liveSnapshotCache) {
      logger.warn("[macro] /live serving stale cached snapshot due to fetch error");
      res.json({ context: _liveSnapshotCache.snapshot, stale: true });
    } else {
      res.status(503).json({ error: "Live macro snapshot unavailable — no cached data" });
    }  }
});

/**
 * POST /macro/live/refresh
 * Force-refreshes the live macro snapshot (bypasses cache TTL).
 */
router.post("/live/refresh", async (_req: Request, res: Response) => {
  try {
    const snapshot = await getOrRefreshLiveSnapshot(true);
    logger.info("[macro] Live macro snapshot force-refreshed");
    res.json({ context: snapshot });
  } catch (error) {
    logger.error(`[macro] /live/refresh error: ${String(error)}`);
    res.status(503).json({ error: "Failed to refresh live macro snapshot" });
  }
});

/**
 * GET /macro/fred
 * Returns the full FRED macro snapshot (CPI, Fed Funds, unemployment, treasuries, GDP, etc.)
 * Cached for 6 hours since data updates daily/monthly.
 */
router.get("/fred", async (_req: Request, res: Response) => {
  try {
    const snapshot = await fetchFredMacroSnapshot();
    res.json({ fred: snapshot });
  } catch (error) {
    logger.error(`[macro] /fred error: ${String(error)}`);
    res.status(503).json({ error: "Failed to fetch FRED macro data" });  }
});

/**
 * POST /macro/fred/refresh
 * Force-refresh FRED data by clearing cache first.
 */
router.post("/fred/refresh", async (_req: Request, res: Response) => {
  try {
    clearFredCache();
    const snapshot = await fetchFredMacroSnapshot();
    logger.info("[macro] FRED snapshot force-refreshed");
    res.json({ fred: snapshot });
  } catch (error) {
    logger.error(`[macro] /fred/refresh error: ${String(error)}`);
    res.status(503).json({ error: "Failed to refresh FRED data" });
  }
});

export default router;