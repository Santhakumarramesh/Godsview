/**
 * cache_layer/index.ts — Phase 81: Cache Layer (LRU + Tiered)
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. LRUCache         — bounded LRU cache with TTL.
 *   2. TieredCache      — L1 (hot/small) + L2 (warm/large).
 *   3. CacheStats       — hit/miss/eviction tracking.
 *   4. CacheStampede    — single-flight guard for hot key recomputation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── LRU Cache ──────────────────────────────────────────────────────────────

export interface CacheEntry<V> {
  value: V;
  expiresAt: number;
  insertedAt: number;
  hits: number;
}

export class LRUCache<V> {
  private readonly map = new Map<string, CacheEntry<V>>();
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(public readonly maxEntries: number = 1000, public readonly defaultTTLMs: number = 5 * 60 * 1000) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) { this.misses++; return undefined; }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    // Move to most-recently-used
    this.map.delete(key);
    this.map.set(key, entry);
    entry.hits++;
    this.hits++;
    return entry.value;
  }

  set(key: string, value: V, ttlMs?: number): void {
    const now = Date.now();
    const expiresAt = now + (ttlMs ?? this.defaultTTLMs);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { value, expiresAt, insertedAt: now, hits: 0 });
    while (this.map.size > this.maxEntries) {
      const firstKey = this.map.keys().next().value;
      if (firstKey === undefined) break;
      this.map.delete(firstKey);
      this.evictions++;
    }
  }

  has(key: string): boolean {
    const e = this.map.get(key);
    if (!e) return false;
    if (e.expiresAt <= Date.now()) { this.map.delete(key); return false; }
    return true;
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  stats(): { entries: number; maxEntries: number; hits: number; misses: number; evictions: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      entries: this.map.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  topKeys(n = 10): Array<{ key: string; hits: number; ttlRemainingMs: number }> {
    const now = Date.now();
    return Array.from(this.map.entries())
      .map(([key, e]) => ({ key, hits: e.hits, ttlRemainingMs: Math.max(0, e.expiresAt - now) }))
      .sort((a, b) => b.hits - a.hits)
      .slice(0, n);
  }
}

// ── Tiered Cache ───────────────────────────────────────────────────────────

export class TieredCache<V> {
  constructor(
    public readonly l1: LRUCache<V> = new LRUCache<V>(100, 60 * 1000),
    public readonly l2: LRUCache<V> = new LRUCache<V>(10_000, 30 * 60 * 1000),
  ) {}

  get(key: string): { value?: V; tier?: "L1" | "L2" } {
    let v = this.l1.get(key);
    if (v !== undefined) return { value: v, tier: "L1" };
    v = this.l2.get(key);
    if (v !== undefined) {
      // Promote to L1
      this.l1.set(key, v);
      return { value: v, tier: "L2" };
    }
    return {};
  }

  set(key: string, value: V, ttlMs?: number): void {
    this.l1.set(key, value, ttlMs);
    this.l2.set(key, value, ttlMs ? Math.min(ttlMs * 5, 30 * 60 * 1000) : undefined);
  }

  delete(key: string): void {
    this.l1.delete(key);
    this.l2.delete(key);
  }

  clear(): void {
    this.l1.clear();
    this.l2.clear();
  }

  stats(): { l1: ReturnType<LRUCache<V>["stats"]>; l2: ReturnType<LRUCache<V>["stats"]> } {
    return { l1: this.l1.stats(), l2: this.l2.stats() };
  }
}

// ── Cache Registry ────────────────────────────────────────────────────────

export class CacheRegistry {
  private readonly caches = new Map<string, LRUCache<unknown> | TieredCache<unknown>>();

  registerLRU(name: string, maxEntries?: number, defaultTTLMs?: number): LRUCache<unknown> {
    const c = new LRUCache<unknown>(maxEntries ?? 1000, defaultTTLMs ?? 5 * 60 * 1000);
    this.caches.set(name, c);
    return c;
  }

  registerTiered(name: string): TieredCache<unknown> {
    const c = new TieredCache<unknown>();
    this.caches.set(name, c);
    return c;
  }

  get(name: string): LRUCache<unknown> | TieredCache<unknown> | null {
    return this.caches.get(name) ?? null;
  }

  list(): string[] {
    return Array.from(this.caches.keys());
  }

  delete(name: string): boolean {
    return this.caches.delete(name);
  }

  allStats(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, cache] of this.caches) {
      out[name] = cache.stats();
    }
    return out;
  }
}

// ── Cache Stampede Protection ─────────────────────────────────────────────

export class CacheStampede {
  private readonly inflight = new Map<string, Promise<unknown>>();

  /** Single-flight wrapper: only one compute() runs per key concurrently. */
  async fetch<V>(key: string, compute: () => Promise<V>): Promise<V> {
    const existing = this.inflight.get(key) as Promise<V> | undefined;
    if (existing) return existing;
    const promise = compute().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise as Promise<unknown>);
    return promise;
  }

  inflightCount(): number {
    return this.inflight.size;
  }

  inflightKeys(): string[] {
    return Array.from(this.inflight.keys());
  }
}

// ── Singletons ─────────────────────────────────────────────────────────────

export const cacheRegistry = new CacheRegistry();
export const cacheStampede = new CacheStampede();

// Register a few default caches for trading app needs
cacheRegistry.registerLRU("quotes", 5000, 30_000);
cacheRegistry.registerLRU("symbols", 1000, 24 * 60 * 60 * 1000);
cacheRegistry.registerTiered("strategies");

logger.info({ caches: cacheRegistry.list().length }, "[Cache] Module initialized");
