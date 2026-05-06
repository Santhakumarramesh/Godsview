/**
 * m2_pipeline.test.ts — Milestone 2 pipeline coverage.
 *
 * Tests the PURE pieces of the pipeline directly (no network, no DB), then
 * verifies the execution-attempt path injects through executeOrder() and
 * does NOT bypass it.
 *
 * No HTTP self-loop. No real broker. No fixtures with Math.random.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  alpacaBarToStrategyBar,
  buildChartPayload,
  runPipelineEvaluation,
  attemptExecution,
  resetPipelineSnapshot,
  getPipelineSnapshot,
  recordPipelineAttempt,
  recordInsufficientBars,
  recordFetchError,
  classifyReason,
  computeDiagnostics,
  M2_STRATEGY_NAME,
  M2_STRATEGY_VERSION,
  M2_NOT_CONNECTED_LAYERS,
  type DecisionRecord,
  type PipelineDiagnostics,
} from "../lib/m2_pipeline";

import type { ExecutionRequest, ExecutionResult } from "../lib/order_executor";
import type { Signal } from "@workspace/strategy-ob-retest-long-1h";

// ── Fixture helpers (deterministic; NO Math.random) ──────────────────────────

function makeFlatBars(n: number, basePrice = 100): Array<{
  t: string; o: number; h: number; l: number; c: number; v: number;
  Timestamp: string; Open: number; High: number; Low: number; Close: number; Volume: number;
}> {
  const out = [];
  const startMs = Date.UTC(2025, 0, 1, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const t = new Date(startMs + i * 60 * 60 * 1000).toISOString();
    out.push({
      t,
      o: basePrice,
      h: basePrice + 0.5,
      l: basePrice - 0.5,
      c: basePrice,
      v: 1000,
      Timestamp: t,
      Open: basePrice,
      High: basePrice + 0.5,
      Low: basePrice - 0.5,
      Close: basePrice,
      Volume: 1000,
    });
  }
  return out;
}

beforeEach(() => {
  resetPipelineSnapshot();
});

// ── alpacaBarToStrategyBar ───────────────────────────────────────────────────

describe("alpacaBarToStrategyBar", () => {
  it("converts a well-formed AlpacaBar to a strategy Bar", () => {
    const bar = {
      t: "2025-01-01T00:00:00Z",
      o: 100, h: 101, l: 99, c: 100.5, v: 1234,
      Timestamp: "2025-01-01T00:00:00Z",
      Open: 100, High: 101, Low: 99, Close: 100.5, Volume: 1234,
    };
    const out = alpacaBarToStrategyBar(bar as any);
    expect(out).toEqual({
      Timestamp: "2025-01-01T00:00:00Z",
      Open: 100, High: 101, Low: 99, Close: 100.5, Volume: 1234,
    });
  });

  it("returns null on missing Timestamp", () => {
    const bar = { Timestamp: "", Open: 1, High: 1, Low: 1, Close: 1, Volume: 1 };
    expect(alpacaBarToStrategyBar(bar as any)).toBeNull();
  });

  it("returns null on non-finite numeric fields", () => {
    const bar = { Timestamp: "x", Open: NaN, High: 1, Low: 1, Close: 1, Volume: 1 };
    expect(alpacaBarToStrategyBar(bar as any)).toBeNull();
  });
});

// ── buildChartPayload ────────────────────────────────────────────────────────

describe("buildChartPayload", () => {
  it("builds an accepted long payload with entry/stop/target/invalidation", () => {
    const sig: Signal = {
      kind: "long",
      timestamp: "2025-01-02T00:00:00Z",
      entry: 105,
      stop: 100,
      target: 115,
      invalidation: { obLow: 99, expireAt: "2025-01-03T00:00:00Z" },
    };
    const cp = buildChartPayload("BTCUSD", sig);
    expect(cp.symbol).toBe("BTCUSD");
    expect(cp.timeframe).toBe("1Hour");
    expect(cp.direction).toBe("long");
    expect(cp.entry).toBe(105);
    expect(cp.stop_loss).toBe(100);
    expect(cp.take_profit).toBe(115);
    expect(cp.invalidation.ob_low).toBe(99);
    expect(cp.invalidation.expire_at).toBe("2025-01-03T00:00:00Z");
    expect(cp.strategy_name).toBe(M2_STRATEGY_NAME);
    expect(cp.strategy_version).toBe(M2_STRATEGY_VERSION);
    expect(cp.reason).toBeNull();
    expect(cp.confidence).toBeNull();
    // Layers we don't have are honestly labeled
    expect(cp.order_block_zone.status).toBe("not_connected");
    expect(cp.order_block_zone.value).toBeNull();
    expect(cp.fvg_zone.status).toBe("not_connected");
    expect(cp.fvg_zone.value).toBeNull();
  });

  it("builds a no_trade payload with null prices and a reason", () => {
    const sig: Signal = {
      kind: "no_trade",
      timestamp: "2025-01-02T00:00:00Z",
      reason: "no_bos_up",
    };
    const cp = buildChartPayload("ETHUSD", sig);
    expect(cp.direction).toBeNull();
    expect(cp.entry).toBeNull();
    expect(cp.stop_loss).toBeNull();
    expect(cp.take_profit).toBeNull();
    expect(cp.invalidation.ob_low).toBeNull();
    expect(cp.invalidation.expire_at).toBeNull();
    expect(cp.reason).toBe("no_bos_up");
    expect(cp.order_block_zone.status).toBe("not_connected");
    expect(cp.fvg_zone.status).toBe("not_connected");
  });

  it("does not contain Math.random fingerprints", () => {
    const sig: Signal = {
      kind: "long", timestamp: "2025-01-02T00:00:00Z",
      entry: 100, stop: 99, target: 102,
      invalidation: { obLow: 98, expireAt: "2025-01-03T00:00:00Z" },
    };
    const cp = buildChartPayload("BTCUSD", sig);
    expect(JSON.stringify(cp)).not.toMatch(/0\.\d{15,}/);
  });
});

// ── runPipelineEvaluation: no-trade path ─────────────────────────────────────

describe("runPipelineEvaluation — no_trade path", () => {
  it("logs a no_trade record when bars are insufficient", () => {
    const decision = runPipelineEvaluation({
      symbol: "BTCUSD",
      bars: makeFlatBars(5) as any,  // way under the strategy minimum
    });
    expect(decision.status).toBe("no_trade");
    expect(decision.signal?.kind).toBe("no_trade");
    if (decision.signal && decision.signal.kind === "no_trade") {
      expect(decision.signal.reason).toBe("insufficient_bars");
    }
    expect(decision.reason).toBe("insufficient_bars");
    expect(decision.execution).toBeNull();
    expect(decision.data_source).toBe("alpaca_live");
    expect(decision.chart_payload.entry).toBeNull();
    expect(decision.chart_payload.reason).toBe("insufficient_bars");
  });

  it("updates the in-memory snapshot's no_trade and totals counters", () => {
    runPipelineEvaluation({ symbol: "ETHUSD", bars: makeFlatBars(5) as any });
    const snap = getPipelineSnapshot();
    expect(snap.totals.evaluated).toBe(1);
    expect(snap.totals.no_trade).toBe(1);
    expect(snap.totals.accepted).toBe(0);
    expect(snap.last_no_trade?.symbol).toBe("ETHUSD");
    expect(snap.last_decision?.symbol).toBe("ETHUSD");
    expect(snap.by_symbol["ETHUSD"]?.status).toBe("no_trade");
  });

  it("classifies a flat (no-displacement) series as no_trade with a real RejectionReason", () => {
    const decision = runPipelineEvaluation({
      symbol: "FLAT",
      bars: makeFlatBars(80, 100) as any,
    });
    expect(decision.status).toBe("no_trade");
    // Flat bars should fail upstream (no_bos_up or no_order_block etc.) — never accept.
    if (decision.signal && decision.signal.kind === "no_trade") {
      expect(decision.signal.reason).toMatch(/^(no_bos_up|no_order_block|displacement_too_small|atr_too_low|regime_not_bullish|insufficient_bars)$/);
    }
  });
});

// ── attemptExecution: risk pipeline NOT bypassed ─────────────────────────────

describe("attemptExecution", () => {
  function makeAcceptedRecord(): DecisionRecord {
    const sig: Signal = {
      kind: "long",
      timestamp: "2025-01-02T00:00:00Z",
      entry: 100, stop: 99, target: 102,
      invalidation: { obLow: 98, expireAt: "2025-01-03T00:00:00Z" },
    };
    return {
      decided_at: "2025-01-02T00:00:00Z",
      symbol: "BTCUSD",
      timeframe: "1Hour",
      bars_consumed: 100,
      status: "accepted",
      signal: sig,
      reason: null,
      chart_payload: buildChartPayload("BTCUSD", sig),
      execution: null,
      data_source: "alpaca_live",
      diagnostics: null,
    };
  }

  it("calls executeOrder with the standard ExecutionRequest fields (does NOT bypass risk)", async () => {
    const record = makeAcceptedRecord();
    let capturedReq: ExecutionRequest | null = null;
    const fakeExec = vi.fn(async (req: ExecutionRequest): Promise<ExecutionResult> => {
      capturedReq = req;
      return { executed: true, order_id: "ord_123", mode: "paper", details: {}, audit_id: "aud_1" };
    });
    const updated = await attemptExecution(record, 1, fakeExec);
    expect(fakeExec).toHaveBeenCalledTimes(1);
    expect(capturedReq).not.toBeNull();
    expect(capturedReq!.symbol).toBe("BTCUSD");
    expect(capturedReq!.side).toBe("buy");
    expect(capturedReq!.direction).toBe("long");
    expect(capturedReq!.quantity).toBe(1);
    expect(capturedReq!.entry_price).toBe(100);
    expect(capturedReq!.stop_loss).toBe(99);
    expect(capturedReq!.take_profit).toBe(102);
    expect(capturedReq!.setup_type).toBe(M2_STRATEGY_NAME);
    // Critical: bypassReasons MUST NOT include "stop_out" — we never bypass risk
    expect(capturedReq!.bypassReasons).toBeUndefined();
    expect(updated.execution?.attempted).toBe(true);
    expect(updated.execution?.executed).toBe(true);
    expect(updated.execution?.order_id).toBe("ord_123");
    expect(updated.execution?.audit_id).toBe("aud_1");
    expect(updated.execution?.skipped_reason).toBeNull();
  });

  it("records execution_blocked when executeOrder reports blocked by a risk gate", async () => {
    const record = makeAcceptedRecord();
    const fakeExec = async (): Promise<ExecutionResult> => ({
      executed: false,
      mode: "paper",
      details: {},
      blocking_gate: "data_staleness",
      error: "bars stale",
    });
    const updated = await attemptExecution(record, 1, fakeExec);
    expect(updated.execution?.attempted).toBe(true);
    expect(updated.execution?.executed).toBe(false);
    expect(updated.execution?.blocking_gate).toBe("data_staleness");
    expect(updated.execution?.error).toBe("bars stale");
    expect(getPipelineSnapshot().totals.execution_blocked).toBe(1);
    expect(getPipelineSnapshot().totals.executed).toBe(0);
  });

  it("does not call executeOrder when qty <= 0 — records skipped_reason instead", async () => {
    const record = makeAcceptedRecord();
    const fakeExec = vi.fn();
    const updated = await attemptExecution(record, 0, fakeExec as any);
    expect(fakeExec).not.toHaveBeenCalled();
    expect(updated.execution?.attempted).toBe(false);
    expect(updated.execution?.executed).toBe(false);
    expect(updated.execution?.skipped_reason).toMatch(/^qty_zero_or_invalid:0$/);
    expect(getPipelineSnapshot().totals.execution_blocked).toBe(1);
  });

  it("does not call executeOrder for a non-accepted record", async () => {
    const record: DecisionRecord = {
      decided_at: "2025-01-02T00:00:00Z",
      symbol: "BTCUSD",
      timeframe: "1Hour",
      bars_consumed: 0,
      status: "no_trade",
      signal: { kind: "no_trade", timestamp: "2025-01-02T00:00:00Z", reason: "no_bos_up" },
      reason: "no_bos_up",
      chart_payload: buildChartPayload("BTCUSD", { kind: "no_trade", timestamp: "2025-01-02T00:00:00Z", reason: "no_bos_up" }),
      execution: null,
      data_source: "alpaca_live",
      diagnostics: null,
    };
    const fakeExec = vi.fn();
    await attemptExecution(record, 5, fakeExec as any);
    expect(fakeExec).not.toHaveBeenCalled();
  });
});

// ── Snapshot exposes M2 metadata ─────────────────────────────────────────────

describe("snapshot metadata", () => {
  it("exposes a stable strategy name and version", () => {
    const snap = getPipelineSnapshot();
    expect(snap.strategy_name).toBe(M2_STRATEGY_NAME);
    expect(snap.strategy_version).toBe(M2_STRATEGY_VERSION);
    // Default totals are all zero on cold start
    expect(snap.totals.evaluated).toBe(0);
    expect(snap.totals.accepted).toBe(0);
    expect(snap.totals.no_trade).toBe(0);
    expect(snap.totals.error).toBe(0);
    expect(snap.totals.executed).toBe(0);
    expect(snap.totals.execution_blocked).toBe(0);
  });

  it("M2_NOT_CONNECTED_LAYERS reports the expected unconnected layers", () => {
    expect(M2_NOT_CONNECTED_LAYERS).toContain("order_flow");
    expect(M2_NOT_CONNECTED_LAYERS).toContain("heatmap");
    expect(M2_NOT_CONNECTED_LAYERS).toContain("fvg_zone");
    expect(M2_NOT_CONNECTED_LAYERS).toContain("mcp");
  });
});

// ── Diagnostic recorders ──────────────────────────────────────────────────

describe("diagnostic recorders", () => {
  it("recordPipelineAttempt increments attempted and sets last_symbol/last_timeframe/last_attempt_at", () => {
    expect(getPipelineSnapshot().totals.attempted).toBe(0);
    recordPipelineAttempt("BTCUSD", "1Hour");
    const snap = getPipelineSnapshot();
    expect(snap.totals.attempted).toBe(1);
    expect(snap.last_symbol).toBe("BTCUSD");
    expect(snap.last_timeframe).toBe("1Hour");
    expect(typeof snap.last_attempt_at).toBe("string");
    expect(Number.isNaN(Date.parse(snap.last_attempt_at as string))).toBe(false);
    // attempt always clears stale last_error so the next failure re-populates it
    expect(snap.last_error).toBeNull();
  });

  it("recordInsufficientBars increments insufficient_bars and captures the diagnostic", () => {
    expect(getPipelineSnapshot().totals.insufficient_bars).toBe(0);
    recordInsufficientBars("ETHUSD", 24, 50);
    const snap = getPipelineSnapshot();
    expect(snap.totals.insufficient_bars).toBe(1);
    expect(snap.last_insufficient_bars_reason).not.toBeNull();
    expect(snap.last_insufficient_bars_reason!.symbol).toBe("ETHUSD");
    expect(snap.last_insufficient_bars_reason!.bars).toBe(24);
    expect(snap.last_insufficient_bars_reason!.threshold).toBe(50);
  });

  it("recordFetchError increments fetch_errors and stores the message", () => {
    expect(getPipelineSnapshot().totals.fetch_errors).toBe(0);
    recordFetchError("BTCUSD", new Error("network unreachable"));
    const snap = getPipelineSnapshot();
    expect(snap.totals.fetch_errors).toBe(1);
    expect(snap.last_error).toBe("network unreachable");
    expect(snap.last_symbol).toBe("BTCUSD");
  });

  it("recordFetchError handles non-Error thrown values", () => {
    recordFetchError("SOLUSD", "string-thrown");
    expect(getPipelineSnapshot().last_error).toBe("string-thrown");
  });

  it("resetPipelineSnapshot clears all new diagnostic counters and last_* fields", () => {
    recordPipelineAttempt("BTCUSD", "1Hour");
    recordInsufficientBars("BTCUSD", 10, 50);
    recordFetchError("BTCUSD", new Error("boom"));
    expect(getPipelineSnapshot().totals.attempted).toBeGreaterThan(0);
    resetPipelineSnapshot();
    const snap = getPipelineSnapshot();
    expect(snap.totals.attempted).toBe(0);
    expect(snap.totals.insufficient_bars).toBe(0);
    expect(snap.totals.fetch_errors).toBe(0);
    expect(snap.last_attempt_at).toBeNull();
    expect(snap.last_symbol).toBeNull();
    expect(snap.last_timeframe).toBeNull();
    expect(snap.last_error).toBeNull();
    expect(snap.last_insufficient_bars_reason).toBeNull();
    // M5b: reason counters cleared too
    expect(snap.totals.reasons.no_bos_up).toBe(0);
    expect(snap.totals.reasons.ob_broken_before_retest).toBe(0);
    expect(snap.totals.reasons.regime_not_bullish).toBe(0);
  });
});

// ── M5b: classifyReason (pure helper) ────────────────────────────────────────

describe("classifyReason", () => {
  it("maps each known RejectionReason to a ReasonClass bucket", () => {
    expect(classifyReason("insufficient_bars")).toBe("data");
    expect(classifyReason("no_bos_up")).toBe("structure");
    expect(classifyReason("no_order_block")).toBe("order_block");
    expect(classifyReason("displacement_too_small")).toBe("order_block");
    expect(classifyReason("ob_broken_before_retest")).toBe("retest");
    expect(classifyReason("retest_window_expired")).toBe("retest");
    expect(classifyReason("opposite_bos_before_retest")).toBe("retest");
    expect(classifyReason("regime_not_bullish")).toBe("regime");
    expect(classifyReason("atr_too_low")).toBe("atr");
    expect(classifyReason("news_window")).toBe("news");
  });
  it("returns null for empty/unknown reasons (no fabricated bucket)", () => {
    expect(classifyReason(null)).toBeNull();
    expect(classifyReason(undefined)).toBeNull();
    expect(classifyReason("")).toBeNull();
    expect(classifyReason("totally_made_up_reason")).toBeNull();
  });
});

// ── M5b: computeDiagnostics (pure helper, never mutates strategy logic) ──────

describe("computeDiagnostics", () => {
  it("returns null-internals + reason_class=data when bars are insufficient", () => {
    const sig: Signal = { kind: "no_trade", timestamp: "2025-01-01T00:00:00Z", reason: "insufficient_bars" };
    const diag: PipelineDiagnostics = computeDiagnostics([], sig);
    expect(diag.bos).toBeNull();
    expect(diag.order_block).toBeNull();
    expect(diag.displacement).toBeNull();
    expect(diag.retest).toBeNull();
    expect(diag.reason_class).toBe("data");
  });

  it("returns reason_class=accepted when signal kind is long", () => {
    const sig: Signal = {
      kind: "long",
      timestamp: "2025-01-01T00:00:00Z",
      entry: 100, stop: 99, target: 102,
      invalidation: { obLow: 98, expireAt: "2025-01-02T00:00:00Z" },
    };
    const diag = computeDiagnostics([], sig);
    expect(diag.reason_class).toBe("accepted");
  });

  it("returns null bos / order_block when bars produce no BOS up (flat series)", () => {
    const sig: Signal = { kind: "no_trade", timestamp: "2025-01-01T00:00:00Z", reason: "no_bos_up" };
    // 80 flat bars (no displacement, no BOS)
    const flatBars = Array.from({ length: 80 }, (_, i) => ({
      Timestamp: new Date(Date.UTC(2025, 0, 1, i)).toISOString(),
      Open: 100, High: 100.5, Low: 99.5, Close: 100, Volume: 1000,
    }));
    const diag = computeDiagnostics(flatBars, sig);
    // structure helpers will likely find pivots but no BOS up → bos null
    expect(diag.bos).toBeNull();
    expect(diag.order_block).toBeNull();
    expect(diag.reason_class).toBe("structure");
  });
});

// ── M5b: runPipelineEvaluation populates DecisionRecord.diagnostics ─────────

describe("runPipelineEvaluation — diagnostics field", () => {
  it("attaches a diagnostics object on no_trade decisions", () => {
    const decision = runPipelineEvaluation({
      symbol: "BTCUSD",
      bars: makeFlatBars(60) as any,  // enough bars to clear insufficient_bars
    });
    expect(decision.status).toBe("no_trade");
    expect(decision.diagnostics).not.toBeNull();
    expect(decision.diagnostics!.reason_class).not.toBeNull();
  });

  it("returns diagnostics=null when there are no bars at all", () => {
    const decision = runPipelineEvaluation({
      symbol: "BTCUSD",
      bars: [],
    });
    expect(decision.status).toBe("no_trade");
    expect(decision.diagnostics).toBeNull();
  });

  it("increments the corresponding totals.reasons counter on no_trade", () => {
    runPipelineEvaluation({ symbol: "BTC1", bars: makeFlatBars(5) as any });
    runPipelineEvaluation({ symbol: "BTC2", bars: makeFlatBars(5) as any });
    const snap = getPipelineSnapshot();
    expect(snap.totals.no_trade).toBe(2);
    // 5 bars < min → both increment insufficient_bars
    expect(snap.totals.reasons.insufficient_bars).toBe(2);
  });
});
