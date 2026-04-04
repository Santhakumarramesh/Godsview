/**
 * Production Gate — Final approval layer before any order execution.
 *
 * Wraps Super Intelligence + Risk Engine into a single call that
 * the brain bridge / signal pipeline invokes before placing orders.
 *
 * Market Production Readiness Checklist:
 * ✓ Ensemble ML (GBM + LR) win probability > 55%
 * ✓ Kelly Criterion position sizing (quarter-Kelly, 0.5%-3%)
 * ✓ Regime-adaptive quality thresholds
 * ✓ Multi-timeframe confluence (2/3 aligned)
 * ✓ Positive expected value (edge_score > 0)
 * ✓ Risk engine constraints (daily loss, concurrent positions)
 * ✓ Trailing stop + partial profit targets
 * ✓ Drawdown circuit breaker
 * ✓ Session filter (only trade allowed sessions)
 * ✓ Spread/slippage guard
 */

import {
  processSuperSignal,
  type SuperSignal,
  type SuperIntelligenceInput,
} from "./super_intelligence";
import {
  getRiskEngineSnapshot,
  isKillSwitchActive,
  isSessionAllowed,
  getCurrentTradingSession,
} from "./risk_engine";
import { emitSIDecision } from "./signal_stream";
import { getStrategyAllocationForSignal, getStrategyAllocatorSnapshot } from "./strategy_allocator";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ProductionDecision {
  /** Final verdict: execute, reject, or degrade */
  action: "EXECUTE" | "BLOCKED_BY_RISK" | "BLOCKED_BY_SI" | "BLOCKED_BY_SESSION" | "KILL_SWITCH";
  /** The full Super Intelligence output */
  signal: SuperSignal;
  /** Position size in units */
  quantity: number;
  /** Dollar risk for this trade */
  dollar_risk: number;
  /** All reasons for block/degrade */
  block_reasons: string[];
  /** Production metadata */
  meta: {
    win_probability: number;
    edge_score: number;
    kelly_pct: string;
    regime: string;
    confluence: number;
    strategy_multiplier: number;
    strategy_allocation_level: string;
    strategy_id: string | null;
    strategy_score: number;
    risk_snapshot: Record<string, unknown>;
    timestamp: string;
  };
}

// ── Production Thresholds ──────────────────────────────────────────────────

const PROD_MIN_WIN_PROB = 0.57;       // Higher than SI's 55% for production
const PROD_MIN_EDGE = 0.08;           // Need meaningful positive EV
const PROD_MAX_SPREAD_PCT = 0.003;    // 0.3% max spread
const PROD_MIN_VOLUME = 1000;         // Minimum volume for liquidity
const PROD_MAX_DAILY_TRADES = 15;     // Cap overtrading
const PROD_COOLDOWN_MS = 60_000;      // 1 min between trades same symbol

// Track recent trades for cooldown
const recentTrades = new Map<string, number>();
let dailyTradeCount = 0;
let lastResetDay = new Date().toDateString();

function resetDailyIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== lastResetDay) {
    dailyTradeCount = 0;
    recentTrades.clear();
    lastResetDay = today;
  }
}

// ── Main Production Gate ───────────────────────────────────────────────────

