/**
 * m2_pipeline.ts — Milestone 2 Institutional Liquidity Intelligence (slim slice).
 *
 * Wraps the pure-function `@workspace/strategy-ob-retest-long-1h` strategy
 * for runtime use by `scanner_scheduler.ts`. Responsibilities:
 *
 *   1. Convert AlpacaBar[] (real broker data) → strategy Bar[].
 *   2. Run the strategy and capture the result.
 *   3. Build a chart payload from the result (entry/SL/TP/invalidation).
 *   4. Maintain an in-memory snapshot of the latest decision per symbol +
 *      globally so /api/brain-state can expose it.
 *   5. Hand accepted long signals off to the SOLE choke point
 *      `executeOrder()` for paper-trade execution. Risk pipeline is NOT
 *      bypassed — every accepted signal still passes through the 9-gate
 *      risk pipeline.
 *
 * What this module does NOT do:
 *   - Bypass the risk pipeline.
 *   - Place orders directly.
 *   - Generate fake order-flow / heatmap / news data.
 *   - Persist anything to the DB. Snapshot is in-process. The real proof
 *     of accepted trades lives in `paper_trades` (via order_executor).
 *
 * Layers honestly NOT connected (label = "not_connected" in chart payload):
 *   - order_block_zone   (strategy emits invalidation.obLow but not obHigh)
 *   - fvg_zone           (no FVG layer wired yet)
 *   - mcp                (separate; reported by brain-state directly)
 */
import { evaluate, type Signal } from "@workspace/strategy-ob-retest-long-1h";
import type { AlpacaBar } from "./alpaca";
import { logger as _logger } from "./logger";
import type { ExecutionRequest, ExecutionResult } from "./order_executor";

const logger = _logger.child({ module: "m2_pipeline" });

const STRATEGY_NAME = "ob-retest-long-1h";
const STRATEGY_VERSION = "1.0.0";

// ── Types ────────────────────────────────────────────────────────────────────

export type DecisionStatus = "accepted" | "no_trade" | "evaluation_error";

export type NotConnected<T> = { status: "not_connected"; value: T | null };
export type Connected<T> = { status: "ok"; value: T };
export type Layer<T> = NotConnected<T> | Connected<T>;

export interface ChartPayloadInvalidation {
  ob_low: number | null;
  expire_at: string | null;
}

export interface ChartPayload {
  symbol: string;
  timeframe: "1Hour";
  /** ISO 8601 timestamp of the strategy's decision bar. */
  timestamp: string;
  direction: "long" | "short" | null;
  entry: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  invalidation: ChartPayloadInvalidation;

  // Layers we do NOT yet have — labeled honestly. NEVER fabricated.
  order_block_zone: Layer<{ low: number; high: number }>;
  fvg_zone: Layer<{ low: number; high: number }>;

  // Strategy meta
  strategy_name: string;
  strategy_version: string;

  /** Reason for no_trade (RejectionReason) or null for accepted. */
  reason: string | null;
  /** Strategy-emitted confidence (0..1). ob-retest-long-1h does not emit one. */
  confidence: number | null;
}

export interface ExecutionAttempt {
  attempted: boolean;
  executed: boolean;
  order_id: string | null;
  blocking_gate: string | null;
  error: string | null;
  audit_id: string | null;
  /** Captures the qty resolution when caller decided not to attempt. */
  skipped_reason: string | null;
}

export interface DecisionRecord {
  /** ISO timestamp of when this decision record was created. */
  decided_at: string;
  symbol: string;
  timeframe: "1Hour";
  bars_consumed: number;
  status: DecisionStatus;
  /** Raw strategy signal output (no_trade.reason for rejections). */
  signal: Signal | null;
  reason: string | null;
  chart_payload: ChartPayload;
  /** Populated when a long signal goes through executeOrder(). */
  execution: ExecutionAttempt | null;
  /** Where the input bars came from. Always "alpaca_live" for production. */
  data_source: "alpaca_live" | "fixture" | "unavailable";
}

// ── In-memory snapshot ───────────────────────────────────────────────────────

interface Totals {
  /** Strategy was attempted (bars fetched OK and evaluate() called). */
  evaluated: number;
  /** evaluate() returned a valid long Signal. */
  accepted: number;
  /** evaluate() returned no_trade. */
  no_trade: number;
  /** evaluate() threw or returned a malformed result. */
  error: number;
  /** executeOrder reported executed=true. */
  executed: number;
  /** executeOrder reported executed=false (risk gate or qty=0). */
  execution_blocked: number;
  /** Pipeline pass entered scanSymbol — counts every (symbol × cycle). */
  attempted: number;
  /** Bars fetch succeeded but returned fewer than minBars. */
  insufficient_bars: number;
  /** Bars fetch threw — network, auth, symbol-format. */
  fetch_errors: number;
}

