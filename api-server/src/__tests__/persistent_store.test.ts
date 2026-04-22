/**
 * persistent_store.test.ts — Comprehensive persistence layer tests (Phase 51)
 *
 * Tests for:
 *   - Write and read operations
 *   - Append with max items
 *   - Collection deletion
 *   - Fallback handling
 *   - Promotion gates
 *   - Strategy rollback
 *   - Version history tracking
 *   - Monitor event resolution
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  persistWrite,
  persistRead,
  persistAppend,
  persistDelete,
  listCollections,
  getCollectionSize,
  getStorePath,
} from "../lib/persistent_store.js";
import {
  registerStrategy,
  promoteWithGates,
  rollbackStrategy,
  getVersionHistory,
  getPromotionGates,
  resetRegistry,
  getStrategy,
} from "../lib/strategy_registry_hardened.js";
import {
  saveValidationReport,
  getValidationReports,
  getLatestValidation,
  clearValidationReports,
} from "../engines/validation_store.js";
import {
  recordMonitorEvent,
  getMonitorEvents,
  resolveMonitorEvent,
  getUnresolvedEvents,
  clearMonitorEvents,
} from "../engines/monitor_event_store.js";
import {
  saveOverlaySnapshot,
  getOverlaySnapshots,
  getLatestSnapshot,
  clearOverlaySnapshots,
} from "../engines/overlay_store.js";

// Test directory setup
const TEST_STORE_DIR = path.join(process.cwd(), ".test-runtime", "persistent");

function clearTestStore() {
  try {
    if (fs.existsSync(TEST_STORE_DIR)) {
      fs.rmSync(TEST_STORE_DIR, { recursive: true });
    }
  } catch {}
}

beforeEach(() => {
  process.env.GODSVIEW_DATA_DIR = path.join(process.cwd(), ".test-runtime");
  clearTestStore();
  resetRegistry();
  clearValidationReports();
  clearMonitorEvents();
  clearOverlaySnapshots();
});

afterEach(() => {
  clearTestStore();
});

describe("persistent_store", () => {
  // ─── Basic Operations ──────────────────────────────────────────────────────

  it("should write and read data", () => {
    const testData = { key: "value", number: 42, array: [1, 2, 3] };
    persistWrite("test_collection_1", testData);

    const retrieved = persistRead("test_collection_1", {});
    expect(retrieved).toEqual(testData);
  });

  it("should return fallback for missing collection", () => {
    const fallback = { default: true };
    const result = persistRead("nonexistent_collection", fallback);

    expect(result).toEqual(fallback);
  });

  it("should append items to collection", () => {
    persistWrite("items_001", []);
    persistAppend("items_001", { id: 1, value: "first" });
    persistAppend("items_001", { id: 2, value: "second" });
    persistAppend("items_001", { id: 3, value: "third" });

    const items = persistRead<{ id: number; value: string }[]>("items_001", []);
    expect(items).toHaveLength(3);
    expect(items[0]?.id).toBe(1);
    expect(items[2]?.value).toBe("third");
  });

  it("should respect maxItems limit", () => {
    for (let i = 0; i < 15; i++) {
      persistAppend("limited_001", { index: i }, 10);
    }

    const items = persistRead<{ index: number }[]>("limited_001", []);
    expect(items).toHaveLength(10);
    expect(items[0]?.index).toBe(5);
    expect(items[9]?.index).toBe(14);
  });

  it("should delete collections", () => {
    persistWrite("to_delete_001", [1, 2, 3]);
    expect(persistRead("to_delete_001", [])).toHaveLength(3);

    persistDelete("to_delete_001");
    expect(persistRead("to_delete_001", [])).toHaveLength(0);
  });

  it("should get collection size", () => {
    persistWrite("sized_001", [1, 2, 3, 4, 5]);
    expect(getCollectionSize("sized_001")).toBe(5);

    persistAppend("sized_001", 6);
    expect(getCollectionSize("sized_001")).toBe(6);
  });

  // ─── Strategy Registry + Promotion Gates ────────────────────────────────────

  it("should register strategy and persist", () => {
    const strategy = registerStrategy({
      name: "Test Strategy 1",
      author: "tester",
      tags: ["test"],
    });

    expect(strategy.state).toBe("draft");
    expect(strategy.id).toBeDefined();

    const retrieved = getStrategy(strategy.id);
    expect(retrieved?.name).toBe("Test Strategy 1");
  });

  it("should enforce promotion gates", () => {
    const strategy = registerStrategy({ name: "Test 2" });

    // First promote to parsed (no gates)
    const parsed = promoteWithGates(
      strategy.id,
      "parsed",
      {},
      "test_user",
      "Promote to parsed"
    );
    expect(parsed.success).toBe(true);

    // Try to promote to backtested without enough trades
    const result = promoteWithGates(
      strategy.id,
      "backtested",
      { totalTrades: 5 },
      "test_user",
      "Testing gates"
    );

    expect(result.success).toBe(false);
    expect(result.failedGates.length).toBeGreaterThan(0);

    const unchanged = getStrategy(strategy.id);
    expect(unchanged?.state).toBe("parsed");
  });

  it("should approve promotion when gates pass", () => {
    const strategy = registerStrategy({ name: "Test 3" });

    promoteWithGates(strategy.id, "parsed", {}, "user", "To parsed");

    const result = promoteWithGates(
      strategy.id,
      "backtested",
      { totalTrades: 25 },
      "test_user",
      "Gates passed"
    );

    expect(result.success).toBe(true);
    expect(result.failedGates).toHaveLength(0);

    const promoted = getStrategy(strategy.id);
    expect(promoted?.state).toBe("backtested");
  });

  it("should create version snapshot on promotion", () => {
    const strategy = registerStrategy({ name: "Test 4" });

    promoteWithGates(strategy.id, "parsed", {}, "user1", "To parsed");
    promoteWithGates(
      strategy.id,
      "backtested",
      { totalTrades: 25 },
      "test_user",
      "Test promotion"
    );

    const versions = getVersionHistory(strategy.id);
    expect(versions.length).toBeGreaterThan(0);
    const backtestVersion = versions.find((v) => v.state === "backtested");
    expect(backtestVersion).toBeDefined();
    expect(backtestVersion?.approvedBy).toBe("test_user");
  });

  it("should rollback strategy to previous state", () => {
    const strategy = registerStrategy({ name: "Test 5" });

    promoteWithGates(strategy.id, "parsed", {}, "user1", "To parsed");
    promoteWithGates(
      strategy.id,
      "backtested",
      { totalTrades: 25 },
      "user1",
      "To backtested"
    );

    let current = getStrategy(strategy.id);
    expect(current?.state).toBe("backtested");

    const rollbackResult = rollbackStrategy(strategy.id, "Testing rollback");
    expect(rollbackResult.success).toBe(true);
    expect(rollbackResult.fromState).toBe("backtested");

    current = getStrategy(strategy.id);
    expect(current?.state).toBe("parsed");
  });

  it("should return promotion gates", () => {
    const gates = getPromotionGates();

    expect(gates).toBeInstanceOf(Array);
    expect(gates.length).toBeGreaterThan(0);

    const firstGate = gates[0];
    expect(firstGate?.fromState).toBe("draft");
    expect(firstGate?.toState).toBe("parsed");
  });

  // ─── Validation Reports ────────────────────────────────────────────────────

  it("should save and retrieve validation reports", () => {
    const report = {
      id: "val_001",
      strategyId: "strat_123_v1",
      type: "walk_forward" as const,
      result: "PASS" as const,
      metrics: { sharpe: 1.5, maxDD: 12 },
      details: { passes: 5, failures: 0 },
      createdAt: new Date().toISOString(),
    };

    saveValidationReport(report);

    const retrieved = getValidationReports("strat_123_v1");
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0]?.id).toBe("val_001");
  });

  it("should get latest validation by type", () => {
    const strat = "strat_123_v2";

    saveValidationReport({
      id: "val_001_old",
      strategyId: strat,
      type: "walk_forward",
      result: "FAIL",
      metrics: {},
      details: {},
      createdAt: new Date(Date.now() - 1000).toISOString(),
    });

    saveValidationReport({
      id: "val_001_new",
      strategyId: strat,
      type: "walk_forward",
      result: "PASS",
      metrics: {},
      details: {},
      createdAt: new Date().toISOString(),
    });

    const latest = getLatestValidation(strat, "walk_forward");
    expect(latest?.id).toBe("val_001_new");
    expect(latest?.result).toBe("PASS");
  });

  // ─── Monitor Events ────────────────────────────────────────────────────────

  it("should record and retrieve monitor events", () => {
    const event = {
      id: "evt_001_v1",
      type: "regime_change" as const,
      severity: "warning" as const,
      symbol: "SPY",
      description: "Market regime shifted",
      impact: ["portfolio"],
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    recordMonitorEvent(event);

    const events = getMonitorEvents({ symbol: "SPY" });
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.id === "evt_001_v1")).toBe(true);
  });

  it("should resolve monitor events", () => {
    const event = {
      id: "evt_resolve_001",
      type: "alert" as const,
      severity: "critical" as const,
      description: "Alert",
      impact: [],
      timestamp: new Date().toISOString(),
      resolved: false,
    };

    recordMonitorEvent(event);

    resolveMonitorEvent("evt_resolve_001");

    const unresolvedAfter = getUnresolvedEvents();
    const stillUnresolved = unresolvedAfter.some((e) => e.id === "evt_resolve_001");
    expect(stillUnresolved).toBe(false);
  });

  it("should filter monitor events by severity", () => {
    recordMonitorEvent({
      id: "evt_info_001_unique",
      type: "alert",
      severity: "info",
      description: "Info",
      impact: [],
      timestamp: new Date().toISOString(),
      resolved: false,
    });

    recordMonitorEvent({
      id: "evt_crit_001_unique",
      type: "alert",
      severity: "critical",
      description: "Critical",
      impact: [],
      timestamp: new Date().toISOString(),
      resolved: false,
    });

    const critical = getMonitorEvents({ severity: "critical" });
    expect(critical.some((e) => e.id === "evt_crit_001_unique")).toBe(true);
    expect(critical.every((e) => e.severity === "critical")).toBe(true);
  });

  // ─── Overlay Snapshots ─────────────────────────────────────────────────────

  it("should save and retrieve overlay snapshots", () => {
    const snapshot = {
      id: "snap_001_v1",
      symbol: "SPY",
      timeframe: "1h",
      htfBias: "bullish",
      orderBlockCount: 3,
      keyLevelCount: 5,
      signalCount: 2,
      tradeProbability: { long: 0.7, short: 0.2, neutral: 0.1 },
      createdAt: new Date().toISOString(),
    };

    saveOverlaySnapshot(snapshot);

    const snapshots = getOverlaySnapshots("SPY");
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.htfBias).toBe("bullish");
  });

  it("should get latest snapshot for symbol", () => {
    const now = Date.now();

    saveOverlaySnapshot({
      id: "snap_old_001",
      symbol: "QQQ",
      timeframe: "1h",
      htfBias: "bullish",
      orderBlockCount: 2,
      keyLevelCount: 4,
      signalCount: 1,
      tradeProbability: { long: 0.6, short: 0.3, neutral: 0.1 },
      createdAt: new Date(now - 1000).toISOString(),
    });

    saveOverlaySnapshot({
      id: "snap_new_001",
      symbol: "QQQ",
      timeframe: "1h",
      htfBias: "bearish",
      orderBlockCount: 3,
      keyLevelCount: 5,
      signalCount: 2,
      tradeProbability: { long: 0.3, short: 0.6, neutral: 0.1 },
      createdAt: new Date(now).toISOString(),
    });

    const latest = getLatestSnapshot("QQQ");
    expect(latest?.id).toBe("snap_new_001");
    expect(latest?.htfBias).toBe("bearish");
  });

  it("should limit returned snapshots", () => {
    for (let i = 0; i < 20; i++) {
      saveOverlaySnapshot({
        id: `snap_limit_${i}`,
        symbol: "TSLA",
        timeframe: "1h",
        htfBias: "bullish",
        orderBlockCount: 1,
        keyLevelCount: 2,
        signalCount: 1,
        tradeProbability: { long: 0.5, short: 0.3, neutral: 0.2 },
        createdAt: new Date(Date.now() + i * 100).toISOString(),
      });
    }

    const limited = getOverlaySnapshots("TSLA", 5);
    expect(limited).toHaveLength(5);
  });
});
