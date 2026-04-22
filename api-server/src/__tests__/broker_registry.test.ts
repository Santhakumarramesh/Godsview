import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrokerRegistry } from "../lib/broker/registry.js";
import type { BrokerAdapter, BrokerName, BrokerOrderRequest } from "../lib/broker/types.js";

function createMockAdapter(name: BrokerName): BrokerAdapter {
  return {
    name,
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    submitOrder: vi.fn().mockResolvedValue({ id: "ord-1", symbol: "AAPL", side: "buy", qty: 1, filledQty: 0, type: "market", status: "new", createdAt: "", updatedAt: "" }),
    cancelOrder: vi.fn().mockResolvedValue(undefined),
    getOrder: vi.fn().mockResolvedValue({ id: "ord-1", symbol: "AAPL", side: "buy", qty: 1, filledQty: 1, type: "market", status: "filled", createdAt: "", updatedAt: "" }),
    getOpenOrders: vi.fn().mockResolvedValue([]),
    getPositions: vi.fn().mockResolvedValue([]),
    getPosition: vi.fn().mockResolvedValue(null),
    closePosition: vi.fn().mockResolvedValue(undefined),
    getAccountInfo: vi.fn().mockResolvedValue({ id: "acct-1", currency: "USD", cash: 100000, portfolioValue: 100000, buyingPower: 200000 }),
  };
}

describe("BrokerRegistry", () => {
  let registry: BrokerRegistry;

  beforeEach(() => {
    registry = new BrokerRegistry();
  });

  it("registers and retrieves a broker adapter", () => {
    const alpaca = createMockAdapter("alpaca");
    registry.register(alpaca);
    expect(registry.getBroker("alpaca")).toBe(alpaca);
  });

  it("throws for unregistered broker", () => {
    expect(() => registry.getBroker("binance")).toThrow('Broker "binance" is not registered');
  });

  it("sets first registered broker as default", () => {
    const alpaca = createMockAdapter("alpaca");
    registry.register(alpaca);
    expect(registry.getBrokerForAsset("stocks")).toBe(alpaca);
  });

  it("routes by asset class", () => {
    const alpaca = createMockAdapter("alpaca");
    const binance = createMockAdapter("binance");
    registry.register(alpaca);
    registry.register(binance);
    registry.setAssetRoute("crypto" as any, "binance");
    registry.setAssetRoute("stocks" as any, "alpaca");

    expect(registry.getBrokerForAsset("crypto")).toBe(binance);
    expect(registry.getBrokerForAsset("stocks")).toBe(alpaca);
    // Unrouted asset falls back to default (first registered = alpaca)
    expect(registry.getBrokerForAsset("forex")).toBe(alpaca);
  });

  it("allows changing default broker", () => {
    const alpaca = createMockAdapter("alpaca");
    const binance = createMockAdapter("binance");
    registry.register(alpaca);
    registry.register(binance);
    registry.setDefault("binance");
    expect(registry.getBrokerForAsset("futures")).toBe(binance);
  });

  it("throws when setting default to unregistered broker", () => {
    expect(() => registry.setDefault("interactive_brokers")).toThrow();
  });

  it("throws when setting asset route to unregistered broker", () => {
    expect(() => registry.setAssetRoute("crypto", "binance")).toThrow();
  });

  it("connects all registered brokers", async () => {
    const alpaca = createMockAdapter("alpaca");
    const binance = createMockAdapter("binance");
    registry.register(alpaca);
    registry.register(binance);
    await registry.connectAll();
    expect(alpaca.connect).toHaveBeenCalledOnce();
    expect(binance.connect).toHaveBeenCalledOnce();
  });

  it("disconnects all registered brokers", async () => {
    const alpaca = createMockAdapter("alpaca");
    registry.register(alpaca);
    await registry.disconnectAll();
    expect(alpaca.disconnect).toHaveBeenCalledOnce();
  });

  it("returns status of all registered brokers", () => {
    const alpaca = createMockAdapter("alpaca");
    const binance = createMockAdapter("binance");
    registry.register(alpaca);
    registry.register(binance);
    const status = registry.getStatus();
    expect(status).toEqual({ alpaca: true, binance: true });
  });

  it("lists registered broker names", () => {
    const alpaca = createMockAdapter("alpaca");
    registry.register(alpaca);
    expect(registry.registeredBrokers).toEqual(["alpaca"]);
  });

  it("submits order through routed broker", async () => {
    const alpaca = createMockAdapter("alpaca");
    registry.register(alpaca);
    const broker = registry.getBrokerForAsset("stocks");
    const order: BrokerOrderRequest = {
      symbol: "AAPL", side: "buy", qty: 10,
      type: "market", timeInForce: "day",
    };
    const result = await broker.submitOrder(order);
    expect(result.id).toBe("ord-1");
    expect(alpaca.submitOrder).toHaveBeenCalledWith(order);
  });
});
