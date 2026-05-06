/**
 * fred_calendar_client.ts — M5d-economic-calendar Read-only economic calendar
 *
 * Single source: FRED Releases API (https://api.stlouisfed.org/fred/releases/dates).
 * Reuses the existing FRED_API_KEY that providers/fred_client.ts already
 * authenticates with — no new env var needed.
 *
 * Hard rules:
 *  - GET only. No state writes.
 *  - No fabricated events. When the upstream fails, returns CalendarResult
 *    with status="not_connected" and an explicit reason string.
 *  - Event timestamps combine FRED's `date` (YYYY-MM-DD) with a hardcoded
 *    approximate release time-of-day (FRED itself does NOT publish the
 *    exact time-of-release in this endpoint). Times are documented in
 *    RELEASE_ALLOWLIST below — NOT GUESSED. They reflect the standard
 *    BLS / BEA / Federal Reserve publication schedule.
 *  - 6-hour in-memory cache. force=true bypasses.
 *
 * What this client does NOT do:
 *  - Fetch global / non-US economic events.
 *  - Compute sentiment.
 *  - Activate any kind of trade lockout. The aggregator in routes/macro_risk.ts
 *    decides news_window activation; this client only surfaces real events.
 */

import { logger } from "../logger";

const FRED_BASE = "https://api.stlouisfed.org/fred";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FUTURE_HORIZON_DAYS = 30;
const RECENT_BACKFILL_DAYS = 2; // include events from the last 2 days for "just published" visibility

// ── Allow-list of impactful US releases ─────────────────────────────────────
// Release IDs are stable in FRED's catalog. Times are the standard schedule
// for the publishing agency (BLS at 08:30 ET, FOMC at 14:00 ET, etc.). They
// are documented here, not invented at runtime.

export interface ReleaseProfile {
  releaseId: number;
  shortName: string;            // canonical short name we surface as event.title
  impact: "low" | "medium" | "high" | "critical";
  /** UTC hour of typical release. ET 08:30 = 13:30 UTC during EDT. We use
   *  EDT-summer (UTC-4) as the baseline; in winter the actual UTC offset
   *  shifts by 1h. This is approximate by design. */
  utcHour: number;
  utcMinute: number;
  /** Symbols whose price action is historically sensitive to this release. */
  relatedSymbols: string[];
}

export const RELEASE_ALLOWLIST: ReadonlyArray<ReleaseProfile> = [
  { releaseId: 10, shortName: "CPI",                       impact: "critical", utcHour: 12, utcMinute: 30, relatedSymbols: ["SPY","QQQ","DIA","BTCUSD","ETHUSD","GLD","TLT"] },
  { releaseId: 50, shortName: "Employment Situation (NFP)",impact: "critical", utcHour: 12, utcMinute: 30, relatedSymbols: ["SPY","QQQ","DIA","IWM","TLT"] },
  { releaseId: 53, shortName: "GDP",                       impact: "high",     utcHour: 12, utcMinute: 30, relatedSymbols: ["SPY","QQQ","DIA"] },
  { releaseId: 21, shortName: "Personal Income & Outlays (PCE)", impact: "high", utcHour: 12, utcMinute: 30, relatedSymbols: ["SPY","QQQ"] },
  { releaseId: 82, shortName: "PPI",                       impact: "high",     utcHour: 12, utcMinute: 30, relatedSymbols: ["SPY","QQQ"] },
  { releaseId: 91, shortName: "Retail Sales",              impact: "high",     utcHour: 12, utcMinute: 30, relatedSymbols: ["SPY","XRT","AMZN"] },
  { releaseId: 17, shortName: "Industrial Production",     impact: "medium",   utcHour: 13, utcMinute: 15, relatedSymbols: ["SPY","XLI"] },
  { releaseId: 14, shortName: "New Residential Construction", impact: "medium", utcHour: 12, utcMinute: 30, relatedSymbols: ["XHB","ITB"] },
];

const ALLOWED_IDS = new Set(RELEASE_ALLOWLIST.map((p) => p.releaseId));
const PROFILE_BY_ID = new Map<number, ReleaseProfile>(RELEASE_ALLOWLIST.map((p) => [p.releaseId, p]));

// ── Types ───────────────────────────────────────────────────────────────────

export interface EconomicEvent {
  /** Stable id of the form "fred-release-{release_id}-{date}". */
  id: string;
  /** Always "economic_calendar" so callers can union with macro_engine MacroEvent. */
  type: "economic_calendar";
  /** Release ID from FRED's catalog (e.g. 10 for CPI). */
  release_id: number;
  /** Human-readable title (canonical short name from RELEASE_ALLOWLIST). */
  title: string;
  /** Approximate ISO timestamp when the release is published (release_date + utc time-of-day). */
  timestamp: string;
  /** YYYY-MM-DD release date as published by FRED. */
  release_date: string;
  impact: "low" | "medium" | "high" | "critical";
  /** Symbols whose price action is historically sensitive to this release. */
  related_symbols: string[];
  source: "fred_releases";
  /** Always 0 — neutral. We do NOT fabricate sentiment. */
  sentiment: 0;
}

