import { getBars, type AlpacaBar } from "./alpaca";
import { logger as _logger } from "./logger";
import { orderBookManager } from "./market/orderbook";
import type { OrderBookSnapshot } from "./market/types";
import { setKillSwitchActive } from "./risk_engine";
import { inferAssetClass, type AssetClass } from "./session_guard";

export type ExecutionMarketGuardLevel = "NORMAL" | "WATCH" | "HALT";
export type ExecutionMarketGuardAction = "ALLOW" | "WARN" | "BLOCK";

export type ExecutionMarketGuardReason =
  | "guard_halted"
  | "bars_unavailable"
  | "bar_data_stale"
  | "volatility_elevated"
  | "volatility_extreme"
  | "orderbook_unavailable"
  | "orderbook_stale"
  | "spread_wide"
  | "spread_extreme"
  | "liquidity_thin"
  | "liquidity_critical";

export interface ExecutionMarketGuardMetrics {
  orderbook_available: boolean;
  orderbook_age_ms: number | null;
  spread_bps: number | null;
  top_book_notional_usd: number | null;
  bar_age_ms: number | null;
  atr_pct_1m: number | null;
  rv_1m_pct: number | null;
}

export interface ExecutionMarketGuardPolicy {
  window_ms: number;
  max_critical_window: number;
  max_warning_window: number;
  max_consecutive_critical: number;
  auto_halt: boolean;
  sync_kill_switch_on_halt: boolean;
  fetch_orderbook_on_demand: boolean;
  require_orderbook_for_crypto: boolean;
  require_orderbook_for_other_assets: boolean;
  max_orderbook_age_ms: number;
  max_bar_age_ms: number;
  max_spread_bps: number;
  hard_max_spread_bps: number;
  min_top_book_notional_usd: number;
  max_atr_pct_1m: number;
  max_realized_vol_pct_1m: number;
  bar_lookback: number;
}

export interface ExecutionMarketGuardEvent {
  at: string;
  symbol: string;
  asset_class: AssetClass;
  type: "EVAL_ALLOW" | "EVAL_WARN" | "EVAL_BLOCK" | "GUARD_HALT" | "GUARD_RESET";
  severity: "info" | "warn" | "critical";
  detail: string;
  reasons: ExecutionMarketGuardReason[];
  metrics?: Partial<ExecutionMarketGuardMetrics>;
}

export interface ExecutionMarketGuardSnapshot {
  level: ExecutionMarketGuardLevel;
  halt_active: boolean;
  running_window_ms: number;
  consecutive_critical: number;
  window_critical: number;
  window_warn: number;
  total_events: number;
  last_event_at: string | null;
  last_halt_reason: string | null;
  policy: ExecutionMarketGuardPolicy;
  last_evaluation: {
    at: string | null;
    symbol: string | null;
    asset_class: AssetClass | null;
    action: ExecutionMarketGuardAction;
    allowed: boolean;
    reasons: ExecutionMarketGuardReason[];
    metrics: ExecutionMarketGuardMetrics | null;
  };
  recent_events: ExecutionMarketGuardEvent[];
}

export interface ExecutionMarketGuardDecision {
  allowed: boolean;
  level: ExecutionMarketGuardLevel;
  action: ExecutionMarketGuardAction;
  reasons: ExecutionMarketGuardReason[];
  snapshot: ExecutionMarketGuardSnapshot;
}

const logger = _logger.child({ module: "execution_market_guard" });
const MAX_RECENT_EVENTS = 200;

const DEFAULT_WINDOW_MS = 15 * 60_000;
const DEFAULT_MAX_CRITICAL_WINDOW = 4;
const DEFAULT_MAX_WARNING_WINDOW = 8;
const DEFAULT_MAX_CONSECUTIVE_CRITICAL = 3;
const DEFAULT_MAX_ORDERBOOK_AGE_MS = 10_000;
const DEFAULT_MAX_BAR_AGE_MS = 2 * 60_000;
const DEFAULT_MAX_SPREAD_BPS = 20;
const DEFAULT_HARD_MAX_SPREAD_BPS = 45;
const DEFAULT_MIN_TOP_BOOK_NOTIONAL_USD = 180_000;
const DEFAULT_MAX_ATR_PCT_1M = 0.012;
const DEFAULT_MAX_REALIZED_VOL_PCT_1M = 0.009;
const DEFAULT_BAR_LOOKBACK = 40;

