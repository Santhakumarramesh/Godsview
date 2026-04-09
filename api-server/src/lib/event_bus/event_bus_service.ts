import { randomUUID } from "crypto";

// Types and interfaces
export type EventChannel =
  | "trade_execution"
  | "order_update"
  | "position_change"
  | "risk_alert"
  | "strategy_signal"
  | "market_data"
  | "system_health"
  | "operator_action"
  | "recovery_event"
  | "certification_update"
  | "audit_event"
  | "custom";

export type EventPriority = "critical" | "high" | "normal" | "low";

export type EventStatus = "pending" | "dispatched" | "delivered" | "failed" | "expired";

export interface SystemEvent {
  id: string;
  channel: EventChannel;
  type: string;
  payload: Record<string, any>;
  priority: EventPriority;
  status: EventStatus;
  source: string;
  correlation_id?: string;
  created_at: string;
  dispatched_at?: string;
  delivered_at?: string;
  expires_at?: string;
  metadata?: Record<string, any>;
}

export interface Subscription {
  id: string;
  channel: EventChannel;
  subscriber: string;
  filter?: Record<string, any>;
  created_at: string;
  active: boolean;
  events_received: number;
  last_event_at?: string;
}

export interface EventRule {
  id: string;
  name: string;
  channel: EventChannel;
  condition: Record<string, any>;
  action: "forward" | "transform" | "aggregate" | "suppress";
  action_config: Record<string, any>;
  enabled: boolean;
  created_at: string;
  triggered_count: number;
}

export interface EventStats {
  total_events: number;
  events_by_channel: Record<EventChannel, number>;
  events_by_priority: Record<EventPriority, number>;
  events_by_status: Record<EventStatus, number>;
  avg_delivery_time_ms: number;
  active_subscriptions: number;
  events_per_minute: number;
}

export interface EventReplay {
  id: string;
  channel?: EventChannel;
  from_time: string;
  to_time: string;
  event_count: number;
  status: "pending" | "replaying" | "completed";
  created_at: string;
}

/**
 * EventBusService
 * Typed pub/sub event bus for system-wide event distribution
 */
class EventBusService {
  private events: Map<string, SystemEvent> = new Map();
  private eventOrder: string[] = [];
  private subscriptions: Map<string, Subscription> = new Map();
  private rules: Map<string, EventRule> = new Map();
  private replays: Map<string, EventReplay> = new Map();

  /**
   * Publish an event to the event bus
   */
  publishEvent(
    channel: EventChannel,
    type: string,
    payload: Record<string, any>,
    source: string,
    opts?: {
      priority?: EventPriority;
      correlation_id?: string;
      expires_at?: string;
      metadata?: Record<string, any>;
    }
  ): SystemEvent {
    const event: SystemEvent = {
      id: `evt_${randomUUID()}`,
      channel,
      type,
      payload,
      priority: opts?.priority ?? "normal",
      status: "pending",
      source,
      correlation_id: opts?.correlation_id,
      created_at: new Date().toISOString(),
      expires_at: opts?.expires_at,
      metadata: opts?.metadata,
    };

    this.events.set(event.id, event);
    this.eventOrder.push(event.id);

    // Auto-dispatch the event
    this.dispatchEvent(event.id);

    return event;
  }

  /**
   * Dispatch an event to subscribers
   */
  dispatchEvent(event_id: string): { success: boolean; subscribers_notified: number } {
    const event = this.events.get(event_id);
    if (!event) {
      return { success: false, subscribers_notified: 0 };
    }

    event.status = "dispatched";
    event.dispatched_at = new Date().toISOString();

    // Find matching subscriptions
    const matchingSubscriptions = this.getSubscriptionsForChannel(event.channel);
    let subscribers_notified = 0;

    for (const sub of matchingSubscriptions) {
      sub.events_received += 1;
      sub.last_event_at = new Date().toISOString();
      subscribers_notified += 1;
    }

    event.status = "delivered";
    event.delivered_at = new Date().toISOString();

    return { success: true, subscribers_notified };
  }

  /**
   * Subscribe to a channel
   */
  subscribe(
    channel: EventChannel,
    subscriber: string,
    filter?: Record<string, any>
  ): Subscription {
    const sub: Subscription = {
      id: `sub_${randomUUID()}`,
      channel,
      subscriber,
      filter,
      created_at: new Date().toISOString(),
      active: true,
      events_received: 0,
    };

    this.subscriptions.set(sub.id, sub);
    return sub;
  }

