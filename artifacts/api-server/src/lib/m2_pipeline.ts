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
 *   M5b additions (diagnostics-only — no strategy logic change):
 *   6. Recompute the strategy's BOS / OB / displacement / retest internals
 *      after evaluate() returns and attach them to the DecisionRecord as
 *      `diagnostics`. When evaluate() rejects with `ob_broken_before_retest`
 *      we surface the actual obLow, the breaking bar's Close, the
 *      Close-minus-obLow distance, and the OB candle's wick anatomy so
 *      operators can decide whether the rejection was honest or whether
 *      the strategy is mis-calibrated.
 *   7. Per-rejection-reason counters in `totals.reasons` so /api/brain-state
 *      shows reason distribution at a glance.
 *
 *   M5d-rng additions (read-only macro-news-gate plumbing):
 *   8. Each call to attemptExecution() reads the current macro-news-gate
 *      state via lib/risk/macro_news_gate.ts and forwards it into
 *      ExecutionRequest.macroNewsGate so the 9-gate risk pipeline (gate 6
 *      news_lockout) can block NEW entries during macro release windows.
 *      Stop-out exits and explicit closes are NOT affected.
 *   9. The current global state is mirrored on _snapshot.macro_news_gate so
 *      /api/brain-state can show "what does macro-news see right now"
 *      without picking a per-symbol record.
 *
 * What this module does NOT do:
 *   - Bypass the risk pipeline.
 *   - Place orders directly.
 *   - Generate fake order-flow / heatmap / news data.
 *   - Persist anything to the DB. Snapshot is in-process. The real proof
 *     of accepted trades lives in `paper_trades` (via order_executor).
 *   - Mutate strategy logic. Diagnostics are observed via the strategy's
 *     own exported helpers (atr, detectPivots, findLatestBOSUp,
 *     findOrderBlockForBOS, displacementATR, findRetestConfirmation).
 *
 * Layers honestly NOT connected (label = "not_connected" in chart payload):
 *   - order_block_zone   (strategy emits invalidation.obLow but not obHigh)
 *   - fvg_zone           (no FVG layer wired yet)
 *   - mcp                (separate; reported by brain-state directly)
 */
import {
  evaluate,
  atr,
  detectPivots,
  findLatestBOSUp,
  findOrderBlockForBOS,
  findRetestConfirmation,
  displacementATR,
  DEFAULT_CONFIG,
  type Config as StrategyConfig,
  type Signal,
  type Bar as StrategyBar,
} from "@workspace/strategy-ob-retest-long-1h";
import type { AlpacaBar } from "./alpaca";
import { logger as _logger } from "./logger";
import type { ExecutionRequest, ExecutionResult } from "./order_executor";
import {
  getMacroNewsGateState,
  evaluateMacroNewsGateForSymbol,
  type MacroNewsGateState,
} from "./risk/macro_news_gate.js";

const logger = _logger.child({ module: "m2_pipeline" });

const STRATEGY_NAME = "ob-retest-long-1h";
const STRATEGY_VERSION = "1.0.0";

// ── M5c: env-var overrides for tunable parameters ────────────────────────────
//
// All defaults preserve the strict baseline shipped through M5b. Backtest
// evidence (M5c, 607 evaluations across BTCUSD/ETHUSD/QQQ/SPY over ~3 weeks)
// showed that raising obBreakBufferPct to 0.001–0.005 or extending equity
// retest windows to 36–48 bars does NOT unblock acceptance — it only shuffles
// rejections between buckets. The dominant gate is `requireBullishStructure`
// (30 of 607 evals would accept if it were disabled, but disabling it is a
// strategy rewrite, NOT a tune — out of M5c scope).
//
// These knobs are exposed so future ops experiments can A/B test without code
// changes. DO NOT raise them in production without backtest evidence.

export type AssetClass = "crypto" | "forex" | "equity" | "commodity";

