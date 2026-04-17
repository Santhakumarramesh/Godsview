/**
 * Fill Reconciler — Polls Alpaca for fill activity, matches fills
 * to SI decisions, computes realized PnL, and feeds the drawdown breaker.
 *
 * Runs on a configurable interval (default 10s) and:
 * 1. Fetches today's fills from Alpaca
 * 2. Deduplicates against already-processed fill IDs
 * 3. Matches fills to open managed positions
 * 4. Computes realized PnL per round trip
 * 5. Updates daily PnL accumulator in drawdown breaker
 * 6. Broadcasts fill events via SSE/WS
 */

import { logger } from "./logger";
import { dailyPnl, openPositions } from "./metrics";

// ── Types ─────────────────────────────────────────────

export interface ReconciledFill {
  fill_id: string;
  order_id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  timestamp: string;
  matched_position: boolean;
  realized_pnl: number | null;
}

export interface ReconciliationSnapshot {
  last_poll_at: string | null;
  fills_today: number;
  realized_pnl_today: number;
  unmatched_fills: number;
  processed_fill_ids: number;
  is_running: boolean;
}

// ── State ─────────────────────────────────────────────

const processedFillIds = new Set<string>();
const todayFills: ReconciledFill[] = [];
let realizedPnlToday = 0;
let unmatchedCount = 0;
let lastPollAt: string | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let lastResetDay = new Date().toDateString();

const RECONCILE_INTERVAL_MS = 10_000; // Poll every 10s
const MAX_FILL_HISTORY = 1000;

// Position cost basis tracker for PnL computation
// symbol → { direction, avg_entry, qty }
const costBasis = new Map<string, {
  direction: "long" | "short";
  avg_entry: number;
  qty: number;
}>();

// ── Public API ────────────────────────────────────────

/** Register a new position's cost basis (called after order fill) */
export function registerCostBasis(
  symbol: string,
  direction: "long" | "short",
  entry_price: number,
  quantity: number,
): void {
  const existing = costBasis.get(symbol);
  if (existing && existing.direction === direction) {
    // Average into existing position
    const totalQty = existing.qty + quantity;
    const avgEntry = (existing.avg_entry * existing.qty + entry_price * quantity) / totalQty;
    costBasis.set(symbol, { direction, avg_entry: avgEntry, qty: totalQty });
  } else {
    costBasis.set(symbol, { direction, avg_entry: entry_price, qty: quantity });
  }
  logger.info({ symbol, direction, entry_price, quantity }, "Cost basis registered");
}

/** Remove cost basis on full exit */
export function clearCostBasis(symbol: string): void {
  costBasis.delete(symbol);
}

/** Reduce cost basis quantity on partial close */
export function reduceCostBasis(symbol: string, closedQty: number): void {
  const cb = costBasis.get(symbol);
  if (!cb) return;
  cb.qty = Math.max(0, cb.qty - closedQty);
  if (cb.qty <= 0) costBasis.delete(symbol);
}

/** Get today's reconciliation snapshot */
export function getReconciliationSnapshot(): ReconciliationSnapshot {
  resetDayIfNeeded();
  return {
    last_poll_at: lastPollAt,
    fills_today: todayFills.length,
    realized_pnl_today: realizedPnlToday,
    unmatched_fills: unmatchedCount,
    processed_fill_ids: processedFillIds.size,
    is_running: reconcileTimer !== null,
  };
}

/** Get recent fills */
export function getRecentFills(limit = 50): ReconciledFill[] {
  return todayFills.slice(-limit).reverse();
}

/** Get realized PnL for today */
export function getRealizedPnlToday(): number {
  resetDayIfNeeded();
  return realizedPnlToday;
}

// ── Core Reconciliation Loop ──────────────────────────

