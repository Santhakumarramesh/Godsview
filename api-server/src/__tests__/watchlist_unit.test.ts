/**
 * watchlist_unit.test.ts — Phase 62
 *
 * Unit tests for lib/watchlist.ts:
 *
 *   addSymbol          — add / update entry (idempotent on symbol)
 *   removeSymbol       — delete and return existence flag
 *   setEnabled         — toggle enabled flag
 *   touchScanned       — update lastScannedAt and signalCount
 *   listWatchlist      — all entries sorted by symbol
 *   listEnabledSymbols — only enabled entries
 *   getEntry           — single entry lookup
 *   clearWatchlist     — empty the store
 *   initWatchlistDefaults — reload default symbols
 *
 * Dependencies mocked:
 *   ../lib/logger — logger + logger.child
 *
 * State management: clearWatchlist() is called in beforeEach.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => {
  const child = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return {
    logger: {
      info:  vi.fn(),
      warn:  vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      child: vi.fn(() => child),
    },
  };
});

// ── Import AFTER mocks ────────────────────────────────────────────────────────
import {
  addSymbol,
  removeSymbol,
  setEnabled,
  touchScanned,
  listWatchlist,
  listEnabledSymbols,
  getEntry,
  clearWatchlist,
  initWatchlistDefaults,
} from "../lib/watchlist";

// Reset watchlist state before every test
beforeEach(() => {
  clearWatchlist();
});

// ─────────────────────────────────────────────────────────────────────────────
// addSymbol
// ─────────────────────────────────────────────────────────────────────────────

describe("addSymbol", () => {
  it("returns a WatchlistEntry with all fields", () => {
    const entry = addSymbol({ symbol: "BTCUSD", label: "Bitcoin", assetClass: "crypto" });
    expect(entry).toHaveProperty("symbol",  "BTCUSD");
    expect(entry).toHaveProperty("label",   "Bitcoin");
    expect(entry).toHaveProperty("assetClass", "crypto");
    expect(entry).toHaveProperty("enabled");
    expect(entry).toHaveProperty("addedAt");
    expect(entry).toHaveProperty("lastScannedAt");
    expect(entry).toHaveProperty("signalCount");
    expect(entry).toHaveProperty("note");
  });

  it("defaults enabled to true", () => {
    const entry = addSymbol({ symbol: "ETHUSD", label: "Ether", assetClass: "crypto" });
    expect(entry.enabled).toBe(true);
  });

  it("respects explicit enabled=false", () => {
    const entry = addSymbol({
      symbol: "SPY", label: "S&P 500", assetClass: "equity", enabled: false,
    });
    expect(entry.enabled).toBe(false);
  });

  it("defaults signalCount to 0", () => {
    const entry = addSymbol({ symbol: "SOLUSD", label: "Solana", assetClass: "crypto" });
    expect(entry.signalCount).toBe(0);
  });

  it("defaults lastScannedAt to null", () => {
    const entry = addSymbol({ symbol: "SOLUSD", label: "Solana", assetClass: "crypto" });
    expect(entry.lastScannedAt).toBeNull();
  });

  it("is idempotent — re-adding preserves original addedAt", () => {
    const first  = addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    const second = addSymbol({ symbol: "BTCUSD", label: "BTC updated", assetClass: "crypto" });
    expect(second.addedAt).toBe(first.addedAt);
  });

  it("updates label on re-add", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    const updated = addSymbol({ symbol: "BTCUSD", label: "Bitcoin (new)", assetClass: "crypto" });
    expect(updated.label).toBe("Bitcoin (new)");
  });

  it("stores note when provided", () => {
    const entry = addSymbol({
      symbol: "QQQ", label: "Nasdaq", assetClass: "equity", note: "tech heavy",
    });
    expect(entry.note).toBe("tech heavy");
  });

  it("persists entry retrievable via getEntry", () => {
    addSymbol({ symbol: "AAPL", label: "Apple", assetClass: "equity" });
    expect(getEntry("AAPL")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// removeSymbol
// ─────────────────────────────────────────────────────────────────────────────

describe("removeSymbol", () => {
  it("returns true when symbol existed", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    expect(removeSymbol("BTCUSD")).toBe(true);
  });

  it("returns false when symbol did not exist", () => {
    expect(removeSymbol("NONEXISTENT")).toBe(false);
  });

  it("entry is no longer retrievable after removal", () => {
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto" });
    removeSymbol("ETHUSD");
    expect(getEntry("ETHUSD")).toBeUndefined();
  });

  it("does not affect other entries", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto" });
    removeSymbol("BTCUSD");
    expect(getEntry("ETHUSD")).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// setEnabled
// ─────────────────────────────────────────────────────────────────────────────

describe("setEnabled", () => {
  it("returns null for unknown symbol", () => {
    expect(setEnabled("UNKNOWN", false)).toBeNull();
  });

  it("disables an enabled symbol", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    const result = setEnabled("BTCUSD", false);
    expect(result?.enabled).toBe(false);
  });

  it("re-enables a disabled symbol", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto", enabled: false });
    const result = setEnabled("BTCUSD", true);
    expect(result?.enabled).toBe(true);
  });

  it("persists the change", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    setEnabled("BTCUSD", false);
    expect(getEntry("BTCUSD")?.enabled).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// touchScanned
// ─────────────────────────────────────────────────────────────────────────────

describe("touchScanned", () => {
  it("updates lastScannedAt to a non-null ISO string", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    touchScanned("BTCUSD");
    const entry = getEntry("BTCUSD")!;
    expect(entry.lastScannedAt).not.toBeNull();
    expect(() => new Date(entry.lastScannedAt!)).not.toThrow();
  });

  it("does not increment signalCount when hadSignal=false (default)", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    touchScanned("BTCUSD", false);
    expect(getEntry("BTCUSD")?.signalCount).toBe(0);
  });

  it("increments signalCount when hadSignal=true", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    touchScanned("BTCUSD", true);
    expect(getEntry("BTCUSD")?.signalCount).toBe(1);
  });

  it("is a no-op for unknown symbols (no crash)", () => {
    expect(() => touchScanned("UNKNOWN", true)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listWatchlist / listEnabledSymbols
// ─────────────────────────────────────────────────────────────────────────────

describe("listWatchlist", () => {
  it("returns empty array after clear", () => {
    expect(listWatchlist()).toHaveLength(0);
  });

  it("returns all added entries", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto" });
    expect(listWatchlist()).toHaveLength(2);
  });

  it("is sorted by symbol ascending", () => {
    addSymbol({ symbol: "SPY",    label: "SPY", assetClass: "equity" });
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto" });
    const symbols = listWatchlist().map(e => e.symbol);
    expect(symbols).toEqual([...symbols].sort());
  });
});

describe("listEnabledSymbols", () => {
  it("excludes disabled entries", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto", enabled: true  });
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto", enabled: false });
    expect(listEnabledSymbols()).toHaveLength(1);
    expect(listEnabledSymbols()[0].symbol).toBe("BTCUSD");
  });

  it("returns all when all are enabled", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto" });
    expect(listEnabledSymbols()).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEntry
// ─────────────────────────────────────────────────────────────────────────────

describe("getEntry", () => {
  it("returns undefined for unknown symbol", () => {
    expect(getEntry("UNKNOWN")).toBeUndefined();
  });

  it("returns the entry for a known symbol", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    const entry = getEntry("BTCUSD");
    expect(entry).toBeDefined();
    expect(entry?.symbol).toBe("BTCUSD");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// clearWatchlist / initWatchlistDefaults
// ─────────────────────────────────────────────────────────────────────────────

describe("clearWatchlist", () => {
  it("removes all entries", () => {
    addSymbol({ symbol: "BTCUSD", label: "BTC", assetClass: "crypto" });
    addSymbol({ symbol: "ETHUSD", label: "ETH", assetClass: "crypto" });
    clearWatchlist();
    expect(listWatchlist()).toHaveLength(0);
  });
});

describe("initWatchlistDefaults", () => {
  it("populates default symbols (BTCUSD, ETHUSD, SPY, QQQ)", () => {
    // clearWatchlist was called in beforeEach — store is empty
    initWatchlistDefaults();
    const symbols = listWatchlist().map(e => e.symbol);
    expect(symbols).toContain("BTCUSD");
    expect(symbols).toContain("ETHUSD");
    expect(symbols).toContain("SPY");
    expect(symbols).toContain("QQQ");
  });

  it("is idempotent — calling twice does not double-add defaults", () => {
    initWatchlistDefaults();
    const countAfterFirst = listWatchlist().length;
    initWatchlistDefaults();
    expect(listWatchlist().length).toBe(countAfterFirst);
  });
});
