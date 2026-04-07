import { EventEmitter } from 'events';

// ============================================================================
// Type Definitions
// ============================================================================

export interface NewsProcessorConfig {
  maxArticlesPerSymbol?: number;
  relevanceThreshold?: number;
  updateIntervalMs?: number;
}

export interface NewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  url: string;
  publishedAt: string;
  symbols: string[];
  categories: string[];
  author?: string;
}

export interface NamedEntity {
  name: string;
  type: 'company' | 'person' | 'sector' | 'event';
}

export interface ProcessedArticle extends NewsArticle {
  sentiment: number;
  magnitude: number;
  relevanceScore: number;
  keywords: string[];
  namedEntities: NamedEntity[];
  impactEstimate: 'high' | 'medium' | 'low';
  tradingImplication: 'bullish' | 'bearish' | 'neutral' | 'mixed';
}

export interface SentimentCounts {
  bullish: number;
  bearish: number;
  neutral: number;
}

export interface TopKeyword {
  keyword: string;
  count: number;
  avgSentiment: number;
}

export interface NewsFeed {
  articles: ProcessedArticle[];
  totalArticles: number;
  bySource: Record<string, number>;
  bySentiment: SentimentCounts;
  topKeywords: TopKeyword[];
  lastUpdated: string;
}

export interface KeywordTrend {
  keyword: string;
  frequency: number;
  sentimentTrend: number;
}

export interface ImpactHistoryEntry {
  timestamp: string;
  headline: string;
  sentiment: number;
  priceImpact?: number;
}

// ============================================================================
// Sentiment Scoring Configuration
// ============================================================================

const BULLISH_WORDS: Record<string, number> = {
  beat: 0.95,
  surge: 0.85,
  upgrade: 0.80,
  growth: 0.75,
  record: 0.85,
  bullish: 0.90,
  outperform: 0.80,
  rally: 0.80,
  breakout: 0.75,
  profit: 0.70,
  strong: 0.65,
  momentum: 0.70,
  buy: 0.75,
  accumulate: 0.70,
  expansion: 0.70,
  recovery: 0.65,
  gains: 0.70,
  opportunity: 0.60,
  upside: 0.65,
  positive: 0.60,
};

const BEARISH_WORDS: Record<string, number> = {
  miss: -0.95,
  plunge: -0.85,
  downgrade: -0.80,
  decline: -0.65,
  loss: -0.75,
  bearish: -0.90,
  underperform: -0.80,
  crash: -0.85,
  breakdown: -0.75,
  warning: -0.70,
  weak: -0.60,
  sell: -0.75,
  short: -0.70,
  default: -0.90,
  bankruptcy: -0.95,
  fraud: -0.95,
  scandal: -0.85,
  risk: -0.50,
  concern: -0.55,
  challenge: -0.45,
};

const SOURCE_CREDIBILITY: Record<string, number> = {
  reuters: 1.0,
  bloomberg: 0.95,
  cnbc: 0.90,
  'wall street journal': 0.95,
  ft: 0.90,
  'financial times': 0.90,
  ap: 0.90,
  'associated press': 0.90,
  sec: 0.98,
  nasdaq: 0.90,
  nyse: 0.90,
  default: 0.7,
};

// ============================================================================
// NewsProcessor Class
// ============================================================================

export class NewsProcessor extends EventEmitter {
  private config: Required<NewsProcessorConfig>;
  private articleCache: Map<string, ProcessedArticle>;
  private symbolIndex: Map<string, ProcessedArticle[]>;
  private keywordIndex: Map<string, { count: number; sentiments: number[] }>;
  private impactHistory: Map<string, ImpactHistoryEntry[]>;

  constructor(config: NewsProcessorConfig = {}) {
    super();
    this.config = {
      maxArticlesPerSymbol: config.maxArticlesPerSymbol ?? 50,
      relevanceThreshold: config.relevanceThreshold ?? 0.3,
      updateIntervalMs: config.updateIntervalMs ?? 60000,
    };
    this.articleCache = new Map();
    this.symbolIndex = new Map();
    this.keywordIndex = new Map();
    this.impactHistory = new Map();
  }

