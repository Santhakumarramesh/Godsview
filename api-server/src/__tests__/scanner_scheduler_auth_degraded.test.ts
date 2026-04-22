import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { addSymbol, clearWatchlist, getEntry } from "../lib/watchlist";
import { ScannerScheduler } from "../lib/scanner_scheduler";

const alpacaMocks = vi.hoisted(() => ({
  getBars: vi.fn(async () => []),
  placeOrder: vi.fn(),
  getAccount: vi.fn(async () => ({ equity: "10000" })),
  isAlpacaAuthFailureError: vi.fn(() => false),
  getAlpacaAuthFailureState: vi.fn(() => ({
    active: true,
    remainingMs: 45_000,
    cooldownMs: 60_000,
    status: 401,
    message: "unauthorized",
    occurredAt: new Date().toISOString(),
    count: 1,
  })),
}));

vi.mock("../lib/alpaca", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/alpaca")>();
  return {
    ...original,
    getBars: alpacaMocks.getBars,
    placeOrder: alpacaMocks.placeOrder,
    getAccount: alpacaMocks.getAccount,
    isAlpacaAuthFailureError: alpacaMocks.isAlpacaAuthFailureError,
    getAlpacaAuthFailureState: alpacaMocks.getAlpacaAuthFailureState,
  };
});

describe("ScannerScheduler auth-degraded fast-path", () => {
  const scheduler = ScannerScheduler.getInstance();

  beforeEach(() => {
    scheduler.stop();
    clearWatchlist();
    addSymbol({ symbol: "BTCUSD", label: "Bitcoin", assetClass: "crypto" });
    addSymbol({ symbol: "SPY", label: "S&P 500", assetClass: "equity" });
    alpacaMocks.getBars.mockReset();
    alpacaMocks.getBars.mockResolvedValue([]);
    alpacaMocks.getAlpacaAuthFailureState.mockReset();
    alpacaMocks.getAlpacaAuthFailureState.mockReturnValue({
      active: true,
      remainingMs: 45_000,
      cooldownMs: 60_000,
      status: 401,
      message: "unauthorized",
      occurredAt: new Date().toISOString(),
      count: 1,
    });
  });

  afterEach(() => {
    scheduler.stop();
  });

  it("skips symbol fetches during auth cooldown and still updates scan telemetry", async () => {
    const run = await scheduler.forceScan();
    expect(run.status).toBe("completed");
    expect(run.symbolsScanned).toBe(2);
    expect(run.signalsFound).toBe(0);
    expect(run.alertsEmitted).toBe(0);
    expect(alpacaMocks.getBars).not.toHaveBeenCalled();
    expect(getEntry("BTCUSD")?.lastScannedAt).not.toBeNull();
    expect(getEntry("SPY")?.lastScannedAt).not.toBeNull();
  });
});
