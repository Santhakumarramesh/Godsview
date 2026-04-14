/**
 * pubsub/index.ts — Phase 79: Real-Time Pub/Sub Bus
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. TopicManager        — topic create/list/delete with retention.
 *   2. SubscriberRegistry  — subscriber identities with cursors.
 *   3. MessageBroker       — publish + fan-out delivery + ordering.
 *   4. BackpressureMonitor — slow-consumer detection.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Topics ────────────────────────────────────────────────────────────────

export interface Topic {
  name: string;
  partitions: number;
  retentionMs: number;
  createdAt: number;
}

export class TopicManager {
  private readonly topics = new Map<string, Topic>();

  create(params: { name: string; partitions?: number; retentionMs?: number }): Topic {
    if (this.topics.has(params.name)) return this.topics.get(params.name)!;
    const topic: Topic = {
      name: params.name,
      partitions: Math.max(1, params.partitions ?? 1),
      retentionMs: params.retentionMs ?? 60 * 60 * 1000,
      createdAt: Date.now(),
    };
    this.topics.set(params.name, topic);
    return topic;
  }

  delete(name: string): boolean {
    return this.topics.delete(name);
  }

  list(): Topic[] {
    return Array.from(this.topics.values());
  }

  get(name: string): Topic | null {
    return this.topics.get(name) ?? null;
  }
}

// ── Subscribers ───────────────────────────────────────────────────────────

export type DeliveryMode = "at_most_once" | "at_least_once";

export interface Subscriber {
  id: string;
  topic: string;
  groupId: string;
  mode: DeliveryMode;
  cursor: number;            // last consumed sequence
  createdAt: number;
  lastConsumedAt?: number;
  lagMessages: number;
}

export class SubscriberRegistry {
  private readonly subscribers = new Map<string, Subscriber>();

  subscribe(params: { topic: string; groupId: string; mode?: DeliveryMode }): Subscriber {
    const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const subscriber: Subscriber = {
      id,
      topic: params.topic,
      groupId: params.groupId,
      mode: params.mode ?? "at_least_once",
      cursor: 0,
      createdAt: Date.now(),
      lagMessages: 0,
    };
    this.subscribers.set(id, subscriber);
    return subscriber;
  }

  unsubscribe(id: string): boolean {
    return this.subscribers.delete(id);
  }

  list(topic?: string): Subscriber[] {
    const all = Array.from(this.subscribers.values());
    return topic ? all.filter((s) => s.topic === topic) : all;
  }

  get(id: string): Subscriber | null {
    return this.subscribers.get(id) ?? null;
  }

  advance(id: string, sequence: number, topicHead: number): Subscriber | null {
    const s = this.subscribers.get(id);
    if (!s) return null;
    s.cursor = Math.max(s.cursor, sequence);
    s.lastConsumedAt = Date.now();
    s.lagMessages = Math.max(0, topicHead - s.cursor);
    return s;
  }
}

// ── Message Broker ────────────────────────────────────────────────────────

export interface Message {
  id: string;
  topic: string;
  partition: number;
  sequence: number;
  payload: unknown;
  headers: Record<string, string>;
  publishedAt: number;
}

export class MessageBroker {
  private readonly buffer = new Map<string, Message[]>();
  private nextSeq = 1;

  constructor(private readonly topicManager: TopicManager) {}

  publish(params: {
    topic: string;
    payload: unknown;
    partitionKey?: string;
    headers?: Record<string, string>;
  }): Message | null {
    const topic = this.topicManager.get(params.topic);
    if (!topic) return null;
    const partition = params.partitionKey
      ? Math.abs(this._hash(params.partitionKey)) % topic.partitions
      : 0;
    const message: Message = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      topic: params.topic,
      partition,
      sequence: this.nextSeq++,
      payload: params.payload,
      headers: params.headers ?? {},
      publishedAt: Date.now(),
    };
    const arr = this.buffer.get(params.topic) ?? [];
    arr.push(message);
    this.buffer.set(params.topic, arr);
    this._evict(params.topic);
    return message;
  }

  consume(topic: string, fromSequence: number, limit = 100): Message[] {
    const arr = this.buffer.get(topic) ?? [];
    return arr.filter((m) => m.sequence > fromSequence).slice(0, limit);
  }

  head(topic: string): number {
    const arr = this.buffer.get(topic) ?? [];
    return arr.length > 0 ? arr[arr.length - 1]!.sequence : 0;
  }

  size(topic: string): number {
    return (this.buffer.get(topic) ?? []).length;
  }

  recent(topic: string, limit = 50): Message[] {
    return (this.buffer.get(topic) ?? []).slice(-limit).reverse();
  }

  private _hash(key: string): number {
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
    return h;
  }

  private _evict(topic: string): void {
    const t = this.topicManager.get(topic);
    if (!t) return;
    const cutoff = Date.now() - t.retentionMs;
    const arr = this.buffer.get(topic);
    if (!arr) return;
    while (arr.length > 0 && arr[0]!.publishedAt < cutoff) arr.shift();
    if (arr.length > 100_000) arr.splice(0, arr.length - 100_000);
  }
}

// ── Backpressure Monitor ──────────────────────────────────────────────────

export interface BackpressureReport {
  subscriberId: string;
  topic: string;
  groupId: string;
  lag: number;
  staleSeconds: number;
  status: "ok" | "slow" | "stalled";
}

export class BackpressureMonitor {
  constructor(
    private readonly subscribers: SubscriberRegistry,
    private readonly broker: MessageBroker,
  ) {}

  report(): BackpressureReport[] {
    const out: BackpressureReport[] = [];
    for (const sub of this.subscribers.list()) {
      const head = this.broker.head(sub.topic);
      const lag = Math.max(0, head - sub.cursor);
      const stale = sub.lastConsumedAt ? (Date.now() - sub.lastConsumedAt) / 1000 : Number.POSITIVE_INFINITY;
      let status: BackpressureReport["status"] = "ok";
      if (lag > 1000 || stale > 300) status = "stalled";
      else if (lag > 100 || stale > 30) status = "slow";
      out.push({
        subscriberId: sub.id,
        topic: sub.topic,
        groupId: sub.groupId,
        lag, staleSeconds: stale, status,
      });
    }
    return out;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const topicManager = new TopicManager();
export const subscriberRegistry = new SubscriberRegistry();
export const messageBroker = new MessageBroker(topicManager);
export const backpressureMonitor = new BackpressureMonitor(subscriberRegistry, messageBroker);

// Seed default topics
topicManager.create({ name: "trades.fills", partitions: 4, retentionMs: 24 * 60 * 60 * 1000 });
topicManager.create({ name: "signals.new", partitions: 1, retentionMs: 6 * 60 * 60 * 1000 });
topicManager.create({ name: "system.alerts", partitions: 1, retentionMs: 7 * 24 * 60 * 60 * 1000 });
logger.info({ topics: topicManager.list().length }, "[PubSub] Module initialized");