function clampNumber(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const ENV_OB_BREAK_BUFFER_PCT = clampNumber(process.env.GODSVIEW_M2_OB_BREAK_BUFFER_PCT, 0, 0, 0.05);
const ENV_RETEST_BARS_CRYPTO  = clampInt(process.env.GODSVIEW_M2_RETEST_BARS_CRYPTO, DEFAULT_CONFIG.maxRetestBars, 6, 96);
const ENV_RETEST_BARS_EQUITY  = clampInt(process.env.GODSVIEW_M2_RETEST_BARS_EQUITY, DEFAULT_CONFIG.maxRetestBars, 6, 96);
const ENV_RETEST_BARS_FOREX   = clampInt(process.env.GODSVIEW_M2_RETEST_BARS_FOREX,  DEFAULT_CONFIG.maxRetestBars, 6, 96);
const ENV_RETEST_BARS_COMMOD  = clampInt(process.env.GODSVIEW_M2_RETEST_BARS_COMMODITY, DEFAULT_CONFIG.maxRetestBars, 6, 96);

function maxRetestBarsFor(assetClass: AssetClass | undefined): number {
  switch (assetClass) {
    case "crypto":    return ENV_RETEST_BARS_CRYPTO;
    case "equity":    return ENV_RETEST_BARS_EQUITY;
    case "forex":     return ENV_RETEST_BARS_FOREX;
    case "commodity": return ENV_RETEST_BARS_COMMOD;
    default:          return DEFAULT_CONFIG.maxRetestBars;
  }
}

/**
 * Build the effective strategy Config for a single evaluation.
 * Pure function. Same inputs always produce the same output.
 */
export function buildRunConfig(assetClass: AssetClass | undefined): StrategyConfig {
  return {
    ...DEFAULT_CONFIG,
    obBreakBufferPct: ENV_OB_BREAK_BUFFER_PCT,
    maxRetestBars:    maxRetestBarsFor(assetClass),
  };
}

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

// ── M5b diagnostics types (observe-only; never used by execution) ────────────

/**
 * Bucket label for a rejection reason. Lets dashboards group reasons into
 * meaningful failure-mode classes without hardcoding the string list.
 */
export type ReasonClass =
  | "data"        // insufficient_bars
  | "structure"   // no_bos_up
  | "order_block" // no_order_block, displacement_too_small
  | "retest"      // ob_broken_before_retest, retest_window_expired, opposite_bos_before_retest
  | "regime"      // regime_not_bullish
  | "atr"         // atr_too_low
  | "news"        // news_window
  | "accepted";

export function classifyReason(reason: string | null | undefined): ReasonClass | null {
  if (!reason) return null;
  switch (reason) {
    case "insufficient_bars": return "data";
    case "no_bos_up": return "structure";
    case "no_order_block":
    case "displacement_too_small": return "order_block";
    case "ob_broken_before_retest":
    case "retest_window_expired":
    case "opposite_bos_before_retest": return "retest";
    case "regime_not_bullish": return "regime";
    case "atr_too_low": return "atr";
    case "news_window": return "news";
    default: return null;
  }
}

export interface BosDiagnostic {
  bos_index: number;
  broken_swing_index: number;
  broken_swing_price: number;
  bar_timestamp: string;
}

export interface OrderBlockDiagnostic {
  ob_index: number;
  ob_low: number;
  ob_high: number;
  bar_timestamp: string;
  /** OB candle body bounds — useful to see if the OB has a long lower wick. */
  body_low: number;
  body_high: number;
  /** Distance from OB candle body low down to OB low (i.e. lower-wick size). */
  lower_wick_size: number;
  /** lower_wick_size / (obHigh - obLow), 0..1. Higher = OB low is far below the body. */
  lower_wick_pct_of_range: number;
}

export interface DisplacementDiagnostic {
  atr_at_bos: number;
  displacement_atr: number;
  min_required: number;
  passed: boolean;
}

export type RetestDiagnostic =
  | {
      kind: "ob_broken";
      at_index: number;
      bar_timestamp: string;
      break_close: number;
      ob_low: number;
      close_minus_ob_low: number;
      /** (break_close - ob_low) / ob_low × 100; negative = below OB low. */
      pct_below_ob_low: number;
      /** Bars consumed from BOS+1 up to and including the break bar. */
      bars_in_window_used: number;
      max_retest_bars: number;
    }
  | {
      kind: "expired";
      checked_through_index: number;
      max_retest_bars: number;
      ob_low: number;
      ob_high: number;
    }
  | {
      kind: "confirmed";
      index: number;
      bar_timestamp: string;
      close: number;
    };

/**
 * M5c: snapshot of the strategy parameters that were actually used for THIS
 * evaluation, so /api/brain-state always shows which thresholds the running
 * scanner is enforcing. Values are pulled from buildRunConfig() (which reads
 * env-var overrides at module load and falls back to DEFAULT_CONFIG). When
 * no override is set, all values match DEFAULT_CONFIG byte-for-byte.
 */
export interface ActiveConfigDiagnostic {
  ob_break_buffer_pct: number;     // 0 = strict baseline
  max_retest_bars: number;         // per asset-class window
  min_displacement_atr: number;    // current floor (1.5)
  asset_class: AssetClass | null;  // null when caller did not pass one
  source: "default" | "env_override";  // which path produced these values
}

/**
 * M5d-rng: per-decision macro-news-gate diagnostic.
 * Snapshots whether the macro-news-gate would block a NEW entry on this
 * symbol at the moment attemptExecution() ran. For records that never
 * reach attemptExecution (no_trade, evaluation_error), this stays null.
 */
export interface MacroNewsGateDiagnostic {
  enabled: boolean;
  active: boolean;
  reason: string | null;
  affected_symbols: string[];
  source: "macro-risk" | "macro-risk-cached" | "macro-risk-unavailable" | "disabled";
  applies_to_symbol: boolean;
  last_refreshed_at: string | null;
}

export interface PipelineDiagnostics {
  bos: BosDiagnostic | null;
  order_block: OrderBlockDiagnostic | null;
  displacement: DisplacementDiagnostic | null;
  retest: RetestDiagnostic | null;
  reason_class: ReasonClass | null;
  /** M5c: which thresholds were used for THIS evaluation. Always populated. */
  active_config: ActiveConfigDiagnostic;
  /** M5d-rng: macro-news-gate decision for THIS symbol when attemptExecution
   *  ran. Null on records that did not reach attemptExecution. Optional so
   *  pre-existing fixtures still type-check. */
  macro_news_gate?: MacroNewsGateDiagnostic | null;
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
  /**
   * M5b: BOS / OB / displacement / retest internals re-derived from the
   * strategy's exported helpers AFTER evaluate() returns. Read-only; used
   * for /api/brain-state visibility. Never feeds back into execution.
   * null only when bars normalization stripped everything (no inputs).
   */
  diagnostics: PipelineDiagnostics | null;
}

// ── In-memory snapshot ───────────────────────────────────────────────────────

/**
 * Per-rejection-reason counter object. Each field counts how many times
 * evaluate() emitted the corresponding RejectionReason since the snapshot
 * was reset. Sum across these equals totals.no_trade except for any
 * unknown future reason which would NOT be counted (additive safety).
 */
export interface ReasonTotals {
  no_bos_up: number;
  no_order_block: number;
  displacement_too_small: number;
  ob_broken_before_retest: number;
  retest_window_expired: number;
  opposite_bos_before_retest: number;
  regime_not_bullish: number;
  atr_too_low: number;
  news_window: number;
  insufficient_bars: number;
}

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
  /** M5b: per-rejection-reason counters. */
  reasons: ReasonTotals;
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
  /**
   * M5d-rng: GLOBAL macro-news-gate state from the last attemptExecution()
   * call. Mirrors the per-decision diagnostic but lives on the snapshot so
   * /api/brain-state can show "what does macro-news see RIGHT NOW" without
   * having to pick a per-symbol record.
   * null until at least one attemptExecution() runs.
   */
  macro_news_gate: MacroNewsGateGlobal | null;
}

