/**
 * finnhub_alt.ts — Finnhub Alternative Data Routes
 *
 * Mounts at /api/finnhub (see routes/index.ts).
 *
 * Endpoints:
 *   GET  /alt/:symbol     — full alt-data snapshot (news, analyst, insider, social)
 *   GET  /health          — Finnhub connectivity check
 *   POST /clear-cache     — clear alt-data cache
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  fetchAltDataSnapshot,
  clearAltDataCache,
} from "../lib/providers/finnhub_alt.js";

const router = Router();

/**
 * GET /finnhub/alt/:symbol
 * Returns full alternative data snapshot for a symbol.
 */
router.get("/alt/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol ?? "").toUpperCase();
    if (!symbol) {      res.status(400).json({ error: "Symbol is required" });
      return;
    }

    const snapshot = await fetchAltDataSnapshot(symbol);
    logger.info({ symbol, score: snapshot.compositeScore, confidence: snapshot.confidence },
      "[finnhub-alt] Alt data served");
    res.json(snapshot);
  } catch (error) {
    logger.error(`[finnhub-alt] /alt/:symbol error: ${String(error)}`);
    res.status(503).json({ error: "Failed to fetch alternative data" });
  }
});

/**
 * GET /finnhub/health
 * Check if Finnhub API key is configured.
 */
router.get("/health", (_req: Request, res: Response) => {
  const configured = !!(process.env.FINNHUB_API_KEY);
  res.json({
    provider: "Finnhub",
    configured,
    features: ["news", "analyst-recommendations", "insider-transactions", "social-sentiment"],
    cacheEntries: 0, // cache is module-private; health just checks config
  });
});

/**
 * POST /finnhub/clear-cache
 * Clear the alt-data cache.
 */
router.post("/clear-cache", (_req: Request, res: Response) => {
  clearAltDataCache();
  logger.info("[finnhub-alt] Cache cleared");
  res.json({ success: true, message: "Finnhub alt-data cache cleared" });
});

export default router;
