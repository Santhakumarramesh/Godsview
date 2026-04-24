/**
 * s3_storage.ts — S3 Cloud Storage Routes
 *
 * Mounts at /api/storage (see routes/index.ts).
 *
 * Endpoints:
 *   GET    /health          — S3 connectivity check
 *   POST   /put             — upload an object { key, data, contentType? }
 *   POST   /get             — download an object { key }
 *   POST   /trade-journal   — save trade journal entry
 *   POST   /backtest        — save backtest result
 *   POST   /brain-snapshot  — save brain state snapshot
 *   POST   /macro-archive   — save macro data archive
 */

import { Router, Request, Response } from "express";
import { logger } from "../lib/logger";
import {
  s3Put,
  s3Get,
  s3HealthCheck,
  saveTradeJournal,
  saveBacktestResult,
  saveBrainSnapshot,
  saveMacroArchive,
} from "../lib/providers/s3_storage.js";

const router = Router();
/**
 * GET /storage/health
 * Check S3 configuration and connectivity.
 */
router.get("/health", async (_req: Request, res: Response) => {
  try {
    const result = await s3HealthCheck();
    res.json({ provider: "S3 (Massive.com)", ...result });
  } catch (error) {
    logger.error(`[s3] /health error: ${String(error)}`);
    res.status(503).json({ error: "S3 health check failed" });
  }
});

/**
 * POST /storage/put
 * Upload an object. Body: { key: string, data: object|string, contentType?: string }
 */
router.post("/put", async (req: Request, res: Response) => {
  try {
    const { key, data, contentType } = req.body;
    if (!key || data === undefined) {
      res.status(400).json({ error: "key and data are required" });
      return;
    }
    const result = await s3Put(key, data, contentType);
    res.json(result);
  } catch (error) {
    logger.error(`[s3] /put error: ${String(error)}`);
    res.status(503).json({ error: "S3 PUT failed" });
  }
});
/**
 * POST /storage/get
 * Download an object. Body: { key: string }
 */
router.post("/get", async (req: Request, res: Response) => {
  try {
    const { key } = req.body;
    if (!key) {
      res.status(400).json({ error: "key is required" });
      return;
    }
    const result = await s3Get(key);
    res.json(result);
  } catch (error) {
    logger.error(`[s3] /get error: ${String(error)}`);
    res.status(503).json({ error: "S3 GET failed" });
  }
});

/**
 * POST /storage/trade-journal
 * Save a trade journal entry. Body: { tradeId: string, data: object }
 */
router.post("/trade-journal", async (req: Request, res: Response) => {
  try {
    const { tradeId, data } = req.body;
    if (!tradeId || !data) {
      res.status(400).json({ error: "tradeId and data are required" });
      return;
    }
    const result = await saveTradeJournal(tradeId, data);
    res.json(result);
  } catch (error) {
    logger.error(`[s3] /trade-journal error: ${String(error)}`);
    res.status(503).json({ error: "Failed to save trade journal" });
  }
});
/**
 * POST /storage/backtest
 * Save a backtest result. Body: { strategyId: string, runId: string, data: object }
 */
router.post("/backtest", async (req: Request, res: Response) => {
  try {
    const { strategyId, runId, data } = req.body;
    if (!strategyId || !runId || !data) {
      res.status(400).json({ error: "strategyId, runId, and data are required" });
      return;
    }
    const result = await saveBacktestResult(strategyId, runId, data);
    res.json(result);
  } catch (error) {
    logger.error(`[s3] /backtest error: ${String(error)}`);
    res.status(503).json({ error: "Failed to save backtest result" });
  }
});

/**
 * POST /storage/brain-snapshot
 * Save a brain state snapshot. Body: { data: object }
 */
router.post("/brain-snapshot", async (req: Request, res: Response) => {
  try {
    const { data } = req.body;
    if (!data) {
      res.status(400).json({ error: "data is required" });
      return;
    }
    const result = await saveBrainSnapshot(data);
    res.json(result);
  } catch (error) {
    logger.error(`[s3] /brain-snapshot error: ${String(error)}`);
    res.status(503).json({ error: "Failed to save brain snapshot" });
  }
});
/**
 * POST /storage/macro-archive
 * Save macro data archive. Body: { data: object }
 */
router.post("/macro-archive", async (req: Request, res: Response) => {
  try {
    const { data } = req.body;
    if (!data) {
      res.status(400).json({ error: "data is required" });
      return;
    }
    const result = await saveMacroArchive(data);
    res.json(result);
  } catch (error) {
    logger.error(`[s3] /macro-archive error: ${String(error)}`);
    res.status(503).json({ error: "Failed to save macro archive" });
  }
});

export default router;
