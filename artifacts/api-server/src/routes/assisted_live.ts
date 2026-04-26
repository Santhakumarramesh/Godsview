/**
 * Phase 5 — Assisted-live approval API
 *
 * Endpoints:
 *   GET  /api/assisted-live/queue?status=pending|approved|...
 *   GET  /api/assisted-live/proposals/:id
 *   POST /api/assisted-live/proposals       — submit a new proposal
 *   POST /api/assisted-live/proposals/:id/approve
 *   POST /api/assisted-live/proposals/:id/reject
 *   POST /api/assisted-live/proposals/:id/execute
 *   GET  /api/assisted-live/stats
 *
 * /execute is the only endpoint that runs the safety gates (status, risk
 * re-check, slippage). Direct execution outside this route should not exist
 * in production.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { assistedLiveTrading } from "../lib/execution/assisted_live";
import { logger } from "../lib/logger";
import { requireOperator } from "../lib/auth_guard";
import { getCurrentPrice } from "../lib/execution/price_feed";

const router = Router();

const SubmitSchema = z.object({
  symbol: z.string().min(1),
  direction: z.enum(["long", "short"]),
  entry: z.number().positive(),
  stop: z.number().positive(),
  target: z.number().positive(),
  reason: z.string().min(1),
  confidence: z.number().min(0).max(100),
});

const ExecuteSchema = z.object({
  // currentPrice is now optional. If omitted, the route fetches a real quote.
  // It is still accepted for testing / dry-run scenarios but the operator
  // should rely on the live feed in production.
  currentPrice: z.number().positive().optional(),
  maxSlippageBps: z.number().int().min(1).max(1000).optional(),
});

router.get("/queue", (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const proposals = assistedLiveTrading.getQueue(status as any);
  res.json({ ok: true, count: proposals.length, proposals });
});

router.get("/stats", (_req: Request, res: Response) => {
  res.json({ ok: true, stats: assistedLiveTrading.getStats() });
});

router.get("/proposals/:id", (req: Request, res: Response) => {
  const p = assistedLiveTrading.getProposal(String(req.params.id));
  if (!p) {
    res.status(404).json({ ok: false, error: "not found" });
    return;
  }
  res.json({ ok: true, proposal: p });
});

router.post("/proposals", requireOperator, (req: Request, res: Response) => {
  const parsed = SubmitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues });
    return;
  }
  const b = parsed.data;
  try {
    const proposal = assistedLiveTrading.submitProposal(
      b.symbol, b.direction, b.entry, b.stop, b.target, b.reason, b.confidence
    );
    res.status(201).json({ ok: true, proposal });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/proposals/:id/approve", requireOperator, (req: Request, res: Response) => {
  try {
    const proposal = assistedLiveTrading.approveProposal(String(req.params.id));
    res.json({ ok: true, proposal });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/proposals/:id/reject", requireOperator, (req: Request, res: Response) => {
  const reason = typeof req.body?.reason === "string" ? req.body.reason : undefined;
  try {
    const proposal = assistedLiveTrading.rejectProposal(String(req.params.id), reason);
    res.json({ ok: true, proposal });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

router.post("/proposals/:id/execute", requireOperator, async (req: Request, res: Response) => {
  const parsed = ExecuteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues });
    return;
  }
  try {
    const id = String(req.params.id);
    const proposal = assistedLiveTrading.getProposal(id);
    if (!proposal) {
      res.status(404).json({ ok: false, error: "proposal not found" });
      return;
    }

    // Resolve real-time price. Caller-supplied currentPrice is a fallback
    // for dry-run scenarios only.
    const quote = await getCurrentPrice(proposal.symbol, parsed.data.currentPrice);
    if (!quote) {
      res.status(503).json({
        ok: false,
        error: "live price feed unavailable and no fallback provided",
      });
      return;
    }

    const result = assistedLiveTrading.tryExecute(id, {
      currentPrice: quote.price,
      maxSlippageBps: parsed.data.maxSlippageBps,
      // riskCheck is wired from the orchestrator at module init in production
    });
    if (!result.ok) {
      // @ts-expect-error TS2769 — strict build
      logger.warn(`Execute blocked`, { id, reason: result.reason, priceSource: quote.source });
      res.status(409).json({ ok: false, reason: result.reason, proposal: result.proposal, priceSource: quote.source });
      return;
    }
    res.json({ ok: true, proposal: result.proposal, priceSource: quote.source, priceUsed: quote.price });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