interface Snapshot {
  strategy_name: string;
  strategy_version: string;
  /** Last time runPipelineEvaluation actually ran (bars OK, evaluate called). */
  last_evaluation_at: string | null;
  /** Last time scanSymbol entered the M2 try-block (always set if pass ran). */
  last_attempt_at: string | null;
  /** Symbol of the last attempt (regardless of outcome). */
  last_symbol: string | null;
  /** Timeframe of the last attempt. */
  last_timeframe: string | null;
  /** Last error string (fetch or evaluation). null when last attempt succeeded. */
  last_error: string | null;
  /** Diagnostic for the most recent insufficient_bars skip. */
  last_insufficient_bars_reason: { symbol: string; bars: number; threshold: number; at: string } | null;
  last_decision: DecisionRecord | null;
  last_accepted: DecisionRecord | null;
  last_no_trade: DecisionRecord | null;
  by_symbol: Record<string, DecisionRecord>;
  totals: Totals;
}

const _snapshot: Snapshot = {
  strategy_name: STRATEGY_NAME,
  strategy_version: STRATEGY_VERSION,
  last_evaluation_at: null,
  last_attempt_at: null,
  last_symbol: null,
  last_timeframe: null,
  last_error: null,
  last_insufficient_bars_reason: null,
  last_decision: null,
  last_accepted: null,
  last_no_trade: null,
  by_symbol: {},
  totals: {
    evaluated: 0,
    accepted: 0,
    no_trade: 0,
    error: 0,
    executed: 0,
    execution_blocked: 0,
    attempted: 0,
    insufficient_bars: 0,
    fetch_errors: 0,
  },
};

/** Returns a deep copy of the current snapshot. Safe to expose via API. */
export function getPipelineSnapshot(): Snapshot {
  return JSON.parse(JSON.stringify(_snapshot)) as Snapshot;
}

/** Test helper. Resets all counters and the per-symbol map. */
export function resetPipelineSnapshot(): void {
  _snapshot.last_evaluation_at = null;
  _snapshot.last_attempt_at = null;
  _snapshot.last_symbol = null;
  _snapshot.last_timeframe = null;
  _snapshot.last_error = null;
  _snapshot.last_insufficient_bars_reason = null;
  _snapshot.last_decision = null;
  _snapshot.last_accepted = null;
  _snapshot.last_no_trade = null;
  _snapshot.by_symbol = {};
  _snapshot.totals.evaluated = 0;
  _snapshot.totals.accepted = 0;
  _snapshot.totals.no_trade = 0;
  _snapshot.totals.error = 0;
  _snapshot.totals.executed = 0;
  _snapshot.totals.execution_blocked = 0;
  _snapshot.totals.attempted = 0;
  _snapshot.totals.insufficient_bars = 0;
  _snapshot.totals.fetch_errors = 0;
}

// ── Diagnostic recorders (called by scanner before/around runPipelineEvaluation) ─

/**
 * Record that the M2 pass was attempted for a given symbol/timeframe.
 * Always called BEFORE the bars fetch so that even fetch errors increment
 * `attempted`. Lets the snapshot show "we tried; here is why nothing
 * evaluated" instead of just a static zero.
 */
export function recordPipelineAttempt(symbol: string, timeframe: string): void {
  _snapshot.totals.attempted++;
  _snapshot.last_attempt_at = new Date().toISOString();
  _snapshot.last_symbol = symbol;
  _snapshot.last_timeframe = timeframe;
  // Reset error & insufficient-bars markers when a fresh attempt begins;
  // they get re-set below if this attempt also fails.
  _snapshot.last_error = null;
}

/**
 * Record that the bars fetch returned fewer than the minimum required.
 * The strategy needs >= 50 1H bars; without an explicit start window the
 * Alpaca crypto endpoint returns only ~24 (last 24h). This counter makes
 * the cause visible in /api/brain-state instead of silently skipping.
 */
export function recordInsufficientBars(
  symbol: string,
  bars: number,
  threshold: number,
): void {
  _snapshot.totals.insufficient_bars++;
  _snapshot.last_insufficient_bars_reason = {
    symbol,
    bars,
    threshold,
    at: new Date().toISOString(),
  };
}

