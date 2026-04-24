/**
 * journal.ts — Trade Journal API Routes
 *
 * GET  /journal            — list journal entries (paginated, filterable)
 * GET  /journal/stats      — summary stats (total, win rate, avg PnL)
 * GET  /journal/:id        — single entry
 * POST /journal/outcome/:id — update entry with trade outcome
 * DELETE /journal          — clear all entries (dev/reset)
 * GET  /journal/attribution — full attribution report
 * GET  /journal/attribution/ytw — YoungTraderWealth gate summary
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import {
  listJournalEntries,
  getJournalEntry,
  recordOutcome,
  getJournalStats,
  clearJournal,
  type JournalDecision,
  type JournalOutcome,
  type JournalOutcomeUpdate,
} from "../lib/trade_journal";
import {
  generateAttributionReport,
  getYtwGateSummary,
} from "../lib/attribution_engine";

const router = Router();

// ─── GET /journal — list entries ───────────────────────────────────────────────

router.get("/", (req: Request, res: Response) => {
  try {
    const symbol   = req.query.symbol   ? String(req.query.symbol).toUpperCase()  : undefined;
    const decision = req.query.decision ? String(req.query.decision) : undefined;
    const outcome  = req.query.outcome  ? String(req.query.outcome)  : undefined;
    const from     = req.query.from     ? String(req.query.from) : undefined;
    const to       = req.query.to       ? String(req.query.to)   : undefined;
    const limit    = req.query.limit    ? parseInt(String(req.query.limit),  10) : 50;
    const offset   = req.query.offset   ? parseInt(String(req.query.offset), 10) : 0;

    const entries = listJournalEntries({ symbol, decision, outcome, from, to, limit, offset });
    res.json({ entries, count: entries.length });
  } catch (err) {
    logger.error(`[journal] GET / error: ${String(err)}`);
    res.status(500).json({ error: "Failed to list journal entries" });
  }
});

// ─── GET /journal/stats ────────────────────────────────────────────────────────

router.get("/stats", (_req: Request, res: Response) => {
  try {
    res.json({ stats: getJournalStats() });
  } catch (err) {
    logger.error(`[journal] GET /stats error: ${String(err)}`);
    res.status(500).json({ error: "Failed to get journal stats" });
  }
});

// ─── GET /journal/attribution ──────────────────────────────────────────────────

router.get("/attribution", (req: Request, res: Response) => {
  try {
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
    const from   = req.query.from   ? String(req.query.from) : undefined;
    const to     = req.query.to     ? String(req.query.to)   : undefined;
    const report = generateAttributionReport({ symbol, from, to });
    res.json({ report });
  } catch (err) {
    logger.error(`[journal] GET /attribution error: ${String(err)}`);
    res.status(500).json({ error: "Failed to generate attribution report" });
  }
});

// ─── GET /journal/attribution/ytw — YoungTraderWealth gate summary ────────────

router.get("/attribution/ytw", (_req: Request, res: Response) => {
  try {
    const summary = getYtwGateSummary();
    res.json({ summary });
  } catch (err) {
    logger.error(`[journal] GET /attribution/ytw error: ${String(err)}`);
    res.status(500).json({ error: "Failed to get YTW gate summary" });
  }
});

// ─── GET /journal/:id ─────────────────────────────────────────────────────────

router.get("/:id", (req: Request, res: Response) => {
  try {
    const entry = getJournalEntry(String(req.params.id));
    if (!entry) { res.status(404).json({ error: "Entry not found" }); return; }
    res.json({ entry });
  } catch (err) {
    logger.error(`[journal] GET /:id error: ${String(err)}`);
    res.status(500).json({ error: "Failed to get journal entry" });
  }
});

// ─── POST /journal/outcome/:id ────────────────────────────────────────────────

router.post("/outcome/:id", (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const update = req.body as JournalOutcomeUpdate;

    if (!update || typeof update !== "object") {
      res.status(400).json({ error: "Request body must be a JournalOutcomeUpdate object" });
      return;
    }

    const updated = recordOutcome(id, update);
    if (!updated) { res.status(404).json({ error: "Entry not found" }); return; }

    res.json({ entry: updated });
  } catch (err) {
    logger.error(`[journal] POST /outcome/:id error: ${String(err)}`);
    res.status(500).json({ error: "Failed to update journal outcome" });
  }
});

// ─── DELETE /journal — clear ──────────────────────────────────────────────────

router.delete("/", (req: Request, res: Response) => {
  try {
    // Safety: require explicit confirmation header in non-dev environments
    const env = process.env.NODE_ENV ?? "production";
    if (env === "production" && req.headers["x-confirm-clear"] !== "yes") {
      res.status(403).json({ error: "Set X-Confirm-Clear: yes header to clear in production" });
      return;
    }
    clearJournal();
    res.json({ cleared: true });
  } catch (err) {
    logger.error(`[journal] DELETE / error: ${String(err)}`);
    res.status(500).json({ error: "Failed to clear journal" });
  }
});

export default router;
