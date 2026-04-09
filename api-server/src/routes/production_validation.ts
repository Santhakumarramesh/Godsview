/**
 * Phase 27 — Production Validation Backbone
 * Routes: /api/validation/*
 *
 * Endpoints for managing validation sessions, comparison reports,
 * readiness scores, and promotion blockers.
 */

import { Router, type Request, type Response } from "express";
import {
  createValidationSession,
  startValidationSession,
  completeValidationSession,
  abortValidationSession,
  recordTrade,
  addValidationEvent,
  getSession,
  getSessionsByStrategy,
  getActiveSessions,
  getAllSessions,
} from "../lib/validation/validation_session_manager";
import {
  generateComparisonReport,
  getReport,
  getReportsByStrategy,
  getAllReports,
} from "../lib/validation/comparison_engine";
import {
  computeReadinessScore,
  getReadinessScore,
  getLatestScoreByStrategy,
  getAllScores,
} from "../lib/validation/readiness_scorer";

const router = Router();

// ── Validation Sessions ──────────────────────────────────────────────────

// POST /api/validation/sessions — create a new validation session
router.post("/sessions", (req: Request, res: Response) => {
  const {
    strategy_id,
    strategy_name,
    session_type,
    symbols,
    timeframe,
    capital_allocation,
    duration_minutes,
    operator_id,
    metadata,
  } = req.body;

  if (!strategy_id || !strategy_name || !session_type || !symbols || !timeframe) {
    res.status(400).json({
      error: "Missing required fields: strategy_id, strategy_name, session_type, symbols, timeframe",
    });
    return;
  }

  const validTypes = ["paper", "live_shadow", "backtest_replay"];
  if (!validTypes.includes(session_type)) {
    res.status(400).json({ error: `Invalid session_type. Must be one of: ${validTypes.join(", ")}` });
    return;
  }

  const result = createValidationSession({
    strategy_id,
    strategy_name,
    session_type,
    symbols: Array.isArray(symbols) ? symbols : [symbols],
    timeframe,
    capital_allocation: capital_allocation ?? 10000,
    duration_minutes,
    operator_id,
    metadata,
  });

  if (!result.success) {
    res.status(409).json({ error: result.error });
    return;
  }

  res.status(201).json(result.session);
});

// GET /api/validation/sessions — list all validation sessions
router.get("/sessions", (_req: Request, res: Response) => {
  const limit = parseInt(_req.query.limit as string) || 50;
  res.json(getAllSessions(limit));
});

// GET /api/validation/sessions/active — list active sessions
router.get("/sessions/active", (_req: Request, res: Response) => {
  res.json(getActiveSessions());
});

// GET /api/validation/sessions/:id — get session by ID
router.get("/sessions/:id", (req: Request, res: Response) => {
  const session = getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: "Validation session not found" });
    return;
  }
  res.json(session);
});

// POST /api/validation/sessions/:id/start — start a pending session
router.post("/sessions/:id/start", (req: Request, res: Response) => {
  const result = startValidationSession(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.session);
});

// POST /api/validation/sessions/:id/complete — complete an active session
router.post("/sessions/:id/complete", (req: Request, res: Response) => {
  const result = completeValidationSession(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.session);
});

// POST /api/validation/sessions/:id/abort — abort a session
router.post("/sessions/:id/abort", (req: Request, res: Response) => {
  const reason = req.body.reason ?? "Operator abort";
  const result = abortValidationSession(req.params.id, reason);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json(result.session);
});

// POST /api/validation/sessions/:id/trades — record a trade in session
router.post("/sessions/:id/trades", (req: Request, res: Response) => {
  const trade = req.body;
  if (!trade.symbol || trade.slippage_bps === undefined) {
    res.status(400).json({ error: "Missing required trade fields: symbol, slippage_bps" });
    return;
  }

  const result = recordTrade(req.params.id, {
    symbol: trade.symbol,
    side: trade.side ?? "buy",
    quantity: trade.quantity ?? 1,
    entry_price: trade.entry_price ?? 0,
    exit_price: trade.exit_price,
    pnl: trade.pnl,
    slippage_bps: trade.slippage_bps,
    expected_slippage_bps: trade.expected_slippage_bps ?? 0,
    signal_to_fill_ms: trade.signal_to_fill_ms ?? 0,
    regime: trade.regime,
    rejected: trade.rejected ?? false,
  });

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

// POST /api/validation/sessions/:id/events — add event to session
router.post("/sessions/:id/events", (req: Request, res: Response) => {
  const { event_type, severity, message, data } = req.body;
  if (!event_type || !message) {
    res.status(400).json({ error: "Missing required fields: event_type, message" });
    return;
  }

  const result = addValidationEvent(
    req.params.id,
    event_type,
    severity ?? "info",
    message,
    data
  );

  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ success: true });
});

