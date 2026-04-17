/**
 * fred_client.ts — Federal Reserve Economic Data (FRED) API Client
 *
 * Fetches real macro-economic indicators from the St. Louis Fed:
 *   - CPI (Consumer Price Index) — inflation tracking
 *   - Federal Funds Rate — interest rate environment
 *   - Unemployment Rate — labor market health
 *   - 10Y Treasury Yield — bond market signal
 *   - GDP Growth — economic growth indicator
 *
 * Data is cached in-memory with configurable TTL (default 6h)
 * since FRED data updates monthly/quarterly, not in real-time.
 *
 * API Docs: https://fred.stlouisfed.org/docs/api/fred/
 */

import { logger } from "../logger.js";

// ── FRED Series IDs ─────────────────────────────────────────────────────────

/** Key FRED series for trading macro signals */
export const FRED_SERIES = {
  /** CPI for All Urban Consumers (seasonally adjusted, monthly) */
  CPI: "CPIAUCSL",
  /** Federal Funds Effective Rate (daily) */
  FED_FUNDS_RATE: "DFF",
  /** Civilian Unemployment Rate (monthly) */
  UNEMPLOYMENT: "UNRATE",  /** 10-Year Treasury Constant Maturity Rate (daily) */
  TREASURY_10Y: "DGS10",
  /** 2-Year Treasury (for yield curve) */
  TREASURY_2Y: "DGS2",
  /** Real GDP Growth (quarterly) */
  GDP_GROWTH: "A191RL1Q225SBEA",
  /** Initial Jobless Claims (weekly) */
  INITIAL_CLAIMS: "ICSA",
  /** VIX Index (daily, CBOE) */
  VIX: "VIXCLS",
} as const;

// ── Types ───────────────────────────────────────────────────────────────────

export interface FredObservation {
  date: string;       // "YYYY-MM-DD"
  value: number;
  realtime_start: string;
  realtime_end: string;
}

export interface FredSeriesResult {
  series_id: string;
  observations: FredObservation[];
  fetched_at: string;
  source: string;
}
export interface FredMacroSnapshot {
  /** Latest CPI year-over-year % change (inflation rate) */
  cpi_yoy: number | null;
  /** CPI month-over-month % change (inflation momentum) */
  cpi_mom: number | null;
  /** Federal Funds effective rate */
  fed_funds_rate: number | null;
  /** Unemployment rate */
  unemployment_rate: number | null;
  /** 10Y Treasury yield */
  treasury_10y: number | null;
  /** 2Y Treasury yield */
  treasury_2y: number | null;
  /** Yield curve spread (10Y - 2Y, negative = inverted) */
  yield_curve_spread: number | null;
  /** Latest GDP growth rate */
  gdp_growth: number | null;
  /** Initial jobless claims (thousands) */
  initial_claims: number | null;
  /** VIX from FRED (backup source) */
  vix: number | null;
  /** Overall risk assessment from FRED data */
  macro_risk: "low" | "moderate" | "elevated" | "high";
  /** Data freshness */
  fetched_at: string;
  /** Data quality — how many series were successfully fetched */
  quality: "full" | "partial" | "stale" | "unavailable";
  sources: Record<string, string>;
}
// ── Cache ───────────────────────────────────────────────────────────────────

const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours (FRED data is daily/monthly)
const MAX_CACHE_ENTRIES = 20;

interface CacheEntry {
  data: FredSeriesResult;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function getCached(seriesId: string): FredSeriesResult | null {
  const entry = cache.get(seriesId);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(seriesId);
    return null;
  }
  return entry.data;
}

function setCache(seriesId: string, data: FredSeriesResult, ttlMs = DEFAULT_CACHE_TTL_MS): void {
  // Enforce max entries
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(seriesId, { data, expiresAt: Date.now() + ttlMs });
}
// ── Core Fetch ──────────────────────────────────────────────────────────────

const FRED_BASE = "https://api.stlouisfed.org/fred";

/**
 * Fetch recent observations for a FRED series.
 * Returns the last `limit` observations sorted by date ascending.
 */
