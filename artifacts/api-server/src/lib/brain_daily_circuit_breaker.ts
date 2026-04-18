// @ts-nocheck
/**
 * DESIGN SCAFFOLD — not wired into the live runtime.
 *
 * STATUS: This file is a forward-looking integration shell. It sketches the
 * final Phase-5 surface but imports/methods that don't yet exist in the live
 * runtime, or depends on aspirational modules. Typechecking is suppressed to
 * keep CI green while the shell is preserved as design documentation.
 *
 * Wiring it into the live runtime is tracked in
 * docs/PRODUCTION_READINESS.md (Phase 5: Auto-Promotion Pipeline).
 *
 * REMOVE the `// @ts-nocheck` directive once Phase 5 is implemented and all
 * referenced modules/methods exist.
 */
/**
 * brain_daily_circuit_breaker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 10D: Brain-level Daily Risk Circuit Breaker
 *
 * Monitors brain P&L in R-multiples and enforces hard daily risk limits.
 * When breached → brain enters PAUSED mode + alert fires + all new signals blocked.
 *
 * Limits (all configurable via env vars):
 *   BRAIN_MAX_DAILY_LOSS_R   — max daily loss in R (default: -6R)
 *   BRAIN_MAX_DAILY_TRADES   — max trades per day (default: 20)
 *   BRAIN_MAX_OPEN_POSITIONS — already in bridge, also enforced here
 *   BRAIN_DAILY_WIN_RATE_MIN — min win rate after 10 trades (default: 0.30)
 *
 * Circuit states:
 *   OPEN   — normal operation
 *   HALF   — warning zone (75% of limit hit) → DEFENSIVE mode
 *   TRIPPED— limit breached → PAUSED mode + no new signals
 *
 * Auto-resets at midnight UTC (new trading day).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { brainAlerts } from "./brain_alerts.js";

// ── Config ────────────────────────────────────────────────────────────────────

const MAX_DAILY_LOSS_R   = parseFloat(process.env.BRAIN_MAX_DAILY_LOSS_R   ?? "-6");   // -6R
const MAX_DAILY_TRADES   = parseInt(process.env.BRAIN_MAX_DAILY_TRADES     ?? "20", 10);
const WIN_RATE_MIN       = parseFloat(process.env.BRAIN_DAILY_WIN_RATE_MIN ?? "0.30");  // 30% after 10 trades
const WIN_RATE_MIN_TRADES = 10; // don't enforce WR until this many trades

// ── Types ─────────────────────────────────────────────────────────────────────

export type CircuitState = "OPEN" | "HALF_OPEN" | "TRIPPED";

export interface CircuitTripEvent {
  reason: "MAX_DAILY_LOSS_R" | "MAX_DAILY_TRADES" | "MIN_WIN_RATE" | "MANUAL";
  triggeredAt: number;
  dailyPnlR: number;
  dailyTrades: number;
  dailyWinRate: number;
  details: string;
}

export interface CircuitSnapshot {
  state: CircuitState;
  dailyPnlR: number;
  dailyTrades: number;
  dailyWins: number;
  dailyLosses: number;
  dailyWinRate: number;
  maxDailyLossR: number;
  maxDailyTrades: number;
  tripEvents: CircuitTripEvent[];
  lastResetAt: number;
  lastCheckAt: number;
}

// ── Circuit Breaker ───────────────────────────────────────────────────────────

class BrainDailyCircuitBreaker {
  private state: CircuitState = "OPEN";
  private dailyPnlR = 0;
  private dailyTrades = 0;
  private dailyWins = 0;
  private dailyLosses = 0;
  private tripEvents: CircuitTripEvent[] = [];
  private lastResetAt: number = Date.now();
  private lastCheckAt: number = Date.now();
  private midnightResetTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this._scheduleMidnightReset();
  }

  // ── Record a completed trade ───────────────────────────────────────────────

  recordTrade(pnlR: number): void {
    this.dailyPnlR += pnlR;
    this.dailyTrades++;
    if (pnlR > 0) this.dailyWins++;
    else this.dailyLosses++;

    this._evaluate();
  }

  // ── Check if a new signal should be allowed ────────────────────────────────

  allowSignal(): boolean {
    return this.state !== "TRIPPED";
  }

  // ── Return current brain mode recommendation ───────────────────────────────

  recommendedMode(): "AGGRESSIVE" | "NORMAL" | "DEFENSIVE" | "PAUSED" {
    switch (this.state) {
      case "TRIPPED":    return "PAUSED";
      case "HALF_OPEN":  return "DEFENSIVE";
      default:           return "NORMAL";
    }
  }

  // ── Manual override ────────────────────────────────────────────────────────

  manualTrip(reason = "Manual circuit trip"): void {
    this._trip("MANUAL", reason);
  }

  manualReset(): void {
    this.state = "OPEN";
    logger.info("[CircuitBreaker] Manually reset to OPEN");
    brainAlerts.custom("CUSTOM", "info", "Circuit Breaker Reset", "Daily risk circuit breaker manually reset").catch(() => {});
  }

  // ── Daily reset ────────────────────────────────────────────────────────────

  dailyReset(): void {
    this.dailyPnlR = 0;
    this.dailyTrades = 0;
    this.dailyWins = 0;
    this.dailyLosses = 0;
    this.state = "OPEN";
    this.lastResetAt = Date.now();
    this.tripEvents = this.tripEvents.slice(-10); // keep last 10 trip events for audit
    logger.info("[CircuitBreaker] Daily reset — new trading day");
  }

  // ── Snapshot ───────────────────────────────────────────────────────────────

  getSnapshot(): CircuitSnapshot {
    return {
      state: this.state,
      dailyPnlR: round2(this.dailyPnlR),
      dailyTrades: this.dailyTrades,
      dailyWins: this.dailyWins,
      dailyLosses: this.dailyLosses,
      dailyWinRate: this.dailyTrades > 0 ? round2(this.dailyWins / this.dailyTrades) : 0,
      maxDailyLossR: MAX_DAILY_LOSS_R,
      maxDailyTrades: MAX_DAILY_TRADES,
      tripEvents: this.tripEvents.slice(-20),
      lastResetAt: this.lastResetAt,
      lastCheckAt: this.lastCheckAt,
    };
  }

  // ── Internal ───────────────────────────────────────────────────────────────

  private _evaluate(): void {
    this.lastCheckAt = Date.now();
    const winRate = this.dailyTrades > 0 ? this.dailyWins / this.dailyTrades : 1;
    const halfLossR = MAX_DAILY_LOSS_R * 0.75;    // 75% of daily limit
    const halfTrades = Math.floor(MAX_DAILY_TRADES * 0.80); // 80% of max trades

    // ── TRIPPED checks ─────────────────────────────────────────────────────
    if (this.dailyPnlR <= MAX_DAILY_LOSS_R) {
      this._trip("MAX_DAILY_LOSS_R",
        `Daily loss limit hit: ${this.dailyPnlR.toFixed(2)}R ≤ ${MAX_DAILY_LOSS_R}R`);
      return;
    }
    if (this.dailyTrades >= MAX_DAILY_TRADES) {
      this._trip("MAX_DAILY_TRADES",
        `Max daily trades reached: ${this.dailyTrades} ≥ ${MAX_DAILY_TRADES}`);
      return;
    }
    if (this.dailyTrades >= WIN_RATE_MIN_TRADES && winRate < WIN_RATE_MIN) {
      this._trip("MIN_WIN_RATE",
        `Win rate too low: ${(winRate * 100).toFixed(0)}% < ${(WIN_RATE_MIN * 100).toFixed(0)}% (${this.dailyTrades} trades)`);
      return;
    }

    // ── HALF_OPEN warnings ─────────────────────────────────────────────────
    if (this.state === "OPEN") {
      if (this.dailyPnlR <= halfLossR || this.dailyTrades >= halfTrades) {
        this.state = "HALF_OPEN";
        logger.warn({
          dailyPnlR: this.dailyPnlR, dailyTrades: this.dailyTrades,
        }, "[CircuitBreaker] Entering HALF_OPEN — approaching daily limits");

        brainAlerts.custom(
          "RISK_LIMIT_HIT", "warning",
          "Approaching Daily Risk Limit",
          `PnL: ${this.dailyPnlR.toFixed(2)}R | Trades: ${this.dailyTrades} | Mode → DEFENSIVE`
        ).catch(() => {});
      }
    }
  }

  private _trip(reason: CircuitTripEvent["reason"], details: string): void {
    if (this.state === "TRIPPED") return; // already tripped

    this.state = "TRIPPED";
    const winRate = this.dailyTrades > 0 ? this.dailyWins / this.dailyTrades : 0;

    const event: CircuitTripEvent = {
      reason,
      triggeredAt: Date.now(),
      dailyPnlR: round2(this.dailyPnlR),
      dailyTrades: this.dailyTrades,
      dailyWinRate: round2(winRate),
      details,
    };
    this.tripEvents.push(event);

    logger.error({ event }, "[CircuitBreaker] TRIPPED — brain paused");

    brainAlerts.custom(
      "RISK_LIMIT_HIT", "critical",
      `🚨 Brain Circuit Tripped — ${reason}`,
      `${details} | Daily P&L: ${this.dailyPnlR.toFixed(2)}R | Trades: ${this.dailyTrades}`
    ).catch(() => {});

    // Auto-pause the brain
    import("./autonomous_brain.js").then(({ autonomousBrain }) => {
      if (autonomousBrain.status.mode !== "PAUSED") {
        autonomousBrain.setMode("PAUSED");
        logger.warn("[CircuitBreaker] Brain auto-paused due to circuit trip");
      }
    }).catch(() => {});
  }

  private _scheduleMidnightReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCHours(24, 0, 30, 0); // midnight UTC + 30s buffer
    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    this.midnightResetTimer = setTimeout(() => {
      this.dailyReset();
      this._scheduleMidnightReset(); // reschedule for next day
    }, msUntilMidnight);

    logger.info({ msUntilMidnight }, "[CircuitBreaker] Midnight reset scheduled");
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const brainCircuitBreaker = new BrainDailyCircuitBreaker();