export async function evaluateForProduction(
  input: SuperIntelligenceInput & {
    spread?: number;
    volume?: number;
    symbol: string;
  }
): Promise<ProductionDecision> {
  resetDailyIfNeeded();
  const blockReasons: string[] = [];
  const now = Date.now();

  // 1. Kill switch check
  if (isKillSwitchActive()) {
    const signal = await processSuperSignal(0, input.symbol, input);
    return buildDecision("KILL_SWITCH", signal, 0, 0, ["Kill switch is active"], input);
  }

  // 2. Session check
  const currentSession = getCurrentTradingSession();
  if (!isSessionAllowed(currentSession)) {
    const signal = await processSuperSignal(0, input.symbol, input);
    return buildDecision("BLOCKED_BY_SESSION", signal, 0, 0, [`Outside allowed trading session (${currentSession})`], input);
  }

  // 3. Daily trade cap
  if (dailyTradeCount >= PROD_MAX_DAILY_TRADES) {
    const signal = await processSuperSignal(0, input.symbol, input);
    return buildDecision("BLOCKED_BY_RISK", signal, 0, 0,
      [`Daily trade limit reached (${dailyTradeCount}/${PROD_MAX_DAILY_TRADES})`], input);
  }

  // 4. Cooldown per symbol
  const lastTrade = recentTrades.get(input.symbol);
  if (lastTrade && now - lastTrade < PROD_COOLDOWN_MS) {
    const signal = await processSuperSignal(0, input.symbol, input);
    const remaining = Math.ceil((PROD_COOLDOWN_MS - (now - lastTrade)) / 1000);
    return buildDecision("BLOCKED_BY_RISK", signal, 0, 0,
      [`Symbol cooldown: ${remaining}s remaining for ${input.symbol}`], input);
  }

  // 5. Spread guard
  if (input.spread !== undefined && input.spread > 0) {
    const spreadPct = input.spread / input.entry_price;
    if (spreadPct > PROD_MAX_SPREAD_PCT) {
      blockReasons.push(`Spread ${(spreadPct * 100).toFixed(2)}% exceeds ${(PROD_MAX_SPREAD_PCT * 100).toFixed(1)}% limit`);
    }
  }

  // 6. Volume guard
  if (input.volume !== undefined && input.volume < PROD_MIN_VOLUME) {
    blockReasons.push(`Volume ${input.volume} below minimum ${PROD_MIN_VOLUME}`);
  }

  // 7. Risk engine snapshot check
  const riskSnap = getRiskEngineSnapshot();
  if (riskSnap.runtime.killSwitchActive) {
    blockReasons.push("Kill switch active in risk engine");
  }
  // Note: daily PnL and open position counts are tracked at the order
  // execution layer (Alpaca). The risk engine config provides thresholds
  // that the brain bridge enforces per-cycle.

  // 8. Run Super Intelligence pipeline
  const signal = await processSuperSignal(0, input.symbol, input);

  // 9. Super Intelligence gate
  if (!signal.approved) {
    blockReasons.push(signal.rejection_reason ?? "Super Intelligence rejected signal");
  }

  // 10. Production-grade thresholds (stricter than SI defaults)
  if (signal.win_probability < PROD_MIN_WIN_PROB) {
    blockReasons.push(`Win prob ${(signal.win_probability * 100).toFixed(1)}% below production minimum ${(PROD_MIN_WIN_PROB * 100).toFixed(0)}%`);
  }
  if (signal.edge_score < PROD_MIN_EDGE) {
    blockReasons.push(`Edge score ${signal.edge_score.toFixed(3)} below production minimum ${PROD_MIN_EDGE}`);
  }

  // 11. Strategy-level allocator multiplier (walk-forward + validation aware)
  const allocation = getStrategyAllocationForSignal({
    setup_type: input.setup_type,
    regime: input.regime,
    symbol: input.symbol,
  });
  if (allocation.multiplier <= 0) {
    blockReasons.push("Strategy allocator multiplier is zero");
  }

  // Calculate position details
  const risk = Math.abs(input.entry_price - input.stop_loss);
  const quantity = Math.max(0, Math.round(signal.suggested_qty * allocation.multiplier));
  const dollarRisk = quantity * risk;
  if (signal.suggested_qty > 0 && quantity <= 0) {
    blockReasons.push(`Strategy allocation reduced quantity to zero (${allocation.match_level})`);
  }

  // If any block reasons, reject
  if (blockReasons.length > 0) {
    return buildDecision("BLOCKED_BY_SI", signal, 0, 0, blockReasons, input, allocation);
  }

  // ✅ APPROVED — record trade and return execution decision
  dailyTradeCount++;
  recentTrades.set(input.symbol, now);

  return buildDecision("EXECUTE", signal, quantity, dollarRisk, [], input, allocation);
}

function buildDecision(
  action: ProductionDecision["action"],
  signal: SuperSignal,
  quantity: number,
  dollarRisk: number,
  blockReasons: string[],
  input: SuperIntelligenceInput & { symbol: string },
  allocation?: {
    multiplier: number;
    match_level: string;
    strategy_id: string | null;
    score: number;
  },
): ProductionDecision {
  const riskSnap = getRiskEngineSnapshot();
  const decision: ProductionDecision = {
    action,
    signal,
    quantity,
    dollar_risk: dollarRisk,
    block_reasons: blockReasons,
    meta: {
      win_probability: signal.win_probability,
      edge_score: signal.edge_score,
      kelly_pct: `${(signal.kelly_fraction * 100).toFixed(2)}%`,
      regime: input.regime,
      confluence: signal.confluence_score,
      strategy_multiplier: allocation?.multiplier ?? 1,
      strategy_allocation_level: allocation?.match_level ?? "NONE",
      strategy_id: allocation?.strategy_id ?? null,
      strategy_score: allocation?.score ?? 0.5,
      risk_snapshot: riskSnap as unknown as Record<string, unknown>,
      timestamp: new Date().toISOString(),
    },
  };

  // Broadcast every production decision to the SI live feed (SSE)
  emitSIDecision({
    symbol: input.symbol,
    action,
    direction: input.direction,
    setup_type: input.setup_type,
    regime: input.regime,
    win_probability: signal.win_probability,
    edge_score: signal.edge_score,
    kelly_pct: decision.meta.kelly_pct,
    confluence: signal.confluence_score,
    aligned_timeframes: signal.aligned_timeframes,
    enhanced_quality: signal.enhanced_quality,
    approved: signal.approved,
    rejection_reason: signal.rejection_reason,
    block_reasons: blockReasons,
    kelly_fraction: signal.kelly_fraction,
    suggested_qty: quantity,
    timestamp: decision.meta.timestamp,
  });

  return decision;
}

/** Get production gate stats for dashboard */
export function getProductionGateStats() {
  resetDailyIfNeeded();
  const allocator = getStrategyAllocatorSnapshot();
  return {
    daily_trades: dailyTradeCount,
    max_daily_trades: PROD_MAX_DAILY_TRADES,
    cooldown_ms: PROD_COOLDOWN_MS,
    min_win_prob: PROD_MIN_WIN_PROB,
    min_edge: PROD_MIN_EDGE,
    max_spread_pct: PROD_MAX_SPREAD_PCT,
    strategy_allocator_running: allocator.running,
    strategy_allocator_allocations: allocator.allocation_count,
    strategy_allocator_last_status: allocator.last_validation_status,
    active_cooldowns: Array.from(recentTrades.entries()).map(([sym, ts]) => ({
      symbol: sym,
      expires_in_ms: Math.max(0, PROD_COOLDOWN_MS - (Date.now() - ts)),
    })),
  };
}
