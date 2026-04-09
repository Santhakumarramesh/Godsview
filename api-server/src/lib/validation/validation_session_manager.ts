/**
 * Phase 27 — Production Validation Backbone
 * Validation Session Manager
 *
 * Manages validation sessions for paper/live-shadow validation runs.
 * Tracks per-session metrics, validation reports, and readiness evidence.
 */

import crypto from "crypto";

// ── Types ────────────────────────────────────────────────────────────────

export type ValidationSessionType = "paper" | "live_shadow" | "backtest_replay";
export type ValidationSessionStatus =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "aborted";

export interface ValidationSessionConfig {
  strategy_id: string;
  strategy_name: string;
  session_type: ValidationSessionType;
  symbols: string[];
  timeframe: string;
  capital_allocation: number;
  duration_minutes?: number;
  operator_id?: string;
  metadata?: Record<string, unknown>;
}

export interface ValidationMetrics {
  total_signals: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  hit_rate: number;
  realized_pnl: number;
  unrealized_pnl: number;
  max_intraday_drawdown: number;
  avg_slippage_bps: number;
  expected_slippage_bps: number;
  signal_to_fill_delay_ms: number;
  reject_rate: number;
  rejected_signals: number;
  pnl_by_regime: Record<string, number>;
  pnl_by_symbol: Record<string, number>;
}

export interface ValidationSession {
  session_id: string;
  strategy_id: string;
  strategy_name: string;
  session_type: ValidationSessionType;
  status: ValidationSessionStatus;
  symbols: string[];
  timeframe: string;
  capital_allocation: number;
  duration_minutes: number;
  operator_id: string;
  metrics: ValidationMetrics;
  events: ValidationEvent[];
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
  metadata: Record<string, unknown>;
}

