/**
 * routes/tax_tracking.ts — Phase 87 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  taxLotTracker,
  washSaleDetector,
  capitalGainsReporter,
  form1099Builder,
  type CostBasisMethod,
} from "../lib/tax_tracking";

const router = Router();

router.get("/api/tax/method", (_req: Request, res: Response) => {
  res.json({ method: taxLotTracker.getMethod() });
});

router.post("/api/tax/method", (req: Request, res: Response) => {
  const { method } = req.body ?? {};
  if (!method) return res.status(400).json({ error: "Missing method" });
  taxLotTracker.setMethod(method as CostBasisMethod);
  return res.json({ method: taxLotTracker.getMethod() });
});

router.post("/api/tax/acquire", (req: Request, res: Response) => {
  const { symbol, quantity, costPerShare, at } = req.body ?? {};
  if (!symbol || quantity === undefined || costPerShare === undefined) {
    return res.status(400).json({ error: "Missing symbol, quantity, or costPerShare" });
  }
  return res.status(201).json(taxLotTracker.acquire(
    String(symbol),
    Number(quantity),
    Number(costPerShare),
    at ? Number(at) : undefined,
  ));
});

router.post("/api/tax/dispose", (req: Request, res: Response) => {
  const { symbol, quantity, proceedsPerShare, at } = req.body ?? {};
  if (!symbol || quantity === undefined || proceedsPerShare === undefined) {
    return res.status(400).json({ error: "Missing symbol, quantity, or proceedsPerShare" });
  }
  return res.status(201).json({
    disposals: taxLotTracker.dispose(
      String(symbol),
      Number(quantity),
      Number(proceedsPerShare),
      at ? Number(at) : undefined,
    ),
  });
});

router.get("/api/tax/position/:symbol", (req: Request, res: Response) => {
  res.json(taxLotTracker.position(String(req.params.symbol)));
});

router.get("/api/tax/lots", (req: Request, res: Response) => {
  res.json({
    lots: taxLotTracker.openLots(req.query.symbol ? String(req.query.symbol) : undefined),
  });
});

router.get("/api/tax/disposals", (_req: Request, res: Response) => {
  res.json({ disposals: taxLotTracker.allDisposals() });
});

router.post("/api/tax/wash-sale/scan", (_req: Request, res: Response) => {
  res.json({
    violations: washSaleDetector.detect(taxLotTracker.allDisposals(), taxLotTracker.openLots()),
  });
});

router.get("/api/tax/capital-gains", (req: Request, res: Response) => {
  const start = req.query.start ? Number(req.query.start) : undefined;
  const end = req.query.end ? Number(req.query.end) : undefined;
  res.json(capitalGainsReporter.summarize(taxLotTracker.allDisposals(), { start, end }));
});

router.get("/api/tax/1099", (_req: Request, res: Response) => {
  res.json({ lines: form1099Builder.build(taxLotTracker.allDisposals()) });
});

export default router;
