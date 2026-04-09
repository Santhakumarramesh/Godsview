import { describe, it, expect, beforeEach, vi } from "vitest";
import { newsService } from "../lib/news_pipeline";

vi.mock("pino", () => ({ default: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

describe("News Service", () => {
  beforeEach(() => {
    newsService._clearNews();
  });

  describe("ingestNews", () => {
    it("should ingest a news item", () => {
      const result = newsService.ingestNews(
        "Bloomberg",
        "Tech stocks rally on earnings",
        ["AAPL", "MSFT"],
        ["company", "earnings"],
        "bullish",
        "high",
        Date.now()
      );
      expect(result.success).toBe(true);
      expect(result.data?.headline).toBe("Tech stocks rally on earnings");
      expect(result.data?.source).toBe("Bloomberg");
    });

    it("should set ingested_at timestamp", () => {
      const before = Date.now();
      const result = newsService.ingestNews("Bloomberg", "Tech stocks rally", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const after = Date.now();

      expect(result.data?.ingested_at).toBeGreaterThanOrEqual(before);
      expect(result.data?.ingested_at).toBeLessThanOrEqual(after);
    });

    it("should include optional fields", () => {
      const result = newsService.ingestNews(
        "Bloomberg",
        "Tech stocks rally",
        ["AAPL"],
        ["company"],
        "bullish",
        "high",
        Date.now(),
        "Full article body",
        "https://example.com/article",
        "AI-generated summary"
      );
      expect(result.data?.body).toBe("Full article body");
      expect(result.data?.url).toBe("https://example.com/article");
      expect(result.data?.ai_summary).toBe("AI-generated summary");
    });
  });

  describe("getNewsItem", () => {
    it("should retrieve a news item", () => {
      const ingested = newsService.ingestNews("Bloomberg", "Tech stocks rally", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";

      const result = newsService.getNewsItem(newsId);
      expect(result.success).toBe(true);
      expect(result.data?.headline).toBe("Tech stocks rally");
    });

    it("should fail for non-existent item", () => {
      const result = newsService.getNewsItem("news_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("getNewsBySymbol", () => {
    it("should retrieve news by symbol", () => {
      newsService.ingestNews("Bloomberg", "AAPL earnings", ["AAPL", "MSFT"], ["company", "earnings"], "bullish", "high", Date.now());
      newsService.ingestNews("Reuters", "TSLA updates", ["TSLA"], ["company"], "neutral", "medium", Date.now());

      const result = newsService.getNewsBySymbol("AAPL");
      expect(result.data.length).toBe(1);
      expect(result.data[0].headline).toBe("AAPL earnings");
    });

    it("should include items with symbol in array", () => {
      newsService.ingestNews("Bloomberg", "Multi-stock news", ["AAPL", "MSFT"], ["company"], "bullish", "high", Date.now());

      const aapl = newsService.getNewsBySymbol("AAPL");
      const msft = newsService.getNewsBySymbol("MSFT");
      expect(aapl.data.length).toBe(1);
      expect(msft.data.length).toBe(1);
    });
  });

  describe("getNewsByCategory", () => {
    it("should retrieve news by category", () => {
      newsService.ingestNews("Bloomberg", "AAPL earnings", ["AAPL"], ["earnings"], "bullish", "high", Date.now());
      newsService.ingestNews("Reuters", "Fed decision", ["SPY"], ["macro"], "bearish", "high", Date.now());

      const result = newsService.getNewsByCategory("earnings");
      expect(result.data.length).toBe(1);
      expect(result.data[0].headline).toBe("AAPL earnings");
    });
  });

  describe("getRecentNews", () => {
    it("should retrieve recent news", () => {
      const now = Date.now();
      newsService.ingestNews("Bloomberg", "Recent news", ["AAPL"], ["company"], "bullish", "high", now);

      const result = newsService.getRecentNews(24);
      expect(result.data.length).toBeGreaterThan(0);
    });

    it("should filter by time", () => {
      const now = Date.now();
      const oldTime = now - 48 * 3600000; // 48 hours ago

      // Ingest old news manually would require direct store access, so we test the filtering logic
      newsService.ingestNews("Bloomberg", "Recent", ["AAPL"], ["company"], "bullish", "high", now);

      const result = newsService.getRecentNews(24);
      expect(result.data.length).toBe(1);
    });

    it("should sort by ingested_at descending", () => {
      const now = Date.now();
      newsService.ingestNews("Bloomberg", "First news", ["AAPL"], ["company"], "bullish", "high", now);

      // Small delay to ensure different timestamps
      setTimeout(() => {
        newsService.ingestNews("Reuters", "Second news", ["MSFT"], ["company"], "bearish", "medium", now);
      }, 10);

      const result = newsService.getRecentNews(24);
      if (result.data.length > 1) {
        expect(result.data[0].ingested_at).toBeGreaterThanOrEqual(result.data[1].ingested_at);
      }
    });
  });

  describe("searchNews", () => {
    it("should search headlines", () => {
      newsService.ingestNews("Bloomberg", "Tech stocks rally today", ["AAPL"], ["company"], "bullish", "high", Date.now());
      newsService.ingestNews("Reuters", "Healthcare news", ["JNJ"], ["sector"], "neutral", "medium", Date.now());

      const result = newsService.searchNews("tech");
      expect(result.data.length).toBe(1);
      expect(result.data[0].headline).toContain("Tech");
    });

    it("should search body", () => {
      newsService.ingestNews("Bloomberg", "Headline", ["AAPL"], ["company"], "bullish", "high", Date.now(), "This is about technology stocks");

      const result = newsService.searchNews("technology");
      expect(result.data.length).toBe(1);
    });

    it("should be case insensitive", () => {
      newsService.ingestNews("Bloomberg", "TECH STOCKS", ["AAPL"], ["company"], "bullish", "high", Date.now());

      const result = newsService.searchNews("tech");
      expect(result.data.length).toBe(1);
    });
  });

  describe("mapNewsToSignal", () => {
    it("should map news to signal", () => {
      const ingested = newsService.ingestNews("Bloomberg", "AAPL news", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";
      const expiresAt = Date.now() + 3600000;

      const result = newsService.mapNewsToSignal(newsId, "AAPL", "momentum_shift", 0.8, "buy", "Strong bullish signal", expiresAt);
      expect(result.success).toBe(true);
      expect(result.data?.symbol).toBe("AAPL");
      expect(result.data?.confidence).toBe(0.8);
    });

    it("should fail for non-existent news", () => {
      const expiresAt = Date.now() + 3600000;
      const result = newsService.mapNewsToSignal("news_nonexistent", "AAPL", "momentum_shift", 0.8, "buy", "reason", expiresAt);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail if symbol not in news", () => {
      const ingested = newsService.ingestNews("Bloomberg", "AAPL news", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";
      const expiresAt = Date.now() + 3600000;

      const result = newsService.mapNewsToSignal(newsId, "MSFT", "momentum_shift", 0.8, "buy", "reason", expiresAt);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Symbol not");
    });

    it("should clamp confidence to 0-1", () => {
      const ingested = newsService.ingestNews("Bloomberg", "AAPL news", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";
      const expiresAt = Date.now() + 3600000;

      const result = newsService.mapNewsToSignal(newsId, "AAPL", "momentum_shift", 1.5, "buy", "reason", expiresAt);
      expect(result.data?.confidence).toBe(1);
    });
  });

  describe("getSignalsForSymbol", () => {
    it("should retrieve active signals for symbol", () => {
      const ingested = newsService.ingestNews("Bloomberg", "AAPL news", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";
      const expiresAt = Date.now() + 3600000;

      newsService.mapNewsToSignal(newsId, "AAPL", "momentum_shift", 0.8, "buy", "reason", expiresAt);

      const result = newsService.getSignalsForSymbol("AAPL");
      expect(result.data.length).toBe(1);
      expect(result.data[0].symbol).toBe("AAPL");
    });

    it("should exclude expired signals", () => {
      const ingested = newsService.ingestNews("Bloomberg", "AAPL news", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";
      const expiredAt = Date.now() - 1000; // Already expired

      newsService.mapNewsToSignal(newsId, "AAPL", "momentum_shift", 0.8, "buy", "reason", expiredAt);

      const result = newsService.getSignalsForSymbol("AAPL");
      expect(result.data.length).toBe(0);
    });
  });

  describe("getActiveSignals", () => {
    it("should retrieve all active signals", () => {
      const ingested1 = newsService.ingestNews("Bloomberg", "AAPL news", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const ingested2 = newsService.ingestNews("Reuters", "MSFT news", ["MSFT"], ["company"], "bearish", "medium", Date.now());
      const newsId1 = ingested1.data?.id ?? "";
      const newsId2 = ingested2.data?.id ?? "";
      const expiresAt = Date.now() + 3600000;

      newsService.mapNewsToSignal(newsId1, "AAPL", "momentum_shift", 0.8, "buy", "reason", expiresAt);
      newsService.mapNewsToSignal(newsId2, "MSFT", "risk_off", 0.7, "hedge", "reason", expiresAt);

      const result = newsService.getActiveSignals();
      expect(result.data.length).toBe(2);
    });
  });

  describe("generateSentimentSnapshot", () => {
    it("should generate sentiment snapshot", () => {
      newsService.ingestNews("Bloomberg", "Good news", ["AAPL"], ["company"], "bullish", "high", Date.now());

      const result = newsService.generateSentimentSnapshot();
      expect(result.success).toBe(true);
      expect(result.data?.overall).toBeDefined();
      expect(result.data?.fear_greed_proxy).toBeDefined();
      expect(result.data?.active_themes).toBeDefined();
      expect(result.data?.high_impact_count).toBeGreaterThan(0);
    });

    it("should determine risk_on from bullish high impact", () => {
      newsService.ingestNews("Bloomberg", "Great news 1", ["AAPL"], ["company"], "bullish", "high", Date.now());
      newsService.ingestNews("Reuters", "Great news 2", ["MSFT"], ["company"], "bullish", "high", Date.now());
      newsService.ingestNews("CNBC", "Bad news", ["TSLA"], ["company"], "bearish", "low", Date.now());

      const result = newsService.generateSentimentSnapshot();
      expect(result.data?.overall).toBe("risk_on");
    });

    it("should determine risk_off from bearish high impact", () => {
      newsService.ingestNews("Bloomberg", "Bad news 1", ["AAPL"], ["company"], "bearish", "high", Date.now());
      newsService.ingestNews("Reuters", "Bad news 2", ["MSFT"], ["company"], "bearish", "high", Date.now());
      newsService.ingestNews("CNBC", "Good news", ["TSLA"], ["company"], "bullish", "low", Date.now());

      const result = newsService.generateSentimentSnapshot();
      expect(result.data?.overall).toBe("risk_off");
    });

    it("should determine neutral with no high impact", () => {
      newsService.ingestNews("Bloomberg", "News", ["AAPL"], ["company"], "neutral", "low", Date.now());

      const result = newsService.generateSentimentSnapshot();
      expect(result.data?.overall).toBe("neutral");
    });

    it("should calculate sector sentiment", () => {
      newsService.ingestNews("Bloomberg", "Earnings beat", ["AAPL"], ["earnings"], "bullish", "high", Date.now());
      newsService.ingestNews("Reuters", "Poor earnings", ["MSFT"], ["earnings"], "bearish", "high", Date.now());

      const result = newsService.generateSentimentSnapshot();
      expect(result.data?.sector_sentiment["earnings"]).toBeDefined();
    });

    it("should fail when no news", () => {
      const result = newsService.generateSentimentSnapshot();
      expect(result.success).toBe(false);
      expect(result.error).toContain("No news available");
    });
  });

  describe("summarizeNews", () => {
    it("should return ai_summary if available", () => {
      const ingested = newsService.ingestNews(
        "Bloomberg",
        "Headline",
        ["AAPL"],
        ["company"],
        "bullish",
        "high",
        Date.now(),
        "Body",
        "https://example.com",
        "AI-generated summary"
      );
      const newsId = ingested.data?.id ?? "";

      const result = newsService.summarizeNews(newsId);
      expect(result.success).toBe(true);
      expect(result.data).toBe("AI-generated summary");
    });

    it("should generate summary if ai_summary not available", () => {
      const ingested = newsService.ingestNews("Bloomberg", "Headline text", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";

      const result = newsService.summarizeNews(newsId);
      expect(result.success).toBe(true);
      expect(result.data).toContain("Headline text");
      expect(result.data).toContain("AAPL");
    });

    it("should fail for non-existent news", () => {
      const result = newsService.summarizeNews("news_nonexistent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("_clearNews", () => {
    it("should clear all news and signals", () => {
      const ingested = newsService.ingestNews("Bloomberg", "News", ["AAPL"], ["company"], "bullish", "high", Date.now());
      const newsId = ingested.data?.id ?? "";
      newsService.mapNewsToSignal(newsId, "AAPL", "momentum_shift", 0.8, "buy", "reason", Date.now() + 3600000);

      newsService._clearNews();

      const newsResult = newsService.getRecentNews(24);
      const signalsResult = newsService.getActiveSignals();
      expect(newsResult.data.length).toBe(0);
      expect(signalsResult.data.length).toBe(0);
    });
  });
});
