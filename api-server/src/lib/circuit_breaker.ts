/**
 * circuit_breaker.ts — Automated Capital-Protection Circuit Breaker
 *
 * Monitors realised P&L from the trade journal and automatically engages
 * the kill switch when configurable safety thresholds are breached:
 *
 *   1. Daily Loss Limit      — total session P&L < -maxDailyLossPct
 *   2. Consecutive Losses    — N sequential losing trades
 *   3. Max Drawdown Guard    — current drawdown > maxDrawdownPct (from equity curve)
 *
 * When tripped, the circuit breaker:
 *   - Calls activateKillSwitch() on the risk engine
 *   - Broadcasts an SSE "circuit_breaker" alert
 *   - Records the trip event with full context
 *   - Schedules auto-reset at the next trading session open (configurable)
 *
 * Env vars:
 *   CB_MAX_DAILY_LOSS_PCT      — daily loss % threshold (default 0.02 = 2%)
 *   CB_MAX_CONSECUTIVE_LOSSES  — consecutive loss count (default 4)
 *   CB_MAX_DRAWDOWN_PCT        — drawdown % threshold (default 0.05 = 5%)
 *   CB_AUTO_RESET_HOURS        — hours until auto-reset (default 4; 0 = manual only)
 */

import { listJournalEntries } from "./trade_journal";
import { setKillSwitchActive } from "./risk_engine";
import { publishAlert } from "./signal_stream";
import { logger as _logger } from "./logger";

const logger = _logger.child({ module: "circuit_breaker" });

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_DAILY_LOSS_PCT     = parseFloat(process.env.CB_MAX_DAILY_LOSS_PCT     ?? "0.02");  // 2%
const MAX_CONSECUTIVE_LOSSES = parseInt( process.env.CB_MAX_CONSECUTIVE_LOSSES  ?? "4", 10); // 4 in a row
const MAX_DRAWDOWN_PCT       = parseFloat(process.env.CB_MAX_DRAWDOWN_PCT       ?? "0.05");  // 5%
const AUTO_RESET_HOURS       = parseFloat(process.env.CB_AUTO_RESET_HOURS       ?? "4");     // 4h

// ─── Types ────────────────────────────────────────────────────────────────────

export type TripReason =
  | "daily_loss_limit"
  | "consecutive_losses"
  | "max_drawdown"
  | "manual";

export interface CircuitBreakerTripEvent {
  id:           string;
  reason:       TripReason;
  detail:       string;
  /** Fraction at time of trip (negative = loss) */
  triggeredAt:  string;
  value:        number;
  threshold:    number;
  autoResetAt:  string | null;
  /** Whether the CB was already armed before this trip */
  wasAlreadyTripped: boolean;
}

export interface CircuitBreakerStatus {
  armed:              boolean;
  trippedAt:          string | null;
  lastTripReason:     TripReason | null;
  lastTripDetail:     string | null;
  autoResetAt:        string | null;
  tripCount:          number;
  lastCheckedAt:      string;
  config: {
    maxDailyLossPct:     number;
    maxConsecutiveLosses: number;
    maxDrawdownPct:      number;
    autoResetHours:      number;
  };
  todayStats: {
    sessionPnlPct:       number;
    consecutiveLosses:   number;
    currentDrawdownPct:  number;
  };
}

// ─── State ────────────────────────────────────────────────────────────────────

let _armed         = false;
let _trippedAt:     string | null = null;
let _lastReason:    TripReason | null = null;
let _lastDetail:    string | null = null;
let _autoResetAt:   string | null = null;
let _tripCount      = 0;
let _lastCheckedAt  = new Date().toISOString();
let _resetTimer:    ReturnType<typeof setTimeout> | null = null;

const _tripHistory: CircuitBreakerTripEvent[] = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns today's realised session P&L (sum of all pnlPct for today's closed trades). */
function getTodaySessionPnl(): number {
  const today = todayIso();
  return listJournalEntries({ limit: 0 })
    .filter(e => e.pnlPct !== null && e.decidedAt.startsWith(today))
    .reduce((sum, e) => sum + e.pnlPct!, 0);
}

/** Returns current consecutive loss count (scanning backwards from most recent). */
function getConsecutiveLosses(): number {
  const sorted = listJournalEntries({ limit: 0 })
    .filter(e => e.outcome !== "unknown")
    .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  let count = 0;
  for (const e of sorted) {
    if (e.outcome === "loss") count++;
    else break;
  }
  return count;
}

/** Returns current drawdown from journal equity. */
function getCurrentDrawdownPct(): number {
  const pnls = listJournalEntries({ limit: 0 })
    .filter(e => e.pnlPct !== null)
    .sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))
    .map(e => e.pnlPct!);

  if (!pnls.length) return 0;
  let equity = 1;
  let peak   = 1;
  let maxDD  = 0;
  for (const r of pnls) {
    equity = equity * (1 + r);
    peak   = Math.max(peak, equity);
    const dd = (equity - peak) / peak;
    maxDD  = Math.min(maxDD, dd);
  }
  // current drawdown = last value
  const finalEquity = pnls.reduce((e, r) => e * (1 + r), 1);
  const finalPeak   = pnls.reduce(([e, pk], r) => { const ne = e * (1 + r); return [ne, Math.max(pk, ne)]; }, [1, 1] as [number, number])[1];
  return finalPeak > 0 ? (finalEquity - finalPeak) / finalPeak : 0;
}