let _level: ExecutionMarketGuardLevel = "NORMAL";
let _haltActive = false;
let _consecutiveCritical = 0;
let _totalEvents = 0;
let _lastEventAt: string | null = null;
let _lastHaltReason: string | null = null;

const _recentEvents: ExecutionMarketGuardEvent[] = [];
const _criticalTimes: number[] = [];
const _warningTimes: number[] = [];

let _lastEvaluation: ExecutionMarketGuardSnapshot["last_evaluation"] = {
  at: null,
  symbol: null,
  asset_class: null,
  action: "ALLOW",
  allowed: true,
  reasons: [],
  metrics: null,
};

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function parseIntEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return clampInt(parsed, min, max);
}

function parseFloatEnv(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(parsed)) return fallback;
  return clampFloat(parsed, min, max);
}

function boolEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const v = value.trim().toLowerCase();
  if (!v) return fallback;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function policy(): ExecutionMarketGuardPolicy {
  return {
    window_ms: parseIntEnv(process.env.EXEC_MARKET_GUARD_WINDOW_MS, DEFAULT_WINDOW_MS, 60_000, 2 * 60 * 60_000),
    max_critical_window: parseIntEnv(process.env.EXEC_MARKET_GUARD_MAX_CRITICAL_WINDOW, DEFAULT_MAX_CRITICAL_WINDOW, 1, 50),
    max_warning_window: parseIntEnv(process.env.EXEC_MARKET_GUARD_MAX_WARNING_WINDOW, DEFAULT_MAX_WARNING_WINDOW, 1, 100),
    max_consecutive_critical: parseIntEnv(
      process.env.EXEC_MARKET_GUARD_MAX_CONSECUTIVE_CRITICAL,
      DEFAULT_MAX_CONSECUTIVE_CRITICAL,
      1,
      20,
    ),
    auto_halt: boolEnv(process.env.EXEC_MARKET_GUARD_AUTO_HALT, true),
    sync_kill_switch_on_halt: boolEnv(process.env.EXEC_MARKET_GUARD_SYNC_KILL_SWITCH_ON_HALT, true),
    fetch_orderbook_on_demand: boolEnv(process.env.EXEC_MARKET_GUARD_FETCH_ORDERBOOK_ON_DEMAND, true),
    require_orderbook_for_crypto: boolEnv(process.env.EXEC_MARKET_GUARD_REQUIRE_ORDERBOOK_CRYPTO, true),
    require_orderbook_for_other_assets: boolEnv(process.env.EXEC_MARKET_GUARD_REQUIRE_ORDERBOOK_OTHER, false),
    max_orderbook_age_ms: parseIntEnv(
      process.env.EXEC_MARKET_GUARD_MAX_ORDERBOOK_AGE_MS,
      DEFAULT_MAX_ORDERBOOK_AGE_MS,
      1_000,
      120_000,
    ),
    max_bar_age_ms: parseIntEnv(process.env.EXEC_MARKET_GUARD_MAX_BAR_AGE_MS, DEFAULT_MAX_BAR_AGE_MS, 10_000, 10 * 60_000),
    max_spread_bps: parseFloatEnv(process.env.EXEC_MARKET_GUARD_MAX_SPREAD_BPS, DEFAULT_MAX_SPREAD_BPS, 1, 500),
    hard_max_spread_bps: parseFloatEnv(process.env.EXEC_MARKET_GUARD_HARD_MAX_SPREAD_BPS, DEFAULT_HARD_MAX_SPREAD_BPS, 2, 800),
    min_top_book_notional_usd: parseFloatEnv(
      process.env.EXEC_MARKET_GUARD_MIN_TOP_BOOK_NOTIONAL_USD,
      DEFAULT_MIN_TOP_BOOK_NOTIONAL_USD,
      1_000,
      50_000_000,
    ),
    max_atr_pct_1m: parseFloatEnv(process.env.EXEC_MARKET_GUARD_MAX_ATR_PCT_1M, DEFAULT_MAX_ATR_PCT_1M, 0.001, 0.25),
    max_realized_vol_pct_1m: parseFloatEnv(
      process.env.EXEC_MARKET_GUARD_MAX_REALIZED_VOL_PCT_1M,
      DEFAULT_MAX_REALIZED_VOL_PCT_1M,
      0.001,
      0.25,
    ),
    bar_lookback: parseIntEnv(process.env.EXEC_MARKET_GUARD_BAR_LOOKBACK, DEFAULT_BAR_LOOKBACK, 20, 200),
  };
}

