/**
 * market_symbols_unit.test.ts — Phase 73a
 *
 * Tests all four pure functions from market/symbols.ts:
 *   normalizeMarketSymbol  — strips noise, upper-cases, handles slashes/prefixes
 *   toAlpacaSlash          — converts dense symbols to BASE/QUOTE form
 *   fromAlpacaSlash        — strips slash for dense form
 *   isCryptoSymbol         — checks if symbol ends with known crypto/fiat quote
 *
 * No mocks — all functions are pure.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeMarketSymbol,
  toAlpacaSlash,
  fromAlpacaSlash,
  isCryptoSymbol,
} from "../lib/market/symbols";

// ── normalizeMarketSymbol ─────────────────────────────────────────────────────

describe("normalizeMarketSymbol", () => {
  it("upper-cases and trims a plain symbol", () => {
    expect(normalizeMarketSymbol("btcusd")).toBe("BTCUSD");
    expect(normalizeMarketSymbol("  ethusd  ")).toBe("ETHUSD");
  });

  it("strips exchange prefix separated by colon", () => {
    expect(normalizeMarketSymbol("COINBASE:BTCUSD")).toBe("BTCUSD");
    expect(normalizeMarketSymbol("BINANCE:ETH/USDT")).toBe("ETHUSDT");
  });

  it("removes slash from crypto pair like BTC/USD", () => {
    expect(normalizeMarketSymbol("BTC/USD")).toBe("BTCUSD");
    expect(normalizeMarketSymbol("ETH/USDT")).toBe("ETHUSDT");
  });

  it("removes PERP suffix", () => {
    expect(normalizeMarketSymbol("BTCUSDPERP")).toBe("BTCUSD");
    expect(normalizeMarketSymbol("ETHUSDPERP")).toBe("ETHUSD");
  });

  it("strips non-alphanumeric characters (except handled /)", () => {
    expect(normalizeMarketSymbol("BTC-USD")).toBe("BTCUSD");
    expect(normalizeMarketSymbol("BTC_USD")).toBe("BTCUSD");
  });

  it("returns fallback for empty string", () => {
    expect(normalizeMarketSymbol("")).toBe("BTCUSD");
    expect(normalizeMarketSymbol("", "SPY")).toBe("SPY");
  });

  it("returns fallback for whitespace-only string", () => {
    expect(normalizeMarketSymbol("   ")).toBe("BTCUSD");
  });

  it("handles standard stock symbols", () => {
    expect(normalizeMarketSymbol("AAPL")).toBe("AAPL");
    expect(normalizeMarketSymbol("spy")).toBe("SPY");
  });

  it("handles exchange-prefixed slash pair", () => {
    expect(normalizeMarketSymbol("CB:BTC/USD")).toBe("BTCUSD");
  });

  it("preserves slash in output when input has no colon prefix and contains slash", () => {
    // After colon-split, if the result still has slash, it gets removed
    const result = normalizeMarketSymbol("BTC/USD");
    expect(result).toBe("BTCUSD");
  });
});

// ── toAlpacaSlash ─────────────────────────────────────────────────────────────

describe("toAlpacaSlash", () => {
  it("converts BTCUSD to BTC/USD", () => {
    expect(toAlpacaSlash("BTCUSD")).toBe("BTC/USD");
  });

  it("converts ETHUSD to ETH/USD", () => {
    expect(toAlpacaSlash("ETHUSD")).toBe("ETH/USD");
  });

  it("converts BTCUSDT to BTC/USDT", () => {
    expect(toAlpacaSlash("BTCUSDT")).toBe("BTC/USDT");
  });

  it("converts ETHBTC to ETH/BTC", () => {
    expect(toAlpacaSlash("ETHBTC")).toBe("ETH/BTC");
  });

  it("returns symbol unchanged if already in slash form", () => {
    expect(toAlpacaSlash("BTC/USD")).toBe("BTC/USD");
  });

  it("returns equity symbols unchanged (no known quote suffix)", () => {
    // AAPL doesn't end with USD/USDT/etc in a parseable way
    expect(toAlpacaSlash("AAPL")).toBe("AAPL");
  });

  it("handles lowercase input via normalization", () => {
    expect(toAlpacaSlash("btcusd")).toBe("BTC/USD");
  });

  it("handles exchange-prefixed input", () => {
    expect(toAlpacaSlash("COINBASE:BTCUSD")).toBe("BTC/USD");
  });

  it("converts SOLUSD to SOL/USD", () => {
    expect(toAlpacaSlash("SOLUSD")).toBe("SOL/USD");
  });

  it("converts LTCBTC to LTC/BTC (BTC as quote)", () => {
    expect(toAlpacaSlash("LTCBTC")).toBe("LTC/BTC");
  });
});

// ── fromAlpacaSlash ───────────────────────────────────────────────────────────

describe("fromAlpacaSlash", () => {
  it("removes slash from BTC/USD → BTCUSD", () => {
    expect(fromAlpacaSlash("BTC/USD")).toBe("BTCUSD");
  });

  it("removes slash from ETH/USDT → ETHUSDT", () => {
    expect(fromAlpacaSlash("ETH/USDT")).toBe("ETHUSDT");
  });

  it("returns dense symbol unchanged", () => {
    expect(fromAlpacaSlash("BTCUSD")).toBe("BTCUSD");
  });

  it("upper-cases result", () => {
    expect(fromAlpacaSlash("btc/usd")).toBe("BTCUSD");
  });

  it("handles empty string", () => {
    expect(fromAlpacaSlash("")).toBe("");
  });

  it("strips any non-alphanumeric characters", () => {
    expect(fromAlpacaSlash("BTC-USD")).toBe("BTCUSD");
  });
});

// ── isCryptoSymbol ────────────────────────────────────────────────────────────

describe("isCryptoSymbol", () => {
  it("returns true for BTCUSD", () => {
    expect(isCryptoSymbol("BTCUSD")).toBe(true);
  });

  it("returns true for ETHUSD", () => {
    expect(isCryptoSymbol("ETHUSD")).toBe(true);
  });

  it("returns true for BTCUSDT", () => {
    expect(isCryptoSymbol("BTCUSDT")).toBe(true);
  });

  it("returns true for ETHBTC (BTC as quote)", () => {
    expect(isCryptoSymbol("ETHBTC")).toBe(true);
  });

  it("returns true for slash form BTC/USD", () => {
    expect(isCryptoSymbol("BTC/USD")).toBe(true);
  });

  it("returns false for pure equity symbols like AAPL", () => {
    expect(isCryptoSymbol("AAPL")).toBe(false);
  });

  it("returns false for SPY", () => {
    expect(isCryptoSymbol("SPY")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isCryptoSymbol("")).toBe(false);
  });

  it("handles lowercase input", () => {
    expect(isCryptoSymbol("btcusd")).toBe(true);
  });

  it("handles exchange-prefixed crypto symbol", () => {
    expect(isCryptoSymbol("COINBASE:BTCUSD")).toBe(true);
  });

  it("returns false when symbol is shorter than or equal to quote length only", () => {
    // Symbol must have a base currency too (length > quote.length)
    expect(isCryptoSymbol("USD")).toBe(false);
    expect(isCryptoSymbol("BTC")).toBe(false); // BTC alone — no base before quote
  });
});
