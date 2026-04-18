/**
 * performance_route.test.ts — Phase 55
 *
 * Tests for GET /performance (routes/performance.ts).
 *
 * Dependencies mocked:
 *   @workspace/db       — db.select().from().where() chain
 *   @workspace/api-zod  — GetPerformanceQueryParams.parse
 *   ../lib/alpaca       — getTodayFills, computeRoundTrips, getPortfolioHistory
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const MOCK_TRADE = {
  id:          1,
  instrument:  "BTCUSD",
  setup_type:  "sweep_reclaim",
  direction:   "long",
  outcome:     "win",
  pnl:         "150.00",
  entry_price: "42000",
  exit_price:  "42150",
  session:     "london",
  regime:      "trending",
  mfe:         "200",
  mae:         "50",
  slippage:    "5",
  created_at:  new Date("2026-04-01T10:00:00Z"),
};

function makeDbChain(rows: unknown[] = [MOCK_TRADE]) {
  const chain: Record<string, unknown> = {};
  chain.select   = vi.fn().mockReturnValue(chain);
  chain.from     = vi.fn().mockReturnValue(chain);
  chain.where    = vi.fn().mockResolvedValue(rows);
  chain.$dynamic = vi.fn().mockReturnValue(chain);
  chain.orderBy  = vi.fn().mockReturnValue(chain);
  chain.limit    = vi.fn().mockResolvedValue(rows);
  return chain;
}

let dbChain = makeDbChain();

vi.mock("@workspace/db", () => {
  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "select") return (...args: any[]) => dbChain.select?.(...args);
      return undefined;
    },
  });
  return {
    // drizzle-orm re-exports (now provided by @workspace/db)
    and:       (...args: unknown[]) => args,
    or:        (...args: unknown[]) => args,
    eq:        () => null,
    ne:        () => null,
    gt:        () => null,
    gte:       () => null,
    lt:        () => null,
    lte:       () => null,
    isNotNull: () => null,
    isNull:    () => null,
    desc:      () => null,
    asc:       () => null,
    inArray:   () => null,
    notInArray:() => null,
    count:     () => 0,
    sum:       () => 0,
    max:       () => null,
    min:       () => null,
    between:   () => null,
    like:      () => null,
    ilike:     () => null,
    exists:    () => null,
    not:       () => null,
    sql:       Object.assign(() => "", { raw: (s: string) => s }) as unknown as never,

    db,
    tradesTable: {
      created_at:  "created_at",
      instrument:  "instrument",
      setup_type:  "setup_type",
      outcome:     "outcome",
      pnl:         "pnl",
      session:     "session",
      regime:      "regime",
      mfe:         "mfe",
      mae:         "mae",
      slippage:    "slippage",
    },
    signalsTable:  {},
  };
});

// ── Mock @workspace/api-zod ───────────────────────────────────────────────────

vi.mock("@workspace/api-zod", () => ({
  GetPerformanceQueryParams: {
    parse: vi.fn((q: Record<string, unknown>) => ({
      days:       Number(q.days ?? 30),
      instrument: q.instrument as string | undefined,
      setup_type: q.setup_type as string | undefined,
    })),
  },
}));

// ── Mock ../lib/alpaca ────────────────────────────────────────────────────────

vi.mock("../lib/alpaca", () => ({
  getTodayFills:      vi.fn(async () => []),
  computeRoundTrips:  vi.fn(() => ({
    trades: 0, wins: 0, losses: 0, avgWin: 0, avgLoss: 0, totalPnl: 0,
  })),
  getPortfolioHistory: vi.fn(async () => null),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import performanceRouter from "../routes/performance";

// ── Test server ───────────────────────────────────────────────────────────────

let baseUrl: string;
let server: http.Server;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    next();
  });
  app.use("/", performanceRouter);

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  const addr = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

function get(path: string): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const req = http.request(url, { method: "GET" }, (res) => {
      let raw = "";
      res.on("data", (c) => { raw += c; });
      res.on("end", () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /performance
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /performance", () => {
  it("returns 200 with valid trade data", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { status } = await get("/performance");
    expect(status).toBe(200);
  });

  it("response has total_trades field", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("total_trades");
    expect(typeof d.total_trades).toBe("number");
  });

  it("response has win_rate and profit_factor", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("win_rate");
    expect(d).toHaveProperty("profit_factor");
  });

  it("response has by_setup, by_session, by_regime arrays", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.by_setup)).toBe(true);
    expect(Array.isArray(d.by_session)).toBe(true);
    expect(Array.isArray(d.by_regime)).toBe(true);
  });

  it("response has equity_curve array", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.equity_curve)).toBe(true);
  });

  it("returns 200 with empty trades (zero stats)", async () => {
    dbChain = makeDbChain([]);
    const { status, data } = await get("/performance");
    expect(status).toBe(200);
    const d = data as Record<string, unknown>;
    expect(d.total_trades).toBe(0);
    expect(d.win_rate).toBe(0);
  });

  it("response has avg_win, avg_loss, expectancy", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("avg_win");
    expect(d).toHaveProperty("avg_loss");
    expect(d).toHaveProperty("expectancy");
  });

  it("response has max_drawdown field", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("max_drawdown");
  });

  it("accepts days query param", async () => {
    dbChain = makeDbChain([]);
    const { status } = await get("/performance?days=7");
    expect(status).toBe(200);
  });

  it("accepts instrument filter", async () => {
    dbChain = makeDbChain([]);
    const { status } = await get("/performance?instrument=BTCUSD");
    expect(status).toBe(200);
  });

  it("response has alpaca_source boolean", async () => {
    dbChain = makeDbChain([MOCK_TRADE]);
    const { data } = await get("/performance");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("alpaca_source");
    expect(typeof d.alpaca_source).toBe("boolean");
  });
});