  /**
   * Process a single article: score sentiment, extract keywords, estimate impact
   */
  public processArticle(article: NewsArticle): ProcessedArticle {
    const { sentiment, magnitude } = this.scoreSentiment(article.title, article.summary);
    const keywords = this.extractKeywords(article.title, article.summary);
    const namedEntities = this.extractNamedEntities(article.title, article.summary);
    const relevanceScore = this.calculateRelevance(article, keywords);
    const impactEstimate = this.estimateImpact(sentiment, magnitude, article.source);
    const tradingImplication = this.deduceTradingImplication(sentiment, magnitude, keywords);

    const processed: ProcessedArticle = {
      ...article,
      sentiment,
      magnitude,
      relevanceScore,
      keywords,
      namedEntities,
      impactEstimate,
      tradingImplication,
    };

    // Cache the article
    this.articleCache.set(article.id, processed);

    // Index by symbols
    for (const symbol of article.symbols) {
      if (!this.symbolIndex.has(symbol)) {
        this.symbolIndex.set(symbol, []);
      }
      const symbolArticles = this.symbolIndex.get(symbol)!;
      symbolArticles.unshift(processed);
      // Keep only max articles per symbol
      if (symbolArticles.length > this.config.maxArticlesPerSymbol) {
        const removed = symbolArticles.pop()!;
        this.articleCache.delete(removed.id);
      }
    }

    // Update keyword index
    for (const keyword of keywords) {
      if (!this.keywordIndex.has(keyword)) {
        this.keywordIndex.set(keyword, { count: 0, sentiments: [] });
      }
      const keywordData = this.keywordIndex.get(keyword)!;
      keywordData.count++;
      keywordData.sentiments.push(sentiment);
    }

    // Record impact history
    for (const symbol of article.symbols) {
      if (!this.impactHistory.has(symbol)) {
        this.impactHistory.set(symbol, []);
      }
      const history = this.impactHistory.get(symbol)!;
      history.unshift({
        timestamp: new Date().toISOString(),
        headline: article.title,
        sentiment,
      });
      if (history.length > 200) {
        history.pop();
      }
    }

    // Emit events
    this.emit('news:processed', processed);

    if (impactEstimate === 'high') {
      this.emit('news:high-impact', processed);
    }

    return processed;
  }

  /**
   * Get articles for a specific symbol, optionally limited
   */
  public getArticles(symbol: string, limit?: number): ProcessedArticle[] {
    const articles = this.symbolIndex.get(symbol.toUpperCase()) ?? [];
    return limit ? articles.slice(0, limit) : articles;
  }

  /**
   * Get a comprehensive news feed with optional filtering
   */
  public getFeed(opts?: {
    symbol?: string;
    source?: string;
    sentiment?: string;
    limit?: number;
  }): NewsFeed {
    let articles: ProcessedArticle[] = [];

    if (opts?.symbol) {
      articles = this.getArticles(opts.symbol, opts.limit ?? 100);
    } else {
      articles = Array.from(this.articleCache.values()).sort((a, b) =>
        new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
      );
      if (opts?.limit) {
        articles = articles.slice(0, opts.limit);
      }
    }

    // Filter by source
    if (opts?.source) {
      articles = articles.filter(a => a.source.toLowerCase() === opts.source!.toLowerCase());
    }

    // Filter by sentiment
    if (opts?.sentiment) {
      articles = articles.filter(a => {
        if (opts.sentiment === 'bullish') return a.tradingImplication === 'bullish';
        if (opts.sentiment === 'bearish') return a.tradingImplication === 'bearish';
        if (opts.sentiment === 'neutral') return a.tradingImplication === 'neutral';
        return true;
      });
    }

    // Calculate feed statistics
    const bySource: Record<string, number> = {};
    const bySentiment: SentimentCounts = { bullish: 0, bearish: 0, neutral: 0 };

    for (const article of articles) {
      bySource[article.source] = (bySource[article.source] ?? 0) + 1;
      if (article.tradingImplication === 'bullish') bySentiment.bullish++;
      else if (article.tradingImplication === 'bearish') bySentiment.bearish++;
      else bySentiment.neutral++;
    }

    // Get top keywords
    const topKeywords = this.getTopKeywords(20);

    return {
      articles,
      totalArticles: articles.length,
      bySource,
      bySentiment,
      topKeywords,
      lastUpdated: new Date().toISOString(),
    };
  }