// GET /api/validation/strategy/:strategy_id/sessions — sessions for a strategy
router.get("/strategy/:strategy_id/sessions", (req: Request, res: Response) => {
  res.json(getSessionsByStrategy(req.params.strategy_id));
});

// ── Comparison Reports ───────────────────────────────────────────────────

// POST /api/validation/compare — generate comparison report
router.post("/compare", (req: Request, res: Response) => {
  const { strategy_id, backtest, paper, live_shadow } = req.body;
  if (!strategy_id) {
    res.status(400).json({ error: "Missing required field: strategy_id" });
    return;
  }

  if (!backtest && !paper && !live_shadow) {
    res.status(400).json({
      error: "At least one performance snapshot required (backtest, paper, or live_shadow)",
    });
    return;
  }

  const report = generateComparisonReport(strategy_id, {
    backtest,
    paper,
    live_shadow,
  });

  res.status(201).json(report);
});

// GET /api/validation/reports — list all comparison reports
router.get("/reports", (_req: Request, res: Response) => {
  const limit = parseInt(_req.query.limit as string) || 50;
  res.json(getAllReports(limit));
});

// GET /api/validation/reports/:id — get report by ID
router.get("/reports/:id", (req: Request, res: Response) => {
  const report = getReport(req.params.id);
  if (!report) {
    res.status(404).json({ error: "Comparison report not found" });
    return;
  }
  res.json(report);
});

// GET /api/validation/strategy/:strategy_id/reports — reports for a strategy
router.get("/strategy/:strategy_id/reports", (req: Request, res: Response) => {
  res.json(getReportsByStrategy(req.params.strategy_id));
});

// ── Readiness Scores ─────────────────────────────────────────────────────

// POST /api/validation/readiness/:strategy_id — compute readiness score
router.post("/readiness/:strategy_id", (req: Request, res: Response) => {
  const score = computeReadinessScore(req.params.strategy_id);
  res.status(201).json(score);
});

// GET /api/validation/readiness/:strategy_id — get latest readiness score
router.get("/readiness/:strategy_id", (req: Request, res: Response) => {
  const score = getLatestScoreByStrategy(req.params.strategy_id);
  if (!score) {
    res.status(404).json({ error: "No readiness score found for strategy" });
    return;
  }
  res.json(score);
});

// GET /api/validation/readiness — list all readiness scores
router.get("/readiness", (_req: Request, res: Response) => {
  const limit = parseInt(_req.query.limit as string) || 50;
  res.json(getAllScores(limit));
});

// GET /api/validation/readiness/:strategy_id/blockers — get promotion blockers
router.get("/readiness/:strategy_id/blockers", (req: Request, res: Response) => {
  const score = getLatestScoreByStrategy(req.params.strategy_id);
  if (!score) {
    res.status(404).json({ error: "No readiness score found. Compute readiness first." });
    return;
  }
  res.json({
    strategy_id: req.params.strategy_id,
    eligible_for_promotion: score.eligible_for_promotion,
    readiness_level: score.readiness_level,
    blockers: score.blockers,
    recommendation: score.recommendation,
  });
});

// ── Summary ──────────────────────────────────────────────────────────────

// GET /api/validation/summary — overall validation system summary
router.get("/summary", (_req: Request, res: Response) => {
  const allSessions = getAllSessions(1000);
  const active = allSessions.filter((s) => s.status === "active");
  const completed = allSessions.filter((s) => s.status === "completed");
  const reports = getAllReports(1000);
  const readinessScores = getAllScores(1000);
  const promotionReady = readinessScores.filter((s) => s.eligible_for_promotion);

  res.json({
    total_sessions: allSessions.length,
    active_sessions: active.length,
    completed_sessions: completed.length,
    total_comparison_reports: reports.length,
    total_readiness_scores: readinessScores.length,
    strategies_ready_for_promotion: promotionReady.length,
    system_status: active.length > 0 ? "validating" : "idle",
  });
});

export default router;
