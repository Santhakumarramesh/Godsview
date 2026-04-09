import { randomUUID } from "crypto";
import pino from "pino";

const logger = pino();

// Type definitions
type StrategyCategory = "momentum" | "mean_reversion" | "breakout" | "scalping" | "macro" | "multi_factor";
type StrategyVisibility = "public" | "org_only" | "private";
type PricingModel = "free" | "one_time" | "subscription";
type ListingStatus = "pending_review" | "approved" | "rejected" | "unpublished";

interface EvidencePacket {
  sharpe: number;
  winRate: number;
  maxDrawdown: number;
  totalTrades: number;
  backtestedMonths: number;
}

interface Listing {
  listingId: string;
  strategyId: string;
  authorId: string;
  name: string;
  description: string;
  category: StrategyCategory;
  visibility: StrategyVisibility;
  pricing: {
    model: PricingModel;
    amount?: number;
  };
  evidence: EvidencePacket;
  status: ListingStatus;
  publishedAt: Date;
  reviewedAt?: Date;
  reviewerNotes?: string;
}

interface Subscription {
  subscriptionId: string;
  userId: string;
  listingId: string;
  status: "active" | "cancelled";
  startDate: Date;
  cancelledDate?: Date;
}

interface Rating {
  ratingId: string;
  userId: string;
  listingId: string;
  rating: number;
  review?: string;
  createdAt: Date;
}

interface Fork {
  forkId: string;
  userId: string;
  parentListingId: string;
  name: string;
  createdAt: Date;
}

// MarketplaceEngine
class MarketplaceEngine {
  private listings: Map<string, Listing> = new Map();

  publishStrategy(config: {
    strategyId: string;
    authorId: string;
    name: string;
    description: string;
    category: StrategyCategory;
    visibility: StrategyVisibility;
    pricing: { model: PricingModel; amount?: number };
    evidencePacket: EvidencePacket;
  }): { listingId: string; status: ListingStatus } {
    const listingId = `pub_${randomUUID()}`;
    const listing: Listing = {
      listingId,
      strategyId: config.strategyId,
      authorId: config.authorId,
      name: config.name,
      description: config.description,
      category: config.category,
      visibility: config.visibility,
      pricing: config.pricing,
      evidence: config.evidencePacket,
      status: "pending_review",
      publishedAt: new Date(),
    };

    this.listings.set(listingId, listing);
    logger.info({ listingId, authorId: config.authorId }, "Strategy published");

    return { listingId, status: "pending_review" };
  }

  reviewListing(
    listingId: string,
    decision: "approved" | "rejected",
    reviewerNotes?: string
  ): boolean {
    const listing = this.listings.get(listingId);
    if (!listing) {
      logger.warn({ listingId }, "Listing not found");
      return false;
    }

    listing.status = decision === "approved" ? "approved" : "rejected";
    listing.reviewedAt = new Date();
    listing.reviewerNotes = reviewerNotes;

    logger.info({ listingId, decision }, "Listing reviewed");
    return true;
  }

  getListings(filters?: {
    category?: StrategyCategory;
    minSharpe?: number;
    maxDrawdown?: number;
    sortBy?: string;
  }): Listing[] {
    let results = Array.from(this.listings.values()).filter(
      (l) => l.status === "approved"
    );

    if (filters?.category) {
      results = results.filter((l) => l.category === filters.category);
    }

    if (filters?.minSharpe !== undefined) {
      results = results.filter((l) => l.evidence.sharpe >= filters.minSharpe!);
    }

    if (filters?.maxDrawdown !== undefined) {
      results = results.filter((l) => l.evidence.maxDrawdown <= filters.maxDrawdown!);
    }

    if (filters?.sortBy === "sharpe") {
      results.sort((a, b) => b.evidence.sharpe - a.evidence.sharpe);
    } else if (filters?.sortBy === "recent") {
      results.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
    }

    return results;
  }

  getListing(listingId: string): Listing | null {
    return this.listings.get(listingId) || null;
  }

  unpublishListing(listingId: string): boolean {
    const listing = this.listings.get(listingId);
    if (!listing) {
      logger.warn({ listingId }, "Listing not found");
      return false;
    }

    listing.status = "unpublished";
    logger.info({ listingId }, "Listing unpublished");
    return true;
  }