  /**
   * Get keyword trends over time
   */
  public getKeywordTrends(period?: number): KeywordTrend[] {
    const trends: KeywordTrend[] = [];
    const now = Date.now();
    const cutoffTime = period ? now - period : now - 86400000; // Default: 24 hours

    for (const [keyword, data] of this.keywordIndex.entries()) {
      const avgSentiment = data.sentiments.length > 0
        ? data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length
        : 0;

      trends.push({
        keyword,
        frequency: data.count,
        sentimentTrend: avgSentiment,
      });
    }

    return trends.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Get impact history for a symbol
   */
  public getImpactHistory(symbol: string): ImpactHistoryEntry[] {
    return this.impactHistory.get(symbol.toUpperCase()) ?? [];
  }

  /**
   * Clear articles older than maxAgeMs; returns count of removed articles
   */
  public clearOldArticles(maxAgeMs: number = 604800000): number {
    const now = Date.now();
    const cutoff = new Date(now - maxAgeMs);
    let removed = 0;

    const toRemove: string[] = [];

    for (const [id, article] of this.articleCache.entries()) {
      if (new Date(article.publishedAt) < cutoff) {
        toRemove.push(id);
        removed++;
      }
    }

    // Remove from main cache
    for (const id of toRemove) {
      const article = this.articleCache.get(id)!;
      this.articleCache.delete(id);

      // Remove from symbol index
      for (const symbol of article.symbols) {
        const symbolArticles = this.symbolIndex.get(symbol);
        if (symbolArticles) {
          const idx = symbolArticles.findIndex(a => a.id === id);
          if (idx !== -1) {
            symbolArticles.splice(idx, 1);
          }
        }
      }
    }

    return removed;
  }

  // ========================================================================
  // Private Helper Methods
  // ========================================================================

  /**
   * Score sentiment of title and summary using keyword analysis
   */
  private scoreSentiment(title: string, summary: string): { sentiment: number; magnitude: number } {
    const text = `${title} ${summary}`.toLowerCase();
    const words = text.split(/\s+/);

    let sentimentScore = 0;
    let wordCount = 0;
    let hasSuperlatives = false;
    let hasExclamation = false;
    let hasNumbers = false;

    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');

      if (BULLISH_WORDS[cleanWord]) {
        sentimentScore += BULLISH_WORDS[cleanWord];
        wordCount++;
      } else if (BEARISH_WORDS[cleanWord]) {
        sentimentScore += BEARISH_WORDS[cleanWord];
        wordCount++;
      }

      // Check for superlatives
      if (/^(most|very|extremely|incredibly|absolutely)\s/i.test(word)) {
        hasSuperlatives = true;
      }

      // Check for exclamation
      if (/!/.test(word)) {
        hasExclamation = true;
      }

      // Check for numbers (could indicate magnitude)
      if (/\d+/.test(word)) {
        hasNumbers = true;
      }
    }

    // Normalize sentiment to -1 to +1 range
    const normalizedSentiment = wordCount > 0
      ? Math.max(-1, Math.min(1, sentimentScore / Math.sqrt(wordCount)))
      : 0;

    // Calculate magnitude based on intensity indicators
    let magnitude = Math.abs(normalizedSentiment);
    if (hasSuperlatives) magnitude = Math.min(1, magnitude + 0.15);
    if (hasExclamation) magnitude = Math.min(1, magnitude + 0.1);
    if (hasNumbers && Math.abs(normalizedSentiment) > 0.3) magnitude = Math.min(1, magnitude + 0.1);

    return {
      sentiment: normalizedSentiment,
      magnitude,
    };
  }

