/**
 * macro_risk.ts — M5d-β + M5d-news + M5d-economic-calendar (read-only)
 *
 * Mounts at /api/macro-risk (see routes/index.ts).
 *
 * Aggregates the GodsView macro layer into ONE honest endpoint with explicit
 * source-quality labels per section.
 *
 * Hard rules:
 *  - GET only. No state writes.
 *  - No fake events, no fake sentiment, no fake risk levels, no fake articles.
 *  - Every value carries its source. When a layer has no provider, returns
 *    `status: "not_connected"` with a human-readable reason.
 *
 * Sources:
 *  - FRED API (real) via providers/fred_client                          [M5d-β]
 *  - macro_engine in-memory event store (POST /api/macro/events ingest) [M5d-β]
 *  - Alpaca News API (real) via lib/news_feed_service                   [M5d-news]
 *  - FRED Releases (real) via providers/fred_calendar_client            [M5d-cal]
 *
 * news_window activation rules (M5d-cal):
 *  - active=true ONLY when at least one high/critical event has timestamp
 *    within window NEWS_WINDOW_BEFORE_MS BEFORE now and NEWS_WINDOW_AFTER_MS
 *    AFTER now. Both bounds documented as constants below.
 *  - affected_symbols = union of related_symbols for events in window.
 *  - When the calendar provider AND macro_engine event store are both empty,
 *    news_window.active is always false (default off, never activates without
 *    a real event).
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getMacroContext, type MacroEvent } from "../lib/macro_engine";
import { fetchFredMacroSnapshot, type FredMacroSnapshot } from "../lib/providers/fred_client.js";
import {
  fetchLatestHeadlines,
  type NewsHeadline,
} from "../lib/news_feed_service";
import {
  fetchUpcomingEconomicEvents,
  type EconomicEvent,
} from "../lib/providers/fred_calendar_client";

const router = Router();

// M5d-cal: news_window activation thresholds (real events only)
const NEWS_WINDOW_BEFORE_MS = 30 * 60 * 1000;  // 30 min before release
const NEWS_WINDOW_AFTER_MS  = 15 * 60 * 1000;  // 15 min after release
const TWENTY_FOUR_HOURS_MS  = 24 * 60 * 60 * 1000;

// ── Response types ───────────────────────────────────────────────────────────

export type SourceQuality = "real" | "partial" | "not_connected";

export interface FredSection {
  status: "ok" | "not_connected";
  value: FredMacroSnapshot | null;
  reason?: string;
}

/**
 * Events section (M5d-β + M5d-cal).
 *
 * `status: "ok"` when EITHER the FRED economic calendar provider OR the
 * macro_engine in-memory store contributed at least one event during this
 * aggregator pass. Both empty → "not_connected" with explicit reason.
 *
 * `provider` is the dominant source actually populated. Events from
 * /api/macro/events ingestion (macro_engine) are merged into the same array.
 *
 * `next_event` is the soonest UPCOMING event (timestamp >= now) regardless
 * of impact level — surfaced for visibility. The aggregator's news_window
 * activation uses high/critical events only.
 */
export interface EventsSection {
  status: "ok" | "not_connected";
  provider: "fred_releases" | "macro_engine" | "fred_releases+macro_engine" | "none";
  count_24h: number;
  count_upcoming: number;
  high_impact_upcoming: Array<MacroEvent | EconomicEvent>;
  next_event: MacroEvent | EconomicEvent | null;
  last_updated: string | null;
  reason?: string;
}

export interface NewsWindowSection {
  active: boolean;
  reason: string | null;
  affected_symbols: string[];
  /** M5d-cal: documented activation window in milliseconds, surfaced for transparency. */
  window_before_ms: number;
  window_after_ms: number;
}

export interface NewsFeedSection {
  status: "ok" | "not_connected";
  feed_connected: boolean;
  latest_headlines: NewsHeadline[];
  count: number;
  provider: "alpaca_news";
  last_updated: string | null;
  reason: string;
}

export interface MacroRiskSummary {
  /** Risk vocabulary matches FRED's macro_risk literal union. */
  level: "low" | "moderate" | "elevated" | "high" | null;
  drivers: string[];
  source_quality: SourceQuality;
}