/** M5d-rng: shape of the global per-tick state surfaced on the snapshot. */
export interface MacroNewsGateGlobal {
  enabled: boolean;
  active: boolean;
  reason: string | null;
  affected_symbols: string[];
  source: "macro-risk" | "macro-risk-cached" | "macro-risk-unavailable" | "disabled";
  last_refreshed_at: string | null;
}

function emptyReasonTotals(): ReasonTotals {
  return {
    no_bos_up: 0,
    no_order_block: 0,
    displacement_too_small: 0,
    ob_broken_before_retest: 0,
    retest_window_expired: 0,
    opposite_bos_before_retest: 0,
    regime_not_bullish: 0,
    atr_too_low: 0,
    news_window: 0,
    insufficient_bars: 0,
  };
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
    reasons: emptyReasonTotals(),
  },
  macro_news_gate: null,
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
  _snapshot.totals.reasons = emptyReasonTotals();
  _snapshot.macro_news_gate = null;
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

// ── M5b: diagnostics recompute (read-only, never mutates strategy logic) ─────

/**
 * Re-derive BOS / OB / displacement / retest internals from the same
 * helpers the strategy uses, so /api/brain-state can show operators
 * EXACTLY what the strategy saw and where it stopped. Pure function.
 *
 * Returns null only when there are no bars to inspect. Returns a
 * partially-populated diagnostics object when an upstream step fails
 * (e.g. no BOS up → bos=null, order_block=null, etc.).
 */
