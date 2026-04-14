/**
 * news_sentiment/index.ts — Phase 89: News + Sentiment Engine
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. NewsStore         — news items with categorization.
 *   2. SentimentScorer   — lexicon-based sentiment (-1..+1).
 *   3. SymbolExtractor   — detect ticker symbols + company refs.
 *   4. EventCategorizer  — earnings/M&A/regulatory/macro classification.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── News Store ────────────────────────────────────────────────────────────

export type NewsCategory = "earnings" | "m_and_a" | "regulatory" | "macro" | "product" | "executive" | "general";

export interface NewsItem {
  id: string;
  source: string;
  headline: string;
  body?: string;
  url?: string;
  publishedAt: number;
  symbols: string[];
  categories: NewsCategory[];
  sentiment?: number;
  confidence?: number;
  metadata: Record<string, string>;
}

export class NewsStore {
  private readonly items: NewsItem[] = [];

  ingest(params: Omit<NewsItem, "id">): NewsItem {
    const item: NewsItem = {
      id: `nws_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      ...params,
    };
    this.items.push(item);
    if (this.items.length > 50_000) this.items.shift();
    return item;
  }

  query(params?: { symbol?: string; category?: NewsCategory; since?: number; until?: number; limit?: number }): NewsItem[] {
    let out = [...this.items];
    if (params?.symbol) out = out.filter((i) => i.symbols.includes(params.symbol!));
    if (params?.category) out = out.filter((i) => i.categories.includes(params.category!));
    if (params?.since) out = out.filter((i) => i.publishedAt >= params.since!);
    if (params?.until) out = out.filter((i) => i.publishedAt <= params.until!);
    out.sort((a, b) => b.publishedAt - a.publishedAt);
    return out.slice(0, params?.limit ?? 100);
  }

  bySymbol(symbol: string, sinceMs = 24 * 60 * 60 * 1000): NewsItem[] {
    const since = Date.now() - sinceMs;
    return this.query({ symbol, since });
  }

  size(): number {
    return this.items.length;
  }
}

// ── Sentiment ─────────────────────────────────────────────────────────────

const POSITIVE_WORDS = new Set([
  "beat", "beats", "exceeded", "growth", "profit", "profitable", "strong", "rally", "surge", "surged",
  "upgrade", "upgraded", "outperform", "buy", "bullish", "gain", "gains", "boost", "boosts", "raises",
  "raised", "record", "milestone", "expand", "expansion", "win", "wins", "approval", "approved",
]);

const NEGATIVE_WORDS = new Set([
  "miss", "missed", "decline", "decrease", "loss", "losses", "weak", "drop", "dropped", "plunge",
  "downgrade", "downgraded", "underperform", "sell", "bearish", "warning", "cuts", "lawsuit",
  "investigation", "probe", "fraud", "fail", "failed", "delay", "delayed", "halt", "halted",
  "subpoena", "fine", "penalty",
]);

export interface SentimentResult {
  score: number;        // -1..+1
  confidence: number;   // 0..1
  positiveHits: string[];
  negativeHits: string[];
  totalWords: number;
}

export class SentimentScorer {
  score(text: string): SentimentResult {
    const lower = text.toLowerCase();
    const tokens = lower.split(/\s+/).filter((t) => t.length > 0);
    const totalWords = tokens.length;
    const positiveHits: string[] = [];
    const negativeHits: string[] = [];
    for (const tok of tokens) {
      const clean = tok.replace(/[^a-z]/g, "");
      if (POSITIVE_WORDS.has(clean)) positiveHits.push(clean);
      else if (NEGATIVE_WORDS.has(clean)) negativeHits.push(clean);
    }
    const net = positiveHits.length - negativeHits.length;
    const total = positiveHits.length + negativeHits.length;
    const score = total > 0 ? net / total : 0;
    const confidence = totalWords > 0 ? Math.min(1, total / Math.max(5, totalWords / 10)) : 0;
    return { score, confidence, positiveHits, negativeHits, totalWords };
  }
}

// ── Symbol Extractor ──────────────────────────────────────────────────────

export class SymbolExtractor {
  private readonly knownSymbols = new Set<string>();
  private readonly companyMap = new Map<string, string>(); // company name → symbol

  registerSymbol(symbol: string, companyName?: string): void {
    this.knownSymbols.add(symbol.toUpperCase());
    if (companyName) this.companyMap.set(companyName.toLowerCase(), symbol.toUpperCase());
  }

  extract(text: string): string[] {
    const found = new Set<string>();
    // Pattern 1: $TICKER
    const dollarMatches = text.match(/\$[A-Z]{1,5}\b/g) ?? [];
    for (const m of dollarMatches) found.add(m.slice(1));
    // Pattern 2: ALL CAPS 1-5 char tokens that are known symbols
    const allCapsMatches = text.match(/\b[A-Z]{1,5}\b/g) ?? [];
    for (const m of allCapsMatches) {
      if (this.knownSymbols.has(m)) found.add(m);
    }
    // Pattern 3: company name lookup
    const lower = text.toLowerCase();
    for (const [name, symbol] of this.companyMap) {
      if (lower.includes(name)) found.add(symbol);
    }
    return Array.from(found);
  }
}

// ── Event Categorizer ─────────────────────────────────────────────────────

const CATEGORY_PATTERNS: Array<{ category: NewsCategory; patterns: RegExp[] }> = [
  { category: "earnings", patterns: [/earnings/i, /quarterly results/i, /\bEPS\b/i, /\brevenue\b/i, /Q[1-4] (?:report|results)/i] },
  { category: "m_and_a", patterns: [/acquisition/i, /merger/i, /\bM&A\b/i, /\bdivests?\b/i, /takeover/i] },
  { category: "regulatory", patterns: [/\bSEC\b/i, /\bFDA\b/i, /\bFTC\b/i, /investigation/i, /lawsuit/i, /antitrust/i, /fine/i] },
  { category: "macro", patterns: [/\bFed\b/i, /\bFOMC\b/i, /interest rate/i, /\bCPI\b/i, /\bGDP\b/i, /unemployment/i, /\bECB\b/i] },
  { category: "product", patterns: [/launch/i, /unveil/i, /announce(?:s|d)?\b/i, /release/i] },
  { category: "executive", patterns: [/\bCEO\b/i, /\bCFO\b/i, /\bCOO\b/i, /resign/i, /appointed/i, /step down/i] },
];

export class EventCategorizer {
  categorize(text: string): NewsCategory[] {
    const categories: NewsCategory[] = [];
    for (const { category, patterns } of CATEGORY_PATTERNS) {
      if (patterns.some((p) => p.test(text))) categories.push(category);
    }
    return categories.length > 0 ? categories : ["general"];
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const newsStore = new NewsStore();
export const sentimentScorer = new SentimentScorer();
export const symbolExtractor = new SymbolExtractor();
export const eventCategorizer = new EventCategorizer();

// Pre-register a handful of common tickers + company names
const seedSymbols: Array<[string, string]> = [
  ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["GOOGL", "Google"], ["AMZN", "Amazon"],
  ["NVDA", "Nvidia"], ["TSLA", "Tesla"], ["META", "Meta"], ["JPM", "JPMorgan"],
  ["SPY", "S&P 500"], ["QQQ", "Nasdaq 100"],
];
for (const [s, n] of seedSymbols) symbolExtractor.registerSymbol(s, n);

logger.info("[News] Module initialized");
