/**
 * routes/watchlist.ts — Watchlist CRUD + Scanner Control REST API
 *
 * Endpoints:
 *   GET    /api/watchlist               — list all watchlist entries
 *   POST   /api/watchlist               — add / update a symbol
 *   DELETE /api/watchlist/:symbol       — remove a symbol
 *   PATCH  /api/watchlist/:symbol/enable  — enable scanning
 *   PATCH  /api/watchlist/:symbol/disable — disable scanning
 *
 *   GET    /api/watchlist/scanner/status  — scanner health + current run
 *   POST   /api/watchlist/scanner/start   — start the scanner (idempotent)
 *   POST   /api/watchlist/scanner/stop    — stop the scanner
 *   POST   /api/watchlist/scanner/scan    — force an immediate out-of-cycle scan
 *   DELETE /api/watchlist/scanner/cooldowns        — reset all cooldowns
 *   DELETE /api/watchlist/scanner/cooldowns/:symbol — reset cooldowns for one symbol
 *   GET    /api/watchlist/scanner/history — last N scan runs
 */

import { Router } from "express";
import {
  listWatchlist,
  addSymbol,
  removeSymbol,
  setEnabled,
  getEntry,
  type AddWatchlistParams,
} from "../lib/watchlist";
import { ScannerScheduler } from "../lib/scanner_scheduler";

const router = Router();
const scheduler = () => ScannerScheduler.getInstance();

// ─── Watchlist CRUD ───────────────────────────────────────────────────────────

/** GET /api/watchlist */
router.get("/watchlist", (_req, res) => {
  res.json({ watchlist: listWatchlist(), count: listWatchlist().length });
});

/** POST /api/watchlist — body: { symbol, label?, assetClass?, enabled?, note? } */
router.post("/watchlist", (req, res) => {
  const { symbol, label, assetClass, enabled, note } = req.body ?? {};
  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "missing_symbol", message: "symbol is required" });
    return;
  }
  if (!assetClass || !["crypto", "forex", "equity", "commodity"].includes(assetClass)) {
    res.status(400).json({ error: "invalid_asset_class", message: "assetClass must be crypto|forex|equity|commodity" });
    return;
  }
  const params: AddWatchlistParams = {
    symbol:     String(symbol).toUpperCase(),
    label:      label   ? String(label)   : String(symbol).toUpperCase(),
    assetClass: assetClass as AddWatchlistParams["assetClass"],
    enabled:    enabled !== false,
    note:       note    ? String(note)    : undefined,
  };
  const entry = addSymbol(params);
  res.status(201).json({ entry });
});

/** DELETE /api/watchlist/:symbol */
router.delete("/watchlist/:symbol", (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase();
  const removed = removeSymbol(symbol);
  if (!removed) {
    res.status(404).json({ error: "not_found", message: `${symbol} is not in the watchlist` });
    return;
  }
  res.json({ removed: true, symbol });
});

/** PATCH /api/watchlist/:symbol/enable */
router.patch("/watchlist/:symbol/enable", (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase();
  const entry = setEnabled(symbol, true);
  if (!entry) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ entry });
});

/** PATCH /api/watchlist/:symbol/disable */
router.patch("/watchlist/:symbol/disable", (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase();
  const entry = setEnabled(symbol, false);
  if (!entry) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ entry });
});

/** GET /api/watchlist/:symbol */
router.get("/watchlist/:symbol", (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase();
  const entry = getEntry(symbol);
  if (!entry) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ entry });
});

// ─── Scanner Control ──────────────────────────────────────────────────────────

/** GET /api/watchlist/scanner/status */
router.get("/watchlist/scanner/status", (_req, res) => {
  const s = scheduler();
  res.json({
    running:     s.isRunning(),
    scanCount:   s.getScanCount(),
    intervalMs:  s.getIntervalMs(),
    cooldownMs:  s.getCooldownMs(),
    currentRun:  s.getCurrentRun(),
    watchlistSize: listWatchlist().length,
  });
});

/** POST /api/watchlist/scanner/start */
router.post("/watchlist/scanner/start", (_req, res) => {
  scheduler().start();
  res.json({ started: true, running: scheduler().isRunning() });
});

/** POST /api/watchlist/scanner/stop */
router.post("/watchlist/scanner/stop", (_req, res) => {
  scheduler().stop();
  res.json({ stopped: true, running: false });
});

/** POST /api/watchlist/scanner/scan — force immediate scan */
router.post("/watchlist/scanner/scan", async (_req, res) => {
  try {
    const run = await scheduler().forceScan();
    res.json({ run });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "scan failed";
    res.status(500).json({ error: "scan_failed", message: msg });
  }
});

/** GET /api/watchlist/scanner/history */
router.get("/watchlist/scanner/history", (req, res) => {
  const limit = Math.min(parseInt(String(req.query.limit ?? "20"), 10), HISTORY_MAX);
  const history = scheduler().getHistory().slice(0, limit);
  res.json({ history, count: history.length });
});

const HISTORY_MAX = 100;

/** DELETE /api/watchlist/scanner/cooldowns */
router.delete("/watchlist/scanner/cooldowns", (_req, res) => {
  scheduler().resetCooldowns();
  res.json({ reset: true, scope: "all" });
});

/** DELETE /api/watchlist/scanner/cooldowns/:symbol */
router.delete("/watchlist/scanner/cooldowns/:symbol", (req, res) => {
  const symbol = String(req.params.symbol ?? "").toUpperCase();
  scheduler().resetCooldowns(symbol);
  res.json({ reset: true, scope: symbol });
});

// ─── Auto-Trade Endpoints ─────────────────────────────────────────────────────

import {
  getAutoTradeConfig,
  updateAutoTradeConfig,
  getAutoTradeStatus,
  getAutoTradeLog,
  resetAutoTradeSession,
} from "../lib/auto_trade_config";

/** GET /api/watchlist/auto-trade/status */
router.get("/watchlist/auto-trade/status", (_req, res) => {
  res.json(getAutoTradeStatus());
});

/** GET /api/watchlist/auto-trade/config */
router.get("/watchlist/auto-trade/config", (_req, res) => {
  res.json(getAutoTradeConfig());
});

/** PATCH /api/watchlist/auto-trade/config */
router.patch("/watchlist/auto-trade/config", (req, res) => {
  const patch = req.body ?? {};
  const updated = updateAutoTradeConfig(patch);
  res.json({ ok: true, config: updated });
});

/** POST /api/watchlist/auto-trade/enable */
router.post("/watchlist/auto-trade/enable", (_req, res) => {
  const config = updateAutoTradeConfig({ enabled: true });
  res.json({ ok: true, enabled: config.enabled });
});

/** POST /api/watchlist/auto-trade/disable */
router.post("/watchlist/auto-trade/disable", (_req, res) => {
  const config = updateAutoTradeConfig({ enabled: false });
  res.json({ ok: true, enabled: config.enabled });
});

/** GET /api/watchlist/auto-trade/log */
router.get("/watchlist/auto-trade/log", (req, res) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const log   = getAutoTradeLog().slice(0, limit);
  res.json({ log, count: log.length });
});

/** POST /api/watchlist/auto-trade/reset-session */
router.post("/watchlist/auto-trade/reset-session", (_req, res) => {
  resetAutoTradeSession();
  res.json({ ok: true });
});

export default router;
