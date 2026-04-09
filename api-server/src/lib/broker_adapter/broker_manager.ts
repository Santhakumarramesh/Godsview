import { randomUUID } from "crypto";

export type BrokerCapability = "equities" | "options" | "crypto" | "futures" | "market_data" | "paper_trading" | "live_trading" | "extended_hours";

export interface BrokerHealth {
  latency_ms: number;
  uptime_pct: number;
  error_rate: number;
  last_error?: string;
  consecutive_failures: number;
  circuit_breaker: "closed" | "open" | "half_open";
}

export interface BrokerAdapter {
  id: string; // prefix "brk_"
  name: string;
  type: "alpaca" | "interactive_brokers" | "tradier" | "paper_sim" | "custom";
  status: "connected" | "disconnected" | "degraded" | "error";
  priority: number;
  capabilities: BrokerCapability[];
  health: BrokerHealth;
  config: Record<string, any>;
  registered_at: number;
  last_heartbeat?: number;
}

export interface OrderRequest {
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  order_type: "market" | "limit" | "stop" | "stop_limit";
  limit_price?: number;
  stop_price?: number;
  time_in_force: "day" | "gtc" | "opg" | "cls";
}

export interface OrderResult {
  order_id: string;
  broker_id: string;
  status: "submitted" | "rejected" | "failed";
  submitted_at: number;
  rejection_reason?: string;
}

export interface BrokerRoute {
  symbol: string;
  preferred_broker_id: string;
  fallback_broker_ids: string[];
  reason: string;
}

class BrokerManager {
  private brokerStore = new Map<string, BrokerAdapter>();
  private routeStore = new Map<string, BrokerRoute>();
  private readonly CIRCUIT_BREAKER_THRESHOLD = 5;

  registerBroker(
    name: string,
    type: "alpaca" | "interactive_brokers" | "tradier" | "paper_sim" | "custom",
    priority: number,
    capabilities: BrokerCapability[],
    config: Record<string, any>
  ): { success: boolean; data?: BrokerAdapter; error?: string } {
    const id = `brk_${randomUUID()}`;
    const adapter: BrokerAdapter = {
      id,
      name,
      type,
      status: "disconnected",
      priority,
      capabilities,
      health: {
        latency_ms: 0,
        uptime_pct: 100,
        error_rate: 0,
        consecutive_failures: 0,
        circuit_breaker: "closed",
      },
      config,
      registered_at: Date.now(),
    };

    this.brokerStore.set(id, adapter);
    return { success: true, data: adapter };
  }

  updateBrokerHealth(
    brokerId: string,
    latency_ms: number,
    uptime_pct: number,
    error_rate: number,
    last_error?: string
  ): { success: boolean; data?: BrokerAdapter; error?: string } {
    const broker = this.brokerStore.get(brokerId);
    if (!broker) return { success: false, error: "Broker not found" };

    broker.health.latency_ms = latency_ms;
    broker.health.uptime_pct = uptime_pct;
    broker.health.error_rate = error_rate;
    if (last_error) broker.health.last_error = last_error;

    this.brokerStore.set(brokerId, broker);
    return { success: true, data: broker };
  }

  updateBrokerStatus(brokerId: string, status: "connected" | "disconnected" | "degraded" | "error"): { success: boolean; data?: BrokerAdapter; error?: string } {
    const broker = this.brokerStore.get(brokerId);
    if (!broker) return { success: false, error: "Broker not found" };

    broker.status = status;
    this.brokerStore.set(brokerId, broker);
    return { success: true, data: broker };
  }

  getBroker(brokerId: string): { success: boolean; data?: BrokerAdapter; error?: string } {
    const broker = this.brokerStore.get(brokerId);
    return broker ? { success: true, data: broker } : { success: false, error: "Broker not found" };
  }

  getAllBrokers(): { success: boolean; data: BrokerAdapter[] } {
    return { success: true, data: Array.from(this.brokerStore.values()) };
  }

