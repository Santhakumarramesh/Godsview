/**
 * fred_calendar_client.test.ts — M5d-economic-calendar provider unit tests
 *
 * Coverage:
 *  - ok with real FRED Releases shape (allow-list filter, mapped MacroEvent)
 *  - not_connected when FRED_API_KEY missing (verifies fetch is NEVER invoked)
 *  - not_connected on upstream 4xx with reason
 *  - not_connected on upstream 5xx with reason
 *  - not_connected on network error
 *  - empty release_dates list -> ok with events=[]
 *  - never fabricates events on any failure path
 *  - releases NOT in allow-list are filtered out
 *  - cache TTL behavior + force=true bypass
 *  - GET-only assertion
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  fetchUpcomingEconomicEvents,
  clearCalendarCache,
  RELEASE_ALLOWLIST,
} from "../lib/providers/fred_calendar_client";

let fetchSpy: ReturnType<typeof vi.spyOn>;
const origEnv = { ...process.env };

beforeEach(() => {
  clearCalendarCache();
  process.env.FRED_API_KEY = "test-fred-key-32-char-aaaaaaaaaaaaa";
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => {
  fetchSpy.mockRestore();
  process.env = { ...origEnv };
});

const fakeReleaseDates = {
  release_dates: [
    { release_id: 10,   release_name: "Consumer Price Index",     date: "2026-05-13" },
    { release_id: 50,   release_name: "Employment Situation",     date: "2026-06-06" },
    { release_id: 999,  release_name: "Some Obscure Release",     date: "2026-05-10" },
    { release_id: 53,   release_name: "Gross Domestic Product",   date: "2026-07-30" },
    { release_id: 17,   release_name: "Industrial Production",    date: "2026-05-15" },
  ],
};

describe("fetchUpcomingEconomicEvents — M5d-economic-calendar contract", () => {
  it("returns ok with real events when FRED Releases responds 200", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fakeReleaseDates, text: async () => "" } as any);
    const out = await fetchUpcomingEconomicEvents({ now: Date.parse("2026-05-01T00:00:00Z") });
    expect(out.status).toBe("ok");
    expect(out.provider).toBe("fred_releases");
    expect(out.reason).toBe("");
    expect(out.last_updated).not.toBeNull();
    expect(out.events).toHaveLength(4);
    const cpi = out.events.find((e) => e.release_id === 10)!;
    expect(cpi.title).toBe("CPI");
    expect(cpi.impact).toBe("critical");
    expect(cpi.type).toBe("economic_calendar");
    expect(cpi.source).toBe("fred_releases");
    expect(cpi.sentiment).toBe(0);
    expect(cpi.related_symbols).toContain("SPY");
    expect(cpi.related_symbols).toContain("BTCUSD");
    expect(cpi.id).toBe("fred-release-10-2026-05-13");
    expect(cpi.timestamp).toMatch(/^2026-05-13T12:30:00\.000Z$/);
  });

  it("returns not_connected when FRED_API_KEY missing — and NEVER invokes fetch", async () => {
    delete process.env.FRED_API_KEY;
    const out = await fetchUpcomingEconomicEvents();
    expect(out.status).toBe("not_connected");
    expect(out.events).toEqual([]);
    expect(out.last_updated).toBeNull();
    expect(out.reason).toMatch(/FRED_API_KEY not set/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns not_connected on 401/403 with explicit reason", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 403, text: async () => "Forbidden" } as any);
    const out = await fetchUpcomingEconomicEvents();
    expect(out.status).toBe("not_connected");
    expect(out.events).toEqual([]);
    expect(out.reason).toMatch(/HTTP 403/);
  });

  it("returns not_connected on 500 with explicit reason", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "internal error" } as any);
    const out = await fetchUpcomingEconomicEvents();
    expect(out.status).toBe("not_connected");
    expect(out.reason).toMatch(/HTTP 500/);
  });

  it("returns not_connected on network error", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network unreachable"));
    const out = await fetchUpcomingEconomicEvents();
    expect(out.status).toBe("not_connected");
    expect(out.reason).toMatch(/network unreachable/);
  });

  it("returns ok with empty events array when FRED returns zero release_dates", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ release_dates: [] }), text: async () => "" } as any);
    const out = await fetchUpcomingEconomicEvents();
    expect(out.status).toBe("ok");
    expect(out.events).toEqual([]);
    expect(out.last_updated).not.toBeNull();
  });

  it("filters out releases NOT in RELEASE_ALLOWLIST (no fabrication)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ release_dates: [{ release_id: 9999, date: "2026-05-13" }] }), text: async () => "" } as any);
    const out = await fetchUpcomingEconomicEvents();
    expect(out.status).toBe("ok");
    expect(out.events).toEqual([]);
  });

  it("never fabricates events on any failure path", async () => {
    for (const fail of [
      () => fetchSpy.mockResolvedValueOnce({ ok: false, status: 404, text: async () => "" } as any),
      () => fetchSpy.mockResolvedValueOnce({ ok: false, status: 500, text: async () => "" } as any),
      () => fetchSpy.mockRejectedValueOnce(new Error("boom")),
    ]) {
      clearCalendarCache();
      fetchSpy.mockReset();
      fail();
      const out = await fetchUpcomingEconomicEvents();
      expect(out.events).toEqual([]);
      expect(out.status).toBe("not_connected");
    }
  });

  it("uses cache on second call within TTL (single upstream fetch)", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fakeReleaseDates, text: async () => "" } as any);
    await fetchUpcomingEconomicEvents();
    await fetchUpcomingEconomicEvents();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("force=true bypasses cache", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => fakeReleaseDates, text: async () => "" } as any);
    await fetchUpcomingEconomicEvents();
    await fetchUpcomingEconomicEvents({ force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("issues GET only", async () => {
    fetchSpy.mockResolvedValueOnce({ ok: true, status: 200, json: async () => fakeReleaseDates, text: async () => "" } as any);
    await fetchUpcomingEconomicEvents();
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("GET");
    const url = fetchSpy.mock.calls[0]![0] as string;
    expect(url).toContain("/fred/releases/dates");
  });

  it("RELEASE_ALLOWLIST includes the canonical impactful US releases", () => {
    const ids = RELEASE_ALLOWLIST.map((p) => p.releaseId);
    expect(ids).toContain(10); // CPI
    expect(ids).toContain(50); // NFP
    expect(ids).toContain(53); // GDP
    expect(ids).toContain(82); // PPI
    for (const p of RELEASE_ALLOWLIST) {
      expect(["low","medium","high","critical"]).toContain(p.impact);
      expect(p.relatedSymbols.length).toBeGreaterThan(0);
    }
  });
});
