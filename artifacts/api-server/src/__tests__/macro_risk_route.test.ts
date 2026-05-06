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
// M5d-cal: fred_calendar_client is now consumed by the aggregator. Mock it so
// these unit tests stay hermetic (no real FRED Releases calls).
vi.mock("../lib/providers/fred_calendar_client", () => ({
  fetchUpcomingEconomicEvents: vi.fn(),
  clearCalendarCache: vi.fn(),
  RELEASE_ALLOWLIST: [],
}));

import { buildMacroRiskAggregate, type MacroRiskResponse } from "../routes/macro_risk";
import { fetchFredMacroSnapshot } from "../lib/providers/fred_client.js";
import { getMacroContext } from "../lib/macro_engine";
import { fetchLatestHeadlines } from "../lib/news_feed_service";
import { fetchUpcomingEconomicEvents } from "../lib/providers/fred_calendar_client";

const calendarEmpty = {
  status: "not_connected" as const,
  events: [],
  provider: "fred_releases" as const,
  last_updated: null,
  reason: "FRED_API_KEY not set in environment.",
};

function makeCalEvent(overrides: Partial<{
  release_id: number; title: string; impact: "low"|"medium"|"high"|"critical";
  timestamp: string; release_date: string; related_symbols: string[];
}>) {
  return {
    id: `fred-release-${overrides.release_id ?? 10}-${overrides.release_date ?? "2026-05-13"}`,
    type: "economic_calendar" as const,
    release_id: overrides.release_id ?? 10,
    title: overrides.title ?? "CPI",
    timestamp: overrides.timestamp ?? "2026-05-13T12:30:00.000Z",
    release_date: overrides.release_date ?? "2026-05-13",
    impact: overrides.impact ?? "critical" as const,
    related_symbols: overrides.related_symbols ?? ["SPY","QQQ","BTCUSD"],
    source: "fred_releases" as const,
    sentiment: 0 as const,
  };
}

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
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);

    const out: MacroRiskResponse = await buildMacroRiskAggregate();

    expect(out.status).toBe("partial");  // FRED ok, events not_connected
    expect(out.fred.status).toBe("ok");
    expect(out.fred.value).not.toBeNull();
    expect(out.fred.value!.macro_risk).toBe("moderate");
    expect(out.events.status).toBe("not_connected");
    expect(out.events.provider).toBe("none");
    expect(out.events.high_impact_upcoming).toEqual([]);
    expect(out.events.next_event).toBeNull();
    expect(out.events.count_24h).toBe(0);
    expect(out.events.count_upcoming).toBe(0);
    expect(out.events.reason).toMatch(/FRED_API_KEY not set/i);
    expect(out.news_feed.feed_connected).toBe(false);
    expect(out.news_feed.latest_headlines).toEqual([]);
    // M5d-cal: news_window default-off when no real events
    expect(out.news_window.active).toBe(false);
    expect(out.news_window.reason).toBeNull();
    expect(out.news_window.affected_symbols).toEqual([]);
    expect(out.news_window.window_before_ms).toBe(30 * 60 * 1000);
    expect(out.news_window.window_after_ms).toBe(15 * 60 * 1000);
    expect(out.macro_risk.level).toBe("moderate");
    expect(out.macro_risk.source_quality).toBe("real");
    expect(out.macro_risk.drivers.length).toBeGreaterThan(0);
    expect(out.last_updated).toBe(realFred.fetched_at);
  });

  it("returns not_connected with no fabrication when FRED fails AND no events ingested", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockRejectedValueOnce(new Error("FRED_API_KEY missing"));
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);

    const out: MacroRiskResponse = await buildMacroRiskAggregate();

    expect(out.status).toBe("not_connected");
    expect(out.fred.status).toBe("not_connected");
    expect(out.fred.value).toBeNull();
    expect(out.fred.reason).toMatch(/FRED_API_KEY missing/);
    expect(out.events.status).toBe("not_connected");
    expect(out.events.provider).toBe("none");
    expect(out.macro_risk.level).toBeNull();
    expect(out.macro_risk.source_quality).toBe("not_connected");
    expect(out.last_updated).toBeNull();
  });

  it("M5d-news: surfaces real Alpaca headlines when feed adapter returns ok", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsOk);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);

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
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);

    const out = await buildMacroRiskAggregate();

    expect(out.news_feed.status).toBe("not_connected");
    expect(out.news_feed.feed_connected).toBe(false);
    expect(out.news_feed.latest_headlines).toEqual([]);
    expect(out.news_feed.count).toBe(0);
    expect(out.news_feed.reason).toMatch(/ALPACA_API_KEY/);
  });

  // ── M5d-economic-calendar contract tests ───────────────────────────────────

  it("M5d-cal: events.status=ok with real FRED calendar events when calendar provider returns events", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const cpi = makeCalEvent({ release_id: 10, title: "CPI", impact: "critical", timestamp: future });
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce({
      status: "ok", events: [cpi], provider: "fred_releases",
      last_updated: "2026-05-06T19:00:00Z", reason: "",
    });

    const out = await buildMacroRiskAggregate();

    expect(out.status).toBe("ok");  // FRED ok + events ok
    expect(out.events.status).toBe("ok");
    expect(out.events.provider).toBe("fred_releases");
    expect(out.events.next_event).toBeTruthy();
    expect((out.events.next_event as any)!.title).toBe("CPI");
    expect(out.events.high_impact_upcoming).toHaveLength(1);
    expect(out.events.count_upcoming).toBe(1);
    expect(out.events.last_updated).toBe("2026-05-06T19:00:00Z");
  });

  it("M5d-cal: provider='fred_releases+macro_engine' when both sources contribute", async () => {
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue({
      ...emptyMacroContext,
      events: [{ id: "manual-1", type: "fed", title: "Manual FOMC note", impact: "high",
                 sentiment: 0, related_symbols: ["SPY"], source: "manual", timestamp: future }] as any,
    });
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce({
      status: "ok", events: [makeCalEvent({ timestamp: future })],
      provider: "fred_releases", last_updated: "2026-05-06T19:00:00Z", reason: "",
    });

    const out = await buildMacroRiskAggregate();

    expect(out.events.status).toBe("ok");
    expect(out.events.provider).toBe("fred_releases+macro_engine");
    expect(out.events.count_upcoming).toBe(2);
  });

  it("M5d-cal: news_window.active=true when high/critical event is within window (-15m..+30m)", async () => {
    // Event 10 minutes in the future = inside window
    const tenMinFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const cpi = makeCalEvent({ timestamp: tenMinFromNow, related_symbols: ["SPY","BTCUSD"] });
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce({
      status: "ok", events: [cpi], provider: "fred_releases",
      last_updated: new Date().toISOString(), reason: "",
    });

    const out = await buildMacroRiskAggregate();

    expect(out.news_window.active).toBe(true);
    expect(out.news_window.reason).toMatch(/CPI/);
    expect(out.news_window.affected_symbols).toContain("SPY");
    expect(out.news_window.affected_symbols).toContain("BTCUSD");
  });

  it("M5d-cal: news_window.active=false when high/critical event is OUTSIDE the window (>30m away)", async () => {
    const farFuture = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 60min away
    const cpi = makeCalEvent({ timestamp: farFuture });
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce({
      status: "ok", events: [cpi], provider: "fred_releases",
      last_updated: new Date().toISOString(), reason: "",
    });

    const out = await buildMacroRiskAggregate();
    expect(out.news_window.active).toBe(false);
    expect(out.news_window.reason).toBeNull();
  });

  it("M5d-cal: news_window.active=false when only LOW/MEDIUM events are in window", async () => {
    const tenMinFromNow = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const ip = makeCalEvent({ timestamp: tenMinFromNow, impact: "medium", title: "Industrial Production" });
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce({
      status: "ok", events: [ip], provider: "fred_releases",
      last_updated: new Date().toISOString(), reason: "",
    });

    const out = await buildMacroRiskAggregate();
    expect(out.news_window.active).toBe(false);
  });

  it("M5d-cal: next_event picks the SOONEST upcoming event regardless of impact", async () => {
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const inTwoHours = new Date(Date.now() + 120 * 60 * 1000).toISOString();
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce({
      status: "ok",
      events: [
        makeCalEvent({ release_id: 53, title: "GDP", impact: "high", timestamp: inTwoHours }),
        makeCalEvent({ release_id: 17, title: "Industrial Production", impact: "medium", timestamp: inOneHour }),
      ],
      provider: "fred_releases", last_updated: new Date().toISOString(), reason: "",
    });

    const out = await buildMacroRiskAggregate();
    expect((out.events.next_event as any)!.title).toBe("Industrial Production");
  });

  it("M5d-cal: NEVER fabricates events when calendar provider returns not_connected and macro_engine empty", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);

    const out = await buildMacroRiskAggregate();
    expect(out.events.status).toBe("not_connected");
    expect(out.events.high_impact_upcoming).toEqual([]);
    expect(out.events.next_event).toBeNull();
    expect(out.events.count_upcoming).toBe(0);
    expect(out.events.provider).toBe("none");
    expect(out.events.reason).toMatch(/FRED_API_KEY/);
  });

  it("response shape always includes top-level keys regardless of upstream state", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);

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
    // M5d-cal: events always has the same shape + news_window has window bounds
    expect(out.events).toHaveProperty("provider");
    expect(out.events).toHaveProperty("count_upcoming");
    expect(out.events).toHaveProperty("next_event");
    expect(out.news_window).toHaveProperty("window_before_ms");
    expect(out.news_window).toHaveProperty("window_after_ms");
  });

  it("does NOT touch any execution / write path (pure read aggregation)", async () => {
    vi.mocked(fetchFredMacroSnapshot).mockResolvedValueOnce(realFred as any);
    vi.mocked(getMacroContext).mockReturnValue(emptyMacroContext);
    vi.mocked(fetchLatestHeadlines).mockResolvedValueOnce(newsNotConnected);
    vi.mocked(fetchUpcomingEconomicEvents).mockResolvedValueOnce(calendarEmpty);
    await buildMacroRiskAggregate();
    expect(vi.mocked(fetchFredMacroSnapshot)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchLatestHeadlines)).toHaveBeenCalledTimes(1);
    // M5d-cal: calendar adapter invoked exactly once per aggregator pass
    expect(vi.mocked(fetchUpcomingEconomicEvents)).toHaveBeenCalledTimes(1);
    // getMacroContext: events + news_window read
    expect(vi.mocked(getMacroContext)).toHaveBeenCalledTimes(2);
  });
});