  getConnectedBrokers(): { success: boolean; data: BrokerAdapter[] } {
    const connected = Array.from(this.brokerStore.values()).filter(
      (b) => b.status === "connected" && b.health.circuit_breaker === "closed"
    );
    return { success: true, data: connected };
  }

  recordHeartbeat(brokerId: string): { success: boolean; data?: BrokerAdapter; error?: string } {
    const broker = this.brokerStore.get(brokerId);
    if (!broker) return { success: false, error: "Broker not found" };

    broker.last_heartbeat = Date.now();
    broker.health.consecutive_failures = 0;
    this.brokerStore.set(brokerId, broker);

    return { success: true, data: broker };
  }

  triggerCircuitBreaker(brokerId: string): { success: boolean; data?: BrokerAdapter; error?: string } {
    const broker = this.brokerStore.get(brokerId);
    if (!broker) return { success: false, error: "Broker not found" };

    broker.health.consecutive_failures += 1;

    if (broker.health.consecutive_failures >= this.CIRCUIT_BREAKER_THRESHOLD) {
      broker.health.circuit_breaker = "open";
      broker.status = "error";
    }

    this.brokerStore.set(brokerId, broker);
    return { success: true, data: broker };
  }

  resetCircuitBreaker(brokerId: string): { success: boolean; data?: BrokerAdapter; error?: string } {
    const broker = this.brokerStore.get(brokerId);
    if (!broker) return { success: false, error: "Broker not found" };

    broker.health.circuit_breaker = "closed";
    broker.health.consecutive_failures = 0;
    broker.status = "connected";

    this.brokerStore.set(brokerId, broker);
    return { success: true, data: broker };
  }

  routeOrder(symbol: string, capability: BrokerCapability): { success: boolean; data?: BrokerAdapter; error?: string } {
    const route = this.routeStore.get(symbol);

    if (route) {
      const preferred = this.brokerStore.get(route.preferred_broker_id);
      if (preferred && preferred.status === "connected" && preferred.capabilities.includes(capability)) {
        return { success: true, data: preferred };
      }

      for (const fallbackId of route.fallback_broker_ids) {
        const fallback = this.brokerStore.get(fallbackId);
        if (fallback && fallback.status === "connected" && fallback.capabilities.includes(capability)) {
          return { success: true, data: fallback };
        }
      }
    }

    // Route to highest priority connected broker with capability
    const brokers = Array.from(this.brokerStore.values())
      .filter((b) => b.status === "connected" && b.capabilities.includes(capability) && b.health.circuit_breaker === "closed")
      .sort((a, b) => b.priority - a.priority);

    if (brokers.length > 0) {
      return { success: true, data: brokers[0] };
    }

    return { success: false, error: "No available broker for order" };
  }

  setRoute(symbol: string, preferred_broker_id: string, fallback_broker_ids: string[], reason: string): { success: boolean; data?: BrokerRoute; error?: string } {
    const preferred = this.brokerStore.get(preferred_broker_id);
    if (!preferred) return { success: false, error: "Preferred broker not found" };

    for (const fallbackId of fallback_broker_ids) {
      if (!this.brokerStore.has(fallbackId)) {
        return { success: false, error: `Fallback broker ${fallbackId} not found` };
      }
    }

    const route: BrokerRoute = {
      symbol,
      preferred_broker_id,
      fallback_broker_ids,
      reason,
    };

    this.routeStore.set(symbol, route);
    return { success: true, data: route };
  }

  getRoute(symbol: string): { success: boolean; data?: BrokerRoute; error?: string } {
    const route = this.routeStore.get(symbol);
    return route ? { success: true, data: route } : { success: false, error: "Route not found" };
  }

  getAllRoutes(): { success: boolean; data: BrokerRoute[] } {
    return { success: true, data: Array.from(this.routeStore.values()) };
  }

  _clearBrokers() {
    this.brokerStore.clear();
    this.routeStore.clear();
  }
}

export const brokerManager = new BrokerManager();
