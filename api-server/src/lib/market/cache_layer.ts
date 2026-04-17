/**
 * cache_layer.ts — LRU Cache for Hot Market Data
 *
 * Manages a least-recently-used (LRU) cache for frequently accessed symbols:
 * - TTL-based expiration per entry
 * - Configurable max size and item limits
 * - Cache warming on startup
 * - Hit/miss metrics tracking
 * - Automatic eviction of cold symbols
 */

/**
 * Cached item wrapper
 */
interface CacheEntry<T> {
  value: T;
  storedAt: number;
  lastAccessedAt: number;
  hits: number;
}

/**
 * Cache metrics
 */
export interface CacheMetrics {
  size: number;
  itemCount: number;
  hitCount: number;
  missCount: number;
  hitRate: number; // 0-1
  estimatedSizeMB: number;
  oldestItemAge: number; // ms
  youngestItemAge: number; // ms
}

/**
 * Cache configuration
 */
export interface CacheConfig {
  maxItems: number;
  maxSizeMB: number;
  defaultTtlMs: number;
  evictionThresholdPercent: number; // when to start evicting
  warmupSymbols: string[];
  metricsUpdateIntervalMs: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  maxItems: 500,
  maxSizeMB: 100,
  defaultTtlMs: 300_000, // 5 minutes
  evictionThresholdPercent: 80,
  warmupSymbols: [],
  metricsUpdateIntervalMs: 60_000, // 1 minute
};

// ─── State ────────────────────────────────────────────────────────────────────

const cache = new Map<string, CacheEntry<unknown>>();
let config: CacheConfig = DEFAULT_CONFIG;
let totalHits = 0;
let totalMisses = 0;
let totalEvictions = 0;
let lastMetricsUpdate = Date.now();

// ─── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Calculate estimated size of a value in bytes
 */
function estimateSize(value: unknown): number {
  try {
    return JSON.stringify(value).length;
  } catch {
    return 1024; // fallback estimate
  }
}

/**
 * Check if a cache entry has expired
 */
function isExpired(entry: CacheEntry<unknown>, ttlMs: number): boolean {
  return Date.now() - entry.storedAt > ttlMs;
}

/**
 * Get total estimated cache size in bytes
 */
function getTotalSizeBytes(): number {
  let total = 0;
  for (const entry of cache.values()) {
    total += estimateSize(entry.value);
  }
  return total;
}

/**
 * Evict the least recently used entries
 */
function evictLRU(targetCount: number): void {
  const entries = Array.from(cache.entries());

  // Sort by last access time (least recent first)
  entries.sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);

  // Evict until target count is reached
  let evicted = 0;
  for (let i = 0; i < entries.length && cache.size > targetCount; i++) {
    const [key] = entries[i];
    cache.delete(key);
    evicted++;
  }

  totalEvictions += evicted;
}

/**
 * Check cache size and evict if necessary
 */