export interface CalendarResult {
  status: "ok" | "not_connected";
  events: EconomicEvent[];
  /** Provider-reported source name. */
  provider: "fred_releases";
  /** ISO timestamp of the most recent successful upstream fetch. */
  last_updated: string | null;
  /** Reason when status=not_connected. Empty string otherwise. */
  reason: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry { result: CalendarResult; fetchedAt: number; }
let cache: CacheEntry | null = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch upcoming + recently-published economic events from FRED.
 * Read-only. Cached 6 hours. Returns honest not_connected on every failure path.
 *
 * @param opts.now      Override "now" for tests (millisecond timestamp).
 * @param opts.force    Bypass cache.
 * @param opts.horizonDays   Days into the future to fetch. Default 30.
 * @param opts.backfillDays  Days into the past to fetch. Default 2.
 */
export async function fetchUpcomingEconomicEvents(opts?: {
  now?: number;
  force?: boolean;
  horizonDays?: number;
  backfillDays?: number;
}): Promise<CalendarResult> {
  const force = opts?.force ?? false;
  const nowMs = opts?.now ?? Date.now();
  const horizonDays = opts?.horizonDays ?? FUTURE_HORIZON_DAYS;
  const backfillDays = opts?.backfillDays ?? RECENT_BACKFILL_DAYS;

  if (!force && cache && nowMs - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  const apiKey = (process.env.FRED_API_KEY ?? "").trim();
  if (!apiKey) {
    return {
      status: "not_connected",
      events: [],
      provider: "fred_releases",
      last_updated: null,
      reason: "FRED_API_KEY not set in environment.",
    };
  }

  const startDate = isoDate(nowMs - backfillDays * 24 * 3600 * 1000);
  const endDate = isoDate(nowMs + horizonDays * 24 * 3600 * 1000);

  const params = new URLSearchParams();
  params.set("api_key", apiKey);
  params.set("file_type", "json");
  params.set("realtime_start", startDate);
  params.set("realtime_end", endDate);
  params.set("include_release_dates_with_no_data", "true");
  params.set("sort_order", "asc");
  params.set("limit", "1000");

  const url = `${FRED_BASE}/releases/dates?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const bodyPreview = await res.text().then((t) => t.slice(0, 200)).catch(() => "");
      const reason = `FRED Releases API HTTP ${res.status}. ${bodyPreview}`;
      logger.warn({ url: redactKey(url), status: res.status }, "[fred-calendar] fetch failed");
      const result: CalendarResult = {
        status: "not_connected",
        events: [],
        provider: "fred_releases",
        last_updated: null,
        reason,
      };
      cache = { result, fetchedAt: nowMs };
      return result;
    }

    const json = (await res.json()) as { release_dates?: unknown[] };
    const raw = Array.isArray(json.release_dates) ? json.release_dates : [];

    const events: EconomicEvent[] = [];
    const seen = new Set<string>();
    for (const r of raw) {
      const row = r as Record<string, unknown>;
      const releaseId = Number(row.release_id);
      if (!Number.isFinite(releaseId) || !ALLOWED_IDS.has(releaseId)) continue;
      const date = String(row.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const id = `fred-release-${releaseId}-${date}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const profile = PROFILE_BY_ID.get(releaseId)!;
      const ts = combineDateAndUtcTime(date, profile.utcHour, profile.utcMinute);
      events.push({
        id,
        type: "economic_calendar",
        release_id: releaseId,
        title: profile.shortName,
        timestamp: ts,
        release_date: date,
        impact: profile.impact,
        related_symbols: [...profile.relatedSymbols],
        source: "fred_releases",
        sentiment: 0,
      });
    }

    // Already sorted asc by FRED, but enforce defensively.
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const result: CalendarResult = {
      status: "ok",
      events,
      provider: "fred_releases",
      last_updated: new Date(nowMs).toISOString(),
      reason: "",
    };
    cache = { result, fetchedAt: nowMs };
    return result;
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout after ${FETCH_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    logger.warn({ err: msg }, "[fred-calendar] fetch threw");
    return {
      status: "not_connected",
      events: [],
      provider: "fred_releases",
      last_updated: null,
      reason: `FRED Releases fetch error: ${msg}`,
    };
  }
}

/** Test helper: flush the in-memory cache. */
export function clearCalendarCache(): void {
  cache = null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function isoDate(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function combineDateAndUtcTime(yyyymmdd: string, hour: number, minute: number): string {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m! - 1), d!, hour, minute, 0, 0));
  return dt.toISOString();
}

function redactKey(u: string): string {
  return u.replace(/api_key=[^&]+/, "api_key=***");
}
