/**
 * context_fusion.ts — Context Fusion Intelligence API
 *
 * GET  /api/context/fusion/:symbol      — evaluate context fusion for a symbol
 * GET  /api/context/fusion/snapshot     — engine telemetry snapshot
 * POST /api/context/fusion/reset        — reset state/cache
 * GET  /api/context/fusion/evaluate     — evaluate with query params
 */

import { Router, type Request, type Response } from "express";
import {
  evaluateContextFusion,
  getContextFusionSnapshot,
  resetContextFusionState,
  type ContextFusionInput,
} from "../lib/context_fusion_engine.js";

const router = Router();

// GET /api/context/fusion/snapshot
router.get("/api/context/fusion/snapshot", async (_req: Request, res: Response) => {
  try {
    const snapshot = getContextFusionSnapshot();
    res.json({ ok: true, snapshot });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// POST /api/context/fusion/reset
router.post("/api/context/fusion/reset", async (_req: Request, res: Response) => {
  try {
    resetContextFusionState();
    res.json({ ok: true, message: "Context fusion state reset" });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/context/fusion/evaluate?symbol=AAPL&direction=long&regime=TRENDING
router.get("/api/context/fusion/evaluate", async (req: Request, res: Response) => {
  try {
    const symbol = String(req.query.symbol ?? "").trim().toUpperCase();
    const direction = String(req.query.direction ?? "long").trim().toLowerCase() as "long" | "short";
    const regime = req.query.regime ? String(req.query.regime).trim().toUpperCase() : undefined;
    const assetClass = req.query.asset_class
      ? (String(req.query.asset_class).trim().toLowerCase() as "crypto" | "forex" | "equity" | "commodity")
      : undefined;

    if (!symbol) {
      res.status(400).json({ ok: false, error: "symbol is required" });
      return;
    }

    const input: ContextFusionInput = { symbol, direction, regime, assetClass };
    const result = await evaluateContextFusion(input);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// GET /api/context/fusion/:symbol — quick evaluation with defaults
router.get("/api/context/fusion/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = (Array.isArray(req.params.symbol) ? req.params.symbol[0] : req.params.symbol ?? '').trim().toUpperCase() ?? "";
    const direction = String(req.query.direction ?? "long").trim().toLowerCase() as "long" | "short";
    const regime = req.query.regime ? String(req.query.regime).trim().toUpperCase() : undefined;

    if (!symbol) {
      res.status(400).json({ ok: false, error: "symbol is required" });
      return;
    }

    const result = await evaluateContextFusion({ symbol, direction, regime });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
