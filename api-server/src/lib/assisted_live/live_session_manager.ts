/**
 * Live Session Manager — Phase 21
 *
 * Manages assisted-live trading sessions:
 *   - Create/start sessions
 *   - Pause/resume sessions
 *   - Stop sessions
 *   - Flatten (emergency close all positions for a session)
 *   - Track session state
 *
 * Only ONE active session per strategy is allowed at a time.
 */

import { logger } from "../logger";
import crypto from "crypto";

export interface LiveSession {
  session_id: string;
  strategy_id: string;
  strategy_name: string;
  operator_id: string;
  status: "active" | "paused" | "stopped" | "emergency_stopped" | "flattened";
  system_mode: string;

  // Risk parameters
  max_position_size: number;
  max_daily_loss: number;
  max_open_orders: number;
  allowed_symbols: string[];

  // Session state
  orders_submitted: number;
  orders_approved: number;
  orders_rejected: number;
  realized_pnl: number;
  unrealized_pnl: number;

  // Refs
  certification_run_id?: string;

  // Timestamps
  started_at: Date;
  paused_at?: Date;
  stopped_at?: Date;
  created_at: Date;
}

// In-memory store (backed by DB for persistence)
const sessions: Map<string, LiveSession> = new Map();

export interface CreateSessionParams {
  strategy_id: string;
  strategy_name: string;
  operator_id: string;
  max_position_size?: number;
  max_daily_loss?: number;
  max_open_orders?: number;
  allowed_symbols?: string[];
  certification_run_id?: string;
}

export function createSession(params: CreateSessionParams): {
  success: boolean;
  session?: LiveSession;
  error?: string;
} {
  // Check for existing active session for this strategy
  const existing = Array.from(sessions.values()).find(
    (s) => s.strategy_id === params.strategy_id && (s.status === "active" || s.status === "paused")
  );
  if (existing) {
    return {
      success: false,
      error: `Strategy ${params.strategy_id} already has an active session: ${existing.session_id}`,
    };
  }

  const session_id = `als_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date();

  const session: LiveSession = {
    session_id,
    strategy_id: params.strategy_id,
    strategy_name: params.strategy_name,
    operator_id: params.operator_id,
    status: "active",
    system_mode: "live_enabled",
    max_position_size: params.max_position_size ?? 100,
    max_daily_loss: params.max_daily_loss ?? 500,
    max_open_orders: params.max_open_orders ?? 5,
    allowed_symbols: params.allowed_symbols ?? [],
    orders_submitted: 0,
    orders_approved: 0,
    orders_rejected: 0,
    realized_pnl: 0,
    unrealized_pnl: 0,
    certification_run_id: params.certification_run_id,
    started_at: now,
    created_at: now,
  };

  sessions.set(session_id, session);
  logger.info({ session_id, strategy_id: params.strategy_id, operator_id: params.operator_id }, "Assisted live session CREATED");

  return { success: true, session };
}

export function pauseSession(session_id: string, operator_id: string): {
  success: boolean;
  session?: LiveSession;
  error?: string;
} {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status !== "active") return { success: false, error: `Cannot pause: status is '${session.status}'` };

  session.status = "paused";
  session.paused_at = new Date();

  logger.warn({ session_id, operator_id }, "Assisted live session PAUSED");
  return { success: true, session };
}

export function resumeSession(session_id: string, operator_id: string): {
  success: boolean;
  session?: LiveSession;
  error?: string;
} {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status !== "paused") return { success: false, error: `Cannot resume: status is '${session.status}'` };

  session.status = "active";
  session.paused_at = undefined;

  logger.info({ session_id, operator_id }, "Assisted live session RESUMED");
  return { success: true, session };
}

export function stopSession(session_id: string, operator_id: string): {
  success: boolean;
  session?: LiveSession;
  error?: string;
} {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status === "stopped" || session.status === "emergency_stopped" || session.status === "flattened") {
    return { success: false, error: `Session already terminated: ${session.status}` };
  }

  session.status = "stopped";
  session.stopped_at = new Date();

  logger.info({ session_id, operator_id }, "Assisted live session STOPPED");
  return { success: true, session };
}

export function emergencyStopSession(session_id: string, operator_id: string, reason: string): {
  success: boolean;
  session?: LiveSession;
  error?: string;
} {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };

  session.status = "emergency_stopped";
  session.stopped_at = new Date();

  logger.fatal({ session_id, operator_id, reason }, "Assisted live session EMERGENCY STOPPED");
  return { success: true, session };
}

export function flattenSession(session_id: string, operator_id: string): {
  success: boolean;
  session?: LiveSession;
  error?: string;
} {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };

  session.status = "flattened";
  session.stopped_at = new Date();

  logger.fatal({ session_id, operator_id }, "Assisted live session FLATTENED (all positions closed)");
  return { success: true, session };
}

export function getSession(session_id: string): LiveSession | undefined {
  return sessions.get(session_id);
}

export function getActiveSessions(): LiveSession[] {
  return Array.from(sessions.values())
    .filter((s) => s.status === "active" || s.status === "paused")
    .sort((a, b) => b.started_at.getTime() - a.started_at.getTime());
}

export function getAllSessions(limit = 50): LiveSession[] {
  return Array.from(sessions.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit);
}

export function updateSessionCounters(
  session_id: string,
  update: { submitted?: boolean; approved?: boolean; rejected?: boolean; pnl_delta?: number }
): void {
  const session = sessions.get(session_id);
  if (!session) return;

  if (update.submitted) session.orders_submitted++;
  if (update.approved) session.orders_approved++;
  if (update.rejected) session.orders_rejected++;
  if (update.pnl_delta !== undefined) session.realized_pnl += update.pnl_delta;
}

/** Clear sessions — used for testing */
export function _clearSessions(): void {
  sessions.clear();
}
