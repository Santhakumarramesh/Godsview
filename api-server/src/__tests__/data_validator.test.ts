import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  feedValidator,
  type FeedSource,
  type TickValidation,
  type CrossFeedCheck,
  type DecisionTimestampAudit,
  type FeedHealthReport,
} from "../lib/data_validator";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({ default: vi.fn() }));

vi.mock("../../lib/risk_engine", () => ({
  evaluateRisk: vi.fn(),
}));

vi.mock("../../lib/drawdown_breaker", () => ({
  checkDrawdown: vi.fn(),
}));

describe("FeedValidator", () => {
  beforeEach(() => {
    feedValidator._clearFeedValidator();
  });

  describe("Feed Registration", () => {
    it("should register a new feed with semantic ID prefix", () => {
      const feed = feedValidator.registerFeed({
        name: "NYSE Real-time",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      expect(feed.id).toMatch(/^feed_/);
      expect(feed.name).toBe("NYSE Real-time");
      expect(feed.type).toBe("realtime");
      expect(feed.status).toBe("active");
      expect(feed.tick_count).toBe(0);
      expect(feed.avg_latency_ms).toBe(0);
      expect(feed.max_latency_ms).toBe(0);
      expect(feed.registered_at).toBeTruthy();
    });

    it("should register multiple feeds independently", () => {
      const feed1 = feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const feed2 = feedValidator.registerFeed({
        name: "Feed 2",
        type: "delayed",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 5000,
      });

      expect(feed1.id).not.toBe(feed2.id);
      expect(feedValidator.getAllFeeds().length).toBe(2);
    });
  });

  describe("Feed Retrieval", () => {
    it("should retrieve feed by ID", () => {
      const registered = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const retrieved = feedValidator.getFeed(registered.id);

      expect(retrieved).toEqual(registered);
    });

    it("should return undefined for non-existent feed", () => {
      const feed = feedValidator.getFeed("feed_nonexistent");
      expect(feed).toBeUndefined();
    });

    it("should retrieve all feeds", () => {
      feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.registerFeed({
        name: "Feed 2",
        type: "delayed",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 5000,
      });

      const allFeeds = feedValidator.getAllFeeds();

      expect(allFeeds.length).toBe(2);
      expect(allFeeds[0].name).toBe("Feed 1");
      expect(allFeeds[1].name).toBe("Feed 2");
    });
  });

  describe("Feed Status Update", () => {
    it("should update feed status successfully", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const result = feedValidator.updateFeedStatus(feed.id, "stale");

      expect(result.success).toBe(true);
      const updated = feedValidator.getFeed(feed.id);
      expect(updated?.status).toBe("stale");
    });

    it("should return error for non-existent feed", () => {
      const result = feedValidator.updateFeedStatus(
        "feed_nonexistent",
        "offline"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should update to degraded status", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const result = feedValidator.updateFeedStatus(feed.id, "degraded");

      expect(result.success).toBe(true);
      const updated = feedValidator.getFeed(feed.id);
      expect(updated?.status).toBe("degraded");
    });
  });

  describe("Tick Validation - Valid Ticks", () => {
    it("should record a valid tick", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        150.5,
        1000000,
        50
      );

      expect(validation.id).toMatch(/^tv_/);
      expect(validation.feed_id).toBe(feed.id);
      expect(validation.symbol).toBe("AAPL");
      expect(validation.price).toBe(150.5);
      expect(validation.volume).toBe(1000000);
      expect(validation.latency_ms).toBe(50);
      expect(validation.is_valid).toBe(true);
      expect(validation.issues).toHaveLength(0);
    });

    it("should increment feed tick count", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 150.5, 1000000, 50);
      feedValidator.recordTick(feed.id, "AAPL", 151.0, 1000000, 55);

      const updated = feedValidator.getFeed(feed.id);
      expect(updated?.tick_count).toBe(2);
    });

    it("should track last_tick_at timestamp", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const before = new Date().getTime();
      feedValidator.recordTick(feed.id, "AAPL", 150.5, 1000000, 50);
      const after = new Date().getTime();

      const updated = feedValidator.getFeed(feed.id);
      const tickTime = new Date(updated!.last_tick_at).getTime();

      expect(tickTime).toBeGreaterThanOrEqual(before);
      expect(tickTime).toBeLessThanOrEqual(after);
    });
  });

  describe("Tick Validation - Stale Tick", () => {
    it("should detect stale tick when latency exceeds threshold", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        150.5,
        1000000,
        1500
      );

      expect(validation.is_valid).toBe(false);
      expect(validation.issues).toContain("stale_tick");
    });

    it("should not flag tick as stale when latency within threshold", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        150.5,
        1000000,
        999
      );

      expect(validation.is_valid).toBe(true);
      expect(validation.issues).not.toContain("stale_tick");
    });
  });

  describe("Tick Validation - Price Spike", () => {
    it("should detect price spike greater than 10%", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 100, 1000000, 50);
      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        111.0,
        1000000,
        50
      );

      expect(validation.issues).toContain("price_spike");
    });

    it("should not flag normal price movement", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 100, 1000000, 50);
      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        108.0,
        1000000,
        50
      );

      expect(validation.issues).not.toContain("price_spike");
    });
  });

  describe("Tick Validation - Zero Volume", () => {
    it("should detect zero volume tick", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        150.5,
        0,
        50
      );

      expect(validation.is_valid).toBe(false);
      expect(validation.issues).toContain("zero_volume");
    });
  });

  describe("Tick Validation - Negative Price", () => {
    it("should detect negative price", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        -50,
        1000000,
        50
      );

      expect(validation.is_valid).toBe(false);
      expect(validation.issues).toContain("negative_price");
    });

    it("should detect zero price", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const validation = feedValidator.recordTick(
        feed.id,
        "AAPL",
        0,
        1000000,
        50
      );

      expect(validation.is_valid).toBe(false);
      expect(validation.issues).toContain("negative_price");
    });
  });

  describe("Tick Validation - Latency Tracking", () => {
    it("should calculate average latency across ticks", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 10000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 150, 1000000, 100);
      feedValidator.recordTick(feed.id, "AAPL", 150.5, 1000000, 200);
      feedValidator.recordTick(feed.id, "AAPL", 151, 1000000, 300);

      const updated = feedValidator.getFeed(feed.id);
      expect(updated?.avg_latency_ms).toBe(200);
    });

    it("should track maximum latency", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 10000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 150, 1000000, 100);
      feedValidator.recordTick(feed.id, "AAPL", 150.5, 1000000, 500);
      feedValidator.recordTick(feed.id, "AAPL", 151, 1000000, 300);

      const updated = feedValidator.getFeed(feed.id);
      expect(updated?.max_latency_ms).toBe(500);
    });
  });

  describe("Cross-Feed Validation - Pass", () => {
    it("should pass cross-feed validation when within divergence threshold", () => {
      const feed1 = feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const feed2 = feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const check = feedValidator.crossValidateFeeds(
        "AAPL",
        [
          { feed_id: feed1.id, price: 100 },
          { feed_id: feed2.id, price: 101 },
        ],
        2.0
      );

      expect(check.id).toMatch(/^xf_/);
      expect(check.symbol).toBe("AAPL");
      expect(check.feeds_compared).toContain(feed1.id);
      expect(check.feeds_compared).toContain(feed2.id);
      expect(check.passed).toBe(true);
      expect(check.price_divergence_pct).toBeLessThanOrEqual(2.0);
    });

    it("should calculate price divergence correctly", () => {
      const feed1 = feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const feed2 = feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const check = feedValidator.crossValidateFeeds(
        "AAPL",
        [
          { feed_id: feed1.id, price: 100 },
          { feed_id: feed2.id, price: 102 },
        ],
        5.0
      );

      expect(check.price_divergence_pct).toBeCloseTo(1.96, 1);
    });
  });

  describe("Cross-Feed Validation - Fail", () => {
    it("should fail cross-feed validation when divergence exceeds threshold", () => {
      const feed1 = feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const feed2 = feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const check = feedValidator.crossValidateFeeds(
        "AAPL",
        [
          { feed_id: feed1.id, price: 100 },
          { feed_id: feed2.id, price: 110 },
        ],
        2.0
      );

      expect(check.passed).toBe(false);
    });

    it("should include detailed divergence information", () => {
      const feed1 = feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const feed2 = feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const check = feedValidator.crossValidateFeeds(
        "AAPL",
        [
          { feed_id: feed1.id, price: 100 },
          { feed_id: feed2.id, price: 105 },
        ],
        2.0
      );

      expect(check.details).toContain("Min: 100");
      expect(check.details).toContain("Max: 105");
    });
  });

  describe("Decision Timestamp Auditing - Acceptable", () => {
    it("should mark decision as acceptable when within threshold", () => {
      const now = new Date();
      const dataTime = new Date(now.getTime() - 2000);
      const decisionTime = new Date(now.getTime() - 1000);

      const audit = feedValidator.auditDecisionTimestamp({
        decision_id: "dec_123",
        strategy_id: "strat_456",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
        threshold_ms: 5000,
      });

      expect(audit.id).toMatch(/^dta_/);
      expect(audit.data_age_ms).toBeLessThan(2100);
      expect(audit.acceptable).toBe(true);
    });

    it("should calculate data age correctly", () => {
      const now = new Date();
      const dataTime = new Date(now.getTime() - 1000);
      const decisionTime = now;

      const audit = feedValidator.auditDecisionTimestamp({
        decision_id: "dec_123",
        strategy_id: "strat_456",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
      });

      expect(audit.data_age_ms).toBeGreaterThanOrEqual(995);
      expect(audit.data_age_ms).toBeLessThanOrEqual(1005);
    });
  });

  describe("Decision Timestamp Auditing - Stale", () => {
    it("should mark decision as stale when exceeding threshold", () => {
      const now = new Date();
      const dataTime = new Date(now.getTime() - 10000);
      const decisionTime = now;

      const audit = feedValidator.auditDecisionTimestamp({
        decision_id: "dec_123",
        strategy_id: "strat_456",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
        threshold_ms: 5000,
      });

      expect(audit.acceptable).toBe(false);
    });

    it("should include order and fill timestamps in pipeline latency", () => {
      const now = new Date();
      const dataTime = new Date(now.getTime() - 1000);
      const decisionTime = new Date(now.getTime() - 800);
      const orderTime = new Date(now.getTime() - 500);
      const fillTime = now;

      const audit = feedValidator.auditDecisionTimestamp({
        decision_id: "dec_123",
        strategy_id: "strat_456",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
        order_timestamp: orderTime.toISOString(),
        fill_timestamp: fillTime.toISOString(),
      });

      expect(audit.total_pipeline_ms).toBeGreaterThanOrEqual(995);
      expect(audit.total_pipeline_ms).toBeLessThanOrEqual(1005);
    });
  });

  describe("Decision Audits Retrieval", () => {
    it("should retrieve all decision audits", () => {
      const now = new Date();
      const dataTime = new Date(now.getTime() - 1000);
      const decisionTime = now;

      feedValidator.auditDecisionTimestamp({
        decision_id: "dec_1",
        strategy_id: "strat_1",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
      });

      feedValidator.auditDecisionTimestamp({
        decision_id: "dec_2",
        strategy_id: "strat_2",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
      });

      const audits = feedValidator.getDecisionAudits();

      expect(audits.length).toBe(2);
    });

    it("should filter decision audits by strategy_id", () => {
      const now = new Date();
      const dataTime = new Date(now.getTime() - 1000);
      const decisionTime = now;

      feedValidator.auditDecisionTimestamp({
        decision_id: "dec_1",
        strategy_id: "strat_1",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
      });

      feedValidator.auditDecisionTimestamp({
        decision_id: "dec_2",
        strategy_id: "strat_2",
        data_timestamp: dataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
      });

      const audits = feedValidator.getDecisionAudits("strat_1");

      expect(audits.length).toBe(1);
      expect(audits[0].strategy_id).toBe("strat_1");
    });

    it("should retrieve stale decisions", () => {
      const now = new Date();
      const oldDataTime = new Date(now.getTime() - 10000);
      const freshDataTime = new Date(now.getTime() - 1000);
      const decisionTime = now;

      feedValidator.auditDecisionTimestamp({
        decision_id: "dec_1",
        strategy_id: "strat_1",
        data_timestamp: oldDataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
        threshold_ms: 5000,
      });

      feedValidator.auditDecisionTimestamp({
        decision_id: "dec_2",
        strategy_id: "strat_2",
        data_timestamp: freshDataTime.toISOString(),
        decision_timestamp: decisionTime.toISOString(),
        threshold_ms: 5000,
      });

      const stale = feedValidator.getStaleDecisions(5000);

      expect(stale.length).toBe(1);
      expect(stale[0].decision_id).toBe("dec_1");
    });
  });

  describe("Feed Health Report Generation", () => {
    it("should generate a feed health report with correct structure", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 150, 1000000, 50);

      const report = feedValidator.generateFeedHealthReport();

      expect(report.id).toMatch(/^fhr_/);
      expect(report.generated_at).toBeTruthy();
      expect(report.feeds.length).toBe(1);
      expect(report.healthy_count).toBe(1);
      expect(report.total_ticks_validated).toBe(1);
    });

    it("should calculate healthy feed count", () => {
      feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "stale",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const report = feedValidator.generateFeedHealthReport();

      expect(report.healthy_count).toBe(1);
      expect(report.stale_count).toBe(1);
    });

    it("should report offline feed count", () => {
      feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "offline",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const report = feedValidator.generateFeedHealthReport();

      expect(report.healthy_count).toBe(1);
      expect(report.offline_count).toBe(1);
    });

    it("should calculate overall health as healthy", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.recordTick(feed.id, "AAPL", 150, 1000000, 50);

      const report = feedValidator.generateFeedHealthReport();

      expect(report.overall_health).toBe("healthy");
    });

    it("should calculate overall health as degraded", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      // Record 11 valid ticks and 1 invalid tick (8.3% invalid < 10%)
      for (let i = 0; i < 11; i++) {
        feedValidator.recordTick(feed.id, "AAPL", 150 + i * 0.1, 1000000, 50);
      }
      feedValidator.recordTick(feed.id, "AAPL", 150.5, 0, 50);

      const report = feedValidator.generateFeedHealthReport();

      expect(report.overall_health).toBe("degraded");
      expect(report.invalid_tick_count).toBe(1);
    });

    it("should calculate overall health as critical", () => {
      const feed1 = feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "offline",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const report = feedValidator.generateFeedHealthReport();

      expect(report.overall_health).toBe("critical");
    });
  });

  describe("Feed Health Report Retrieval", () => {
    it("should retrieve a specific feed health report", () => {
      const feed = feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const generated = feedValidator.generateFeedHealthReport();
      const retrieved = feedValidator.getFeedHealthReport(generated.id);

      expect(retrieved).toEqual(generated);
    });

    it("should return undefined for non-existent report", () => {
      const report = feedValidator.getFeedHealthReport("fhr_nonexistent");
      expect(report).toBeUndefined();
    });

    it("should retrieve all feed reports with limit", () => {
      feedValidator.generateFeedHealthReport();
      feedValidator.generateFeedHealthReport();
      feedValidator.generateFeedHealthReport();

      const reports = feedValidator.getAllFeedReports(2);

      expect(reports.length).toBe(2);
    });

    it("should retrieve all feed reports without limit", () => {
      feedValidator.generateFeedHealthReport();
      feedValidator.generateFeedHealthReport();
      feedValidator.generateFeedHealthReport();

      const reports = feedValidator.getAllFeedReports();

      expect(reports.length).toBe(3);
    });
  });

  describe("Stale Feed Counting", () => {
    it("should count stale feeds correctly", () => {
      feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.registerFeed({
        name: "Feed 2",
        type: "realtime",
        status: "stale",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator.registerFeed({
        name: "Feed 3",
        type: "realtime",
        status: "stale",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const staleCount = feedValidator.getStaleFeedCount();

      expect(staleCount).toBe(2);
    });

    it("should return zero stale feeds when all active", () => {
      feedValidator.registerFeed({
        name: "Feed 1",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      const staleCount = feedValidator.getStaleFeedCount();

      expect(staleCount).toBe(0);
    });
  });

  describe("Empty State", () => {
    it("should return empty arrays on empty state", () => {
      expect(feedValidator.getAllFeeds()).toHaveLength(0);
      expect(feedValidator.getDecisionAudits()).toHaveLength(0);
      expect(feedValidator.getAllFeedReports()).toHaveLength(0);
      expect(feedValidator.getStaleFeedCount()).toBe(0);
    });

    it("should generate report on empty state", () => {
      const report = feedValidator.generateFeedHealthReport();

      expect(report.feeds).toHaveLength(0);
      expect(report.healthy_count).toBe(0);
      expect(report.overall_health).toBe("healthy");
    });
  });

  describe("Clear Function", () => {
    it("should clear all validator state", () => {
      feedValidator.registerFeed({
        name: "Test Feed",
        type: "realtime",
        status: "active",
        last_tick_at: new Date().toISOString(),
        staleness_threshold_ms: 1000,
      });

      feedValidator._clearFeedValidator();

      expect(feedValidator.getAllFeeds()).toHaveLength(0);
      expect(feedValidator.getDecisionAudits()).toHaveLength(0);
    });
  });
});
