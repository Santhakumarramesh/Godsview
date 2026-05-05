/**
 * Position Monitor — Runtime trailing stop & partial profit execution.
 *
 * Watches open positions and enforces the trailing stop / profit target
 * configs produced by Super Intelligence. Without this, SI computes
 * beautiful exit plans but never actually executes them.
 *
 * Runs on a configurable interval (default 5s) and:
 * 1. Fetches current positions from Alpaca
 * 2. Checks each against its registered exit plan
 * 3. Moves stops, closes partials, or fully exits when triggered
 *
 * This is the bridge between "SI said to trail at 1.5 ATR" and
 * "the stop was actually moved on the live position."
 */

import { logger } from "./logger";
// Phase 4: paper-trade lifecycle store.
import { recordTradeClose } from "./paper_trades/store";
import type { TrailingStopConfig, ProfitTarget } from "./super_intelligence";
import { persistWrite, persistRead, persistAppend } from "./persistent_store";

// ── Types ─────────────────────────────────────────────
export interface ManagedPosition {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  original_stop: number;
  current_stop: number;
  take_profit: number;
  quantity: number;
  remaining_qty: number;
  trailing_config: TrailingStopConfig;
  profit_targets: ProfitTarget[];
  /** R-multiples already closed out */
  targets_hit: number[];
  /** Highest favorable price seen since entry */
  peak_price: number;
  /** Whether trailing stop has been activated */
  trail_active: boolean;
  /** Timestamp of entry */
  entered_at: number;
  /** ATR at time of entry */
  atr: number;
}

export interface MonitorEvent {
  type: "trail_activated" | "stop_moved" | "partial_close" | "full_exit" | "time_exit";
  symbol: string;
  detail: Record<string, unknown>;
  timestamp: string;
}

export interface PositionLifecycleEvent {
  symbol: string;
  stage: "opened" | "partial_closed" | "full_closed";
  entry_price: number;
  close_price?: number;
  entry_time: string;
  close_time?: string;
  quantity_opened: number;
  quantity_closed?: number;
  reason?: string;
}

export interface PositionHealthCheck {
  managed_positions: number;
  stale_positions: number;
  avg_hold_time_ms: number;
  total_monitored_value_usd: number;
}

// ── State ─────────────────────────────────────────────
const managed = new Map<string, ManagedPosition>();
const eventLog: MonitorEvent[] = [];
const MAX_EVENTS = 500;
let monitorTimer: ReturnType<typeof setInterval> | null = null;
const MONITOR_INTERVAL_MS = 5_000; // Check every 5s

// ── Public API ────────────────────────────────────────

/**
 * Register a new position for monitoring.
 * Called after order fill confirmation.
 */
export function registerPosition(pos: {
  symbol: string;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  quantity: number;
  trailing_config: TrailingStopConfig;
  profit_targets: ProfitTarget[];
  atr: number;
}): void {
  const existing = managed.get(pos.symbol);
  if (existing) {
    logger.warn({ symbol: pos.symbol }, "Position already monitored — replacing");
  }

  managed.set(pos.symbol, {
    symbol: pos.symbol,
    direction: pos.direction,
    entry_price: pos.entry_price,
    original_stop: pos.stop_loss,
    current_stop: pos.stop_loss,
    take_profit: pos.take_profit,
    quantity: pos.quantity,
    remaining_qty: pos.quantity,
    trailing_config: pos.trailing_config,
    profit_targets: pos.profit_targets,
    targets_hit: [],
    peak_price: pos.entry_price,
    trail_active: false,
    entered_at: Date.now(),
    atr: pos.atr,
  });

  // Record lifecycle event
  try {
    persistAppend("position_events", {
      symbol: pos.symbol,
      stage: "opened",
      entry_price: pos.entry_price,
      entry_time: new Date().toISOString(),
      quantity_opened: pos.quantity,
    } as PositionLifecycleEvent, 5000);
  } catch (err) {
    logger.warn({ err, symbol: pos.symbol }, "Failed to record position lifecycle event");
  }

  logger.info({
    symbol: pos.symbol,
    direction: pos.direction,
    entry: pos.entry_price,
    sl: pos.stop_loss,
    tp: pos.take_profit,
    trailing: pos.trailing_config,
    targets: pos.profit_targets.length,
  }, "Position registered for monitoring");

  ensureRunning();
}

