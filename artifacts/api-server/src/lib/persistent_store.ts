/**
 * persistent_store.ts — JSON-file-based persistence layer (Phase 51)
 *
 * Provides durable storage for strategy registry, validation reports,
 * monitor events, overlay snapshots, and replay records.
 *
 * Uses environment variable GODSVIEW_DATA_DIR for storage location.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { logger } from "./logger.js";

const DATA_DIR = process.env.GODSVIEW_DATA_DIR || ".runtime";
const STORE_DIR = join(DATA_DIR, "persistent");

/**
 * Ensure the persistent store directory exists
 */
function ensureDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
    logger.debug(`Created persistent store directory: ${STORE_DIR}`);
  }
}

/**
 * Write data to a collection (overwrites entire file)
 */
export function persistWrite<T>(collection: string, data: T): void {
  try {
    ensureDir();
    const path = join(STORE_DIR, `${collection}.json`);
    writeFileSync(path, JSON.stringify(data, null, 2));
    logger.debug(`Persisted ${collection}: ${JSON.stringify(data).length} bytes`);
  } catch (error) {
    logger.error({ error, collection }, "Failed to persist data");
    throw error;
  }
}

/**
 * Read data from a collection (returns fallback if missing or invalid)
 */
export function persistRead<T>(collection: string, fallback: T): T {
  try {
    ensureDir();
    const path = join(STORE_DIR, `${collection}.json`);
    if (!existsSync(path)) {
      logger.debug(`Collection ${collection} not found, returning fallback`);
      return fallback;
    }
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as T;
  } catch (error) {
    logger.warn({ error, collection }, "Failed to read collection, returning fallback");
    return fallback;
  }
}

/**
 * Append an item to a collection (array), maintaining max items limit
 */
export function persistAppend<T>(collection: string, item: T, maxItems: number = 10000): void {
  try {
    const items = persistRead<T[]>(collection, []);
    items.push(item);

    // Trim oldest items if exceeding max
    if (items.length > maxItems) {
      items.splice(0, items.length - maxItems);
      logger.debug(`Trimmed ${collection} to ${maxItems} items`);
    }

    persistWrite(collection, items);
  } catch (error) {
    logger.error({ error, collection }, "Failed to append to collection");
    throw error;
  }
}

/**
 * Clear a collection (write empty array)
 */
export function persistDelete(collection: string): void {
  try {
    ensureDir();
    const path = join(STORE_DIR, `${collection}.json`);
    if (existsSync(path)) {
      writeFileSync(path, "[]");
      logger.info(`Cleared collection: ${collection}`);
    }
  } catch (error) {
    logger.error({ error, collection }, "Failed to delete collection");
  }
}

/**
 * List all collections in the store
 */
export function listCollections(): string[] {
  try {
    ensureDir();
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const files = readdirSync(STORE_DIR);
    return files
      .filter((f: string) => f.endsWith(".json"))
      .map((f: string) => f.replace(".json", ""));
  } catch (error) {
    logger.warn({ error }, "Failed to list collections");
    return [];
  }
}

/**
 * Get count of items in a collection
 */
export function getCollectionSize(collection: string): number {
  try {
    const items = persistRead<unknown[]>(collection, []);
    return items.length;
  } catch {
    return 0;
  }
}

/**
 * Get store directory path (for testing/debugging)
 */
export function getStorePath(): string {
  return STORE_DIR;
}
