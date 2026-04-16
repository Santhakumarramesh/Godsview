/**
 * tv_sync.ts — TradingView Bidirectional Sync Routes
 *
 * Endpoints for Chrome extension to poll annotations and push confirmations.
 * GET /api/tv-sync/:symbol/annotations — fetch pending annotations
 * POST /api/tv-sync/:symbol/annotations/ack — acknowledge annotation delivery
 * GET /api/tv-sync/stats — annotation statistics
 */

import { Router, type Request, type Response } from "express";
import {
  getAnnotations,
  getAllAnnotations,
  acknowledgeAnnotation,
  clearAnnotations,
  buildSignalAnnotation,
  buildStructureAnnotation,
  getAnnotationStats,
} from "../lib/tradingview/tv_overlay_sync";
import { logger } from "../lib/logger";

const router = Router();

/**
 * GET /api/tv-sync/:symbol/annotations
 *
 * Chrome extension polls this to get pending annotations for a symbol.
 * Query params:
 *  - include_acknowledged: if true, include already-acked annotations (default false)
 *  - timeframe: filter by timeframe (optional)
 */
router.get("/api/tv-sync/:symbol/annotations", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase();
    const includeAcknowledged = req.query.include_acknowledged === "true";
    const timeframe = req.query.timeframe as string || undefined;

    const annotations = includeAcknowledged
      ? getAllAnnotations(symbol)
      : getAnnotations(symbol);

    let filtered = annotations;
    if (timeframe) {
      filtered = annotations.filter((a) => a.timeframe === timeframe);
    }

    res.json({
      ok: true,
      symbol,
      count: filtered.length,
      annotations: filtered,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch annotations");
    res
      .status(500)
      .json({
        ok: false,
        error: "fetch_failed",
        message: String(err),
      });
  }
});

/**
 * POST /api/tv-sync/:symbol/annotations/ack
 *
 * Chrome extension confirms delivery of annotations.
 * Body:
 *  - annotation_ids: string[] — list of annotation IDs to acknowledge
 */
router.post(
  "/api/tv-sync/:symbol/annotations/ack",
  async (req: Request, res: Response) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const { annotation_ids } = req.body as {
        annotation_ids?: string[];
      };

      if (!Array.isArray(annotation_ids)) {
        res
          .status(400)
          .json({
            ok: false,
            error: "invalid_body",
            message: "annotation_ids must be an array",
          });
        return;
      }

      const acked: string[] = [];
      const failed: string[] = [];

      for (const id of annotation_ids) {
        if (acknowledgeAnnotation(symbol, id)) {
          acked.push(id);
        } else {
          failed.push(id);
        }
      }

      res.json({
        ok: true,
        symbol,
        acknowledged: acked.length,
        failed: failed.length,
        failed_ids: failed,
      });
    } catch (err) {
      logger.error({ err }, "Failed to acknowledge annotations");
      res
        .status(500)
        .json({
          ok: false,
          error: "ack_failed",
          message: String(err),
        });
    }
  },
);

/**
 * POST /api/tv-sync/:symbol/annotations/clear
 *
 * Clear all annotations for a symbol.
 */
router.post("/api/tv-sync/:symbol/annotations/clear", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.params.symbol).toUpperCase();
    clearAnnotations(symbol);

    res.json({
      ok: true,
      symbol,
      message: "Annotations cleared",
    });
  } catch (err) {
    logger.error({ err }, "Failed to clear annotations");
    res
      .status(500)
      .json({
        ok: false,
        error: "clear_failed",
        message: String(err),
      });
  }
});

/**
 * POST /api/tv-sync/:symbol/annotations/signal
 *
 * Push a signal annotation directly (convenience endpoint).
 * Body:
 *  - timeframe: string
 *  - entry_price: number
 *  - stop_loss: number
 *  - take_profit: number
 *  - direction: "long" | "short"
 *  - confidence: number
 *  - setup_type?: string
 *  - reasoning?: string
 */
router.post(
  "/api/tv-sync/:symbol/annotations/signal",
  async (req: Request, res: Response) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const {
        timeframe,
        entry_price,
        stop_loss,
        take_profit,
        direction,
        confidence,
        setup_type,
        reasoning,
      } = req.body as {
        timeframe?: string;
        entry_price?: number;
        stop_loss?: number;
        take_profit?: number;
        direction?: "long" | "short";
        confidence?: number;
        setup_type?: string;
        reasoning?: string;
      };

      if (
        !timeframe ||
        !entry_price ||
        !stop_loss ||
        !take_profit ||
        !direction ||
        confidence === undefined
      ) {
        res
          .status(400)
          .json({
            ok: false,
            error: "invalid_body",
            message: "Missing required fields",
          });
        return;
      }

      const annotation = buildSignalAnnotation(
        symbol,
        timeframe,
        {
          entry_price,
          stop_loss,
          take_profit,
          direction,
          confidence,
          setup_type,
        },
        reasoning,
      );

      // This should be integrated with the webhook dedup to get signal_id
      // For now, we just store it
      const store = require("../lib/tradingview/tv_overlay_sync").default;
      const pushed = store.pushAnnotation(symbol, annotation);

      res.json({
        ok: true,
        symbol,
        annotation_id: pushed.id,
        message: "Signal annotation created",
      });
    } catch (err) {
      logger.error({ err }, "Failed to push signal annotation");
      res
        .status(500)
        .json({
          ok: false,
          error: "push_failed",
          message: String(err),
        });
    }
  },
);

/**
 * POST /api/tv-sync/:symbol/annotations/structures
 *
 * Push structure markings (BOS, CHOCH, OB, FVG, etc).
 * Body:
 *  - timeframe: string
 *  - structures: { type, price_high, price_low, color?, label? }[]
 */
router.post(
  "/api/tv-sync/:symbol/annotations/structures",
  async (req: Request, res: Response) => {
    try {
      const symbol = String(req.params.symbol).toUpperCase();
      const { timeframe, structures } = req.body as {
        timeframe?: string;
        structures?: Array<{
          type: string;
          price_high: number;
          price_low: number;
          color?: string;
          label?: string;
        }>;
      };

      if (!timeframe || !structures || !Array.isArray(structures)) {
        res
          .status(400)
          .json({
            ok: false,
            error: "invalid_body",
            message: "Missing timeframe or structures",
          });
        return;
      }

      const annotation = buildStructureAnnotation(
        symbol,
        timeframe,
        structures as any,
      );

      const store = require("../lib/tradingview/tv_overlay_sync").default;
      const pushed = store.pushAnnotation(symbol, annotation);

      res.json({
        ok: true,
        symbol,
        annotation_id: pushed.id,
        message: "Structure annotation created",
      });
    } catch (err) {
      logger.error({ err }, "Failed to push structure annotation");
      res
        .status(500)
        .json({
          ok: false,
          error: "push_failed",
          message: String(err),
        });
    }
  },
);

/**
 * GET /api/tv-sync/stats
 *
 * Returns annotation statistics across all symbols.
 */
router.get("/api/tv-sync/stats", async (req: Request, res: Response) => {
  try {
    const stats = getAnnotationStats();
    res.json({
      ok: true,
      stats,
    });
  } catch (err) {
    logger.error({ err }, "Failed to fetch annotation stats");
    res
      .status(500)
      .json({
        ok: false,
        error: "stats_failed",
        message: String(err),
      });
  }
});

export default router;