  getMarketplaceStats(): {
    totalListings: number;
    byCategory: Record<StrategyCategory, number>;
    byPricing: Record<PricingModel, number>;
    avgSharpe: number;
    topPerformers: Listing[];
  } {
    const approved = Array.from(this.listings.values()).filter(
      (l) => l.status === "approved"
    );

    const byCategory: Record<StrategyCategory, number> = {
      momentum: 0,
      mean_reversion: 0,
      breakout: 0,
      scalping: 0,
      macro: 0,
      multi_factor: 0,
    };

    const byPricing: Record<PricingModel, number> = {
      free: 0,
      one_time: 0,
      subscription: 0,
    };

    let totalSharpe = 0;

    for (const listing of approved) {
      byCategory[listing.category]++;
      byPricing[listing.pricing.model]++;
      totalSharpe += listing.evidence.sharpe;
    }

    const avgSharpe = approved.length > 0 ? totalSharpe / approved.length : 0;
    const topPerformers = [...approved]
      .sort((a, b) => b.evidence.sharpe - a.evidence.sharpe)
      .slice(0, 5);

    return {
      totalListings: approved.length,
      byCategory,
      byPricing,
      avgSharpe,
      topPerformers,
    };
  }

  _clearMarketplaceEngine(): void {
    this.listings.clear();
    logger.info("MarketplaceEngine cleared");
  }
}

// SubscriptionManager
class SubscriptionManager {
  private subscriptions: Map<string, Subscription> = new Map();

  subscribe(userId: string, listingId: string): { subscriptionId: string; status: string } {
    // Verify listing is approved (would check with marketplace engine in real app)
    const subId = `sub_${randomUUID()}`;
    const subscription: Subscription = {
      subscriptionId: subId,
      userId,
      listingId,
      status: "active",
      startDate: new Date(),
    };

    this.subscriptions.set(subId, subscription);
    logger.info({ subId, userId, listingId }, "Subscription created");

    return { subscriptionId: subId, status: "active" };
  }

  unsubscribe(subscriptionId: string): boolean {
    const subscription = this.subscriptions.get(subscriptionId);
    if (!subscription) {
      logger.warn({ subscriptionId }, "Subscription not found");
      return false;
    }

    subscription.status = "cancelled";
    subscription.cancelledDate = new Date();

    logger.info({ subscriptionId }, "Subscription cancelled");
    return true;
  }

  getSubscriptions(userId: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (s) => s.userId === userId && s.status === "active"
    );
  }

  getSubscribers(listingId: string): Subscription[] {
    return Array.from(this.subscriptions.values()).filter(
      (s) => s.listingId === listingId && s.status === "active"
    );
  }

  getSubscriptionStats(authorId: string): {
    totalSubscribers: number;
    revenue: number;
    topStrategies: string[];
  } {
    // In real app, would join with marketplace engine
    const subscribersByListing = new Map<string, number>();

    for (const sub of this.subscriptions.values()) {
      if (sub.status === "active") {
        const count = subscribersByListing.get(sub.listingId) || 0;
        subscribersByListing.set(sub.listingId, count + 1);
      }
    }

    const totalSubscribers = Array.from(subscribersByListing.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    return {
      totalSubscribers,
      revenue: totalSubscribers * 100, // Mock: 100 per subscriber
      topStrategies: Array.from(subscribersByListing.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([listingId]) => listingId),
    };
  }

  _clearSubscriptionManager(): void {
    this.subscriptions.clear();
    logger.info("SubscriptionManager cleared");
  }
}

// ReputationEngine
class ReputationEngine {
  private ratings: Map<string, Rating> = new Map();
  private userListingRatings: Map<string, Set<string>> = new Map();

