/**
 * Assisted Live Routes — Phase 21
 *
 * Tightly supervised real-money trading with explicit human approval.
 *
 * POST   /sessions              — Create a new assisted-live session
 * GET    /sessions              — List all sessions
 * GET    /sessions/:id          — Get session details
 * POST   /queue                 — Submit order to approval queue
 * GET    /queue                 — Get pending approvals
 * GET    /queue/:id             — Get approval details
 * POST   /approve/:id           — Approve a pending order
 * POST   /reject/:id            — Reject a pending order
 * POST   /pause/:session_id     — Pause a session
 * POST   /resume/:session_id    — Resume a paused session
 * POST   /stop/:session_id      — Stop a session
 * POST   /flatten/:session_id   — Emergency flatten (close all)
 * GET    /incidents              — List incidents
 * GET    /incidents/:id          — Get incident detail
 * POST   /incidents/:id/resolve — Resolve an incident
 * GET    /operator-actions       — Operator action audit log
 */

import { Router, Request, Response } from "express";
import { requireOperator } from "../lib/auth_guard";
import { logger } from "../lib/logger";
import {
  createSession,
  pauseSession,
  resumeSession,
  stopSession,
  getSession,
  getActiveSessions,
  getAllSessions,
  updateSessionCounters,
} from "../lib/assisted_live/live_session_manager";
import {
  submitToQueue,
  approveOrder,
  rejectOrder,
  getPendingApprovals,
  getApproval,
  getQueueForSession,
  getQueueStats,
} from "../lib/assisted_live/approval_queue_manager";
import {
  evaluatePretradeGate,
} from "../lib/assisted_live/pretrade_live_gate";
import {
  logIncident,
  resolveIncident,
  getOpenIncidents,
  getAllIncidents,
  getIncidentsForSession,
  getIncident,
} from "../lib/assisted_live/live_incident_logger";
import {
  flattenSessionPositions,
} from "../lib/assisted_live/emergency_flatten_controller";
import {
  pauseLiveSession,
  resumeLiveSession,
} from "../lib/assisted_live/live_pause_controller";

const assistedLiveRouter = Router();

// ── Operator action audit log (in-memory, append-only) ──────────
interface OperatorAction {
  action_id: string;
  operator_id: string;
  action: string;
  target_type: string;
  target_id: string;
  details?: Record<string, unknown>;
  timestamp: string;
}
const operatorActions: OperatorAction[] = [];