  /**
   * Unsubscribe from a channel
   */
  unsubscribe(sub_id: string): void {
    const sub = this.subscriptions.get(sub_id);
    if (sub) {
      sub.active = false;
    }
  }

  /**
   * Get a subscription by ID
   */
  getSubscription(id: string): Subscription | undefined {
    return this.subscriptions.get(id);
  }

  /**
   * Get subscriptions for a specific channel
   */
  getSubscriptionsForChannel(channel: EventChannel): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (sub) => sub.channel === channel && sub.active
    );
  }

  /**
   * Get all subscriptions
   */
  getAllSubscriptions(): Subscription[] {
    return Array.from(this.subscriptions.values());
  }

  /**
   * Get an event by ID
   */
  getEvent(id: string): SystemEvent | undefined {
    return this.events.get(id);
  }

  /**
   * Get events with optional filtering
   */
  getEvents(opts?: {
    channel?: EventChannel;
    limit?: number;
    priority?: EventPriority;
    status?: EventStatus;
  }): SystemEvent[] {
    let results = Array.from(this.events.values());

    if (opts?.channel) {
      results = results.filter((e) => e.channel === opts.channel);
    }

    if (opts?.priority) {
      results = results.filter((e) => e.priority === opts.priority);
    }

    if (opts?.status) {
      results = results.filter((e) => e.status === opts.status);
    }

    // Sort by insertion order descending (newest first) for stable ordering
    const orderMap = new Map(this.eventOrder.map((id, idx) => [id, idx]));
    results.sort((a, b) => (orderMap.get(b.id) ?? 0) - (orderMap.get(a.id) ?? 0));

    if (opts?.limit) {
      results = results.slice(0, opts.limit);
    }

    return results;
  }

  /**
   * Get events by correlation ID
   */
  getEventsByCorrelation(correlation_id: string): SystemEvent[] {
    return Array.from(this.events.values()).filter((e) => e.correlation_id === correlation_id);
  }

  /**
   * Add an event rule
   */
  addRule(
    name: string,
    channel: EventChannel,
    condition: Record<string, any>,
    action: "forward" | "transform" | "aggregate" | "suppress",
    action_config: Record<string, any>
  ): EventRule {
    const rule: EventRule = {
      id: `rule_${randomUUID()}`,
      name,
      channel,
      condition,
      action,
      action_config,
      enabled: true,
      created_at: new Date().toISOString(),
      triggered_count: 0,
    };

    this.rules.set(rule.id, rule);
    return rule;
  }

  /**
   * Enable a rule
   */
  enableRule(id: string): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = true;
    }
  }

  /**
   * Disable a rule
   */
  disableRule(id: string): void {
    const rule = this.rules.get(id);
    if (rule) {
      rule.enabled = false;
    }
  }

  /**
   * Get a rule by ID
   */
  getRule(id: string): EventRule | undefined {
    return this.rules.get(id);
  }

  /**
   * Get all rules
   */
  getAllRules(): EventRule[] {
    return Array.from(this.rules.values());
  }

  /**
   * Delete a rule
   */
  deleteRule(id: string): void {
    this.rules.delete(id);
  }

  /**
   * Start an event replay
   */
  startReplay(opts: {
    channel?: EventChannel;
    from_time: string;
    to_time: string;
  }): EventReplay {
    let matchingEvents = Array.from(this.events.values());

    if (opts.channel) {
      matchingEvents = matchingEvents.filter((e) => e.channel === opts.channel);
    }

    matchingEvents = matchingEvents.filter((e) => {
      const created = new Date(e.created_at).getTime();
      const from = new Date(opts.from_time).getTime();
      const to = new Date(opts.to_time).getTime();
      return created >= from && created <= to;
    });

    const replay: EventReplay = {
      id: `rpl_${randomUUID()}`,
      channel: opts.channel,
      from_time: opts.from_time,
      to_time: opts.to_time,
      event_count: matchingEvents.length,
      status: "completed",
      created_at: new Date().toISOString(),
    };

    this.replays.set(replay.id, replay);
    return replay;
  }

  /**
   * Get a replay by ID
   */
  getReplay(id: string): EventReplay | undefined {
    return this.replays.get(id);
  }

  /**
   * Get event bus statistics
   */
  getStats(): EventStats {
    const events = Array.from(this.events.values());
    const activeSubs = Array.from(this.subscriptions.values()).filter((s) => s.active);

    // Calculate events by channel
    const events_by_channel: Record<EventChannel, number> = {
      trade_execution: 0,
      order_update: 0,
      position_change: 0,
      risk_alert: 0,
      strategy_signal: 0,
      market_data: 0,
      system_health: 0,
      operator_action: 0,
      recovery_event: 0,
      certification_update: 0,
      audit_event: 0,
      custom: 0,
    };

    const events_by_priority: Record<EventPriority, number> = {
      critical: 0,
      high: 0,
      normal: 0,
      low: 0,
    };

    const events_by_status: Record<EventStatus, number> = {
      pending: 0,
      dispatched: 0,
      delivered: 0,
      failed: 0,
      expired: 0,
    };

    for (const event of events) {
      events_by_channel[event.channel]++;
      events_by_priority[event.priority]++;
      events_by_status[event.status]++;
    }

    // Calculate average delivery time
    let totalDeliveryTime = 0;
    let deliveredCount = 0;

    for (const event of events) {
      if (event.dispatched_at && event.delivered_at) {
        const dispatchedTime = new Date(event.dispatched_at).getTime();
        const deliveredTime = new Date(event.delivered_at).getTime();
        totalDeliveryTime += deliveredTime - dispatchedTime;
        deliveredCount++;
      }
    }

    const avg_delivery_time_ms = deliveredCount > 0 ? totalDeliveryTime / deliveredCount : 0;

    // Calculate events per minute
    let events_per_minute = 0;
    if (events.length > 1) {
      const oldestEvent = events.reduce((min, e) =>
        new Date(e.created_at).getTime() < new Date(min.created_at).getTime() ? e : min
      );
      const newestEvent = events.reduce((max, e) =>
        new Date(e.created_at).getTime() > new Date(max.created_at).getTime() ? e : max
      );

      const timeDiffMs =
        new Date(newestEvent.created_at).getTime() - new Date(oldestEvent.created_at).getTime();
      const minutes = timeDiffMs / (1000 * 60);
      if (minutes > 0) {
        events_per_minute = events.length / minutes;
      }
    }

    return {
      total_events: events.length,
      events_by_channel,
      events_by_priority,
      events_by_status,
      avg_delivery_time_ms,
      active_subscriptions: activeSubs.length,
      events_per_minute,
    };
  }

  /**
   * Purge expired events
   */
  purgeExpiredEvents(): number {
    const now = new Date().getTime();
    let purgedCount = 0;

    const eventIds = Array.from(this.events.keys());
    for (const eventId of eventIds) {
      const event = this.events.get(eventId);
      if (event && event.expires_at) {
        const expiryTime = new Date(event.expires_at).getTime();
        if (now > expiryTime) {
          this.events.delete(eventId);
          const idx = this.eventOrder.indexOf(eventId);
          if (idx > -1) {
            this.eventOrder.splice(idx, 1);
          }
          purgedCount++;
        }
      }
    }

    return purgedCount;
  }

  /**
   * Clear the entire event bus (for testing)
   */
  _clearEventBus(): void {
    this.events.clear();
    this.eventOrder = [];
    this.subscriptions.clear();
    this.rules.clear();
    this.replays.clear();
  }
}