function checkAndEvict(): void {
  const sizeBytes = getTotalSizeBytes();
  const maxSizeBytes = config.maxSizeMB * 1024 * 1024;
  const sizePercent = (sizeBytes / maxSizeBytes) * 100;

  if (sizePercent > config.evictionThresholdPercent) {
    // Evict 20% of items
    const targetCount = Math.max(
      10,
      Math.floor(cache.size * 0.8),
    );
    evictLRU(targetCount);
  }

  if (cache.size > config.maxItems) {
    evictLRU(Math.floor(config.maxItems * 0.9));
  }
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a value from cache
 */
export function get<T>(key: string, ttlMs?: number): T | null {
  const entry = cache.get(key);
  if (!entry) {
    totalMisses++;
    return null;
  }

  const ttl = ttlMs ?? config.defaultTtlMs;
  if (isExpired(entry, ttl)) {
    cache.delete(key);
    totalMisses++;
    return null;
  }

  // Update access time and hit count
  entry.lastAccessedAt = Date.now();
  entry.hits++;
  totalHits++;

  return entry.value as T;
}

/**
 * Set a value in cache
 */
export function set<T>(key: string, value: T, ttlMs?: number): void {
  // Check size before adding
  const newSize = estimateSize(value);
  const maxSizeBytes = config.maxSizeMB * 1024 * 1024;
  const currentSize = getTotalSizeBytes();

  if (currentSize + newSize > maxSizeBytes) {
    // Evict to make room
    evictLRU(Math.floor(config.maxItems * 0.8));
  }

  const now = Date.now();
  cache.set(key, {
    value,
    storedAt: now,
    lastAccessedAt: now,
    hits: 0,
  });

  checkAndEvict();
}

/**
 * Check if a key exists and is not expired
 */
export function has(key: string, ttlMs?: number): boolean {
  const entry = cache.get(key);
  if (!entry) return false;

  const ttl = ttlMs ?? config.defaultTtlMs;
  if (isExpired(entry, ttl)) {
    cache.delete(key);
    return false;
  }

  return true;
}

/**
 * Delete a key from cache
 */
export function del(key: string): boolean {
  return cache.delete(key);
}

/**
 * Clear all cache entries
 */
export function clear(): void {
  cache.clear();
}

/**
 * Get cache size (number of items)
 */
export function size(): number {
  return cache.size;
}

/**
 * Get cache metrics
 */
export function getMetrics(): CacheMetrics {
  const totalRequests = totalHits + totalMisses;
  const hitRate = totalRequests > 0 ? totalHits / totalRequests : 0;

  let oldestItemAge = 0;
  let youngestItemAge = 0;

  if (cache.size > 0) {
    let minAge = Infinity;
    let maxAge = 0;

    for (const entry of cache.values()) {
      const age = Date.now() - entry.storedAt;
      minAge = Math.min(minAge, age);
      maxAge = Math.max(maxAge, age);
    }

    oldestItemAge = maxAge;
    youngestItemAge = minAge === Infinity ? 0 : minAge;
  }

  return {
    size: cache.size,
    itemCount: cache.size,
    hitCount: totalHits,
    missCount: totalMisses,
    hitRate,
    estimatedSizeMB: getTotalSizeBytes() / (1024 * 1024),
    oldestItemAge,
    youngestItemAge,
  };
}

/**
 * Get detailed metrics including cache content info
 */
export function getDetailedMetrics(): CacheMetrics & {
  evictionCount: number;
  configuredMaxItems: number;
  configuredMaxMB: number;
  topAccessedKeys: Array<{ key: string; hits: number; age: number }>;
} {
  const metrics = getMetrics();

  // Get top accessed keys
  const topKeys = Array.from(cache.entries())
    .map(([key, entry]) => ({
      key,
      hits: entry.hits,
      age: Date.now() - entry.lastAccessedAt,
    }))
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 10);

  return {
    ...metrics,
    evictionCount: totalEvictions,
    configuredMaxItems: config.maxItems,
    configuredMaxMB: config.maxSizeMB,
    topAccessedKeys: topKeys,
  };
}

// ─── Warming ───────────────────────────────────────────────────────────────────

/**
 * Type for cache warmer callback
 */
export type CacheWarmerFn = (symbol: string) => Promise<unknown>;

/**
 * Warm cache with initial data
 */
export async function warmCache(
  symbols: string[],
  warmerFn: CacheWarmerFn,
): Promise<{ successful: number; failed: number }> {
  let successful = 0;
  let failed = 0;

  for (const symbol of symbols) {
    try {
      const data = await warmerFn(symbol);
      set(symbol, data);
      successful++;
    } catch (error) {
      failed++;
    }
  }

  return { successful, failed };
}

/**
 * Warm cache with configured warmup symbols
 */
export async function warmConfiguredSymbols(
  warmerFn: CacheWarmerFn,
): Promise<{ successful: number; failed: number }> {
  return warmCache(config.warmupSymbols, warmerFn);
}

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * Update cache configuration
 */
export function updateConfig(updates: Partial<CacheConfig>): void {
  config = { ...config, ...updates };
}

/**
 * Get current configuration
 */
export function getConfig(): CacheConfig {
  return { ...config };
}

/**
 * Set cache size limits
 */
export function setSizeLimits(maxItems: number, maxSizeMB: number): void {
  config.maxItems = maxItems;
  config.maxSizeMB = maxSizeMB;
  checkAndEvict();
}

/**
 * Set TTL for cache entries
 */
export function setDefaultTtl(ttlMs: number): void {
  config.defaultTtlMs = ttlMs;
}

// ─── Eviction Policy ──────────────────────────────────────────────────────────

/**
 * Eviction policy type
 */
export type EvictionPolicy = "lru" | "lfu" | "fifo";

/**
 * Evict entries based on a policy
 */
export function evictByPolicy(policy: EvictionPolicy, count: number): number {
  const entries = Array.from(cache.entries());

  if (policy === "lru") {
    // Sort by last access time
    entries.sort(([, a], [, b]) => a.lastAccessedAt - b.lastAccessedAt);
  } else if (policy === "lfu") {
    // Sort by hit count
    entries.sort(([, a], [, b]) => a.hits - b.hits);
  } else if (policy === "fifo") {
    // Sort by store time
    entries.sort(([, a], [, b]) => a.storedAt - b.storedAt);
  }

  let evicted = 0;
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    const [key] = entries[i];
    cache.delete(key);
    evicted++;
  }

  totalEvictions += evicted;
  return evicted;
}