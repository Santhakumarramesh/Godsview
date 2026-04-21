/**
 * Trading Session Manager — Tracks the lifecycle of each trading session.
 *
 * A "session" begins when the operator starts GodsView for active trading
 * and ends on graceful shutdown, kill switch, or manual close.
 *
 * Persists to trading_sessions table for post-mortem analysis.
 */

import { logger } from "./logger";
import { db, tradingSessionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getBreakerSnapshot } from "./drawdown_breaker";
import { isKillSwitchActive } from "./risk_engine";
import crypto from "crypto";

// ── Types ─────────────────────────────────────────────

export interface ActiveSession {
  session_id: string;
  system_mode: string;
  operator_id: string | null;
  started_at: Date;
  trades_executed: number;
  signals_generated: number;
}

// ── State ─────────────────────────────────────────────

let activeSession: ActiveSession | null = null;

// ── Public API ────────────────────────────────────────

/**
 * Start a new trading session. Persists to DB immediately.
 */
export async function startSession(
  systemMode: string,
  operatorId?: string,
): Promise<ActiveSession> {
  if (activeSession) {
    logger.warn({ existing: activeSession.session_id }, "Session already active — closing first");
    await endSession("replaced_by_new_session");
  }

  const sessionId = `gs-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;

  activeSession = {
    session_id: sessionId,
    system_mode: systemMode,
    operator_id: operatorId ?? null,
    started_at: new Date(),
    trades_executed: 0,
    signals_generated: 0,
  };

  try {
    await db.insert(tradingSessionsTable).values({
      session_id: sessionId,
      system_mode: systemMode,
      operator_id: operatorId ?? null,
      started_at: activeSession.started_at,
    });
  } catch (err: any) {
    logger.error(`Failed to persist session start: ${err.message}`);
  }

  logger.info({ session_id: sessionId, system_mode: systemMode }, "Trading session started");
  return activeSession;
}

/**
 * End the current session with a snapshot of final metrics.
 */
export async function endSession(exitReason: string): Promise<void> {
  if (!activeSession) {
    logger.warn("No active session to end");
    return;
  }

  const breaker = getBreakerSnapshot();

  try {
    await db
      .update(tradingSessionsTable)
      .set({
        ended_at: new Date(),
        trades_executed: activeSession.trades_executed,
        signals_generated: activeSession.signals_generated,
        realized_pnl: String(breaker.realized_pnl_today),
        peak_drawdown_pct: String(breaker.max_drawdown_pct),
        breaker_triggered: breaker.level !== "NORMAL",
        kill_switch_used: isKillSwitchActive(),
        exit_reason: exitReason,
      })
      .where(eq(tradingSessionsTable.session_id, activeSession.session_id));
  } catch (err: any) {
    logger.error(`Failed to persist session end: ${err.message}`);
  }

  logger.info(
    {
      session_id: activeSession.session_id,
      exit_reason: exitReason,
      trades: activeSession.trades_executed,
      signals: activeSession.signals_generated,
      pnl: breaker.realized_pnl_today,
    },
    "Trading session ended",
  );

  activeSession = null;
}

/**
 * Increment trade counter for the active session.
 */
export function recordTradeExecuted(): void {
  if (activeSession) activeSession.trades_executed++;
}

/**
 * Increment signal counter for the active session.
 */
export function recordSignalGenerated(): void {
  if (activeSession) activeSession.signals_generated++;
}

/**
 * Get the current active session (null if none).
 */
export function getActiveSession(): ActiveSession | null {
  return activeSession ? { ...activeSession } : null;
}

/**
 * Get the current session ID (for linking audit/breaker events).
 */
export function getSessionId(): string | null {
  return activeSession?.session_id ?? null;
}