// Export singleton
export const eventBusService = new EventBusService();

// Export delegate functions
export const publishEvent = eventBusService.publishEvent.bind(eventBusService);
export const dispatchEvent = eventBusService.dispatchEvent.bind(eventBusService);
export const subscribe = eventBusService.subscribe.bind(eventBusService);
export const unsubscribe = eventBusService.unsubscribe.bind(eventBusService);
export const getSubscription = eventBusService.getSubscription.bind(eventBusService);
export const getSubscriptionsForChannel = eventBusService.getSubscriptionsForChannel.bind(
  eventBusService
);
export const getAllSubscriptions = eventBusService.getAllSubscriptions.bind(eventBusService);
export const getEvent = eventBusService.getEvent.bind(eventBusService);
export const getEvents = eventBusService.getEvents.bind(eventBusService);
export const getEventsByCorrelation = eventBusService.getEventsByCorrelation.bind(eventBusService);
export const addRule = eventBusService.addRule.bind(eventBusService);
export const enableRule = eventBusService.enableRule.bind(eventBusService);
export const disableRule = eventBusService.disableRule.bind(eventBusService);
export const getRule = eventBusService.getRule.bind(eventBusService);
export const getAllRules = eventBusService.getAllRules.bind(eventBusService);
export const deleteRule = eventBusService.deleteRule.bind(eventBusService);
export const startReplay = eventBusService.startReplay.bind(eventBusService);
export const getReplay = eventBusService.getReplay.bind(eventBusService);
export const getStats = eventBusService.getStats.bind(eventBusService);
export const purgeExpiredEvents = eventBusService.purgeExpiredEvents.bind(eventBusService);
