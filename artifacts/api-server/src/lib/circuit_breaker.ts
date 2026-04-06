/**
 * circuit_breaker.ts — Circuit Breaker + Rate Limiter (Phase 55)
 *
 * Production safety:
 *   1. Circuit breaker: stops trading on consecutive losses/drawdown
 *   2. Rate limiter: prevents API/order spam
 *   3. Kill switch: emergency global halt
 *   4. Cooldown periods: progressive backoff after breaches
 *   5. Escalation policy: auto kill-switch on repeated trips
 *   6. Trip history persistence
 */

import { logger } from "./logger.js";
import { persistAppend, persistRead } from "./persistent_store.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  maxConsecutiveLosses: number;
  maxDrawdownPct: number;
  maxDailyLossPct: number;
  cooldownMinutes: number;
  halfOpenTradeLimit: number;
}

export interface CircuitBreakerStatus {
  state: BreakerState;
  consecutiveLosses: number;
  dailyPnlPct: number;
  drawdownPct: number;
  tripReason: string | null;
  trippedAt: string | null;
  cooldownUntil: string | null;
  halfOpenTradesUsed: number;
}

export interface RateLimiterStatus {
  ordersThisMinute: number;
  ordersThisHour: number;
  maxPerMinute: number;
  maxPerHour: number;
  blocked: boolean;
}

export interface KillSwitchStatus {
  active: boolean;
  reason: string | null;
  activatedAt: string | null;
  activatedBy: string | null;
}

export interface CircuitBreakerSnapshot {
  breaker: CircuitBreakerStatus;
  rateLimiter: RateLimiterStatus;
  killSwitch: KillSwitchStatus;
  totalTrips: number;
  totalRateLimitBlocks: number;
  tradingAllowed: boolean;
}

export interface BreakerTripEvent {
  id: string;
  reason: string;
  timestamp: string;
  consecutiveLosses: number;
  dailyPnlPct: number;
  drawdownPct: number;
  cooldownUntil: string | null;
}

export interface CircuitBreakerHealthCheck {
  state: BreakerState;
  tripsToday: number;
  timeSinceLastTrip: number | null;
  tripsIn24h: number;
  escalationPolicy: { triggered: boolean; reason: string | null };
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveLosses: 5,
  maxDrawdownPct: 5.0,
  maxDailyLossPct: 3.0,
  cooldownMinutes: 30,
  halfOpenTradeLimit: 2,
};

// ─── State ────────────────────────────────────────────────────────────────────

let config = { ...DEFAULT_CONFIG };
let breakerState: BreakerState = "CLOSED";
let consecutiveLosses = 0;
let dailyPnlPct = 0;
let drawdownPct = 0;
let tripReason: string | null = null;
let trippedAt: string | null = null;
let cooldownUntil: string | null = null;
let halfOpenTradesUsed = 0;
let totalTrips = 0;

// Rate limiter
let ordersThisMinute = 0;
let ordersThisHour = 0;
let maxPerMinute = 10;
let maxPerHour = 100;
let lastMinuteReset = Date.now();
let lastHourReset = Date.now();
let totalRateLimitBlocks = 0;

// Kill switch
let killSwitchActive = false;
let killSwitchReason: string | null = null;
let killSwitchActivatedAt: string | null = null;
let killSwitchActivatedBy: string | null = null;

// Escalation policy
const ESCALATION_THRESHOLD = 3; // 3 trips in 24h triggers auto-kill
let lastTripTimestamps: number[] = [];

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

function tripBreaker(reason: string): void {
  breakerState = "OPEN";
  tripReason = reason;
  const now = new Date();
  trippedAt = now.toISOString();
  cooldownUntil = new Date(now.getTime() + config.cooldownMinutes * 60000).toISOString();
  halfOpenTradesUsed = 0;
  totalTrips++;

  // Persist trip event
  const tripEvent: BreakerTripEvent = {
    id: `trip_${Date.now()}`,
    reason,
    timestamp: trippedAt,
    consecutiveLosses,
    dailyPnlPct,
    drawdownPct,
    cooldownUntil,
  };
  try {
    persistAppend("breaker_events", tripEvent, 500);
  } catch (err) {
    logger.warn({ err }, "Failed to persist breaker trip event");
  }

  // Track escalation
  const now_ms = now.getTime();
  lastTripTimestamps.push(now_ms);
  lastTripTimestamps = lastTripTimestamps.filter((t) => now_ms - t < 24 * 60 * 60 * 1000);

  if (lastTripTimestamps.length >= ESCALATION_THRESHOLD) {
    activateKillSwitch(`Escalation: ${lastTripTimestamps.length} trips in 24h`, "circuit_breaker");
  }

  logger.info({ reason, cooldownUntil, tripsInDay: lastTripTimestamps.length }, "Circuit breaker TRIPPED");
}

