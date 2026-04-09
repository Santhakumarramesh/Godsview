/**
 * Phase 33 — Macro Intelligence: Event Calendar
 *
 * Manages economic events (Fed decisions, CPI, NFP, etc.) and computes
 * trading lockout/cooldown windows. Events trigger risk scoring and
 * may gate position entry.
 */

import { randomUUID } from "node:crypto";

// ─── Types ────────────────────────────────────────────────────────────────

export type EventCategory =
  | "fed_decision"
  | "cpi"
  | "nfp"
  | "gdp"
  | "earnings"
  | "fomc_minutes"
  | "pmi"
  | "retail_sales"
  | "custom";

export type EventSeverity = "low" | "medium" | "high" | "critical";

export type EventStatus = "upcoming" | "active" | "completed" | "canceled";

export interface EconomicEvent {
  event_id: string;
  name: string;
  category: EventCategory;
  severity: EventSeverity;
  scheduled_at: string; // ISO 8601 timestamp
  symbols_affected: string[];
  pre_event_lockout_minutes: number; // Minutes before event to lock trading
  post_event_cooldown_minutes: number; // Minutes after event to cool down
  status: EventStatus;
  created_at?: string;
  updated_at?: string;
}

export interface EventWindow {
  event_id: string;
  lockout_start: string; // ISO timestamp
  lockout_end: string; // ISO timestamp (= scheduled_at)
  cooldown_end: string; // ISO timestamp
  is_in_lockout: boolean;
  is_in_cooldown: boolean;
}

// ─── State ────────────────────────────────────────────────────────────────

const events = new Map<string, EconomicEvent>();

// ─── Helpers ──────────────────────────────────────────────────────────────

function getEventWindow(event: EconomicEvent): EventWindow {
  const now = new Date();
  const scheduledAt = new Date(event.scheduled_at);
  const lockoutStart = new Date(
    scheduledAt.getTime() - event.pre_event_lockout_minutes * 60_000
  );
  const cooldownEnd = new Date(
    scheduledAt.getTime() + event.post_event_cooldown_minutes * 60_000
  );

  const is_in_lockout = now >= lockoutStart && now <= scheduledAt;
  const is_in_cooldown = now > scheduledAt && now < cooldownEnd;

  return {
    event_id: event.event_id,
    lockout_start: lockoutStart.toISOString(),
    lockout_end: scheduledAt.toISOString(),
    cooldown_end: cooldownEnd.toISOString(),
    is_in_lockout,
    is_in_cooldown,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Add a new economic event to the calendar.
 */
export function addEvent(params: Omit<EconomicEvent, "event_id" | "created_at" | "updated_at">): {
  success: boolean;
  data?: EconomicEvent;
  error?: string;
} {
  try {
    const event_id = `evt_${randomUUID()}`;
    const now = new Date().toISOString();
    const event: EconomicEvent = {
      ...params,
      event_id,
      created_at: now,
      updated_at: now,
    };

    // Validate event times
    const scheduledAt = new Date(event.scheduled_at);
    if (Number.isNaN(scheduledAt.getTime())) {
      return { success: false, error: "Invalid scheduled_at timestamp" };
    }

    events.set(event_id, event);
    return { success: true, data: event };
  } catch (err) {
    return { success: false, error: `Failed to add event: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Remove an event by ID.
 */
export function removeEvent(event_id: string): { success: boolean; error?: string } {
  try {
    if (!events.has(event_id)) {
      return { success: false, error: "Event not found" };
    }
    events.delete(event_id);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to remove event: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Get upcoming events within the next N hours (default 24).
 */
export function getUpcomingEvents(hours_ahead: number = 24): EconomicEvent[] {
  const now = new Date();
  const cutoff = new Date(now.getTime() + hours_ahead * 60 * 60_000);

  return Array.from(events.values())
    .filter((e) => {
      const scheduled = new Date(e.scheduled_at);
      return scheduled > now && scheduled <= cutoff && e.status !== "canceled";
    })
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());
}

/**
 * Get currently active events (those in lockout or cooldown window).
 */
export function getActiveEvents(): EconomicEvent[] {
  return Array.from(events.values()).filter((e) => {
    const window = getEventWindow(e);
    return window.is_in_lockout || window.is_in_cooldown;
  });
}

/**
 * Check if a symbol is currently in a trading lockout for any event.
 */
export function isInLockout(symbol: string): boolean {
  return Array.from(events.values()).some((e) => {
    if (!e.symbols_affected.includes(symbol)) return false;
    const window = getEventWindow(e);
    return window.is_in_lockout;
  });
}

/**
 * Check if a symbol is currently in a cooldown period for any event.
 */
export function isInCooldown(symbol: string): boolean {
  return Array.from(events.values()).some((e) => {
    if (!e.symbols_affected.includes(symbol)) return false;
    const window = getEventWindow(e);
    return window.is_in_cooldown;
  });
}

/**
 * Get all event windows for a given symbol.
 */
export function getEventWindows(symbol: string): EventWindow[] {
  return Array.from(events.values())
    .filter((e) => e.symbols_affected.includes(symbol) && e.status !== "canceled")
    .map(getEventWindow);
}

/**
 * Clear all events (for testing).
 */
export function _clearEvents(): void {
  events.clear();
}
