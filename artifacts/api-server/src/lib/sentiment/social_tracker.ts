import { EventEmitter } from 'events';

// Configuration type
export interface SocialTrackerConfig {
  platforms?: string[];
  volumeWindow?: number;
  spikeThreshold?: number;
  maxSignalsPerSymbol?: number;
}

// Signal type - individual social media mention
export interface SocialSignal {
  id: string;
  platform: string;
  symbol: string;
  content: string;
  sentiment: number; // -1 to +1
  engagement: {
    likes: number;
    shares: number;
    comments: number;
  };
  author: {
    handle: string;
    followers: number;
    credibilityScore: number;
  };
  timestamp: string;
}

// Aggregated metrics for a symbol
export interface SocialMetrics {
  symbol: string;
  mentionCount: number;
  avgSentiment: number;
  sentimentStdDev: number;
  volumeZScore: number;
  isSpike: boolean;
  topInfluencers: Array<{
    handle: string;
    sentiment: number;
    followers: number;
  }>;
  platformBreakdown: Record<string, { count: number; avgSentiment: number }>;
  trendingTopics: string[];
  bullBearRatio: number;
  engagementScore: number;
  lastUpdated: string;
}

// Alert for detected anomalies
export interface SocialAlert {
  type: 'volume_spike' | 'sentiment_flip' | 'influencer_mention' | 'coordinated_activity';
  symbol: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  signals: SocialSignal[];
  detectedAt: string;
}

// Snapshot of all metrics
export interface SocialSnapshot {
  symbols: Record<string, SocialMetrics>;
  activeAlerts: SocialAlert[];
  trendingSymbols: Array<{
    symbol: string;
    mentionCount: number;
    momentum: number;
  }>;
  overallSocialSentiment: number;
  platformHealth: Record<string, 'active' | 'degraded' | 'offline'>;
  timestamp: string;
}

// Main tracker class
export class SocialTracker extends EventEmitter {
  private config: Required<SocialTrackerConfig>;
  private signals: Map<string, SocialSignal[]> = new Map();
  private alerts: SocialAlert[] = [];
  private platformHealth: Record<string, 'active' | 'degraded' | 'offline'> = {};
  private lastVolumeCheckTime: Map<string, number> = new Map();

  constructor(config: SocialTrackerConfig = {}) {
    super();

    this.config = {
      platforms: config.platforms || ['twitter', 'reddit', 'stocktwits', 'discord'],
      volumeWindow: config.volumeWindow || 24,
      spikeThreshold: config.spikeThreshold || 2.5,
      maxSignalsPerSymbol: config.maxSignalsPerSymbol || 200,
    };

    // Initialize platform health
    this.config.platforms.forEach((platform) => {
      this.platformHealth[platform] = 'active';
    });
  }

  /**
   * Ingest a new social signal
   */
  public ingest(signal: SocialSignal): void {
    if (!this.signals.has(signal.symbol)) {
      this.signals.set(signal.symbol, []);
    }

    const signals = this.signals.get(signal.symbol)!;
    signals.push(signal);

    // Trim to max signals per symbol
    if (signals.length > this.config.maxSignalsPerSymbol) {
      signals.shift();
    }

    this.emit('social:ingested', signal);
  }

  /**
   * Get metrics for a specific symbol
   */
  public getMetrics(symbol: string): SocialMetrics | undefined {
    const signals = this.signals.get(symbol);
    if (!signals || signals.length === 0) {
      return undefined;
    }

    return this.computeMetrics(symbol, signals);
  }