  rateStrategy(userId: string, listingId: string, rating: number, review?: string): string {
    // Check for duplicate
    const key = `${userId}:${listingId}`;
    if (this.userListingRatings.has(key)) {
      logger.warn({ userId, listingId }, "User already rated this strategy");
      throw new Error("User already rated this strategy");
    }

    const ratingId = `rating_${randomUUID()}`;
    const ratingObj: Rating = {
      ratingId,
      userId,
      listingId,
      rating: Math.min(5, Math.max(1, rating)),
      review,
      createdAt: new Date(),
    };

    this.ratings.set(ratingId, ratingObj);
    this.userListingRatings.set(key, new Set([ratingId]));

    logger.info({ ratingId, userId, listingId, rating }, "Rating created");
    return ratingId;
  }

  getStrategyRatings(listingId: string): {
    ratings: Rating[];
    average: number;
    count: number;
  } {
    const ratings = Array.from(this.ratings.values()).filter(
      (r) => r.listingId === listingId
    );

    const average =
      ratings.length > 0
        ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
        : 0;

    return {
      ratings,
      average,
      count: ratings.length,
    };
  }

  getAuthorReputation(authorId: string): {
    avgRating: number;
    totalRatings: number;
    totalSubscribers: number;
    publishedCount: number;
    reputationScore: number;
  } {
    // In real app, would join with marketplace and subscription engines
    const authorRatings = Array.from(this.ratings.values()).filter(
      (r) => r.userId === authorId
    );

    const avgRating =
      authorRatings.length > 0
        ? authorRatings.reduce((sum, r) => sum + r.rating, 0) / authorRatings.length
        : 0;

    const reputationScore =
      avgRating * 20 + authorRatings.length * 0.5 + 100;

    return {
      avgRating,
      totalRatings: authorRatings.length,
      totalSubscribers: 0, // Would be populated from SubscriptionManager
      publishedCount: 0, // Would be populated from MarketplaceEngine
      reputationScore,
    };
  }

  getLeaderboard(limit: number = 10): Array<{
    authorId: string;
    reputationScore: number;
    avgRating: number;
  }> {
    const authorMap = new Map<
      string,
      { totalRating: number; count: number; ratingCount: number }
    >();

    for (const rating of this.ratings.values()) {
      const key = rating.userId;
      const current = authorMap.get(key) || {
        totalRating: 0,
        count: 0,
        ratingCount: 0,
      };
      current.totalRating += rating.rating;
      current.count++;
      current.ratingCount++;
      authorMap.set(key, current);
    }

    const leaderboard = Array.from(authorMap.entries())
      .map(([authorId, stats]) => ({
        authorId,
        reputationScore: stats.totalRating * 20 + stats.ratingCount * 0.5 + 100,
        avgRating: stats.totalRating / stats.count,
      }))
      .sort((a, b) => b.reputationScore - a.reputationScore)
      .slice(0, limit);

    return leaderboard;
  }

  _clearReputationEngine(): void {
    this.ratings.clear();
    this.userListingRatings.clear();
    logger.info("ReputationEngine cleared");
  }
}

// StrategyForkEngine
class StrategyForkEngine {
  private forks: Map<string, Fork> = new Map();

  forkStrategy(userId: string, listingId: string, newName: string): string {
    const forkId = `fork_${randomUUID()}`;
    const fork: Fork = {
      forkId,
      userId,
      parentListingId: listingId,
      name: newName,
      createdAt: new Date(),
    };

    this.forks.set(forkId, fork);
    logger.info({ forkId, userId, listingId }, "Strategy forked");

    return forkId;
  }

  getForks(listingId: string): Fork[] {
    return Array.from(this.forks.values()).filter(
      (f) => f.parentListingId === listingId
    );
  }

  getUserForks(userId: string): Fork[] {
    return Array.from(this.forks.values()).filter((f) => f.userId === userId);
  }

  getForkedFrom(forkId: string): { parentListingId: string } | null {
    const fork = this.forks.get(forkId);
    if (!fork) {
      logger.warn({ forkId }, "Fork not found");
      return null;
    }

    return { parentListingId: fork.parentListingId };
  }

  _clearStrategyForkEngine(): void {
    this.forks.clear();
    logger.info("StrategyForkEngine cleared");
  }
}

// Export singletons
export const marketplaceEngine = new MarketplaceEngine();
export const subscriptionManager = new SubscriptionManager();
export const reputationEngine = new ReputationEngine();
export const strategyForkEngine = new StrategyForkEngine();
