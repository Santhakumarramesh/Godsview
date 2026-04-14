/**
 * developer_platform/index.ts — Phase 70: Developer Platform
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. APIKeyManager       — scoped keys with rotation + revocation.
 *   2. RateLimiter         — token-bucket rate limits per key.
 *   3. WebhookRegistry     — subscription + delivery + retry.
 *   4. SDKRegistry         — declared SDK surfaces + deprecation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createHash, randomBytes } from "crypto";
import { logger } from "../logger.js";

// ── API Keys ───────────────────────────────────────────────────────────────

export type Scope =
  | "signals.read" | "signals.write"
  | "trades.read" | "trades.write"
  | "strategies.read" | "strategies.write"
  | "admin" | "webhooks.manage" | "observability.read";

export interface APIKey {
  id: string;
  name: string;
  ownerUserId: string;
  orgId?: string;
  scopes: Scope[];
  prefix: string;         // first 8 chars, safe to display
  hash: string;           // sha256 of full key
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
  revokedAt?: number;
}

export class APIKeyManager {
  private readonly keys = new Map<string, APIKey>();
  private readonly hashToId = new Map<string, string>();

  issue(params: {
    name: string;
    ownerUserId: string;
    orgId?: string;
    scopes: Scope[];
    expiresInMs?: number;
  }): { key: APIKey; secret: string } {
    const raw = `gv_${randomBytes(24).toString("hex")}`;
    const hash = createHash("sha256").update(raw).digest("hex");
    const id = `key_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const key: APIKey = {
      id,
      name: params.name,
      ownerUserId: params.ownerUserId,
      orgId: params.orgId,
      scopes: [...params.scopes],
      prefix: raw.slice(0, 8),
      hash,
      createdAt: Date.now(),
      expiresAt: params.expiresInMs ? Date.now() + params.expiresInMs : undefined,
    };
    this.keys.set(id, key);
    this.hashToId.set(hash, id);
    logger.info({ keyId: id, owner: params.ownerUserId, scopes: params.scopes }, "[API] Key issued");
    return { key, secret: raw };
  }

  revoke(id: string): boolean {
    const k = this.keys.get(id);
    if (!k || k.revokedAt) return false;
    k.revokedAt = Date.now();
    this.hashToId.delete(k.hash);
    return true;
  }

  verify(secret: string): APIKey | null {
    const hash = createHash("sha256").update(secret).digest("hex");
    const id = this.hashToId.get(hash);
    if (!id) return null;
    const k = this.keys.get(id);
    if (!k || k.revokedAt) return null;
    if (k.expiresAt && Date.now() > k.expiresAt) return null;
    k.lastUsedAt = Date.now();
    return k;
  }

  hasScope(key: APIKey, scope: Scope): boolean {
    return key.scopes.includes(scope) || key.scopes.includes("admin");
  }

  list(ownerUserId?: string): APIKey[] {
    const all = Array.from(this.keys.values()).map((k) => ({ ...k, hash: "REDACTED" }));
    return (ownerUserId ? all.filter((k) => k.ownerUserId === ownerUserId) : all)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  get(id: string): APIKey | null {
    const k = this.keys.get(id);
    if (!k) return null;
    return { ...k, hash: "REDACTED" };
  }
}

// ── Rate Limiter (token bucket) ────────────────────────────────────────────

export interface TokenBucket {
  keyId: string;
  capacity: number;
  refillPerSecond: number;
  tokens: number;
  lastRefillAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  ensure(keyId: string, capacity = 600, refillPerSecond = 10): TokenBucket {
    let b = this.buckets.get(keyId);
    if (!b) {
      b = { keyId, capacity, refillPerSecond, tokens: capacity, lastRefillAt: Date.now() };
      this.buckets.set(keyId, b);
    }
    return b;
  }

  take(keyId: string, cost = 1): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const b = this.ensure(keyId);
    const now = Date.now();
    const elapsedSec = (now - b.lastRefillAt) / 1000;
    b.tokens = Math.min(b.capacity, b.tokens + elapsedSec * b.refillPerSecond);
    b.lastRefillAt = now;
    if (b.tokens >= cost) {
      b.tokens -= cost;
      return { allowed: true, remaining: Math.floor(b.tokens), retryAfterMs: 0 };
    }
    const deficit = cost - b.tokens;
    const retryAfterMs = Math.ceil((deficit / b.refillPerSecond) * 1000);
    return { allowed: false, remaining: Math.floor(b.tokens), retryAfterMs };
  }

  snapshot(keyId: string): TokenBucket | null {
    return this.buckets.get(keyId) ?? null;
  }
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export type WebhookEvent =
  | "signal.created" | "trade.submitted" | "trade.filled"
  | "strategy.promoted" | "strategy.demoted" | "alert.raised" | "incident.declared";

export interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
  createdAt: number;
  lastDeliveryAt?: number;
  lastStatus?: "success" | "failure";
  failureCount: number;
}

export interface WebhookDelivery {
  id: string;
  subscriptionId: string;
  event: WebhookEvent;
  payload: Record<string, unknown>;
  attempts: number;
  status: "pending" | "delivered" | "failed";
  lastAttemptAt?: number;
  nextRetryAt?: number;
  responseStatus?: number;
}

export class WebhookRegistry {
  private readonly subs = new Map<string, WebhookSubscription>();
  private readonly deliveries: WebhookDelivery[] = [];

  subscribe(params: { url: string; events: WebhookEvent[] }): WebhookSubscription {
    const id = `hook_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sub: WebhookSubscription = {
      id,
      url: params.url,
      events: [...params.events],
      secret: `whsec_${randomBytes(16).toString("hex")}`,
      active: true,
      createdAt: Date.now(),
      failureCount: 0,
    };
    this.subs.set(id, sub);
    return sub;
  }

  unsubscribe(id: string): boolean {
    const s = this.subs.get(id);
    if (!s) return false;
    s.active = false;
    return true;
  }

  list(): WebhookSubscription[] {
    return Array.from(this.subs.values());
  }

  fire(event: WebhookEvent, payload: Record<string, unknown>): WebhookDelivery[] {
    const matching = Array.from(this.subs.values()).filter((s) => s.active && s.events.includes(event));
    const out: WebhookDelivery[] = [];
    for (const s of matching) {
      const delivery: WebhookDelivery = {
        id: `dlv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        subscriptionId: s.id,
        event,
        payload,
        attempts: 0,
        status: "pending",
      };
      this.deliveries.push(delivery);
      out.push(delivery);
    }
    if (this.deliveries.length > 10_000) this.deliveries.splice(0, this.deliveries.length - 10_000);
    return out;
  }

  markDelivered(deliveryId: string, responseStatus: number): void {
    const d = this.deliveries.find((x) => x.id === deliveryId);
    if (!d) return;
    d.attempts++;
    d.lastAttemptAt = Date.now();
    d.responseStatus = responseStatus;
    d.status = responseStatus >= 200 && responseStatus < 300 ? "delivered" : "failed";
    const s = this.subs.get(d.subscriptionId);
    if (s) {
      s.lastDeliveryAt = Date.now();
      if (d.status === "delivered") {
        s.lastStatus = "success";
        s.failureCount = 0;
      } else {
        s.lastStatus = "failure";
        s.failureCount++;
        if (d.attempts < 5) {
          d.status = "pending";
          d.nextRetryAt = Date.now() + Math.min(60_000, 2 ** d.attempts * 1000);
        }
      }
    }
  }

  pendingDeliveries(): WebhookDelivery[] {
    return this.deliveries.filter((d) => d.status === "pending");
  }

  recent(limit = 100): WebhookDelivery[] {
    return this.deliveries.slice(-limit).reverse();
  }
}

// ── SDK Registry ───────────────────────────────────────────────────────────

export interface SDKSurface {
  id: string;
  language: "typescript" | "python" | "go" | "rust" | "java";
  version: string;
  status: "current" | "deprecated" | "sunset";
  deprecatedAt?: number;
  sunsetAt?: number;
  notes: string;
}

export class SDKRegistry {
  private readonly surfaces = new Map<string, SDKSurface>();

  publish(params: Omit<SDKSurface, "id" | "status" | "deprecatedAt" | "sunsetAt">): SDKSurface {
    const id = `sdk_${params.language}_${params.version}`;
    const surface: SDKSurface = { id, status: "current", ...params };
    this.surfaces.set(id, surface);
    return surface;
  }

  deprecate(id: string, sunsetAt: number): SDKSurface | null {
    const s = this.surfaces.get(id);
    if (!s) return null;
    s.status = "deprecated";
    s.deprecatedAt = Date.now();
    s.sunsetAt = sunsetAt;
    return s;
  }

  sunset(id: string): SDKSurface | null {
    const s = this.surfaces.get(id);
    if (!s) return null;
    s.status = "sunset";
    return s;
  }

  list(language?: SDKSurface["language"]): SDKSurface[] {
    const all = Array.from(this.surfaces.values());
    return language ? all.filter((s) => s.language === language) : all;
  }

  current(language: SDKSurface["language"]): SDKSurface | null {
    return this.list(language).find((s) => s.status === "current") ?? null;
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const apiKeyManager = new APIKeyManager();
export const rateLimiter = new RateLimiter();
export const webhookRegistry = new WebhookRegistry();
export const sdkRegistry = new SDKRegistry();