export function computeDiagnostics(
  bars: StrategyBar[],
  signal: Signal,
  runCfg?: StrategyConfig,
  assetClass?: AssetClass,
): PipelineDiagnostics {
  const cfg = runCfg ?? DEFAULT_CONFIG;
  const isOverride =
    cfg.obBreakBufferPct !== DEFAULT_CONFIG.obBreakBufferPct ||
    cfg.maxRetestBars !== DEFAULT_CONFIG.maxRetestBars;
  const out: PipelineDiagnostics = {
    bos: null,
    order_block: null,
    displacement: null,
    retest: null,
    reason_class: signal.kind === "long" ? "accepted" : classifyReason(signal.reason),
    active_config: {
      ob_break_buffer_pct: cfg.obBreakBufferPct,
      max_retest_bars: cfg.maxRetestBars,
      min_displacement_atr: cfg.minDisplacementATR,
      asset_class: assetClass ?? null,
      source: isOverride ? "env_override" : "default",
    },
  };

  // Insufficient bars → nothing more to compute.
  const minBars = Math.max(cfg.atrPeriod + cfg.pivotLeft + cfg.pivotRight + 2, cfg.atrAvgWindow);
  if (bars.length < minBars) return out;

  const atrSeries = atr(bars, cfg.atrPeriod);
  const pivots = detectPivots(bars, cfg.pivotLeft, cfg.pivotRight);
  const bos = findLatestBOSUp(bars, pivots, bars.length - 1, cfg.pivotRight);
  if (!bos) return out;

  const bosBar = bars[bos.bosIndex];
  if (bosBar) {
    out.bos = {
      bos_index: bos.bosIndex,
      broken_swing_index: bos.brokenSwingIndex,
      broken_swing_price: bos.brokenSwingPrice,
      bar_timestamp: bosBar.Timestamp,
    };
  }

  const obF = findOrderBlockForBOS(bars, bos.bosIndex, bos.brokenSwingIndex);
  if (!obF) return out;
  const obBar = bars[obF.obIndex];
  if (obBar) {
    const bodyLow = Math.min(obBar.Open, obBar.Close);
    const bodyHigh = Math.max(obBar.Open, obBar.Close);
    const range = obF.obHigh - obF.obLow;
    const lowerWick = bodyLow - obF.obLow;
    out.order_block = {
      ob_index: obF.obIndex,
      ob_low: obF.obLow,
      ob_high: obF.obHigh,
      bar_timestamp: obBar.Timestamp,
      body_low: bodyLow,
      body_high: bodyHigh,
      lower_wick_size: lowerWick,
      lower_wick_pct_of_range: range > 0 ? lowerWick / range : 0,
    };
  }

  const atrAtBos = atrSeries[bos.bosIndex];
  if (Number.isFinite(atrAtBos as number)) {
    const dispATR = displacementATR(bars, obF.obIndex, bos.bosIndex, atrAtBos as number);
    out.displacement = {
      atr_at_bos: atrAtBos as number,
      displacement_atr: dispATR,
      min_required: cfg.minDisplacementATR,
      passed: dispATR >= cfg.minDisplacementATR,
    };
    if (!out.displacement.passed) return out;

    const ob = {
      obIndex: obF.obIndex,
      bosIndex: bos.bosIndex,
      obLow: obF.obLow,
      obHigh: obF.obHigh,
      displacementATR: dispATR,
    };
    const r = findRetestConfirmation(bars, ob, cfg.maxRetestBars, cfg.obBreakBufferPct);
    if (r.kind === "ob_broken") {
      const bk = bars[r.atIndex];
      if (bk) {
        out.retest = {
          kind: "ob_broken",
          at_index: r.atIndex,
          bar_timestamp: bk.Timestamp,
          break_close: bk.Close,
          ob_low: obF.obLow,
          close_minus_ob_low: bk.Close - obF.obLow,
          pct_below_ob_low: obF.obLow > 0 ? ((bk.Close - obF.obLow) / obF.obLow) * 100 : 0,
          bars_in_window_used: r.atIndex - bos.bosIndex,
          max_retest_bars: cfg.maxRetestBars,
        };
      }
    } else if (r.kind === "expired") {
      out.retest = {
        kind: "expired",
        checked_through_index: r.checkedThrough,
        max_retest_bars: cfg.maxRetestBars,
        ob_low: obF.obLow,
        ob_high: obF.obHigh,
      };
    } else {
      out.retest = {
        kind: "confirmed",
        index: r.index,
        bar_timestamp: r.ts,
        close: r.close,
      };
    }
  }

  return out;
}