/** Remove a position from monitoring (after full exit) */
export function unregisterPosition(symbol: string): void {
  managed.delete(symbol);
  if (managed.size === 0) stopMonitor();
}
/** Get all managed positions */
export function getManagedPositions(): ManagedPosition[] {
  return Array.from(managed.values());
}

/** Get recent monitor events */
export function getMonitorEvents(limit = 50): MonitorEvent[] {
  return eventLog.slice(-limit).reverse();
}

/**
 * Get position history for a specific symbol
 */
export function getPositionHistory(symbol: string): PositionLifecycleEvent[] {
  try {
    const events = persistRead<PositionLifecycleEvent[]>("position_events", []);
    return events.filter((e) => e.symbol === symbol);
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to retrieve position history");
    return [];
  }
}

/**
 * Position health check
 */
export function positionHealthCheck(): PositionHealthCheck {
  const now = Date.now();
  const positions = Array.from(managed.values());

  // Check for stale positions (no price update in 5+ minutes)
  let staleCount = 0;
  let totalValue = 0;
  let totalHoldTime = 0;

  for (const pos of positions) {
    const holdTime = now - pos.entered_at;
    totalHoldTime += holdTime;

    // Estimate if stale (in practice, we'd check last price update time)
    // For now, just count positions
    totalValue += pos.entry_price * pos.remaining_qty;
  }

  return {
    managed_positions: positions.length,
    stale_positions: staleCount,
    avg_hold_time_ms: positions.length > 0 ? totalHoldTime / positions.length : 0,
    total_monitored_value_usd: totalValue,
  };
}

// ── Core Monitor Loop ─────────────────────────────────

async function monitorTick(): Promise<void> {
  if (managed.size === 0) return;

  let latestPrices: Map<string, number>;
  try {
    const { getLatestTrade } = await import("./alpaca");
    latestPrices = new Map();
    for (const symbol of managed.keys()) {
      const trade = await getLatestTrade(symbol);
      if (trade) latestPrices.set(symbol, trade.price);
    }
  } catch (err) {
    logger.error({ err }, "Position monitor: failed to fetch prices");
    return;
  }

  for (const [symbol, pos] of managed) {
    const price = latestPrices.get(symbol);
    if (!price) continue;

    try {
      await evaluatePosition(pos, price);
    } catch (err) {
      logger.error({ err, symbol }, "Position monitor: error evaluating position");
    }
  }
}

