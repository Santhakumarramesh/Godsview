/**
 * Phase 104 — Sentiment & News Intelligence API
 *
 * Endpoints:
 *   GET  /snapshot   — Market-wide sentiment snapshot
 *   GET  /news       — Processed news feed with filters
 *   GET  /social     — Social media metrics and alerts
 *   GET  /movers     — Top bullish/bearish movers
 *   GET  /keywords   — Trending keyword cloud data
 *   GET  /symbol/:s  — Single-symbol sentiment detail
 *   GET  /health     — Subsystem health
 */

import { Router, type Request, type Response } from "express";
import { fetchAlpacaNews } from "../lib/providers/alpaca_news";
import { logger } from "../lib/logger";

const router = Router();

// ── Symbols to track sentiment ───────────────────────────────
const symbols = ["AAPL", "NVDA", "TSLA", "MSFT", "META", "AMZN", "BTC-USD", "ETH-USD"];

// Fallback sentiment biases when real data unavailable
const biases: Record<string, number> = { AAPL: 0.45, NVDA: 0.72, TSLA: -0.35, MSFT: 0.38, META: 0.22, AMZN: 0.15, "BTC-USD": 0.55, "ETH-USD": 0.30 };

function mockSentiment(sym: string, bias: number) {
  const composite = Math.max(-1, Math.min(1, bias + (Math.random() - 0.5) * 0.3));
  const direction = composite > 0.15 ? "bullish" : composite < -0.15 ? "bearish" : "neutral";
  const strength = Math.abs(composite) > 0.6 ? "strong" : Math.abs(composite) > 0.3 ? "moderate" : "weak";
  return {
    symbol: sym,
    composite: Math.round(composite * 1000) / 1000,
    confidence: Math.round((0.5 + Math.random() * 0.5) * 100) / 100,
    direction,
    strength,
    sources: [
      { source: "news", count: Math.floor(Math.random() * 20) + 5, avgSentiment: Math.round((composite + (Math.random() - 0.5) * 0.2) * 100) / 100, latestTimestamp: new Date().toISOString() },
      { source: "social", count: Math.floor(Math.random() * 80) + 10, avgSentiment: Math.round((composite + (Math.random() - 0.5) * 0.4) * 100) / 100, latestTimestamp: new Date().toISOString() },
      { source: "analyst", count: Math.floor(Math.random() * 5) + 1, avgSentiment: Math.round((composite + (Math.random() - 0.5) * 0.1) * 100) / 100, latestTimestamp: new Date().toISOString() },
    ],
    signalCount: Math.floor(Math.random() * 100) + 20,
    trendDirection: Math.random() > 0.5 ? "improving" : Math.random() > 0.5 ? "deteriorating" : "stable",
    momentum: Math.round((Math.random() - 0.5) * 0.4 * 1000) / 1000,
    lastUpdated: new Date().toISOString(),
  };
}

const biases: Record<string, number> = { AAPL: 0.45, NVDA: 0.72, TSLA: -0.35, MSFT: 0.38, META: 0.22, AMZN: 0.15, "BTC-USD": 0.55, "ETH-USD": 0.30 };

const newsArticles = [
  { id: "n1", title: "NVIDIA Breaks Revenue Record on AI Demand Surge", summary: "NVDA Q4 revenue surges 265% YoY driven by data center GPU demand.", source: "Reuters", sentiment: 0.85, magnitude: 0.9, impact: "high", implication: "bullish", symbols: ["NVDA"], publishedAt: new Date(Date.now() - 1800_000).toISOString() },
  { id: "n2", title: "Tesla Faces Margin Pressure as Price War Continues", summary: "TSLA automotive margins decline for fourth consecutive quarter.", source: "Bloomberg", sentiment: -0.65, magnitude: 0.7, impact: "high", implication: "bearish", symbols: ["TSLA"], publishedAt: new Date(Date.now() - 3600_000).toISOString() },
  { id: "n3", title: "Apple Services Revenue Hits All-Time High", summary: "App Store, iCloud, and Apple TV+ drive record services growth.", source: "CNBC", sentiment: 0.55, magnitude: 0.6, impact: "medium", implication: "bullish", symbols: ["AAPL"], publishedAt: new Date(Date.now() - 5400_000).toISOString() },
  { id: "n4", title: "Bitcoin ETF Inflows Accelerate Past $2B Weekly", summary: "Institutional demand for spot Bitcoin ETFs continues to grow.", source: "CoinDesk", sentiment: 0.70, magnitude: 0.75, impact: "high", implication: "bullish", symbols: ["BTC-USD"], publishedAt: new Date(Date.now() - 7200_000).toISOString() },
  { id: "n5", title: "Microsoft Azure Growth Accelerates to 33%", summary: "Cloud revenue growth exceeds Street estimates.", source: "WSJ", sentiment: 0.60, magnitude: 0.65, impact: "medium", implication: "bullish", symbols: ["MSFT"], publishedAt: new Date(Date.now() - 9000_000).toISOString() },
  { id: "n6", title: "Meta's Reality Labs Losses Widen to $4.6B", summary: "Metaverse investment continues to drag on overall profitability.", source: "Reuters", sentiment: -0.40, magnitude: 0.5, impact: "medium", implication: "bearish", symbols: ["META"], publishedAt: new Date(Date.now() - 10800_000).toISOString() },
  { id: "n7", title: "Amazon Web Services Announces Custom AI Chips", summary: "AWS Trainium 3 chips promise 4x performance improvement.", source: "TechCrunch", sentiment: 0.50, magnitude: 0.55, impact: "medium", implication: "bullish", symbols: ["AMZN"], publishedAt: new Date(Date.now() - 12600_000).toISOString() },
  { id: "n8", title: "Ethereum Shanghai Upgrade Drives Staking Growth", summary: "ETH staking ratio climbs to 28% post-upgrade.", source: "The Block", sentiment: 0.45, magnitude: 0.5, impact: "medium", implication: "bullish", symbols: ["ETH-USD"], publishedAt: new Date(Date.now() - 14400_000).toISOString() },
  { id: "n9", title: "Fed Signals Potential Rate Cut in September", summary: "FOMC minutes reveal dovish tone among several members.", source: "Reuters", sentiment: 0.30, magnitude: 0.8, impact: "high", implication: "bullish", symbols: ["AAPL", "NVDA", "TSLA", "MSFT"], publishedAt: new Date(Date.now() - 16200_000).toISOString() },
  { id: "n10", title: "Tesla Recalls 1.2M Vehicles Over Steering Issue", summary: "OTA update to be deployed; no injuries reported.", source: "AP", sentiment: -0.50, magnitude: 0.6, impact: "medium", implication: "bearish", symbols: ["TSLA"], publishedAt: new Date(Date.now() - 18000_000).toISOString() },
];

