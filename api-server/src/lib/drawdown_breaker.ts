/**
 * Drawdown Circuit Breaker — Tracks daily P&L and auto-engages
 * the kill switch when drawdown limits are breached.
 *
 * Three escalation levels:
 * 1. WARNING  — 50% of daily loss limit → alert only
 * 2. THROTTLE — 75% of daily loss limit → reduce position sizes by 50%
 * 3. HALT     — 100% of daily loss limit → kill switch + emergency liquidation
 *
 * Also tracks:
 * - Consecutive losing trades → cooldown after N losses
 * - Peak equity watermark → max drawdown from peak
 * - Hourly loss velocity → detect rapid deterioration
 */

import { logger } from "./logger";
import { alertDailyLossBreach, alertConsecutiveLosses, fireAlert } from "./alerts";
import { setKillSwitchActive, getRiskEngineSnapshot } from "./risk_engine";

// ── Types ─────────────────────────────────────────────

export type BreakerLevel = "NORMAL" | "WARNING" | "THROTTLE" | "HALT";

export interface BreakerSnapshot {
  level: BreakerLevel;
  realized_pnl_today: number;
  unrealized_pnl: number;
  total_pnl: number;
  daily_loss_limit: number;
  warning_threshold: number;
  throttle_threshold: number;
  consecutive_losses: number;
  max_consecutive_before_cooldown: number;
  cooldown_active: boolean;
  cooldown_until: string | null;
  peak_equity: number;
  drawdown_from_peak: number;
  max_drawdown_pct: number;
  hourly_pnl_velocity: number;
  position_size_multiplier: number;
  trades_today: number;
  wins_today: number;
  losses_today: number;
  last_updated: string;
}

export interface TradeResult {
  symbol: string;
  pnl: number;
  is_win: boolean;
}

// ── Config ────────────────────────────────────────────