export async function fetchFredSeries(
  seriesId: string,
  options?: { limit?: number; cacheTtlMs?: number },
): Promise<FredSeriesResult> {
  const apiKey = process.env.FRED_API_KEY;
  if (!apiKey) {
    return {
      series_id: seriesId,
      observations: [],
      fetched_at: new Date().toISOString(),
      source: "unavailable — FRED_API_KEY not set",
    };
  }

  // Check cache
  const cached = getCached(seriesId);
  if (cached) return cached;

  const limit = options?.limit ?? 24; // ~2 years of monthly data
  const url = new URL(`${FRED_BASE}/series/observations`);
  url.searchParams.set("series_id", seriesId);
  url.searchParams.set("api_key", apiKey);  url.searchParams.set("file_type", "json");
  url.searchParams.set("sort_order", "desc");
  url.searchParams.set("limit", String(limit));

  try {
    const res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      logger.warn({ seriesId, status: res.status }, "[FRED] API request failed");
      return {
        series_id: seriesId,
        observations: [],
        fetched_at: new Date().toISOString(),
        source: `error: HTTP ${res.status}`,
      };
    }

    const body = await res.json() as {
      observations?: Array<{ date: string; value: string; realtime_start: string; realtime_end: string }>;
    };

    const observations: FredObservation[] = (body.observations ?? [])
      .filter((o) => o.value !== ".")  // FRED uses "." for missing values
      .map((o) => ({
        date: o.date,
        value: parseFloat(o.value),
        realtime_start: o.realtime_start,        realtime_end: o.realtime_end,
      }))
      .reverse(); // ascending by date

    const result: FredSeriesResult = {
      series_id: seriesId,
      observations,
      fetched_at: new Date().toISOString(),
      source: `FRED API (${seriesId}, ${observations.length} obs)`,
    };

    setCache(seriesId, result, options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    logger.debug({ seriesId, count: observations.length }, "[FRED] Series fetched");
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ seriesId, err: msg }, "[FRED] Fetch failed");
    return {
      series_id: seriesId,
      observations: [],
      fetched_at: new Date().toISOString(),
      source: `error: ${msg}`,
    };
  }
}

// ── Derived Metrics ─────────────────────────────────────────────────────────

/** Get the latest value from a series, or null */function latest(result: FredSeriesResult): number | null {
  const obs = result.observations;
  if (obs.length === 0) return null;
  return obs[obs.length - 1].value;
}

/** Compute YoY % change from monthly series (current vs 12 months ago) */
function yoyChange(result: FredSeriesResult): number | null {
  const obs = result.observations;
  if (obs.length < 13) return null;
  const current = obs[obs.length - 1].value;
  const yearAgo = obs[obs.length - 13].value;
  if (yearAgo === 0) return null;
  return ((current - yearAgo) / yearAgo) * 100;
}