function pushEvent(event: ExecutionMarketGuardEvent): void {
  _recentEvents.unshift(event);
  if (_recentEvents.length > MAX_RECENT_EVENTS) _recentEvents.pop();
  _totalEvents += 1;
  _lastEventAt = event.at;
}

function pruneWindow(nowMs: number, p: ExecutionMarketGuardPolicy): void {
  const cutoff = nowMs - p.window_ms;
  while (_criticalTimes.length > 0 && _criticalTimes[0] < cutoff) _criticalTimes.shift();
  while (_warningTimes.length > 0 && _warningTimes[0] < cutoff) _warningTimes.shift();
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function computeOrderbookMetrics(snapshot: OrderBookSnapshot | null): {
  orderbook_available: boolean;
  orderbook_age_ms: number | null;
  spread_bps: number | null;
  top_book_notional_usd: number | null;
} {
  if (!snapshot || snapshot.asks.length === 0 || snapshot.bids.length === 0) {
    return {
      orderbook_available: false,
      orderbook_age_ms: null,
      spread_bps: null,
      top_book_notional_usd: null,
    };
  }

  const bestAsk = snapshot.asks[0]?.price ?? 0;
  const bestBid = snapshot.bids[0]?.price ?? 0;
  const mid = (bestAsk + bestBid) / 2;
  const spreadBps = mid > 0 ? ((bestAsk - bestBid) / mid) * 10_000 : null;

  const depth = 10;
  const asks = snapshot.asks.slice(0, depth);
  const bids = snapshot.bids.slice(0, depth);
  const totalSize = asks.reduce((sum, level) => sum + level.size, 0) + bids.reduce((sum, level) => sum + level.size, 0);
  const topNotional = mid > 0 ? totalSize * mid : null;

  return {
    orderbook_available: true,
    orderbook_age_ms: Math.max(0, Date.now() - snapshot.receivedAt),
    spread_bps: Number.isFinite(spreadBps ?? Number.NaN) ? Number((spreadBps ?? 0).toFixed(2)) : null,
    top_book_notional_usd: Number.isFinite(topNotional ?? Number.NaN) ? Number((topNotional ?? 0).toFixed(2)) : null,
  };
}

function computeBarMetrics(bars: AlpacaBar[], nowMs: number): {
  bar_age_ms: number | null;
  atr_pct_1m: number | null;
  rv_1m_pct: number | null;
} {
  if (!bars.length) {
    return {
      bar_age_ms: null,
      atr_pct_1m: null,
      rv_1m_pct: null,
    };
  }

  const closes = bars
    .map((bar) => Number(bar.Close ?? bar.c ?? Number.NaN))
    .filter((price) => Number.isFinite(price) && price > 0);

  const trs: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const current = bars[i]!;
    const prev = bars[i - 1]!;
    const high = Number(current.High ?? current.h ?? Number.NaN);
    const low = Number(current.Low ?? current.l ?? Number.NaN);
    const prevClose = Number(prev.Close ?? prev.c ?? Number.NaN);
    if (!Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(prevClose)) continue;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    if (Number.isFinite(tr) && tr >= 0) trs.push(tr);
  }

  const atrWindow = trs.slice(-14);
  const atr = atrWindow.length > 0 ? atrWindow.reduce((sum, value) => sum + value, 0) / atrWindow.length : 0;
  const lastClose = closes[closes.length - 1] ?? 0;
  const atrPct = lastClose > 0 && atr > 0 ? atr / lastClose : 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    const curr = closes[i]!;
    if (prev > 0 && curr > 0) returns.push(Math.log(curr / prev));
  }
  const rv = returns.length >= 2 ? stdDev(returns) : 0;

  const latestTimestamp = bars[bars.length - 1]?.Timestamp ?? bars[bars.length - 1]?.t ?? null;
  const barTsMs = latestTimestamp ? Date.parse(latestTimestamp) : Number.NaN;
  const barAgeMs = Number.isFinite(barTsMs) ? Math.max(0, nowMs - barTsMs) : null;

  return {
    bar_age_ms: barAgeMs,
    atr_pct_1m: Number.isFinite(atrPct) ? Number(atrPct.toFixed(6)) : null,
    rv_1m_pct: Number.isFinite(rv) ? Number(rv.toFixed(6)) : null,
  };
}

