/**
 * Unified Risk Pipeline — Phase 3
 *
 * Pure function. No I/O, no clock, no broker calls.
 *
 * Evaluates an order request against a snapshot of system state and returns
 * a per-gate decision trail. The gates run in a fixed order and short-circuit
 * on the FIRST failure (fail-closed). Every gate decision is recorded for
 * the audit log, including bypassed gates.
 *
 * Stop-out exception: when `req.bypassReasons` includes "stop_out", the
 * `daily_loss_limit` and `max_exposure` gates are bypassed (with audit trail).
 * All other gates (system mode, kill switch, operator token, data staleness,
 * session, news lockout, order sanity) still apply — a stopped-out exit must
 * be allowed to fire even when daily loss is hit, but the system mode and
 * kill switch must still hold.
 */

import type { SystemMode } from "@workspace/strategy-core";
import { canWriteOrders } from "@workspace/strategy-core";

// ── Types ────────────────────────────────────────────────────────────────────

export type BypassReason = "stop_out";

export interface RiskRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  /** Short-circuit reasons, e.g. ["stop_out"] for forced exits. */
  bypassReasons?: ReadonlyArray<BypassReason>;
  /** Direction of the position being opened/closed. */
  direction: "long" | "short";
  /**
   * True when this request is closing an existing position (market exit).
   * For closes, order_sanity only requires qty > 0 and entry_price > 0;
   * stop_loss / take_profit are not meaningful for a market exit.
   */
  closing?: boolean;
}

export interface RiskSnapshot {
  systemMode: SystemMode;
  killSwitchActive: boolean;
  /** True if the request supplied a valid operator token (only checked in live mode). */
  operatorTokenValid: boolean;
  /** Age in ms of the latest market tick for the symbol. null if not measured. */
  dataAgeMs: number | null;
  maxDataAgeMs: number;
  /** True if the current trading session permits new orders. */
  sessionAllowed: boolean;
  /** Active session label (for audit). */
  activeSession: string;
  /** True if news lockout is active (env GODSVIEW_NEWS_LOCKOUT_ACTIVE; legacy
   *  hard-block path that applies to BOTH new entries and stop-out exits). */
  newsLockoutActive: boolean;
  /**
   * M5d-rng: macro-news-gate contribution for THIS request.
   *
   * Distinct from `newsLockoutActive`. When this is true, gate 6 BLOCKS the
   * request only when it is a NEW ENTRY (req.closing !== true and
   * bypassReasons does NOT include "stop_out"). Stop-out exits and explicit
   * close requests are allowed through — per M5d-rng scope: "Block ONLY new
   * entries; do NOT close existing positions."
   *
   * Producer: lib/risk/macro_news_gate.ts (consumes /api/macro-risk
   * news_window). Caller pre-filters by symbol via
   * evaluateMacroNewsGateForSymbol() before populating SnapshotInputs.
   */
  macroNewsBlockActive: boolean;
  /** Human-readable reason surfaced verbatim by gate 6 when this drives the
   *  block. Null when macroNewsBlockActive=false. */
  macroNewsBlockReason: string | null;
  /** Realized + open PnL today as a percentage of equity. Negative means loss. */
  dailyPnLPct: number;
  /** Maximum allowed daily loss as a percentage (positive number, e.g. 2 = 2%). */
  maxDailyLossPct: number;
  /** Number of currently open positions. */
  openPositionCount: number;
  maxConcurrentPositions: number;
  /** Number of trades opened today. */
  tradesTodayCount: number;
  maxTradesPerDay: number;
}

export type GateName =
  | "system_mode"
  | "kill_switch"
  | "operator_token"
  | "data_staleness"
  | "session"
  | "news_lockout"
  | "daily_loss_limit"
  | "max_exposure"
  | "order_sanity";

export interface GateDecision {
  gate: GateName;
  /** True iff the gate ALLOWED the request (counting bypass as allowed). */
  allowed: boolean;
  /** Human-readable detail. Always populated. */
  reason: string;
  /** True if the gate would have blocked but was bypassed by bypassReasons. */
  bypassed?: boolean;
}

