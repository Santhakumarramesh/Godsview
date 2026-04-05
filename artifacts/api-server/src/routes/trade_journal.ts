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
  res.json({ status: "trade_journal_reset" });
});

export default router;