/**
 * Record that the bars fetch threw — network, auth, malformed symbol.
 * Captures the message for the snapshot so production can self-diagnose
 * without docker compose logs access.
 */
export function recordFetchError(symbol: string, error: unknown): void {
  _snapshot.totals.fetch_errors++;
  _snapshot.last_error = error instanceof Error ? error.message : String(error);
  _snapshot.last_symbol = symbol;
}

// ── Pure helpers (testable in isolation) ─────────────────────────────────────

/**
 * Convert one AlpacaBar to the strategy's Bar shape.
 *
 * The strategy's Bar shape and AlpacaBar already use identical PascalCase
 * fields (Timestamp/Open/High/Low/Close/Volume), so this is just type
 * narrowing + finite-number checks. Returns null on any malformed bar.
 */
export function alpacaBarToStrategyBar(
  bar: AlpacaBar,
): { Timestamp: string; Open: number; High: number; Low: number; Close: number; Volume: number } | null {
  if (!bar) return null;
  const ts = String(bar.Timestamp ?? "");
  const o = Number(bar.Open);
  const h = Number(bar.High);
  const l = Number(bar.Low);
  const c = Number(bar.Close);
  const v = Number(bar.Volume);
  if (
    !ts ||
    !Number.isFinite(o) ||
    !Number.isFinite(h) ||
    !Number.isFinite(l) ||
    !Number.isFinite(c) ||
    !Number.isFinite(v)
  ) {
    return null;
  }
  return { Timestamp: ts, Open: o, High: h, Low: l, Close: c, Volume: v };
}

/**
 * Build the chart payload from a strategy Signal. Pure function.
 *
 *   - For "long" signals: entry/stop_loss/take_profit/invalidation are populated.
 *   - For "no_trade" signals: numeric fields are null and `reason` is set.
 *
 * order_block_zone is "not_connected" because the public Signal shape
 * exposes invalidation.obLow but not the OB box (low+high). When the
 * strategy is extended to export the box, this flips to {status:"ok"}.
 *
 * fvg_zone is always "not_connected" until a Fair Value Gap layer is wired.
 */
export function buildChartPayload(symbol: string, signal: Signal): ChartPayload {
  const base: ChartPayload = {
    symbol,
    timeframe: "1Hour",
    timestamp: signal.timestamp,
    direction: null,
    entry: null,
    stop_loss: null,
    take_profit: null,
    invalidation: { ob_low: null, expire_at: null },
    order_block_zone: { status: "not_connected", value: null },
    fvg_zone: { status: "not_connected", value: null },
    strategy_name: STRATEGY_NAME,
    strategy_version: STRATEGY_VERSION,
    reason: null,
    confidence: null,
  };

  if (signal.kind === "long") {
    return {
      ...base,
      direction: "long",
      entry: signal.entry,
      stop_loss: signal.stop,
      take_profit: signal.target,
      invalidation: {
        ob_low: signal.invalidation.obLow,
        expire_at: signal.invalidation.expireAt,
      },
    };
  }
  // no_trade
  return { ...base, reason: signal.reason };
}

// ── Pipeline entry points ────────────────────────────────────────────────────

export interface RunPipelineInput {
  symbol: string;
  bars: AlpacaBar[];
  data_source?: "alpaca_live" | "fixture" | "unavailable";
}

/**
 * Evaluate the strategy on a symbol's bars and update the in-memory snapshot.
 *
 * Does NOT execute orders. Use `attemptExecution()` separately for accepted
 * signals so that test paths can verify the evaluation step in isolation
 * from the broker-mutating step.
 */
