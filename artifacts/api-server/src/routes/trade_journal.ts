import { Router, Request, Response } from "express";
import {
  recordEntry,
  recordExit,
  getJournal,
  replayTrade,
  getJournalAnalytics,
  getTradeJournalSnapshot,
  resetTradeJournal,
} from "../lib/trade_journal.js";

// In-memory journal entries storage
interface JournalEntry {
  id: string;
  symbol: string;
  direction: "long" | "short";
  entryPrice: number;
  entryTime: number;
  quantity: number;
  exitPrice?: number;
  exitTime?: number;
  pnl?: number;
  pnlPct?: number;
  status: "open" | "closed";
  tags?: string[];
}

const journalEntries: JournalEntry[] = [];

const router = Router();

router.get("/snapshot", (_req: Request, res: Response) => {
  res.json(getTradeJournalSnapshot());
});

router.get("/entries", (req: Request, res: Response) => {
  const symbol = req.query.symbol ? String(req.query.symbol) : undefined;
  const strategyId = req.query.strategyId ? String(req.query.strategyId) : undefined;
  const status = req.query.status as "open" | "closed" | undefined;
  const tag = req.query.tag ? String(req.query.tag) : undefined;
  res.json(getJournal({ symbol, strategyId, status, tag }));
});

router.post("/entry", (req: Request, res: Response) => {
  try {
    const entry = recordEntry(req.body);
    res.json(entry);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/exit", (req: Request, res: Response) => {
  try {
    const entry = recordExit(req.body);
    res.json(entry);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.post("/replay", (req: Request, res: Response) => {
  try {
    const { tradeId } = req.body;
    const result = replayTrade(tradeId);
    res.json(result);
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

router.get("/analytics", (_req: Request, res: Response) => {
  res.json(getJournalAnalytics());
});

router.post("/reset", (_req: Request, res: Response) => {
  resetTradeJournal();
  journalEntries.length = 0;
  res.json({ status: "trade_journal_reset" });
});

// POST /add-entry - Add a journal entry to in-memory storage
router.post("/add-entry", (req: Request, res: Response) => {
  try {
    const { symbol, direction, entryPrice, quantity, tags } = req.body;

    if (!symbol || !direction || typeof entryPrice !== "number" || typeof quantity !== "number") {
      res.status(400).json({ error: "Missing required fields" });
      return;
    }

    const entry: JournalEntry = {
      id: `je_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      symbol,
      direction,
      entryPrice,
      entryTime: Date.now(),
      quantity,
      status: "open",
      tags,
    };

    journalEntries.push(entry);
    res.status(201).json({
      success: true,
      entry,
    });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// POST /close-entry - Close a journal entry
router.post("/close-entry", (req: Request, res: Response) => {
  try {
    const { entryId, exitPrice } = req.body;

    if (!entryId || typeof exitPrice !== "number") {
      res.status(400).json({ error: "Missing entryId or exitPrice" });
      return;
    }

    const entry = journalEntries.find(e => e.id === entryId);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }

    entry.exitPrice = exitPrice;
    entry.exitTime = Date.now();
    entry.status = "closed";
    
    const cost = entry.quantity * entry.entryPrice;
    const proceeds = entry.quantity * exitPrice;
    entry.pnl = entry.direction === "long" ? proceeds - cost : cost - proceeds;
    entry.pnlPct = (entry.pnl / cost) * 100;

    res.json({
      success: true,
      entry,
    });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

// GET /all-entries - Get all journal entries
router.get("/all-entries", (_req: Request, res: Response) => {
  try {
    const open = journalEntries.filter(e => e.status === "open");
    const closed = journalEntries.filter(e => e.status === "closed");
    
    const totalPnl = closed.reduce((sum, e) => sum + (e.pnl || 0), 0);
    const winningTrades = closed.filter(e => (e.pnl || 0) > 0).length;
    const losingTrades = closed.filter(e => (e.pnl || 0) < 0).length;
    
    res.json({
      success: true,
      total_entries: journalEntries.length,
      open_count: open.length,
      closed_count: closed.length,
      total_pnl: totalPnl,
      win_rate: closed.length > 0 ? (winningTrades / closed.length) * 100 : 0,
      winning_trades: winningTrades,
      losing_trades: losingTrades,
      entries: journalEntries,
    });
  } catch (e: any) {
    res.status(503).json({ error: e.message });
  }
});

export default router;
