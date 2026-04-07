/**
 * Phase 104 — Sentiment & News Intelligence
 *
 * Three subsystems for market sentiment analysis:
 * 1. SentimentAggregator — multi-source sentiment fusion with time-decay
 * 2. NewsProcessor — NLP-style article scoring and enrichment
 * 3. SocialTracker — social media anomaly detection and tracking
 */

export { SentimentAggregator } from "./sentiment_aggregator.js";
export type { SentimentSignal, AggregatedSentiment, SentimentSnapshot, AggregatorConfig } from "./sentiment_aggregator.js";

export { NewsProcessor } from "./news_processor.js";
export type { NewsArticle, ProcessedArticle, NewsFeed, NewsProcessorConfig } from "./news_processor.js";

export { SocialTracker } from "./social_tracker.js";
export type { SocialSignal, SocialMetrics, SocialAlert, SocialSnapshot, SocialTrackerConfig } from "./social_tracker.js";
