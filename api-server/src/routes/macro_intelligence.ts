/**
 * Phase 33 — Macro Intelligence: API Routes
 *
 * Endpoints:
 * - POST   /events                    — Add economic event
 * - GET    /events                    — List upcoming events (next N hours)
 * - GET    /events/active             — List currently active events
 * - DELETE /events/:event_id          — Remove event
 * - GET    /lockout/:symbol           — Check lockout status for symbol
 * - GET    /cooldown/:symbol          — Check cooldown status for symbol
 * - POST   /distortions               — Add news distortion flag
 * - GET    /distortions               — Get active distortions
 * - POST   /risk/:symbol              — Compute macro risk for symbol
 * - GET    /risk/:symbol              — Get cached risk score for symbol
 * - GET    /risk                      — Get all cached risk scores
 * - GET    /summary                   — Macro intelligence summary
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  addEvent,
  removeEvent,
  getUpcomingEvents,
  getActiveEvents,
  isInLockout,
  isInCooldown,
  getEventWindows,
  type EconomicEvent,
} from "../lib/macro_intelligence/event_calendar.js";
import {
  computeMacroRisk,
  addNewsDistortion,
  getActiveDistortions,
  getMacroRiskScore,
  getAllRiskScores,
} from "../lib/macro_intelligence/macro_risk_scorer.js";

const router: IRouter = Router();

// ─── Event Management ──────────────────────────────────────────────────────

router.post("/events", (req: Request, res: Response) => {
  const {
    name,
    category,
    severity,
    scheduled_at,
    symbols_affected,
    pre_event_lockout_minutes,
    post_event_cooldown_minutes,
    status,
  } = req.body;

  if (!name || !category || !severity || !scheduled_at || !Array.isArray(symbols_affected)) {
    res.status(400).json({
      success: false,
      error: "Missing or invalid required fields: name, category, severity, scheduled_at, symbols_affected",
    });
    return;
  }

  const result = addEvent({
    name,
    category,
    severity,
    scheduled_at,
    symbols_affected,
    pre_event_lockout_minutes: pre_event_lockout_minutes ?? 15,
    post_event_cooldown_minutes: post_event_cooldown_minutes ?? 30,
    status: status ?? "upcoming",
  });

  res.status(result.success ? 201 : 400).json(result);
});

router.get("/events", (req: Request, res: Response) => {
  const hours_ahead = Number.parseInt(String(req.query.hours_ahead ?? "24"), 10);
  const hoursToQuery = Number.isFinite(hours_ahead) && hours_ahead > 0 ? hours_ahead : 24;
  const upcoming = getUpcomingEvents(hoursToQuery);
  res.json({ success: true, data: upcoming });
});

router.get("/events/active", (_req: Request, res: Response) => {
  const active = getActiveEvents();
  res.json({ success: true, data: active });
});

router.delete("/events/:event_id", (req: Request, res: Response) => {
  const { event_id } = req.params;
  const result = removeEvent(event_id);
  res.status(result.success ? 200 : 404).json(result);
});

// ─── Lockout & Cooldown Status ─────────────────────────────────────────────

router.get("/lockout/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const inLockout = isInLockout(symbol);
  const windows = getEventWindows(symbol);
  res.json({
    success: true,
    data: {
      symbol,
      in_lockout: inLockout,
      event_windows: windows,
    },
  });
});

router.get("/cooldown/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const inCooldown = isInCooldown(symbol);
  const windows = getEventWindows(symbol);
  res.json({
    success: true,
    data: {
      symbol,
      in_cooldown: inCooldown,
      event_windows: windows,
    },
  });
});

// ─── News Distortions ──────────────────────────────────────────────────────

router.post("/distortions", (req: Request, res: Response) => {
  const { symbol, source, headline, severity, duration_minutes } = req.body;

  if (!symbol || !source || !headline || !severity || !duration_minutes) {
    res.status(400).json({
      success: false,
      error: "Missing required fields: symbol, source, headline, severity, duration_minutes",
    });
    return;
  }

  const result = addNewsDistortion(symbol, source, headline, severity, duration_minutes);
  res.status(result.success ? 201 : 400).json(result);
});

router.get("/distortions", (req: Request, res: Response) => {
  const { symbol } = req.query;
  const distortions = getActiveDistortions(typeof symbol === "string" ? symbol : undefined);
  res.json({ success: true, data: distortions });
});

// ─── Macro Risk Scoring ────────────────────────────────────────────────────

router.post("/risk/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;

  // Get active events to pass to risk computation
  const activeEvents = getActiveEvents();

  const result = computeMacroRisk(symbol, activeEvents);
  res.status(result.success ? 200 : 400).json(result);
});

router.get("/risk/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;

  // Get all cached risk scores and find matches for symbol
  const allScores = getAllRiskScores();
  const symbolScores = allScores.filter((s) => s.symbol === symbol);

  if (symbolScores.length === 0) {
    res.status(404).json({
      success: false,
      error: `No risk score cached for symbol ${symbol}. POST /risk/${symbol} to compute.`,
    });
    return;
  }

  // Return most recent score
  const latest = symbolScores.sort(
    (a, b) => new Date(b.computed_at).getTime() - new Date(a.computed_at).getTime()
  )[0];

  res.json({ success: true, data: latest });
});

router.get("/risk", (_req: Request, res: Response) => {
  const scores = getAllRiskScores();
  res.json({ success: true, data: scores });
});

// ─── Summary ───────────────────────────────────────────────────────────────

router.get("/summary", (_req: Request, res: Response) => {
  const activeEvents = getActiveEvents();
  const allScores = getAllRiskScores();
  const activeDistortions = getActiveDistortions();

  // Count events by severity
  const severityCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const event of activeEvents) {
    severityCounts[event.severity as keyof typeof severityCounts]++;
  }

  // Count risk levels
  const riskLevelCounts = { low: 0, elevated: 0, high: 0, extreme: 0 };
  for (const score of allScores) {
    riskLevelCounts[score.risk_level as keyof typeof riskLevelCounts]++;
  }

  res.json({
    success: true,
    data: {
      active_events: activeEvents.length,
      event_severity_breakdown: severityCounts,
      cached_risk_scores: allScores.length,
      risk_level_breakdown: riskLevelCounts,
      active_news_distortions: activeDistortions.length,
      highest_risk_score: allScores.length > 0 ? Math.max(...allScores.map((s) => s.risk_score)) : 0,
      computed_at: new Date().toISOString(),
    },
  });
});

export default router;
