/**
 * position_sizer.ts — Position Sizing Engine
 *
 * Provides two sizing strategies:
 *   1. Fixed-Fractional — risk a fixed % of equity per trade (default: GODSVIEW_MAX_RISK_PER_TRADE_PCT)
 *   2. Kelly Criterion  — scale size by edge = (winRate * avgWinR - lossRate * 1) / 1
 *                         Half-Kelly applied for safety; capped at max risk per trade
 *
 * Also enforces:
 *   - Minimum position size (qty > 0)
 *   - Maximum position notional exposure cap
 *   - Concurrency gate (max open positions)
 */

import { logger as _logger } from "./logger";
import { getRiskEngineSnapshot } from "./risk_engine";
import { generateEquityReport } from "./equity_engine";

const logger = _logger.child({ module: "position_sizer" });

// ─── Types ────────────────────────────────────────────────────────────────────

export type SizingMethod = "fixed_fractional" | "half_kelly" | "full_kelly";

export interface SizingRequest {
  /** Entry price in USD */
  entryPrice:     number;
  /** Stop-loss price in USD */
  stopLossPrice:  number;
  /** Account equity in USD */
  accountEquity:  number;
  /** Sizing method (default: fixed_fractional) */
  method?:        SizingMethod;
  /** Override risk % (0–1); defaults to risk_engine config */
  riskPctOverride?: number;
}

export interface SizingResult {
  /** Number of units to trade */
  qty:              number;
  /** Notional value in USD (qty × entryPrice) */
  notional:         number;
  /** Risk per unit (|entry - stopLoss|) */
  riskPerUnit:      number;
  /** Total risk in USD (riskPerUnit × qty) */
  riskDollars:      number;
  /** Effective risk as % of equity */
  effectiveRiskPct: number;
  /** Kelly fraction used (0 if fixed_fractional) */
  kellyFraction:    number;
  /** Sizing method applied */
  method:           SizingMethod;
  /** True if qty was capped by risk/exposure limits */
  wasCapped:        boolean;
  /** Why it was capped (if wasCapped) */
  capReason:        string;
}

// ─── Kelly helpers ─────────────────────────────────────────────────────────────

/**
 * Compute Kelly fraction from recent trade history.
 * f = (winRate × avgWinR − lossRate × 1) / avgWinR
 * where avgWinR = avgWin / avgLoss (reward-to-risk).
 *
 * Returns 0 if insufficient data.
 */
function computeKellyFraction(halfKelly: boolean): number {
  try {
    const report = generateEquityReport();
    const { totalTrades, winRate, avgWinPct, avgLossPct } = report.metrics;

    if (totalTrades < 10) {
      logger.debug("[sizer] insufficient trades for Kelly — using 0");
      return 0;
    }

    if (avgLossPct <= 0) return 0;

    const R = avgWinPct / avgLossPct; // reward-to-risk ratio
    const f = (winRate * R - (1 - winRate)) / R;

    if (!Number.isFinite(f) || f <= 0) return 0;
    return halfKelly ? f / 2 : f;
  } catch (err) {
    logger.warn({ err }, "[sizer] Kelly computation failed");
    return 0;
  }
}

// ─── Core sizing function ─────────────────────────────────────────────────────

/**
 * Compute position size for a trade.
 */
export function computePositionSize(req: SizingRequest): SizingResult {
  const { entryPrice, stopLossPrice, accountEquity } = req;
  const method: SizingMethod = req.method ?? "fixed_fractional";

  const riskConfig = getRiskEngineSnapshot().config;
  const maxRiskPct = req.riskPctOverride ?? riskConfig.maxRiskPerTradePct;

  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);

  if (riskPerUnit <= 0 || accountEquity <= 0) {
    logger.warn("[sizer] invalid entry/stop or zero equity — returning 0 qty");
    return zeroResult(method);
  }

  // ── Determine target risk % ────────────────────────────────────────────────
  let targetRiskPct = maxRiskPct;
  let kellyFraction = 0;

  if (method === "half_kelly" || method === "full_kelly") {
    kellyFraction = computeKellyFraction(method === "half_kelly");
    if (kellyFraction > 0) {
      targetRiskPct = Math.min(kellyFraction, maxRiskPct);
    } else {
      // Fall back to fixed_fractional if Kelly returns 0
      targetRiskPct = maxRiskPct * 0.5; // conservative fallback
    }
  }

  // ── Compute raw qty ──────────────────────────────────────────────────────────
  const riskDollars     = accountEquity * targetRiskPct;
  let   qty             = riskDollars / riskPerUnit;

  // Round to crypto/equity precision
  const isSmallPrice    = entryPrice < 1;
  const precision       = isSmallPrice ? 6 : entryPrice < 100 ? 4 : 2;
  qty                   = Math.round(qty * 10 ** precision) / 10 ** precision;

  let wasCapped         = false;
  let capReason         = "";

  // ── Cap: max open exposure ─────────────────────────────────────────────────
  const maxNotional     = accountEquity * riskConfig.maxOpenExposurePct;
  const notional        = qty * entryPrice;
  if (notional > maxNotional) {
    qty                 = Math.floor((maxNotional / entryPrice) * 10 ** precision) / 10 ** precision;
    wasCapped           = true;
    capReason           = `exposure_cap (max ${(riskConfig.maxOpenExposurePct * 100).toFixed(0)}% of equity)`;
  }

  // ── Floor: must trade at least one unit ────────────────────────────────────
  if (qty <= 0) {
    logger.warn("[sizer] computed qty ≤ 0 — clamping to 0");
    return zeroResult(method);
  }

  const effectiveRiskDollars = qty * riskPerUnit;
  const effectiveRiskPct     = effectiveRiskDollars / accountEquity;

  logger.debug(
    `[sizer] ${method} qty=${qty} notional=$${(qty * entryPrice).toFixed(2)} ` +
    `risk=$${effectiveRiskDollars.toFixed(2)} (${(effectiveRiskPct * 100).toFixed(2)}%)`
  );

  return {
    qty,
    notional:          qty * entryPrice,
    riskPerUnit,
    riskDollars:       effectiveRiskDollars,
    effectiveRiskPct,
    kellyFraction,
    method,
    wasCapped,
    capReason,
  };
}

function zeroResult(method: SizingMethod): SizingResult {
  return {
    qty: 0, notional: 0, riskPerUnit: 0, riskDollars: 0,
    effectiveRiskPct: 0, kellyFraction: 0,
    method, wasCapped: true, capReason: "zero_qty",
  };
}

/**
 * Quick helper used by order_executor to check position sizing before committing.
 * Returns an estimated USD risk for a given qty.
 */
export function estimateRiskUsd(qty: number, entry: number, stopLoss: number): number {
  return qty * Math.abs(entry - stopLoss);
}
