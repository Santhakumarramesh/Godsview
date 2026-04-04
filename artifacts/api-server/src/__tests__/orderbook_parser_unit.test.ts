import { describe, expect, it } from "vitest";
import { parseOrderbookRestResponse } from "../lib/market/orderbook";

describe("parseOrderbookRestResponse", () => {
  it("throws explicit status errors for non-2xx responses", () => {
    expect(() =>
      parseOrderbookRestResponse("BTCUSD", 401, "<html><h1>401 Authorization Required</h1></html>"),
    ).toThrow(/Orderbook API 401/);
  });

  it("throws explicit parse errors for invalid JSON on 2xx responses", () => {
    expect(() => parseOrderbookRestResponse("BTCUSD", 200, "<html>not-json</html>")).toThrow(
      /invalid JSON/i,
    );
  });

  it("parses a valid orderbook payload", () => {
    const payload = JSON.stringify({
      orderbooks: {
        "BTC/USD": {
          t: "2026-04-04T12:00:00.000Z",
          a: [{ p: 50010, s: 0.4 }, { p: 50020, s: 0.9 }],
          b: [{ p: 50000, s: 0.7 }, { p: 49990, s: 1.1 }],
        },
      },
    });

    const snapshot = parseOrderbookRestResponse("BTCUSD", 200, payload);
    expect(snapshot.symbol).toBe("BTCUSD");
    expect(snapshot.source).toBe("rest");
    expect(snapshot.timestamp).toBe("2026-04-04T12:00:00.000Z");
    expect(snapshot.asks).toEqual([
      { price: 50010, size: 0.4 },
      { price: 50020, size: 0.9 },
    ]);
    expect(snapshot.bids).toEqual([
      { price: 50000, size: 0.7 },
      { price: 49990, size: 1.1 },
    ]);
  });
});
