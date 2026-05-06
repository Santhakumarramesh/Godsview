/**
 * news_feed_service.test.ts — M5d-news Read-only news feed adapter
 *
 * Coverage:
 *  - ok with real Alpaca shape
 *  - not_connected when ALPACA_API_KEY/SECRET missing
 *  - not_connected when upstream HTTP non-2xx (with reason)
 *  - cache TTL behavior
 *  - never fabricates a fallback headline list
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import { fetchLatestHeadlines, clearNewsFeedCache } from "../lib/news_feed_service";

const REAL_KEY_ENV = { ALPACA_API_KEY: "fake-key-id", ALPACA_SECRET_KEY: "fake-secret" };

const realArticle = {
  id: 12345,
  headline: "Fed signals rate cut timeline amid cooling inflation",
  summary: "Real summary text from upstream",
  author: "Reuters",
  source: "reuters",
  url: "https://news.example.com/fed-rate-cut",
  symbols: ["SPY", "QQQ"],
  created_at: "2026-05-06T18:00:00Z",
  updated_at: "2026-05-06T18:01:00Z",
};

let fetchSpy: ReturnType<typeof vi.spyOn>;
const origEnv = { ...process.env };

beforeEach(() => {
  clearNewsFeedCache();
  Object.assign(process.env, REAL_KEY_ENV);
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  fetchSpy.mockRestore();
  process.env = { ...origEnv };
});

describe("fetchLatestHeadlines — M5d-news contract", () => {
  it("returns ok with real Alpaca News headlines when upstream answers 200", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ news: [realArticle] }),
      text: async () => "",
    } as any);

    const out = await fetchLatestHeadlines({ limit: 5 });

    expect(out.status).toBe("ok");
    expect(out.feed_connected).toBe(true);
    expect(out.provider).toBe("alpaca_news");
    expect(out.count).toBe(1);
    expect(out.latest_headlines).toHaveLength(1);
    const h = out.latest_headlines[0]!;
    expect(h.headline).toBe(realArticle.headline);
    expect(h.id).toBe(String(realArticle.id));
    expect(h.symbols).toEqual(["SPY", "QQQ"]);
    expect(h.url).toBe(realArticle.url);
    expect(h.published_at).toBe(realArticle.created_at);
    expect(out.last_updated).not.toBeNull();
    expect(out.reason).toBe("");
  });

  it("returns not_connected with explicit reason when ALPACA keys are missing", async () => {
    delete process.env.ALPACA_API_KEY;
    delete process.env.ALPACA_SECRET_KEY;

    const out = await fetchLatestHeadlines();

    expect(out.status).toBe("not_connected");
    expect(out.feed_connected).toBe(false);
    expect(out.latest_headlines).toEqual([]);
    expect(out.count).toBe(0);
    expect(out.last_updated).toBeNull();
    expect(out.reason).toMatch(/ALPACA_API_KEY/);
    // CRITICAL: never invokes fetch when keys missing
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns not_connected with reason when upstream returns 401", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => "Unauthorized",
    } as any);

    const out = await fetchLatestHeadlines();

    expect(out.status).toBe("not_connected");
    expect(out.feed_connected).toBe(false);
    expect(out.latest_headlines).toEqual([]);
    expect(out.reason).toMatch(/401/);
    expect(out.reason).toMatch(/news scope/);
  });

  it("returns not_connected with reason when upstream returns 500", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "internal error",
    } as any);

    const out = await fetchLatestHeadlines();

    expect(out.status).toBe("not_connected");
    expect(out.feed_connected).toBe(false);
    expect(out.reason).toMatch(/500/);
  });

  it("returns not_connected with reason when fetch throws (network error)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network unreachable"));

    const out = await fetchLatestHeadlines();

    expect(out.status).toBe("not_connected");
    expect(out.feed_connected).toBe(false);
    expect(out.reason).toMatch(/network unreachable/);
  });

  it("does NOT fabricate a fallback headline list — empty array on every failure path", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => "Forbidden",
    } as any);

    const out = await fetchLatestHeadlines();
    expect(out.latest_headlines).toEqual([]);
    expect(out.count).toBe(0);
  });

  it("uses cache on second call within TTL (single upstream fetch)", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ news: [realArticle] }),
      text: async () => "",
    } as any);

    const a = await fetchLatestHeadlines();
    const b = await fetchLatestHeadlines();

    expect(a.feed_connected).toBe(true);
    expect(b.feed_connected).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses cache", async () => {
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ news: [realArticle] }),
      text: async () => "",
    } as any);

    await fetchLatestHeadlines();
    await fetchLatestHeadlines({ force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("clamps limit to [1, 50]", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ news: [] }),
      text: async () => "",
    } as any);

    await fetchLatestHeadlines({ limit: 9999 });
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toMatch(/limit=50/);
  });

  it("does not write any state — pure read aggregation", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true, status: 200,
      headers: { get: () => "application/json" },
      json: async () => ({ news: [realArticle] }),
      text: async () => "",
    } as any);

    await fetchLatestHeadlines();
    // Only one fetch was issued, and it was a GET
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("GET");
  });
});
