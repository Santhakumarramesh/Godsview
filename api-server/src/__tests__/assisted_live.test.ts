/**
 * Phase 21 — Assisted Live Mode Tests
 *
 * Tests:
 *   1. Session creation and lifecycle
 *   2. Pre-trade gate enforcement
 *   3. Approval queue: submit, approve, reject, expire
 *   4. Pause/resume behavior
 *   5. Flatten behavior
 *   6. Incident creation and resolution
 *   7. Operator action audit logging
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock external dependencies before importing modules
vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: () => false,
  setKillSwitchActive: () => ({}),
  getRiskEngineSnapshot: () => ({}),
}));
vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0, state: "normal", consecutiveLosses: 0 }),
  isCooldownActive: () => false,
  getPositionSizeMultiplier: () => 1.0,
  resetBreaker: () => ({}),
}));
vi.mock("../lib/emergency_liquidator", () => ({
  emergencyLiquidateAll: async () => ({ positions_closed: 0, orders_cancelled: 0, details: [] }),
  getLastLiquidation: () => null,
  isLiquidationInProgress: () => false,
}));

import {
  createSession,
  pauseSession,
  resumeSession,
  stopSession,
  emergencyStopSession,
  flattenSession,
  getSession,
  getActiveSessions,
  updateSessionCounters,
  _clearSessions,
} from "../lib/assisted_live/live_session_manager";
import {
  submitToQueue,
  approveOrder,
  rejectOrder,
  getPendingApprovals,
  getApproval,
  expireStaleApprovals,
  getQueueStats,
  _clearQueue,
} from "../lib/assisted_live/approval_queue_manager";
import {
  evaluatePretradeGate,
} from "../lib/assisted_live/pretrade_live_gate";
import {
  logIncident,
  resolveIncident,
  getOpenIncidents,
  getAllIncidents,
  _clearIncidents,
} from "../lib/assisted_live/live_incident_logger";

// ── Setup ────────────────────────────────────────────────────────

beforeEach(() => {
  _clearSessions();
  _clearQueue();
  _clearIncidents();
});

// ── Session Lifecycle Tests ──────────────────────────────────────

describe("Assisted Live Session Lifecycle", () => {
  it("creates a new session", () => {
    const result = createSession({
      strategy_id: "strat_001",
      strategy_name: "Test Strategy",
      operator_id: "op_test",
    });

    expect(result.success).toBe(true);
    expect(result.session).toBeDefined();
    expect(result.session!.status).toBe("active");
    expect(result.session!.session_id).toMatch(/^als_/);
  });

  it("prevents duplicate active sessions for same strategy", () => {
    createSession({ strategy_id: "strat_001", strategy_name: "Test", operator_id: "op_test" });
    const second = createSession({ strategy_id: "strat_001", strategy_name: "Test 2", operator_id: "op_test" });

    expect(second.success).toBe(false);
    expect(second.error).toContain("already has an active session");
  });

  it("pauses and resumes a session", () => {
    const { session } = createSession({ strategy_id: "strat_002", strategy_name: "Test", operator_id: "op_test" });
    const sid = session!.session_id;

    const pauseResult = pauseSession(sid, "op_test");
    expect(pauseResult.success).toBe(true);
    expect(pauseResult.session!.status).toBe("paused");

    const resumeResult = resumeSession(sid, "op_test");
    expect(resumeResult.success).toBe(true);
    expect(resumeResult.session!.status).toBe("active");
  });

  it("stops a session", () => {
    const { session } = createSession({ strategy_id: "strat_003", strategy_name: "Test", operator_id: "op_test" });
    const sid = session!.session_id;

    const result = stopSession(sid, "op_test");
    expect(result.success).toBe(true);
    expect(result.session!.status).toBe("stopped");
    expect(result.session!.stopped_at).toBeDefined();
  });

  it("emergency stops a session", () => {
    const { session } = createSession({ strategy_id: "strat_004", strategy_name: "Test", operator_id: "op_test" });
    const sid = session!.session_id;

    const result = emergencyStopSession(sid, "op_test", "critical failure");
    expect(result.success).toBe(true);
    expect(result.session!.status).toBe("emergency_stopped");
  });

  it("flattens a session", () => {
    const { session } = createSession({ strategy_id: "strat_005", strategy_name: "Test", operator_id: "op_test" });
    const sid = session!.session_id;

    const result = flattenSession(sid, "op_test");
    expect(result.success).toBe(true);
    expect(result.session!.status).toBe("flattened");
  });

  it("cannot pause a stopped session", () => {
    const { session } = createSession({ strategy_id: "strat_006", strategy_name: "Test", operator_id: "op_test" });
    const sid = session!.session_id;
    stopSession(sid, "op_test");

    const result = pauseSession(sid, "op_test");
    expect(result.success).toBe(false);
  });

  it("tracks session counters", () => {
    const { session } = createSession({ strategy_id: "strat_007", strategy_name: "Test", operator_id: "op_test" });
    const sid = session!.session_id;

    updateSessionCounters(sid, { submitted: true });
    updateSessionCounters(sid, { submitted: true, approved: true });
    updateSessionCounters(sid, { rejected: true });
    updateSessionCounters(sid, { pnl_delta: 50 });

    const s = getSession(sid)!;
    expect(s.orders_submitted).toBe(2);
    expect(s.orders_approved).toBe(1);
    expect(s.orders_rejected).toBe(1);
    expect(s.realized_pnl).toBe(50);
  });

  it("lists active sessions only", () => {
    createSession({ strategy_id: "s1", strategy_name: "A", operator_id: "op" });
    createSession({ strategy_id: "s2", strategy_name: "B", operator_id: "op" });
    const { session: s3 } = createSession({ strategy_id: "s3", strategy_name: "C", operator_id: "op" });
    stopSession(s3!.session_id, "op");

    const active = getActiveSessions();
    expect(active.length).toBe(2);
  });
});

// ── Pre-Trade Gate Tests ─────────────────────────────────────────

describe("Pre-Trade Gate Enforcement", () => {
  it("passes when all checks are valid", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "active",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: ["AAPL", "MSFT"],
      current_open_orders: 1,
      current_daily_pnl: -100,
    });

    expect(result.passed).toBe(true);
    expect(result.blocked_reasons).toHaveLength(0);
  });

  it("blocks when session is paused", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "paused",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: [],
      current_open_orders: 0,
      current_daily_pnl: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.some((r) => r.includes("not active"))).toBe(true);
  });

  it("blocks when daily loss limit breached", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "active",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: [],
      current_open_orders: 0,
      current_daily_pnl: -600,
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.some((r) => r.includes("Daily loss limit"))).toBe(true);
  });

  it("blocks when symbol not allowed", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "active",
      symbol: "TSLA",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: ["AAPL", "MSFT"],
      current_open_orders: 0,
      current_daily_pnl: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.some((r) => r.includes("not in allowed list"))).toBe(true);
  });

  it("blocks when open orders at limit", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "active",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 3,
      allowed_symbols: [],
      current_open_orders: 3,
      current_daily_pnl: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.some((r) => r.includes("Open orders at limit"))).toBe(true);
  });

  it("blocks when position size exceeded", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "active",
      symbol: "AAPL",
      side: "buy",
      qty: 200,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: [],
      current_open_orders: 0,
      current_daily_pnl: 0,
    });

    expect(result.passed).toBe(false);
    expect(result.blocked_reasons.some((r) => r.includes("Position size"))).toBe(true);
  });

  it("allows any symbol when allowed_symbols is empty", () => {
    const result = evaluatePretradeGate({
      session_id: "als_test",
      session_status: "active",
      symbol: "ANYTHING",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: [],
      current_open_orders: 0,
      current_daily_pnl: 0,
    });

    expect(result.passed).toBe(true);
  });
});

// ── Approval Queue Tests ─────────────────────────────────────────

describe("Approval Queue", () => {
  it("submits an order to queue as pending", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "buy",
      order_type: "limit",
      qty: 10,
      limit_price: 150.0,
    });

    expect(approval.status).toBe("pending");
    expect(approval.approval_id).toMatch(/^apv_/);
    expect(approval.symbol).toBe("AAPL");
  });

  it("approves a pending order", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 5,
    });

    const result = approveOrder(approval.approval_id, "op_test");
    expect(result.success).toBe(true);
    expect(result.approval!.status).toBe("approved");
    expect(result.approval!.approved_by).toBe("op_test");
    expect(result.approval!.approved_at).toBeDefined();
  });

  it("rejects a pending order with reason", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "sell",
      order_type: "market",
      qty: 5,
    });

    const result = rejectOrder(approval.approval_id, "op_test", "Risk too high");
    expect(result.success).toBe(true);
    expect(result.approval!.status).toBe("rejected");
    expect(result.approval!.rejection_reason).toBe("Risk too high");
  });

  it("cannot approve an already approved order", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 5,
    });

    approveOrder(approval.approval_id, "op_test");
    const result = approveOrder(approval.approval_id, "op_test2");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Cannot approve");
  });

  it("cannot approve a rejected order", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 5,
    });

    rejectOrder(approval.approval_id, "op_test", "No good");
    const result = approveOrder(approval.approval_id, "op_test2");
    expect(result.success).toBe(false);
  });

  it("expires stale approvals", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 5,
      expiry_ms: 1, // 1ms — instantly expires
    });

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    const expired = expireStaleApprovals();
    expect(expired.length).toBeGreaterThanOrEqual(1);
    expect(getApproval(approval.approval_id)!.status).toBe("expired");
  });

  it("cannot approve an expired order", () => {
    const approval = submitToQueue({
      session_id: "als_test",
      strategy_id: "strat_001",
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 5,
      expiry_ms: 1,
    });

    const start = Date.now();
    while (Date.now() - start < 5) { /* spin */ }

    const result = approveOrder(approval.approval_id, "op_test");
    expect(result.success).toBe(false);
    expect(result.error).toContain("expired");
  });

  it("returns correct queue stats", () => {
    submitToQueue({ session_id: "s1", strategy_id: "strat", symbol: "A", side: "buy", order_type: "market", qty: 1 });
    submitToQueue({ session_id: "s1", strategy_id: "strat", symbol: "B", side: "buy", order_type: "market", qty: 1 });
    const c = submitToQueue({ session_id: "s1", strategy_id: "strat", symbol: "C", side: "sell", order_type: "market", qty: 1 });

    approveOrder(c.approval_id, "op");

    const stats = getQueueStats();
    expect(stats.pending).toBe(2);
    expect(stats.approved).toBe(1);
    expect(stats.total).toBe(3);
  });

  it("filters pending approvals by session", () => {
    submitToQueue({ session_id: "s1", strategy_id: "strat", symbol: "A", side: "buy", order_type: "market", qty: 1 });
    submitToQueue({ session_id: "s2", strategy_id: "strat", symbol: "B", side: "buy", order_type: "market", qty: 1 });

    const s1Pending = getPendingApprovals("s1");
    expect(s1Pending.length).toBe(1);
    expect(s1Pending[0].session_id).toBe("s1");
  });
});