/**
 * Internal: bump the per-reason counter when evaluate() returns no_trade.
 * Unknown reasons are counted under nothing (additive safety — never crash).
 */
function bumpReasonCounter(reason: string | null | undefined): void {
  if (!reason) return;
  const r = _snapshot.totals.reasons;
  switch (reason) {
    case "no_bos_up": r.no_bos_up++; return;
    case "no_order_block": r.no_order_block++; return;
    case "displacement_too_small": r.displacement_too_small++; return;
    case "ob_broken_before_retest": r.ob_broken_before_retest++; return;
    case "retest_window_expired": r.retest_window_expired++; return;
    case "opposite_bos_before_retest": r.opposite_bos_before_retest++; return;
    case "regime_not_bullish": r.regime_not_bullish++; return;
    case "atr_too_low": r.atr_too_low++; return;
    case "news_window": r.news_window++; return;
    case "insufficient_bars": r.insufficient_bars++; return;
    default: return; // unknown — observe but never fabricate a counter
  }
}

// ── Pipeline entry points ────────────────────────────────────────────────────

export interface RunPipelineInput {
  symbol: string;
  bars: AlpacaBar[];
  data_source?: "alpaca_live" | "fixture" | "unavailable";
  /**
   * M5c: optional asset-class hint. When provided, the runtime adapter picks
   * the per-class retest window (env-var configurable; defaults to baseline).
   * When omitted, the strategy's DEFAULT_CONFIG.maxRetestBars is used. NEVER
   * affects strategy logic beyond which Config is constructed.
   */
  asset_class?: AssetClass;
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

