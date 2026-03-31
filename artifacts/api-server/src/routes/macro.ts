/**
 * macro.ts — Macro/News Intelligence Routes
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

export default router;