export interface MacroRiskResponse {
  status: "ok" | "partial" | "not_connected";
  generated_at: string;
  macro_risk: MacroRiskSummary;
  fred: FredSection;
  events: EventsSection;
  news_window: NewsWindowSection;
  news_feed: NewsFeedSection;
  last_updated: string | null;
}

// ── Aggregator ───────────────────────────────────────────────────────────────

export async function buildMacroRiskAggregate(): Promise<MacroRiskResponse> {
  const generated_at = new Date().toISOString();
  const nowMs = Date.now();
  let last_updated: string | null = null;

  // FRED snapshot (M5d-β — unchanged)
  let fredSection: FredSection;
  try {
    const snapshot = await fetchFredMacroSnapshot();
    fredSection = { status: "ok", value: snapshot };
    last_updated = snapshot.fetched_at ?? last_updated;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[macro-risk] FRED snapshot fetch failed (non-fatal)");
    fredSection = {
      status: "not_connected",
      value: null,
      reason: `FRED API unavailable: ${msg}`,
    };
  }

  // ── M5d-cal: real economic calendar from FRED Releases ────────────────────
  let calendarEvents: EconomicEvent[] = [];
  let calendarProviderStatus: "ok" | "not_connected" = "not_connected";
  let calendarReason = "";
  let calendarLastUpdated: string | null = null;
  try {
    const cal = await fetchUpcomingEconomicEvents();
    calendarProviderStatus = cal.status;
    calendarEvents = cal.events;
    calendarReason = cal.reason;
    calendarLastUpdated = cal.last_updated;
    if (cal.last_updated) {
      last_updated = cal.last_updated > (last_updated ?? "") ? cal.last_updated : last_updated;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[macro-risk] FRED calendar fetch threw (non-fatal)");
    calendarProviderStatus = "not_connected";
    calendarReason = `fred_calendar_client error: ${msg}`;
  }

  // ── macro_engine event store (M5d-β: still drained for any POSTed events) ─
  let macroEngineEvents: MacroEvent[] = [];
  let macroEngineGeneratedAt: string | null = null;
  try {
    const ctx = getMacroContext();
    macroEngineEvents = ctx.events ?? [];
    macroEngineGeneratedAt = ctx.generated_at ?? null;
    if (macroEngineGeneratedAt) {
      last_updated = macroEngineGeneratedAt > (last_updated ?? "") ? macroEngineGeneratedAt : last_updated;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[macro-risk] macro_engine context failed (non-fatal)");
  }

  // ── Merge calendar + macro_engine into the events section ─────────────────
  const eventsSection = buildEventsSection(
    calendarEvents,
    calendarProviderStatus,
    calendarReason,
    calendarLastUpdated,
    macroEngineEvents,
    macroEngineGeneratedAt,
    nowMs,
  );

  // ── M5d-cal: news_window activation strictly from real events ────────────
  const newsWindow = buildNewsWindow(calendarEvents, macroEngineEvents, nowMs);

  // News feed (M5d-news — unchanged)
  let newsFeedSection: NewsFeedSection;
  try {
    const feed = await fetchLatestHeadlines({ limit: 10 });
    newsFeedSection = {
      status: feed.status,
      feed_connected: feed.feed_connected,
      latest_headlines: feed.latest_headlines,
      count: feed.count,
      provider: feed.provider,
      last_updated: feed.last_updated,
      reason: feed.reason,
    };
    if (feed.status === "ok" && feed.last_updated) {
      last_updated = feed.last_updated > (last_updated ?? "") ? feed.last_updated : last_updated;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[macro-risk] news feed adapter threw (non-fatal)");
    newsFeedSection = {
      status: "not_connected",
      feed_connected: false,
      latest_headlines: [],
      count: 0,
      provider: "alpaca_news",
      last_updated: null,
      reason: `news_feed_service error: ${msg}`,
    };
  }

  const macro_risk: MacroRiskSummary = synthesizeMacroRisk(fredSection, eventsSection);

  let status: MacroRiskResponse["status"];
  if (fredSection.status === "ok" && eventsSection.status === "ok") status = "ok";
  else if (fredSection.status === "ok" || eventsSection.status === "ok") status = "partial";
  else status = "not_connected";

  return {
    status,
    generated_at,
    macro_risk,
    fred: fredSection,
    events: eventsSection,
    news_window: newsWindow,
    news_feed: newsFeedSection,
    last_updated,
  };
}

// ── M5d-cal: events section builder (pure) ───────────────────────────────────

function buildEventsSection(
  calendarEvents: EconomicEvent[],
  calendarStatus: "ok" | "not_connected",
  calendarReason: string,
  calendarLastUpdated: string | null,
  macroEngineEvents: MacroEvent[],
  macroEngineGeneratedAt: string | null,
  nowMs: number,
): EventsSection {
  const merged: Array<MacroEvent | EconomicEvent> = [
    ...calendarEvents,
    ...macroEngineEvents,
  ];

  const upcoming = merged
    .filter((e) => Date.parse(e.timestamp) >= nowMs)
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  const high_impact_upcoming = upcoming
    .filter((e) => e.impact === "critical" || e.impact === "high")
    .slice(0, 5);

  const next_event = upcoming.length > 0 ? upcoming[0]! : null;

  const count_24h = merged.filter((e) => {
    const t = Date.parse(e.timestamp);
    return t >= nowMs - TWENTY_FOUR_HOURS_MS && t <= nowMs + TWENTY_FOUR_HOURS_MS;
  }).length;

  const count_upcoming = upcoming.length;

  const calendarOk = calendarStatus === "ok" && calendarEvents.length > 0;
  const engineOk = macroEngineEvents.length > 0;

  let provider: EventsSection["provider"];
  if (calendarOk && engineOk) provider = "fred_releases+macro_engine";
  else if (calendarOk) provider = "fred_releases";
  else if (engineOk) provider = "macro_engine";
  else provider = "none";

  const status: "ok" | "not_connected" = (calendarOk || engineOk) ? "ok" : "not_connected";

  let last_updated: string | null = null;
  if (calendarLastUpdated) last_updated = calendarLastUpdated;
  if (macroEngineGeneratedAt && (!last_updated || macroEngineGeneratedAt > last_updated)) {
    last_updated = macroEngineGeneratedAt;
  }

  let reason: string | undefined;
  if (status === "not_connected") {
    if (calendarStatus === "not_connected") {
      reason =
        calendarReason ||
        "FRED Releases provider returned no events; macro_engine in-memory store is empty.";
    } else {
      reason =
        "Both providers connected but produced zero events. Check FRED release allow-list and POST /api/macro/events ingestion.";
    }
  }

  return {
    status,
    provider,
    count_24h,
    count_upcoming,
    high_impact_upcoming,
    next_event,
    last_updated,
    ...(reason !== undefined ? { reason } : {}),
  };
}

// ── M5d-cal: news_window activation (pure) ──────────────────────────────────

function buildNewsWindow(
  calendarEvents: EconomicEvent[],
  macroEngineEvents: MacroEvent[],
  nowMs: number,
): NewsWindowSection {
  const all: Array<MacroEvent | EconomicEvent> = [...calendarEvents, ...macroEngineEvents];

  const inWindow = all.filter((e) => {
    if (e.impact !== "critical" && e.impact !== "high") return false;
    const t = Date.parse(e.timestamp);
    if (!Number.isFinite(t)) return false;
    return t >= nowMs - NEWS_WINDOW_AFTER_MS && t <= nowMs + NEWS_WINDOW_BEFORE_MS;
  });

  if (inWindow.length === 0) {
    return {
      active: false,
      reason: null,
      affected_symbols: [],
      window_before_ms: NEWS_WINDOW_BEFORE_MS,
      window_after_ms: NEWS_WINDOW_AFTER_MS,
    };
  }

  // Pick the soonest event in window for the human-readable reason
  inWindow.sort((a, b) => Math.abs(Date.parse(a.timestamp) - nowMs) - Math.abs(Date.parse(b.timestamp) - nowMs));
  const driver = inWindow[0]!;
  const minutesAway = Math.round((Date.parse(driver.timestamp) - nowMs) / 60000);
  const direction = minutesAway >= 0 ? `in ~${minutesAway} min` : `${Math.abs(minutesAway)} min ago`;
  const title = "title" in driver ? driver.title : "(unknown)";

  const affected = new Set<string>();
  for (const ev of inWindow) {
    for (const s of ev.related_symbols ?? []) affected.add(s);
  }

  return {
    active: true,
    reason: `${driver.impact} event "${title}" ${direction} (within news window ${-NEWS_WINDOW_AFTER_MS / 60000}m..+${NEWS_WINDOW_BEFORE_MS / 60000}m).`,
    affected_symbols: Array.from(affected),
    window_before_ms: NEWS_WINDOW_BEFORE_MS,
    window_after_ms: NEWS_WINDOW_AFTER_MS,
  };
}

function synthesizeMacroRisk(fred: FredSection, events: EventsSection): MacroRiskSummary {
  const drivers: string[] = [];
  let level: MacroRiskSummary["level"] = null;
  let source_quality: SourceQuality = "not_connected";

  if (fred.status === "ok" && fred.value) {
    const fredLabel = fred.value.macro_risk;
    if (fredLabel === "low" || fredLabel === "moderate" || fredLabel === "elevated" || fredLabel === "high") {
      level = fredLabel;
      source_quality = "real";
      if (Number.isFinite(fred.value.cpi_yoy as number)) {
        drivers.push(`CPI YoY ${(fred.value.cpi_yoy as number).toFixed(2)}% (FRED CPIAUCSL)`);
      }
      if (Number.isFinite(fred.value.fed_funds_rate as number)) {
        drivers.push(`Fed Funds ${(fred.value.fed_funds_rate as number).toFixed(2)}% (FRED DFF)`);
      }
      if (Number.isFinite(fred.value.treasury_10y as number)) {
        drivers.push(`10Y ${(fred.value.treasury_10y as number).toFixed(2)}% (FRED DGS10)`);
      }
      if (Number.isFinite(fred.value.yield_curve_spread as number)) {
        const spread = fred.value.yield_curve_spread as number;
        drivers.push(`10Y-2Y spread ${spread.toFixed(2)}${spread < 0 ? " (inverted)" : ""}`);
      }
      if (Number.isFinite(fred.value.vix as number)) {
        drivers.push(`VIX ${(fred.value.vix as number).toFixed(2)} (FRED VIXCLS)`);
      }
      if (Number.isFinite(fred.value.unemployment_rate as number)) {
        drivers.push(`Unemployment ${(fred.value.unemployment_rate as number).toFixed(1)}% (FRED UNRATE)`);
      }
    }
  }

  if (events.status === "ok" && events.high_impact_upcoming.length > 0) {
    drivers.push(`${events.high_impact_upcoming.length} high/critical event(s) upcoming (${events.provider})`);
    if (level === "low") level = "moderate";
    else if (level === "moderate") level = "elevated";
    else if (level === "elevated") level = "high";
    if (source_quality === "real") source_quality = "real";
    else source_quality = "partial";
  }

  if (level === null) {
    drivers.push("No real macro source connected — risk level unknown.");
    source_quality = "not_connected";
  }

  return { level, drivers, source_quality };
}

// ── Route ────────────────────────────────────────────────────────────────────

router.get("/macro-risk", async (_req: Request, res: Response): Promise<void> => {
  try {
    const out = await buildMacroRiskAggregate();
    res.json(out);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "[macro-risk] aggregator threw");
    const fallback: MacroRiskResponse = {
      status: "not_connected",
      generated_at: new Date().toISOString(),
      macro_risk: {
        level: null,
        drivers: [`Aggregator error: ${msg}`],
        source_quality: "not_connected",
      },
      fred: { status: "not_connected", value: null, reason: `aggregator_error: ${msg}` },
      events: {
        status: "not_connected",
        provider: "none",
        count_24h: 0,
        count_upcoming: 0,
        high_impact_upcoming: [],
        next_event: null,
        last_updated: null,
        reason: `aggregator_error: ${msg}`,
      },
      news_window: {
        active: false,
        reason: null,
        affected_symbols: [],
        window_before_ms: NEWS_WINDOW_BEFORE_MS,
        window_after_ms: NEWS_WINDOW_AFTER_MS,
      },
      news_feed: {
        status: "not_connected",
        feed_connected: false,
        latest_headlines: [],
        count: 0,
        provider: "alpaca_news",
        last_updated: null,
        reason: `aggregator_error: ${msg}`,
      },
      last_updated: null,
    };
    res.json(fallback);
  }
});

export default router;
