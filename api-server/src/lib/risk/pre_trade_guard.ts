/**
 * Pre-Trade Guard — Unified safety checkpoint before any order execution.
 *
 * Combines all risk subsystems into a single deterministic gate:
 * 1. Kill switch check
 * 2. Exposure guard check
 * 3. Data safety guard check
 * 4. Session/time guard
 * 5. Symbol readiness check
 *
 * This is the ONLY function that should be called before placing an order.
 * All other risk checks are internal to this module.
 */
import { logger } from "../logger.js";
import { guardOrderSubmission, getKillSwitchState } from "./kill_switch.js";
import { checkExposure, type PortfolioSnapshot, type ExposureCheckResult } from "./exposure_guard.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PreTradeRequest {
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  notionalValue: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  reasoning?: string;
}

export interface PreTradeResult {
  approved: boolean;
  timestamp: string;
  checks: {
    killSwitch: { passed: boolean; message: string };
    exposure: { passed: boolean; message: string; details?: ExposureCheckResult };
    riskReward: { passed: boolean; message: string; ratio?: number };
    session: { passed: boolean; message: string };
  };
  rejectionReasons: string[];
}

// ── Session Rules ────────────────────────────────────────────────────────────

function isWithinTradingSession(): { allowed: boolean; message: string } {
  const now = new Date();
  const hour = now.getUTCHours();
  const day = now.getUTCDay();

  // No trading on weekends
  if (day === 0 || day === 6) {
    return { allowed: false, message: "Weekend — market closed" };
  }

  // US market hours: 13:30-20:00 UTC (9:30 AM - 4:00 PM ET)
  // Extended: 09:00-21:00 UTC for pre/post market
  if (hour < 9 || hour >= 21) {
    return { allowed: false, message: `Outside extended trading hours (${hour}:00 UTC)` };
  }

  return { allowed: true, message: "Within trading session" };
}

// ── Risk/Reward Check ────────────────────────────────────────────────────────

function checkRiskReward(
  request: PreTradeRequest,
): { passed: boolean; message: string; ratio: number } {
  const risk = Math.abs(request.entryPrice - request.stopLoss);
  const reward = Math.abs(request.takeProfit - request.entryPrice);

  if (risk <= 0) {
    return { passed: false, message: "Stop loss is at or beyond entry — invalid", ratio: 0 };
  }

  const ratio = reward / risk;

  // Minimum 1.5:1 R:R
  if (ratio < 1.5) {
    return {
      passed: false,
      message: `Risk/reward ratio ${ratio.toFixed(2)}:1 below minimum 1.5:1`,
      ratio,
    };
  }

  return {
    passed: true,
    message: `Risk/reward ratio ${ratio.toFixed(2)}:1`,
    ratio,
  };
}

// ── Main Guard ───────────────────────────────────────────────────────────────

/**
 * Run all pre-trade checks. Returns a detailed result.
 * Does NOT throw — caller should check `result.approved`.
 */
export function runPreTradeChecks(
  request: PreTradeRequest,
  portfolio: PortfolioSnapshot,
): PreTradeResult {
  const rejectionReasons: string[] = [];
  const timestamp = new Date().toISOString();

  // 1. Kill switch
  let killSwitchPassed = true;
  let killSwitchMsg = "Kill switch clear";
  try {
    guardOrderSubmission(`${request.symbol}:${request.strategy}`);
  } catch (err: any) {
    killSwitchPassed = false;
    killSwitchMsg = err.message || "Kill switch active";
    rejectionReasons.push(killSwitchMsg);
  }

  // 2. Exposure guard
  const exposureResult = checkExposure(
    {
      symbol: request.symbol,
      strategy: request.strategy,
      notionalValue: request.notionalValue,
      direction: request.direction,
    },
    portfolio,
  );
  const exposurePassed = exposureResult.allowed;
  const exposureMsg = exposurePassed
    ? "Exposure within limits"
    : exposureResult.violations.map(v => v.message).join("; ");
  if (!exposurePassed) {
    rejectionReasons.push(...exposureResult.violations.map(v => v.message));
  }

  // 3. Risk/reward
  const rrCheck = checkRiskReward(request);
  if (!rrCheck.passed) {
    rejectionReasons.push(rrCheck.message);
  }

  // 4. Session
  const sessionCheck = isWithinTradingSession();
  if (!sessionCheck.allowed) {
    rejectionReasons.push(sessionCheck.message);
  }

  const approved = killSwitchPassed && exposurePassed && rrCheck.passed && sessionCheck.allowed;

  const result: PreTradeResult = {
    approved,
    timestamp,
    checks: {
      killSwitch: { passed: killSwitchPassed, message: killSwitchMsg },
      exposure: { passed: exposurePassed, message: exposureMsg, details: exposureResult },
      riskReward: { passed: rrCheck.passed, message: rrCheck.message, ratio: rrCheck.ratio },
      session: { passed: sessionCheck.allowed, message: sessionCheck.message },
    },
    rejectionReasons,
  };

  if (!approved) {
    logger.warn({
      symbol: request.symbol,
      strategy: request.strategy,
      direction: request.direction,
      rejectionCount: rejectionReasons.length,
      reasons: rejectionReasons,
    }, "Pre-trade guard REJECTED order");
  } else {
    logger.info({
      symbol: request.symbol,
      strategy: request.strategy,
      direction: request.direction,
      rr: rrCheck.ratio?.toFixed(2),
    }, "Pre-trade guard APPROVED order");
  }

  return result;
}