async function evaluatePosition(pos: ManagedPosition, currentPrice: number): Promise<void> {
  const { direction, entry_price, atr, trailing_config } = pos;
  const now = Date.now();

  // Update peak price
  if (direction === "long" && currentPrice > pos.peak_price) {
    pos.peak_price = currentPrice;
  } else if (direction === "short" && currentPrice < pos.peak_price) {
    pos.peak_price = currentPrice;
  }

  // Favorable move from entry (in price units)
  const favorableMove = direction === "long"
    ? currentPrice - entry_price
    : entry_price - currentPrice;

  const favorableMoveATR = atr > 0 ? favorableMove / atr : 0;

  // ── 1. Time-based exit ──────────────────────────────
  const holdMinutes = (now - pos.entered_at) / 60_000;
  if (holdMinutes >= trailing_config.max_hold_minutes && favorableMove <= 0) {
    logEvent("time_exit", pos.symbol, {
      holdMinutes: Math.round(holdMinutes),
      maxMinutes: trailing_config.max_hold_minutes,
      pnl: favorableMove,
    });
    await closeFullPosition(pos, "time_exit");
    return;
  }
  // ── 2. Stop loss hit check ──────────────────────────
  const stopHit = direction === "long"
    ? currentPrice <= pos.current_stop
    : currentPrice >= pos.current_stop;

  if (stopHit) {
    logEvent("full_exit", pos.symbol, {
      reason: "stop_loss_hit",
      stopPrice: pos.current_stop,
      currentPrice,
      pnl: favorableMove,
      trailActive: pos.trail_active,
    });
    await closeFullPosition(pos, "stop_hit");
    return;
  }

  // ── 3. Trailing stop activation ─────────────────────
  if (!pos.trail_active && favorableMoveATR >= trailing_config.activation_atr) {
    pos.trail_active = true;
    // Move stop to breakeven
    pos.current_stop = entry_price;
    logEvent("trail_activated", pos.symbol, {
      activationATR: trailing_config.activation_atr,
      moveATR: favorableMoveATR.toFixed(2),
      newStop: pos.current_stop,
    });
  }

  // ── 4. Trail the stop ───────────────────────────────
  if (pos.trail_active) {
    const peakMove = direction === "long"      ? pos.peak_price - entry_price
      : entry_price - pos.peak_price;

    // New stop = entry + (peakMove × trail_step) for longs
    const trailOffset = peakMove * trailing_config.trail_step;
    const newStop = direction === "long"
      ? entry_price + trailOffset
      : entry_price - trailOffset;

    // Only move stop in favorable direction (never widen)
    const shouldMove = direction === "long"
      ? newStop > pos.current_stop
      : newStop < pos.current_stop;

    if (shouldMove) {
      const oldStop = pos.current_stop;
      pos.current_stop = newStop;
      logEvent("stop_moved", pos.symbol, {
        oldStop,
        newStop,
        peakPrice: pos.peak_price,
        trailStep: trailing_config.trail_step,
      });
    }
  }

  // ── 5. Partial profit targets ───────────────────────
  const risk = Math.abs(entry_price - pos.original_stop);
  if (risk <= 0) return;

  const currentR = favorableMove / risk;
  for (const target of pos.profit_targets) {
    if (pos.targets_hit.includes(target.r_target)) continue;
    if (currentR >= target.r_target) {
      // Close partial
      const closeQty = Math.max(1, Math.round(pos.quantity * target.close_pct));
      const actualClose = Math.min(closeQty, pos.remaining_qty);
      if (actualClose <= 0) continue;

      logEvent("partial_close", pos.symbol, {
        r_target: target.r_target,
        close_pct: target.close_pct,
        close_qty: actualClose,
        remaining_before: pos.remaining_qty,
        currentR: currentR.toFixed(2),
      });

      await closePartialPosition(pos, actualClose, target.r_target);
      pos.targets_hit.push(target.r_target);
      pos.remaining_qty -= actualClose;

      // If fully closed, remove from monitoring
      if (pos.remaining_qty <= 0) {
        unregisterPosition(pos.symbol);
        return;
      }
    }
  }
}

