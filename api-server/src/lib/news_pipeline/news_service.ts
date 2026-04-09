import { randomUUID } from "crypto";

export type NewsCategory = "earnings" | "macro" | "geopolitical" | "regulatory" | "sector" | "company" | "market_structure" | "technical";

export interface NewsItem {
  id: string; // prefix "news_"
  source: string;
  headline: string;
  body?: string;
  symbols: string[];
  categories: NewsCategory[];
  sentiment: "bullish" | "bearish" | "neutral" | "mixed";
  impact: "high" | "medium" | "low";
  published_at: number;
  ingested_at: number;
  url?: string;
  ai_summary?: string;
}

export interface SignalMapping {
  id: string; // prefix "sig_"
  news_id: string;
  symbol: string;
  signal_type: "risk_on" | "risk_off" | "volatility_spike" | "momentum_shift" | "sector_rotation" | "event_driven";
  confidence: number; // 0-1
  suggested_action: "buy" | "sell" | "hedge" | "reduce" | "hold" | "monitor";
  rationale: string;
  expires_at: number;
  created_at: number;
}

export interface MarketSentimentSnapshot {
  timestamp: number;
  overall: "risk_on" | "risk_off" | "neutral" | "uncertain";
  sector_sentiment: Record<string, "bullish" | "bearish" | "neutral">;
  fear_greed_proxy: number; // 0-100
  active_themes: string[];
  high_impact_count: number;
}

class NewsService {
  private newsStore = new Map<string, NewsItem>();
  private signalStore = new Map<string, SignalMapping>();

  ingestNews(
    source: string,
    headline: string,
    symbols: string[],
    categories: NewsCategory[],
    sentiment: "bullish" | "bearish" | "neutral" | "mixed",
    impact: "high" | "medium" | "low",
    publishedAt: number,
    body?: string,
    url?: string,
    aiSummary?: string
  ): { success: boolean; data?: NewsItem; error?: string } {
    const id = `news_${randomUUID()}`;
    const item: NewsItem = {
      id,
      source,
      headline,
      body,
      symbols,
      categories,
      sentiment,
      impact,
      published_at: publishedAt,
      ingested_at: Date.now(),
      url,
      ai_summary: aiSummary,
    };

    this.newsStore.set(id, item);
    return { success: true, data: item };
  }

  getNewsItem(newsId: string): { success: boolean; data?: NewsItem; error?: string } {
    const item = this.newsStore.get(newsId);
    return item ? { success: true, data: item } : { success: false, error: "News item not found" };
  }

  getNewsBySymbol(symbol: string): { success: boolean; data: NewsItem[] } {
    const items = Array.from(this.newsStore.values()).filter((n) => n.symbols.includes(symbol));
    return { success: true, data: items };
  }

  getNewsByCategory(category: NewsCategory): { success: boolean; data: NewsItem[] } {
    const items = Array.from(this.newsStore.values()).filter((n) => n.categories.includes(category));
    return { success: true, data: items };
  }

  getRecentNews(limitHours: number = 24): { success: boolean; data: NewsItem[] } {
    const cutoff = Date.now() - limitHours * 3600000;
    const items = Array.from(this.newsStore.values())
      .filter((n) => n.ingested_at >= cutoff)
      .sort((a, b) => b.ingested_at - a.ingested_at);
    return { success: true, data: items };
  }

  searchNews(query: string): { success: boolean; data: NewsItem[] } {
    const lowerQuery = query.toLowerCase();
    const items = Array.from(this.newsStore.values()).filter(
      (n) => n.headline.toLowerCase().includes(lowerQuery) || (n.body ?? "").toLowerCase().includes(lowerQuery)
    );
    return { success: true, data: items };
  }