  // M5c: build the per-evaluation strategy config from env-var overrides +
  // asset-class hint. When no env vars are set and no asset class is given,
  // this is byte-for-byte equivalent to DEFAULT_CONFIG (baseline preserved).
  const runCfg = buildRunConfig(input.asset_class);

  let signal: Signal;
  let status: DecisionStatus;
  let reason: string | null = null;

  try {
    signal = evaluate({ symbol: input.symbol, bars: normalized, config: runCfg });
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

  // M5b: read-only recompute of strategy internals for visibility. Pure;
  // never affects `status`, `reason`, or chart_payload.
  // M5c: also surfaces active_config so /api/brain-state shows the actual
  // thresholds enforced by THIS evaluation (env-var aware).
  let diagnostics: PipelineDiagnostics | null = null;
  try {
    diagnostics = normalized.length > 0
      ? computeDiagnostics(normalized, signal, runCfg, input.asset_class)
      : null;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.warn({ symbol: input.symbol, err: errMsg }, "[m2] Diagnostics recompute threw (non-fatal)");
    diagnostics = {
      bos: null, order_block: null, displacement: null, retest: null,
      reason_class: classifyReason(reason ?? undefined),
      active_config: {
        ob_break_buffer_pct: runCfg.obBreakBufferPct,
        max_retest_bars: runCfg.maxRetestBars,
        min_displacement_atr: runCfg.minDisplacementATR,
        asset_class: input.asset_class ?? null,
        source: (runCfg.obBreakBufferPct !== DEFAULT_CONFIG.obBreakBufferPct
                 || runCfg.maxRetestBars !== DEFAULT_CONFIG.maxRetestBars) ? "env_override" : "default",
      },
    };
  }

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
    diagnostics,
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
    bumpReasonCounter(reason);
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

  // M5d-rng: read macro-news-gate state once for this attempt. Never throws
  // (adapter is fail-open with degraded source label). The pre-symbol filter
  // tells the risk pipeline whether THIS symbol's new entry should be blocked.
  let macroState: MacroNewsGateState;
  try {
    macroState = await getMacroNewsGateState();
  } catch (err) {
    // Defensive: adapter already swallows errors, but if anything escapes we
    // must not crash the scanner.
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg, symbol: record.symbol }, "[m2] macro-news-gate adapter unexpected throw");
    macroState = {
      enabled: true,
      active: false,
      reason: `macro_news_gate adapter threw: ${msg}`,
      affected_symbols: [],
      source: "macro-risk-unavailable",
      last_refreshed_at: null,
    };
  }
  const macroForSymbol = evaluateMacroNewsGateForSymbol(macroState, record.symbol);

  // Stamp the GLOBAL state on the snapshot so /api/brain-state can show
  // "what does macro-news see right now" without picking a per-symbol record.
  _snapshot.macro_news_gate = {
    enabled: macroState.enabled,
    active: macroState.active,
    reason: macroState.reason,
    affected_symbols: [...macroState.affected_symbols],
    source: macroState.source,
    last_refreshed_at: macroState.last_refreshed_at,
  };

  // Stamp the per-decision diagnostic. record.diagnostics may be null for
  // pathological inputs (no normalized bars); in that case skip — the global
  // _snapshot.macro_news_gate above still surfaces the state.
  if (record.diagnostics) {
    record.diagnostics.macro_news_gate = {
      enabled: macroState.enabled,
      active: macroState.active,
      reason: macroState.reason,
      affected_symbols: [...macroState.affected_symbols],
      source: macroState.source,
      applies_to_symbol: macroForSymbol.active,
      last_refreshed_at: macroState.last_refreshed_at,
    };
  }

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
    macroNewsGate: macroForSymbol,
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
