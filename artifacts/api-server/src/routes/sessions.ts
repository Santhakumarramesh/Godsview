/**
 * Session & Audit Trail API Routes
 *
 * GET  /api/sessions              — List recent trading sessions
 * GET  /api/sessions/active       — Current active session
 * POST /api/sessions/start        — Start a new session
 * POST /api/sessions/end          — End the active session
 * GET  /api/sessions/:id/events   — Audit events for a session
 *
 * GET  /api/audit                 — Recent audit events (paginated)
 * GET  /api/audit/breaker         — Breaker event history
 * GET  /api/audit/timeline        — Unified timeline of all events
 */

import { Router, type IRouter } from "express";
import { db, tradingSessionsTable, auditEventsTable, breakerEventsTable } from "@workspace/db";
import { desc, eq, and, gte, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { withDegradation } from "../lib/degradation";
import {
  startSession,
  endSession,
  getActiveSession,
} from "../lib/session_manager";

const router: IRouter = Router();

/* ── Sessions ──────────────────────────────────────────────────────── */

router.get("/sessions", async (_req, res) => {
  try {
    const limit = Math.min(parseInt(String(_req.query.limit) || "20", 10) || 20, 100);
    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        return await db
          .select()
          .from(tradingSessionsTable)
          .orderBy(desc(tradingSessionsTable.created_at))
          .limit(limit);
      },
      [],
    );
    if (degraded) {
      res.status(503).json({ sessions: result, source: "unavailable", message: "Database unavailable" });
      return;
    }
    res.json({ sessions: result });
  } catch (err: any) {
    logger.error(`Failed to fetch sessions: ${err.message}`);
    res.status(503).json({ sessions: [], source: "unavailable", message: "Database unavailable" });
  }
});

router.get("/sessions/active", (_req, res) => {
  const session = getActiveSession();
  if (!session) {
    res.json({ active: false, session: null });
    return;
  }
  res.json({ active: true, session });
});

router.post("/sessions/start", async (req, res) => {
  try {
    const mode = req.body?.mode || process.env.GODSVIEW_SYSTEM_MODE || "paper";
    const operatorId = req.body?.operator_id;
    const { result, degraded } = await withDegradation(
      "database",
      async () => startSession(mode, operatorId),
      null,
    );
    if (degraded) {
      res.status(503).json({ ok: false, error: "service_unavailable", message: "Database unavailable — cannot start session" });
      return;
    }
    res.json({ ok: true, session: result });
  } catch (err: any) {
    logger.error(`Failed to start session: ${err.message}`);
    res.status(503).json({ ok: false, error: "service_unavailable", message: "Database unavailable" });
  }
});

router.post("/sessions/end", async (req, res) => {
  try {
    const reason = req.body?.reason || "manual";
    const { degraded } = await withDegradation(
      "database",
      async () => { await endSession(reason); return true; },
      false,
    );
    if (degraded) {
      res.status(503).json({ ok: false, error: "service_unavailable", message: "Database unavailable — cannot end session" });
      return;
    }
    res.json({ ok: true });
  } catch (err: any) {
    logger.error(`Failed to end session: ${err.message}`);
    res.status(503).json({ ok: false, error: "service_unavailable", message: "Database unavailable" });
  }
});

router.get("/sessions/:id/events", async (req, res) => {
  try {
    const sessionId = String(req.params.id ?? "");
    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        const [sessionRows, auditRows, breakerRows] = await Promise.all([
          db.select().from(tradingSessionsTable).where(eq(tradingSessionsTable.session_id, sessionId)).limit(1),
          db.select().from(auditEventsTable).where(
            and(gte(auditEventsTable.created_at, sql`(SELECT started_at FROM trading_sessions WHERE session_id = ${sessionId})`)),
          ).orderBy(desc(auditEventsTable.created_at)).limit(500),
          db.select().from(breakerEventsTable).where(eq(breakerEventsTable.session_id, sessionId)).orderBy(desc(breakerEventsTable.created_at)).limit(200),
        ]);
        return { session: sessionRows[0] ?? null, audit_events: auditRows, breaker_events: breakerRows };
      },
      { session: null, audit_events: [], breaker_events: [] },
    );
    if (degraded) {
      res.status(503).json({ ...result, source: "unavailable", message: "Database unavailable" });
      return;
    }
    res.json(result);
  } catch (err: any) {
    logger.error(`Failed to fetch session events: ${err.message}`);
    res.status(503).json({ session: null, audit_events: [], breaker_events: [], source: "unavailable", message: "Database unavailable" });
  }
});