/** Compute month-over-month % change */
function momChange(result: FredSeriesResult): number | null {
  const obs = result.observations;
  if (obs.length < 2) return null;
  const current = obs[obs.length - 1].value;
  const prev = obs[obs.length - 2].value;
  if (prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

// ── Full Macro Snapshot ─────────────────────────────────────────────────────
/**
 * Fetch all key FRED indicators and compute a macro snapshot.
 * Results are cached for 6 hours since most data is daily/monthly.
 */
export async function fetchFredMacroSnapshot(): Promise<FredMacroSnapshot> {
  const sources: Record<string, string> = {};
  let successCount = 0;
  const totalSeries = 8;

  // Fetch all series in parallel
  const [cpiResult, fedFundsResult, unemploymentResult, t10yResult, t2yResult, gdpResult, claimsResult, vixResult] =
    await Promise.all([
      fetchFredSeries(FRED_SERIES.CPI, { limit: 24 }),        // 2 years of monthly CPI
      fetchFredSeries(FRED_SERIES.FED_FUNDS_RATE, { limit: 5 }), // last 5 daily readings
      fetchFredSeries(FRED_SERIES.UNEMPLOYMENT, { limit: 6 }),    // last 6 months
      fetchFredSeries(FRED_SERIES.TREASURY_10Y, { limit: 5 }),
      fetchFredSeries(FRED_SERIES.TREASURY_2Y, { limit: 5 }),
      fetchFredSeries(FRED_SERIES.GDP_GROWTH, { limit: 4 }),      // last 4 quarters
      fetchFredSeries(FRED_SERIES.INITIAL_CLAIMS, { limit: 4 }),  // last 4 weeks
      fetchFredSeries(FRED_SERIES.VIX, { limit: 5 }),
    ]);

  // CPI
  const cpi_yoy = yoyChange(cpiResult);
  const cpi_mom = momChange(cpiResult);
  sources.cpi = cpiResult.source;
  if (cpi_yoy !== null) successCount++;
  // Fed Funds Rate
  const fed_funds_rate = latest(fedFundsResult);
  sources.fed_funds = fedFundsResult.source;
  if (fed_funds_rate !== null) successCount++;

  // Unemployment
  const unemployment_rate = latest(unemploymentResult);
  sources.unemployment = unemploymentResult.source;
  if (unemployment_rate !== null) successCount++;

  // Treasuries + yield curve
  const treasury_10y = latest(t10yResult);
  const treasury_2y = latest(t2yResult);
  sources.treasury_10y = t10yResult.source;
  sources.treasury_2y = t2yResult.source;
  if (treasury_10y !== null) successCount++;
  if (treasury_2y !== null) successCount++;

  const yield_curve_spread =
    treasury_10y !== null && treasury_2y !== null
      ? Math.round((treasury_10y - treasury_2y) * 100) / 100
      : null;

  // GDP
  const gdp_growth = latest(gdpResult);
  sources.gdp = gdpResult.source;
  if (gdp_growth !== null) successCount++;

  // Claims  const initial_claims = latest(claimsResult);
  sources.claims = claimsResult.source;
  if (initial_claims !== null) successCount++;

  // VIX
  const vix = latest(vixResult);
  sources.vix_fred = vixResult.source;
  if (vix !== null) successCount++;

  // Compute macro risk from indicators
  const macro_risk = computeMacroRisk({
    cpi_yoy, fed_funds_rate, unemployment_rate, yield_curve_spread, vix, gdp_growth,
  });

  // Quality assessment
  const quality: FredMacroSnapshot["quality"] =
    successCount >= 6 ? "full"
    : successCount >= 3 ? "partial"
    : successCount >= 1 ? "stale"
    : "unavailable";

  logger.info({ successCount, totalSeries, quality, macro_risk }, "[FRED] Macro snapshot generated");

  return {
    cpi_yoy,
    cpi_mom,
    fed_funds_rate,
    unemployment_rate,
    treasury_10y,
    treasury_2y,    yield_curve_spread,
    gdp_growth,
    initial_claims,
    vix,
    macro_risk,
    fetched_at: new Date().toISOString(),
    quality,
    sources,
  };
}

// ── Risk Scoring ────────────────────────────────────────────────────────────

function computeMacroRisk(data: {
  cpi_yoy: number | null;
  fed_funds_rate: number | null;
  unemployment_rate: number | null;
  yield_curve_spread: number | null;
  vix: number | null;
  gdp_growth: number | null;
}): FredMacroSnapshot["macro_risk"] {
  let riskPoints = 0;

  // High inflation = risk
  if (data.cpi_yoy !== null && data.cpi_yoy > 5) riskPoints += 2;
  else if (data.cpi_yoy !== null && data.cpi_yoy > 3) riskPoints += 1;

  // High rates = tighter conditions
  if (data.fed_funds_rate !== null && data.fed_funds_rate > 5) riskPoints += 2;
  else if (data.fed_funds_rate !== null && data.fed_funds_rate > 3) riskPoints += 1;
  // Rising unemployment = recession risk
  if (data.unemployment_rate !== null && data.unemployment_rate > 6) riskPoints += 2;
  else if (data.unemployment_rate !== null && data.unemployment_rate > 4.5) riskPoints += 1;

  // Inverted yield curve = strong recession signal
  if (data.yield_curve_spread !== null && data.yield_curve_spread < -0.5) riskPoints += 3;
  else if (data.yield_curve_spread !== null && data.yield_curve_spread < 0) riskPoints += 1;

  // High VIX = fear
  if (data.vix !== null && data.vix > 30) riskPoints += 2;
  else if (data.vix !== null && data.vix > 20) riskPoints += 1;

  // Negative GDP = contraction
  if (data.gdp_growth !== null && data.gdp_growth < 0) riskPoints += 2;
  else if (data.gdp_growth !== null && data.gdp_growth < 1) riskPoints += 1;

  if (riskPoints >= 7) return "high";
  if (riskPoints >= 4) return "elevated";
  if (riskPoints >= 2) return "moderate";
  return "low";
}

// ── Convenience: CPI momentum for macro_feed.ts ─────────────────────────────

/**
 * Get CPI momentum value suitable for the MacroBiasInput.cpiMomentum field.
 * Returns a normalized value between -1 and 1:
 *   - Positive = inflation accelerating (bearish for risk assets)
 *   - Negative = inflation decelerating (bullish for risk assets) *   - 0 = stable or unavailable
 */
export async function getCpiMomentum(): Promise<{ value: number; source: string }> {
  const result = await fetchFredSeries(FRED_SERIES.CPI, { limit: 14 });
  const mom = momChange(result);
  if (mom === null) return { value: 0, source: "FRED CPI unavailable" };

  // Normalize: typical MoM CPI is 0.1-0.4%, so we scale to [-1, 1]
  // > 0.4% MoM = strongly accelerating = +1
  // < -0.1% MoM = decelerating = -1
  const normalized = Math.max(-1, Math.min(1, (mom - 0.15) / 0.25));
  return {
    value: Math.round(normalized * 100) / 100,
    source: `FRED CPI MoM: ${mom.toFixed(3)}%`,
  };
}

/**
 * Get Fed Funds rate for rate differential calculation.
 * Returns basis points (bps).
 */
export async function getFedFundsRateBps(): Promise<{ bps: number; source: string }> {
  const result = await fetchFredSeries(FRED_SERIES.FED_FUNDS_RATE, { limit: 3 });
  const rate = latest(result);
  if (rate === null) return { bps: 0, source: "FRED Fed Funds unavailable" };
  return {
    bps: Math.round(rate * 100), // 5.33% → 533 bps
    source: `FRED Fed Funds: ${rate.toFixed(2)}%`,
  };
}

/**
 * Clear all cached data (useful for testing or forced refresh).
 */
export function clearFredCache(): void {
  cache.clear();
}