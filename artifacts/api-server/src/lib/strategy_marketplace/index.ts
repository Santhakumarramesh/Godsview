/**
 * strategy_marketplace/index.ts — Phase 58: Strategy Marketplace
 * ─────────────────────────────────────────────────────────────────────────────
 * Publish strategies, subscribe to them, track reputation, and fork.
 *
 *   1. MarketplaceEngine   — publish / list / unpublish listings.
 *   2. SubscriptionManager — per-user subscriptions.
 *   3. ReputationEngine    — ratings + reviews + aggregate score.
 *   4. StrategyForkEngine  — track fork lineage.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "../logger.js";

// ── Listings ────────────────────────────────────────────────────────────────

export type ListingStatus = "draft" | "published" | "unlisted" | "deprecated";

export interface StrategyListing {
  id: string;
  strategyId: string;
  authorUserId: string;
  title: string;
  description: string;
  tags: string[];
  pricePerMonth: number; // 0 = free
  currency: "USD";
  status: ListingStatus;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
  metrics: {
    subscribers: number;
    avgRating: number;
    reviewCount: number;
  };
}

export class MarketplaceEngine {
  private readonly listings = new Map<string, StrategyListing>();

  publish(params: {
    strategyId: string;
    authorUserId: string;
    title: string;
    description: string;
    tags: string[];
    pricePerMonth?: number;
  }): StrategyListing {
    const id = `lst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const now = Date.now();
    const listing: StrategyListing = {
      id,
      strategyId: params.strategyId,
      authorUserId: params.authorUserId,
      title: params.title,
      description: params.description,
      tags: params.tags,
      pricePerMonth: params.pricePerMonth ?? 0,
      currency: "USD",
      status: "published",
      publishedAt: now,
      createdAt: now,
      updatedAt: now,
      metrics: { subscribers: 0, avgRating: 0, reviewCount: 0 },
    };
    this.listings.set(id, listing);
    logger.info({ listingId: id }, "[Marketplace] Listing published");
    return listing;
  }

  list(filter?: { tag?: string; author?: string; status?: ListingStatus }): StrategyListing[] {
    return Array.from(this.listings.values()).filter((l) => {
      if (filter?.tag && !l.tags.includes(filter.tag)) return false;
      if (filter?.author && l.authorUserId !== filter.author) return false;
      if (filter?.status && l.status !== filter.status) return false;
      return true;
    });
  }

  get(id: string): StrategyListing | null {
    return this.listings.get(id) ?? null;
  }

  unpublish(id: string): boolean {
    const l = this.listings.get(id);
    if (!l) return false;
    l.status = "unlisted";
    l.updatedAt = Date.now();
    return true;
  }

  update(id: string, patch: Partial<Pick<StrategyListing, "title" | "description" | "tags" | "pricePerMonth">>): StrategyListing | null {
    const l = this.listings.get(id);
    if (!l) return null;
    Object.assign(l, patch, { updatedAt: Date.now() });
    return l;
  }

  updateMetrics(id: string, metrics: Partial<StrategyListing["metrics"]>): void {
    const l = this.listings.get(id);
    if (!l) return;
    l.metrics = { ...l.metrics, ...metrics };
  }
}

// ── Subscriptions ──────────────────────────────────────────────────────────

export interface Subscription {
  id: string;
  listingId: string;
  userId: string;
  startedAt: number;
  cancelledAt?: number;
  active: boolean;
}

export class SubscriptionManager {
  private readonly subs = new Map<string, Subscription>();

  subscribe(userId: string, listingId: string): Subscription {
    const id = `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const sub: Subscription = {
      id,
      listingId,
      userId,
      startedAt: Date.now(),
      active: true,
    };
    this.subs.set(id, sub);
    return sub;
  }

  cancel(id: string): boolean {
    const s = this.subs.get(id);
    if (!s) return false;
    s.active = false;
    s.cancelledAt = Date.now();
    return true;
  }

  listForUser(userId: string): Subscription[] {
    return Array.from(this.subs.values()).filter((s) => s.userId === userId);
  }

  subscriberCount(listingId: string): number {
    return Array.from(this.subs.values()).filter((s) => s.listingId === listingId && s.active).length;
  }
}

// ── Reputation ──────────────────────────────────────────────────────────────

export interface Review {
  id: string;
  listingId: string;
  userId: string;
  rating: number; // 1-5
  title: string;
  body: string;
  createdAt: number;
}

export class ReputationEngine {
  private readonly reviews = new Map<string, Review>();

  review(params: { listingId: string; userId: string; rating: number; title: string; body: string }): Review {
    const id = `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    const clamped = Math.max(1, Math.min(5, params.rating | 0));
    const rev: Review = {
      id,
      listingId: params.listingId,
      userId: params.userId,
      rating: clamped,
      title: params.title,
      body: params.body,
      createdAt: Date.now(),
    };
    this.reviews.set(id, rev);
    return rev;
  }

  forListing(listingId: string): Review[] {
    return Array.from(this.reviews.values()).filter((r) => r.listingId === listingId);
  }

  aggregate(listingId: string): { avg: number; count: number; distribution: Record<string, number> } {
    const all = this.forListing(listingId);
    const count = all.length;
    const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
    if (count === 0) return { avg: 0, count: 0, distribution };
    let sum = 0;
    for (const r of all) {
      sum += r.rating;
      distribution[String(r.rating)] = (distribution[String(r.rating)] ?? 0) + 1;
    }
    return { avg: sum / count, count, distribution };
  }
}

// ── Fork Lineage ────────────────────────────────────────────────────────────

export interface ForkRecord {
  id: string;
  sourceStrategyId: string;
  forkedStrategyId: string;
  forkedByUserId: string;
  note?: string;
  at: number;
}

export class StrategyForkEngine {
  private readonly forks: ForkRecord[] = [];

  record(params: { sourceStrategyId: string; forkedStrategyId: string; forkedByUserId: string; note?: string }): ForkRecord {
    const rec: ForkRecord = {
      id: `fork_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      ...params,
    };
    this.forks.push(rec);
    return rec;
  }

  lineage(strategyId: string): ForkRecord[] {
    return this.forks.filter((f) => f.sourceStrategyId === strategyId || f.forkedStrategyId === strategyId);
  }

  descendants(strategyId: string): string[] {
    const out = new Set<string>();
    const stack = [strategyId];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const f of this.forks) {
        if (f.sourceStrategyId === cur && !out.has(f.forkedStrategyId)) {
          out.add(f.forkedStrategyId);
          stack.push(f.forkedStrategyId);
        }
      }
    }
    return Array.from(out);
  }

  all(): ForkRecord[] {
    return [...this.forks];
  }
}

// ── Singletons ──────────────────────────────────────────────────────────────

export const marketplaceEngine = new MarketplaceEngine();
export const subscriptionManager = new SubscriptionManager();
export const reputationEngine = new ReputationEngine();
export const strategyForkEngine = new StrategyForkEngine();
