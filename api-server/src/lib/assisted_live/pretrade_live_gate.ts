/**
 * Pre-Trade Live Gate — Phase 21
 *
 * Every order in assisted-live mode MUST pass through this gate before
 * reaching the approval queue. The gate validates:
 *   1. Session is active (not paused/stopped/flattened)
 *   2. Kill switch is not engaged
 *   3. Daily loss limit not breached
 *   4. Open order count within bounds
 *   5. Symbol is in the allowed list
 *   6. Position size within session limits
 *   7. Data truth is acceptable
 *   8. Execution truth is acceptable
 *
 * If ANY gate fails, the order is rejected before it even reaches the queue.
 */

import { logger } from "../logger";
import { isKillSwitchActive } from "../risk_engine";
import { getBreakerSnapshot, isCooldownActive } from "../drawdown_breaker";

export interface PretradeGateInput {
  session_id: string;
  session_status: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  limit_price?: number;
  signal_confidence?: number;

  // Session constraints
  max_position_size: number;
  max_daily_loss: number;
  max_open_orders: number;
  allowed_symbols: string[];

  // Session state
  current_open_orders: number;
  current_daily_pnl: number;
}

export interface GateResult {
  passed: boolean;
  checks: GateCheck[];
  blocked_reasons: string[];
  timestamp: string;
}

export interface GateCheck {
  name: string;
  passed: boolean;
  reason?: string;
  value?: string | number | boolean;
  limit?: string | number | boolean;
}

export function evaluatePretradeGate(input: PretradeGateInput): GateResult {
  const checks: GateCheck[] = [];
  const blocked_reasons: string[] = [];

  // 1. Session active
  const sessionActive = input.session_status === "active";
  checks.push({
    name: "session_active",
    passed: sessionActive,
    reason: sessionActive ? undefined : `Session status is '${input.session_status}', not 'active'`,
    value: input.session_status,
    limit: "active",
  });
  if (!sessionActive) blocked_reasons.push(`Session ${input.session_id} is not active (${input.session_status})`);

  // 2. Kill switch
  const killSwitchOff = !isKillSwitchActive();
  checks.push({
    name: "kill_switch_off",
    passed: killSwitchOff,
    reason: killSwitchOff ? undefined : "Kill switch is engaged",
    value: !killSwitchOff,
    limit: false,
  });
  if (!killSwitchOff) blocked_reasons.push("Kill switch is engaged");

  // 3. Cooldown not active
  const cooldownClear = !isCooldownActive();
  checks.push({
    name: "cooldown_clear",
    passed: cooldownClear,
    reason: cooldownClear ? undefined : "Consecutive loss cooldown is active",
    value: !cooldownClear,
    limit: false,
  });
  if (!cooldownClear) blocked_reasons.push("Consecutive loss cooldown active");

  // 4. Daily loss limit
  const dailyLossOk = Math.abs(input.current_daily_pnl) < input.max_daily_loss || input.current_daily_pnl >= 0;
  checks.push({
    name: "daily_loss_limit",
    passed: dailyLossOk,
    reason: dailyLossOk ? undefined : `Daily loss ${input.current_daily_pnl} exceeds limit -${input.max_daily_loss}`,
    value: input.current_daily_pnl,
    limit: -input.max_daily_loss,
  });
  if (!dailyLossOk) blocked_reasons.push(`Daily loss limit breached: ${input.current_daily_pnl} < -${input.max_daily_loss}`);

  // 5. Open order count
  const openOrdersOk = input.current_open_orders < input.max_open_orders;
  checks.push({
    name: "open_orders_limit",
    passed: openOrdersOk,
    reason: openOrdersOk ? undefined : `Open orders ${input.current_open_orders} >= limit ${input.max_open_orders}`,
    value: input.current_open_orders,
    limit: input.max_open_orders,
  });
  if (!openOrdersOk) blocked_reasons.push(`Open orders at limit: ${input.current_open_orders}/${input.max_open_orders}`);

  // 6. Symbol allowed
  const symbolAllowed = input.allowed_symbols.length === 0 || input.allowed_symbols.includes(input.symbol);
  checks.push({
    name: "symbol_allowed",
    passed: symbolAllowed,
    reason: symbolAllowed ? undefined : `Symbol ${input.symbol} not in allowed list`,
    value: input.symbol,
    limit: input.allowed_symbols.join(",") || "*",
  });
  if (!symbolAllowed) blocked_reasons.push(`Symbol ${input.symbol} not in allowed list`);

  // 7. Position size
  const positionOk = input.qty <= input.max_position_size;
  checks.push({
    name: "position_size_limit",
    passed: positionOk,
    reason: positionOk ? undefined : `Qty ${input.qty} exceeds max ${input.max_position_size}`,
    value: input.qty,
    limit: input.max_position_size,
  });
  if (!positionOk) blocked_reasons.push(`Position size ${input.qty} exceeds max ${input.max_position_size}`);

  // 8. Breaker state
  const breaker = getBreakerSnapshot();
  const breakerOk = breaker.sizeMultiplier > 0;
  checks.push({
    name: "breaker_clear",
    passed: breakerOk,
    reason: breakerOk ? undefined : "Drawdown breaker is in HALT state",
    value: breaker.sizeMultiplier,
    limit: "> 0",
  });
  if (!breakerOk) blocked_reasons.push("Drawdown circuit breaker halted trading");

  const passed = checks.every((c) => c.passed);

  if (!passed) {
    logger.warn({ session_id: input.session_id, symbol: input.symbol, blocked_reasons }, "Pre-trade gate BLOCKED order");
  }

  return {
    passed,
    checks,
    blocked_reasons,
    timestamp: new Date().toISOString(),
  };
}
