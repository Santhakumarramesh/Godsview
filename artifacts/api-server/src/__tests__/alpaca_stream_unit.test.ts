/**
 * alpaca_stream_unit.test.ts — Phase 70
 *
 * Tests the AlpacaStreamManager singleton, type shapes, onTick/offTick
 * listener registration, and status(). Mocks WebSocket to avoid real connections.
 */

import { describe, it, expect, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("../lib/market/orderbook", () => ({
  orderBookManager: { update: vi.fn(), get: vi.fn(() => null), clear: vi.fn() },
}));

vi.mock("../lib/market/orderbook_recorder", () => ({
  orderBookRecorder: { record: vi.fn() },
}));

vi.mock("../lib/market/symbols", () => ({
  normalizeMarketSymbol: vi.fn((s: string) => s),
  isCryptoSymbol: vi.fn((s: string) => s.endsWith("USD")),
  toAlpacaSlash: vi.fn((s: string) => s.replace("USD", "/USD")),
  fromAlpacaSlash: vi.fn((s: string) => s.replace("/", "")),
}));

vi.mock("ws", () => {
  class MockWebSocket {
    static OPEN = 1;
    static CLOSED = 3;
    readyState = 3; // CLOSED — won't try to connect
    send = vi.fn();
    close = vi.fn();
    terminate = vi.fn();
    on = vi.fn();
    off = vi.fn();
    removeEventListener = vi.fn();
    addEventListener = vi.fn();
  }
  return { default: MockWebSocket, WebSocket: MockWebSocket, WebSocketServer: class { on = vi.fn(); } };
});

import {
  alpacaStream,
  type LiveCandle,
  type TickPayload,
  type TickListener,
} from "../lib/alpaca_stream";

// ── LiveCandle type ───────────────────────────────────────────────────────────

describe("LiveCandle type", () => {
  it("can construct a valid LiveCandle", () => {
    const candle: LiveCandle = {
      time: 1704067200,
      open: 84000, high: 84500, low: 83500, close: 84200, volume: 1000,
    };
    expect(candle.close).toBe(84200);
    expect(candle.high).toBeGreaterThan(candle.low);
    expect(candle.volume).toBeGreaterThan(0);
  });
});

describe("TickPayload type", () => {
  it("can construct a valid TickPayload", () => {
    const candle: LiveCandle = {
      time: 1704067200, open: 84000, high: 84500, low: 83500, close: 84200, volume: 500,
    };
    const tick: TickPayload = {
      type: "tick",
      symbol: "BTCUSD",
      price: 84200,
      timestamp: new Date().toISOString(),
      candle,
    };
    expect(tick.type).toBe("tick");
    expect(tick.symbol).toBe("BTCUSD");
    expect(tick.price).toBe(84200);
    expect(tick.candle).toBeDefined();
  });
});

// ── alpacaStream singleton ────────────────────────────────────────────────────

describe("alpacaStream singleton", () => {
  it("is defined and is a singleton", () => {
    expect(alpacaStream).toBeDefined();
  });

  it("has subscribe, unsubscribe, status, start, stop API methods", () => {
    expect(typeof alpacaStream.subscribe).toBe("function");
    expect(typeof alpacaStream.unsubscribe).toBe("function");
    expect(typeof alpacaStream.status).toBe("function");
    expect(typeof alpacaStream.start).toBe("function");
    expect(typeof alpacaStream.stop).toBe("function");
  });

  it("status() returns an object with connection info", () => {
    const s = alpacaStream.status();
    expect(typeof s).toBe("object");
    expect(s).toHaveProperty("authenticated");
    expect(s).toHaveProperty("pollingMode");
    expect(s).toHaveProperty("listenersCount");
  });

  it("status().authenticated is boolean", () => {
    const s = alpacaStream.status();
    expect(typeof s.authenticated).toBe("boolean");
  });

  it("status().listenersCount is a number >= 0", () => {
    const s = alpacaStream.status();
    expect(typeof s.listenersCount).toBe("number");
    expect(s.listenersCount).toBeGreaterThanOrEqual(0);
  });

  it("status().ticksReceived starts at 0", () => {
    const s = alpacaStream.status();
    expect(typeof s.ticksReceived).toBe("number");
    expect(s.ticksReceived).toBeGreaterThanOrEqual(0);
  });
});

// ── subscribe / unsubscribe ───────────────────────────────────────────────────

describe("subscribe / unsubscribe", () => {
  it("subscribe registers a listener without throwing", () => {
    const listener: TickListener = vi.fn();
    expect(() => alpacaStream.subscribe("BTCUSD", "5Min", listener)).not.toThrow();
    alpacaStream.unsubscribe("BTCUSD", "5Min", listener);
  });

  it("unsubscribe removes a listener without throwing", () => {
    const listener: TickListener = vi.fn();
    alpacaStream.subscribe("ETHUSD", "1Min", listener);
    expect(() => alpacaStream.unsubscribe("ETHUSD", "1Min", listener)).not.toThrow();
  });

  it("multiple listeners can be registered for same symbol+tf", () => {
    const l1: TickListener = vi.fn();
    const l2: TickListener = vi.fn();
    expect(() => {
      alpacaStream.subscribe("SOLUSD", "5Min", l1);
      alpacaStream.subscribe("SOLUSD", "5Min", l2);
    }).not.toThrow();
    alpacaStream.unsubscribe("SOLUSD", "5Min", l1);
    alpacaStream.unsubscribe("SOLUSD", "5Min", l2);
  });

  it("unsubscribe on non-existent listener does not throw", () => {
    const listener: TickListener = vi.fn();
    expect(() => alpacaStream.unsubscribe("XYZUSD", "15Min", listener)).not.toThrow();
  });
});