function recordAction(operator_id: string, action: string, target_type: string, target_id: string, details?: Record<string, unknown>) {
  operatorActions.push({
    action_id: `opa_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    operator_id,
    action,
    target_type,
    target_id,
    details,
    timestamp: new Date().toISOString(),
  });
}

// ── Sessions ─────────────────────────────────────────────────────

assistedLiveRouter.post("/sessions", requireOperator, async (req: Request, res: Response) => {
  try {
    const { strategy_id, strategy_name, operator_id, max_position_size, max_daily_loss, max_open_orders, allowed_symbols, certification_run_id } = req.body;

    if (!strategy_id || !strategy_name || !operator_id) {
      res.status(400).json({ error: "validation_error", message: "Required: strategy_id, strategy_name, operator_id" });
      return;
    }

    const result = createSession({
      strategy_id, strategy_name, operator_id,
      max_position_size: max_position_size ? Number(max_position_size) : undefined,
      max_daily_loss: max_daily_loss ? Number(max_daily_loss) : undefined,
      max_open_orders: max_open_orders ? Number(max_open_orders) : undefined,
      allowed_symbols: allowed_symbols ?? [],
      certification_run_id,
    });

    if (!result.success) {
      res.status(409).json({ error: "session_conflict", message: result.error });
      return;
    }

    recordAction(operator_id, "create_session", "session", result.session!.session_id);
    res.status(201).json(result.session);
  } catch (err) {
    logger.error({ err }, "Create session error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.get("/sessions", async (_req: Request, res: Response) => {
  try {
    const all = _req.query.all === "true";
    const sessions = all ? getAllSessions(100) : getActiveSessions();
    res.json({ sessions, count: sessions.length });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.get("/sessions/:id", async (req: Request, res: Response) => {
  try {
    const session = getSession(req.params.id);
    if (!session) { res.status(404).json({ error: "not_found" }); return; }

    const queue = getQueueForSession(req.params.id);
    const incidents = getIncidentsForSession(req.params.id);

    res.json({ session, queue_count: queue.length, recent_queue: queue.slice(0, 10), incidents: incidents.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Approval Queue ───────────────────────────────────────────────

assistedLiveRouter.post("/queue", requireOperator, async (req: Request, res: Response) => {
  try {
    const { session_id, strategy_id, symbol, side, order_type, qty, limit_price, signal_confidence, decision_packet_json, risk_assessment_json } = req.body;

    if (!session_id || !symbol || !side || !qty) {
      res.status(400).json({ error: "validation_error", message: "Required: session_id, symbol, side, qty" });
      return;
    }

    // Get session to evaluate gate
    const session = getSession(session_id);
    if (!session) {
      res.status(404).json({ error: "session_not_found", message: `Session ${session_id} not found` });
      return;
    }

    // Pre-trade gate check
    const pendingCount = getPendingApprovals(session_id).length;
    const gateResult = evaluatePretradeGate({
      session_id,
      session_status: session.status,
      symbol,
      side,
      qty: Number(qty),
      limit_price: limit_price ? Number(limit_price) : undefined,
      signal_confidence: signal_confidence ? Number(signal_confidence) : undefined,
      max_position_size: session.max_position_size,
      max_daily_loss: session.max_daily_loss,
      max_open_orders: session.max_open_orders,
      allowed_symbols: session.allowed_symbols,
      current_open_orders: pendingCount + session.orders_approved,
      current_daily_pnl: session.realized_pnl + session.unrealized_pnl,
    });

    if (!gateResult.passed) {
      // Log gate failure as incident
      logIncident({
        session_id,
        strategy_id: session.strategy_id,
        severity: "warning",
        type: "gate_failure",
        title: `Pre-trade gate blocked ${symbol} ${side}`,
        description: gateResult.blocked_reasons.join("; "),
        details_json: { gate_checks: gateResult.checks },
      });

      res.status(422).json({ error: "gate_blocked", gate_result: gateResult });
      return;
    }

    // Submit to approval queue
    const approval = submitToQueue({
      session_id,
      strategy_id: strategy_id ?? session.strategy_id,
      symbol,
      side,
      order_type: order_type ?? "market",
      qty: Number(qty),
      limit_price: limit_price ? Number(limit_price) : undefined,
      signal_confidence: signal_confidence ? Number(signal_confidence) : undefined,
      decision_packet_json,
      risk_assessment_json,
    });

    updateSessionCounters(session_id, { submitted: true });

    res.status(201).json({ approval, gate_result: gateResult });
  } catch (err) {
    logger.error({ err }, "Submit to queue error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.get("/queue", async (req: Request, res: Response) => {
  try {
    const session_id = req.query.session_id as string | undefined;
    const pending = getPendingApprovals(session_id);
    const stats = getQueueStats();
    res.json({ pending, stats });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.get("/queue/:id", async (req: Request, res: Response) => {
  try {
    const approval = getApproval(req.params.id);
    if (!approval) { res.status(404).json({ error: "not_found" }); return; }
    res.json(approval);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Approve / Reject ─────────────────────────────────────────────

assistedLiveRouter.post("/approve/:id", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const result = approveOrder(req.params.id, operator_id);

    if (!result.success) {
      res.status(400).json({ error: "approve_failed", message: result.error });
      return;
    }

    // Update session counters
    if (result.approval) {
      updateSessionCounters(result.approval.session_id, { approved: true });
      recordAction(operator_id, "approve_order", "approval", req.params.id, {
        symbol: result.approval.symbol,
        side: result.approval.side,
        qty: result.approval.qty,
      });
    }

    res.json({ approved: true, approval: result.approval });
  } catch (err) {
    logger.error({ err }, "Approve error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.post("/reject/:id", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const reason = req.body.reason ?? "Operator rejected";
    const result = rejectOrder(req.params.id, operator_id, reason);

    if (!result.success) {
      res.status(400).json({ error: "reject_failed", message: result.error });
      return;
    }

    if (result.approval) {
      updateSessionCounters(result.approval.session_id, { rejected: true });
      recordAction(operator_id, "reject_order", "approval", req.params.id, {
        symbol: result.approval.symbol,
        reason,
      });
    }

    res.json({ rejected: true, approval: result.approval });
  } catch (err) {
    logger.error({ err }, "Reject error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Pause / Resume / Stop / Flatten ──────────────────────────────

assistedLiveRouter.post("/pause/:session_id", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const reason = req.body.reason ?? "manual_pause";
    const result = pauseLiveSession(req.params.session_id, operator_id, reason);

    if (result.error) {
      res.status(400).json({ error: "pause_failed", message: result.error });
      return;
    }

    recordAction(operator_id, "pause_session", "session", req.params.session_id, { reason });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.post("/resume/:session_id", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const reason = req.body.reason ?? "manual_resume";
    const result = resumeLiveSession(req.params.session_id, operator_id, reason);

    if (result.error) {
      res.status(400).json({ error: "resume_failed", message: result.error });
      return;
    }

    recordAction(operator_id, "resume_session", "session", req.params.session_id, { reason });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.post("/stop/:session_id", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const result = stopSession(req.params.session_id, operator_id);

    if (!result.success) {
      res.status(400).json({ error: "stop_failed", message: result.error });
      return;
    }

    recordAction(operator_id, "stop_session", "session", req.params.session_id);
    res.json({ stopped: true, session: result.session });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.post("/flatten/:session_id", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const reason = req.body.reason ?? "operator_flatten";
    const result = await flattenSessionPositions(req.params.session_id, operator_id, reason);

    recordAction(operator_id, "flatten_session", "session", req.params.session_id, { reason });

    if (result.status === "error") {
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Flatten error");
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Incidents ────────────────────────────────────────────────────

assistedLiveRouter.get("/incidents", async (req: Request, res: Response) => {
  try {
    const session_id = req.query.session_id as string | undefined;
    const open_only = req.query.open === "true";

    let incidents;
    if (open_only) {
      incidents = getOpenIncidents();
    } else if (session_id) {
      incidents = getIncidentsForSession(session_id);
    } else {
      incidents = getAllIncidents(Number(req.query.limit) || 100);
    }

    res.json({ incidents, count: incidents.length });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.get("/incidents/:id", async (req: Request, res: Response) => {
  try {
    const incident = getIncident(req.params.id);
    if (!incident) { res.status(404).json({ error: "not_found" }); return; }
    res.json(incident);
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

assistedLiveRouter.post("/incidents/:id/resolve", requireOperator, async (req: Request, res: Response) => {
  try {
    const operator_id = req.body.operator_id ?? "operator";
    const notes = req.body.notes ?? "";
    const result = resolveIncident(req.params.id, operator_id, notes);

    if (!result.success) {
      res.status(400).json({ error: "resolve_failed", message: result.error });
      return;
    }

    recordAction(operator_id, "resolve_incident", "incident", req.params.id, { notes });
    res.json({ resolved: true, incident: result.incident });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

// ── Operator Actions ─────────────────────────────────────────────

assistedLiveRouter.get("/operator-actions", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const recent = operatorActions.slice(-limit).reverse();
    res.json({ actions: recent, count: recent.length });
  } catch (err) {
    res.status(500).json({ error: "internal_error", message: String(err) });
  }
});

export default assistedLiveRouter;