/* ── Audit Events ──────────────────────────────────────────────────── */

router.get("/audit", async (_req, res) => {
  try {
    const limit = Math.min(parseInt(String(_req.query.limit) || "50", 10) || 50, 500);
    const eventType = _req.query.event_type as string | undefined;

    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        let query = db.select().from(auditEventsTable).$dynamic();
        if (eventType) {
          query = query.where(eq(auditEventsTable.event_type, eventType));
        }
        return await query.orderBy(desc(auditEventsTable.created_at)).limit(limit);
      },
      [],
    );
    if (degraded) {
      res.status(503).json({ events: result, count: 0, source: "unavailable", message: "Database unavailable" });
      return;
    }
    res.json({ events: result, count: result.length });
  } catch (err: any) {
    logger.error(`Failed to fetch audit events: ${err.message}`);
    res.status(503).json({ events: [], count: 0, source: "unavailable", message: "Database unavailable" });
  }
});

router.get("/audit/breaker", async (_req, res) => {
  try {
    const limit = Math.min(parseInt(String(_req.query.limit) || "50", 10) || 50, 200);
    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        return await db.select().from(breakerEventsTable).orderBy(desc(breakerEventsTable.created_at)).limit(limit);
      },
      [],
    );
    if (degraded) {
      res.status(503).json({ events: result, count: 0, source: "unavailable", message: "Database unavailable" });
      return;
    }
    res.json({ events: result, count: result.length });
  } catch (err: any) {
    logger.error(`Failed to fetch breaker events: ${err.message}`);
    res.status(503).json({ events: [], count: 0, source: "unavailable", message: "Database unavailable" });
  }
});

router.get("/audit/timeline", async (_req, res) => {
  try {
    const limit = Math.min(parseInt(String(_req.query.limit) || "100", 10) || 100, 500);
    const hoursBack = Math.min(parseInt(String(_req.query.hours) || "24", 10) || 24, 168);
    const since = new Date(Date.now() - hoursBack * 3_600_000);

    const { result, degraded } = await withDegradation(
      "database",
      async () => {
        const [audits, breakers] = await Promise.all([
          db.select({
            id: auditEventsTable.id,
            type: sql<string>`'audit'`,
            event_type: auditEventsTable.event_type,
            decision_state: auditEventsTable.decision_state,
            instrument: auditEventsTable.instrument,
            actor: auditEventsTable.actor,
            reason: auditEventsTable.reason,
            created_at: auditEventsTable.created_at,
          }).from(auditEventsTable).where(gte(auditEventsTable.created_at, since)).orderBy(desc(auditEventsTable.created_at)).limit(limit),
          db.select({
            id: breakerEventsTable.id,
            type: sql<string>`'breaker'`,
            event_type: breakerEventsTable.trigger,
            decision_state: breakerEventsTable.level,
            instrument: sql<string>`null`,
            actor: sql<string>`'system'`,
            reason: breakerEventsTable.details,
            created_at: breakerEventsTable.created_at,
          }).from(breakerEventsTable).where(gte(breakerEventsTable.created_at, since)).orderBy(desc(breakerEventsTable.created_at)).limit(limit),
        ]);
        return [...audits, ...breakers]
          .sort((a, b) => {
            const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
            const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
            return tb - ta;
          })
          .slice(0, limit);
      },
      [],
    );
    if (degraded) {
      res.status(503).json({ timeline: result, count: 0, hours_back: hoursBack, source: "unavailable", message: "Database unavailable" });
      return;
    }
    res.json({ timeline: result, count: result.length, hours_back: hoursBack });
  } catch (err: any) {
    logger.error(`Failed to fetch timeline: ${err.message}`);
    res.status(503).json({ timeline: [], count: 0, hours_back: 24, source: "unavailable", message: "Database unavailable" });
  }
});

export default router;
