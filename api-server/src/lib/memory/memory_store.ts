/**
 * memory_store.ts — Persistent Memory Storage
 *
 * Handles saving/loading memory to disk in JSON format.
 *
 * Features:
 *   - JSON-based persistence
 *   - Collection-based organization
 *   - Query support
 *   - Cleanup and pruning
 *   - Export/import
 */

import * as fs from "fs";
import * as path from "path";
import { logger } from "../logger";

/**
 * Memory statistics
 */
export interface MemoryStats {
  collections: string[];
  totalItems: number;
  byCollection: Record<string, number>;
  lastUpdated: number;
  diskUsageBytes: number;
}

/**
 * Resolve the memory store base path.
 *
 * Priority:
 *   1. Explicit constructor argument
 *   2. MEMORY_STORE_PATH env var (set in production to a persistent volume)
 *   3. ./data/memory (project-local, works in dev/staging)
 *   4. /tmp/godsview-memory (last-resort fallback)
 *
 * In production containers, MEMORY_STORE_PATH should point to an EBS mount
 * or EFS volume so data survives restarts.
 */
function resolveBasePath(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.MEMORY_STORE_PATH) return process.env.MEMORY_STORE_PATH;
  if (process.env.NODE_ENV === "production") {
    // In production, default to /data/memory (expected EBS/EFS mount)
    return "/data/memory";
  }
  return "/tmp/godsview-memory";
}

class MemoryStore {
  private basePath: string;
  private collections: Set<string> = new Set();

  constructor(basePath?: string) {
    this.basePath = resolveBasePath(basePath);
    this.ensureDirectoryExists();
    this.discoverCollections();
    logger.info({ basePath: this.basePath }, "Memory store initialized");
  }

  /**
   * Save data to a collection
   */
  save(collection: string, key: string, data: unknown): void {
    const collectionPath = this.getCollectionPath(collection);
    this.ensureDirectoryExists(collectionPath);

    const filePath = path.join(collectionPath, `${key}.json`);

    try {
      const payload = {
        timestamp: Date.now(),
        key,
        data,
      };

      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
      this.collections.add(collection);

      logger.debug({ collection, key }, "Memory saved");
    } catch (error) {
      logger.error({ collection, key, error }, "Failed to save memory");
    }
  }

  /**
   * Load data from a collection
   */
  load(collection: string, key: string): unknown {
    const collectionPath = this.getCollectionPath(collection);
    const filePath = path.join(collectionPath, `${key}.json`);

    try {
      if (!fs.existsSync(filePath)) {
        return null;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const payload = JSON.parse(content);
      return payload.data;
    } catch (error) {
      logger.error({ collection, key, error }, "Failed to load memory");
      return null;
    }
  }

  /**
   * Query a collection
   */
  query(collection: string, filter?: Record<string, unknown>): unknown[] {
    const collectionPath = this.getCollectionPath(collection);

    if (!fs.existsSync(collectionPath)) {
      return [];
    }

    const results: unknown[] = [];

    try {
      const files = fs.readdirSync(collectionPath);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(collectionPath, file);
        const content = fs.readFileSync(filePath, "utf-8");
        const payload = JSON.parse(content);

        // Apply filter if provided
        if (filter) {
          let matches = true;
          for (const [key, value] of Object.entries(filter)) {
            if (payload.data[key] !== value) {
              matches = false;
              break;
            }
          }

          if (matches) {
            results.push(payload.data);
          }
        } else {
          results.push(payload.data);
        }
      }
    } catch (error) {
      logger.error({ collection, error }, "Failed to query collection");
    }

    return results;
  }

  /**
   * Get all collections
   */
  getCollections(): string[] {
    return Array.from(this.collections);
  }

  /**
   * Get memory statistics
   */
  getStats(): MemoryStats {
    const byCollection: Record<string, number> = {};
    let totalItems = 0;
    let diskUsageBytes = 0;

    for (const collection of this.collections) {
      const collectionPath = this.getCollectionPath(collection);

      if (!fs.existsSync(collectionPath)) {
        byCollection[collection] = 0;
        continue;
      }

      try {
        const files = fs.readdirSync(collectionPath);
        const jsonFiles = files.filter((f) => f.endsWith(".json"));
        byCollection[collection] = jsonFiles.length;
        totalItems += jsonFiles.length;

        // Calculate disk usage
        for (const file of jsonFiles) {
          const filePath = path.join(collectionPath, file);
          const stats = fs.statSync(filePath);
          diskUsageBytes += stats.size;
        }
      } catch (error) {
        byCollection[collection] = 0;
      }
    }

    return {
      collections: this.getCollections(),
      totalItems,
      byCollection,
      lastUpdated: Date.now(),
      diskUsageBytes,
    };
  }
  /**
   * Cleanup old entries
   */
  prune(maxAgeTtlMs: number): number {
    const now = Date.now();
    let prunedCount = 0;

    for (const collection of this.collections) {
      const collectionPath = this.getCollectionPath(collection);

      if (!fs.existsSync(collectionPath)) continue;

      try {
        const files = fs.readdirSync(collectionPath);

        for (const file of files) {
          if (!file.endsWith(".json")) continue;

          const filePath = path.join(collectionPath, file);

          try {
            const content = fs.readFileSync(filePath, "utf-8");
            const payload = JSON.parse(content);
            const age = now - payload.timestamp;

            if (age > maxAgeTtlMs) {
              fs.unlinkSync(filePath);
              prunedCount++;
            }
          } catch (error) {
            // Skip files that can't be parsed
          }
        }
      } catch (error) {
        logger.error({ collection, error }, "Failed to prune collection");
      }
    }

    logger.info({ prunedCount, maxAgeTtlMs }, "Memory pruned");
    return prunedCount;
  }

  /**
   * Export all memory to a single object
   */
  exportAll(): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const collection of this.collections) {
      const items = this.query(collection);
      result[collection] = items;
    }

    return result;
  }

  /**
   * Import memory from an object
   */
  importAll(data: Record<string, unknown[]>): void {
    for (const [collection, items] of Object.entries(data)) {
      if (!Array.isArray(items)) continue;

      for (let i = 0; i < items.length; i++) {
        const item = items[i] as Record<string, unknown>;
        const key = item.id as string || `item_${i}`;
        this.save(collection, key, item);
      }
    }

    logger.info({ collections: Object.keys(data).length }, "Memory imported");
  }

  /**
   * Clear a collection
   */
  clearCollection(collection: string): number {
    const collectionPath = this.getCollectionPath(collection);

    if (!fs.existsSync(collectionPath)) {
      return 0;
    }

    let deletedCount = 0;

    try {
      const files = fs.readdirSync(collectionPath);

      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(collectionPath, file);
        fs.unlinkSync(filePath);
        deletedCount++;
      }
    } catch (error) {
      logger.error({ collection, error }, "Failed to clear collection");
    }

    return deletedCount;
  }

  /**
   * Ensure directory exists
   */
  private ensureDirectoryExists(dirPath: string = this.basePath): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Get collection directory path
   */
  private getCollectionPath(collection: string): string {
    return path.join(this.basePath, collection);
  }

  /**
   * Discover existing collections
   */
  private discoverCollections(): void {
    this.ensureDirectoryExists();

    try {
      const items = fs.readdirSync(this.basePath);

      for (const item of items) {
        const itemPath = path.join(this.basePath, item);
        const stats = fs.statSync(itemPath);

        if (stats.isDirectory()) {
          this.collections.add(item);
        }
      }
    } catch (error) {
      logger.error({ error }, "Failed to discover collections");
    }
  }
}

export const memoryStore = new MemoryStore();
