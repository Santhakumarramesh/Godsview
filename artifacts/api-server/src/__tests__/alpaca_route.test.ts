/**
 * alpaca_route.test.ts — Phase 58
 *
 * Tests for the Alpaca REST endpoints (routes/alpaca.ts):
 *
 *   GET  /alpaca/candles            — OHLCV bars
 *   GET  /alpaca/stream-status      — stream manager status (REST)
 *   GET  /alpaca/ticker             — live multi-symbol prices
 *   GET  /alpaca/account            — Alpaca account summary
 *   GET  /alpaca/positions          — open positions list
 *   POST /alpaca/orders             — place order (requires trading keys)
 *   GET  /alpaca/risk/status        — live risk-rail snapshot
 *   GET  /alpaca/orders             — list orders
 *   DELETE /alpaca/orders/:id       — cancel order (write-blocked)
 *   DELETE /alpaca/orders           — cancel all orders (write-blocked)
 *   GET  /alpaca/positions/live     — typed live positions
 *   DELETE /alpaca/positions/:symbol — close position (write-blocked)
 *   GET  /alpaca/size               — position-size calculator
 *   GET  /alpaca/bars               — raw bars
 *   GET  /alpaca/accuracy           — accuracy statistics
 *   GET  /system/diagnostics        — system health layers
 *
 * NOTE: GET /alpaca/stream (SSE) and the heavy POST endpoints
 * (analyze, backtest, backtest-batch, recall-build) are excluded.
 *
 * Dependencies mocked:
 *   ../lib/alpaca          — getBars, getBarsHistorical, getLatestBar,
 *                            getLatestTrade, getAccount, getPositions,
 *                            hasValidTradingKey, isBrokerKey, placeOrder,
 *                            getOrders, cancelOrder, cancelAllOrders,
 *                            closePosition, getTypedPositions,
 *                            calcPositionSize, getTodayFills, computeRoundTrips
 *   ../lib/alpaca_stream   — alpacaStream
 *   ../lib/market/symbols  — isCryptoSymbol
 *   ../lib/risk_engine     — getCurrentTradingSession, getRiskEngineSnapshot,
 *                            isKillSwitchActive, isSessionAllowed
 *   ../lib/strategy_engine — buildRecallFeatures, detectRegime, …
 *   ../lib/ml_model        — getModelStatus, predictWinProbability
 *   ../lib/claude          — claudeVeto, isClaudeAvailable
 *   @workspace/db          — db, tables
 *   @workspace/strategy-core — resolveSystemMode, canWriteOrders, …
 *   drizzle-orm            — no-op operators
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import http from "http";

// ── Mock data ─────────────────────────────────────────────────────────────────

const MOCK_BARS = Array.from({ length: 50 }, (_, i) => ({
  Open:      42000 + i,
  High:      42100 + i,
  Low:       41900 + i,
  Close:     42050 + i,
  Volume:    1000 + i,
  VWAP:      42025 + i,
  Timestamp: new Date(Date.now() - (50 - i) * 60_000).toISOString(),
}));

const MOCK_ACCOUNT = {
  status:             "ACTIVE",
  crypto_status:      "ACTIVE",
  currency:           "USD",
  buying_power:       "25000",
  cash:               "10000",
  portfolio_value:    "50000",
  equity:             "50000",
  trading_blocked:    false,
  account_blocked:    false,
  shorting_enabled:   true,
  options_trading_level: 0,
  account_number:     "PA1234567890",
};

const MOCK_POSITIONS = [
  {
    symbol:       "BTCUSD",
    qty:          "0.5",
    market_value: "21000",
    unrealized_pl:"1000",
    side:         "long",
  },
];

const MOCK_ORDER = {
  id:     "order-abc-123",
  symbol: "BTCUSD",
  side:   "buy",
  type:   "market",
  status: "accepted",
  qty:    "0.1",
};

const MOCK_ORDERS = [MOCK_ORDER];

const MOCK_RISK_SNAPSHOT = {
  config: {
    maxDailyLossUsd:       500,
    maxOpenExposurePct:    0.5,
    maxConcurrentPositions: 5,
    maxTradesPerSession:   20,
    cooldownAfterLosses:   3,
    cooldownMinutes:       60,
    newsLockoutActive:     false,
    blockOnDegradedData:   false,
  },
};

const MOCK_FILL_ACTIVITIES: unknown[] = [];

// ── DB mock ───────────────────────────────────────────────────────────────────

function makeDbChain(rows: unknown[] = [{ count: 0 }]) {
  const chain: any = {};
  chain.select    = vi.fn().mockReturnValue(chain);
  chain.from      = vi.fn().mockReturnValue(chain);
  chain.where     = vi.fn().mockReturnValue(chain);
  chain.orderBy   = vi.fn().mockReturnValue(chain);
  chain.limit     = vi.fn().mockResolvedValue(rows);
  chain.then      = (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve);
  chain.insert    = vi.fn().mockReturnValue(chain);
  chain.values    = vi.fn().mockReturnValue(chain);
  chain.returning = vi.fn().mockResolvedValue(rows);
  chain.update    = vi.fn().mockReturnValue(chain);
  chain.set       = vi.fn().mockReturnValue(chain);
  return chain;
}

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("drizzle-orm", () => ({
  and:       vi.fn((...args: unknown[]) => args),
  or:        vi.fn((...args: unknown[]) => args),
  gte:       vi.fn(() => null),
  lte:       vi.fn(() => null),
  eq:        vi.fn(() => null),
  ne:        vi.fn(() => null),
  isNotNull: vi.fn(() => null),
  isNull:    vi.fn(() => null),
  desc:      vi.fn(() => null),
  asc:       vi.fn(() => null),
  sql:       Object.assign(vi.fn(() => ""), { raw: vi.fn((s: string) => s) }),
  inArray:   vi.fn(() => null),
  count:     vi.fn(() => 0),
}));

vi.mock("@workspace/db", () => {
  const chain = makeDbChain([{ count: 0 }]);
  const db = new Proxy({} as any, {
    get(_t, key) {
      if (key === "select")  return (..._args: any[]) => chain;
      if (key === "insert")  return (..._args: any[]) => chain;
      if (key === "execute") return vi.fn().mockResolvedValue(undefined);
      return undefined;
    },
  });
  const fakeTable = (name: string) =>
    new Proxy({ tableName: name } as any, {
      get(target, prop) { return target[prop] ?? String(prop); },
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

    db,
    accuracyResultsTable: fakeTable("accuracy_results"),
    auditEventsTable:     fakeTable("audit_events"),
    marketBarsTable:      fakeTable("market_bars"),
    signalsTable:         fakeTable("signals"),
    sql:                  { raw: vi.fn((s: string) => s) },
  };
});

vi.mock("@workspace/strategy-core", () => ({
  DEFAULT_SETUPS:             {},
  getSetupDefinition:         vi.fn(() => ({ minQuality: 0.6, label: "test" })),
  evaluateC4Decision:         vi.fn(() => ({ approved: true, reason: "ok" })),
  getC4SizeMultiplier:        vi.fn(() => 1.0),
  classifyMarketRegime:       vi.fn(() => "trending"),
  isCategoryAllowedInRegime:  vi.fn(() => true),
  evaluateMetaLabelDecision:  vi.fn(() => ({ approved: true })),
  isSetupType:                vi.fn(() => true),
  resolveSystemMode:          vi.fn(() => "live"),
  canWriteOrders:             vi.fn(() => true),
  isLiveMode:                 vi.fn(() => true),
  deriveDecisionState:        vi.fn(() => "PASS"),
}));

vi.mock("../lib/alpaca", () => ({
  getBars:              vi.fn(async () => MOCK_BARS),
  getBarsHistorical:    vi.fn(async () => MOCK_BARS),
  getLatestBar:         vi.fn(async () => MOCK_BARS[MOCK_BARS.length - 1]),
  getLatestTrade:       vi.fn(async () => ({ price: 42050, timestamp: new Date().toISOString() })),
  getAccount:           vi.fn(async () => MOCK_ACCOUNT),
  getPositions:         vi.fn(async () => MOCK_POSITIONS),
  hasValidTradingKey:   false,
  isBrokerKey:          false,
  placeOrder:           vi.fn(async () => MOCK_ORDER),
  getOrders:            vi.fn(async () => MOCK_ORDERS),
  cancelOrder:          vi.fn(async () => ({ success: true })),
  cancelAllOrders:      vi.fn(async () => ({ cancelled: 0 })),
  closePosition:        vi.fn(async () => ({ success: true })),
  getTypedPositions:    vi.fn(async () => MOCK_POSITIONS),
  calcPositionSize:     vi.fn(() => 0.1),
  getTodayFills:        vi.fn(async () => MOCK_FILL_ACTIVITIES),
  computeRoundTrips:    vi.fn(() => ({ totalPnl: 0, trades: 0 })),
}));

vi.mock("../lib/alpaca_stream", () => ({
  alpacaStream: {
    start:       vi.fn(),
    status:      vi.fn(() => ({ connected: true, symbols: ["BTCUSD"], uptime_ms: 60_000 })),
    subscribe:   vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

vi.mock("../lib/market/symbols", () => ({
  isCryptoSymbol: vi.fn(() => true),
  normalizeMarketSymbol: vi.fn((sym: string) => sym || "BTCUSD"),
}));

vi.mock("../lib/risk_engine", () => ({
  getCurrentTradingSession: vi.fn(() => "us_market"),
  getRiskEngineSnapshot:    vi.fn(() => MOCK_RISK_SNAPSHOT),
  isKillSwitchActive:       vi.fn(() => false),
  isSessionAllowed:         vi.fn(() => true),
  deriveLossCooldownState:  vi.fn(() => ({
    consecutiveLosses: 0,
    cooldownActive:    false,
    cooldownRemainingMs: 0,
    cooldownUntil:     null,
  })),
  buildRoundTripCloses:     vi.fn(() => []),
}));

vi.mock("../lib/strategy_engine", () => ({
  buildRecallFeatures:          vi.fn(() => ({ atr: 200, regime: "trending" })),
  detectAbsorptionReversal:     vi.fn(() => null),
  detectSweepReclaim:           vi.fn(() => null),
  detectContinuationPullback:   vi.fn(() => null),
  detectCVDDivergence:          vi.fn(() => null),
  detectBreakoutFailure:        vi.fn(() => null),
  detectVWAPReclaim:            vi.fn(() => null),
  detectOpeningRangeBreakout:   vi.fn(() => null),
  detectPostNewsContinuation:   vi.fn(() => null),
  scoreRecall:                  vi.fn(() => 0.6),
  computeFinalQuality:          vi.fn(() => 0.72),
  computeTPSL:                  vi.fn(() => ({ tp: 43000, sl: 41500, atr: 200 })),
  computeATR:                   vi.fn(() => 200),
  checkForwardOutcome:          vi.fn(() => "open"),
  applyNoTradeFilters:          vi.fn(() => []),
  getQualityThreshold:          vi.fn(() => 0.6),
  detectRegime:                 vi.fn(() => "trending"),
  buildChartOverlay:            vi.fn(() => ({ lines: [], boxes: [] })),
}));

vi.mock("../lib/ml_model", () => ({
  getModelStatus:        vi.fn(() => ({ status: "active", message: "Model trained — 200 samples", sample_count: 200 })),
  predictWinProbability: vi.fn(() => 0.65),
}));

vi.mock("../lib/claude", () => ({
  claudeVeto:      vi.fn(async () => ({ verdict: "APPROVED", reason: "Looks good", confidence: 0.9 })),
  isClaudeAvailable: vi.fn(() => false),
}));

// ── Import router AFTER mocks ─────────────────────────────────────────────────
import alpacaRouter from "../routes/alpaca";

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
  app.use("/api", alpacaRouter);

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

function httpReq(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const req = http.request(
      url,
      {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (c) => { raw += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
          catch { resolve({ status: res.statusCode ?? 0, data: raw }); }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get    = (path: string)               => httpReq("GET",    path);
const post   = (path: string, body: unknown) => httpReq("POST",   path, body);
const del    = (path: string)               => httpReq("DELETE", path);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/candles
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/candles", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/candles");
    expect(status).toBe(200);
  });

  it("response has symbol, timeframe, bars", async () => {
    const { data } = await get("/api/alpaca/candles");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("timeframe");
    expect(Array.isArray(d.bars)).toBe(true);
  });

  it("bars have OHLCV shape", async () => {
    const { data } = await get("/api/alpaca/candles");
    const bars = (data as Record<string, unknown>).bars as Array<Record<string, unknown>>;
    if (bars.length > 0) {
      expect(bars[0]).toHaveProperty("open");
      expect(bars[0]).toHaveProperty("high");
      expect(bars[0]).toHaveProperty("close");
      expect(bars[0]).toHaveProperty("volume");
    }
  });

  it("accepts symbol and timeframe params", async () => {
    const { status } = await get("/api/alpaca/candles?symbol=ETHUSD&timeframe=15Min");
    expect(status).toBe(200);
  });

  it("accepts limit param", async () => {
    const { status } = await get("/api/alpaca/candles?limit=50");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/stream-status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/stream-status", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/stream-status");
    expect(status).toBe(200);
  });

  it("response is an object", async () => {
    const { data } = await get("/api/alpaca/stream-status");
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/ticker
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/ticker", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/ticker?symbols=BTCUSD");
    expect(status).toBe(200);
  });

  it("response has tickers array", async () => {
    const { data } = await get("/api/alpaca/ticker?symbols=BTCUSD,ETHUSD");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.tickers)).toBe(true);
  });

  it("accepts multiple symbols", async () => {
    const { status } = await get("/api/alpaca/ticker?symbols=BTCUSD,ETHUSD,SOLUSD");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/account
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/account", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/account");
    expect(status).toBe(200);
  });

  it("response has equity and buying_power", async () => {
    const { data } = await get("/api/alpaca/account");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("equity");
    expect(d).toHaveProperty("buying_power");
  });

  it("response has mode field", async () => {
    const { data } = await get("/api/alpaca/account");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("mode");
    expect(["paper", "live"]).toContain(d.mode);
  });

  it("response has trading_blocked field", async () => {
    const { data } = await get("/api/alpaca/account");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("trading_blocked");
    expect(typeof d.trading_blocked).toBe("boolean");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/positions
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/positions", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/positions");
    expect(status).toBe(200);
  });

  it("response is an array", async () => {
    const { data } = await get("/api/alpaca/positions");
    expect(Array.isArray(data)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/alpaca/orders — blocked (no trading key)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/alpaca/orders", () => {
  it("returns 403 or 503 (no operator token or trading key)", async () => {
    const { status } = await post("/api/alpaca/orders", {
      symbol: "BTCUSD",
      side:   "buy",
      qty:    0.1,
    });
    // ensureTradingWriteAccess blocks before the hasValidTradingKey check:
    // no GODSVIEW_OPERATOR_TOKEN → 503; no trading key → 403
    expect([403, 503]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/risk/status
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/risk/status", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/risk/status");
    expect(status).toBe(200);
  });

  it("response has system_mode and gate_state", async () => {
    const { data } = await get("/api/alpaca/risk/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("system_mode");
    expect(d).toHaveProperty("gate_state");
  });

  it("response has risk object", async () => {
    const { data } = await get("/api/alpaca/risk/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("risk");
    expect(typeof d.risk).toBe("object");
  });

  it("response has trading_kill_switch field", async () => {
    const { data } = await get("/api/alpaca/risk/status");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("trading_kill_switch");
    expect(typeof d.trading_kill_switch).toBe("boolean");
  });

  it("gate_state is PASS or BLOCKED_BY_RISK", async () => {
    const { data } = await get("/api/alpaca/risk/status");
    const d = data as Record<string, unknown>;
    expect(["PASS", "BLOCKED_BY_RISK"]).toContain(d.gate_state);
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/api/alpaca/risk/status?symbol=ETHUSD");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/orders
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/orders", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/orders");
    expect(status).toBe(200);
  });

  it("response has orders array or message", async () => {
    const { data } = await get("/api/alpaca/orders");
    const d = data as Record<string, unknown>;
    // With no trading key, returns { orders: [], message: "..." }
    expect(d).toHaveProperty("orders");
    expect(Array.isArray(d.orders)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/alpaca/orders/:id — write-access blocked
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/alpaca/orders/:id", () => {
  it("returns 403 or 503 (write access blocked without operator token)", async () => {
    const { status } = await del("/api/alpaca/orders/order-xyz");
    expect([403, 423, 503]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/alpaca/orders — cancel all (write-access blocked)
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/alpaca/orders", () => {
  it("returns 403 or 503 (write access blocked without operator token)", async () => {
    const { status } = await del("/api/alpaca/orders");
    expect([403, 423, 503]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/positions/live
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/positions/live", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/positions/live");
    expect(status).toBe(200);
  });

  it("response has positions array", async () => {
    const { data } = await get("/api/alpaca/positions/live");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("positions");
    expect(Array.isArray(d.positions)).toBe(true);
  });

  it("response has fetched_at field", async () => {
    const { data } = await get("/api/alpaca/positions/live");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("fetched_at");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/alpaca/positions/:symbol — close position (write-access blocked)
// ─────────────────────────────────────────────────────────────────────────────

describe("DELETE /api/alpaca/positions/:symbol", () => {
  it("returns 403 or 503 (write access blocked without operator token)", async () => {
    const { status } = await del("/api/alpaca/positions/BTCUSD");
    expect([403, 423, 503]).toContain(status);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/size
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/size", () => {
  it("returns 200 with valid params", async () => {
    const { status } = await get("/api/alpaca/size?equity=10000&entry=42000&stop_loss=41500");
    expect(status).toBe(200);
  });

  it("response has qty and risk_dollars", async () => {
    const { data } = await get("/api/alpaca/size?equity=10000&entry=42000&stop_loss=41500");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("qty");
    expect(d).toHaveProperty("risk_dollars");
  });

  it("response has entry and stop_loss", async () => {
    const { data } = await get("/api/alpaca/size?equity=10000&entry=42000&stop_loss=41500");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("entry");
    expect(d).toHaveProperty("stop_loss");
  });

  it("returns 400 when entry is missing", async () => {
    const { status } = await get("/api/alpaca/size?equity=10000&stop_loss=41500");
    expect(status).toBe(400);
  });

  it("returns 400 when stop_loss is missing", async () => {
    const { status } = await get("/api/alpaca/size?equity=10000&entry=42000");
    expect(status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/bars
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/bars", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/bars");
    expect(status).toBe(200);
  });

  it("response has symbol, timeframe, bars", async () => {
    const { data } = await get("/api/alpaca/bars");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("symbol");
    expect(d).toHaveProperty("timeframe");
    expect(Array.isArray(d.bars)).toBe(true);
  });

  it("accepts symbol and timeframe params", async () => {
    const { status } = await get("/api/alpaca/bars?symbol=ETHUSD&timeframe=1Hour&limit=50");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/alpaca/accuracy
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/alpaca/accuracy", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/alpaca/accuracy");
    expect(status).toBe(200);
  });

  it("response has win_rate and total_records", async () => {
    const { data } = await get("/api/alpaca/accuracy");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("win_rate");
    expect(d).toHaveProperty("total_records");
  });

  it("response has by_setup array", async () => {
    const { data } = await get("/api/alpaca/accuracy");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.by_setup)).toBe(true);
  });

  it("response has by_symbol and by_regime arrays", async () => {
    const { data } = await get("/api/alpaca/accuracy");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.by_symbol)).toBe(true);
    expect(Array.isArray(d.by_regime)).toBe(true);
  });

  it("accepts symbol query param", async () => {
    const { status } = await get("/api/alpaca/accuracy?symbol=BTCUSD");
    expect(status).toBe(200);
  });

  it("accepts setup_type query param", async () => {
    const { status } = await get("/api/alpaca/accuracy?setup_type=sweep_reclaim");
    expect(status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/system/diagnostics
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/system/diagnostics", () => {
  it("returns 200", async () => {
    const { status } = await get("/api/system/diagnostics");
    expect(status).toBe(200);
  });

  it("response has system_status field", async () => {
    const { data } = await get("/api/system/diagnostics");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("system_status");
    expect(["healthy", "partial", "degraded"]).toContain(d.system_status);
  });

  it("response has layers object", async () => {
    const { data } = await get("/api/system/diagnostics");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("layers");
    expect(typeof d.layers).toBe("object");
  });

  it("response has trading_kill_switch field", async () => {
    const { data } = await get("/api/system/diagnostics");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("trading_kill_switch");
    expect(typeof d.trading_kill_switch).toBe("boolean");
  });

  it("response has recommendations array", async () => {
    const { data } = await get("/api/system/diagnostics");
    const d = data as Record<string, unknown>;
    expect(Array.isArray(d.recommendations)).toBe(true);
  });

  it("response has system_mode field", async () => {
    const { data } = await get("/api/system/diagnostics");
    const d = data as Record<string, unknown>;
    expect(d).toHaveProperty("system_mode");
  });
});
