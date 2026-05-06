/**
 * macro_risk_route.test.ts — M5d-β unit shape test
 *
 * Asserts the aggregate response shape contract is honored regardless of
 * upstream availability. Mocks FRED and macro_engine to verify both
 * "real" and "not_connected" branches.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// Mocks must be hoisted BEFORE the import that consumes them.
vi.mock("../lib/providers/fred_client.js", () => ({
  fetchFredMacroSnapshot: vi.fn(),
}));
vi.mock("../lib/macro_engine", () => ({
  getMacroContext: vi.fn(),
}));
// M5d-news: news_feed_service is now consumed by the aggregator. Mock it so
// these unit tests stay hermetic (no real Alpaca News calls).
vi.mock("../lib/news_feed_service", () => ({
  fetchLatestHeadlines: vi.fn(),
  clearNewsFeedCache: vi.fn(),
}));

import { buildMacroRiskAggregate, type MacroRiskResponse } from "../routes/macro_risk";
import { fetchFredMacroSnapshot } from "../lib/providers/fred_client.js";
import { getMacroContext } from "../lib/macro_engine";
import { fetchLatestHeadlines } from "../lib/news_feed_service";

const newsNotConnected = {
  status: "not_connected" as const,
  feed_connected: false,
  latest_headlines: [],
  count: 0,
  provider: "alpaca_news" as const,
  last_updated: null,
  reason: "ALPACA_API_KEY / ALPACA_SECRET_KEY not set in environment.",
};

const newsOk = {
  status: "ok" as const,
  feed_connected: true,
  latest_headlines: [
    {
      id: "abc123",
      headline: "Fed signals rate cut timeline",
      summary: null, author: null, source: "reuters", url: null,
      symbols: ["SPY"], published_at: "2026-05-06T18:00:00Z",
      provider: "alpaca_news" as const,
    },
  ],
  count: 1,
  provider: "alpaca_news" as const,
  last_updated: "2026-05-06T18:05:00Z",
  reason: "",
};

const realFred = {
  cpi_yoy: 3.32, cpi_mom: 0.86, fed_funds_rate: 3.64, unemployment_rate: 4.3,
  treasury_10y: 4.45, treasury_2y: 3.95, yield_curve_spread: 0.5, gdp_growth: 2,
  initial_claims: 189000, vix: 17.38, macro_risk: "moderate" as const,
  fetched_at: "2026-05-06T18:04:25.530Z", quality: "full" as const,
  sources: { cpi: "FRED API (CPIAUCSL, 23 obs)" },
};

const emptyMacroContext = {
  events: [],
  overall_sentiment: 0,
  risk_level: "low" as const,
  lockout_active: false,
  lockout_reason: null,
  news_count_24h: 0,
  high_impact_upcoming: [],
  generated_at: "2026-05-06T18:04:24.868Z",
};

describe("buildMacroRiskAggregate — M5d-β contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns ok with real FRED + honest not_connected events when only FRED is available", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);

    const out: MacroRiskResponse = await buildMacroRiskAggregate();

    expect(out.status).toBe("partial");  // FRED ok, events not_connected
    expect(out.fred.status).toBe("ok");
    expect(out.fred.value).not.toBeNull();
    expect(out.fred.value!.macro_risk).toBe("moderate");
    expect(out.events.status).toBe("not_connected");
    expect(out.events.high_impact_upcoming).toEqual([]);
    expect(out.events.reason).toMatch(/no event provider configured/i);
    expect(out.news_feed.feed_connected).toBe(false);
    expect(out.news_feed.latest_headlines).toEqual([]);
    expect(out.macro_risk.level).toBe("moderate");
    expect(out.macro_risk.source_quality).toBe("real");
    expect(out.macro_risk.drivers.length).toBeGreaterThan(0);
    expect(out.last_updated).toBe(realFred.fetched_at);
  });

  it("returns not_connected with no fabrication when FRED fails AND no events ingested", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockRejectedValueOnce(new Error("FRED_API_KEY missing"));
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);

    const out: MacroRiskResponse = await buildMacroRiskAggregate();

    expect(out.status).toBe("not_connected");
    expect(out.fred.status).toBe("not_connected");
    expect(out.fred.value).toBeNull();
    expect(out.fred.reason).toMatch(/FRED_API_KEY missing/);
    expect(out.events.status).toBe("not_connected");
    expect(out.macro_risk.level).toBeNull();
    expect(out.macro_risk.source_quality).toBe("not_connected");
    expect(out.last_updated).toBeNull();
  });

  it("M5d-news: surfaces real Alpaca headlines when feed adapter returns ok", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsOk);

    const out = await buildMacroRiskAggregate();

    expect(out.news_feed.status).toBe("ok");
    expect(out.news_feed.feed_connected).toBe(true);
    expect(out.news_feed.provider).toBe("alpaca_news");
    expect(out.news_feed.latest_headlines).toHaveLength(1);
    expect(out.news_feed.latest_headlines[0]!.headline).toBe("Fed signals rate cut timeline");
    expect(out.news_feed.count).toBe(1);
    expect(out.news_feed.last_updated).toBe("2026-05-06T18:05:00Z");
    expect(out.news_feed.reason).toBe("");
  });

  it("M5d-news: surfaces honest not_connected (with reason) when feed adapter returns not_connected", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);

    const out = await buildMacroRiskAggregate();

    expect(out.news_feed.status).toBe("not_connected");
    expect(out.news_feed.feed_connected).toBe(false);
    expect(out.news_feed.latest_headlines).toEqual([]);
    expect(out.news_feed.count).toBe(0);
    expect(out.news_feed.reason).toMatch(/ALPACA_API_KEY/);
  });

  it("response shape always includes top-level keys regardless of upstream state", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);

    const out = await buildMacroRiskAggregate();

    // Stable contract: every section present
    expect(out).toHaveProperty("status");
    expect(out).toHaveProperty("generated_at");
    expect(out).toHaveProperty("macro_risk");
    expect(out).toHaveProperty("fred");
    expect(out).toHaveProperty("events");
    expect(out).toHaveProperty("news_window");
    expect(out).toHaveProperty("news_feed");
    expect(out).toHaveProperty("last_updated");
    // Macro risk always has the discriminator fields
    expect(out.macro_risk).toHaveProperty("level");
    expect(out.macro_risk).toHaveProperty("drivers");
    expect(out.macro_risk).toHaveProperty("source_quality");
    // M5d-news: news_feed always has the same shape
    expect(out.news_feed).toHaveProperty("provider");
    expect(out.news_feed).toHaveProperty("latest_headlines");
    expect(out.news_feed).toHaveProperty("count");
  });

  it("does NOT touch any execution / write path (pure read aggregation)", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    await buildMacroRiskAggregate();
    expect(vi.mocked(fetchFredMacroSnapshot)).toHaveBeenCalledTimes(1);
    // M5d-news: news adapter is invoked exactly once per aggregator pass
    expect(vi.mocked(fetchLatestHeadlines)).toHaveBeenCalledTimes(1);
    // getMacroContext: events + news_window
    expect(vi.mocked(getMacroContext)).toHaveBeenCalledTimes(2);
  });
});
