import { randomUUID } from "crypto";

export type FeedType = "realtime" | "delayed" | "historical" | "derived";
export type FeedStatus = "active" | "stale" | "degraded" | "offline";

export interface FeedSource {
  id: string; // prefix: "feed_"
  name: string;
  type: FeedType;
  status: FeedStatus;
  last_tick_at: string;
  tick_count: number;
  avg_latency_ms: number;
  max_latency_ms: number;
  staleness_threshold_ms: number;
  registered_at: string;
}

export type TickIssue =
  | "stale_tick"
  | "price_spike"
  | "zero_volume"
  | "negative_price"
  | "crossed_spread"
  | "duplicate_tick"
  | "out_of_sequence";

export interface TickValidation {
  id: string; // prefix: "tv_"
  feed_id: string;
  symbol: string;
  timestamp: string;
  price: number;
  volume: number;
  is_valid: boolean;
  issues: TickIssue[];
  latency_ms: number;
}

export interface CrossFeedCheck {
  id: string; // prefix: "xf_"
  symbol: string;
  feeds_compared: string[];
  timestamp: string;
  price_divergence_pct: number;
  max_acceptable_divergence_pct: number;
  passed: boolean;
  details: string;
}

export interface DecisionTimestampAudit {
  id: string; // prefix: "dta_"
  decision_id: string;
  strategy_id: string;
  data_timestamp: string;
  decision_timestamp: string;
  order_timestamp?: string;
  fill_timestamp?: string;
  data_age_ms: number;
  decision_latency_ms: number;
  total_pipeline_ms: number;
  acceptable: boolean;
  threshold_ms: number;
}

export interface FeedHealthReport {
  id: string; // prefix: "fhr_"
  generated_at: string;
  feeds: FeedSource[];
  healthy_count: number;
  stale_count: number;
  offline_count: number;
  total_ticks_validated: number;
  invalid_tick_count: number;
  cross_feed_failures: number;
  avg_pipeline_latency_ms: number;
  overall_health: "healthy" | "degraded" | "critical";
}

const DEFAULT_DECISION_THRESHOLD_MS = 5000;

class FeedValidator {
  private feeds = new Map<string, FeedSource>();
  private tickValidations = new Map<string, TickValidation>();
  private lastPriceBySymbol = new Map<string, number>();
  private crossFeedChecks = new Map<string, CrossFeedCheck>();
  private decisionAudits = new Map<string, DecisionTimestampAudit>();
  private feedHealthReports = new Map<string, FeedHealthReport>();
  private tickCountByFeed = new Map<string, number>();
  private latenciesByFeed = new Map<string, number[]>();
  private invalidTickCountByFeed = new Map<string, number>();

  registerFeed(
    config: Omit<
      FeedSource,
      "id" | "registered_at" | "tick_count" | "avg_latency_ms" | "max_latency_ms"
    >
  ): FeedSource {
    const id = `feed_${randomUUID()}`;
    const feed: FeedSource = {
      ...config,
      id,
      registered_at: new Date().toISOString(),
      tick_count: 0,
      avg_latency_ms: 0,
      max_latency_ms: 0,
    };
    this.feeds.set(id, feed);
    this.tickCountByFeed.set(id, 0);
    this.latenciesByFeed.set(id, []);
    this.invalidTickCountByFeed.set(id, 0);
    return feed;
  }

  updateFeedStatus(
    feed_id: string,
    status: FeedSource["status"]
  ): { success: boolean; error?: string } {
    const feed = this.feeds.get(feed_id);
    if (!feed) {
      return { success: false, error: `Feed ${feed_id} not found` };
    }
    feed.status = status;
    return { success: true };
  }

