import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../lib/risk_engine", () => ({
  isKillSwitchActive: () => false,
}));

vi.mock("../lib/drawdown_breaker", () => ({
  getBreakerSnapshot: () => ({ sizeMultiplier: 1.0 }),
  isCooldownActive: () => false,
}));

import {
  getTerminalLayout,
  CommandPalette,
  WatchlistManager,
  type TerminalLayout,
} from "../lib/terminal/terminal_adapter";
import { TradingViewMCPBridge, type OverlaySignal } from "../lib/terminal/mcp_bridge";

// ──────────────────────────────────────────────────────────────────────────────
// Terminal Layout Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Terminal Layout", () => {
  it("returns a valid terminal layout with all required panels", () => {
    const layout = getTerminalLayout();

    expect(layout).toHaveProperty("id");
    expect(layout).toHaveProperty("name");
    expect(layout).toHaveProperty("panels");
    expect(layout).toHaveProperty("theme");
    expect(layout.theme).toBe("dark");

    const panelNames = layout.panels.map((p) => p.name);
    expect(panelNames).toContain("watchlist");
    expect(panelNames).toContain("macro_news");
    expect(panelNames).toContain("portfolio");
    expect(panelNames).toContain("brain");
    expect(panelNames).toContain("execution");
    expect(panelNames).toContain("alerts");
  });

  it("layout panels have valid positions", () => {
    const layout = getTerminalLayout();
    const validPositions = ["left", "center", "right", "top", "bottom"];

    layout.panels.forEach((panel) => {
      expect(validPositions).toContain(panel.position);
      expect(panel.title).toBeTruthy();
      expect(panel.name).toBeTruthy();
    });
  });

  it("each panel has a refresh interval defined", () => {
    const layout = getTerminalLayout();

    layout.panels.forEach((panel) => {
      expect(panel.refreshIntervalMs).toBeGreaterThan(0);
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Command Palette Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Command Palette", () => {
  let palette: CommandPalette;

  beforeEach(() => {
    palette = new CommandPalette();
  });

  it("registers and retrieves commands", () => {
    palette.registerCommand(
      "test-cmd",
      "Test command",
      "test",
      "test_handler"
    );

    const commands = palette.getCommands();
    expect(commands.length).toBeGreaterThan(0);

    const found = commands.find((c) => c.name === "test-cmd");
    expect(found).toBeDefined();
    expect(found?.category).toBe("test");
    expect(found?.handlerKey).toBe("test_handler");
  });

  it("pre-registers Bloomberg-style commands", () => {
    const commands = palette.getCommands();
    const commandNames = commands.map((c) => c.name);

    // Check for key Bloomberg commands
    expect(commandNames).toContain("kill");
    expect(commandNames).toContain("flatten");
    expect(commandNames).toContain("pause");
    expect(commandNames).toContain("resume");
    expect(commandNames).toContain("status");
    expect(commandNames).toContain("risk");
    expect(commandNames).toContain("exposure");
    expect(commandNames).toContain("positions");
    expect(commandNames).toContain("watchlist");
    expect(commandNames).toContain("alerts");
    expect(commandNames).toContain("brain");
    expect(commandNames).toContain("autonomous");
  });

  it("searches commands by name", () => {
    const results = palette.searchCommands("kill");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].name).toBe("kill");
  });

  it("searches commands by description", () => {
    const results = palette.searchCommands("risk");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((c) => c.name === "risk")).toBe(true);
  });

  it("searches commands by aliases", () => {
    const results = palette.searchCommands("close-all");
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((c) => c.name === "flatten")).toBe(true);
  });

  it("gets command by ID", () => {
    const commands = palette.getCommands();
    const cmd = commands[0];

    const retrieved = palette.getCommand(cmd.id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.id).toBe(cmd.id);
  });

  it("gets command by name including aliases", () => {
    const cmd = palette.getCommandByName("pause");
    expect(cmd).toBeDefined();
    expect(cmd?.name).toBe("pause");

    const cmdByAlias = palette.getCommandByName("health");
    expect(cmdByAlias).toBeDefined();
    expect(cmdByAlias?.name).toBe("status");
  });

  it("returns undefined for non-existent commands", () => {
    const cmd = palette.getCommandByName("nonexistent-command");
    expect(cmd).toBeUndefined();
  });

  it("search is case-insensitive", () => {
    const resultsLower = palette.searchCommands("kill");
    const resultsUpper = palette.searchCommands("KILL");
    const resultsMixed = palette.searchCommands("KiLl");

    expect(resultsLower.length).toBeGreaterThan(0);
    expect(resultsUpper.length).toBe(resultsLower.length);
    expect(resultsMixed.length).toBe(resultsLower.length);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Watchlist Manager Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Watchlist Manager", () => {
  let watchlist: WatchlistManager;

  beforeEach(() => {
    watchlist = new WatchlistManager();
  });

  it("adds symbols to watchlist", () => {
    const added = watchlist.addToWatchlist("BTCUSD");
    expect(added).toBe(true);

    const symbols = watchlist.getWatchlist();
    expect(symbols).toContain("BTCUSD");
  });

  it("normalizes symbols to uppercase", () => {
    watchlist.addToWatchlist("btcusd");
    const symbols = watchlist.getWatchlist();

    expect(symbols).toContain("BTCUSD");
    expect(symbols).not.toContain("btcusd");
  });

  it("prevents duplicate symbols", () => {
    const first = watchlist.addToWatchlist("ETHUSD");
    const second = watchlist.addToWatchlist("ETHUSD");

    expect(first).toBe(true);
    expect(second).toBe(false);

    const symbols = watchlist.getWatchlist();
    expect(symbols.filter((s) => s === "ETHUSD").length).toBe(1);
  });

  it("removes symbols from watchlist", () => {
    watchlist.addToWatchlist("XRPUSD");
    const removed = watchlist.removeFromWatchlist("XRPUSD");

    expect(removed).toBe(true);
    expect(watchlist.getWatchlist()).not.toContain("XRPUSD");
  });

  it("returns false when removing non-existent symbol", () => {
    const removed = watchlist.removeFromWatchlist("NONEXISTENT");
    expect(removed).toBe(false);
  });

  it("checks if symbol is in watchlist", () => {
    watchlist.addToWatchlist("BTCUSD");

    expect(watchlist.hasSymbol("BTCUSD")).toBe(true);
    expect(watchlist.hasSymbol("ETHUSD")).toBe(false);
  });

  it("clears all symbols", () => {
    watchlist.addToWatchlist("BTCUSD");
    watchlist.addToWatchlist("ETHUSD");
    watchlist.addToWatchlist("XRPUSD");

    watchlist._clearAll();
    expect(watchlist.getWatchlist().length).toBe(0);
  });

  it("handles multiple symbols", () => {
    const symbols = ["BTCUSD", "ETHUSD", "XRPUSD", "ADAUSD"];
    symbols.forEach((s) => watchlist.addToWatchlist(s));

    const watchlistSymbols = watchlist.getWatchlist();
    expect(watchlistSymbols.length).toBe(symbols.length);
    symbols.forEach((s) => expect(watchlistSymbols).toContain(s));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// MCP Bridge Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("TradingView MCP Bridge", () => {
  let bridge: TradingViewMCPBridge;

  beforeEach(() => {
    bridge = new TradingViewMCPBridge({ logSignals: false });
  });

  it("processes overlay signals with required fields", () => {
    const overlayData = {
      symbol: "btcusd",
      direction: "long",
      confidence: 0.85,
    };

    const signal = bridge.processOverlaySignal(overlayData);

    expect(signal).toBeDefined();
    expect(signal.id).toMatch(/^sig_/);
    expect(signal.symbol).toBe("BTCUSD"); // normalized
    expect(signal.direction).toBe("long");
    expect(signal.confidence).toBe(0.85);
    expect(signal.timestamp).toBeTruthy();
  });

  it("normalizes symbols to uppercase", () => {
    const signal = bridge.processOverlaySignal({
      symbol: "ethusd",
      direction: "short",
    });

    expect(signal.symbol).toBe("ETHUSD");
  });

  it("clamps confidence to 0-1 range", () => {
    const signal1 = bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
      confidence: 1.5, // over 1
    });
    expect(signal1.confidence).toBe(1.0);

    const signal2 = bridge.processOverlaySignal({
      symbol: "ethusd",
      direction: "short",
      confidence: -0.5, // under 0
    });
    expect(signal2.confidence).toBe(0);
  });

  it("handles optional price fields", () => {
    const signal = bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
      entryPrice: 45000,
      stopLoss: 44000,
      takeProfit: 50000,
    });

    expect(signal.entryPrice).toBe(45000);
    expect(signal.stopLoss).toBe(44000);
    expect(signal.takeProfit).toBe(50000);
  });

  it("rejects signals missing required fields", () => {
    expect(() => {
      bridge.processOverlaySignal({
        direction: "long",
        // missing symbol
      });
    }).toThrow();

    expect(() => {
      bridge.processOverlaySignal({
        symbol: "btcusd",
        // missing direction
      });
    }).toThrow();
  });

  it("rejects invalid direction", () => {
    expect(() => {
      bridge.processOverlaySignal({
        symbol: "btcusd",
        direction: "up", // invalid
      });
    }).toThrow(/Invalid direction/);
  });

  it("tracks signal statistics", () => {
    bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
    });
    bridge.processOverlaySignal({
      symbol: "ethusd",
      direction: "short",
    });

    const state = bridge.getOverlayState();
    expect(state.signalCount).toBe(2);
    expect(state.signals.length).toBe(2);
  });

  it("returns bridge status", () => {
    bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
    });

    const status = bridge.bridgeStatus();

    expect(status.connected).toBe(true); // internal adapter always connected
    expect(status.signalCount).toBe(1);
    expect(status.lastSignalTime).toBeTruthy();
    expect(status.avgProcessingMs).toBeGreaterThanOrEqual(0);
  });

  it("gets recent signals", () => {
    for (let i = 0; i < 5; i++) {
      bridge.processOverlaySignal({
        symbol: `SYM${i}`,
        direction: i % 2 === 0 ? "long" : "short",
      });
    }

    const recent = bridge.getRecentSignals(3);
    expect(recent.length).toBe(3);
  });

  it("buffers signals up to buffer size", () => {
    const bridgeWithSmallBuffer = new TradingViewMCPBridge({
      bufferSize: 3,
      logSignals: false,
    });

    for (let i = 0; i < 5; i++) {
      bridgeWithSmallBuffer.processOverlaySignal({
        symbol: `SYM${i}`,
        direction: "long",
      });
    }

    const state = bridgeWithSmallBuffer.getOverlayState();
    expect(state.signals.length).toBeLessThanOrEqual(3);
  });

  it("updates overlay configuration", () => {
    const initialState = bridge.getOverlayState();
    expect(initialState.config.enabled).toBe(true);

    bridge.updateOverlayConfig({
      enabled: false,
      updateIntervalMs: 5000,
    });

    const updatedState = bridge.getOverlayState();
    expect(updatedState.config.enabled).toBe(false);
    expect(updatedState.config.updateIntervalMs).toBe(5000);
  });

  it("clears signals for testing", () => {
    bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
    });

    expect(bridge.getOverlayState().signalCount).toBe(1);

    bridge._clearSignals();

    expect(bridge.getOverlayState().signalCount).toBe(0);
    expect(bridge.getOverlayState().signals.length).toBe(0);
  });

  it("tracks processing time statistics", () => {
    const startTime = performance.now();

    bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
    });

    const endTime = performance.now();
    const status = bridge.bridgeStatus();

    expect(status.avgProcessingMs).toBeGreaterThanOrEqual(0);
    expect(status.avgProcessingMs).toBeLessThan(endTime - startTime + 100);
  });

  it("handles errors gracefully", () => {
    // Process a valid signal first
    bridge.processOverlaySignal({
      symbol: "btcusd",
      direction: "long",
    });

    // Attempt to process invalid signal - should throw
    expect(() => {
      bridge.processOverlaySignal({
        symbol: "btcusd",
        direction: "invalid", // will trigger error
      });
    }).toThrow(/Invalid direction/);

    // Error should be tracked
    const status = bridge.bridgeStatus();
    expect(status.recentErrors.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Integration Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Terminal Integration", () => {
  it("command palette and watchlist work together", () => {
    const palette = new CommandPalette();
    const watchlist = new WatchlistManager();

    // Get watchlist command
    const watchlistCmd = palette.getCommandByName("watchlist");
    expect(watchlistCmd).toBeDefined();

    // Add symbols to watchlist
    watchlist.addToWatchlist("BTCUSD");
    watchlist.addToWatchlist("ETHUSD");

    // Watchlist available for execution
    const symbols = watchlist.getWatchlist();
    expect(symbols.length).toBe(2);
  });

  it("terminal layout includes all major command categories", () => {
    const palette = new CommandPalette();
    const layout = getTerminalLayout();

    const commands = palette.getCommands();
    const categories = new Set(commands.map((c) => c.category));

    expect(categories.size).toBeGreaterThan(0);
    expect(categories).toContain("control");
    expect(categories).toContain("monitoring");
  });

  it("MCP bridge handles Bloomberg command workflow", () => {
    const bridge = new TradingViewMCPBridge({ logSignals: false });
    const palette = new CommandPalette();

    // Process overlay signal (like /kill command would do)
    const signal = bridge.processOverlaySignal({
      symbol: "PORTFOLIO",
      direction: "neutral", // kill = flatten to neutral
      confidence: 1.0,
    });

    expect(signal).toBeDefined();
    expect(signal.direction).toBe("neutral");

    // Check command exists
    const killCmd = palette.getCommandByName("kill");
    expect(killCmd).toBeDefined();
    expect(killCmd?.category).toBe("control");
  });
});