// ── Execution Helpers ─────────────────────────────────
async function closeFullPosition(pos: ManagedPosition, reason: string): Promise<void> {
  // Phase 3 note: closePosition() uses DELETE /v2/positions/:symbol, not POST /v2/orders.
  // It is therefore NOT covered by the placeOrder grep proof. We route a closing market
  // order through executeOrder() with stop_out bypass + closing=true so all gates fire.
  //
  // STRICT FALLBACK POLICY (Phase 3 review tightening):
  //   The DELETE /v2/positions fallback is ONLY allowed when:
  //     (a) the executeOrder request was a true closing stop_out
  //         (closing=true AND bypassReasons includes "stop_out"), AND
  //     (b) executeOrder returned !executed (gate-blocked).
  //   Any other failure mode (validation, broker error, etc.) is NOT fallback-eligible.
  //   When the fallback fires, a HIGH PRIORITY audit row is written with
  //   outcome="fallback_close_position", fallback_used=true, original_blocking_gate set.
  try {
    const { executeOrder } = await import("./order_executor");
    const side: "buy" | "sell" = pos.direction === "long" ? "sell" : "buy";
    const closeReq = {
      symbol:      pos.symbol,
      side,
      direction:   pos.direction,
      quantity:    pos.remaining_qty > 0 ? pos.remaining_qty : pos.quantity,
      setup_type:  `monitor:full_close:${reason}`,
      regime:      "exit",
      entry_price: pos.entry_price,
      stop_loss:   0,
      take_profit: 0,
      closing:     true as const,
      bypassReasons: ["stop_out"] as const,
    };
    const result = await executeOrder(closeReq as Parameters<typeof executeOrder>[0]);

    if (!result.executed) {
      const fallbackEligible =
        closeReq.closing === true &&
        closeReq.bypassReasons.includes("stop_out") &&
        Boolean(result.blocking_gate); // only gate-blocks (not validation/broker errors)

      if (fallbackEligible) {
        // HIGH PRIORITY: surface this so ops alerts fire.
        logger.error({
          symbol: pos.symbol,
          reason,
          original_blocking_gate: result.blocking_gate,
          executeOrder_audit_id: result.audit_id,
          fallback: "fallback_close_position",
          priority: "high",
        }, "[HIGH_PRIORITY] executeOrder full-close blocked by gate; using DELETE /v2/positions fallback");

        // Write a SECOND audit row dedicated to the fallback. It carries
        // fallback_used=true and original_blocking_gate so the audit log shows
        // both the gate block AND the forced close.
        try {
          const { recordExecutionAudit } = await import("./risk/audit_log");
          const { buildRiskSnapshot } = await import("./risk/risk_snapshot");
          const snap = buildRiskSnapshot({ dataAgeMs: null });
          recordExecutionAudit({
            req: {
              symbol:      pos.symbol,
              side,
              direction:   pos.direction,
              quantity:    closeReq.quantity,
              entry_price: pos.entry_price,
              stop_loss:   0,
              take_profit: 0,
              closing:     true,
              bypassReasons: ["stop_out"],
            },
            snap,
            pipeline: { allowed: true, decisions: [], blockingGate: undefined, blockingReason: undefined },
            outcome: "fallback_close_position",
            fallbackUsed: true,
            originalBlockingGate: result.blocking_gate ?? null,
          });
        } catch (auditErr) {
          logger.error({ auditErr, symbol: pos.symbol }, "[HIGH_PRIORITY] fallback audit write failed");
        }

        const { closePosition } = await import("./alpaca");
        await closePosition(pos.symbol);
      } else {
        // Not fallback-eligible: do NOT call closePosition. Leave the position
        // and surface the failure for ops to investigate.
        logger.error({
          symbol: pos.symbol,
          reason,
          blocking_gate: result.blocking_gate,
          error: result.error,
          audit_id: result.audit_id,
        }, "Full close NOT executed and fallback NOT eligible — manual intervention required");
      }
    }
    // Phase 4: record the full close into paper_trades.
    try {
      await recordTradeClose({
        broker_order_id: result.order_id ?? undefined,
        exit_price: pos.peak_price > 0 ? pos.peak_price : pos.entry_price,
        exit_time: new Date().toISOString(),
        exit_reason: reason === "stop_hit" ? "stop_loss"
                   : reason === "take_profit_hit" ? "take_profit"
                   : reason === "expired" ? "expired"
                   : !result.executed ? "fallback_close"
                   : "manual_close",
      });
    } catch (e) {
      logger.warn({ err: e, symbol: pos.symbol }, "recordTradeClose (full) failed (non-fatal)");
    }
    logger.info({ symbol: pos.symbol, reason, direction: pos.direction, audit_id: result.audit_id }, "Position fully closed by monitor");

    // Record lifecycle event
    try {
      persistAppend("position_events", {
        symbol: pos.symbol,
        stage: "full_closed",
        entry_price: pos.entry_price,
        close_price: pos.peak_price, // Use peak for estimate
        entry_time: new Date(pos.entered_at).toISOString(),
        close_time: new Date().toISOString(),
        quantity_opened: pos.quantity,
        quantity_closed: pos.quantity,
        reason,
      } as PositionLifecycleEvent, 5000);
    } catch (err) {
      logger.warn({ err, symbol: pos.symbol }, "Failed to record full close event");
    }
  } catch (err) {
    logger.error({ err, symbol: pos.symbol, reason }, "Failed to close position");
  }
  unregisterPosition(pos.symbol);
}