function maybeHalt(reason: string, p: ExecutionMarketGuardPolicy): void {
  if (_haltActive) return;
  _level = "HALT";
  _haltActive = true;
  _lastHaltReason = reason;
  const nowIso = new Date().toISOString();
  pushEvent({
    at: nowIso,
    symbol: "SYSTEM",
    asset_class: "crypto",
    type: "GUARD_HALT",
    severity: "critical",
    detail: reason,
    reasons: ["guard_halted"],
  });
  logger.fatal({ reason }, "[market-guard] HALT triggered");
  if (p.sync_kill_switch_on_halt) {
    setKillSwitchActive(true);
  }
}

function updateLastEvaluation(input: {
  at: string;
  symbol: string;
  assetClass: AssetClass;
  action: ExecutionMarketGuardAction;
  allowed: boolean;
  reasons: ExecutionMarketGuardReason[];
  metrics: ExecutionMarketGuardMetrics;
}): void {
  _lastEvaluation = {
    at: input.at,
    symbol: input.symbol,
    asset_class: input.assetClass,
    action: input.action,
    allowed: input.allowed,
    reasons: [...input.reasons],
    metrics: { ...input.metrics },
  };
}

export async function evaluateExecutionMarketGuard(input: {
  symbol: string;
}): Promise<ExecutionMarketGuardDecision> {
  const p = policy();
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const symbol = String(input.symbol ?? "UNKNOWN").trim().toUpperCase() || "UNKNOWN";
  const assetClass = inferAssetClass(symbol);

  pruneWindow(nowMs, p);

  if (_haltActive) {
    const reasons: ExecutionMarketGuardReason[] = ["guard_halted"];
    const metrics: ExecutionMarketGuardMetrics = {
      orderbook_available: false,
      orderbook_age_ms: null,
      spread_bps: null,
      top_book_notional_usd: null,
      bar_age_ms: null,
      atr_pct_1m: null,
      rv_1m_pct: null,
    };
    updateLastEvaluation({
      at: nowIso,
      symbol,
      assetClass,
      action: "BLOCK",
      allowed: false,
      reasons,
      metrics,
    });
    pushEvent({
      at: nowIso,
      symbol,
      asset_class: assetClass,
      type: "EVAL_BLOCK",
      severity: "critical",
      detail: "guard_halted",
      reasons,
    });
    return {
      allowed: false,
      level: "HALT",
      action: "BLOCK",
      reasons,
      snapshot: getExecutionMarketGuardSnapshot(),
    };
  }

  const requireOrderbook = assetClass === "crypto"
    ? p.require_orderbook_for_crypto
    : p.require_orderbook_for_other_assets;

  let snapshot: OrderBookSnapshot | null = null;
  if (requireOrderbook) {
    snapshot = orderBookManager.getSnapshot(symbol);
    if (!snapshot && p.fetch_orderbook_on_demand) {
      try {
        snapshot = await orderBookManager.fetchSnapshot(symbol);
      } catch (err) {
        logger.warn({ err, symbol }, "[market-guard] failed to fetch orderbook snapshot on demand");
      }
    }
  }

  let bars: AlpacaBar[] = [];
  let barsErr = false;
  try {
    bars = await getBars(symbol, "1Min", p.bar_lookback);
  } catch (err) {
    barsErr = true;
    logger.warn({ err, symbol }, "[market-guard] failed to fetch bars");
  }

  const obMetrics = computeOrderbookMetrics(snapshot);
  const barMetrics = computeBarMetrics(bars, nowMs);
  const metrics: ExecutionMarketGuardMetrics = {
    orderbook_available: obMetrics.orderbook_available,
    orderbook_age_ms: obMetrics.orderbook_age_ms,
    spread_bps: obMetrics.spread_bps,
    top_book_notional_usd: obMetrics.top_book_notional_usd,
    bar_age_ms: barMetrics.bar_age_ms,
    atr_pct_1m: barMetrics.atr_pct_1m,
    rv_1m_pct: barMetrics.rv_1m_pct,
  };

  const warningReasons: ExecutionMarketGuardReason[] = [];
  const criticalReasons: ExecutionMarketGuardReason[] = [];

  if (requireOrderbook) {
    if (!metrics.orderbook_available) {
      criticalReasons.push("orderbook_unavailable");
    } else {
      const orderbookAge = metrics.orderbook_age_ms ?? Number.POSITIVE_INFINITY;
      if (orderbookAge > p.max_orderbook_age_ms * 2) {
        criticalReasons.push("orderbook_stale");
      } else if (orderbookAge > p.max_orderbook_age_ms) {
        warningReasons.push("orderbook_stale");
      }

      const spreadBps = metrics.spread_bps ?? Number.POSITIVE_INFINITY;
      if (spreadBps > p.hard_max_spread_bps) {
        criticalReasons.push("spread_extreme");
      } else if (spreadBps > p.max_spread_bps) {
        warningReasons.push("spread_wide");
      }

      const topNotional = metrics.top_book_notional_usd ?? 0;
      if (topNotional < p.min_top_book_notional_usd * 0.5) {
        criticalReasons.push("liquidity_critical");
      } else if (topNotional < p.min_top_book_notional_usd) {
        warningReasons.push("liquidity_thin");
      }
    }
  }

  if (barsErr || bars.length === 0) {
    criticalReasons.push("bars_unavailable");
  } else {
    const barAge = metrics.bar_age_ms ?? Number.POSITIVE_INFINITY;
    if (barAge > p.max_bar_age_ms * 2) {
      criticalReasons.push("bar_data_stale");
    } else if (barAge > p.max_bar_age_ms) {
      warningReasons.push("bar_data_stale");
    }

    const atrPct = metrics.atr_pct_1m ?? 0;
    if (atrPct > p.max_atr_pct_1m * 1.8) {
      criticalReasons.push("volatility_extreme");
    } else if (atrPct > p.max_atr_pct_1m) {
      warningReasons.push("volatility_elevated");
    }

    const rvPct = metrics.rv_1m_pct ?? 0;
    if (rvPct > p.max_realized_vol_pct_1m * 1.8) {
      criticalReasons.push("volatility_extreme");
    } else if (rvPct > p.max_realized_vol_pct_1m) {
      warningReasons.push("volatility_elevated");
    }
  }

  const uniqueWarnings = Array.from(new Set(warningReasons));
  const uniqueCritical = Array.from(new Set(criticalReasons));
  const reasons = [...uniqueCritical, ...uniqueWarnings];

  if (uniqueCritical.length > 0) {
    _criticalTimes.push(nowMs);
    _consecutiveCritical += 1;
  } else {
    _consecutiveCritical = 0;
    if (uniqueWarnings.length > 0) {
      _warningTimes.push(nowMs);
    }
  }

  pruneWindow(nowMs, p);

  if (
    p.auto_halt &&
    (_consecutiveCritical >= p.max_consecutive_critical || _criticalTimes.length >= p.max_critical_window)
  ) {
    const reason = _consecutiveCritical >= p.max_consecutive_critical
      ? `consecutive_critical_exceeded:${_consecutiveCritical}/${p.max_consecutive_critical}`
      : `window_critical_exceeded:${_criticalTimes.length}/${p.max_critical_window}`;
    maybeHalt(reason, p);
  }

  let action: ExecutionMarketGuardAction = "ALLOW";
  let allowed = true;

  if (_haltActive || uniqueCritical.length > 0) {
    action = "BLOCK";
    allowed = false;
  } else if (uniqueWarnings.length > 0) {
    action = "WARN";
  }

  if (_haltActive) {
    if (!reasons.includes("guard_halted")) reasons.unshift("guard_halted");
    _level = "HALT";
    allowed = false;
    action = "BLOCK";
  } else if (uniqueCritical.length > 0) {
    _level = "HALT";
  } else if (uniqueWarnings.length > 0 || _warningTimes.length >= Math.max(2, Math.floor(p.max_warning_window / 2))) {
    _level = "WATCH";
  } else {
    _level = "NORMAL";
  }

  updateLastEvaluation({
    at: nowIso,
    symbol,
    assetClass,
    action,
    allowed,
    reasons,
    metrics,
  });

  pushEvent({
    at: nowIso,
    symbol,
    asset_class: assetClass,
    type: action === "ALLOW" ? "EVAL_ALLOW" : action === "WARN" ? "EVAL_WARN" : "EVAL_BLOCK",
    severity: action === "ALLOW" ? "info" : action === "WARN" ? "warn" : "critical",
    detail: reasons.length > 0 ? reasons.join(",") : "market_quality_ok",
    reasons,
    metrics: {
      spread_bps: metrics.spread_bps,
      top_book_notional_usd: metrics.top_book_notional_usd,
      bar_age_ms: metrics.bar_age_ms,
      rv_1m_pct: metrics.rv_1m_pct,
    },
  });

  return {
    allowed,
    level: _level,
    action,
    reasons,
    snapshot: getExecutionMarketGuardSnapshot(),
  };
}