  /**
   * Get current snapshot of all data
   */
  public getSnapshot(): SocialSnapshot {
    const symbols: Record<string, SocialMetrics> = {};
    const trendingSymbols: Array<{ symbol: string; mentionCount: number; momentum: number }> = [];

    let totalSentiment = 0;
    let totalSymbols = 0;

    for (const [symbol, signals] of this.signals.entries()) {
      if (signals.length === 0) continue;

      const metrics = this.computeMetrics(symbol, signals);
      symbols[symbol] = metrics;

      totalSentiment += metrics.avgSentiment;
      totalSymbols++;

      trendingSymbols.push({
        symbol,
        mentionCount: metrics.mentionCount,
        momentum: this.calculateMomentum(signals),
      });
    }

    // Sort trending by mention count
    trendingSymbols.sort((a, b) => b.mentionCount - a.mentionCount);

    const overallSocialSentiment = totalSymbols > 0 ? totalSentiment / totalSymbols : 0;

    return {
      symbols,
      activeAlerts: this.alerts,
      trendingSymbols: trendingSymbols.slice(0, 10),
      overallSocialSentiment,
      platformHealth: this.platformHealth,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get alerts, optionally filtered by severity
   */
  public getAlerts(severity?: string): SocialAlert[] {
    if (!severity) {
      return this.alerts;
    }
    return this.alerts.filter((alert) => alert.severity === severity);
  }

  /**
   * Get trending symbols
   */
  public getTrending(count: number = 10): Array<{ symbol: string; mentionCount: number; momentum: number }> {
    const trending: Array<{ symbol: string; mentionCount: number; momentum: number }> = [];

    for (const [symbol, signals] of this.signals.entries()) {
      if (signals.length === 0) continue;
      trending.push({
        symbol,
        mentionCount: signals.length,
        momentum: this.calculateMomentum(signals),
      });
    }

    return trending.sort((a, b) => b.mentionCount - a.mentionCount).slice(0, count);
  }

  /**
   * Detect anomalies and return alerts
   */
  public detectAnomalies(): SocialAlert[] {
    const newAlerts: SocialAlert[] = [];

    for (const [symbol, signals] of this.signals.entries()) {
      if (signals.length === 0) continue;

      // Volume spike detection
      const volumeSpike = this.detectVolumeSpike(symbol, signals);
      if (volumeSpike) {
        newAlerts.push(volumeSpike);
        this.emit('social:spike', volumeSpike);
      }

      // Sentiment flip detection
      const sentimentFlip = this.detectSentimentFlip(symbol, signals);
      if (sentimentFlip) {
        newAlerts.push(sentimentFlip);
        this.emit('social:flip', sentimentFlip);
      }

      // Influencer mention detection
      const influencerMentions = this.detectInfluencerMentions(symbol, signals);
      for (const alert of influencerMentions) {
        newAlerts.push(alert);
        this.emit('social:influencer', alert);
      }

      // Coordinated activity detection
      const coordinated = this.detectCoordinatedActivity(symbol, signals);
      if (coordinated) {
        newAlerts.push(coordinated);
        this.emit('social:coordinated', coordinated);
      }
    }

    // Keep alerts fresh (remove older than 24 hours)
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    this.alerts = this.alerts.filter((alert) => new Date(alert.detectedAt).getTime() > cutoff);

    // Add new alerts
    this.alerts.push(...newAlerts);

    return newAlerts;
  }

  /**
   * Get influencer activity for a symbol
   */
  public getInfluencerActivity(symbol: string): SocialSignal[] {
    const signals = this.signals.get(symbol);
    if (!signals) {
      return [];
    }

    return signals.filter(
      (signal) => signal.author.followers > 100000 && signal.author.credibilityScore > 0.7,
    );
  }

  /**
   * Reset all data
   */
  public reset(): void {
    this.signals.clear();
    this.alerts = [];
    this.lastVolumeCheckTime.clear();
  }

  // ===== Private methods =====

  private computeMetrics(symbol: string, signals: SocialSignal[]): SocialMetrics {
    const sentiments = signals.map((s) => s.sentiment);
    const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    const sentimentStdDev = this.calculateStdDev(sentiments, avgSentiment);

    // Calculate volume z-score
    const volumeZScore = this.calculateVolumeZScore(symbol, signals.length);

    // Platform breakdown
    const platformBreakdown: Record<string, { count: number; avgSentiment: number }> = {};
    for (const signal of signals) {
      if (!platformBreakdown[signal.platform]) {
        platformBreakdown[signal.platform] = { count: 0, avgSentiment: 0 };
      }
      platformBreakdown[signal.platform].count++;
      platformBreakdown[signal.platform].avgSentiment += signal.sentiment;
    }

    for (const platform in platformBreakdown) {
      platformBreakdown[platform].avgSentiment /= platformBreakdown[platform].count;
    }

    // Top influencers
    const topInfluencers = signals
      .filter((s) => s.author.followers > 100000)
      .sort((a, b) => b.author.followers - a.author.followers)
      .slice(0, 5)
      .map((s) => ({
        handle: s.author.handle,
        sentiment: s.sentiment,
        followers: s.author.followers,
      }));

    // Bull-bear ratio
    const bullish = signals.filter((s) => s.sentiment > 0.2).length;
    const bearish = signals.filter((s) => s.sentiment < -0.2).length;
    const bullBearRatio = bearish === 0 ? bullish : bullish / bearish;

    // Engagement score
    const engagementScore = this.calculateEngagementScore(signals);

    // Trending topics (extract from content)
    const trendingTopics = this.extractTrendingTopics(signals);

    return {
      symbol,
      mentionCount: signals.length,
      avgSentiment,
      sentimentStdDev,
      volumeZScore,
      isSpike: volumeZScore > this.config.spikeThreshold,
      topInfluencers,
      platformBreakdown,
      trendingTopics,
      bullBearRatio,
      engagementScore,
      lastUpdated: new Date().toISOString(),
    };
  }

  private detectVolumeSpike(symbol: string, signals: SocialSignal[]): SocialAlert | null {
    const zScore = this.calculateVolumeZScore(symbol, signals.length);

    if (zScore > this.config.spikeThreshold) {
      const severity = this.calculateAlertSeverity(zScore, 3, 4.5);
      return {
        type: 'volume_spike',
        symbol,
        severity,
        description: `Volume spike detected: ${signals.length} mentions in last ${this.config.volumeWindow}h (z-score: ${zScore.toFixed(2)})`,
        signals: signals.slice(-10),
        detectedAt: new Date().toISOString(),
      };
    }

    return null;
  }

  private detectSentimentFlip(symbol: string, signals: SocialSignal[]): SocialAlert | null {
    if (signals.length < 5) return null;

    // Use 30-min rolling average (approximate with last 5 signals)
    const recent = signals.slice(-5);
    const avgSentiment = recent.reduce((a, b) => a + b.sentiment, 0) / recent.length;
    const previous = signals.slice(-10, -5);
    if (previous.length < 5) return null;

    const prevAvgSentiment = previous.reduce((a, b) => a + b.sentiment, 0) / previous.length;

    // Detect flip (cross zero)
    if ((prevAvgSentiment > 0 && avgSentiment < 0) || (prevAvgSentiment < 0 && avgSentiment > 0)) {
      const severity = Math.abs(avgSentiment) > 0.5 ? 'high' : 'medium';
      return {
        type: 'sentiment_flip',
        symbol,
        severity,
        description: `Sentiment flip detected: ${prevAvgSentiment > 0 ? 'bullish' : 'bearish'} -> ${avgSentiment > 0 ? 'bullish' : 'bearish'}`,
        signals: recent,
        detectedAt: new Date().toISOString(),
      };
    }

    return null;
  }

  private detectInfluencerMentions(symbol: string, signals: SocialSignal[]): SocialAlert[] {
    const alerts: SocialAlert[] = [];
    const influencers = signals.filter(
      (s) => s.author.followers > 100000 && s.author.credibilityScore > 0.7,
    );

    for (const influencer of influencers) {
      const severity = influencer.author.followers > 1000000 ? 'high' : 'medium';
      alerts.push({
        type: 'influencer_mention',
        symbol,
        severity,
        description: `Influencer @${influencer.author.handle} (${influencer.author.followers.toLocaleString()} followers) mentioned ${symbol}`,
        signals: [influencer],
        detectedAt: new Date().toISOString(),
      });
    }

    return alerts;
  }

  private detectCoordinatedActivity(symbol: string, signals: SocialSignal[]): SocialAlert | null {
    // Look for >10 signals from different authors within 5 min with similar sentiment
    const recentWindow = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();

    const recent = signals.filter((s) => {
      const signalTime = new Date(s.timestamp).getTime();
      return now - signalTime < recentWindow;
    });

    if (recent.length < 10) {
      return null;
    }

    // Check sentiment similarity
    const sentiments = recent.map((s) => s.sentiment);
    const sentimentStdDev = this.calculateStdDev(sentiments, sentiments.reduce((a, b) => a + b, 0) / sentiments.length);

    // If standard deviation is low (<0.1), it's coordinated
    if (sentimentStdDev < 0.1) {
      const uniqueAuthors = new Set(recent.map((s) => s.author.handle)).size;
      if (uniqueAuthors >= 10) {
        const avgSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
        return {
          type: 'coordinated_activity',
          symbol,
          severity: 'critical',
          description: `Coordinated activity: ${recent.length} signals from ${uniqueAuthors} different authors in 5min with aligned sentiment (${(avgSentiment > 0 ? 'bullish' : 'bearish')})`,
          signals: recent,
          detectedAt: new Date().toISOString(),
        };
      }
    }

    return null;
  }

  private calculateStdDev(values: number[], mean: number): number {
    if (values.length === 0) return 0;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  private calculateVolumeZScore(symbol: string, currentVolume: number): number {
    const signals = this.signals.get(symbol);
    if (!signals || signals.length < 2) return 0;

    // Get historical volumes in chunks over volumeWindow
    const windowMs = this.config.volumeWindow * 60 * 60 * 1000;
    const now = Date.now();
    const volumes: number[] = [];

    for (const signal of signals) {
      const signalTime = new Date(signal.timestamp).getTime();
      if (now - signalTime < windowMs) {
        volumes.push(1);
      }
    }

    if (volumes.length < 2) return 0;

    const mean = volumes.reduce((a, b) => a + b, 0) / volumes.length;
    const stdDev = this.calculateStdDev(volumes, mean);

    if (stdDev === 0) return 0;
    return (currentVolume - mean) / stdDev;
  }

  private calculateEngagementScore(signals: SocialSignal[]): number {
    if (signals.length === 0) return 0;

    const totalEngagement = signals.reduce((sum, signal) => {
      return sum + signal.engagement.likes + signal.engagement.shares + signal.engagement.comments;
    }, 0);

    return totalEngagement / signals.length;
  }

  private extractTrendingTopics(signals: SocialSignal[]): string[] {
    const topics: Map<string, number> = new Map();

    for (const signal of signals) {
      // Simple extraction: look for hashtags
      const hashtags = signal.content.match(/#\w+/g) || [];
      for (const tag of hashtags) {
        topics.set(tag, (topics.get(tag) || 0) + 1);
      }
    }

    // Return top 5 by frequency
    return Array.from(topics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic);
  }

  private calculateMomentum(signals: SocialSignal[]): number {
    if (signals.length < 2) return 0;

    const recentHalf = signals.slice(-Math.ceil(signals.length / 2));
    const olderHalf = signals.slice(0, Math.floor(signals.length / 2));

    const recentAvg =
      recentHalf.reduce((sum, s) => sum + s.engagement.likes, 0) / recentHalf.length || 0;
    const olderAvg = olderHalf.reduce((sum, s) => sum + s.engagement.likes, 0) / olderHalf.length || 0;

    if (olderAvg === 0) return recentAvg > 0 ? 1 : 0;
    return recentAvg / olderAvg - 1;
  }

  private calculateAlertSeverity(
    value: number,
    mediumThreshold: number,
    highThreshold: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (value > highThreshold) return 'critical';
    if (value > mediumThreshold) return 'high';
    return 'medium';
  }
}