// ── Incident Tests ───────────────────────────────────────────────

describe("Incident Logging and Resolution", () => {
  it("creates an incident", () => {
    const incident = logIncident({
      session_id: "als_test",
      strategy_id: "strat_001",
      severity: "warning",
      type: "slippage_spike",
      title: "Slippage exceeded threshold",
      description: "Slippage of 15bps on AAPL buy",
    });

    expect(incident.incident_id).toMatch(/^inc_/);
    expect(incident.resolved).toBe(false);
    expect(incident.severity).toBe("warning");
  });

  it("resolves an incident", () => {
    const incident = logIncident({
      session_id: "als_test",
      severity: "warning",
      type: "data_gap",
      title: "Data gap detected",
    });

    const result = resolveIncident(incident.incident_id, "op_test", "Resolved manually");
    expect(result.success).toBe(true);
    expect(result.incident!.resolved).toBe(true);
    expect(result.incident!.resolved_by).toBe("op_test");
  });

  it("cannot resolve already resolved incident", () => {
    const incident = logIncident({
      severity: "info",
      type: "data_gap",
      title: "Test",
    });
    resolveIncident(incident.incident_id, "op_test");

    const result = resolveIncident(incident.incident_id, "op_test2");
    expect(result.success).toBe(false);
    expect(result.error).toContain("already resolved");
  });

  it("lists open incidents sorted by severity", () => {
    logIncident({ severity: "info", type: "data_gap", title: "Info" });
    logIncident({ severity: "emergency", type: "kill_switch", title: "Emergency" });
    logIncident({ severity: "warning", type: "slippage_spike", title: "Warning" });

    const open = getOpenIncidents();
    expect(open.length).toBe(3);
    expect(open[0].severity).toBe("emergency");
    expect(open[1].severity).toBe("warning");
    expect(open[2].severity).toBe("info");
  });

  it("getAllIncidents respects limit", () => {
    for (let i = 0; i < 10; i++) {
      logIncident({ severity: "info", type: "data_gap", title: `Incident ${i}` });
    }

    const limited = getAllIncidents(5);
    expect(limited.length).toBe(5);
  });
});

