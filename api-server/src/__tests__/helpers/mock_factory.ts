/**
 * mock_factory.ts — Shared test fixtures for GodsView integration tests
 *
 * Generates realistic market data, SMC states, order flow states, and
 * account objects for use across all test suites.
 */

import type { AlpacaBar } from "../../lib/alpaca";
import type { SMCState, OrderflowState, ChecklistResult, WarRoomVerdict } from "../../lib/schemas";
import type { RiskInput } from "../../lib/war_room";

// ─── Bar Generation ────────────────────────────────────────────────────────

type Trend = "up" | "down" | "flat" | "volatile";

interface MockBarOpts {
  count?: number;
  startPrice?: number;
  trend?: Trend;
  timeframeMs?: number;
  baseVolume?: number;
  startTime?: string;
}

export function mockBars(opts: MockBarOpts = {}): AlpacaBar[] {
  const {
    count = 30,
    startPrice = 67000,
    trend = "up",
    timeframeMs = 60_000,
    baseVolume = 0.5,
    startTime = "2025-01-15T12:00:00Z",
  } = opts;

  const bars: AlpacaBar[] = [];
  let price = startPrice;
  const startMs = new Date(startTime).getTime();

  for (let i = 0; i < count; i++) {
    const drift =
      trend === "up" ? startPrice * 0.001 :
      trend === "down" ? -startPrice * 0.001 :
      trend === "volatile" ? (Math.random() > 0.5 ? 1 : -1) * startPrice * 0.003 :
      0;
    const noise = (Math.random() - 0.5) * startPrice * 0.0015;
    const open = price;
    const close = price + drift + noise;
    const high = Math.max(open, close) + Math.abs(noise) * 0.6;
    const low = Math.min(open, close) - Math.abs(noise) * 0.6;
    const volume = baseVolume * (0.7 + Math.random() * 0.6);
    const ts = new Date(startMs + i * timeframeMs).toISOString();

    bars.push({
      t: ts, o: open, h: high, l: low, c: close, v: volume, vw: (open + close) / 2,
      Timestamp: ts, Open: open, High: high, Low: low, Close: close, Volume: volume,
      VWAP: (open + close) / 2,
    });
    price = close;
  }
  return bars;
}


// ─── Absorption Reversal Bars ──────────────────────────────────────────────
// Generates bars that should trigger absorption reversal detection:
// 3+ bearish bars followed by a bullish reversal with volume spike

export function mockAbsorptionReversalBars(startPrice = 67000): {
  bars1m: AlpacaBar[];
  bars5m: AlpacaBar[];
} {
  const baseTime = new Date("2025-01-15T14:00:00Z").getTime();
  const bars1m: AlpacaBar[] = [];

  // 4 bearish bars (selling pressure)
  let price = startPrice;
  for (let i = 0; i < 4; i++) {
    const open = price;
    const close = price - startPrice * 0.0012;
    const high = open + startPrice * 0.0003;
    const low = close - startPrice * 0.0005;
    const ts = new Date(baseTime + i * 60_000).toISOString();
    bars1m.push({
      t: ts, o: open, h: high, l: low, c: close, v: 0.4,
      Timestamp: ts, Open: open, High: high, Low: low, Close: close,
      Volume: 0.4, VWAP: (open + close) / 2,
    });
    price = close;
  }

  // Reversal bar: bullish with volume spike and large wick
  const revOpen = price;
  const revClose = price + startPrice * 0.002;
  const revHigh = revClose + startPrice * 0.001;
  const revLow = price - startPrice * 0.003; // deep wick down
  const revTs = new Date(baseTime + 4 * 60_000).toISOString();
  bars1m.push({
    t: revTs, o: revOpen, h: revHigh, l: revLow, c: revClose, v: 1.8,
    Timestamp: revTs, Open: revOpen, High: revHigh, Low: revLow, Close: revClose,
    Volume: 1.8, VWAP: (revOpen + revClose) / 2,
  });

  // Add extra bars for sufficient history (need 20+ for recall)
  const preBars = mockBars({
    count: 25, startPrice: startPrice + startPrice * 0.005,
    trend: "down", startTime: "2025-01-15T13:30:00Z",
  });
  const all1m = [...preBars, ...bars1m];

  // 5m bars: just aggregate into a declining set
  const bars5m = mockBars({
    count: 20, startPrice: startPrice + startPrice * 0.01,
    trend: "down", timeframeMs: 300_000,
    startTime: "2025-01-15T12:30:00Z",
  });

  return { bars1m: all1m, bars5m };
}