// ─── Trip & Reset ─────────────────────────────────────────────────────────────

function trip(reason: TripReason, detail: string, value: number, threshold: number): void {
  const wasAlready = _armed;
  _armed       = true;
  _trippedAt   = new Date().toISOString();
  _lastReason  = reason;
  _lastDetail  = detail;
  _tripCount++;

  const autoResetAt = AUTO_RESET_HOURS > 0
    ? new Date(Date.now() + AUTO_RESET_HOURS * 3600_000).toISOString()
    : null;
  _autoResetAt = autoResetAt;

  const event: CircuitBreakerTripEvent = {
    id: `cb_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    reason, detail, triggeredAt: _trippedAt,
    value, threshold, autoResetAt,
    wasAlreadyTripped: wasAlready,
  };
  _tripHistory.unshift(event);
  if (_tripHistory.length > 50) _tripHistory.pop();

  // Engage kill switch
  setKillSwitchActive(true);

  // Broadcast SSE alert
  publishAlert({
    type:   "circuit_breaker",
    data: { reason, detail, value, threshold, trippedAt: _trippedAt, autoResetAt },
  });

  logger.warn({ reason, detail, value, threshold }, "[CB] Circuit breaker TRIPPED — kill switch engaged");

  // Schedule auto-reset
  if (_resetTimer) clearTimeout(_resetTimer);
  if (AUTO_RESET_HOURS > 0) {
    _resetTimer = setTimeout(() => reset("auto_reset"), AUTO_RESET_HOURS * 3600_000);
  }
}

function reset(source: "manual" | "auto_reset"): void {
  if (!_armed) return;
  if (_resetTimer) { clearTimeout(_resetTimer); _resetTimer = null; }
  _armed      = false;
  _trippedAt  = null;
  _lastReason = null;
  _lastDetail = null;
  _autoResetAt = null;

  setKillSwitchActive(false);
  publishAlert({ type: "circuit_breaker_reset", data: { source, resetAt: new Date().toISOString() } });
  logger.info({ source }, "[CB] Circuit breaker RESET — kill switch released");
}

// ─── Check ────────────────────────────────────────────────────────────────────

/**
 * Run a full check against current P&L state.
 * Called by the scanner after each cycle and by the analytics route on demand.
 */
export function checkCircuitBreaker(): CircuitBreakerStatus {
  _lastCheckedAt = new Date().toISOString();

  const sessionPnlPct      = getTodaySessionPnl();
  const consecutiveLosses  = getConsecutiveLosses();
  const currentDrawdownPct = Math.abs(getCurrentDrawdownPct());

  if (!_armed) {
    // Daily loss limit
    if (sessionPnlPct < -MAX_DAILY_LOSS_PCT) {
      trip(
        "daily_loss_limit",
        `Session P&L ${(sessionPnlPct * 100).toFixed(2)}% breached limit of -${(MAX_DAILY_LOSS_PCT * 100).toFixed(2)}%`,
        sessionPnlPct, -MAX_DAILY_LOSS_PCT,
      );
    }
    // Consecutive losses
    else if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
      trip(
        "consecutive_losses",
        `${consecutiveLosses} consecutive losing trades (limit: ${MAX_CONSECUTIVE_LOSSES})`,
        consecutiveLosses, MAX_CONSECUTIVE_LOSSES,
      );
    }
    // Drawdown guard
    else if (currentDrawdownPct > MAX_DRAWDOWN_PCT) {
      trip(
        "max_drawdown",
        `Current drawdown ${(currentDrawdownPct * 100).toFixed(2)}% exceeds ${(MAX_DRAWDOWN_PCT * 100).toFixed(2)}% limit`,
        currentDrawdownPct, MAX_DRAWDOWN_PCT,
      );
    }
  }

  return buildStatus(sessionPnlPct, consecutiveLosses, currentDrawdownPct);
}

function buildStatus(
  sessionPnlPct: number,
  consecutiveLosses: number,
  currentDrawdownPct: number,
): CircuitBreakerStatus {
  return {
    armed:          _armed,
    trippedAt:      _trippedAt,
    lastTripReason: _lastReason,
    lastTripDetail: _lastDetail,
    autoResetAt:    _autoResetAt,
    tripCount:      _tripCount,
    lastCheckedAt:  _lastCheckedAt,
    config: {
      maxDailyLossPct:      MAX_DAILY_LOSS_PCT,
      maxConsecutiveLosses: MAX_CONSECUTIVE_LOSSES,
      maxDrawdownPct:       MAX_DRAWDOWN_PCT,
      autoResetHours:       AUTO_RESET_HOURS,
    },
    todayStats: { sessionPnlPct, consecutiveLosses, currentDrawdownPct },
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function getCircuitBreakerStatus(): CircuitBreakerStatus {
  const s = getTodaySessionPnl();
  const c = getConsecutiveLosses();
  const d = Math.abs(getCurrentDrawdownPct());
  return buildStatus(s, c, d);
}

export function isCircuitBreakerArmed(): boolean {
  return _armed;
}

export function resetCircuitBreaker(): CircuitBreakerStatus {
  reset("manual");
  return getCircuitBreakerStatus();
}

export function getTripHistory(): CircuitBreakerTripEvent[] {
  return [..._tripHistory];
}

/** Force-trip for testing or manual emergency halt. */
export function manualTrip(reason: string): CircuitBreakerStatus {
  trip("manual", reason || "Manual emergency halt", 0, 0);
  return getCircuitBreakerStatus();
}
