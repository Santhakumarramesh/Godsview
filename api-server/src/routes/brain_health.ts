/**
 * routes/brain_health.ts — Phase 12D
 *
 * Brain pipeline health + telemetry endpoints.
 *
 * GET /brain/health/telemetry  — full pipeline telemetry snapshot
 * GET /brain/health/layer/:name — single layer telemetry
 * POST /brain/health/reset     — reset all telemetry counters
 * GET /brain/health/account-stream — Alpaca account stream status
 * GET /brain/health/mtf/:symbol — MTF confluence for a symbol + direction
 */

import { Router } from "express";
import { telemetry } from "../lib/brain_health_telemetry.js";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /brain/health/telemetry ───────────────────────────────────────────
router.get("/brain/health/telemetry", (_req, res) => {
  res.json({ ok: true, telemetry: telemetry.snapshot() });
});

// ── GET /brain/health/layer/:name ─────────────────────────────────────────
router.get("/brain/health/layer/:name", (req, res) => {
  const { name } = req.params;
  const layer = telemetry.layerSnapshot(name);
  if (!layer) {
    return res.json({ ok: true, layer: null, message: `Layer ${name} has no data yet` });
  }
  return res.json({ ok: true, layer });
});

// ── POST /brain/health/reset ─────────────────────────────────────────────
router.post("/brain/health/reset", (_req, res) => {
  telemetry.reset();
  logger.info("Brain health telemetry reset via API");
  res.json({ ok: true, message: "Telemetry counters reset" });
});

// ── GET /brain/health/account-stream ─────────────────────────────────────
router.get("/brain/health/account-stream", async (_req, res) => {
  try {
    const { alpacaAccountStream } = await import("../lib/alpaca_account_stream.js");
    res.json({ ok: true, stream: alpacaAccountStream.status() });
  } catch {
    res.json({ ok: false, stream: null, error: "Account stream not loaded" });
  }
});

// ── GET /brain/health/mtf/:symbol ─────────────────────────────────────────
// Query param: ?direction=long|short (default: long)
router.get("/brain/health/mtf/:symbol", async (req, res) => {
  const { symbol } = req.params;
  const direction = (req.query.direction === "short" ? "short" : "long") as "long" | "short";
  try {
    const { computeMTFConfluence } = await import("../lib/brain_mtf_confluence.js");
    const confluence = await computeMTFConfluence(symbol, direction);
    res.json({ ok: true, confluence });
  } catch (err) {
    logger.error({ err, symbol }, "MTF confluence check failed");
    res.status(500).json({ ok: false, error: "MTF check failed" });
  }
});

// ── GET /brain/health/regime-sizing ──────────────────────────────────────
// Returns the full regime → Kelly multiplier table
router.get("/brain/health/regime-sizing", (_req, res) => {
  try {
    import("../lib/regime_sizing_adapter.js").then(({ getRegimeMultiplierTable }) => {
      res.json({ ok: true, table: getRegimeMultiplierTable() });
    }).catch(err => {
      res.status(500).json({ ok: false, error: String(err) });
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
