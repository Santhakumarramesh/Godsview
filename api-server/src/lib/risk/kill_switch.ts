/**
 * Kill Switch — Hard emergency stop for all trading activity.
 *
 * This is the LAST LINE OF DEFENSE. When activated:
 * 1. All new order submissions are BLOCKED
 * 2. All open orders are CANCELLED
 * 3. All positions are closed at market (via emergency liquidator)
 * 4. Mode is downgraded to "observation_only"
 * 5. A full audit record is written
 *
 * The kill switch can be triggered by:
 * - Operator manual action (API/dashboard)
 * - Circuit breaker escalation (repeated trips)
 * - Drawdown breaker HALT level
 * - Data quality degradation below threshold
 * - Calibration drift exceeding limits
 * - System health failure (dependency down)
 *
 * REACTIVATION requires explicit operator confirmation — never auto-resets.
 */
import { logger } from "../logger.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type KillSwitchReason =
  | "operator_manual"
  | "circuit_breaker_escalation"
  | "drawdown_halt"
  | "data_quality_degraded"
  | "calibration_drift"
  | "system_health_failure"
  | "exposure_limit_breach"
  | "preflight_failure"
  | "unknown";

export interface KillSwitchState {
  active: boolean;
  activatedAt: string | null;
  reason: KillSwitchReason | null;
  activatedBy: string;          // "system" | operator ID
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  tripCount: number;            // lifetime trip count
  lastTripAt: string | null;
  cooldownUntil: string | null; // forced cooldown after deactivation
}

export interface KillSwitchEvent {
  type: "activated" | "deactivated" | "blocked_order" | "cooldown_started";
  timestamp: string;
  reason: KillSwitchReason | null;
  actor: string;
  details?: Record<string, unknown>;
}

// ── State ────────────────────────────────────────────────────────────────────

const COOLDOWN_MINUTES = 30; // mandatory cooldown after kill switch deactivation

let state: KillSwitchState = {
  active: false,
  activatedAt: null,
  reason: null,
  activatedBy: "system",
  deactivatedAt: null,
  deactivatedBy: null,
  tripCount: 0,
  lastTripAt: null,
  cooldownUntil: null,
};

const eventLog: KillSwitchEvent[] = [];

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Activate the kill switch. Blocks all trading immediately.
 * Returns true if newly activated, false if already active.
 */
export function activateKillSwitch(
  reason: KillSwitchReason,
  actor = "system",
  details?: Record<string, unknown>,
): boolean {
  if (state.active) {
    logger.warn({ reason, actor }, "Kill switch already active — ignoring duplicate activation");
    return false;
  }

  const now = new Date().toISOString();
  state = {
    ...state,
    active: true,
    activatedAt: now,
    reason,
    activatedBy: actor,
    deactivatedAt: null,
    deactivatedBy: null,
    tripCount: state.tripCount + 1,
    lastTripAt: now,
    cooldownUntil: null,
  };

  const event: KillSwitchEvent = {
    type: "activated",
    timestamp: now,
    reason,
    actor,
    details,
  };
  eventLog.push(event);

  logger.error({
    reason,
    actor,
    tripCount: state.tripCount,
    ...details,
  }, "🚨 KILL SWITCH ACTIVATED — ALL TRADING HALTED");

  return true;
}

/**
 * Deactivate the kill switch. Requires explicit operator action.
 * Enforces a mandatory cooldown period before trading can resume.
 */
export function deactivateKillSwitch(
  actor: string,
  confirmationCode?: string,
): { success: boolean; error?: string } {
  if (!state.active) {
    return { success: false, error: "Kill switch is not active" };
  }

  if (actor === "system") {
    return { success: false, error: "Kill switch cannot be deactivated by system — requires operator" };
  }

  // In production, require a confirmation code to prevent accidental deactivation
  // For now, just require the actor to be non-system
  const now = new Date().toISOString();
  const cooldownUntil = new Date(Date.now() + COOLDOWN_MINUTES * 60 * 1000).toISOString();

  state = {
    ...state,
    active: false,
    deactivatedAt: now,
    deactivatedBy: actor,
    cooldownUntil,
  };

  eventLog.push({
    type: "deactivated",
    timestamp: now,
    reason: null,
    actor,
  });

  eventLog.push({
    type: "cooldown_started",
    timestamp: now,
    reason: null,
    actor: "system",
    details: { cooldownMinutes: COOLDOWN_MINUTES, cooldownUntil },
  });

  logger.warn({
    actor,
    cooldownUntil,
    cooldownMinutes: COOLDOWN_MINUTES,
  }, "Kill switch deactivated — cooldown period started");

  return { success: true };
}

/**
 * Check if trading is allowed. Returns false if kill switch is active
 * OR if we're still in a cooldown period after deactivation.
 */
export function isTradingAllowed(): boolean {
  if (state.active) return false;

  if (state.cooldownUntil) {
    const cooldownEnd = new Date(state.cooldownUntil).getTime();
    if (Date.now() < cooldownEnd) return false;
  }

  return true;
}

/**
 * Guard function — call before any order submission.
 * Throws if trading is not allowed.
 */
export function guardOrderSubmission(context: string): void {
  if (state.active) {
    const event: KillSwitchEvent = {
      type: "blocked_order",
      timestamp: new Date().toISOString(),
      reason: state.reason,
      actor: "system",
      details: { context },
    };
    eventLog.push(event);

    logger.warn({ context, reason: state.reason }, "Order blocked by kill switch");
    throw new Error(`Kill switch active (${state.reason}) — order blocked: ${context}`);
  }

  if (state.cooldownUntil) {
    const cooldownEnd = new Date(state.cooldownUntil).getTime();
    if (Date.now() < cooldownEnd) {
      const remainingMs = cooldownEnd - Date.now();
      const remainingMin = Math.ceil(remainingMs / 60000);
      throw new Error(`Kill switch cooldown active — ${remainingMin}min remaining. Context: ${context}`);
    }
  }
}

/** Get current kill switch state (read-only snapshot) */
export function getKillSwitchState(): Readonly<KillSwitchState> {
  return { ...state };
}

/** Get recent kill switch events */
export function getKillSwitchEvents(limit = 50): readonly KillSwitchEvent[] {
  return eventLog.slice(-limit);
}

/** Reset state (for testing only) */
export function _resetKillSwitch(): void {
  state = {
    active: false,
    activatedAt: null,
    reason: null,
    activatedBy: "system",
    deactivatedAt: null,
    deactivatedBy: null,
    tripCount: 0,
    lastTripAt: null,
    cooldownUntil: null,
  };
  eventLog.length = 0;
}