function parseNum(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

const DAILY_LOSS_LIMIT = parseNum("GODSVIEW_MAX_DAILY_LOSS_USD", 250);
const WARNING_PCT = 0.50;
const THROTTLE_PCT = 0.75;
const MAX_CONSECUTIVE_LOSSES = parseNum("GODSVIEW_COOLDOWN_AFTER_LOSSES", 3);
const COOLDOWN_MINUTES = parseNum("GODSVIEW_COOLDOWN_MINUTES", 30);
const MAX_DRAWDOWN_FROM_PEAK_PCT = parseNum("GODSVIEW_MAX_DRAWDOWN_PCT", 0.05); // 5%
const VELOCITY_WINDOW_MS = 3_600_000; // 1 hour
const VELOCITY_HALT_THRESHOLD = -200; // $-200/hour triggers halt

// ── State ─────────────────────────────────────────────

let realizedPnlToday = 0;
let unrealizedPnl = 0;
let consecutiveLosses = 0;
let cooldownUntil: number | null = null;
let peakEquity = 0; // Set from account equity on first check
let currentLevel: BreakerLevel = "NORMAL";
let positionSizeMultiplier = 1.0;
let tradesCount = 0;
let winsCount = 0;
let lossesCount = 0;
let lastResetDay = new Date().toDateString();

// Hourly velocity tracking
const pnlEvents: Array<{ pnl: number; ts: number }> = [];

// ── Public API ────────────────────────────────────────

/**
 * Record a realized PnL event (called by fill reconciler).
 * This is the primary input that drives breaker state.
 */
export function recordRealizedPnl(pnl: number, symbol: string): void {
  resetDayIfNeeded();

  realizedPnlToday += pnl;
  tradesCount++;
  pnlEvents.push({ pnl, ts: Date.now() });

  const isWin = pnl > 0;
  if (isWin) {
    winsCount++;
    consecutiveLosses = 0;
  } else {
    lossesCount++;
    consecutiveLosses++;
  }

  // Trim old velocity events
  const cutoff = Date.now() - VELOCITY_WINDOW_MS;
  while (pnlEvents.length > 0 && pnlEvents[0]!.ts < cutoff) {
    pnlEvents.shift();
  }

  logger.info({
    symbol, pnl: pnl.toFixed(2),
    dailyTotal: realizedPnlToday.toFixed(2),
    consecutiveLosses,
    level: currentLevel,
  }, "Drawdown breaker: PnL recorded");

  evaluateBreaker();
}

/** Update unrealized PnL (called periodically from position monitor) */
export function updateUnrealizedPnl(unrealized: number): void {
  unrealizedPnl = unrealized;
  evaluateBreaker();
}

/** Set peak equity (called on startup from account balance) */
export function setPeakEquity(equity: number): void {
  if (equity > peakEquity) peakEquity = equity;
}

/** Check if position sizing should be throttled */
export function getPositionSizeMultiplier(): number {
  resetDayIfNeeded();
  return positionSizeMultiplier;
}

/** Check if trading is in cooldown after consecutive losses */
export function isCooldownActive(): boolean {
  if (cooldownUntil === null) return false;
  if (Date.now() >= cooldownUntil) {
    cooldownUntil = null;
    consecutiveLosses = 0;
    logger.info("Drawdown breaker: cooldown expired, trading resumed");
    return false;
  }
  return true;
}

/** Get full breaker state for dashboard */
export function getBreakerSnapshot(): BreakerSnapshot {
  resetDayIfNeeded();
  const velocity = computeVelocity();
  const totalPnl = realizedPnlToday + unrealizedPnl;
  const drawdownFromPeak = peakEquity > 0 ? (peakEquity - (peakEquity + totalPnl)) / peakEquity : 0;

  return {
    level: currentLevel,
    realized_pnl_today: realizedPnlToday,
    unrealized_pnl: unrealizedPnl,
    total_pnl: totalPnl,
    daily_loss_limit: DAILY_LOSS_LIMIT,
    warning_threshold: DAILY_LOSS_LIMIT * WARNING_PCT,
    throttle_threshold: DAILY_LOSS_LIMIT * THROTTLE_PCT,
    consecutive_losses: consecutiveLosses,
    max_consecutive_before_cooldown: MAX_CONSECUTIVE_LOSSES,
    cooldown_active: isCooldownActive(),
    cooldown_until: cooldownUntil ? new Date(cooldownUntil).toISOString() : null,
    peak_equity: peakEquity,
    drawdown_from_peak: drawdownFromPeak,
    max_drawdown_pct: MAX_DRAWDOWN_FROM_PEAK_PCT,
    hourly_pnl_velocity: velocity,
    position_size_multiplier: positionSizeMultiplier,
    trades_today: tradesCount,
    wins_today: winsCount,
    losses_today: lossesCount,
    last_updated: new Date().toISOString(),
  };
}

/** Force reset breaker (operator action) */
export function resetBreaker(): BreakerSnapshot {
  currentLevel = "NORMAL";
  positionSizeMultiplier = 1.0;
  cooldownUntil = null;
  consecutiveLosses = 0;
  logger.warn("Drawdown breaker: manually reset by operator");
  return getBreakerSnapshot();
}

// ── Core Evaluation ───────────────────────────────────

function evaluateBreaker(): void {
  const totalPnl = realizedPnlToday + unrealizedPnl;
  const absLoss = Math.abs(Math.min(0, totalPnl));
  const velocity = computeVelocity();
  let newLevel: BreakerLevel = "NORMAL";

  // ── Check daily loss thresholds ──
  if (absLoss >= DAILY_LOSS_LIMIT) {
    newLevel = "HALT";
  } else if (absLoss >= DAILY_LOSS_LIMIT * THROTTLE_PCT) {
    newLevel = "THROTTLE";
  } else if (absLoss >= DAILY_LOSS_LIMIT * WARNING_PCT) {
    newLevel = "WARNING";
  }

  // ── Check velocity halt ──
  if (velocity <= VELOCITY_HALT_THRESHOLD) {
    newLevel = "HALT";
  }

  // ── Check drawdown from peak ──
  if (peakEquity > 0) {
    const drawdownPct = absLoss / peakEquity;
    if (drawdownPct >= MAX_DRAWDOWN_FROM_PEAK_PCT) {
      newLevel = "HALT";
    }
  }

  // ── Check consecutive losses ──
  if (consecutiveLosses >= MAX_CONSECUTIVE_LOSSES) {
    if (!isCooldownActive()) {
      cooldownUntil = Date.now() + COOLDOWN_MINUTES * 60_000;
      alertConsecutiveLosses(consecutiveLosses, MAX_CONSECUTIVE_LOSSES);
      logger.warn({
        consecutiveLosses,
        cooldownMinutes: COOLDOWN_MINUTES,
      }, "Drawdown breaker: cooldown activated");
    }
  }

  // ── Apply level transitions ──
  if (newLevel !== currentLevel) {
    const prevLevel = currentLevel;
    currentLevel = newLevel;

    logger.warn({
      from: prevLevel, to: newLevel,
      totalPnl: totalPnl.toFixed(2),
      absLoss: absLoss.toFixed(2),
      limit: DAILY_LOSS_LIMIT,
      velocity: velocity.toFixed(2),
    }, "Drawdown breaker: level changed");

    switch (newLevel) {
      case "WARNING":
        positionSizeMultiplier = 1.0;
        fireAlert("daily_loss_breach", "warning",
          `Daily loss $${absLoss.toFixed(2)} at 50% of $${DAILY_LOSS_LIMIT} limit`,
          { absLoss, limit: DAILY_LOSS_LIMIT, level: "WARNING" });
        break;

      case "THROTTLE":
        positionSizeMultiplier = 0.5;
        alertDailyLossBreach(totalPnl, DAILY_LOSS_LIMIT * THROTTLE_PCT);
        break;

      case "HALT":
        positionSizeMultiplier = 0;
        alertDailyLossBreach(totalPnl, DAILY_LOSS_LIMIT);
        engageHalt(totalPnl);
        break;

      case "NORMAL":
        positionSizeMultiplier = 1.0;
        break;
    }
  }
}

async function engageHalt(totalPnl: number): Promise<void> {
  logger.fatal({
    totalPnl: totalPnl.toFixed(2),
    limit: DAILY_LOSS_LIMIT,
  }, "DRAWDOWN BREAKER: HALT ENGAGED — activating kill switch");

  // Activate kill switch
  setKillSwitchActive(true);

  // Emergency liquidation — close all positions
  try {
    const { emergencyLiquidateAll } = await import("./emergency_liquidator");
    await emergencyLiquidateAll("drawdown_breaker");
  } catch (err) {
    logger.error({ err }, "Emergency liquidation failed during HALT");
  }
}

// ── Helpers ───────────────────────────────────────────

function computeVelocity(): number {
  if (pnlEvents.length === 0) return 0;
  const cutoff = Date.now() - VELOCITY_WINDOW_MS;
  const recentEvents = pnlEvents.filter((e) => e.ts >= cutoff);
  return recentEvents.reduce((sum, e) => sum + e.pnl, 0);
}

function resetDayIfNeeded(): void {
  const today = new Date().toDateString();
  if (today !== lastResetDay) {
    lastResetDay = today;
    realizedPnlToday = 0;
    unrealizedPnl = 0;
    consecutiveLosses = 0;
    cooldownUntil = null;
    currentLevel = "NORMAL";
    positionSizeMultiplier = 1.0;
    tradesCount = 0;
    winsCount = 0;
    lossesCount = 0;
    pnlEvents.length = 0;
    logger.info("Drawdown breaker: day reset");
  }
}