  /**
   * Extract keywords from title and summary
   */
  private extractKeywords(title: string, summary: string): string[] {
    const text = `${title} ${summary}`.toLowerCase();
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'is', 'was', 'are', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
    ]);

    const words = text.split(/\s+/).filter(w => w.length > 3 && !stopWords.has(w));
    const uniqueKeywords = new Set(words);

    return Array.from(uniqueKeywords).slice(0, 15);
  }

  /**
   * Extract named entities (companies, people, sectors, events)
   */
  private extractNamedEntities(title: string, summary: string): NamedEntity[] {
    const entities: NamedEntity[] = [];
    const text = `${title} ${summary}`;

    // Simple pattern-based extraction
    // This is a simplified version; in production, you'd use NLP libraries

    // Companies (looks for Inc., Corp., Ltd., LLC)
    const companyPattern = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:Inc|Corp|Ltd|LLC|Inc\.|Corp\.|Ltd\.|LLC\.)/g;
    let match;
    while ((match = companyPattern.exec(text)) !== null) {
      entities.push({ name: match[1], type: 'company' });
    }

    // People (capitalized words that look like names)
    const namePattern = /(?:CEO|President|Founder|Mr\.|Ms\.|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g;
    while ((match = namePattern.exec(text)) !== null) {
      entities.push({ name: match[1], type: 'person' });
    }

    // Sectors (common industry keywords)
    const sectors = ['tech', 'finance', 'healthcare', 'energy', 'retail', 'manufacturing', 'telecom'];
    for (const sector of sectors) {
      if (text.toLowerCase().includes(sector)) {
        entities.push({ name: sector, type: 'sector' });
      }
    }

    // Events (earnings, IPO, merger, acquisition, bankruptcy)
    const events = ['earnings', 'ipo', 'merger', 'acquisition', 'bankruptcy', 'restructuring', 'recall'];
    for (const event of events) {
      if (text.toLowerCase().includes(event)) {
        entities.push({ name: event, type: 'event' });
      }
    }

    // Remove duplicates
    const seen = new Set();
    return entities.filter(e => {
      const key = `${e.name}:${e.type}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Calculate relevance score based on keywords, symbols, and categories
   */
  private calculateRelevance(article: NewsArticle, keywords: string[]): number {
    let score = 0;

    // Base score from symbol count
    score += Math.min(0.3, article.symbols.length * 0.1);

    // Category relevance
    const relevantCategories = ['markets', 'earnings', 'economic', 'trading', 'stocks'];
    const categoryMatch = article.categories.filter(c =>
      relevantCategories.includes(c.toLowerCase())
    ).length;
    score += Math.min(0.3, categoryMatch * 0.15);

    // Keyword richness
    score += Math.min(0.4, (keywords.length / 15) * 0.4);

    return Math.min(1, score);
  }

  /**
   * Estimate impact level based on sentiment, magnitude, and source credibility
   */
  private estimateImpact(
    sentiment: number,
    magnitude: number,
    source: string
  ): 'high' | 'medium' | 'low' {
    const credibility = SOURCE_CREDIBILITY[source.toLowerCase()] ?? SOURCE_CREDIBILITY.default;
    const impactScore = Math.abs(sentiment) * magnitude * credibility;

    if (impactScore > 0.6) return 'high';
    if (impactScore > 0.35) return 'medium';
    return 'low';
  }

  /**
   * Deduce trading implication from sentiment, magnitude, and keywords
   */
  private deduceTradingImplication(
    sentiment: number,
    magnitude: number,
    keywords: string[]
  ): 'bullish' | 'bearish' | 'neutral' | 'mixed' {
    const bullishKeywordCount = keywords.filter(k => BULLISH_WORDS[k]).length;
    const bearishKeywordCount = keywords.filter(k => BEARISH_WORDS[k]).length;

    if (sentiment > 0.3) {
      return bullishKeywordCount > bearishKeywordCount ? 'bullish' : 'mixed';
    } else if (sentiment < -0.3) {
      return bearishKeywordCount > bullishKeywordCount ? 'bearish' : 'mixed';
    } else {
      return 'neutral';
    }
  }

  /**
   * Get top keywords with their sentiment averages
   */
  private getTopKeywords(limit: number = 20): TopKeyword[] {
    const keywords: TopKeyword[] = [];

    for (const [keyword, data] of this.keywordIndex.entries()) {
      const avgSentiment = data.sentiments.length > 0
        ? data.sentiments.reduce((a, b) => a + b, 0) / data.sentiments.length
        : 0;

      keywords.push({
        keyword,
        count: data.count,
        avgSentiment,
      });
    }

    return keywords
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  }
}