async function closePartialPosition(
  pos: ManagedPosition, qty: number, rTarget: number,
): Promise<void> {
  try {
    // Phase 3: route through the SOLE choke point. Stop-out / partial-take-profit
    // exits bypass daily_loss_limit and max_exposure (they MUST be allowed to fire
    // even when those caps are hit) but still pass mode/kill_switch/data_staleness.
    const { executeOrder } = await import("./order_executor");
    const side: "buy" | "sell" = pos.direction === "long" ? "sell" : "buy";
    const result = await executeOrder({
      symbol:      pos.symbol,
      side,
      direction:   pos.direction,
      quantity:    qty,
      setup_type:  `monitor:partial_close@${rTarget}R`,
      regime:      "exit",
      entry_price: pos.entry_price,  // for audit only — actual fill is at market
      stop_loss:   0,                // not meaningful for a close
      take_profit: 0,
      closing:     true,             // tells order_sanity to skip stop/TP checks
      bypassReasons: ["stop_out"],
    });
    if (!result.executed) {
      throw new Error(`partial_close_blocked:${result.blocking_gate ?? "?"}:${result.error ?? ""}`);
    }
    // Phase 4: record the partial close into paper_trades as a fresh closed row.
    try {
      await recordTradeClose({
        broker_order_id: result.order_id ?? undefined,
        exit_price: pos.peak_price > 0 ? pos.peak_price : pos.entry_price,
        exit_time: new Date().toISOString(),
        exit_reason: "take_profit",
      });
    } catch (e) {
      logger.warn({ err: e, symbol: pos.symbol }, "recordTradeClose (partial) failed (non-fatal)");
    }
    logger.info({
      symbol: pos.symbol, qty, rTarget, side, audit_id: result.audit_id,
    }, "Partial profit taken by monitor (via executeOrder)");

    // Record lifecycle event
    try {
      persistAppend("position_events", {
        symbol: pos.symbol,
        stage: "partial_closed",
        entry_price: pos.entry_price,
        close_price: pos.peak_price,
        entry_time: new Date(pos.entered_at).toISOString(),
        close_time: new Date().toISOString(),
        quantity_opened: pos.quantity,
        quantity_closed: qty,
        reason: `partial_at_${rTarget}R`,
      } as PositionLifecycleEvent, 5000);
    } catch (err) {
      logger.warn({ err, symbol: pos.symbol }, "Failed to record partial close event");
    }
  } catch (err) {
    logger.error({ err, symbol: pos.symbol, qty, rTarget }, "Failed to close partial position");
  }
}
// ── Event Logging ─────────────────────────────────────

function logEvent(type: MonitorEvent["type"], symbol: string, detail: Record<string, unknown>): void {
  const event: MonitorEvent = {
    type, symbol, detail,
    timestamp: new Date().toISOString(),
  };
  eventLog.push(event);
  if (eventLog.length > MAX_EVENTS) eventLog.shift();

  // Also broadcast via SSE
  try {
    // Dynamic import to avoid circular dependency
    import("./signal_stream").then(({ broadcast }) => {
      broadcast({
        type: "si_decision",
        data: {
          symbol,
          setup_type: `monitor_${type}`,
          direction: "long" as const,
          approved: type === "partial_close" || type === "trail_activated",
          win_probability: 0,
          edge_score: 0,
          enhanced_quality: 0,
          kelly_pct: 0,
          regime: "monitor",
          rejection_reason: JSON.stringify(detail),
          timestamp: new Date().toISOString(),
        },
      });
    }).catch(() => {});
  } catch { /* ignore */ }
}
// ── Lifecycle ─────────────────────────────────────────

function ensureRunning(): void {
  if (monitorTimer) return;
  monitorTimer = setInterval(() => {
    monitorTick().catch((err) => {
      logger.error({ err }, "Position monitor tick failed");
    });
  }, MONITOR_INTERVAL_MS);
  monitorTimer.unref();
  logger.info("Position monitor started");
}

function stopMonitor(): void {
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
    logger.info("Position monitor stopped (no managed positions)");
  }
}

/** Stop monitoring all positions (shutdown cleanup) */
export function shutdownMonitor(): void {
  managed.clear();
  stopMonitor();
}