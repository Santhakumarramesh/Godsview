/**
 * monitor_event_store.ts — Persistent Monitor Event Storage (Phase 51)
 *
 * Records and manages trading system events:
 *   - Regime changes
 *   - Lockouts (strategy pauses)
 *   - Alerts and warnings
 *   - News events
 *   - Volatility spikes
 *   - Feed degradation
 *   - Circuit breaker triggers
 */

import { persistAppend, persistRead, persistWrite } from "../lib/persistent_store.js";
import { logger } from "../lib/logger.js";

export interface MonitorEvent {
  id: string;
  type:
    | "regime_change"
    | "lockout"
    | "alert"
    | "news"
    | "volatility_spike"
    | "feed_degradation"
    | "circuit_break";
  severity: "info" | "warning" | "critical";
  symbol?: string;
  description: string;
  impact: string[];
  timestamp: string;
  resolved: boolean;
  resolvedAt?: string;
}

export function recordMonitorEvent(event: MonitorEvent): void {
  try {
    persistAppend("monitor_events", event, 5000);
    logger.info(
      { id: event.id, type: event.type, severity: event.severity },
      "Monitor event recorded"
    );
  } catch (error) {
    logger.error({ error, eventId: event.id }, "Failed to record monitor event");
    throw error;
  }
}

export function getMonitorEvents(opts?: {
  symbol?: string;
  type?: string;
  severity?: string;
  from?: string;
  to?: string;
  limit?: number;
  resolved?: boolean;
}): MonitorEvent[] {
  try {
    let events = persistRead<MonitorEvent[]>("monitor_events", []);

    if (opts?.symbol) events = events.filter((e) => e.symbol === opts.symbol);
    if (opts?.type) events = events.filter((e) => e.type === opts.type);
    if (opts?.severity) events = events.filter((e) => e.severity === opts.severity);
    if (opts?.from) events = events.filter((e) => e.timestamp >= opts.from!);
    if (opts?.to) events = events.filter((e) => e.timestamp <= opts.to!);
    if (opts?.resolved !== undefined)
      events = events.filter((e) => e.resolved === opts.resolved);

    if (opts?.limit) events = events.slice(-opts.limit);

    return events;
  } catch (error) {
    logger.warn({ error }, "Failed to read monitor events");
    return [];
  }
}

export function resolveMonitorEvent(eventId: string): boolean {
  try {
    const events = persistRead<MonitorEvent[]>("monitor_events", []);
    const idx = events.findIndex((e) => e.id === eventId);

    if (idx === -1) {
      logger.warn({ eventId }, "Monitor event not found for resolution");
      return false;
    }

    events[idx]!.resolved = true;
    events[idx]!.resolvedAt = new Date().toISOString();
    persistWrite("monitor_events", events);

    logger.info({ eventId }, "Monitor event resolved");
    return true;
  } catch (error) {
    logger.error({ error, eventId }, "Failed to resolve monitor event");
    return false;
  }
}

export function getUnresolvedEvents(): MonitorEvent[] {
  try {
    return persistRead<MonitorEvent[]>("monitor_events", []).filter((e) => !e.resolved);
  } catch (error) {
    logger.warn({ error }, "Failed to read unresolved events");
    return [];
  }
}

export function getEventsBySymbol(symbol: string): MonitorEvent[] {
  return getMonitorEvents({ symbol });
}

export function getCriticalEvents(): MonitorEvent[] {
  return getMonitorEvents({ severity: "critical" });
}

export function clearMonitorEvents(): void {
  try {
    persistWrite("monitor_events", []);
    logger.info("Cleared all monitor events");
  } catch (error) {
    logger.error({ error }, "Failed to clear monitor events");
  }
}

export function getEventStatistics(): {
  total: number;
  unresolved: number;
  byType: Record<string, number>;
  bySeverity: Record<string, number>;
} {
  const events = persistRead<MonitorEvent[]>("monitor_events", []);
  const byType: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};

  for (const event of events) {
    byType[event.type] = (byType[event.type] ?? 0) + 1;
    bySeverity[event.severity] = (bySeverity[event.severity] ?? 0) + 1;
  }

  const unresolved = events.filter((e) => !e.resolved).length;

  return { total: events.length, unresolved, byType, bySeverity };
}