export function recordTradeResult(pnlPct: number): CircuitBreakerStatus {
  if (breakerState === "HALF_OPEN") {
    halfOpenTradesUsed++;
    if (pnlPct < 0) {
      tripBreaker("Loss during half-open test");
    } else if (halfOpenTradesUsed >= config.halfOpenTradeLimit) {
      breakerState = "CLOSED";
      consecutiveLosses = 0;
      tripReason = null;
      logger.info("Circuit breaker CLOSED after successful half-open test");
    }
  }

  dailyPnlPct += pnlPct;

  if (pnlPct < 0) {
    consecutiveLosses++;
    drawdownPct = Math.max(drawdownPct, Math.abs(dailyPnlPct));
  } else {
    consecutiveLosses = 0;
  }

  // Check trip conditions
  if (breakerState === "CLOSED") {
    if (consecutiveLosses >= config.maxConsecutiveLosses) {
      tripBreaker(`${consecutiveLosses} consecutive losses`);
    } else if (drawdownPct >= config.maxDrawdownPct) {
      tripBreaker(`Drawdown ${drawdownPct.toFixed(1)}% exceeds ${config.maxDrawdownPct}%`);
    } else if (Math.abs(dailyPnlPct) >= config.maxDailyLossPct && dailyPnlPct < 0) {
      tripBreaker(`Daily loss ${Math.abs(dailyPnlPct).toFixed(1)}% exceeds ${config.maxDailyLossPct}%`);
    }
  }

  return getBreakerStatus();
}

export function checkBreaker(): CircuitBreakerStatus {
  // Auto-transition from OPEN to HALF_OPEN after cooldown
  if (breakerState === "OPEN" && cooldownUntil && new Date(cooldownUntil).getTime() < Date.now()) {
    breakerState = "HALF_OPEN";
    halfOpenTradesUsed = 0;
    logger.info("Circuit breaker moved to HALF_OPEN");
  }
  return getBreakerStatus();
}

function getBreakerStatus(): CircuitBreakerStatus {
  return { state: breakerState, consecutiveLosses, dailyPnlPct, drawdownPct, tripReason, trippedAt, cooldownUntil, halfOpenTradesUsed };
}

// ─── Rate Limiter ─────────────────────────────────────────────────────────────

export function checkRateLimit(): RateLimiterStatus {
  const now = Date.now();
  if (now - lastMinuteReset > 60000) { ordersThisMinute = 0; lastMinuteReset = now; }
  if (now - lastHourReset > 3600000) { ordersThisHour = 0; lastHourReset = now; }
  const blocked = ordersThisMinute >= maxPerMinute || ordersThisHour >= maxPerHour;
  return { ordersThisMinute, ordersThisHour, maxPerMinute, maxPerHour, blocked };
}

export function recordOrder(): RateLimiterStatus {
  const status = checkRateLimit();
  if (status.blocked) {
    totalRateLimitBlocks++;
    logger.info({ ordersThisMinute, ordersThisHour }, "Rate limit blocked order");
    return status;
  }
  ordersThisMinute++;
  ordersThisHour++;
  return checkRateLimit();
}

// ─── Kill Switch ──────────────────────────────────────────────────────────────

export function activateKillSwitch(reason: string, activatedBy?: string): KillSwitchStatus {
  killSwitchActive = true;
  killSwitchReason = reason;
  killSwitchActivatedAt = new Date().toISOString();
  killSwitchActivatedBy = activatedBy ?? "system";
  logger.info({ reason, activatedBy }, "KILL SWITCH ACTIVATED");
  return getKillSwitchStatus();
}

