/**
 * macro_engine.ts — Macro/News Intelligence Engine
 *
 * Ingests and manages macro events (economic calendar, earnings, geopolitical, fed, sector news).
 * Computes overall sentiment, risk levels, and trading lockouts based on event impact.
 */

import { logger } from "./logger";

export interface MacroEvent {
  id: string;
  type: "economic_calendar" | "earnings" | "geopolitical" | "fed" | "sector_news";
  title: string;
  impact: "low" | "medium" | "high" | "critical";
  sentiment: number; // -1 to 1
  related_symbols: string[];
  source: string;
  timestamp: string;
}

export interface MacroContext {
  events: MacroEvent[];
  overall_sentiment: number;
  risk_level: "low" | "moderate" | "elevated" | "extreme";
  lockout_active: boolean;
  lockout_reason: string | null;
  news_count_24h: number;
  high_impact_upcoming: MacroEvent[];
  generated_at: string;
}

interface MacroCacheEntry {
  context: MacroContext;
  timestamp: number;
}

// In-memory event store (FIFO, max 500)
const eventStore: MacroEvent[] = [];
const MAX_EVENTS = 500;

// Cache with 1-minute TTL
let cachedContext: MacroCacheEntry | null = null;
const CACHE_TTL = 60 * 1000; // 1 minute

/**
 * Ingest a macro event into the store (FIFO, max 500)
 */
export function ingestMacroEvent(event: MacroEvent): void {
  eventStore.push(event);
  if (eventStore.length > MAX_EVENTS) {
    eventStore.shift();
  }
  logger.info(`Ingested macro event: ${event.type} | ${event.title}`);
  // Invalidate cache
  cachedContext = null;
}

/**
 * Clear all macro events
 */
export function clearMacroEvents(): void {
  eventStore.length = 0;
  cachedContext = null;
  logger.info(`Cleared all macro events`);
}

/**
 * Get macro cache statistics
 */
export function getMacroCacheStats(): {
  event_count: number;
  last_event_time: string | null;
} {
  return {
    event_count: eventStore.length,
    last_event_time: eventStore.length > 0 ? eventStore[eventStore.length - 1].timestamp : null,
  };
}

/**
 * Check if a symbol has a news lockout (critical/high impact event within 15 min)
 */
export function checkNewsLockout(symbol: string): {
  locked: boolean;
  reason: string | null;
} {
  const now = Date.now();
  const lockoutWindowMs = 15 * 60 * 1000; // 15 minutes

  for (const event of eventStore) {
    const eventTime = new Date(event.timestamp).getTime();
    const isInLockoutWindow = eventTime > now && eventTime - now <= lockoutWindowMs;
    const isCriticalOrHigh = event.impact === "critical" || event.impact === "high";
    const isRelatedToSymbol = event.related_symbols.includes(symbol);

    if (isInLockoutWindow && isCriticalOrHigh && isRelatedToSymbol) {
      return {
        locked: true,
        reason: `${event.type}: ${event.title}`,
      };
    }
  }

  return { locked: false, reason: null };
}

/**
 * Get macro context with optional symbol filtering
 */
export function getMacroContext(symbols?: string[]): MacroContext {
  // Check cache
  if (cachedContext && Date.now() - cachedContext.timestamp < CACHE_TTL) {
    return cachedContext.context;
  }

  const now = Date.now();
  const futureEvents = eventStore.filter((e) => new Date(e.timestamp).getTime() > now);
  const recentEvents = eventStore.slice(-100); // Last 100 for sentiment calculation

  // Filter by symbols if provided
  let relevantEvents = recentEvents;
  if (symbols && symbols.length > 0) {
    relevantEvents = recentEvents.filter((e) =>
      symbols.some((sym) => e.related_symbols.includes(sym))
    );
  }

  // Compute overall sentiment (average of all relevant events)
  const overallSentiment =
    relevantEvents.length > 0
      ? relevantEvents.reduce((sum, e) => sum + e.sentiment, 0) / relevantEvents.length
      : 0;

  // Count high/critical events in next 30 minutes for lockout check
  const thirtyMinAhead = now + 30 * 60 * 1000;
  const criticalUpcoming = futureEvents.filter((e) => {
    const eventTime = new Date(e.timestamp).getTime();
    return (
      eventTime <= thirtyMinAhead &&
      (e.impact === "critical" || e.impact === "high")
    );
  });

  // Determine risk level
  let riskLevel: "low" | "moderate" | "elevated" | "extreme" = "low";
  const criticalCount = criticalUpcoming.length;
  if (criticalCount >= 6) {
    riskLevel = "extreme";
  } else if (criticalCount >= 3) {
    riskLevel = "elevated";
  } else if (criticalCount >= 1) {
    riskLevel = "moderate";
  }

  // Determine lockout status
  const lockout = criticalUpcoming.length > 0;
  const lockoutReason = lockout
    ? `${criticalUpcoming.length} critical/high impact events in next 30min`
    : null;

  // Count 24h news
  const twentyFourHourAgo = now - 24 * 60 * 60 * 1000;
  const newsCount24h = recentEvents.filter((e) => {
    const eventTime = new Date(e.timestamp).getTime();
    return eventTime > twentyFourHourAgo;
  }).length;

  const context: MacroContext = {
    events: recentEvents,
    overall_sentiment: Math.round(overallSentiment * 100) / 100,
    risk_level: riskLevel,
    lockout_active: lockout,
    lockout_reason: lockoutReason,
    news_count_24h: newsCount24h,
    high_impact_upcoming: criticalUpcoming.slice(0, 10),
    generated_at: new Date().toISOString(),
  };

  // Cache the context
  cachedContext = {
    context,
    timestamp: Date.now(),
  };

  return context;
}
