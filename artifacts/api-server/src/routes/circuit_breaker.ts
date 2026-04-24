/**
 * circuit_breaker.ts — Circuit Breaker + Rate Limiter API (Phase 55)
 */
import { Router, type Request, type Response } from "express";
import {
  checkBreaker, recordTradeResult, checkRateLimit, recordOrder,
  activateKillSwitch, deactivateKillSwitch, isTradingAllowed,
  getCircuitBreakerSnapshot, updateConfig, resetCircuitBreaker,
} from "../lib/circuit_breaker.js";

const router = Router();

router.get("/api/circuit-breaker/snapshot", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, snapshot: getCircuitBreakerSnapshot() }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.get("/api/circuit-breaker/status", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, breaker: checkBreaker(), tradingAllowed: isTradingAllowed() }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/circuit-breaker/trade-result", async (req: Request, res: Response) => {
  try {
    const { pnlPct } = req.body;
    if (pnlPct == null) { res.status(400).json({ ok: false, error: "pnlPct required" }); return; }
    res.json({ ok: true, breaker: recordTradeResult(pnlPct) });
  } catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/circuit-breaker/record-order", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, rateLimiter: recordOrder() }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/circuit-breaker/kill-switch", async (req: Request, res: Response) => {
  try {
    const { action, reason, activatedBy } = req.body;
    if (action === "activate") {
      res.json({ ok: true, killSwitch: activateKillSwitch(reason ?? "Manual activation", activatedBy) });
    } else {
      res.json({ ok: true, killSwitch: deactivateKillSwitch() });
    }
  } catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/circuit-breaker/config", async (req: Request, res: Response) => {
  try { res.json({ ok: true, config: updateConfig(req.body) }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

router.post("/api/circuit-breaker/reset", async (_req: Request, res: Response) => {
  try { resetCircuitBreaker(); res.json({ ok: true, message: "Circuit breaker reset" }); }
  catch (err) { res.status(503).json({ ok: false, error: String(err) }); }
});

export default router;
