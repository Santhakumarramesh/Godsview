/**
 * execution_ledger.test.ts — Phase 28 Tests: Execution Ledger + Broker Reconciliation
 *
 * 25+ tests covering:
 * - Ledger CRUD operations
 * - Lifecycle state transitions
 * - Invalid transitions
 * - Reconciliation with clean data
 * - Reconciliation with all 5 mismatch types
 * - Daily reports
 * - Query filters
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock dependencies
vi.mock("../lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../lib/drawdown_breaker", () => ({
  recordRealizedPnl: vi.fn(),
  getBreakerSnapshot: vi.fn(() => ({
    level: "NORMAL",
    position_size_multiplier: 1.0,
  })),
  getPositionSizeMultiplier: vi.fn(() => 1.0),
  isCooldownActive: vi.fn(() => false),
  resetBreaker: vi.fn(),
  updateUnrealizedPnl: vi.fn(),
  setPeakEquity: vi.fn(),
}));

vi.mock("../lib/risk_engine", () => ({
  riskEngine: {
    checkPositionRisk: vi.fn(),
    getPositionPnl: vi.fn(),
  },
}));

import {
  executionLedgerStore,
  reconciliationService,
  type ExecutionLedgerEntry,
  type OrderLifecycleStatus,
  type BrokerOrder,
  type BrokerPosition,
} from "../lib/execution_ledger/index";

describe("Execution Ledger Store", () => {
  beforeEach(() => {
    executionLedgerStore._clearLedger();
    reconciliationService._clearReconciliations();
  });

  afterEach(() => {
    executionLedgerStore._clearLedger();
    reconciliationService._clearReconciliations();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LEDGER CRUD TESTS
  // ══════════════════════════════════════════════════════════════════════════

  it("should create a new ledger entry with initial state", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    expect(entry).toBeDefined();
    expect(entry.entry_id).toMatch(/^el_/);
    expect(entry.strategy_id).toBe("strat_1");
    expect(entry.symbol).toBe("AAPL");
    expect(entry.side).toBe("buy");
    expect(entry.quantity).toBe(100);
    expect(entry.signal_price).toBe(150.0);
    expect(entry.order_lifecycle_status).toBe("signal_created");
    expect(entry.internal_order_id).toMatch(/^io_/);
    expect(entry.fill_quantity).toBe(0);
    expect(entry.slippage_bps).toBe(0);
  });

  it("should include metadata in created entry if provided", () => {
    const metadata = { custom_field: "test_value" };
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
      metadata,
    });

    expect(entry.metadata).toEqual(metadata);
  });

  it("should retrieve entry by ID", () => {
    const created = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    const retrieved = executionLedgerStore.getEntry(created.entry_id);
    expect(retrieved).toBeDefined();
    expect(retrieved?.entry_id).toBe(created.entry_id);
    expect(retrieved?.symbol).toBe("AAPL");
  });

  it("should return null for non-existent entry", () => {
    const entry = executionLedgerStore.getEntry("nonexistent");
    expect(entry).toBeNull();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  it("should transition from signal_created to approval_passed", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    const updated = executionLedgerStore.updateEntryStatus(
      entry.entry_id,
      "approval_passed"
    );

    expect(updated).toBeDefined();
    expect(updated?.order_lifecycle_status).toBe("approval_passed");
    expect(updated?.timestamps.approval_passed).toBeDefined();
  });

  it("should transition through full approval → submission → broker acceptance → fill", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    let current = entry;

    // signal_created → approval_passed
    current = executionLedgerStore.updateEntryStatus(current.entry_id, "approval_passed")!;
    expect(current.order_lifecycle_status).toBe("approval_passed");

    // approval_passed → order_submitted
    current = executionLedgerStore.updateEntryStatus(current.entry_id, "order_submitted", {
      submitted_price: 149.5,
    })!;
    expect(current.order_lifecycle_status).toBe("order_submitted");
    expect(current.submitted_price).toBe(149.5);

    // order_submitted → broker_accepted
    current = executionLedgerStore.updateEntryStatus(current.entry_id, "broker_accepted", {
      broker_order_id: "BO_123",
    })!;
    expect(current.order_lifecycle_status).toBe("broker_accepted");
    expect(current.broker_order_id).toBe("BO_123");

    // broker_accepted → filled
    current = executionLedgerStore.updateEntryStatus(current.entry_id, "filled", {
      fill_price: 149.75,
      fill_quantity: 100,
    })!;
    expect(current.order_lifecycle_status).toBe("filled");
    expect(current.fill_price).toBe(149.75);
    expect(current.fill_quantity).toBe(100);
  });

  it("should calculate slippage when submitted_price is provided", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    const updated = executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted", {
      submitted_price: 151.5,
    });

    expect(updated?.slippage_bps).toBe(100); // 1.5 / 150 = 1% = 100 bps
  });

  it("should handle negative slippage (favorable fill)", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    const updated = executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted", {
      submitted_price: 148.5,
    });

    expect(updated?.slippage_bps).toBe(-100); // -1.5 / 150 = -1% = -100 bps
  });

  // ══════════════════════════════════════════════════════════════════════════
  // INVALID TRANSITIONS
  // ══════════════════════════════════════════════════════════════════════════

  it("should reject invalid state transition (signal_created → filled)", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    const result = executionLedgerStore.updateEntryStatus(entry.entry_id, "filled");
    expect(result).toBeNull();
  });

  it("should reject backward transition (approval_passed → signal_created)", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    const result = executionLedgerStore.updateEntryStatus(entry.entry_id, "signal_created");
    expect(result).toBeNull();
  });

  it("should allow partial fill followed by complete fill", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });

    // Partial fill 50 shares
    let current = executionLedgerStore.updateEntryStatus(entry.entry_id, "partially_filled", {
      fill_quantity: 50,
      fill_price: 149.8,
    });
    expect(current?.order_lifecycle_status).toBe("partially_filled");
    expect(current?.fill_quantity).toBe(50);

    // Complete remaining 50 shares
    current = executionLedgerStore.updateEntryStatus(entry.entry_id, "filled", {
      fill_quantity: 100,
      fill_price: 149.9,
    });
    expect(current?.order_lifecycle_status).toBe("filled");
    expect(current?.fill_quantity).toBe(100);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // QUERY TESTS
  // ══════════════════════════════════════════════════════════════════════════

  it("should filter entries by strategy", () => {
    executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.createEntry({
      strategy_id: "strat_2",
      symbol: "MSFT",
      side: "sell",
      quantity: 50,
      signal_price: 300.0,
      decision_packet_id: "dp_2",
      session_id: "sess_1",
    });

    const strat1Entries = executionLedgerStore.getEntriesByStrategy("strat_1");
    const strat2Entries = executionLedgerStore.getEntriesByStrategy("strat_2");

    expect(strat1Entries.length).toBe(1);
    expect(strat1Entries[0].symbol).toBe("AAPL");

    expect(strat2Entries.length).toBe(1);
    expect(strat2Entries[0].symbol).toBe("MSFT");
  });

  it("should filter entries by symbol", () => {
    executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.createEntry({
      strategy_id: "strat_2",
      symbol: "AAPL",
      side: "sell",
      quantity: 50,
      signal_price: 150.0,
      decision_packet_id: "dp_2",
      session_id: "sess_1",
    });

    const aaplEntries = executionLedgerStore.getEntriesBySymbol("AAPL");
    expect(aaplEntries.length).toBe(2);
    expect(aaplEntries.every((e) => e.symbol === "AAPL")).toBe(true);
  });

  it("should filter entries by status", () => {
    const entry1 = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    const entry2 = executionLedgerStore.createEntry({
      strategy_id: "strat_2",
      symbol: "MSFT",
      side: "sell",
      quantity: 50,
      signal_price: 300.0,
      decision_packet_id: "dp_2",
      session_id: "sess_1",
    });

    // Advance entry1 to approval_passed
    executionLedgerStore.updateEntryStatus(entry1.entry_id, "approval_passed");

    const signalCreated = executionLedgerStore.getEntriesByStatus("signal_created");
    const approvalPassed = executionLedgerStore.getEntriesByStatus("approval_passed");

    expect(signalCreated.length).toBe(1);
    expect(signalCreated[0].entry_id).toBe(entry2.entry_id);

    expect(approvalPassed.length).toBe(1);
    expect(approvalPassed[0].entry_id).toBe(entry1.entry_id);
  });

  it("should return open entries (not closed)", () => {
    const entry1 = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    const entry2 = executionLedgerStore.createEntry({
      strategy_id: "strat_2",
      symbol: "MSFT",
      side: "sell",
      quantity: 50,
      signal_price: 300.0,
      decision_packet_id: "dp_2",
      session_id: "sess_1",
    });

    // Fill entry2
    executionLedgerStore.updateEntryStatus(entry2.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry2.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry2.entry_id, "broker_accepted");
    executionLedgerStore.updateEntryStatus(entry2.entry_id, "filled");

    const open = executionLedgerStore.getOpenEntries();
    expect(open.length).toBe(1);
    expect(open[0].entry_id).toBe(entry1.entry_id);
  });

  it("should return all entries", () => {
    executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.createEntry({
      strategy_id: "strat_2",
      symbol: "MSFT",
      side: "sell",
      quantity: 50,
      signal_price: 300.0,
      decision_packet_id: "dp_2",
      session_id: "sess_1",
    });

    const all = executionLedgerStore.getAllEntries();
    expect(all.length).toBe(2);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RECONCILIATION TESTS
  // ══════════════════════════════════════════════════════════════════════════

  it("should run reconciliation with clean data (no mismatches)", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });
    executionLedgerStore.updateEntryStatus(entry.entry_id, "filled", {
      fill_quantity: 100,
      fill_price: 150.0,
    });

    const brokerOrders: BrokerOrder[] = [
      {
        broker_order_id: "BO_1",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        fill_price: 150.0,
        status: "filled",
      },
    ];

    const brokerPositions: BrokerPosition[] = [
      {
        symbol: "AAPL",
        quantity: 100,
        avg_fill_price: 150.0,
      },
    ];

    const result = reconciliationService.runReconciliation(brokerOrders, brokerPositions);

    expect(result.recon_id).toMatch(/^recon_/);
    expect(result.status).toBe("clean");
    expect(result.mismatches_found).toBe(0);
    expect(result.entries_checked).toBe(1);
  });

  it("should detect missing_order mismatch", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });

    // No broker order for BO_1
    const brokerOrders: BrokerOrder[] = [];
    const brokerPositions: BrokerPosition[] = [];

    const result = reconciliationService.runReconciliation(brokerOrders, brokerPositions);

    expect(result.status).toBe("issues_found");
    expect(result.mismatches_found).toBe(1);
    expect(result.mismatches[0].type).toBe("missing_order");
    expect(result.mismatches[0].severity).toBe("high");
  });

  it("should detect quantity_mismatch", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });
    executionLedgerStore.updateEntryStatus(entry.entry_id, "partially_filled", {
      fill_quantity: 75,
      fill_price: 150.0,
    });

    // Broker shows different quantity
    const brokerOrders: BrokerOrder[] = [
      {
        broker_order_id: "BO_1",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 50, // Mismatch: internal=75, broker=50
        fill_price: 150.0,
        status: "partially_filled",
      },
    ];

    const brokerPositions: BrokerPosition[] = [];

    const result = reconciliationService.runReconciliation(brokerOrders, brokerPositions);

    expect(result.status).toBe("issues_found");
    expect(result.mismatches.some((m) => m.type === "quantity_mismatch")).toBe(true);
  });

  it("should detect fill_price_mismatch", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });
    executionLedgerStore.updateEntryStatus(entry.entry_id, "filled", {
      fill_quantity: 100,
      fill_price: 150.0,
    });

    // Broker shows different price
    const brokerOrders: BrokerOrder[] = [
      {
        broker_order_id: "BO_1",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        fill_price: 150.5, // Mismatch: internal=150.0, broker=150.5
        status: "filled",
      },
    ];

    const brokerPositions: BrokerPosition[] = [];

    const result = reconciliationService.runReconciliation(brokerOrders, brokerPositions);

    expect(result.status).toBe("issues_found");
    expect(result.mismatches.some((m) => m.type === "fill_price_mismatch")).toBe(true);
  });

  it("should detect position_mismatch", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });
    executionLedgerStore.updateEntryStatus(entry.entry_id, "filled", {
      fill_quantity: 100,
      fill_price: 150.0,
    });

    // Broker shows different position
    const brokerOrders: BrokerOrder[] = [
      {
        broker_order_id: "BO_1",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        fill_price: 150.0,
        status: "filled",
      },
    ];

    const brokerPositions: BrokerPosition[] = [
      {
        symbol: "AAPL",
        quantity: 50, // Mismatch: internal=100, broker=50
        avg_fill_price: 150.0,
      },
    ];

    const result = reconciliationService.runReconciliation(brokerOrders, brokerPositions);

    expect(result.status).toBe("issues_found");
    expect(result.mismatches.some((m) => m.type === "position_mismatch")).toBe(true);
    expect(result.mismatches.find((m) => m.type === "position_mismatch")?.severity).toBe(
      "critical"
    );
  });

  it("should detect stale_state mismatch for orders stuck > 1 hour", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });

    // Manually set old timestamp (simulate stuck order)
    const entryRef = executionLedgerStore.getEntry(entry.entry_id)!;
    entryRef.timestamps.broker_accepted = Date.now() - 3700000; // 61+ minutes ago

    const brokerOrders: BrokerOrder[] = [
      {
        broker_order_id: "BO_1",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 0,
        status: "pending",
      },
    ];

    const result = reconciliationService.runReconciliation(brokerOrders, []);

    expect(result.mismatches.some((m) => m.type === "stale_state")).toBe(true);
  });

  it("should get reconciliation by ID", () => {
    const result = reconciliationService.runReconciliation([], []);
    const retrieved = reconciliationService.getReconciliation(result.recon_id);

    expect(retrieved).toBeDefined();
    expect(retrieved?.recon_id).toBe(result.recon_id);
  });

  it("should return null for non-existent reconciliation", () => {
    const result = reconciliationService.getReconciliation("nonexistent");
    expect(result).toBeNull();
  });

  it("should get open mismatches", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });

    reconciliationService.runReconciliation([], []);

    const mismatches = reconciliationService.getOpenMismatches();
    expect(mismatches.length).toBeGreaterThan(0);
    expect(mismatches[0].mismatch_id).toMatch(/^mm_/);
  });

  it("should generate daily report", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });
    executionLedgerStore.updateEntryStatus(entry.entry_id, "filled", {
      fill_quantity: 100,
      fill_price: 150.0,
    });

    // Clean reconciliation
    reconciliationService.runReconciliation(
      [
        {
          broker_order_id: "BO_1",
          symbol: "AAPL",
          side: "buy",
          quantity: 100,
          filled_quantity: 100,
          fill_price: 150.0,
          status: "filled",
        },
      ],
      [
        {
          symbol: "AAPL",
          quantity: 100,
          avg_fill_price: 150.0,
        },
      ]
    );

    const report = reconciliationService.getDailyReport();

    expect(report.date).toBeDefined();
    expect(report.reconciliations_run).toBe(1);
    expect(report.total_entries_checked).toBe(1);
    expect(report.total_mismatches).toBe(0);
    expect(report.last_clean_run).toBeDefined();
  });

  it("should track critical mismatches in daily report", () => {
    const entry = executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    executionLedgerStore.updateEntryStatus(entry.entry_id, "approval_passed");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "order_submitted");
    executionLedgerStore.updateEntryStatus(entry.entry_id, "broker_accepted", {
      broker_order_id: "BO_1",
    });
    executionLedgerStore.updateEntryStatus(entry.entry_id, "filled", {
      fill_quantity: 100,
      fill_price: 150.0,
    });

    reconciliationService.runReconciliation(
      [
        {
          broker_order_id: "BO_1",
          symbol: "AAPL",
          side: "buy",
          quantity: 100,
          filled_quantity: 100,
          fill_price: 150.0,
          status: "filled",
        },
      ],
      [
        {
          symbol: "AAPL",
          quantity: 50, // Position mismatch = critical
          avg_fill_price: 150.0,
        },
      ]
    );

    const report = reconciliationService.getDailyReport();
    expect(report.critical_severity_count).toBeGreaterThan(0);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CLEAR/RESET TESTS
  // ══════════════════════════════════════════════════════════════════════════

  it("should clear ledger for testing", () => {
    executionLedgerStore.createEntry({
      strategy_id: "strat_1",
      symbol: "AAPL",
      side: "buy",
      quantity: 100,
      signal_price: 150.0,
      decision_packet_id: "dp_1",
      session_id: "sess_1",
    });

    expect(executionLedgerStore.getAllEntries().length).toBe(1);

    executionLedgerStore._clearLedger();

    expect(executionLedgerStore.getAllEntries().length).toBe(0);
  });

  it("should clear reconciliations for testing", () => {
    reconciliationService.runReconciliation([], []);

    expect(reconciliationService.getOpenMismatches().length).toBe(0);

    reconciliationService._clearReconciliations();

    expect(reconciliationService.getOpenMismatches().length).toBe(0);
  });
});