async function reconcileTick(): Promise<void> {
  resetDayIfNeeded();

  try {
    const { getTodayFills } = await import("./alpaca");
    const fills = await getTodayFills();
    lastPollAt = new Date().toISOString();

    let newFillCount = 0;

    for (const fill of fills) {
      const fillId = fill.id ?? `${fill.order_id}-${fill.transaction_time}`;
      if (processedFillIds.has(fillId)) continue;
      processedFillIds.add(fillId);
      newFillCount++;

      const side = fill.side as "buy" | "sell";
      const qty = Number(fill.qty) || 0;
      const price = Number(fill.price) || 0;
      const symbol = fill.symbol ?? "UNKNOWN";

      // Compute PnL if we have cost basis
      let pnl: number | null = null;
      let matched = false;
      const cb = costBasis.get(symbol);

      if (cb) {
        // Check if this fill closes the position
        const isClosing =
          (cb.direction === "long" && side === "sell") ||
          (cb.direction === "short" && side === "buy");

        if (isClosing && price > 0 && cb.avg_entry > 0) {
          matched = true;
          const priceDiff = cb.direction === "long"
            ? price - cb.avg_entry
            : cb.avg_entry - price;
          pnl = priceDiff * qty;

          // Accumulate daily PnL
          realizedPnlToday += pnl;
          dailyPnl.set(realizedPnlToday);

          // Reduce cost basis
          reduceCostBasis(symbol, qty);

          logger.info({
            symbol, side, qty, price,
            avg_entry: cb.avg_entry,
            pnl: pnl.toFixed(2),
            daily_total: realizedPnlToday.toFixed(2),
          }, "Fill reconciled with PnL");

          // Feed drawdown breaker
          try {
            const { recordRealizedPnl } = await import("./drawdown_breaker");
            recordRealizedPnl(pnl, symbol);
          } catch { /* breaker not loaded */ }
        } else if (!isClosing) {
          // Opening fill — update cost basis
          matched = true;
          registerCostBasis(symbol, cb.direction, price, qty);
        }
      }

      if (!matched) {
        unmatchedCount++;
      }

      const reconciledFill: ReconciledFill = {
        fill_id: fillId,
        order_id: fill.order_id ?? "",
        symbol,
        side,
        quantity: qty,
        price,
        timestamp: fill.transaction_time ?? new Date().toISOString(),
        matched_position: matched,
        realized_pnl: pnl,
      };
      todayFills.push(reconciledFill);
      if (todayFills.length > MAX_FILL_HISTORY) todayFills.shift();

      // Broadcast fill event
      broadcastFill(reconciledFill);
    }

    // Update open positions gauge
    try {
      const { getTypedPositions } = await import("./alpaca");
      const positions = await getTypedPositions();
      openPositions.set(positions.length);
    } catch { /* non-critical */ }

    if (newFillCount > 0) {
      logger.info({ newFills: newFillCount, totalToday: todayFills.length }, "Reconciliation tick complete");
    }
  } catch (err) {
    logger.error({ err }, "Fill reconciliation tick failed");
  }
}

function broadcastFill(fill: ReconciledFill): void {
  try {
    import("./signal_stream").then(({ broadcast }) => {
      broadcast({
        type: "si_decision",
        data: {
          symbol: fill.symbol,
          setup_type: "fill",
          direction: fill.side === "buy" ? ("long" as const) : ("short" as const),
          approved: fill.matched_position,
          win_probability: 0,
          edge_score: 0,
          enhanced_quality: 0,
          kelly_pct: 0,
          regime: "execution",
          rejection_reason: fill.realized_pnl !== null
            ? `PnL: $${fill.realized_pnl.toFixed(2)}`
            : "Fill processed",
          timestamp: fill.timestamp,
        },
      });
    }).catch((e) => logger.debug({ err: e }, "[FillReconciler] audit event failed"));
  } catch { /* ignore */ }
}

// ── Day Reset ─────────────────────────────────────────

function resetDayIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== lastResetDay) {
    lastResetDay = today;
    todayFills.length = 0;
    processedFillIds.clear();
    realizedPnlToday = 0;
    unmatchedCount = 0;
    costBasis.clear();
    dailyPnl.set(0);
    logger.info("Fill reconciler: day reset");
  }
}

// ── Lifecycle ─────────────────────────────────────────

export function startReconciler(): void {
  if (reconcileTimer) return;
  reconcileTimer = setInterval(() => {
    reconcileTick().catch((err) => {
      logger.error({ err }, "Reconciler tick unhandled error");
    });
  }, RECONCILE_INTERVAL_MS);
  reconcileTimer.unref();
  logger.info("Fill reconciler started (10s interval)");
}

export function stopReconciler(): void {
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
    reconcileTimer = null;
    logger.info("Fill reconciler stopped");
  }
}