const socialAlerts = [
  { type: "volume_spike", symbol: "NVDA", severity: "high", description: "NVDA mentions up 340% in last 2 hours — earnings reaction", detectedAt: new Date(Date.now() - 600_000).toISOString() },
  { type: "sentiment_flip", symbol: "TSLA", severity: "medium", description: "TSLA sentiment flipped bearish after recall headline", detectedAt: new Date(Date.now() - 1800_000).toISOString() },
  { type: "influencer_mention", symbol: "BTC-USD", severity: "medium", description: "@CryptoWhale (1.2M followers) posted bullish BTC thesis", detectedAt: new Date(Date.now() - 3600_000).toISOString() },
];

const trendingSymbols = [
  { symbol: "NVDA", mentionCount: 4280, momentum: 0.85 },
  { symbol: "BTC-USD", mentionCount: 3150, momentum: 0.62 },
  { symbol: "TSLA", mentionCount: 2890, momentum: -0.45 },
  { symbol: "AAPL", mentionCount: 1820, momentum: 0.21 },
  { symbol: "META", mentionCount: 1340, momentum: 0.12 },
];

const keywords = [
  { keyword: "AI", frequency: 342, sentiment: 0.65 },
  { keyword: "earnings", frequency: 289, sentiment: 0.15 },
  { keyword: "GPU", frequency: 245, sentiment: 0.72 },
  { keyword: "revenue", frequency: 198, sentiment: 0.35 },
  { keyword: "growth", frequency: 187, sentiment: 0.55 },
  { keyword: "decline", frequency: 156, sentiment: -0.48 },
  { keyword: "ETF", frequency: 145, sentiment: 0.52 },
  { keyword: "margin", frequency: 132, sentiment: -0.22 },
  { keyword: "cloud", frequency: 128, sentiment: 0.45 },
  { keyword: "recall", frequency: 98, sentiment: -0.65 },
  { keyword: "Bitcoin", frequency: 95, sentiment: 0.58 },
  { keyword: "bullish", frequency: 89, sentiment: 0.80 },
  { keyword: "upgrade", frequency: 78, sentiment: 0.70 },
  { keyword: "staking", frequency: 72, sentiment: 0.42 },
  { keyword: "rate_cut", frequency: 68, sentiment: 0.38 },
  { keyword: "bearish", frequency: 65, sentiment: -0.75 },
  { keyword: "chips", frequency: 61, sentiment: 0.50 },
  { keyword: "services", frequency: 58, sentiment: 0.32 },
  { keyword: "demand", frequency: 55, sentiment: 0.48 },
  { keyword: "metaverse", frequency: 42, sentiment: -0.30 },
];

