/**
 * Emergency Liquidator — Closes ALL open positions immediately.
 *
 * Called by:
 * - Drawdown breaker HALT level
 * - Manual kill switch activation
 * - API emergency endpoint
 *
 * Uses market orders for fastest exit. Logs every action for audit trail.
 */

import { logger } from "./logger";
import { alertKillSwitch } from "./alerts";
import { shutdownMonitor } from "./position_monitor";

// ── Types ─────────────────────────────────────────────

export interface LiquidationResult {
  triggered_by: string;
  timestamp: string;
  positions_closed: number;
  positions_failed: number;
  orders_cancelled: number;
  details: Array<{
    symbol: string;
    qty: number;
    side: string;
    status: "closed" | "failed";
    error?: string;
  }>;
}

// ── State ─────────────────────────────────────────────

let lastLiquidation: LiquidationResult | null = null;
let liquidationInProgress = false;

// ── Public API ────────────────────────────────────────

/**
 * Close ALL open positions and cancel ALL open orders.
 * This is the nuclear option — only called when safety requires it.
 */
export async function emergencyLiquidateAll(triggeredBy: string): Promise<LiquidationResult> {
  if (liquidationInProgress) {
    logger.warn("Emergency liquidation already in progress — skipping duplicate");
    return lastLiquidation ?? {
      triggered_by: triggeredBy,
      timestamp: new Date().toISOString(),
      positions_closed: 0,
      positions_failed: 0,
      orders_cancelled: 0,
      details: [],
    };
  }

  liquidationInProgress = true;
  const result: LiquidationResult = {
    triggered_by: triggeredBy,
    timestamp: new Date().toISOString(),
    positions_closed: 0,
    positions_failed: 0,
    orders_cancelled: 0,
    details: [],
  };

  logger.fatal({ triggeredBy }, "EMERGENCY LIQUIDATION INITIATED");
  alertKillSwitch(`Emergency liquidation triggered by ${triggeredBy}`, "emergency_liquidator");

  try {
    const alpaca = await import("./alpaca");

    // Step 1: Cancel ALL open orders first (prevent new fills)
    try {
      await alpaca.cancelAllOrders();
      result.orders_cancelled = -1; // Flag as "all cancelled"
      logger.info("All open orders cancelled");
    } catch (err) {
      logger.error({ err }, "Failed to cancel all orders during liquidation");
    }

    // Step 2: Get all open positions
    let positions: Array<{ symbol: string; qty: string; side: string }> = [];
    try {
      positions = (await alpaca.getTypedPositions()) as any[];
    } catch (err) {
      logger.error({ err }, "Failed to fetch positions during liquidation");
    }

    // Step 3: Close each position with market order
    for (const pos of positions) {
      const symbol = pos.symbol ?? "UNKNOWN";
      const qty = Math.abs(Number(pos.qty) || 0);
      const side = pos.side === "long" ? "sell" : "buy";

      if (qty <= 0) continue;

      try {
        await alpaca.closePosition(symbol);
        result.positions_closed++;
        result.details.push({ symbol, qty, side, status: "closed" });
        logger.info({ symbol, qty, side }, "Position closed during liquidation");
      } catch (err: any) {
        result.positions_failed++;
        result.details.push({
          symbol, qty, side, status: "failed",
          error: err.message ?? String(err),
        });
        logger.error({ err, symbol }, "Failed to close position during liquidation");
      }
    }

    // Step 4: Stop position monitor (no positions to manage)
    shutdownMonitor();

    // Step 5: Broadcast liquidation event
    try {
      const { broadcast } = await import("./signal_stream");
      broadcast({
        type: "si_decision",
        data: {
          symbol: "SYSTEM",
          setup_type: "emergency_liquidation",
          direction: "long" as const,
          approved: false,
          win_probability: 0,
          edge_score: 0,
          enhanced_quality: 0,
          kelly_pct: 0,
          regime: "HALT",
          rejection_reason: `Emergency liquidation: ${triggeredBy} — ${result.positions_closed} closed, ${result.positions_failed} failed`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch { /* ignore */ }

  } finally {
    liquidationInProgress = false;
    lastLiquidation = result;
  }

  logger.fatal({
    closed: result.positions_closed,
    failed: result.positions_failed,
    triggeredBy,
  }, "Emergency liquidation complete");

  return result;
}

/** Get the last liquidation result (for dashboard) */
export function getLastLiquidation(): LiquidationResult | null {
  return lastLiquidation;
}

/** Check if liquidation is currently in progress */
export function isLiquidationInProgress(): boolean {
  return liquidationInProgress;
}
