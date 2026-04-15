/**
 * Audit Logger — Persists every significant system event to the audit_events table.
 *
 * Events logged:
 * - signal_generated: A signal passed through the SI pipeline
 * - signal_rejected: A signal was blocked by a gate/veto
 * - trade_executed: An order was placed
 * - trade_closed: A position was closed
 * - kill_switch_toggled: Kill switch state changed
 * - breaker_escalated: Drawdown breaker level changed
 * - emergency_liquidation: Nuclear liquidation triggered
 * - session_started / session_ended: Trading session lifecycle
 * - config_changed: Risk config was modified
 * - execution_request_received / execution_idempotency / execution_gate_blocked / execution_result:
 *   full execution lifecycle trace
 */

import { logger } from "./logger";
import { db, auditEventsTable, breakerEventsTable } from "@workspace/db";
import { getSessionId } from "./session_manager";

// ── Types ─────────────────────────────────────────────

export type AuditEventType =
  | "signal_generated"
  | "signal_rejected"
  | "trade_executed"
  | "trade_closed"
  | "kill_switch_toggled"
  | "breaker_escalated"
  | "breaker_reset"
  | "emergency_liquidation"
  | "session_started"
  | "session_ended"
  | "config_changed"
  | "preflight_complete"
  | "degradation_change"
  | "execution_request_received"
  | "execution_idempotency"
  | "execution_gate_blocked"
  | "execution_result"
  // P1-10: fusion + explainability records persisted by order_executor.
  | "fusion_explain"
  // P1-8: Phase 103 reconciliation cron emits on critical drift.
  | "reconciliation_drift";

export type ExecutionLifecycleEventType =
  | "execution_request_received"
  | "execution_idempotency"
  | "execution_gate_blocked"
  | "execution_result";

export interface AuditEntry {
  event_type: AuditEventType;
  decision_state?: string;
  system_mode?: string;
  instrument?: string;
  setup_type?: string;
  symbol?: string;
  actor?: string;
  reason?: string;
  payload?: Record<string, unknown>;
}

// ── Core Logger ───────────────────────────────────────

/**
 * Write an audit event to the database. Non-blocking — failures are logged but don't throw.
 */
export async function logAuditEvent(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditEventsTable).values({
      event_type: entry.event_type,
      decision_state: entry.decision_state ?? null,
      system_mode: entry.system_mode ?? (process.env.GODSVIEW_SYSTEM_MODE || "paper"),
      instrument: entry.instrument ?? entry.symbol ?? null,
      setup_type: entry.setup_type ?? null,
      symbol: entry.symbol ?? null,
      actor: entry.actor ?? "system",
      reason: entry.reason ?? null,
      payload_json: entry.payload ? JSON.stringify(entry.payload) : null,
    });
  } catch (err: any) {
    logger.error(`Audit write failed: ${err.message}`);
  }
}

// ── Breaker Event Logger ──────────────────────────────

export interface BreakerEventEntry {
  level: string;
  previous_level?: string;
  trigger: string;
  daily_pnl?: number;
  consecutive_losses?: number;
  position_size_multiplier?: number;
  details?: string;
}

/**
 * Write a breaker state change to the breaker_events table.
 */
export async function logBreakerEvent(entry: BreakerEventEntry): Promise<void> {
  try {
    await db.insert(breakerEventsTable).values({
      session_id: getSessionId(),
      level: entry.level,
      previous_level: entry.previous_level ?? null,
      trigger: entry.trigger,
      daily_pnl: entry.daily_pnl !== undefined ? String(entry.daily_pnl) : null,
      consecutive_losses: entry.consecutive_losses ?? null,
      position_size_multiplier:
        entry.position_size_multiplier !== undefined
          ? String(entry.position_size_multiplier)
          : null,
      details: entry.details ?? null,
    });
  } catch (err: any) {
    logger.error(`Breaker event write failed: ${err.message}`);
  }
}

// ── Convenience Functions ─────────────────────────────

export async function auditSignalGenerated(
  instrument: string,
  setupType: string,
  finalQuality: number,
  scores: Record<string, number>,
): Promise<void> {
  await logAuditEvent({
    event_type: "signal_generated",
    decision_state: "accepted",
    instrument,
    setup_type: setupType,
    symbol: instrument,
    payload: { final_quality: finalQuality, ...scores },
  });
}

export async function auditSignalRejected(
  instrument: string,
  setupType: string,
  reason: string,
  gate: string,
): Promise<void> {
  await logAuditEvent({
    event_type: "signal_rejected",
    decision_state: "rejected",
    instrument,
    setup_type: setupType,
    symbol: instrument,
    reason,
    payload: { gate },
  });
}

export async function auditTradeExecuted(
  instrument: string,
  direction: string,
  quantity: number,
  entryPrice: number,
  orderId: string,
): Promise<void> {
  await logAuditEvent({
    event_type: "trade_executed",
    decision_state: "executed",
    instrument,
    symbol: instrument,
    payload: { direction, quantity, entry_price: entryPrice, order_id: orderId },
  });
}

export async function auditKillSwitch(active: boolean, actor: string): Promise<void> {
  await logAuditEvent({
    event_type: "kill_switch_toggled",
    decision_state: active ? "engaged" : "disengaged",
    actor,
    reason: active ? "Kill switch activated" : "Kill switch deactivated",
    payload: { active },
  });
}

export async function auditEmergencyLiquidation(triggeredBy: string): Promise<void> {
  await logAuditEvent({
    event_type: "emergency_liquidation",
    decision_state: "liquidating",
    actor: triggeredBy,
    reason: `Emergency liquidation triggered by ${triggeredBy}`,
  });
}

export async function auditBreakerEscalation(
  previousLevel: string,
  newLevel: string,
  trigger: string,
  dailyPnl: number,
  consecutiveLosses: number,
): Promise<void> {
  await logAuditEvent({
    event_type: "breaker_escalated",
    decision_state: newLevel,
    reason: `Breaker escalated: ${previousLevel} → ${newLevel} via ${trigger}`,
    payload: { previous_level: previousLevel, new_level: newLevel, trigger, daily_pnl: dailyPnl },
  });

  await logBreakerEvent({
    level: newLevel,
    previous_level: previousLevel,
    trigger,
    daily_pnl: dailyPnl,
    consecutive_losses: consecutiveLosses,
  });
}

export async function auditExecutionLifecycle(
  eventType: ExecutionLifecycleEventType,
  input: {
    symbol?: string;
    decision_state?: string;
    reason?: string;
    actor?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await logAuditEvent({
    event_type: eventType,
    decision_state: input.decision_state,
    symbol: input.symbol,
    instrument: input.symbol,
    actor: input.actor ?? "execution_router",
    reason: input.reason,
    payload: input.payload,
  });
}