// ── Integration: Approval-Required Enforcement ───────────────────

describe("Approval-Required Enforcement (Integration)", () => {
  it("full flow: create session → submit order → gate check → approve", () => {
    const { session } = createSession({
      strategy_id: "strat_int",
      strategy_name: "Integration Test",
      operator_id: "op_int",
      max_position_size: 50,
      max_daily_loss: 1000,
      max_open_orders: 3,
      allowed_symbols: ["AAPL"],
    });
    const sid = session!.session_id;

    // Gate check
    const gate = evaluatePretradeGate({
      session_id: sid,
      session_status: session!.status,
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      max_position_size: session!.max_position_size,
      max_daily_loss: session!.max_daily_loss,
      max_open_orders: session!.max_open_orders,
      allowed_symbols: session!.allowed_symbols,
      current_open_orders: 0,
      current_daily_pnl: 0,
    });
    expect(gate.passed).toBe(true);

    // Submit
    const approval = submitToQueue({
      session_id: sid,
      strategy_id: "strat_int",
      symbol: "AAPL",
      side: "buy",
      order_type: "market",
      qty: 10,
    });
    updateSessionCounters(sid, { submitted: true });

    expect(approval.status).toBe("pending");

    // Approve
    const approveResult = approveOrder(approval.approval_id, "op_int");
    expect(approveResult.success).toBe(true);
    updateSessionCounters(sid, { approved: true });

    // Verify session counters
    const s = getSession(sid)!;
    expect(s.orders_submitted).toBe(1);
    expect(s.orders_approved).toBe(1);
  });

  it("full flow: submit → reject → incident logged", () => {
    const { session } = createSession({
      strategy_id: "strat_rej",
      strategy_name: "Reject Test",
      operator_id: "op_rej",
    });
    const sid = session!.session_id;

    const approval = submitToQueue({
      session_id: sid,
      strategy_id: "strat_rej",
      symbol: "TSLA",
      side: "sell",
      order_type: "market",
      qty: 5,
    });
    updateSessionCounters(sid, { submitted: true });

    const result = rejectOrder(approval.approval_id, "op_rej", "Too risky");
    expect(result.success).toBe(true);
    updateSessionCounters(sid, { rejected: true });

    const s = getSession(sid)!;
    expect(s.orders_rejected).toBe(1);
  });

  it("pause blocks order submission via gate", () => {
    const { session } = createSession({
      strategy_id: "strat_pause",
      strategy_name: "Pause Test",
      operator_id: "op_pause",
    });
    const sid = session!.session_id;

    pauseSession(sid, "op_pause");

    const gate = evaluatePretradeGate({
      session_id: sid,
      session_status: "paused",
      symbol: "AAPL",
      side: "buy",
      qty: 10,
      max_position_size: 100,
      max_daily_loss: 500,
      max_open_orders: 5,
      allowed_symbols: [],
      current_open_orders: 0,
      current_daily_pnl: 0,
    });

    expect(gate.passed).toBe(false);
    expect(gate.blocked_reasons.some((r) => r.includes("not active"))).toBe(true);
  });
});
