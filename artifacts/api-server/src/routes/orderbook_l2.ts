/**
 * routes/orderbook_l2.ts — Phase 88 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  orderBookL2,
  imbalanceCalculator,
  spreadAnalyzer,
} from "../lib/orderbook_l2";

const router = Router();

router.post("/api/orderbook-l2/:symbol/update", (req: Request, res: Response) => {
  const { side, price, size, orderCount } = req.body ?? {};
  if (!side || price === undefined || size === undefined) {
    return res.status(400).json({ error: "Missing side, price, or size" });
  }
  orderBookL2.apply(
    String(req.params.symbol),
    side as "bid" | "ask",
    Number(price),
    Number(size),
    orderCount,
  );
  return res.json({ ok: true });
});

router.post("/api/orderbook-l2/:symbol/batch", (req: Request, res: Response) => {
  const { updates } = req.body ?? {};
  if (!Array.isArray(updates)) return res.status(400).json({ error: "Missing updates[]" });
  orderBookL2.applyBatch(String(req.params.symbol), updates);
  return res.json({ ok: true, applied: updates.length });
});

router.get("/api/orderbook-l2/:symbol/snapshot", (req: Request, res: Response) => {
  const depth = req.query.depth ? Number(req.query.depth) : 20;
  res.json(orderBookL2.snapshot(String(req.params.symbol), depth));
});

router.get("/api/orderbook-l2/symbols", (_req: Request, res: Response) => {
  res.json({ symbols: orderBookL2.symbols() });
});

router.delete("/api/orderbook-l2/:symbol", (req: Request, res: Response) => {
  const ok = orderBookL2.clear(String(req.params.symbol));
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.get("/api/orderbook-l2/:symbol/imbalance", (req: Request, res: Response) => {
  const n = req.query.n ? Number(req.query.n) : 5;
  res.json(imbalanceCalculator.compute(String(req.params.symbol), n));
});

router.get("/api/orderbook-l2/:symbol/spread", (req: Request, res: Response) => {
  res.json(spreadAnalyzer.compute(String(req.params.symbol)));
});

export default router;