export function runPipelineEvaluation(input: RunPipelineInput): DecisionRecord {
  const decidedAt = new Date().toISOString();
  const dataSource = input.data_source ?? "alpaca_live";

  const normalized = input.bars
    .map(alpacaBarToStrategyBar)
    .filter((b): b is NonNullable<ReturnType<typeof alpacaBarToStrategyBar>> => b !== null);

  let signal: Signal;
  let status: DecisionStatus;
  let reason: string | null = null;

  try {
    signal = evaluate({ symbol: input.symbol, bars: normalized });
    if (signal.kind === "long") {
      status = "accepted";
    } else {
      status = "no_trade";
      reason = signal.reason;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ symbol: input.symbol, err: errMsg }, "[m2] Strategy evaluation threw");
    status = "evaluation_error";
    reason = `evaluation_error: ${errMsg}`;
    signal = { kind: "no_trade", timestamp: decidedAt, reason: "insufficient_bars" };
  }

  const chart_payload = buildChartPayload(input.symbol, signal);

  const record: DecisionRecord = {
    decided_at: decidedAt,
    symbol: input.symbol,
    timeframe: "1Hour",
    bars_consumed: normalized.length,
    status,
    signal,
    reason,
    chart_payload,
    execution: null,
    data_source: dataSource,
  };

  _snapshot.last_evaluation_at = decidedAt;
  _snapshot.last_decision = record;
  _snapshot.by_symbol[input.symbol] = record;
  _snapshot.totals.evaluated++;
  if (status === "accepted") {
    _snapshot.last_accepted = record;
    _snapshot.totals.accepted++;
  } else if (status === "no_trade") {
    _snapshot.last_no_trade = record;
    _snapshot.totals.no_trade++;
  } else {
    _snapshot.totals.error++;
  }

  return record;
}

/**
 * For an accepted decision, attempt execution through `executeOrder()`.
 *
 * Risk pipeline is NOT bypassed here. We construct a standard
 * ExecutionRequest and pass it to the SOLE choke point. If the request
 * is blocked by any of the 9 gates, we record the blocking_gate and the
 * snapshot reflects execution_blocked++.
 *
 * MUST only be called when record.status === "accepted" and record.signal.kind === "long".
 *
 * @param record  The DecisionRecord previously returned by runPipelineEvaluation()
 * @param quantity  Pre-computed position size (via repo's existing position_sizer)
 * @param executeOrderFn  Injected for tests; pass real executeOrder in production
 */
export async function attemptExecution(
  record: DecisionRecord,
  quantity: number,
  executeOrderFn: (req: ExecutionRequest) => Promise<ExecutionResult>,
): Promise<DecisionRecord> {
  if (record.status !== "accepted" || !record.signal || record.signal.kind !== "long") {
    record.execution = {
      attempted: false,
      executed: false,
      order_id: null,
      blocking_gate: null,
      error: null,
      audit_id: null,
      skipped_reason: "not_accepted",
    };
    return record;
  }

  if (!Number.isFinite(quantity) || quantity <= 0) {
    record.execution = {
      attempted: false,
      executed: false,
      order_id: null,
      blocking_gate: null,
      error: null,
      audit_id: null,
      skipped_reason: `qty_zero_or_invalid:${quantity}`,
    };
    _snapshot.totals.execution_blocked++;
    _snapshot.by_symbol[record.symbol] = record;
    _snapshot.last_accepted = record;
    return record;
  }

  const long = record.signal;
  const req: ExecutionRequest = {
    symbol: record.symbol,
    side: "buy",
    direction: "long",
    quantity,
    setup_type: STRATEGY_NAME,
    regime: "ob_retest_1h",
    entry_price: long.entry,
    stop_loss: long.stop,
    take_profit: long.target,
  };

  let executed = false;
  let orderId: string | null = null;
  let blockingGate: string | null = null;
  let error: string | null = null;
  let auditId: string | null = null;

  try {
    const result = await executeOrderFn(req);
    executed = !!result?.executed;
    orderId = result?.order_id ?? null;
    blockingGate = result?.blocking_gate ?? null;
    error = result?.error ?? null;
    auditId = result?.audit_id ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  record.execution = {
    attempted: true,
    executed,
    order_id: orderId,
    blocking_gate: blockingGate,
    error,
    audit_id: auditId,
    skipped_reason: null,
  };

  if (executed) {
    _snapshot.totals.executed++;
  } else {
    _snapshot.totals.execution_blocked++;
  }
  _snapshot.by_symbol[record.symbol] = record;
  _snapshot.last_accepted = record;

  return record;
}

// ── Public meta ──────────────────────────────────────────────────────────────

export const M2_STRATEGY_NAME = STRATEGY_NAME;
export const M2_STRATEGY_VERSION = STRATEGY_VERSION;

/**
 * MCP layer status published into the chart payload section. Always
 * "not_connected" until a real MCP transport is wired (see audit). This
 * is exported so the brain-state route can mirror it in the pipeline
 * section without re-deriving anywhere else.
 */
export const M2_NOT_CONNECTED_LAYERS: ReadonlyArray<string> = ["order_flow", "heatmap", "fvg_zone", "mcp"];
