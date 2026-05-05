/**
 * Phase 3 Audit Log Helper.
 *
 * Records every order attempt with: audit_id, timestamp, full input payload,
 * every gate decision (allowed/blocked/bypassed), final decision, blocking
 * gate, fallback usage, and bypass reasons. Persists via existing
 * persistAppend("execution_audit", ...). Also emits structured logs.
 *
 * Even REJECTED trades are written. The audit is the source of truth.
 */

import { logger } from "../logger.js";
import { persistAppend } from "../persistent_store.js";
import type { GateDecision, GateName, PipelineResult, RiskRequest, RiskSnapshot } from "./risk_pipeline.js";

export type AuditOutcome =
  | "accepted_executed"
  | "rejected_by_gate"
  | "broker_error"
  | "validation_error"
  | "fallback_close_position";

export interface ExecutionAuditEntry {
  audit_id: string;
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  direction: "long" | "short";
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  closing: boolean;
  bypass_reasons: ReadonlyArray<string>;
  outcome: AuditOutcome;
  blocking_gate: GateName | null;
  blocking_reason: string | null;
  /** True if Phase 3 last-resort fallback path (closePosition DELETE /v2/positions) ran. */
  fallback_used: boolean;
  /** When fallback_used=true, this is the gate that triggered the fallback. */
  original_blocking_gate: GateName | null;
  broker_order_id: string | null;
  broker_error: string | null;
  /** "high" for fallback events; "normal" otherwise. */
  priority: "normal" | "high";
  gate_decisions: GateDecision[];
  snapshot: {
    system_mode: string;
    kill_switch_active: boolean;
    data_age_ms: number | null;
    session: string;
    news_lockout: boolean;
    daily_pnl_pct: number;
    open_positions: number;
    trades_today: number;
  };
}

let auditCounter = 0;
function nextAuditId(): string {
  auditCounter += 1;
  return `audit_${Date.now()}_${auditCounter}`;
}

export function recordExecutionAudit(params: {
  req: RiskRequest;
  snap: RiskSnapshot;
  pipeline: PipelineResult;
  outcome: AuditOutcome;
  brokerOrderId?: string | null;
  brokerError?: string | null;
  fallbackUsed?: boolean;
  originalBlockingGate?: GateName | null;
}): ExecutionAuditEntry {
  const isFallback = params.outcome === "fallback_close_position" || params.fallbackUsed === true;
  const entry: ExecutionAuditEntry = {
    audit_id: nextAuditId(),
    timestamp: new Date().toISOString(),
    symbol: params.req.symbol,
    side: params.req.side,
    direction: params.req.direction,
    quantity: params.req.quantity,
    entry_price: params.req.entry_price,
    stop_loss: params.req.stop_loss,
    take_profit: params.req.take_profit,
    closing: params.req.closing === true,
    bypass_reasons: params.req.bypassReasons ?? [],
    outcome: params.outcome,
    blocking_gate: params.pipeline.blockingGate ?? null,
    blocking_reason: params.pipeline.blockingReason ?? null,
    fallback_used: isFallback,
    original_blocking_gate: params.originalBlockingGate ?? null,
    broker_order_id: params.brokerOrderId ?? null,
    broker_error: params.brokerError ?? null,
    priority: isFallback ? "high" : "normal",
    gate_decisions: params.pipeline.decisions,
    snapshot: {
      system_mode: params.snap.systemMode,
      kill_switch_active: params.snap.killSwitchActive,
      data_age_ms: params.snap.dataAgeMs,
      session: params.snap.activeSession,
      news_lockout: params.snap.newsLockoutActive,
      daily_pnl_pct: params.snap.dailyPnLPct,
      open_positions: params.snap.openPositionCount,
      trades_today: params.snap.tradesTodayCount,
    },
  };

  // Persist (best-effort; do not throw on persistence failure)
  try {
    persistAppend("execution_audit", entry as unknown as Record<string, unknown>, 50_000);
  } catch (err) {
    logger.warn({ err, audit_id: entry.audit_id }, "execution audit persist failed");
  }

  // Structured log line. Fallback events are escalated to ERROR with the high
  // priority tag so they trip ops alerts.
  const line = {
    audit_id: entry.audit_id,
    symbol: entry.symbol,
    outcome: entry.outcome,
    blocking_gate: entry.blocking_gate,
    blocking_reason: entry.blocking_reason,
    fallback_used: entry.fallback_used,
    original_blocking_gate: entry.original_blocking_gate,
    bypass: entry.bypass_reasons,
    priority: entry.priority,
    decisions: entry.gate_decisions.map((d) => ({ gate: d.gate, allowed: d.allowed, bypassed: d.bypassed ?? false })),
  };
  if (entry.priority === "high") {
    logger.error(line, "[execution_audit][HIGH_PRIORITY] fallback path used");
  } else {
    logger.info(line, "[execution_audit]");
  }

  return entry;
}
