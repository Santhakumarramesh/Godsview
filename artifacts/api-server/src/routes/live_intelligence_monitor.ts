/**
 * live_intelligence_monitor.ts — Live Intelligence Monitor API (Phase 54)
 */
import { Router, type Request, type Response } from "express";
import {
  createAlert, acknowledgeAlert, getActiveAlerts,
  triggerNewsLockout, checkNewsLockout,
  updateRegime, getRegime,
  updateEngineHealth, getIntelligenceFeed,
  getLiveMonitorSnapshot, resetLiveMonitor,
  type AlertSeverity, type AlertCategory, type MarketRegime,
} from "../lib/live_intelligence_monitor.js";

const router = Router();

router.get("/api/intelligence/feed", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, feed: getIntelligenceFeed() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/intelligence/snapshot", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, snapshot: getLiveMonitorSnapshot() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/intelligence/alerts", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, alerts: getActiveAlerts() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/intelligence/regime", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, regime: getRegime() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.get("/api/intelligence/lockout", async (_req: Request, res: Response) => {
  try { res.json({ ok: true, lockout: checkNewsLockout() }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/intelligence/alert", async (req: Request, res: Response) => {
  try {
    const { severity, category, title, message, symbol, metadata, expiresInMs } = req.body;
    if (!title || !message) { res.status(400).json({ ok: false, error: "title and message required" }); return; }
    const alert = createAlert({
      severity: severity ?? "INFO", category: category ?? "ANOMALY",
      title, message, symbol, metadata, expiresInMs,
    });
    res.json({ ok: true, alert });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/intelligence/alert/:id/ack", async (req: Request, res: Response) => {
  try {
    const ok = acknowledgeAlert(String(req.params.id));
    res.json({ ok, message: ok ? "Acknowledged" : "Alert not found" });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/intelligence/lockout", async (req: Request, res: Response) => {
  try {
    const { title, impact, symbols, lockoutMinutes, source } = req.body;
    if (!title) { res.status(400).json({ ok: false, error: "title required" }); return; }
    const event = triggerNewsLockout({ title, impact: impact ?? "HIGH", symbols, lockoutMinutes, source });
    res.json({ ok: true, event });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/intelligence/regime", async (req: Request, res: Response) => {
  try {
    const { regime, confidence } = req.body;
    if (!regime) { res.status(400).json({ ok: false, error: "regime required" }); return; }
    const state = updateRegime(regime as MarketRegime, confidence);
    res.json({ ok: true, regime: state });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/intelligence/engine-health", async (req: Request, res: Response) => {
  try {
    const { engine, status, latencyMs, errorRate } = req.body;
    if (!engine || !status) { res.status(400).json({ ok: false, error: "engine and status required" }); return; }
    updateEngineHealth(engine, status, latencyMs, errorRate);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

router.post("/api/intelligence/reset", async (_req: Request, res: Response) => {
  try { resetLiveMonitor(); res.json({ ok: true, message: "Live monitor reset" }); }
  catch (err) { res.status(500).json({ ok: false, error: String(err) }); }
});

export default router;
