/**
 * macro_risk.ts — M5d-β Macro/News Risk Monitor (read-only)
 *
 * Mounts at /api/macro-risk (see routes/index.ts).
 *
 * Aggregates the GodsView macro layer into ONE honest endpoint with explicit
 * source-quality labels per section.
 *
 * Hard rules:
 *  - GET only. No state writes.
 *  - No fake events, no fake sentiment, no fake risk levels.
 *  - Every value carries its source. When a layer has no provider, returns
 *    `status: "not_connected"` with a human-readable reason.
 *
 * Sources:
 *  - FRED API (real) via providers/fred_client
 *  - macro_engine in-memory event store (currently empty in production)
 *  - macro_engine.checkNewsLockout / news_window state
 */

import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";
import { getMacroContext, type MacroEvent } from "../lib/macro_engine";
import { fetchFredMacroSnapshot, type FredMacroSnapshot } from "../lib/providers/fred_client.js";

const router = Router();

// ── Response types ───────────────────────────────────────────────────────────

export type SourceQuality = "real" | "partial" | "not_connected";

export interface FredSection {
  status: "ok" | "not_connected";
  value: FredMacroSnapshot | null;
  reason?: string;
}

export interface EventsSection {
  status: "ok" | "not_connected";
  count_24h: number;
  high_impact_upcoming: MacroEvent[];
  next_event: MacroEvent | null;
  reason?: string;
}

export interface NewsWindowSection {
  active: boolean;
  reason: string | null;
  affected_symbols: string[];
}

export interface NewsFeedSection {
  status: "ok" | "not_connected";
  feed_connected: boolean;
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
  let last_updated: string | null = null;

  // FRED layer
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

  // Events layer
  let eventsSection: EventsSection;
  try {
    const ctx = getMacroContext();
    const eventCount = (ctx.events ?? []).length;
    const highImpact = (ctx.high_impact_upcoming ?? []).slice(0, 3);
    const nextEvent: MacroEvent | null = highImpact.length > 0 ? highImpact[0]! : null;
    if (eventCount === 0) {
      eventsSection = {
        status: "not_connected",
        count_24h: 0,
        high_impact_upcoming: [],
        next_event: null,
        reason:
          "No event provider configured. macro_engine in-memory store is empty. " +
          "Ingest events via POST /api/macro/events or wire an economic-calendar provider.",
      };
    } else {
      eventsSection = {
        status: "ok",
        count_24h: ctx.news_count_24h ?? 0,
        high_impact_upcoming: highImpact,
        next_event: nextEvent,
      };
      if (ctx.generated_at) {
        last_updated = ctx.generated_at > (last_updated ?? "") ? ctx.generated_at : last_updated;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err: msg }, "[macro-risk] macro_engine context failed (non-fatal)");
    eventsSection = {
      status: "not_connected",
      count_24h: 0,
      high_impact_upcoming: [],
      next_event: null,
      reason: `macro_engine error: ${msg}`,
    };
  }

  // News-window state
  let newsWindow: NewsWindowSection;
  try {
    const ctx = getMacroContext();
    const affected = new Set<string>();
    for (const ev of ctx.high_impact_upcoming ?? []) {
      for (const sym of ev.related_symbols ?? []) affected.add(sym);
    }
    newsWindow = {
      active: !!ctx.lockout_active,
      reason: ctx.lockout_reason ?? null,
      affected_symbols: Array.from(affected),
    };
  } catch {
    newsWindow = { active: false, reason: null, affected_symbols: [] };
  }

  // News feed (no provider configured)
  const newsFeedSection: NewsFeedSection = {
    status: "not_connected",
    feed_connected: false,
    reason:
      "No news provider configured. Connect an RSS / Polygon / Alpaca News / " +
      "Finnhub feed to populate /api/news/* and feed real sentiment into macro_risk.",
  };

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
    drivers.push(`${events.high_impact_upcoming.length} high/critical event(s) upcoming (macro_engine)`);
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
        count_24h: 0,
        high_impact_upcoming: [],
        next_event: null,
        reason: `aggregator_error: ${msg}`,
      },
      news_window: { active: false, reason: null, affected_symbols: [] },
      news_feed: {
        status: "not_connected",
        feed_connected: false,
        reason: `aggregator_error: ${msg}`,
      },
      last_updated: null,
    };
    res.json(fallback);
  }
});

export default router;