export interface ValidationEvent {
  event_id: string;
  session_id: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

// ── Default Metrics ──────────────────────────────────────────────────────

function defaultMetrics(): ValidationMetrics {
  return {
    total_signals: 0,
    total_trades: 0,
    winning_trades: 0,
    losing_trades: 0,
    hit_rate: 0,
    realized_pnl: 0,
    unrealized_pnl: 0,
    max_intraday_drawdown: 0,
    avg_slippage_bps: 0,
    expected_slippage_bps: 0,
    signal_to_fill_delay_ms: 0,
    reject_rate: 0,
    rejected_signals: 0,
    pnl_by_regime: {},
    pnl_by_symbol: {},
  };
}

// ── Store ────────────────────────────────────────────────────────────────

const sessions = new Map<string, ValidationSession>();

function generateId(): string {
  return `pv_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ── Session Lifecycle ────────────────────────────────────────────────────

export function createValidationSession(
  config: ValidationSessionConfig
): { success: boolean; session?: ValidationSession; error?: string } {
  // Check for active sessions on same strategy+type
  for (const s of sessions.values()) {
    if (
      s.strategy_id === config.strategy_id &&
      s.session_type === config.session_type &&
      s.status === "active"
    ) {
      return {
        success: false,
        error: `Active ${config.session_type} validation session already exists for strategy ${config.strategy_id}`,
      };
    }
  }

  const session: ValidationSession = {
    session_id: generateId(),
    strategy_id: config.strategy_id,
    strategy_name: config.strategy_name,
    session_type: config.session_type,
    status: "pending",
    symbols: config.symbols,
    timeframe: config.timeframe,
    capital_allocation: config.capital_allocation,
    duration_minutes: config.duration_minutes ?? 60,
    operator_id: config.operator_id ?? "system",
    metrics: defaultMetrics(),
    events: [],
    created_at: new Date(),
    started_at: null,
    completed_at: null,
    metadata: config.metadata ?? {},
  };

  sessions.set(session.session_id, session);
  return { success: true, session };
}

export function startValidationSession(
  session_id: string
): { success: boolean; session?: ValidationSession; error?: string } {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status !== "pending")
    return { success: false, error: `Cannot start session in status: ${session.status}` };

  session.status = "active";
  session.started_at = new Date();
  return { success: true, session };
}

export function completeValidationSession(
  session_id: string
): { success: boolean; session?: ValidationSession; error?: string } {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status !== "active")
    return { success: false, error: `Cannot complete session in status: ${session.status}` };

  // Compute final hit rate
  if (session.metrics.total_trades > 0) {
    session.metrics.hit_rate =
      session.metrics.winning_trades / session.metrics.total_trades;
  }
  if (session.metrics.total_signals > 0) {
    session.metrics.reject_rate =
      session.metrics.rejected_signals / session.metrics.total_signals;
  }

  session.status = "completed";
  session.completed_at = new Date();
  return { success: true, session };
}

export function abortValidationSession(
  session_id: string,
  reason: string
): { success: boolean; session?: ValidationSession; error?: string } {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status === "completed" || session.status === "aborted")
    return { success: false, error: `Cannot abort session in status: ${session.status}` };

  session.status = "aborted";
  session.completed_at = new Date();
  addValidationEvent(session_id, "session_aborted", "warning", reason);
  return { success: true, session };
}

// ── Metrics Recording ────────────────────────────────────────────────────

export interface TradeRecord {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entry_price: number;
  exit_price?: number;
  pnl?: number;
  slippage_bps: number;
  expected_slippage_bps: number;
  signal_to_fill_ms: number;
  regime?: string;
  rejected: boolean;
}

export function recordTrade(
  session_id: string,
  trade: TradeRecord
): { success: boolean; error?: string } {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };
  if (session.status !== "active")
    return { success: false, error: "Session is not active" };

  const m = session.metrics;
  m.total_signals++;

  if (trade.rejected) {
    m.rejected_signals++;
    return { success: true };
  }

  m.total_trades++;
  if (trade.pnl !== undefined) {
    if (trade.pnl > 0) m.winning_trades++;
    else m.losing_trades++;
    m.realized_pnl += trade.pnl;

    // Update PnL by symbol
    m.pnl_by_symbol[trade.symbol] =
      (m.pnl_by_symbol[trade.symbol] ?? 0) + trade.pnl;

    // Update PnL by regime
    if (trade.regime) {
      m.pnl_by_regime[trade.regime] =
        (m.pnl_by_regime[trade.regime] ?? 0) + trade.pnl;
    }
  }

  // Rolling average slippage
  const prevTotal = m.avg_slippage_bps * (m.total_trades - 1);
  m.avg_slippage_bps = (prevTotal + trade.slippage_bps) / m.total_trades;

  // Rolling expected slippage
  const prevExpTotal = m.expected_slippage_bps * (m.total_trades - 1);
  m.expected_slippage_bps =
    (prevExpTotal + trade.expected_slippage_bps) / m.total_trades;

  // Rolling signal-to-fill delay
  const prevDelay = m.signal_to_fill_delay_ms * (m.total_trades - 1);
  m.signal_to_fill_delay_ms =
    (prevDelay + trade.signal_to_fill_ms) / m.total_trades;

  // Update max drawdown (simplified: track cumulative PnL low)
  const currentDD = Math.min(0, m.realized_pnl);
  if (Math.abs(currentDD) > Math.abs(m.max_intraday_drawdown)) {
    m.max_intraday_drawdown = currentDD;
  }

  // Recompute rates
  if (m.total_trades > 0) {
    m.hit_rate = m.winning_trades / m.total_trades;
  }
  if (m.total_signals > 0) {
    m.reject_rate = m.rejected_signals / m.total_signals;
  }

  return { success: true };
}

// ── Events ───────────────────────────────────────────────────────────────

export function addValidationEvent(
  session_id: string,
  event_type: string,
  severity: "info" | "warning" | "critical",
  message: string,
  data?: Record<string, unknown>
): { success: boolean; error?: string } {
  const session = sessions.get(session_id);
  if (!session) return { success: false, error: "Session not found" };

  session.events.push({
    event_id: `pve_${crypto.randomBytes(6).toString("hex")}`,
    session_id,
    event_type,
    severity,
    message,
    data,
    timestamp: new Date(),
  });
  return { success: true };
}

// ── Queries ──────────────────────────────────────────────────────────────

export function getSession(session_id: string): ValidationSession | undefined {
  return sessions.get(session_id);
}

export function getSessionsByStrategy(strategy_id: string): ValidationSession[] {
  return Array.from(sessions.values())
    .filter((s) => s.strategy_id === strategy_id)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export function getActiveSessions(): ValidationSession[] {
  return Array.from(sessions.values()).filter((s) => s.status === "active");
}

export function getAllSessions(limit = 50): ValidationSession[] {
  return Array.from(sessions.values())
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
    .slice(0, limit);
}

// ── Testing ──────────────────────────────────────────────────────────────

export function _clearSessions(): void {
  sessions.clear();
}
