import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  eventBusService,
  publishEvent,
  dispatchEvent,
  subscribe,
  unsubscribe,
  getSubscription,
  getSubscriptionsForChannel,
  getAllSubscriptions,
  getEvent,
  getEvents,
  getEventsByCorrelation,
  addRule,
  enableRule,
  disableRule,
  getRule,
  getAllRules,
  deleteRule,
  startReplay,
  getReplay,
  getStats,
  purgeExpiredEvents,
  EventChannel,
  EventPriority,
  SystemEvent,
} from "../lib/event_bus";

// Mock pino and pino-pretty
vi.mock("pino", () => ({
  pino: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("pino-pretty", () => ({
  default: vi.fn(),
}));

describe("EventBusService", () => {
  beforeEach(() => {
    eventBusService._clearEventBus();
  });

  // Test publishing events
  describe("publishEvent", () => {
    it("should publish an event across all channels", () => {
      const event = publishEvent("trade_execution", "TRADE_PLACED", { price: 100 }, "system");
      expect(event.id).toMatch(/^evt_/);
      expect(event.channel).toBe("trade_execution");
      expect(event.type).toBe("TRADE_PLACED");
      expect(event.status).toBe("delivered");
    });

    it("should publish events to multiple channels", () => {
      const e1 = publishEvent("trade_execution", "TRADE_PLACED", { price: 100 }, "system");
      const e2 = publishEvent("order_update", "ORDER_CREATED", { order_id: "123" }, "system");
      const e3 = publishEvent("position_change", "POSITION_UPDATED", { qty: 10 }, "system");

      expect(e1.channel).toBe("trade_execution");
      expect(e2.channel).toBe("order_update");
      expect(e3.channel).toBe("position_change");
    });

    it("should auto-dispatch events", () => {
      const event = publishEvent("risk_alert", "HIGH_RISK", { risk_level: 8 }, "system");
      expect(event.status).toBe("delivered");
      expect(event.dispatched_at).toBeDefined();
      expect(event.delivered_at).toBeDefined();
    });

    it("should support priority levels", () => {
      const critical = publishEvent("risk_alert", "CRITICAL", {}, "system", {
        priority: "critical",
      });
      const high = publishEvent("risk_alert", "HIGH", {}, "system", { priority: "high" });
      const normal = publishEvent("risk_alert", "NORMAL", {}, "system", { priority: "normal" });
      const low = publishEvent("risk_alert", "LOW", {}, "system", { priority: "low" });

      expect(critical.priority).toBe("critical");
      expect(high.priority).toBe("high");
      expect(normal.priority).toBe("normal");
      expect(low.priority).toBe("low");
    });

    it("should support correlation IDs", () => {
      const corrId = "corr_123";
      const event = publishEvent("trade_execution", "TRADE", {}, "system", {
        correlation_id: corrId,
      });
      expect(event.correlation_id).toBe(corrId);
    });

    it("should support expiration times", () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const event = publishEvent("market_data", "PRICE_UPDATE", {}, "system", {
        expires_at: futureTime,
      });
      expect(event.expires_at).toBe(futureTime);
    });

    it("should support metadata", () => {
      const meta = { source: "exchange", version: "1.0" };
      const event = publishEvent("market_data", "PRICE_UPDATE", {}, "system", { metadata: meta });
      expect(event.metadata).toEqual(meta);
    });
  });

  // Test event dispatch
  describe("dispatchEvent", () => {
    it("should dispatch events to subscribers", () => {
      subscribe("trade_execution", "trader1");
      subscribe("trade_execution", "trader2");

      const event = publishEvent("trade_execution", "TRADE", {}, "system");
      const result = dispatchEvent(event.id);

      expect(result.success).toBe(true);
      expect(result.subscribers_notified).toBeGreaterThanOrEqual(0);
    });

    it("should fail for non-existent events", () => {
      const result = dispatchEvent("evt_nonexistent");
      expect(result.success).toBe(false);
      expect(result.subscribers_notified).toBe(0);
    });

    it("should set dispatch and delivery timestamps", () => {
      const event = publishEvent("order_update", "ORDER", {}, "system");
      expect(event.dispatched_at).toBeDefined();
      expect(event.delivered_at).toBeDefined();
    });
  });

  // Test subscriptions
  describe("subscribe", () => {
    it("should create a subscription", () => {
      const sub = subscribe("trade_execution", "trader1");
      expect(sub.id).toMatch(/^sub_/);
      expect(sub.channel).toBe("trade_execution");
      expect(sub.subscriber).toBe("trader1");
      expect(sub.active).toBe(true);
      expect(sub.events_received).toBe(0);
    });

    it("should support subscription filters", () => {
      const filter = { min_amount: 1000 };
      const sub = subscribe("trade_execution", "trader1", filter);
      expect(sub.filter).toEqual(filter);
    });

    it("should increment events_received on dispatch", () => {
      const sub = subscribe("trade_execution", "trader1");
      publishEvent("trade_execution", "TRADE", {}, "system");
      const updated = getSubscription(sub.id);
      expect(updated?.events_received).toBeGreaterThan(0);
    });

    it("should track last_event_at", () => {
      const sub = subscribe("order_update", "trader1");
      publishEvent("order_update", "ORDER", {}, "system");
      const updated = getSubscription(sub.id);
      expect(updated?.last_event_at).toBeDefined();
    });
  });

  // Test unsubscribe
  describe("unsubscribe", () => {
    it("should deactivate a subscription", () => {
      const sub = subscribe("trade_execution", "trader1");
      unsubscribe(sub.id);
      const updated = getSubscription(sub.id);
      expect(updated?.active).toBe(false);
    });

    it("should not notify inactive subscriptions", () => {
      const sub = subscribe("trade_execution", "trader1");
      unsubscribe(sub.id);
      const beforeCount = (getSubscription(sub.id)?.events_received ?? 0) || 0;
      publishEvent("trade_execution", "TRADE", {}, "system");
      const afterCount = (getSubscription(sub.id)?.events_received ?? 0) || 0;
      expect(afterCount).toBe(beforeCount);
    });
  });

  // Test filtering subscriptions by channel
  describe("getSubscriptionsForChannel", () => {
    it("should return subscriptions for a specific channel", () => {
      subscribe("trade_execution", "trader1");
      subscribe("trade_execution", "trader2");
      subscribe("order_update", "trader3");

      const subs = getSubscriptionsForChannel("trade_execution");
      expect(subs).toHaveLength(2);
      expect(subs.every((s) => s.channel === "trade_execution")).toBe(true);
    });

    it("should not return inactive subscriptions", () => {
      const sub1 = subscribe("trade_execution", "trader1");
      const sub2 = subscribe("trade_execution", "trader2");
      unsubscribe(sub1.id);

      const subs = getSubscriptionsForChannel("trade_execution");
      expect(subs).toHaveLength(1);
      expect(subs[0].id).toBe(sub2.id);
    });
  });

  // Test correlation IDs
  describe("getEventsByCorrelation", () => {
    it("should group events by correlation ID", () => {
      const corrId = "corr_456";
      publishEvent("trade_execution", "TRADE_1", {}, "system", { correlation_id: corrId });
      publishEvent("order_update", "ORDER_1", {}, "system", { correlation_id: corrId });
      publishEvent("trade_execution", "TRADE_2", {}, "system", { correlation_id: "other" });

      const events = getEventsByCorrelation(corrId);
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.correlation_id === corrId)).toBe(true);
    });

    it("should return empty for non-existent correlation ID", () => {
      const events = getEventsByCorrelation("corr_nonexistent");
      expect(events).toHaveLength(0);
    });
  });

  // Test event rules
  describe("Event Rules", () => {
    it("should add an event rule", () => {
      const rule = addRule(
        "high_risk_alert",
        "risk_alert",
        { risk_level: { gte: 7 } },
        "forward",
        { target: "operator" }
      );
      expect(rule.id).toMatch(/^rule_/);
      expect(rule.name).toBe("high_risk_alert");
      expect(rule.enabled).toBe(true);
      expect(rule.triggered_count).toBe(0);
    });

    it("should enable and disable rules", () => {
      const rule = addRule(
        "test_rule",
        "market_data",
        {},
        "suppress",
        { suppress_duplicates: true }
      );
      expect(rule.enabled).toBe(true);

      disableRule(rule.id);
      let updated = getRule(rule.id);
      expect(updated?.enabled).toBe(false);

      enableRule(rule.id);
      updated = getRule(rule.id);
      expect(updated?.enabled).toBe(true);
    });

    it("should delete rules", () => {
      const rule = addRule("test_rule", "system_health", {}, "transform", {});
      deleteRule(rule.id);
      const retrieved = getRule(rule.id);
      expect(retrieved).toBeUndefined();
    });

    it("should return all rules", () => {
      addRule("rule1", "trade_execution", {}, "forward", {});
      addRule("rule2", "order_update", {}, "suppress", {});
      addRule("rule3", "position_change", {}, "aggregate", {});

      const rules = getAllRules();
      expect(rules).toHaveLength(3);
    });
  });

  // Test event retrieval
  describe("getEvent and getEvents", () => {
    it("should get event by ID", () => {
      const published = publishEvent("trade_execution", "TRADE", { price: 100 }, "system");
      const retrieved = getEvent(published.id);
      expect(retrieved?.id).toBe(published.id);
      expect(retrieved?.type).toBe("TRADE");
    });

    it("should return undefined for non-existent event", () => {
      const event = getEvent("evt_nonexistent");
      expect(event).toBeUndefined();
    });

    it("should filter events by channel", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("order_update", "ORDER", {}, "system");

      const events = getEvents({ channel: "trade_execution" });
      expect(events.every((e) => e.channel === "trade_execution")).toBe(true);
    });

    it("should filter events by priority", () => {
      publishEvent("risk_alert", "ALERT", {}, "system", { priority: "critical" });
      publishEvent("risk_alert", "ALERT", {}, "system", { priority: "low" });

      const critical = getEvents({ priority: "critical" });
      expect(critical.every((e) => e.priority === "critical")).toBe(true);
    });

    it("should filter events by status", () => {
      const event1 = publishEvent("market_data", "PRICE", {}, "system");
      expect(event1.status).toBe("delivered");

      const events = getEvents({ status: "delivered" });
      expect(events.every((e) => e.status === "delivered")).toBe(true);
    });

    it("should limit event results", () => {
      publishEvent("market_data", "PRICE", {}, "system");
      publishEvent("market_data", "PRICE", {}, "system");
      publishEvent("market_data", "PRICE", {}, "system");

      const events = getEvents({ limit: 2 });
      expect(events).toHaveLength(2);
    });

    it("should sort events by created_at descending", () => {
      const e1 = publishEvent("market_data", "PRICE_1", {}, "system");
      const e2 = publishEvent("market_data", "PRICE_2", {}, "system");
      const e3 = publishEvent("market_data", "PRICE_3", {}, "system");

      const events = getEvents();
      expect(events[0].id).toBe(e3.id);
      expect(events[1].id).toBe(e2.id);
      expect(events[2].id).toBe(e1.id);
    });
  });

  // Test event replay
  describe("startReplay", () => {
    it("should create a replay for a time range", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("trade_execution", "TRADE", {}, "system");

      const now = new Date();
      const from = new Date(now.getTime() - 60000).toISOString();
      const to = new Date(now.getTime() + 60000).toISOString();

      const replay = startReplay({ from_time: from, to_time: to });
      expect(replay.id).toMatch(/^rpl_/);
      expect(replay.event_count).toBeGreaterThanOrEqual(2);
      expect(replay.status).toBe("completed");
    });

    it("should replay events for a specific channel", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("order_update", "ORDER", {}, "system");
      publishEvent("trade_execution", "TRADE", {}, "system");

      const now = new Date();
      const from = new Date(now.getTime() - 60000).toISOString();
      const to = new Date(now.getTime() + 60000).toISOString();

      const replay = startReplay({ channel: "trade_execution", from_time: from, to_time: to });
      expect(replay.event_count).toBe(2);
    });

    it("should retrieve a replay by ID", () => {
      const now = new Date();
      const from = new Date(now.getTime() - 60000).toISOString();
      const to = new Date(now.getTime() + 60000).toISOString();

      const created = startReplay({ from_time: from, to_time: to });
      const retrieved = getReplay(created.id);
      expect(retrieved?.id).toBe(created.id);
    });

    it("should return undefined for non-existent replay", () => {
      const replay = getReplay("rpl_nonexistent");
      expect(replay).toBeUndefined();
    });
  });

  // Test statistics
  describe("getStats", () => {
    it("should compute event statistics", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("order_update", "ORDER", {}, "system");
      publishEvent("risk_alert", "ALERT", {}, "system", { priority: "critical" });

      const stats = getStats();
      expect(stats.total_events).toBe(3);
      expect(stats.events_by_channel.trade_execution).toBe(1);
      expect(stats.events_by_channel.order_update).toBe(1);
      expect(stats.events_by_priority.critical).toBe(1);
      expect(stats.active_subscriptions).toBe(0);
    });

    it("should track events by channel", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("order_update", "ORDER", {}, "system");

      const stats = getStats();
      expect(stats.events_by_channel.trade_execution).toBe(2);
      expect(stats.events_by_channel.order_update).toBe(1);
    });

    it("should track events by priority", () => {
      publishEvent("risk_alert", "A", {}, "system", { priority: "critical" });
      publishEvent("risk_alert", "B", {}, "system", { priority: "high" });
      publishEvent("risk_alert", "C", {}, "system", { priority: "high" });

      const stats = getStats();
      expect(stats.events_by_priority.critical).toBe(1);
      expect(stats.events_by_priority.high).toBe(2);
    });

    it("should track events by status", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");
      publishEvent("order_update", "ORDER", {}, "system");

      const stats = getStats();
      expect(stats.events_by_status.delivered).toBeGreaterThanOrEqual(2);
    });

    it("should calculate average delivery time", () => {
      publishEvent("market_data", "PRICE", {}, "system");
      publishEvent("market_data", "PRICE", {}, "system");

      const stats = getStats();
      expect(stats.avg_delivery_time_ms).toBeGreaterThanOrEqual(0);
    });

    it("should count active subscriptions", () => {
      subscribe("trade_execution", "trader1");
      subscribe("order_update", "trader2");

      const stats = getStats();
      expect(stats.active_subscriptions).toBe(2);
    });

    it("should calculate events per minute", () => {
      publishEvent("market_data", "PRICE", {}, "system");
      publishEvent("market_data", "PRICE", {}, "system");

      const stats = getStats();
      expect(stats.events_per_minute).toBeGreaterThanOrEqual(0);
    });
  });

  // Test purging expired events
  describe("purgeExpiredEvents", () => {
    it("should purge expired events", () => {
      const pastTime = new Date(Date.now() - 1000).toISOString();
      publishEvent("market_data", "PRICE", {}, "system", { expires_at: pastTime });
      publishEvent("market_data", "PRICE", {}, "system");

      const purged = purgeExpiredEvents();
      expect(purged).toBe(1);

      const stats = getStats();
      expect(stats.total_events).toBe(1);
    });

    it("should not purge non-expired events", () => {
      const futureTime = new Date(Date.now() + 60000).toISOString();
      publishEvent("market_data", "PRICE", {}, "system", { expires_at: futureTime });

      const purged = purgeExpiredEvents();
      expect(purged).toBe(0);

      const stats = getStats();
      expect(stats.total_events).toBe(1);
    });

    it("should not purge events without expiration", () => {
      publishEvent("trade_execution", "TRADE", {}, "system");

      const purged = purgeExpiredEvents();
      expect(purged).toBe(0);

      const stats = getStats();
      expect(stats.total_events).toBe(1);
    });
  });

  // Test events counter
  describe("events_received counter", () => {
    it("should increment on matching subscriptions", () => {
      const sub = subscribe("trade_execution", "trader1");
      publishEvent("trade_execution", "TRADE", {}, "system");

      const updated = getSubscription(sub.id);
      expect(updated?.events_received).toBeGreaterThan(0);
    });

    it("should not increment for non-matching channels", () => {
      const sub = subscribe("order_update", "trader1");
      publishEvent("trade_execution", "TRADE", {}, "system");

      const updated = getSubscription(sub.id);
      expect(updated?.events_received).toBe(0);
    });
  });

  // Test error handling
  describe("Error handling", () => {
    it("should handle getting non-existent subscription", () => {
      const sub = getSubscription("sub_nonexistent");
      expect(sub).toBeUndefined();
    });

    it("should handle getting non-existent rule", () => {
      const rule = getRule("rule_nonexistent");
      expect(rule).toBeUndefined();
    });

    it("should handle disabling non-existent rule", () => {
      const before = getAllRules().length;
      disableRule("rule_nonexistent");
      const after = getAllRules().length;
      expect(before).toBe(after);
    });

    it("should handle enabling non-existent rule", () => {
      const before = getAllRules().length;
      enableRule("rule_nonexistent");
      const after = getAllRules().length;
      expect(before).toBe(after);
    });

    it("should handle deleting non-existent rule", () => {
      const before = getAllRules().length;
      deleteRule("rule_nonexistent");
      const after = getAllRules().length;
      expect(before).toBe(after);
    });
  });

  // Test delegate functions
  describe("Delegate functions", () => {
    it("should work for publishEvent", () => {
      const event = publishEvent("trade_execution", "TRADE", {}, "system");
      expect(event.id).toMatch(/^evt_/);
    });

    it("should work for subscribe", () => {
      const sub = subscribe("order_update", "trader1");
      expect(sub.id).toMatch(/^sub_/);
    });

    it("should work for getEvents", () => {
      publishEvent("market_data", "PRICE", {}, "system");
      const events = getEvents();
      expect(events.length).toBeGreaterThan(0);
    });

    it("should work for addRule", () => {
      const rule = addRule("test", "system_health", {}, "forward", {});
      expect(rule.id).toMatch(/^rule_/);
    });

    it("should work for startReplay", () => {
      const now = new Date();
      const from = new Date(now.getTime() - 60000).toISOString();
      const to = new Date(now.getTime() + 60000).toISOString();

      const replay = startReplay({ from_time: from, to_time: to });
      expect(replay.id).toMatch(/^rpl_/);
    });
  });
});
