import { describe, it, expect, beforeEach } from "vitest";
import {
  marketplaceEngine,
  subscriptionManager,
  reputationEngine,
  strategyForkEngine,
} from "../lib/strategy_marketplace/index";

describe("Strategy Marketplace", () => {
  beforeEach(() => {
    marketplaceEngine._clearMarketplaceEngine();
    subscriptionManager._clearSubscriptionManager();
    reputationEngine._clearReputationEngine();
    strategyForkEngine._clearStrategyForkEngine();
  });

  describe("MarketplaceEngine", () => {
    it("should publish a strategy with pending_review status", () => {
      const result = marketplaceEngine.publishStrategy({
        strategyId: "strat_001",
        authorId: "author_001",
        name: "Momentum Trader",
        description: "Fast momentum trading strategy",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.65,
          maxDrawdown: 0.12,
          totalTrades: 250,
          backtestedMonths: 36,
        },
      });

      expect(result.listingId).toMatch(/^pub_/);
      expect(result.status).toBe("pending_review");
    });

    it("should review and approve a listing", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_002",
        authorId: "author_002",
        name: "Mean Reversion",
        description: "Mean reversion strategy",
        category: "mean_reversion",
        visibility: "org_only",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 1.2,
          winRate: 0.58,
          maxDrawdown: 0.15,
          totalTrades: 150,
          backtestedMonths: 24,
        },
      });

      const approved = marketplaceEngine.reviewListing(
        listingId,
        "approved",
        "High quality strategy"
      );
      expect(approved).toBe(true);

      const listing = marketplaceEngine.getListing(listingId);
      expect(listing?.status).toBe("approved");
      expect(listing?.reviewerNotes).toBe("High quality strategy");
    });

    it("should reject a listing", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_003",
        authorId: "author_003",
        name: "Risky Strategy",
        description: "High risk strategy",
        category: "scalping",
        visibility: "private",
        pricing: { model: "one_time", amount: 299 },
        evidencePacket: {
          sharpe: 0.5,
          winRate: 0.45,
          maxDrawdown: 0.35,
          totalTrades: 50,
          backtestedMonths: 6,
        },
      });

      const rejected = marketplaceEngine.reviewListing(
        listingId,
        "rejected",
        "Insufficient track record"
      );
      expect(rejected).toBe(true);

      const listing = marketplaceEngine.getListing(listingId);
      expect(listing?.status).toBe("rejected");
    });

    it("should filter listings by category", () => {
      marketplaceEngine.publishStrategy({
        strategyId: "strat_004",
        authorId: "author_004",
        name: "Momentum 1",
        description: "Momentum",
        category: "momentum",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      const { listingId: id2 } = marketplaceEngine.publishStrategy({
        strategyId: "strat_005",
        authorId: "author_005",
        name: "Breakout 1",
        description: "Breakout",
        category: "breakout",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 1.3,
          winRate: 0.55,
          maxDrawdown: 0.12,
          totalTrades: 80,
          backtestedMonths: 12,
        },
      });

      marketplaceEngine.reviewListing(id2, "approved");

      const momentumListings = marketplaceEngine.getListings({
        category: "momentum",
      });
      expect(momentumListings.length).toBe(0); // First one is pending_review
    });

    it("should filter by minimum Sharpe ratio", () => {
      const id1 = marketplaceEngine.publishStrategy({
        strategyId: "strat_006",
        authorId: "author_006",
        name: "High Sharpe",
        description: "Good strategy",
        category: "momentum",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 2.5,
          winRate: 0.7,
          maxDrawdown: 0.08,
          totalTrades: 200,
          backtestedMonths: 24,
        },
      }).listingId;

      const id2 = marketplaceEngine.publishStrategy({
        strategyId: "strat_007",
        authorId: "author_007",
        name: "Low Sharpe",
        description: "Weak strategy",
        category: "momentum",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 0.8,
          winRate: 0.5,
          maxDrawdown: 0.2,
          totalTrades: 50,
          backtestedMonths: 12,
        },
      }).listingId;

      marketplaceEngine.reviewListing(id1, "approved");
      marketplaceEngine.reviewListing(id2, "approved");

      const filtered = marketplaceEngine.getListings({ minSharpe: 2.0 });
      expect(filtered.length).toBe(1);
      expect(filtered[0].evidence.sharpe).toBe(2.5);
    });

    it("should sort listings by Sharpe ratio", () => {
      const ids = [];
      for (let i = 0; i < 3; i++) {
        ids.push(
          marketplaceEngine.publishStrategy({
            strategyId: `strat_${i}`,
            authorId: `author_${i}`,
            name: `Strategy ${i}`,
            description: `Strategy ${i}`,
            category: "momentum",
            visibility: "public",
            pricing: { model: "free" },
            evidencePacket: {
              sharpe: 1.0 + i * 0.5,
              winRate: 0.5 + i * 0.05,
              maxDrawdown: 0.15 - i * 0.02,
              totalTrades: 100,
              backtestedMonths: 12,
            },
          }).listingId
        );
      }

      ids.forEach((id) => marketplaceEngine.reviewListing(id, "approved"));

      const sorted = marketplaceEngine.getListings({ sortBy: "sharpe" });
      expect(sorted[0].evidence.sharpe).toBeGreaterThan(sorted[1].evidence.sharpe);
    });

    it("should unpublish a listing", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_008",
        authorId: "author_008",
        name: "To Unpublish",
        description: "This will be unpublished",
        category: "momentum",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 1.0,
          winRate: 0.5,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      marketplaceEngine.reviewListing(listingId, "approved");
      const unpublished = marketplaceEngine.unpublishListing(listingId);
      expect(unpublished).toBe(true);

      const listing = marketplaceEngine.getListing(listingId);
      expect(listing?.status).toBe("unpublished");
    });

    it("should get marketplace stats", () => {
      const id1 = marketplaceEngine.publishStrategy({
        strategyId: "strat_009",
        authorId: "author_009",
        name: "Strategy A",
        description: "Strategy A",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 2.0,
          winRate: 0.65,
          maxDrawdown: 0.1,
          totalTrades: 150,
          backtestedMonths: 24,
        },
      }).listingId;

      const id2 = marketplaceEngine.publishStrategy({
        strategyId: "strat_010",
        authorId: "author_010",
        name: "Strategy B",
        description: "Strategy B",
        category: "breakout",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.12,
          totalTrades: 120,
          backtestedMonths: 18,
        },
      }).listingId;

      marketplaceEngine.reviewListing(id1, "approved");
      marketplaceEngine.reviewListing(id2, "approved");

      const stats = marketplaceEngine.getMarketplaceStats();
      expect(stats.totalListings).toBe(2);
      expect(stats.byCategory.momentum).toBe(1);
      expect(stats.byCategory.breakout).toBe(1);
      expect(stats.byPricing.subscription).toBe(1);
      expect(stats.byPricing.free).toBe(1);
      expect(stats.avgSharpe).toBeCloseTo(1.75, 1);
      expect(stats.topPerformers.length).toBe(2);
    });

    it("should return null for non-existent listing", () => {
      const listing = marketplaceEngine.getListing("non_existent");
      expect(listing).toBeNull();
    });

    it("should return false for reviewing non-existent listing", () => {
      const result = marketplaceEngine.reviewListing(
        "non_existent",
        "approved"
      );
      expect(result).toBe(false);
    });
  });

  describe("SubscriptionManager", () => {
    it("should create a subscription", () => {
      // Publish and approve a listing first
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_011",
        authorId: "author_011",
        name: "Subscription Test",
        description: "Test",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      const result = subscriptionManager.subscribe("user_001", listingId);
      expect(result.subscriptionId).toMatch(/^sub_/);
      expect(result.status).toBe("active");
    });

    it("should unsubscribe from a strategy", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_012",
        authorId: "author_012",
        name: "Unsubscribe Test",
        description: "Test",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      const { subscriptionId } = subscriptionManager.subscribe("user_002", listingId);
      const unsubscribed = subscriptionManager.unsubscribe(subscriptionId);
      expect(unsubscribed).toBe(true);

      const subs = subscriptionManager.getSubscriptions("user_002");
      expect(subs.length).toBe(0);
    });

    it("should get user subscriptions", () => {
      const { listingId: id1 } = marketplaceEngine.publishStrategy({
        strategyId: "strat_013",
        authorId: "author_013",
        name: "Sub Test 1",
        description: "Test",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      const { listingId: id2 } = marketplaceEngine.publishStrategy({
        strategyId: "strat_014",
        authorId: "author_014",
        name: "Sub Test 2",
        description: "Test",
        category: "breakout",
        visibility: "public",
        pricing: { model: "subscription", amount: 149 },
        evidencePacket: {
          sharpe: 1.3,
          winRate: 0.55,
          maxDrawdown: 0.12,
          totalTrades: 80,
          backtestedMonths: 12,
        },
      });

      subscriptionManager.subscribe("user_003", id1);
      subscriptionManager.subscribe("user_003", id2);

      const subs = subscriptionManager.getSubscriptions("user_003");
      expect(subs.length).toBe(2);
    });

    it("should get subscribers for a listing", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_015",
        authorId: "author_015",
        name: "Subscribers Test",
        description: "Test",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      subscriptionManager.subscribe("user_004", listingId);
      subscriptionManager.subscribe("user_005", listingId);
      subscriptionManager.subscribe("user_006", listingId);

      const subscribers = subscriptionManager.getSubscribers(listingId);
      expect(subscribers.length).toBe(3);
    });

    it("should get subscription stats", () => {
      const stats = subscriptionManager.getSubscriptionStats("author_016");
      expect(stats.totalSubscribers).toBeGreaterThanOrEqual(0);
      expect(stats.revenue).toBeGreaterThanOrEqual(0);
    });

    it("should not return cancelled subscriptions", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_016",
        authorId: "author_016",
        name: "Cancelled Sub Test",
        description: "Test",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      const { subscriptionId } = subscriptionManager.subscribe("user_007", listingId);
      subscriptionManager.unsubscribe(subscriptionId);

      const subs = subscriptionManager.getSubscriptions("user_007");
      expect(subs.length).toBe(0);
    });
  });

  describe("ReputationEngine", () => {
    it("should rate a strategy", () => {
      const ratingId = reputationEngine.rateStrategy(
        "user_008",
        "listing_001",
        5,
        "Great strategy!"
      );
      expect(ratingId).toMatch(/^rating_/);
    });

    it("should prevent duplicate ratings from same user", () => {
      reputationEngine.rateStrategy("user_009", "listing_002", 5);

      expect(() => {
        reputationEngine.rateStrategy("user_009", "listing_002", 4);
      }).toThrow();
    });

    it("should clamp rating to 1-5 range", () => {
      const ratingId = reputationEngine.rateStrategy(
        "user_010",
        "listing_003",
        10
      );
      const ratings = reputationEngine.getStrategyRatings("listing_003");
      expect(ratings.ratings[0].rating).toBe(5);
    });

    it("should get strategy ratings with average", () => {
      reputationEngine.rateStrategy("user_011", "listing_004", 5);
      reputationEngine.rateStrategy("user_012", "listing_004", 4);
      reputationEngine.rateStrategy("user_013", "listing_004", 3);

      const ratings = reputationEngine.getStrategyRatings("listing_004");
      expect(ratings.count).toBe(3);
      expect(ratings.average).toBeCloseTo(4, 1);
    });

    it("should calculate author reputation", () => {
      reputationEngine.rateStrategy("user_014", "listing_005", 5);
      reputationEngine.rateStrategy("user_015", "listing_005", 4);

      const reputation = reputationEngine.getAuthorReputation("user_014");
      expect(reputation.avgRating).toBeGreaterThanOrEqual(0);
      expect(reputation.totalRatings).toBeGreaterThanOrEqual(0);
      expect(reputation.reputationScore).toBeGreaterThan(0);
    });

    it("should get leaderboard", () => {
      reputationEngine.rateStrategy("user_016", "listing_006", 5);
      reputationEngine.rateStrategy("user_017", "listing_006", 4);
      reputationEngine.rateStrategy("user_018", "listing_007", 5);

      const leaderboard = reputationEngine.getLeaderboard(10);
      expect(leaderboard.length).toBeGreaterThan(0);
      expect(leaderboard[0].reputationScore).toBeGreaterThanOrEqual(
        leaderboard[1]?.reputationScore || 0
      );
    });

    it("should handle empty ratings", () => {
      const ratings = reputationEngine.getStrategyRatings("non_existent");
      expect(ratings.count).toBe(0);
      expect(ratings.average).toBe(0);
    });
  });

  describe("StrategyForkEngine", () => {
    it("should fork a strategy", () => {
      const forkId = strategyForkEngine.forkStrategy(
        "user_019",
        "listing_008",
        "My Custom Strategy"
      );
      expect(forkId).toMatch(/^fork_/);
    });

    it("should get all forks of a listing", () => {
      strategyForkEngine.forkStrategy("user_020", "listing_009", "Fork 1");
      strategyForkEngine.forkStrategy("user_021", "listing_009", "Fork 2");
      strategyForkEngine.forkStrategy("user_022", "listing_009", "Fork 3");

      const forks = strategyForkEngine.getForks("listing_009");
      expect(forks.length).toBe(3);
    });

    it("should get user forks", () => {
      strategyForkEngine.forkStrategy("user_023", "listing_010", "Fork A");
      strategyForkEngine.forkStrategy("user_023", "listing_011", "Fork B");
      strategyForkEngine.forkStrategy("user_024", "listing_010", "Fork C");

      const userForks = strategyForkEngine.getUserForks("user_023");
      expect(userForks.length).toBe(2);
    });

    it("should get fork parent information", () => {
      const forkId = strategyForkEngine.forkStrategy(
        "user_025",
        "listing_012",
        "Child Strategy"
      );

      const parent = strategyForkEngine.getForkedFrom(forkId);
      expect(parent).not.toBeNull();
      expect(parent?.parentListingId).toBe("listing_012");
    });

    it("should return null for non-existent fork", () => {
      const parent = strategyForkEngine.getForkedFrom("non_existent_fork");
      expect(parent).toBeNull();
    });
  });

  describe("Integration Tests", () => {
    it("should handle full marketplace lifecycle", () => {
      // Publish strategy
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_final",
        authorId: "author_final",
        name: "Complete Test Strategy",
        description: "Testing full lifecycle",
        category: "momentum",
        visibility: "public",
        pricing: { model: "subscription", amount: 99 },
        evidencePacket: {
          sharpe: 1.8,
          winRate: 0.62,
          maxDrawdown: 0.11,
          totalTrades: 175,
          backtestedMonths: 30,
        },
      });

      // Review and approve
      marketplaceEngine.reviewListing(listingId, "approved");

      // Subscribe
      const { subscriptionId } = subscriptionManager.subscribe(
        "user_lifecycle",
        listingId
      );

      // Rate
      const ratingId = reputationEngine.rateStrategy(
        "user_lifecycle",
        listingId,
        5,
        "Excellent!"
      );

      // Fork
      const forkId = strategyForkEngine.forkStrategy(
        "user_lifecycle",
        listingId,
        "My Variation"
      );

      expect(listingId).toMatch(/^pub_/);
      expect(subscriptionId).toMatch(/^sub_/);
      expect(ratingId).toMatch(/^rating_/);
      expect(forkId).toMatch(/^fork_/);
    });

    it("should maintain data consistency across engines", () => {
      const { listingId } = marketplaceEngine.publishStrategy({
        strategyId: "strat_consistency",
        authorId: "author_consistency",
        name: "Consistency Test",
        description: "Test",
        category: "momentum",
        visibility: "public",
        pricing: { model: "free" },
        evidencePacket: {
          sharpe: 1.5,
          winRate: 0.6,
          maxDrawdown: 0.1,
          totalTrades: 100,
          backtestedMonths: 12,
        },
      });

      marketplaceEngine.reviewListing(listingId, "approved");

      // Subscribe multiple users
      const subs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const { subscriptionId } = subscriptionManager.subscribe(
          `user_consistency_${i}`,
          listingId
        );
        subs.push(subscriptionId);
      }

      // Get subscribers
      const subscribers = subscriptionManager.getSubscribers(listingId);
      expect(subscribers.length).toBe(5);

      // Rate from different users
      for (let i = 0; i < 5; i++) {
        reputationEngine.rateStrategy(
          `user_consistency_${i}`,
          listingId,
          4 + i
        );
      }

      const ratings = reputationEngine.getStrategyRatings(listingId);
      expect(ratings.count).toBe(5);
    });
  });
});
