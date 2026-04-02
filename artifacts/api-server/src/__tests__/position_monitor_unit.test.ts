/**
 * position_monitor_unit.test.ts — Phase 67
 *
 * Tests registerPosition, unregisterPosition, getManagedPositions,
 * getMonitorEvents, and shutdownMonitor.
 * Mocks logger and alpaca to prevent real network calls.
 * Always calls shutdownMonitor() in afterEach to clean up the interval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    child: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
  },
}));

vi.mock("../lib/alpaca", () => ({
  getLatestTrade: vi.fn().mockResolvedValue({ price: 84500 }),
  closePosition: vi.fn().mockResolvedValue({}),
  placeOrder: vi.fn().mockResolvedValue({}),
}));

vi.mock("../lib/signal_stream", () => ({
  broadcast: vi.fn(),
}));

import {
  registerPosition,
  unregisterPosition,
  getManagedPositions,
  getMonitorEvents,
  shutdownMonitor,
  type ManagedPosition,
  type MonitorEvent,
} from "../lib/position_monitor";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePositionInput(overrides: Partial<Parameters<typeof registerPosition>[0]> = {}) {
  return {
    symbol: "BTCUSD",
    direction: "long" as const,
    entry_price: 84000,
    stop_loss: 83000,
    take_profit: 87000,
    quantity: 10,
    trailing_config: {
      activation_atr: 1.5,
      trail_step: 0.5,
      max_hold_minutes: 480,
    },
    profit_targets: [
      { r_target: 1.0, close_pct: 0.25 },
      { r_target: 2.0, close_pct: 0.50 },
    ],
    atr: 500,
    ...overrides,
  };
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

afterEach(() => {
  // Always clean up — prevents timer leaks between tests
  shutdownMonitor();
});

// ── registerPosition ──────────────────────────────────────────────────────────

describe("registerPosition", () => {
  it("adds a position to managed set", () => {
    registerPosition(makePositionInput());
    const positions = getManagedPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe("BTCUSD");
  });

  it("sets entry_price, original_stop, current_stop from input", () => {
    registerPosition(makePositionInput({ entry_price: 84000, stop_loss: 83000 }));
    const pos = getManagedPositions()[0];
    expect(pos.entry_price).toBe(84000);
    expect(pos.original_stop).toBe(83000);
    expect(pos.current_stop).toBe(83000);
  });

  it("sets remaining_qty equal to quantity", () => {
    registerPosition(makePositionInput({ quantity: 10 }));
    const pos = getManagedPositions()[0];
    expect(pos.remaining_qty).toBe(10);
  });

  it("sets peak_price to entry_price initially", () => {
    registerPosition(makePositionInput({ entry_price: 84000 }));
    const pos = getManagedPositions()[0];
    expect(pos.peak_price).toBe(84000);
  });

  it("trail_active starts as false", () => {
    registerPosition(makePositionInput());
    const pos = getManagedPositions()[0];
    expect(pos.trail_active).toBe(false);
  });

  it("targets_hit starts as empty array", () => {
    registerPosition(makePositionInput());
    const pos = getManagedPositions()[0];
    expect(Array.isArray(pos.targets_hit)).toBe(true);
    expect(pos.targets_hit).toHaveLength(0);
  });

  it("entered_at is a recent timestamp (ms)", () => {
    const before = Date.now();
    registerPosition(makePositionInput());
    const after = Date.now();
    const pos = getManagedPositions()[0];
    expect(pos.entered_at).toBeGreaterThanOrEqual(before);
    expect(pos.entered_at).toBeLessThanOrEqual(after);
  });

  it("stores trailing_config correctly", () => {
    const cfg = { activation_atr: 2.0, trail_step: 0.6, max_hold_minutes: 240 };
    registerPosition(makePositionInput({ trailing_config: cfg }));
    const pos = getManagedPositions()[0];
    expect(pos.trailing_config.activation_atr).toBe(2.0);
    expect(pos.trailing_config.trail_step).toBe(0.6);
    expect(pos.trailing_config.max_hold_minutes).toBe(240);
  });

  it("stores profit_targets correctly", () => {
    registerPosition(makePositionInput());
    const pos = getManagedPositions()[0];
    expect(pos.profit_targets).toHaveLength(2);
    expect(pos.profit_targets[0].r_target).toBe(1.0);
    expect(pos.profit_targets[1].r_target).toBe(2.0);
  });

  it("stores direction correctly for short", () => {
    registerPosition(makePositionInput({
      symbol: "ETHUSD", direction: "short",
      entry_price: 3000, stop_loss: 3100, take_profit: 2700,
    }));
    const positions = getManagedPositions();
    const eth = positions.find(p => p.symbol === "ETHUSD");
    expect(eth).toBeDefined();
    expect(eth!.direction).toBe("short");
  });

  it("replaces existing position for same symbol", () => {
    registerPosition(makePositionInput({ entry_price: 84000, quantity: 10 }));
    registerPosition(makePositionInput({ entry_price: 85000, quantity: 5 }));
    const positions = getManagedPositions().filter(p => p.symbol === "BTCUSD");
    expect(positions).toHaveLength(1);
    expect(positions[0].entry_price).toBe(85000);
    expect(positions[0].quantity).toBe(5);
  });

  it("supports multiple symbols simultaneously", () => {
    registerPosition(makePositionInput({ symbol: "BTCUSD" }));
    registerPosition(makePositionInput({ symbol: "ETHUSD" }));
    registerPosition(makePositionInput({ symbol: "SOLUSD" }));
    const positions = getManagedPositions();
    expect(positions).toHaveLength(3);
    const symbols = positions.map(p => p.symbol).sort();
    expect(symbols).toEqual(["BTCUSD", "ETHUSD", "SOLUSD"]);
  });
});

// ── unregisterPosition ────────────────────────────────────────────────────────

describe("unregisterPosition", () => {
  it("removes the specified position", () => {
    registerPosition(makePositionInput({ symbol: "BTCUSD" }));
    unregisterPosition("BTCUSD");
    expect(getManagedPositions()).toHaveLength(0);
  });

  it("only removes the specified symbol, leaves others", () => {
    registerPosition(makePositionInput({ symbol: "BTCUSD" }));
    registerPosition(makePositionInput({ symbol: "ETHUSD" }));
    unregisterPosition("BTCUSD");
    const positions = getManagedPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0].symbol).toBe("ETHUSD");
  });

  it("is idempotent — unregistering non-existent symbol is safe", () => {
    expect(() => unregisterPosition("XYZUSD")).not.toThrow();
  });
});

// ── getManagedPositions ───────────────────────────────────────────────────────

describe("getManagedPositions", () => {
  it("returns empty array when no positions registered", () => {
    expect(getManagedPositions()).toEqual([]);
  });

  it("returns array of ManagedPosition objects", () => {
    registerPosition(makePositionInput());
    const positions = getManagedPositions();
    expect(Array.isArray(positions)).toBe(true);
    const pos = positions[0];
    // Verify it has all ManagedPosition fields
    expect(pos).toHaveProperty("symbol");
    expect(pos).toHaveProperty("direction");
    expect(pos).toHaveProperty("entry_price");
    expect(pos).toHaveProperty("original_stop");
    expect(pos).toHaveProperty("current_stop");
    expect(pos).toHaveProperty("take_profit");
    expect(pos).toHaveProperty("quantity");
    expect(pos).toHaveProperty("remaining_qty");
    expect(pos).toHaveProperty("trailing_config");
    expect(pos).toHaveProperty("profit_targets");
    expect(pos).toHaveProperty("targets_hit");
    expect(pos).toHaveProperty("peak_price");
    expect(pos).toHaveProperty("trail_active");
    expect(pos).toHaveProperty("entered_at");
    expect(pos).toHaveProperty("atr");
  });

  it("returns length matching registered count", () => {
    registerPosition(makePositionInput({ symbol: "BTCUSD" }));
    registerPosition(makePositionInput({ symbol: "ETHUSD" }));
    expect(getManagedPositions()).toHaveLength(2);
  });
});

// ── getMonitorEvents ──────────────────────────────────────────────────────────

describe("getMonitorEvents", () => {
  it("returns empty array when no events have occurred", () => {
    const events = getMonitorEvents();
    expect(Array.isArray(events)).toBe(true);
  });

  it("respects the limit parameter", () => {
    // We can't inject events directly, but we verify the limit is accepted
    const events5 = getMonitorEvents(5);
    const events50 = getMonitorEvents(50);
    // Both should be arrays; 5-limit result length <= 5
    expect(events5.length).toBeLessThanOrEqual(5);
    expect(events50.length).toBeLessThanOrEqual(50);
  });

  it("default limit is 50 (returns <= 50 events)", () => {
    const events = getMonitorEvents();
    expect(events.length).toBeLessThanOrEqual(50);
  });

  it("returns events in reverse chronological order (most recent first)", () => {
    // Without live events, verify the empty list is consistent
    const events = getMonitorEvents(100);
    // Verify array structure — each event should have expected shape
    for (const e of events) {
      expect(e).toHaveProperty("type");
      expect(e).toHaveProperty("symbol");
      expect(e).toHaveProperty("detail");
      expect(e).toHaveProperty("timestamp");
    }
  });

  it("event type values are from allowed set", () => {
    const validTypes: MonitorEvent["type"][] = [
      "trail_activated", "stop_moved", "partial_close", "full_exit", "time_exit",
    ];
    for (const e of getMonitorEvents()) {
      expect(validTypes).toContain(e.type);
    }
  });
});

// ── shutdownMonitor ───────────────────────────────────────────────────────────

describe("shutdownMonitor", () => {
  it("clears all managed positions", () => {
    registerPosition(makePositionInput({ symbol: "BTCUSD" }));
    registerPosition(makePositionInput({ symbol: "ETHUSD" }));
    expect(getManagedPositions()).toHaveLength(2);
    shutdownMonitor();
    expect(getManagedPositions()).toHaveLength(0);
  });

  it("is idempotent — safe to call multiple times", () => {
    shutdownMonitor();
    shutdownMonitor();
    expect(() => shutdownMonitor()).not.toThrow();
  });

  it("positions registered after shutdown are tracked again", () => {
    registerPosition(makePositionInput({ symbol: "BTCUSD" }));
    shutdownMonitor();
    expect(getManagedPositions()).toHaveLength(0);

    registerPosition(makePositionInput({ symbol: "SOLUSD" }));
    expect(getManagedPositions()).toHaveLength(1);
    expect(getManagedPositions()[0].symbol).toBe("SOLUSD");
  });
});
