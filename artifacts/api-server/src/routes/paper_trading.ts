/**
 * Paper Trading Routes — REST API for paper trading engine (Phase 74)
 */

import { Router, type Request, type Response } from "express";
import {
  startPaperTrading,
  stopPaperTrading,
  pausePaperTrading,
  resumePaperTrading,
  getPaperTradingState,
  processPaperSignal,
  getPaperTradingReport,
  paperTradingHealthCheck,
  getPaperTradingConfig,
  setPaperTradingConfig,
  type PaperTradingConfig,
} from "../engines/paper_trading_engine";
import { logger } from "../lib/logger";
import type { SuperSignal } from "../lib/super_intelligence";

const router = Router();

// ── GET /api/paper-trading/state ────────────────────────────────────

router.get("/api/paper-trading/state", (req: Request, res: Response): void => {
  try {
    const state = getPaperTradingState();
    res.status(200).json(state);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to get state");
    res.status(500).json({ error: "Failed to get state" });
  }
});

// ── POST /api/paper-trading/start ───────────────────────────────────

router.post("/api/paper-trading/start", (req: Request, res: Response): void => {
  try {
    const config: Partial<PaperTradingConfig> = req.body.config || {};
    const result = startPaperTrading(config);
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to start");
    res.status(500).json({ error: "Failed to start paper trading" });
  }
});

// ── POST /api/paper-trading/stop ────────────────────────────────────

router.post("/api/paper-trading/stop", (req: Request, res: Response): void => {
  try {
    const result = stopPaperTrading();
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to stop");
    res.status(500).json({ error: "Failed to stop paper trading" });
  }
});

// ── POST /api/paper-trading/pause ───────────────────────────────────

router.post("/api/paper-trading/pause", (req: Request, res: Response): void => {
  try {
    const result = pausePaperTrading();
    res.status(result.success ? 200 : 400).json(result);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to pause");
    res.status(500).json({ error: "Failed to pause paper trading" });
  }
});

// ── POST /api/paper-trading/resume ──────────────────────────────────

router.post(
  "/api/paper-trading/resume",
  (req: Request, res: Response): void => {
    try {
      const result = resumePaperTrading();
      res.status(result.success ? 200 : 400).json(result);
    } catch (err) {
      logger.error({ err }, "[paper-trading-routes] Failed to resume");
      res.status(500).json({ error: "Failed to resume paper trading" });
    }
  }
);

// ── GET /api/paper-trading/report ───────────────────────────────────

router.get("/api/paper-trading/report", (req: Request, res: Response): void => {
  try {
    const daysStr = req.query.days;
    const days = daysStr
      ? Math.max(1, Math.min(120, parseInt(String(daysStr), 10)))
      : 30;
    const report = getPaperTradingReport(days);
    res.status(200).json(report);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to get report");
    res.status(500).json({ error: "Failed to get report" });
  }
});

// ── GET /api/paper-trading/health ───────────────────────────────────

router.get("/api/paper-trading/health", (req: Request, res: Response): void => {
  try {
    const health = paperTradingHealthCheck();
    res.status(200).json(health);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to get health");
    res.status(500).json({ error: "Failed to get health status" });
  }
});

// ── GET /api/paper-trading/config ───────────────────────────────────

router.get("/api/paper-trading/config", (req: Request, res: Response): void => {
  try {
    const config = getPaperTradingConfig();
    res.status(200).json(config);
  } catch (err) {
    logger.error({ err }, "[paper-trading-routes] Failed to get config");
    res.status(500).json({ error: "Failed to get config" });
  }
});

// ── POST /api/paper-trading/config ──────────────────────────────────

router.post(
  "/api/paper-trading/config",
  (req: Request, res: Response): void => {
    try {
      const config = req.body as Partial<PaperTradingConfig>;
      const updated = setPaperTradingConfig(config);
      res.status(200).json(updated);
    } catch (err) {
      logger.error({ err }, "[paper-trading-routes] Failed to set config");
      res.status(500).json({ error: "Failed to set config" });
    }
  }
);

// ── POST /api/paper-trading/signal ──────────────────────────────────

router.post(
  "/api/paper-trading/signal",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const signal = req.body as SuperSignal & {
        symbol: string;
        setup_type: string;
        regime: string;
        direction: "long" | "short";
        entry_price: number;
        stop_loss: number;
        take_profit: number;
      };

      if (!signal.symbol || !signal.entry_price) {
        res.status(400).json({
          error: "Missing required fields: symbol, entry_price",
        });
        return;
      }

      const result = await processPaperSignal(signal);
      res.status(result.approved ? 200 : 400).json(result);
    } catch (err) {
      logger.error({ err }, "[paper-trading-routes] Failed to process signal");
      res.status(500).json({ error: "Failed to process signal" });
    }
  }
);

export default router;