  recordTick(
    feed_id: string,
    symbol: string,
    price: number,
    volume: number,
    latency_ms: number
  ): TickValidation {
    const feed = this.feeds.get(feed_id);
    if (!feed) {
      throw new Error(`Feed ${feed_id} not found`);
    }

    const id = `tv_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const issues: TickIssue[] = [];
    let is_valid = true;

    // Validate stale tick
    if (latency_ms > feed.staleness_threshold_ms) {
      issues.push("stale_tick");
      is_valid = false;
    }

    // Validate price spike
    const lastPrice = this.lastPriceBySymbol.get(symbol);
    if (lastPrice !== undefined) {
      const priceDelta = Math.abs(price - lastPrice) / lastPrice;
      if (priceDelta > 0.1) {
        issues.push("price_spike");
      }
    }

    // Validate zero volume
    if (volume === 0) {
      issues.push("zero_volume");
      is_valid = false;
    }

    // Validate negative price
    if (price <= 0) {
      issues.push("negative_price");
      is_valid = false;
    }

    const validation: TickValidation = {
      id,
      feed_id,
      symbol,
      timestamp,
      price,
      volume,
      is_valid,
      issues,
      latency_ms,
    };

    this.tickValidations.set(id, validation);
    this.lastPriceBySymbol.set(symbol, price);

    // Update feed stats
    const currentTickCount = this.tickCountByFeed.get(feed_id) || 0;
    this.tickCountByFeed.set(feed_id, currentTickCount + 1);

    const latencies = this.latenciesByFeed.get(feed_id) || [];
    latencies.push(latency_ms);
    this.latenciesByFeed.set(feed_id, latencies);

    if (!is_valid) {
      const invalidCount = this.invalidTickCountByFeed.get(feed_id) || 0;
      this.invalidTickCountByFeed.set(feed_id, invalidCount + 1);
    }

    feed.tick_count = currentTickCount + 1;
    feed.last_tick_at = timestamp;
    feed.avg_latency_ms =
      latencies.reduce((a, b) => a + b, 0) / latencies.length;
    feed.max_latency_ms = Math.max(...latencies);

    return validation;
  }

  getFeed(id: string): FeedSource | undefined {
    return this.feeds.get(id);
  }

  getAllFeeds(): FeedSource[] {
    return Array.from(this.feeds.values());
  }

  getStaleFeedCount(): number {
    return Array.from(this.feeds.values()).filter(
      (f) => f.status === "stale"
    ).length;
  }

  crossValidateFeeds(
    symbol: string,
    prices: { feed_id: string; price: number }[],
    max_divergence_pct?: number
  ): CrossFeedCheck {
    const id = `xf_${randomUUID()}`;
    const timestamp = new Date().toISOString();
    const feed_ids = prices.map((p) => p.feed_id);
    const acceptable_divergence = max_divergence_pct || 2.0;

    const priceValues = prices.map((p) => p.price);
    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);
    const avgPrice = priceValues.reduce((a, b) => a + b, 0) / priceValues.length;

    const divergence_pct = ((maxPrice - minPrice) / avgPrice) * 100;
    const passed = divergence_pct <= acceptable_divergence;

    const check: CrossFeedCheck = {
      id,
      symbol,
      feeds_compared: feed_ids,
      timestamp,
      price_divergence_pct: parseFloat(divergence_pct.toFixed(4)),
      max_acceptable_divergence_pct: acceptable_divergence,
      passed,
      details: `Min: ${minPrice}, Max: ${maxPrice}, Avg: ${avgPrice.toFixed(2)}, Divergence: ${divergence_pct.toFixed(2)}%`,
    };

    this.crossFeedChecks.set(id, check);
    return check;
  }

  auditDecisionTimestamp(
    audit: Omit<
      DecisionTimestampAudit,
      | "id"
      | "data_age_ms"
      | "decision_latency_ms"
      | "total_pipeline_ms"
      | "acceptable"
    > & { threshold_ms?: number }
  ): DecisionTimestampAudit {
    const id = `dta_${randomUUID()}`;
    const threshold = audit.threshold_ms || DEFAULT_DECISION_THRESHOLD_MS;

    const dataTime = new Date(audit.data_timestamp).getTime();
    const decisionTime = new Date(audit.decision_timestamp).getTime();
    const data_age_ms = decisionTime - dataTime;
    const decision_latency_ms = audit.order_timestamp
      ? new Date(audit.order_timestamp).getTime() - decisionTime
      : 0;
    const total_pipeline_ms = audit.fill_timestamp
      ? new Date(audit.fill_timestamp).getTime() - dataTime
      : data_age_ms + decision_latency_ms;

    const acceptable = total_pipeline_ms < threshold;

    const result: DecisionTimestampAudit = {
      ...audit,
      id,
      data_age_ms,
      decision_latency_ms,
      total_pipeline_ms,
      acceptable,
      threshold_ms: threshold,
    };

    this.decisionAudits.set(id, result);
    return result;
  }

  getDecisionAudits(strategy_id?: string): DecisionTimestampAudit[] {
    const audits = Array.from(this.decisionAudits.values());
    if (strategy_id) {
      return audits.filter((a) => a.strategy_id === strategy_id);
    }
    return audits;
  }

  getStaleDecisions(max_age_ms?: number): DecisionTimestampAudit[] {
    const threshold = max_age_ms || DEFAULT_DECISION_THRESHOLD_MS;
    return Array.from(this.decisionAudits.values()).filter(
      (a) => a.total_pipeline_ms >= threshold
    );
  }

  generateFeedHealthReport(): FeedHealthReport {
    const id = `fhr_${randomUUID()}`;
    const generated_at = new Date().toISOString();
    const feeds = this.getAllFeeds();

    const healthy_count = feeds.filter((f) => f.status === "active").length;
    const stale_count = feeds.filter((f) => f.status === "stale").length;
    const offline_count = feeds.filter((f) => f.status === "offline").length;

    const total_ticks_validated = Array.from(this.tickCountByFeed.values()).reduce(
      (a, b) => a + b,
      0
    );
    const invalid_tick_count = Array.from(
      this.invalidTickCountByFeed.values()
    ).reduce((a, b) => a + b, 0);

    const cross_feed_failures = Array.from(this.crossFeedChecks.values()).filter(
      (c) => !c.passed
    ).length;

    const allLatencies = Array.from(this.latenciesByFeed.values()).flat();
    const avg_pipeline_latency_ms =
      allLatencies.length > 0
        ? parseFloat(
            (allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length).toFixed(2)
          )
        : 0;

    let overall_health: "healthy" | "degraded" | "critical";
    if (offline_count > 0 || invalid_tick_count > total_ticks_validated * 0.1) {
      overall_health = "critical";
    } else if (
      stale_count > 0 ||
      invalid_tick_count > 0 ||
      cross_feed_failures > 0
    ) {
      overall_health = "degraded";
    } else {
      overall_health = "healthy";
    }

    const report: FeedHealthReport = {
      id,
      generated_at,
      feeds,
      healthy_count,
      stale_count,
      offline_count,
      total_ticks_validated,
      invalid_tick_count,
      cross_feed_failures,
      avg_pipeline_latency_ms,
      overall_health,
    };

    this.feedHealthReports.set(id, report);
    return report;
  }

  getFeedHealthReport(id: string): FeedHealthReport | undefined {
    return this.feedHealthReports.get(id);
  }

  getAllFeedReports(limit?: number): FeedHealthReport[] {
    const reports = Array.from(this.feedHealthReports.values());
    if (limit) {
      return reports.slice(-limit);
    }
    return reports;
  }

  _clearFeedValidator(): void {
    this.feeds.clear();
    this.tickValidations.clear();
    this.lastPriceBySymbol.clear();
    this.crossFeedChecks.clear();
    this.decisionAudits.clear();
    this.feedHealthReports.clear();
    this.tickCountByFeed.clear();
    this.latenciesByFeed.clear();
    this.invalidTickCountByFeed.clear();
  }
}

export default new FeedValidator();
