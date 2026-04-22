/**
 * session_guard_unit.test.ts — Phase 65
 *
 * Tests market session detection, trading-allowed logic, asset class inference,
 * and full session status shape.
 */

import { describe, it, expect } from "vitest";
import {
  getMarketSession,
  isTradingAllowed,
  inferAssetClass,
  getFullSessionStatus,
  type MarketSession,
  type AssetClass,
} from "../lib/session_guard";

// ── getMarketSession ──────────────────────────────────────────────────────────

describe("getMarketSession — crypto", () => {
  it("returns regular + tradeable for crypto at any time", () => {
    const status = getMarketSession("crypto");
    expect(status.session).toBe("regular");
    expect(status.tradeable).toBe(true);
    expect(status.asset_class).toBe("crypto");
  });

  it("has no next_open or reason for crypto", () => {
    const status = getMarketSession("crypto");
    expect(status.reason).toBeUndefined();
  });
});

describe("getMarketSession — equity", () => {
  it("returns a valid MarketSession type", () => {
    const status = getMarketSession("equity");
    const validSessions: MarketSession[] = [
      "pre_market", "regular", "after_hours", "closed", "weekend", "holiday",
    ];
    expect(validSessions).toContain(status.session);
  });

  it("returns asset_class equity", () => {
    const status = getMarketSession("equity");
    expect(status.asset_class).toBe("equity");
  });

  it("tradeable is boolean", () => {
    const status = getMarketSession("equity");
    expect(typeof status.tradeable).toBe("boolean");
  });

  it("default asset class is equity", () => {
    const defaultStatus = getMarketSession();
    const equityStatus = getMarketSession("equity");
    expect(defaultStatus.asset_class).toBe(equityStatus.asset_class);
  });
});

describe("getMarketSession — futures", () => {
  it("returns a valid session type for futures", () => {
    const status = getMarketSession("futures");
    const validSessions: MarketSession[] = [
      "pre_market", "regular", "after_hours", "closed", "weekend", "holiday",
    ];
    expect(validSessions).toContain(status.session);
  });

  it("returns asset_class futures", () => {
    const status = getMarketSession("futures");
    expect(status.asset_class).toBe("futures");
  });
});

// ── isTradingAllowed ──────────────────────────────────────────────────────────

describe("isTradingAllowed", () => {
  it("always returns true for crypto", () => {
    expect(isTradingAllowed("crypto")).toBe(true);
  });

  it("returns a boolean for equity", () => {
    expect(typeof isTradingAllowed("equity")).toBe("boolean");
  });

  it("matches getMarketSession.tradeable", () => {
    expect(isTradingAllowed("equity")).toBe(getMarketSession("equity").tradeable);
    expect(isTradingAllowed("futures")).toBe(getMarketSession("futures").tradeable);
    expect(isTradingAllowed("crypto")).toBe(getMarketSession("crypto").tradeable);
  });
});

// ── inferAssetClass ───────────────────────────────────────────────────────────

describe("inferAssetClass", () => {
  it("BTC symbol → crypto", () => {
    expect(inferAssetClass("BTCUSD")).toBe("crypto");
  });

  it("ETH symbol → crypto", () => {
    expect(inferAssetClass("ETHUSD")).toBe("crypto");
  });

  it("USD-suffixed → crypto", () => {
    expect(inferAssetClass("SOLUSD")).toBe("crypto");
  });

  it("SPY → equity", () => {
    expect(inferAssetClass("SPY")).toBe("equity");
  });

  it("AAPL → equity", () => {
    expect(inferAssetClass("AAPL")).toBe("equity");
  });

  it("QQQ → equity", () => {
    expect(inferAssetClass("QQQ")).toBe("equity");
  });

  it("MES (micro E-mini S&P) → futures", () => {
    expect(inferAssetClass("MES")).toBe("futures");
  });

  it("MNQ (micro Nasdaq futures) → futures", () => {
    expect(inferAssetClass("MNQ")).toBe("futures");
  });

  it("lowercase BTC → crypto (case insensitive)", () => {
    expect(inferAssetClass("btcusd")).toBe("crypto");
  });
});

// ── getFullSessionStatus ──────────────────────────────────────────────────────

describe("getFullSessionStatus", () => {
  it("returns object with equity, crypto, futures keys", () => {
    const all = getFullSessionStatus();
    expect(all).toHaveProperty("equity");
    expect(all).toHaveProperty("crypto");
    expect(all).toHaveProperty("futures");
  });

  it("each status has asset_class matching its key", () => {
    const all = getFullSessionStatus();
    expect(all.equity.asset_class).toBe("equity");
    expect(all.crypto.asset_class).toBe("crypto");
    expect(all.futures.asset_class).toBe("futures");
  });

  it("crypto is always regular session", () => {
    const all = getFullSessionStatus();
    expect(all.crypto.session).toBe("regular");
    expect(all.crypto.tradeable).toBe(true);
  });
});