export interface PipelineResult {
  allowed: boolean;
  decisions: GateDecision[];
  /** Set when allowed === false. */
  blockingGate?: GateName;
  blockingReason?: string;
}

// ── Bypass policy ────────────────────────────────────────────────────────────

const STOP_OUT_BYPASSABLE_GATES: ReadonlySet<GateName> = new Set([
  "daily_loss_limit",
  "max_exposure",
]);

// ── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Evaluate the unified risk pipeline. Pure: same inputs always produce the
 * same outputs.
 *
 * Gate order is fixed per Phase 3 spec:
 *   1. system_mode      — must be paper or live_enabled
 *   2. kill_switch      — must not be active
 *   3. operator_token   — required in live mode
 *   4. data_staleness   — latest tick must be ≤ maxDataAgeMs
 *   5. session          — current session must be allowed
 *   6. news_lockout     — must not be active
 *   7. daily_loss_limit — current loss must be < max (BYPASS for stop_out)
 *   8. max_exposure     — under concurrent + daily caps (BYPASS for stop_out)
 *   9. order_sanity     — qty/prices coherent for direction
 *
 * Short-circuits on first non-bypassed failure.
 */
export function evaluatePipeline(
  req: RiskRequest,
  snap: RiskSnapshot,
): PipelineResult {
  const decisions: GateDecision[] = [];
  const bypasses = new Set<BypassReason>(req.bypassReasons ?? []);
  const isStopOut = bypasses.has("stop_out");

  function record(gate: GateName, ok: boolean, reason: string): GateDecision {
    if (!ok && isStopOut && STOP_OUT_BYPASSABLE_GATES.has(gate)) {
      const d: GateDecision = {
        gate,
        allowed: true,
        bypassed: true,
        reason: `bypass:stop_out (${reason})`,
      };
      decisions.push(d);
      return d;
    }
    const d: GateDecision = { gate, allowed: ok, reason };
    decisions.push(d);
    return d;
  }

  function fail(d: GateDecision): PipelineResult {
    return {
      allowed: false,
      decisions,
      blockingGate: d.gate,
      blockingReason: d.reason,
    };
  }

  // 1. system_mode
  const modeOk = canWriteOrders(snap.systemMode);
  const d1 = record("system_mode", modeOk, `mode=${snap.systemMode}`);
  if (!d1.allowed) return fail(d1);

  // 2. kill_switch
  const d2 = record(
    "kill_switch",
    !snap.killSwitchActive,
    snap.killSwitchActive ? "kill_switch_active" : "kill_switch_clear",
  );
  if (!d2.allowed) return fail(d2);

  // 3. operator_token (only enforced in live mode)
  if (snap.systemMode === "live_enabled") {
    const d3 = record(
      "operator_token",
      snap.operatorTokenValid,
      snap.operatorTokenValid ? "token_valid" : "operator_token_required",
    );
    if (!d3.allowed) return fail(d3);
  } else {
    decisions.push({ gate: "operator_token", allowed: true, reason: "not_live_mode" });
  }

  // 4. data_staleness
  if (snap.dataAgeMs === null) {
    decisions.push({ gate: "data_staleness", allowed: true, reason: "no_data_check" });
  } else {
    const fresh = snap.dataAgeMs <= snap.maxDataAgeMs;
    const d4 = record(
      "data_staleness",
      fresh,
      fresh
        ? `age_ms=${snap.dataAgeMs}`
        : `data_stale: age_ms=${snap.dataAgeMs} > max=${snap.maxDataAgeMs}`,
    );
    if (!d4.allowed) return fail(d4);
  }

  // 5. session
  const d5 = record(
    "session",
    snap.sessionAllowed,
    snap.sessionAllowed ? `session=${snap.activeSession}` : `session_not_allowed:${snap.activeSession}`,
  );
  if (!d5.allowed) return fail(d5);

  // 6. news_lockout
  // Two contributions are OR'd:
  //   (a) snap.newsLockoutActive — env GODSVIEW_NEWS_LOCKOUT_ACTIVE. Legacy
  //       hard-block; applies to BOTH new entries and stop-out exits.
  //   (b) snap.macroNewsBlockActive — M5d-rng macro-news-gate. Applies ONLY
  //       to new entries. Stop-out exits and explicit close requests
  //       short-circuit this contribution.
  const isClosingOrStopOut = req.closing === true || isStopOut;
  const macroContributes = snap.macroNewsBlockActive && !isClosingOrStopOut;
  const newsBlocked = snap.newsLockoutActive || macroContributes;

  let newsReason: string;
  if (snap.newsLockoutActive) {
    // Legacy env-driven contribution wins for the reason — preserves the
    // pre-M5d-rng audit trail wording for that path.
    newsReason = "news_lockout_active";
  } else if (macroContributes) {
    // Macro-news drove the block. Surface the explicit reason so audit
    // logs and the m2 snapshot show WHY (which event, which window).
    newsReason = snap.macroNewsBlockReason ?? "macro_news_window_active";
  } else {
    newsReason = "no_news_lockout";
  }

  const d6 = record("news_lockout", !newsBlocked, newsReason);
  if (!d6.allowed) return fail(d6);

  // 7. daily_loss_limit (negative dailyPnLPct = loss)
  const lossPct = Math.max(0, -snap.dailyPnLPct);
  const lossOk = lossPct < snap.maxDailyLossPct;
  const d7 = record(
    "daily_loss_limit",
    lossOk,
    `loss_pct=${lossPct.toFixed(3)} max=${snap.maxDailyLossPct}`,
  );
  if (!d7.allowed) return fail(d7);

  // 8. max_exposure
  const concOk = snap.openPositionCount < snap.maxConcurrentPositions;
  const tradesOk = snap.tradesTodayCount < snap.maxTradesPerDay;
  const expOk = concOk && tradesOk;
  const d8 = record(
    "max_exposure",
    expOk,
    `open=${snap.openPositionCount}/${snap.maxConcurrentPositions} trades=${snap.tradesTodayCount}/${snap.maxTradesPerDay}`,
  );
  if (!d8.allowed) return fail(d8);

  // 9. order_sanity
  // For OPEN orders: qty>0, all prices>0, and (long: stop<entry<target; short: target<entry<stop).
  // For CLOSE orders: only qty>0 and entry_price>0 are required.
  let sane: boolean;
  if (req.closing) {
    sane = req.quantity > 0 && req.entry_price > 0;
  } else {
    sane = req.quantity > 0 && req.entry_price > 0 && req.stop_loss > 0 && req.take_profit > 0;
    if (sane) {
      if (req.direction === "long") {
        sane = req.stop_loss < req.entry_price && req.take_profit > req.entry_price;
      } else {
        sane = req.stop_loss > req.entry_price && req.take_profit < req.entry_price;
      }
    }
  }
  const d9 = record(
    "order_sanity",
    sane,
    sane
      ? "sanity_ok"
      : `bad_order: qty=${req.quantity} entry=${req.entry_price} stop=${req.stop_loss} tp=${req.take_profit} dir=${req.direction}`,
  );
  if (!d9.allowed) return fail(d9);

  return { allowed: true, decisions };
}

/** Short, structured summary of a PipelineResult for log/audit consumption. */
export function summarizePipeline(r: PipelineResult): {
  allowed: boolean;
  blockingGate?: GateName;
  blockingReason?: string;
  decisionCount: number;
  bypassedGates: GateName[];
} {
  return {
    allowed: r.allowed,
    blockingGate: r.blockingGate,
    blockingReason: r.blockingReason,
    decisionCount: r.decisions.length,
    bypassedGates: r.decisions.filter((d) => d.bypassed).map((d) => d.gate),
  };
}
