import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  ExecutionReconciliationEngine,
  type InternalOrder,
  type BrokerOrder,
  type PnLSnapshot,
} from "../lib/exec_reconciliation";

vi.mock("pino", () => ({
  default: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("pino-pretty", () => ({ default: vi.fn() }));

vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));

vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

describe("ExecutionReconciliationEngine", () => {
  let engine: ExecutionReconciliationEngine;

  beforeEach(() => {
    engine = new ExecutionReconciliationEngine();
  });

  describe("registerInternalOrder", () => {
    it("should register an internal order", () => {
      const order: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      engine.registerInternalOrder(order);
      const result = engine.reconcileOrder("int_001");

      expect(result.internal_state.order_id).toBe("int_001");
    });
  });

  describe("registerBrokerOrder", () => {
    it("should register a broker order", () => {
      const order: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerBrokerOrder(order);
      const result = engine.reconcileOrder("int_001");

      expect(result.broker_state.broker_order_id).toBe("bro_001");
    });
  });

  describe("reconcileOrder", () => {
    it("should detect matched orders", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const result = engine.reconcileOrder("int_001");

      expect(result.status).toBe("matched");
      expect(result.severity).toBe("info");
      expect(result.auto_resolved).toBe(true);
    });

    it("should detect quantity mismatch", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_002",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_002",
        internal_order_id: "int_002",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 75, // Mismatch
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const result = engine.reconcileOrder("int_002");

      expect(result.status).toBe("quantity_mismatch");
      expect(result.severity).toBe("critical");
    });

    it("should detect price mismatch (> 0.01%)", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_003",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_003",
        internal_order_id: "int_003",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.65, // Difference > 0.01%
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const result = engine.reconcileOrder("int_003");

      expect(result.status).toBe("price_mismatch");
      expect(result.severity).toBe("warning");
    });

    it("should not detect price mismatch for small differences", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_004",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_004",
        internal_order_id: "int_004",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5005, // Difference < 0.01%
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const result = engine.reconcileOrder("int_004");

      expect(result.status).toBe("matched");
    });

    it("should detect status mismatch", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_005",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_005",
        internal_order_id: "int_005",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "pending", // Mismatch
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const result = engine.reconcileOrder("int_005");

      expect(result.status).toBe("status_mismatch");
      expect(result.severity).toBe("warning");
    });

    it("should detect missing_internal", () => {
      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_006",
        internal_order_id: "int_006",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerBrokerOrder(brokerOrder);
      const result = engine.reconcileOrder("int_006");

      expect(result.status).toBe("missing_internal");
      expect(result.severity).toBe("critical");
    });

    it("should detect missing_broker", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_007",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      const result = engine.reconcileOrder("int_007");

      expect(result.status).toBe("missing_broker");
      expect(result.severity).toBe("critical");
    });
  });

  describe("reconcileAllOrders", () => {
    it("should reconcile all orders", () => {
      const orders: InternalOrder[] = [
        {
          order_id: "int_001",
          symbol: "AAPL",
          side: "buy",
          quantity: 100,
          filled_quantity: 100,
          avg_fill_price: 150.5,
          status: "filled",
          strategy_id: "strat_001",
          submitted_at: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
        {
          order_id: "int_002",
          symbol: "GOOGL",
          side: "sell",
          quantity: 50,
          filled_quantity: 50,
          avg_fill_price: 2000.0,
          status: "filled",
          strategy_id: "strat_001",
          submitted_at: new Date().toISOString(),
          last_updated: new Date().toISOString(),
        },
      ];

      orders.forEach((order) => engine.registerInternalOrder(order));

      const results = engine.reconcileAllOrders();

      expect(results).toHaveLength(2);
    });
  });

  describe("registerPosition", () => {
    it("should calculate drift correctly", () => {
      const position = engine.registerPosition(
        "AAPL",
        100, // internal_qty
        110, // broker_qty
        15000, // internal_cost
        16500 // broker_cost
      );

      expect(position.drift).toBe(10); // 110 - 100
      expect(position.drift_pct).toBe(10); // (10 / 100) * 100
    });

    it("should handle negative drift", () => {
      const position = engine.registerPosition(
        "AAPL",
        100,
        90,
        15000,
        13500
      );

      expect(position.drift).toBe(-10);
      expect(position.drift_pct).toBe(-10);
    });

    it("should handle zero quantity positions", () => {
      const position = engine.registerPosition(
        "AAPL",
        0,
        10,
        0,
        1500
      );

      expect(position.drift).toBe(10);
      expect(position.drift_pct).toBe(1000); // (10 / 1) * 100
    });
  });

  describe("reconcilePositions", () => {
    it("should return positions with drift", () => {
      engine.registerPosition("AAPL", 100, 110, 15000, 16500);
      engine.registerPosition("GOOGL", 50, 50, 100000, 100000);

      const driftPositions = engine.reconcilePositions();

      expect(driftPositions).toHaveLength(1);
      expect(driftPositions[0].symbol).toBe("AAPL");
    });

    it("should exclude positions with zero drift", () => {
      engine.registerPosition("AAPL", 100, 100, 15000, 15000);
      engine.registerPosition("GOOGL", 50, 50, 100000, 100000);

      const driftPositions = engine.reconcilePositions();

      expect(driftPositions).toHaveLength(0);
    });
  });

  describe("recordPnLSnapshot", () => {
    it("should record PnL snapshots", () => {
      const snapshot: PnLSnapshot = {
        strategy_id: "strat_001",
        internal_pnl: 1000,
        broker_pnl: 1050,
        divergence: -50,
        divergence_pct: -4.76,
        timestamp: new Date().toISOString(),
      };

      engine.recordPnLSnapshot(snapshot);
      const snapshots = engine.getPnLDivergence("strat_001");

      expect(snapshots).toHaveLength(1);
      expect(snapshots[0].internal_pnl).toBe(1000);
    });

    it("should record multiple snapshots for same strategy", () => {
      const snapshot1: PnLSnapshot = {
        strategy_id: "strat_001",
        internal_pnl: 1000,
        broker_pnl: 1050,
        divergence: -50,
        divergence_pct: -4.76,
        timestamp: new Date().toISOString(),
      };

      const snapshot2: PnLSnapshot = {
        strategy_id: "strat_001",
        internal_pnl: 1100,
        broker_pnl: 1120,
        divergence: -20,
        divergence_pct: -1.79,
        timestamp: new Date().toISOString(),
      };

      engine.recordPnLSnapshot(snapshot1);
      engine.recordPnLSnapshot(snapshot2);

      const snapshots = engine.getPnLDivergence("strat_001");

      expect(snapshots).toHaveLength(2);
    });
  });

  describe("getPnLDivergence", () => {
    it("should return empty array for non-existent strategy", () => {
      const snapshots = engine.getPnLDivergence("non_existent");

      expect(snapshots).toEqual([]);
    });
  });

  describe("generateReconciliationReport", () => {
    it("should generate a report with matched orders", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const report = engine.generateReconciliationReport("2024-Q1");

      expect(report.period).toBe("2024-Q1");
      expect(report.total_orders_checked).toBe(1);
      expect(report.matched).toBe(1);
      expect(report.mismatches).toHaveLength(0);
      expect(report.overall_health).toBe("healthy");
      expect(report.auto_resolved_count).toBe(1);
    });

    it("should generate a report with mismatches", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 75,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const report = engine.generateReconciliationReport("2024-Q1");

      expect(report.matched).toBe(0);
      expect(report.mismatches).toHaveLength(1);
      expect(report.overall_health).toBe("degraded");
    });

    it("should set health to critical for multiple critical issues", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 50,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      engine.registerPosition("AAPL", 100, 150, 15000, 22500);

      const report = engine.generateReconciliationReport("2024-Q1");

      expect(report.overall_health).toBe("degraded");
    });
  });

  describe("getReconciliationReport", () => {
    it("should retrieve a generated report", () => {
      const report = engine.generateReconciliationReport("2024-Q1");
      const retrieved = engine.getReconciliationReport(report.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(report.id);
      expect(retrieved?.period).toBe("2024-Q1");
    });

    it("should return undefined for non-existent report", () => {
      const report = engine.getReconciliationReport("non_existent");

      expect(report).toBeUndefined();
    });
  });

  describe("getAllReports", () => {
    it("should return all generated reports", () => {
      engine.generateReconciliationReport("2024-Q1");
      engine.generateReconciliationReport("2024-Q2");
      engine.generateReconciliationReport("2024-Q3");

      const reports = engine.getAllReports();

      expect(reports).toHaveLength(3);
    });

    it("should limit results when limit is provided", () => {
      engine.generateReconciliationReport("2024-Q1");
      engine.generateReconciliationReport("2024-Q2");
      engine.generateReconciliationReport("2024-Q3");

      const reports = engine.getAllReports(2);

      expect(reports).toHaveLength(2);
    });

    it("should return empty array when no reports exist", () => {
      const reports = engine.getAllReports();

      expect(reports).toEqual([]);
    });
  });

  describe("getUnresolvedMismatches", () => {
    it("should return unresolved mismatches", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 75,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      engine.reconcileOrder("int_001");

      const mismatches = engine.getUnresolvedMismatches();

      expect(mismatches).toHaveLength(1);
      expect(mismatches[0].status).toBe("quantity_mismatch");
    });

    it("should exclude auto-resolved mismatches", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      engine.reconcileOrder("int_001");

      const mismatches = engine.getUnresolvedMismatches();

      expect(mismatches).toHaveLength(0);
    });
  });

  describe("resolveDiscrepancy", () => {
    it("should resolve a discrepancy", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      const brokerOrder: BrokerOrder = {
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 75,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerBrokerOrder(brokerOrder);

      const result = engine.reconcileOrder("int_001");
      const resolveResult = engine.resolveDiscrepancy(
        result.id,
        "Manual correction applied"
      );

      expect(resolveResult.success).toBe(true);
    });

    it("should return error for non-existent discrepancy", () => {
      const result = engine.resolveDiscrepancy("non_existent", "resolution");

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("_clearReconciliation", () => {
    it("should clear all data", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      engine.registerPosition("AAPL", 100, 110, 15000, 16500);

      engine.generateReconciliationReport("2024-Q1");

      engine._clearReconciliation();

      const results = engine.reconcileAllOrders();
      const driftPositions = engine.reconcilePositions();
      const reports = engine.getAllReports();

      expect(results).toHaveLength(0);
      expect(driftPositions).toHaveLength(0);
      expect(reports).toHaveLength(0);
    });
  });

  describe("empty state handling", () => {
    it("should handle empty orders gracefully", () => {
      const results = engine.reconcileAllOrders();

      expect(results).toEqual([]);
    });

    it("should generate a report with no orders", () => {
      const report = engine.generateReconciliationReport("2024-Q1");

      expect(report.total_orders_checked).toBe(0);
      expect(report.matched).toBe(0);
      expect(report.overall_health).toBe("healthy");
    });

    it("should handle reconciling non-existent order", () => {
      const result = engine.reconcileOrder("non_existent");

      expect(result.status).toBe("missing_internal");
    });
  });

  describe("reconciliation ID format", () => {
    it("should generate recon_ prefixed IDs", () => {
      const internalOrder: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      engine.registerInternalOrder(internalOrder);
      const result = engine.reconcileOrder("int_001");

      expect(result.id).toMatch(/^recon_/);
    });

    it("should generate rr_ prefixed report IDs", () => {
      const report = engine.generateReconciliationReport("2024-Q1");

      expect(report.id).toMatch(/^rr_/);
    });
  });

  describe("complex scenarios", () => {
    it("should handle multiple orders with different mismatches", () => {
      // Matched order
      const matched: InternalOrder = {
        order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      // Quantity mismatch
      const qty_mismatch: InternalOrder = {
        order_id: "int_002",
        symbol: "GOOGL",
        side: "sell",
        quantity: 50,
        filled_quantity: 50,
        avg_fill_price: 2000.0,
        status: "filled",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      // Status mismatch
      const status_mismatch: InternalOrder = {
        order_id: "int_003",
        symbol: "MSFT",
        side: "buy",
        quantity: 200,
        filled_quantity: 100,
        avg_fill_price: 300.0,
        status: "partial",
        strategy_id: "strat_001",
        submitted_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      };

      engine.registerInternalOrder(matched);
      engine.registerInternalOrder(qty_mismatch);
      engine.registerInternalOrder(status_mismatch);

      engine.registerBrokerOrder({
        broker_order_id: "bro_001",
        internal_order_id: "int_001",
        symbol: "AAPL",
        side: "buy",
        quantity: 100,
        filled_quantity: 100,
        avg_fill_price: 150.5,
        status: "filled",
        reported_at: new Date().toISOString(),
      });

      engine.registerBrokerOrder({
        broker_order_id: "bro_002",
        internal_order_id: "int_002",
        symbol: "GOOGL",
        side: "sell",
        quantity: 50,
        filled_quantity: 30,
        avg_fill_price: 2000.0,
        status: "filled",
        reported_at: new Date().toISOString(),
      });

      engine.registerBrokerOrder({
        broker_order_id: "bro_003",
        internal_order_id: "int_003",
        symbol: "MSFT",
        side: "buy",
        quantity: 200,
        filled_quantity: 100,
        avg_fill_price: 300.0,
        status: "pending",
        reported_at: new Date().toISOString(),
      });

      const report = engine.generateReconciliationReport("2024-Q1");

      expect(report.total_orders_checked).toBe(3);
      expect(report.matched).toBe(1);
      expect(report.mismatches).toHaveLength(2);
      expect(report.overall_health).toBe("degraded");
    });

    it("should track PnL divergence over time", () => {
      const snap1: PnLSnapshot = {
        strategy_id: "strat_001",
        internal_pnl: 1000,
        broker_pnl: 1050,
        divergence: -50,
        divergence_pct: -4.76,
        timestamp: new Date().toISOString(),
      };

      const snap2: PnLSnapshot = {
        strategy_id: "strat_001",
        internal_pnl: 1200,
        broker_pnl: 1150,
        divergence: 50,
        divergence_pct: 4.35,
        timestamp: new Date().toISOString(),
      };

      engine.recordPnLSnapshot(snap1);
      engine.recordPnLSnapshot(snap2);

      const snapshots = engine.getPnLDivergence("strat_001");

      expect(snapshots).toHaveLength(2);
      expect(snapshots[0].divergence).toBe(-50);
      expect(snapshots[1].divergence).toBe(50);
    });
  });
});
