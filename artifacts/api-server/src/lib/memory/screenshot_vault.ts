/**
 * Screenshot Memory Vault — Stores chart snapshots with metadata
 * for case library linking and trade documentation.
 *
 * Screenshots track:
 * - Pre-entry setups with annotations
 * - Post-exit confirmations
 * - Anomalies and market regime flags
 * - Trade ID linkage for case analysis
 *
 * Index limit: configurable max entries (default 500)
 */

import { EventEmitter } from "events";
// @ts-expect-error TS2307 — auto-suppressed for strict build
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────

export type ScreenshotType =
  | "pre_entry"
  | "post_exit"
  | "setup_identified"
  | "anomaly";

export interface ScreenshotMetadata {
  id: string;
  symbol: string;
  timeframe: string;
  timestamp: string;
  screenshotType: ScreenshotType;
  tags: string[];
  tradeId?: string;
  caseLibraryId?: string;
  notes?: string;
  imageUrl?: string;
  width: number;
  height: number;
}

export interface ScreenshotVaultConfig {
  maxEntries: number;
}

// ── Screenshot Vault Class ─────────────────────────────────────────

class ScreenshotVault extends EventEmitter {
  private index: Map<string, ScreenshotMetadata> = new Map();
  private idSequence = 0;
  private config: ScreenshotVaultConfig;

  constructor(config: ScreenshotVaultConfig = { maxEntries: 500 }) {
    super();
    this.config = config;
    logger.info("[ScreenshotVault] Initialized", {
      maxEntries: config.maxEntries,
    });
  }

  /**
   * Upload and store a screenshot reference with metadata
   */
  upload(data: Omit<ScreenshotMetadata, "id">): ScreenshotMetadata {
    // Generate unique ID
    const id = `ss_${Date.now()}_${++this.idSequence}`;

    const metadata: ScreenshotMetadata = {
      ...data,
      id,
    };

    // Check size limits
    if (this.index.size >= this.config.maxEntries) {
      // Remove oldest entry by ID (simple FIFO)
      const oldestKey = this.index.keys().next().value;
      if (oldestKey) {
        this.index.delete(oldestKey);
        logger.debug("[ScreenshotVault] Evicted old screenshot", { id: oldestKey });
      }
    }

    this.index.set(id, metadata);
    this.emit("screenshot_uploaded", { id, symbol: data.symbol });
    logger.debug("[ScreenshotVault] Screenshot uploaded", { id, symbol: data.symbol });

    return metadata;
  }

  /**
   * Retrieve screenshot by ID
   */
  getById(id: string): ScreenshotMetadata | undefined {
    return this.index.get(id);
  }

  /**
   * Search screenshots by symbol and optional date range
   */
  searchBySymbol(
    symbol: string,
    options?: { startDate?: string; endDate?: string },
  ): ScreenshotMetadata[] {
    const results: ScreenshotMetadata[] = [];

    for (const meta of this.index.values()) {
      if (meta.symbol !== symbol) continue;

      if (options?.startDate && meta.timestamp < options.startDate) continue;
      if (options?.endDate && meta.timestamp > options.endDate) continue;

      results.push(meta);
    }

    return results;
  }

  /**
   * Search screenshots by tags
   */
  searchByTags(tags: string[]): ScreenshotMetadata[] {
    const results: ScreenshotMetadata[] = [];

    for (const meta of this.index.values()) {
      const hasAnyTag = tags.some((tag) => meta.tags.includes(tag));
      if (hasAnyTag) {
        results.push(meta);
      }
    }

    return results;
  }

  /**
   * Search screenshots by type
   */
  searchByType(type: ScreenshotType): ScreenshotMetadata[] {
    const results: ScreenshotMetadata[] = [];

    for (const meta of this.index.values()) {
      if (meta.screenshotType === type) {
        results.push(meta);
      }
    }

    return results;
  }

  /**
   * Link screenshot to trade ID
   */
  linkToTrade(screenshotId: string, tradeId: string): boolean {
    const meta = this.index.get(screenshotId);
    if (!meta) return false;

    meta.tradeId = tradeId;
    this.emit("screenshot_linked", { screenshotId, tradeId });
    logger.debug("[ScreenshotVault] Screenshot linked to trade", {
      screenshotId,
      tradeId,
    });

    return true;
  }

  /**
   * Link screenshot to case library
   */
  linkToCase(screenshotId: string, caseId: string): boolean {
    const meta = this.index.get(screenshotId);
    if (!meta) return false;

    meta.caseLibraryId = caseId;
    this.emit("screenshot_linked_case", { screenshotId, caseId });

    return true;
  }

  /**
   * Get all screenshots by trade ID
   */
  getByTradeId(tradeId: string): ScreenshotMetadata[] {
    const results: ScreenshotMetadata[] = [];

    for (const meta of this.index.values()) {
      if (meta.tradeId === tradeId) {
        results.push(meta);
      }
    }

    return results;
  }

  /**
   * Get vault statistics
   */
  getStats() {
    const typeCount = new Map<ScreenshotType, number>();

    for (const meta of this.index.values()) {
      const count = typeCount.get(meta.screenshotType) ?? 0;
      typeCount.set(meta.screenshotType, count + 1);
    }

    return {
      totalScreenshots: this.index.size,
      maxCapacity: this.config.maxEntries,
      utilization: (this.index.size / this.config.maxEntries) * 100,
      typeBreakdown: Object.fromEntries(typeCount),
    };
  }

  /**
   * Clear all screenshots (reset vault)
   */
  clear(): void {
    this.index.clear();
    this.emit("vault_cleared");
    logger.info("[ScreenshotVault] Vault cleared");
  }
}

// ── Singleton Export ───────────────────────────────────────────────

export const screenshotVault = new ScreenshotVault();