  mapNewsToSignal(
    newsId: string,
    symbol: string,
    signalType: "risk_on" | "risk_off" | "volatility_spike" | "momentum_shift" | "sector_rotation" | "event_driven",
    confidence: number,
    suggestedAction: "buy" | "sell" | "hedge" | "reduce" | "hold" | "monitor",
    rationale: string,
    expiresAtMs: number
  ): { success: boolean; data?: SignalMapping; error?: string } {
    const newsItem = this.newsStore.get(newsId);
    if (!newsItem) return { success: false, error: "News item not found" };

    if (!newsItem.symbols.includes(symbol)) {
      return { success: false, error: "Symbol not in news item" };
    }

    const id = `sig_${randomUUID()}`;
    const mapping: SignalMapping = {
      id,
      news_id: newsId,
      symbol,
      signal_type: signalType,
      confidence: Math.min(1, Math.max(0, confidence)),
      suggested_action: suggestedAction,
      rationale,
      expires_at: expiresAtMs,
      created_at: Date.now(),
    };

    this.signalStore.set(id, mapping);
    return { success: true, data: mapping };
  }

  getSignalsForSymbol(symbol: string): { success: boolean; data: SignalMapping[] } {
    const now = Date.now();
    const signals = Array.from(this.signalStore.values()).filter((s) => s.symbol === symbol && s.expires_at > now);
    return { success: true, data: signals };
  }

  getActiveSignals(): { success: boolean; data: SignalMapping[] } {
    const now = Date.now();
    const signals = Array.from(this.signalStore.values()).filter((s) => s.expires_at > now);
    return { success: true, data: signals };
  }

  generateSentimentSnapshot(): { success: boolean; data?: MarketSentimentSnapshot; error?: string } {
    const allNews = Array.from(this.newsStore.values());
    if (allNews.length === 0) {
      return { success: false, error: "No news available" };
    }

    const highImpactNews = allNews.filter((n) => n.impact === "high");
    const bullishHighImpact = highImpactNews.filter((n) => n.sentiment === "bullish").length;
    const bearishHighImpact = highImpactNews.filter((n) => n.sentiment === "bearish").length;

    let overall: "risk_on" | "risk_off" | "neutral" | "uncertain";
    if (bullishHighImpact > bearishHighImpact * 1.5) {
      overall = "risk_on";
    } else if (bearishHighImpact > bullishHighImpact * 1.5) {
      overall = "risk_off";
    } else if (bullishHighImpact + bearishHighImpact === 0) {
      overall = "neutral";
    } else {
      overall = "uncertain";
    }

    const sectorSentiment: Record<string, "bullish" | "bearish" | "neutral"> = {};
    const allCategories = new Set<string>();
    allNews.forEach((n) => n.categories.forEach((c) => allCategories.add(c)));

    allCategories.forEach((cat) => {
      const catNews = allNews.filter((n) => n.categories.includes(cat as NewsCategory));
      const bullish = catNews.filter((n) => n.sentiment === "bullish").length;
      const bearish = catNews.filter((n) => n.sentiment === "bearish").length;

      if (bullish > bearish) sectorSentiment[cat] = "bullish";
      else if (bearish > bullish) sectorSentiment[cat] = "bearish";
      else sectorSentiment[cat] = "neutral";
    });

    const fearGreedProxy = 50 + (bullishHighImpact - bearishHighImpact) * 5;
    const clampedFG = Math.min(100, Math.max(0, fearGreedProxy));

    const activeThemes: string[] = Array.from(allCategories);

    return {
      success: true,
      data: {
        timestamp: Date.now(),
        overall,
        sector_sentiment: sectorSentiment,
        fear_greed_proxy: clampedFG,
        active_themes: activeThemes,
        high_impact_count: highImpactNews.length,
      },
    };
  }

  summarizeNews(newsId: string): { success: boolean; data?: string; error?: string } {
    const item = this.newsStore.get(newsId);
    if (!item) return { success: false, error: "News item not found" };

    if (item.ai_summary) {
      return { success: true, data: item.ai_summary };
    }

    const summary = `${item.headline}. Sentiment: ${item.sentiment}. Impact: ${item.impact}. Symbols: ${item.symbols.join(", ")}`;
    return { success: true, data: summary };
  }

  _clearNews() {
    this.newsStore.clear();
    this.signalStore.clear();
  }
}

export const newsService = new NewsService();