export function resetExecutionMarketGuard(input?: {
  reason?: string;
  clearKillSwitch?: boolean;
}): ExecutionMarketGuardSnapshot {
  _level = "NORMAL";
  _haltActive = false;
  _consecutiveCritical = 0;
  _lastHaltReason = null;
  _criticalTimes.length = 0;
  _warningTimes.length = 0;

  const nowIso = new Date().toISOString();
  pushEvent({
    at: nowIso,
    symbol: "SYSTEM",
    asset_class: "crypto",
    type: "GUARD_RESET",
    severity: "info",
    detail: input?.reason ?? "manual_reset",
    reasons: [],
  });

  _lastEvaluation = {
    at: nowIso,
    symbol: "SYSTEM",
    asset_class: "crypto",
    action: "ALLOW",
    allowed: true,
    reasons: [],
    metrics: null,
  };

  if (input?.clearKillSwitch) {
    setKillSwitchActive(false);
  }

  logger.warn({ reason: input?.reason ?? "manual_reset" }, "[market-guard] reset");
  return getExecutionMarketGuardSnapshot();
}

export function getExecutionMarketGuardSnapshot(): ExecutionMarketGuardSnapshot {
  const p = policy();
  const nowMs = Date.now();
  pruneWindow(nowMs, p);

  return {
    level: _level,
    halt_active: _haltActive,
    running_window_ms: p.window_ms,
    consecutive_critical: _consecutiveCritical,
    window_critical: _criticalTimes.length,
    window_warn: _warningTimes.length,
    total_events: _totalEvents,
    last_event_at: _lastEventAt,
    last_halt_reason: _lastHaltReason,
    policy: p,
    last_evaluation: {
      at: _lastEvaluation.at,
      symbol: _lastEvaluation.symbol,
      asset_class: _lastEvaluation.asset_class,
      action: _lastEvaluation.action,
      allowed: _lastEvaluation.allowed,
      reasons: [..._lastEvaluation.reasons],
      metrics: _lastEvaluation.metrics ? { ..._lastEvaluation.metrics } : null,
    },
    recent_events: [..._recentEvents],
  };
}
