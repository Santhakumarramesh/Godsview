/**
 * finnhub_alt.ts — Finnhub Alternative Data Provider (TypeScript)
 *
 * Fetches alternative/sentiment data from Finnhub:
 *   - Company news (recent articles)
 *   - Analyst recommendations (consensus ratings)
 *   - Insider transactions (SEC Form 4)
 *   - Social sentiment (Reddit + Twitter)
 *
 * Complements the bar-data fallback in tiingo_client.ts.
 * Mirrors the Python finnhub_client.py for the Node.js API server.
 *
 * Rate limit: Free tier = 60 calls/min. 30-min cache mitigates this.
 */

import { logger } from "../logger.js";

// ── Config ──────────────────────────────────────────────────────────────────

const FINNHUB_BASE = "https://finnhub.io/api/v1";
const FINNHUB_KEY = () => process.env.FINNHUB_API_KEY ?? "";

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const FETCH_TIMEOUT_MS = 8_000;

// ── Types ───────────────────────────────────────────────────────────────────
export interface FinnhubNewsItem {
  category: string;
  datetime: number;    // Unix timestamp
  headline: string;
  id: number;
  source: string;
  summary: string;
  url: string;
  related: string;     // Ticker symbols
}

export interface AnalystRecommendation {
  period: string;      // "YYYY-MM-DD"
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface InsiderTransaction {
  name: string;
  share: number;       // shares traded
  change: number;      // net change
  transactionDate: string;
  transactionCode: string; // P=purchase, S=sale
  filingDate: string;
}
export interface SocialSentiment {
  reddit: { mention: number; positiveScore: number; negativeScore: number; score: number };
  twitter: { mention: number; positiveScore: number; negativeScore: number; score: number };
}

export interface AltDataSnapshot {
  symbol: string;
  news: { count: number; articles: FinnhubNewsItem[] };
  analyst: AnalystRecommendation | null;
  insiderNetShares: number;
  socialSentiment: SocialSentiment | null;
  compositeScore: number;   // -1 to +1
  confidence: number;       // 0 to 1
  fetchedAt: string;
  source: string;
}

// ── Cache ───────────────────────────────────────────────────────────────────

const cache = new Map<string, { data: AltDataSnapshot; expiresAt: number }>();

function getCached(symbol: string): AltDataSnapshot | null {
  const entry = cache.get(symbol);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(symbol);
    return null;
  }
  return entry.data;
}
function setCache(symbol: string, data: AltDataSnapshot): void {
  if (cache.size >= 50) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(symbol, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function finnhubGet<T>(path: string): Promise<T | null> {
  const key = FINNHUB_KEY();
  if (!key) return null;

  const url = `${FINNHUB_BASE}${path}${path.includes("?") ? "&" : "?"}token=${key}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      if (res.status === 429) logger.warn("[finnhub-alt] Rate limited");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.debug({ err, path }, "[finnhub-alt] Fetch failed");
    return null;
  }
}
function dateStr(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// ── Individual Fetchers ─────────────────────────────────────────────────────

async function fetchNews(symbol: string): Promise<FinnhubNewsItem[]> {
  const from = dateStr(7);
  const to = dateStr(0);
  const data = await finnhubGet<FinnhubNewsItem[]>(
    `/company-news?symbol=${symbol}&from=${from}&to=${to}`
  );
  return (data ?? []).slice(0, 50);
}

async function fetchRecommendations(symbol: string): Promise<AnalystRecommendation | null> {
  const data = await finnhubGet<AnalystRecommendation[]>(
    `/stock/recommendation?symbol=${symbol}`
  );
  if (!data || data.length === 0) return null;
  return data[0]; // Most recent
}

async function fetchInsiderTransactions(symbol: string): Promise<InsiderTransaction[]> {
  const data = await finnhubGet<{ data?: InsiderTransaction[] }>(
    `/stock/insider-transactions?symbol=${symbol}`
  );
  return (data?.data ?? []).slice(0, 50);
}
async function fetchSocialSentiment(symbol: string): Promise<SocialSentiment | null> {
  const data = await finnhubGet<{ reddit?: SocialSentiment["reddit"][]; twitter?: SocialSentiment["twitter"][] }>(
    `/stock/social-sentiment?symbol=${symbol}`
  );
  if (!data) return null;

  // Aggregate recent entries
  const redditArr = data.reddit ?? [];
  const twitterArr = data.twitter ?? [];

  const aggregate = (arr: Array<{ mention: number; positiveScore: number; negativeScore: number; score: number }>) => {
    if (arr.length === 0) return { mention: 0, positiveScore: 0, negativeScore: 0, score: 0 };
    const total = arr.reduce(
      (acc, x) => ({
        mention: acc.mention + x.mention,
        positiveScore: acc.positiveScore + x.positiveScore,
        negativeScore: acc.negativeScore + x.negativeScore,
        score: acc.score + x.score,
      }),
      { mention: 0, positiveScore: 0, negativeScore: 0, score: 0 },
    );
    return {
      mention: total.mention,
      positiveScore: total.positiveScore / arr.length,
      negativeScore: total.negativeScore / arr.length,
      score: total.score / arr.length,
    };
  };

  return {
    reddit: aggregate(redditArr),
    twitter: aggregate(twitterArr),
  };
}
// ── Composite Scoring ───────────────────────────────────────────────────────

function computeCompositeScore(
  analyst: AnalystRecommendation | null,
  insiderTxns: InsiderTransaction[],
  social: SocialSentiment | null,
  newsCount: number,
): { score: number; confidence: number } {
  let totalWeight = 0;
  let weightedScore = 0;

  // Analyst consensus (30% weight)
  if (analyst) {
    const total = analyst.strongBuy + analyst.buy + analyst.hold + analyst.sell + analyst.strongSell;
    if (total > 0) {
      const analystScore =
        (analyst.strongBuy * 1 + analyst.buy * 0.5 + analyst.hold * 0 + analyst.sell * -0.5 + analyst.strongSell * -1) / total;
      weightedScore += analystScore * 0.3;
      totalWeight += 0.3;
    }
  }

  // Insider activity (40% weight)
  if (insiderTxns.length > 0) {
    const netShares = insiderTxns.reduce((sum, tx) => sum + tx.change, 0);
    // Positive = net buying = bullish
    const insiderScore = Math.max(-1, Math.min(1, netShares / 100_000));
    weightedScore += insiderScore * 0.4;
    totalWeight += 0.4;
  }
  // Social sentiment (20% weight)
  if (social) {
    const combinedScore = (social.reddit.score * 0.4 + social.twitter.score * 0.6);
    const socialScore = Math.max(-1, Math.min(1, combinedScore));
    weightedScore += socialScore * 0.2;
    totalWeight += 0.2;
  }

  // News volume (10% weight — high volume = more attention, slight positive bias)
  if (newsCount > 0) {
    const newsScore = Math.min(1, newsCount / 20) * 0.3; // slight bullish bias for attention
    weightedScore += newsScore * 0.1;
    totalWeight += 0.1;
  }

  const score = totalWeight > 0 ? Math.max(-1, Math.min(1, weightedScore / totalWeight)) : 0;
  const confidence = Math.min(1, totalWeight / 0.7); // 70%+ of weights present = full confidence

  return { score: Math.round(score * 100) / 100, confidence: Math.round(confidence * 100) / 100 };
}

// ── Main Export ─────────────────────────────────────────────────────────────

/**
 * Fetch a complete alternative data snapshot for a symbol.
 * Results cached for 30 minutes.
 */
export async function fetchAltDataSnapshot(symbol: string): Promise<AltDataSnapshot> {
  const cached = getCached(symbol);
  if (cached) return cached;
  const key = FINNHUB_KEY();
  if (!key) {
    return {
      symbol,
      news: { count: 0, articles: [] },
      analyst: null,
      insiderNetShares: 0,
      socialSentiment: null,
      compositeScore: 0,
      confidence: 0,
      fetchedAt: new Date().toISOString(),
      source: "unavailable — FINNHUB_API_KEY not set",
    };
  }

  logger.info({ symbol }, "[finnhub-alt] Fetching alt data snapshot");

  // Fetch all in parallel
  const [news, analyst, insiderTxns, social] = await Promise.all([
    fetchNews(symbol),
    fetchRecommendations(symbol),
    fetchInsiderTransactions(symbol),
    fetchSocialSentiment(symbol),
  ]);

  const insiderNetShares = insiderTxns.reduce((sum, tx) => sum + tx.change, 0);
  const { score, confidence } = computeCompositeScore(analyst, insiderTxns, social, news.length);
  const snapshot: AltDataSnapshot = {
    symbol,
    news: { count: news.length, articles: news.slice(0, 10) }, // Return top 10 in response
    analyst,
    insiderNetShares,
    socialSentiment: social,
    compositeScore: score,
    confidence,
    fetchedAt: new Date().toISOString(),
    source: `Finnhub (news=${news.length}, analyst=${analyst ? "yes" : "no"}, insider=${insiderTxns.length}, social=${social ? "yes" : "no"})`,
  };

  setCache(symbol, snapshot);
  logger.info({ symbol, score, confidence }, "[finnhub-alt] Snapshot complete");
  return snapshot;
}

/**
 * Clear cached alt data (for testing/forced refresh).
 */
export function clearAltDataCache(): void {
  cache.clear();
}