export function deactivateKillSwitch(): KillSwitchStatus {
  killSwitchActive = false;
  killSwitchReason = null;
  logger.info("Kill switch deactivated");
  return getKillSwitchStatus();
}

function getKillSwitchStatus(): KillSwitchStatus {
  return { active: killSwitchActive, reason: killSwitchReason, activatedAt: killSwitchActivatedAt, activatedBy: killSwitchActivatedBy };
}

// ─── Unified Check ────────────────────────────────────────────────────────────

export function isTradingAllowed(): boolean {
  if (killSwitchActive) return false;
  const breaker = checkBreaker();
  if (breaker.state === "OPEN") return false;
  const rate = checkRateLimit();
  if (rate.blocked) return false;
  return true;
}

// ─── Snapshot & Reset ─────────────────────────────────────────────────────────

export function getCircuitBreakerSnapshot(): CircuitBreakerSnapshot {
  return {
    breaker: getBreakerStatus(),
    rateLimiter: checkRateLimit(),
    killSwitch: getKillSwitchStatus(),
    totalTrips,
    totalRateLimitBlocks,
    tradingAllowed: isTradingAllowed(),
  };
}

export function updateConfig(newConfig: Partial<CircuitBreakerConfig>): CircuitBreakerConfig {
  config = { ...config, ...newConfig };
  return config;
}

export function resetCircuitBreaker(): void {
  config = { ...DEFAULT_CONFIG };
  breakerState = "CLOSED"; consecutiveLosses = 0; dailyPnlPct = 0; drawdownPct = 0;
  tripReason = null; trippedAt = null; cooldownUntil = null; halfOpenTradesUsed = 0; totalTrips = 0;
  ordersThisMinute = 0; ordersThisHour = 0; totalRateLimitBlocks = 0;
  killSwitchActive = false; killSwitchReason = null; killSwitchActivatedAt = null; killSwitchActivatedBy = null;
  logger.info("Circuit breaker reset");
}


// ─── Backward Compatibility Aliases ───────────────────────────────────────────

export function getCircuitBreakerStatus() {
  return getCircuitBreakerSnapshot();
}

export function checkCircuitBreaker(): { allowed: boolean; reason?: string } {
  const snap = getCircuitBreakerSnapshot();
  if (!snap.tradingAllowed) {
    return { allowed: false, reason: snap.breaker.tripReason ?? "Trading blocked" };
  }
  return { allowed: true };
}

export function manualTrip(reason?: string): CircuitBreakerStatus {
  return recordTradeResult(-999); // force trip via massive loss
}

export function getTripHistory() {
  return { totalTrips, lastTrip: trippedAt, lastReason: tripReason };
}

export function getBreakerTripHistory(days: number): BreakerTripEvent[] {
  try {
    const safeDays = Math.max(1, Math.min(90, Math.round(days)));
    const allTrips = persistRead<BreakerTripEvent[]>("breaker_events", []);
    const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
    return allTrips.filter((t) => new Date(t.timestamp) >= cutoff);
  } catch (err) {
    logger.warn({ err, days }, "Failed to read breaker trip history");
    return [];
  }
}

export function CircuitBreakerHealthCheck(): CircuitBreakerHealthCheck {
  const now = Date.now();
  const cutoff24h = now - 24 * 60 * 60 * 1000;

  // Get trips in last 24h
  try {
    const allTrips = persistRead<BreakerTripEvent[]>("breaker_events", []);
    const tripsInDay = allTrips.filter((t) => new Date(t.timestamp).getTime() > cutoff24h).length;
    const tripsToday = tripsInDay;
    const timeSinceLastTrip = trippedAt ? now - new Date(trippedAt).getTime() : null;

    return {
      state: breakerState,
      tripsToday,
      timeSinceLastTrip,
      tripsIn24h: tripsInDay,
      escalationPolicy: {
        triggered: killSwitchActive,
        reason: killSwitchReason,
      },
    };
  } catch (err) {
    logger.warn({ err }, "Failed to compute health check");
    return {
      state: breakerState,
      tripsToday: 0,
      timeSinceLastTrip: null,
      tripsIn24h: 0,
      escalationPolicy: { triggered: killSwitchActive, reason: killSwitchReason },
    };
  }
}