// ─── SMC State Mocks ───────────────────────────────────────────────────────

export function mockSMCState(overrides: Partial<SMCState> = {}): SMCState {
  return {
    symbol: "BTCUSD",
    structure: {
      trend: "bullish",
      lastBOS: { direction: "up", price: 67500, index: 18 },
      lastCHoCH: null,
      swings: [
        { type: "HL", price: 66800, index: 12, time: "2025-01-15T13:50:00Z" },
        { type: "HH", price: 67500, index: 18, time: "2025-01-15T13:56:00Z" },
      ],
    },
    activeOBs: [
      { type: "bullish", high: 67100, low: 66900, index: 10, mitigated: false },
    ],
    unfilledFVGs: [
      { type: "bullish", high: 67200, low: 67050, index: 14, filled: false },
    ],
    liquidityPools: [
      { type: "sell_side", price: 66500, strength: 0.8, swept: true },
    ],
    displacements: [
      { direction: "up", magnitude: 350, index: 16 },
    ],
    confluenceScore: 0.78,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function mockOrderflowState(overrides: Partial<OrderflowState> = {}): OrderflowState {
  return {
    symbol: "BTCUSD",
    cvd: 1250,
    cvdSlope: 0.035,
    buyVolumeRatio: 0.62,
    deltaImbalance: 0.35,
    largeBlockActivity: true,
    computedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function mockRiskInput(overrides: Partial<RiskInput> = {}): RiskInput {
  return {
    entryPrice: 67000,
    stopLoss: 66500,
    takeProfit: 68500,
    atrPct: 1.8,
    accountEquity: 100_000,
    ...overrides,
  };
}

// ─── Alpaca Account / Position / Order Mocks ───────────────────────────────

export function mockAlpacaAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: "test-account-001",
    status: "ACTIVE",
    equity: "100000.00",
    cash: "50000.00",
    buying_power: "200000.00",
    portfolio_value: "100000.00",
    currency: "USD",
    pattern_day_trader: false,
    trading_blocked: false,
    account_blocked: false,
    ...overrides,
  };
}

export function mockPosition(symbol = "BTCUSD", overrides: Record<string, unknown> = {}) {
  return {
    asset_id: "test-asset-btc",
    symbol,
    qty: "0.015",
    side: "long",
    avg_entry_price: "67000.00",
    market_value: "1012.50",
    cost_basis: "1005.00",
    unrealized_pl: "7.50",
    unrealized_plpc: "0.0075",
    current_price: "67500.00",
    ...overrides,
  };
}

export function mockOrder(symbol = "BTCUSD", overrides: Record<string, unknown> = {}) {
  return {
    id: `order-${Date.now()}`,
    symbol,
    side: "buy",
    type: "market",
    qty: "0.015",
    filled_qty: "0.015",
    filled_avg_price: "67000.00",
    status: "filled",
    created_at: new Date().toISOString(),
    filled_at: new Date().toISOString(),
    time_in_force: "gtc",
    ...overrides,
  };
}

// ─── Signal Evaluation Request Mock ────────────────────────────────────────

export function mockSignalRequest(overrides: Record<string, unknown> = {}) {
  return {
    symbol: "BTCUSD",
    direction: "long",
    setup_type: "absorption_reversal",
    entry_price: 67000,
    stop_loss: 66500,
    take_profit: 68500,
    timeframe: "5Min",
    confidence: 0.75,
    source: "si_pipeline",
    ...overrides,
  };
}

// ─── Express Test Server Helper ────────────────────────────────────────────

import express from "express";
import http from "http";

export function createTestServer(
  setupRoutes: (app: express.Application) => void
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    setupRoutes(app);

    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}