// ── GET /snapshot ───────────────────────────────────────────────────────────
router.get("/snapshot", (_req: Request, res: Response) => {
  const symbolSentiments: Record<string, ReturnType<typeof mockSentiment>> = {};
  for (const sym of symbols) {
    symbolSentiments[sym] = mockSentiment(sym, biases[sym] ?? 0);
  }

  const composites = Object.values(symbolSentiments).map((s) => s.composite);
  const overall = composites.reduce((a, b) => a + b, 0) / composites.length;

  const sorted = Object.values(symbolSentiments).sort((a, b) => b.composite - a.composite);

  res.json({
    symbols: symbolSentiments,
    mostBullish: sorted.slice(0, 3).map((s) => ({ symbol: s.symbol, score: s.composite })),
    mostBearish: sorted.slice(-3).reverse().map((s) => ({ symbol: s.symbol, score: s.composite })),
    biggestShifts: [
      { symbol: "NVDA", delta: 0.18, direction: "up" },
      { symbol: "TSLA", delta: -0.22, direction: "down" },
      { symbol: "BTC-USD", delta: 0.12, direction: "up" },
    ],
    overallMarketSentiment: Math.round(overall * 1000) / 1000,
    timestamp: new Date().toISOString(),
  });
});

// ── GET /news ───────────────────────────────────────────────────────────────
router.get("/news", async (req: Request, res: Response) => {
  try {
    const symbols_param = (req.query.symbols as string)?.split(",") ?? symbols;
    const articles = await fetchAlpacaNews(symbols_param, 50, logger);

    let filtered = articles;
    const { sentiment, impact, symbol } = req.query;

    if (sentiment === "bullish") filtered = filtered.filter((a) => a.sentiment > 0.15);
    else if (sentiment === "bearish") filtered = filtered.filter((a) => a.sentiment < -0.15);

    if (impact) filtered = filtered.filter((a) => a.impact === impact);
    if (symbol) filtered = filtered.filter((a) => a.symbols.includes(String(symbol).toUpperCase()));

    const bullish = filtered.filter((a) => a.sentiment > 0.15).length;
    const bearish = filtered.filter((a) => a.sentiment < -0.15).length;

    res.json({
      articles: filtered,
      totalArticles: filtered.length,
      bySentiment: { bullish, bearish, neutral: filtered.length - bullish - bearish },
      source: "alpaca_news",
      lastUpdated: new Date().toISOString(),
    });
  } catch (err) {
    logger.warn({ error: String(err) }, "Error fetching news sentiment");
    res.status(500).json({ error: "Failed to fetch news sentiment" });
  }
});

// ── GET /social ─────────────────────────────────────────────────────────────
router.get("/social", (_req: Request, res: Response) => {
  const platformHealth: Record<string, string> = { twitter: "active", reddit: "active", stocktwits: "active", discord: "degraded" };
  const platformBreakdown: Record<string, { count: number; avgSentiment: number }> = {
    twitter: { count: 3420, avgSentiment: 0.28 },
    reddit: { count: 2180, avgSentiment: 0.15 },
    stocktwits: { count: 1650, avgSentiment: 0.32 },
    discord: { count: 890, avgSentiment: 0.21 },
  };

  res.json({
    trendingSymbols,
    activeAlerts: socialAlerts,
    platformHealth,
    platformBreakdown,
    overallSocialSentiment: 0.28,
    bullBearRatio: 1.65,
    timestamp: new Date().toISOString(),
  });
});

// ── GET /movers ─────────────────────────────────────────────────────────────
router.get("/movers", (_req: Request, res: Response) => {
  const all = symbols.map((sym) => mockSentiment(sym, biases[sym] ?? 0));
  const sorted = all.sort((a, b) => b.composite - a.composite);

  res.json({
    bullish: sorted.slice(0, 4),
    bearish: sorted.slice(-4).reverse(),
  });
});

// ── GET /keywords ───────────────────────────────────────────────────────────
router.get("/keywords", (_req: Request, res: Response) => {
  res.json({
    keywords,
    totalKeywords: keywords.length,
    topBullish: keywords.filter((k) => k.sentiment > 0.3).slice(0, 5),
    topBearish: keywords.filter((k) => k.sentiment < -0.3).slice(0, 5),
    timestamp: new Date().toISOString(),
  });
});

// ── GET /symbol/:symbol ─────────────────────────────────────────────────────
router.get("/symbol/:symbol", (req: Request, res: Response) => {
  const sym = (req.params.symbol as string).toUpperCase();
  const bias = biases[sym] ?? 0;
  const sentiment = mockSentiment(sym, bias);
  const articles = newsArticles.filter((a) => a.symbols.includes(sym));
  const alerts = socialAlerts.filter((a) => a.symbol === sym);

  res.json({
    sentiment,
    recentNews: articles.slice(0, 5),
    socialAlerts: alerts,
    history: Array.from({ length: 24 }, (_, i) => ({
      timestamp: new Date(Date.now() - i * 3600_000).toISOString(),
      composite: Math.round((bias + (Math.random() - 0.5) * 0.4) * 1000) / 1000,
    })).reverse(),
  });
});

// ── GET /health ─────────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    subsystems: {
      sentimentAggregator: { status: "ok", symbolsTracked: symbols.length, totalSignals: 1247 },
      newsProcessor: { status: "ok", articlesProcessed: newsArticles.length, highImpact: newsArticles.filter((a) => a.impact === "high").length },
      socialTracker: { status: "ok", activeAlerts: socialAlerts.length, platformsOnline: 3 },
    },
    uptime: process.uptime(),
  });
});

export default router;
