/**
 * macro.ts — Macro/News Intelligence Routes
 *
 * Legacy news lockout endpoints: /macro/context, /macro/events, /macro/lockout/:symbol
 * Phase 16 YoungTraderWealth endpoints:
 *   POST /macro/bias            — compute macro directional bias (Layer 0)
 *   GET  /macro/bias/neutral    — neutral bias placeholder
 *   POST /macro/sentiment       — compute retail sentiment + institutional edge (Layer 0.5)
 *   GET  /macro/sentiment/neutral — neutral sentiment placeholder
 * Phase 17 Live Feed endpoints:
 *   GET  /macro/live            — current cached MacroContext (bias + sentiment + snapshot)
 *   POST /macro/live/refresh    — force an immediate re-fetch from Alpaca
 *   GET  /macro/live/status     — service status (started, last refresh, quality)
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
} from "../lib/macro_engine";
import { computeMacroBias, neutralMacroBias, type MacroBiasInput } from "../lib/macro_bias_engine";
import { computeSentiment, neutralSentiment, type SentimentInput } from "../lib/sentiment_engine";
import {
  MacroContextService,
  getCurrentMacroContext,
  refreshMacroContext,
} from "../lib/macro_context_service";

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
 * Ingest a single macro event
 */
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
    res.json(result);
  } catch (error) {
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
  } catch (error) {
    logger.error(`Error fetching macro stats: ${String(error)}`);
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

// ─── Phase 16: YoungTraderWealth Institutional Intelligence endpoints ──────────

/**
 * POST /macro/bias
 * Compute macro directional bias for a trade (Layer 0 gate).
 * Body: MacroBiasInput
 */
router.post("/bias", (req: Request, res: Response) => {
  try {
    const input = req.body as MacroBiasInput;
    if (
      typeof input.dxySlope !== "number" ||
      typeof input.rateDifferentialBps !== "number" ||
      typeof input.cpiMomentum !== "number" ||
      typeof input.vixLevel !== "number" ||
      typeof input.macroRiskScore !== "number" ||
      !input.assetClass ||
      !input.intendedDirection
    ) {
      res.status(400).json({ error: "Invalid MacroBiasInput — all fields required" });
      return;
    }
    const result = computeMacroBias(input);
    res.json({ bias: result });
  } catch (error) {
    logger.error(`[macro/bias] POST error: ${String(error)}`);
    res.status(500).json({ error: "Failed to compute macro bias" });
  }
});

/**
 * GET /macro/bias/neutral
 * Returns a neutral macro bias result (for replay mode or missing data).
 */
router.get("/bias/neutral", (_req: Request, res: Response) => {
  res.json({ bias: neutralMacroBias() });
});

/**
 * POST /macro/sentiment
 * Compute retail sentiment & institutional edge (Layer 0.5 gate).
 * Body: SentimentInput
 */
router.post("/sentiment", (req: Request, res: Response) => {
  try {
    const input = req.body as SentimentInput;
    if (
      typeof input.retailLongRatio !== "number" ||
      typeof input.priceTrendSlope !== "number" ||
      typeof input.cvdNet !== "number" ||
      typeof input.openInterestChange !== "number" ||
      typeof input.fundingRate !== "number" ||
      !input.intendedDirection ||
      !input.assetClass
    ) {
      res.status(400).json({ error: "Invalid SentimentInput — all fields required" });
      return;
    }
    const result = computeSentiment(input);
    res.json({ sentiment: result });
  } catch (error) {
    logger.error(`[macro/sentiment] POST error: ${String(error)}`);
    res.status(500).json({ error: "Failed to compute sentiment" });
  }
});

/**
 * GET /macro/sentiment/neutral
 * Returns a neutral sentiment result (for replay mode or missing data).
 */
router.get("/sentiment/neutral", (_req: Request, res: Response) => {
  res.json({ sentiment: neutralSentiment() });
});

// ─── Phase 17: Live Macro Intelligence Feed ───────────────────────────────────

/**
 * GET /macro/live
 * Returns the current cached MacroContext — bias + sentiment + raw snapshot inputs.
 * The service auto-refreshes every 5 minutes in the background.
 */
router.get("/live", (_req: Request, res: Response) => {
  try {
    const ctx = getCurrentMacroContext();
    res.json({ context: ctx });
  } catch (error) {
    logger.error(`[macro/live] GET error: ${String(error)}`);
    res.status(500).json({ error: "Failed to get live macro context" });
  }
});

/**
 * POST /macro/live/refresh
 * Forces an immediate re-fetch from Alpaca and recomputes bias + sentiment.
 * Optionally accepts { intendedDirection, assetClass } body params.
 */
router.post("/live/refresh", async (req: Request, res: Response): Promise<void> => {
  try {
    const direction  = (req.body?.intendedDirection as "long" | "short" | undefined) ?? "long";
    const assetClass = (req.body?.assetClass as MacroBiasInput["assetClass"] | undefined) ?? "crypto";

    const ctx = await refreshMacroContext(direction, assetClass);
    res.json({ context: ctx, refreshed: true });
  } catch (error) {
    logger.error(`[macro/live/refresh] POST error: ${String(error)}`);
    res.status(500).json({ error: "Failed to refresh macro context" });
  }
});

/**
 * GET /macro/live/status
 * Returns service health — started state, refresh count, data quality.
 */
router.get("/live/status", (_req: Request, res: Response) => {
  try {
    const svc = MacroContextService.getInstance();
    const ctx = svc.getContext();
    res.json({
      started:         svc.isStarted(),
      refreshCount:    ctx.refreshCount,
      lastRefreshedAt: ctx.lastRefreshedAt,
      nextRefreshAt:   ctx.nextRefreshAt,
      dataQuality:     ctx.snapshot.dataQuality,
      isLive:          ctx.isLive,
      sources:         ctx.snapshot.sources,
    });
  } catch (error) {
    logger.error(`[macro/live/status] GET error: ${String(error)}`);
    res.status(500).json({ error: "Failed to get macro service status" });
  }
});

export default router;
