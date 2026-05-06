/**
 * news_feed_service.ts — M5d-news Read-only news feed adapter
 *
 * Single source: Alpaca News API (https://data.alpaca.markets/v1beta1/news).
 * Reuses the existing ALPACA_API_KEY / ALPACA_SECRET_KEY that the broker
 * already authenticates with — no new env var needed.
 *
 * Hard rules:
 *  - GET only. No state writes.
 *  - No fake articles, no fake sentiment.
 *  - When API key missing or upstream non-2xx: returns NewsFeedResult with
 *    status="not_connected" and an explicit reason. NEVER falls back to a
 *    hardcoded headline list.
 *  - 5-minute in-memory cache. Bypasses cache on force=true.
 *
 * Sentiment is NOT computed here. The strategy/risk pipeline does not consume
 * news sentiment yet, and fabricating it would violate the no-fake rule.
 */
import { logger } from "./logger";

const ALPACA_NEWS_BASE = "https://data.alpaca.markets/v1beta1/news";
const FETCH_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = 10;

// ── Types (exported so the aggregator can re-use the shape) ─────────────────

export interface NewsHeadline {
  id: string;
  headline: string;
  summary: string | null;
  author: string | null;
  source: string;
  url: string | null;
  symbols: string[];
  published_at: string; // ISO 8601
  /** Provider-reported source name. Always REAL. Never fabricated. */
  provider: "alpaca_news";
}

export interface NewsFeedResult {
  status: "ok" | "not_connected";
  feed_connected: boolean;
  /** Latest articles (up to limit). Empty array when status=not_connected. */
  latest_headlines: NewsHeadline[];
  /** Total returned by the upstream provider for this fetch. */
  count: number;
  /** ISO timestamp of the last successful upstream fetch (cache-aware). */
  last_updated: string | null;
  /** Provider name for transparency. */
  provider: "alpaca_news";
  /** Human-readable reason when status=not_connected. Empty string otherwise. */
  reason: string;
}

// ── Internal cache ──────────────────────────────────────────────────────────

interface CacheEntry {
  result: NewsFeedResult;
  fetchedAt: number;
}
let cache: CacheEntry | null = null;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Fetch latest market news headlines from Alpaca. Read-only, cached 5 minutes.
 *
 * @param opts.limit  Max headlines to return (capped at 50). Default 10.
 * @param opts.symbols  Optional list of symbols to filter on. Default: all.
 * @param opts.force  Bypass cache.
 */
export async function fetchLatestHeadlines(opts?: {
  limit?: number;
  symbols?: string[];
  force?: boolean;
}): Promise<NewsFeedResult> {
  const force = opts?.force ?? false;
  const now = Date.now();

  if (!force && cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.result;
  }

  const apiKey = (process.env.ALPACA_API_KEY ?? "").trim();
  const apiSecret = (process.env.ALPACA_SECRET_KEY ?? "").trim();
  if (!apiKey || !apiSecret) {
    const result: NewsFeedResult = {
      status: "not_connected",
      feed_connected: false,
      latest_headlines: [],
      count: 0,
      last_updated: null,
      provider: "alpaca_news",
      reason: "ALPACA_API_KEY / ALPACA_SECRET_KEY not set in environment.",
    };
    return result;
  }

  const limit = clamp(opts?.limit ?? DEFAULT_LIMIT, 1, 50);
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  params.set("sort", "desc");
  if (opts?.symbols && opts.symbols.length > 0) {
    params.set("symbols", opts.symbols.join(","));
  }

  const url = `${ALPACA_NEWS_BASE}?${params.toString()}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "APCA-API-KEY-ID": apiKey,
        "APCA-API-SECRET-KEY": apiSecret,
        Accept: "application/json",
      },
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const bodyPreview = await res.text().then((t) => t.slice(0, 200)).catch(() => "");
      const reason =
        res.status === 401 || res.status === 403
          ? `Alpaca News API ${res.status} — current Alpaca account does not have news scope. ${bodyPreview}`
          : `Alpaca News API HTTP ${res.status}. ${bodyPreview}`;
      logger.warn({ url, status: res.status }, "[news-feed] Alpaca News fetch failed");
      const result: NewsFeedResult = {
        status: "not_connected",
        feed_connected: false,
        latest_headlines: [],
        count: 0,
        last_updated: null,
        provider: "alpaca_news",
        reason,
      };
      // Cache the not_connected result briefly so we don't retry every request
      cache = { result, fetchedAt: now };
      return result;
    }

    const json = (await res.json()) as { news?: unknown[] };
    const raw = Array.isArray(json.news) ? json.news : [];
    const headlines: NewsHeadline[] = [];
    for (const a of raw) {
      const article = a as Record<string, unknown>;
      const id = String(article.id ?? "");
      const headline = String(article.headline ?? "").trim();
      if (!id || !headline) continue;
      headlines.push({
        id,
        headline,
        summary: nullableString(article.summary),
        author: nullableString(article.author),
        source: String(article.source ?? "alpaca_news"),
        url: nullableString(article.url),
        symbols: Array.isArray(article.symbols)
          ? article.symbols.map((s) => String(s)).filter(Boolean)
          : [],
        published_at: String(article.created_at ?? article.updated_at ?? new Date().toISOString()),
        provider: "alpaca_news",
      });
    }

    const result: NewsFeedResult = {
      status: "ok",
      feed_connected: true,
      latest_headlines: headlines,
      count: headlines.length,
      last_updated: new Date().toISOString(),
      provider: "alpaca_news",
      reason: "",
    };
    cache = { result, fetchedAt: now };
    return result;
  } catch (err) {
    clearTimeout(timer);
    const msg =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout after ${FETCH_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    logger.warn({ err: msg }, "[news-feed] Alpaca News fetch threw");
    const result: NewsFeedResult = {
      status: "not_connected",
      feed_connected: false,
      latest_headlines: [],
      count: 0,
      last_updated: null,
      provider: "alpaca_news",
      reason: `Alpaca News fetch error: ${msg}`,
    };
    return result;
  }
}

/** Test helper: flush the in-memory cache. */
export function clearNewsFeedCache(): void {
  cache = null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}
function nullableString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length > 0 ? s : null;
}
