import { describe, it, expect, beforeEach, vi } from "vitest";
import { brokerManager } from "../lib/broker_adapter";

vi.mock("pino", () => ({ default: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }));
vi.mock("pino-pretty", () => ({ default: vi.fn() }));
vi.mock("../../lib/risk_engine", () => ({ evaluateRisk: vi.fn() }));
vi.mock("../../lib/drawdown_breaker", () => ({ checkDrawdown: vi.fn() }));

describe("Broker Manager", () => {
  beforeEach(() => {
    brokerManager._clearBrokers();
  });

  describe("registerBroker", () => {
    it("should register a new broker", () => {
      const result = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities", "options"], {
        api_key: "test",
      });
      expect(result.success).toBe(true);
      expect(result.data?.name).toBe("Alpaca");
      expect(result.data?.type).toBe("alpaca");
      expect(result.data?.priority).toBe(10);
      expect(result.data?.status).toBe("disconnected");
    });

    it("should initialize health with defaults", () => {
      const result = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      expect(result.data?.health.latency_ms).toBe(0);
      expect(result.data?.health.uptime_pct).toBe(100);
      expect(result.data?.health.error_rate).toBe(0);
      expect(result.data?.health.consecutive_failures).toBe(0);
      expect(result.data?.health.circuit_breaker).toBe("closed");
    });

    it("should set registered_at timestamp", () => {
      const before = Date.now();
      const result = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const after = Date.now();

      expect(result.data?.registered_at).toBeGreaterThanOrEqual(before);
      expect(result.data?.registered_at).toBeLessThanOrEqual(after);
    });
  });

  describe("updateBrokerHealth", () => {
    it("should update broker health metrics", () => {
      const registered = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = registered.data?.id ?? "";

      const result = brokerManager.updateBrokerHealth(brokerId, 50, 99.5, 0.1, "timeout");
      expect(result.success).toBe(true);
      expect(result.data?.health.latency_ms).toBe(50);
      expect(result.data?.health.uptime_pct).toBe(99.5);
      expect(result.data?.health.error_rate).toBe(0.1);
      expect(result.data?.health.last_error).toBe("timeout");
    });

    it("should fail for non-existent broker", () => {
      const result = brokerManager.updateBrokerHealth("brk_nonexistent", 50, 99.5, 0.1);
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("updateBrokerStatus", () => {
    it("should update broker status", () => {
      const registered = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = registered.data?.id ?? "";

      const result = brokerManager.updateBrokerStatus(brokerId, "connected");
      expect(result.success).toBe(true);
      expect(result.data?.status).toBe("connected");
    });

    it("should fail for non-existent broker", () => {
      const result = brokerManager.updateBrokerStatus("brk_nonexistent", "connected");
      expect(result.success).toBe(false);
    });
  });

  describe("getBroker", () => {
    it("should retrieve a broker", () => {
      const registered = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = registered.data?.id ?? "";

      const result = brokerManager.getBroker(brokerId);
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(brokerId);
      expect(result.data?.name).toBe("Alpaca");
    });

    it("should fail for non-existent broker", () => {
      const result = brokerManager.getBroker("brk_nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("getAllBrokers", () => {
    it("should return all brokers", () => {
      brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities", "options"], {});

      const result = brokerManager.getAllBrokers();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(2);
    });

    it("should return empty array when no brokers", () => {
      const result = brokerManager.getAllBrokers();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(0);
    });
  });

  describe("getConnectedBrokers", () => {
    it("should return only connected brokers with closed circuit", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.updateBrokerStatus(id1, "connected");
      brokerManager.updateBrokerStatus(id2, "disconnected");

      const result = brokerManager.getConnectedBrokers();
      expect(result.data.length).toBe(1);
      expect(result.data[0].id).toBe(id1);
    });

    it("should exclude brokers with open circuit", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = reg.data?.id ?? "";

      brokerManager.updateBrokerStatus(brokerId, "connected");
      // Trigger circuit breaker
      for (let i = 0; i < 5; i++) {
        brokerManager.triggerCircuitBreaker(brokerId);
      }

      const result = brokerManager.getConnectedBrokers();
      expect(result.data.length).toBe(0);
    });
  });

  describe("recordHeartbeat", () => {
    it("should update last heartbeat and reset failures", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = reg.data?.id ?? "";

      // Trigger some failures
      brokerManager.triggerCircuitBreaker(brokerId);
      brokerManager.triggerCircuitBreaker(brokerId);

      const result = brokerManager.recordHeartbeat(brokerId);
      expect(result.success).toBe(true);
      expect(result.data?.last_heartbeat).toBeDefined();
      expect(result.data?.health.consecutive_failures).toBe(0);
    });

    it("should fail for non-existent broker", () => {
      const result = brokerManager.recordHeartbeat("brk_nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("triggerCircuitBreaker", () => {
    it("should increment consecutive failures", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = reg.data?.id ?? "";

      const result1 = brokerManager.triggerCircuitBreaker(brokerId);
      expect(result1.data?.health.consecutive_failures).toBe(1);
      expect(result1.data?.health.circuit_breaker).toBe("closed");

      const result2 = brokerManager.triggerCircuitBreaker(brokerId);
      expect(result2.data?.health.consecutive_failures).toBe(2);
    });

    it("should open circuit breaker after threshold", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = reg.data?.id ?? "";

      for (let i = 0; i < 5; i++) {
        brokerManager.triggerCircuitBreaker(brokerId);
      }

      const result = brokerManager.getBroker(brokerId);
      expect(result.data?.health.circuit_breaker).toBe("open");
      expect(result.data?.status).toBe("error");
    });

    it("should fail for non-existent broker", () => {
      const result = brokerManager.triggerCircuitBreaker("brk_nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("resetCircuitBreaker", () => {
    it("should reset circuit breaker state", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const brokerId = reg.data?.id ?? "";

      // Open circuit
      for (let i = 0; i < 5; i++) {
        brokerManager.triggerCircuitBreaker(brokerId);
      }

      const result = brokerManager.resetCircuitBreaker(brokerId);
      expect(result.success).toBe(true);
      expect(result.data?.health.circuit_breaker).toBe("closed");
      expect(result.data?.health.consecutive_failures).toBe(0);
      expect(result.data?.status).toBe("connected");
    });

    it("should fail for non-existent broker", () => {
      const result = brokerManager.resetCircuitBreaker("brk_nonexistent");
      expect(result.success).toBe(false);
    });
  });

  describe("setRoute", () => {
    it("should set a symbol route", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      const result = brokerManager.setRoute("AAPL", id1, [id2], "better execution");
      expect(result.success).toBe(true);
      expect(result.data?.symbol).toBe("AAPL");
      expect(result.data?.preferred_broker_id).toBe(id1);
      expect(result.data?.fallback_broker_ids).toContain(id2);
    });

    it("should fail if preferred broker not found", () => {
      const result = brokerManager.setRoute("AAPL", "brk_nonexistent", [], "reason");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should fail if fallback broker not found", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const id = reg.data?.id ?? "";

      const result = brokerManager.setRoute("AAPL", id, ["brk_nonexistent"], "reason");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("getRoute", () => {
    it("should retrieve a route", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.setRoute("AAPL", id1, [id2], "reason");
      const result = brokerManager.getRoute("AAPL");
      expect(result.success).toBe(true);
      expect(result.data?.symbol).toBe("AAPL");
    });

    it("should fail for non-existent route", () => {
      const result = brokerManager.getRoute("AAPL");
      expect(result.success).toBe(false);
    });
  });

  describe("getAllRoutes", () => {
    it("should return all routes", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.setRoute("AAPL", id1, [id2], "reason1");
      brokerManager.setRoute("TSLA", id2, [id1], "reason2");

      const result = brokerManager.getAllRoutes();
      expect(result.success).toBe(true);
      expect(result.data.length).toBe(2);
    });
  });

  describe("routeOrder", () => {
    it("should use explicit route when available", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.updateBrokerStatus(id1, "connected");
      brokerManager.updateBrokerStatus(id2, "connected");

      brokerManager.setRoute("AAPL", id1, [id2], "reason");

      const result = brokerManager.routeOrder("AAPL", "equities");
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(id1);
    });

    it("should fallback to fallback brokers", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.updateBrokerStatus(id1, "disconnected");
      brokerManager.updateBrokerStatus(id2, "connected");

      brokerManager.setRoute("AAPL", id1, [id2], "reason");

      const result = brokerManager.routeOrder("AAPL", "equities");
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(id2);
    });

    it("should use highest priority connected broker without explicit route", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.updateBrokerStatus(id1, "connected");
      brokerManager.updateBrokerStatus(id2, "connected");

      const result = brokerManager.routeOrder("MSFT", "equities");
      expect(result.success).toBe(true);
      expect(result.data?.id).toBe(id1);
    });

    it("should fail if no available broker", () => {
      const reg = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      brokerManager.updateBrokerStatus(reg.data?.id ?? "", "disconnected");

      const result = brokerManager.routeOrder("AAPL", "options");
      expect(result.success).toBe(false);
      expect(result.error).toContain("No available broker");
    });

    it("should exclude brokers with open circuit breaker", () => {
      const reg1 = brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg2 = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      const id1 = reg1.data?.id ?? "";
      const id2 = reg2.data?.id ?? "";

      brokerManager.updateBrokerStatus(id1, "connected");
      brokerManager.updateBrokerStatus(id2, "connected");

      // Open circuit for id1
      for (let i = 0; i < 5; i++) {
        brokerManager.triggerCircuitBreaker(id1);
      }

      const result = brokerManager.routeOrder("AAPL", "equities");
      expect(result.data?.id).toBe(id2);
    });
  });

  describe("_clearBrokers", () => {
    it("should clear all brokers and routes", () => {
      brokerManager.registerBroker("Alpaca", "alpaca", 10, ["equities"], {});
      const reg = brokerManager.registerBroker("IB", "interactive_brokers", 9, ["equities"], {});
      brokerManager.setRoute("AAPL", reg.data?.id ?? "", [], "reason");

      brokerManager._clearBrokers();

      const brokers = brokerManager.getAllBrokers();
      const routes = brokerManager.getAllRoutes();
      expect(brokers.data.length).toBe(0);
      expect(routes.data.length).toBe(0);
    });
  });
});
