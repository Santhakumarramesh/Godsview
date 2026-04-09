import { Router, Request, Response } from "express";
import {
  marketplaceEngine,
  subscriptionManager,
  reputationEngine,
  strategyForkEngine,
} from "../lib/strategy_marketplace/index.js";

const router = Router();

// Marketplace Publishing
router.post("/api/marketplace/publish", (req: Request, res: Response) => {
  try {
    const {
      strategyId,
      authorId,
      name,
      description,
      category,
      visibility,
      pricing,
      evidencePacket,
    } = req.body;

    const result = marketplaceEngine.publishStrategy({
      strategyId,
      authorId,
      name,
      description,
      category,
      visibility,
      pricing,
      evidencePacket,
    });

    res.json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get all listings with filters
router.get("/api/marketplace/listings", (req: Request, res: Response) => {
  try {
    const { category, minSharpe, maxDrawdown, sortBy } = req.query;

    const filters: any = {};
    if (category) filters.category = category;
    if (minSharpe) filters.minSharpe = parseFloat(minSharpe as string);
    if (maxDrawdown) filters.maxDrawdown = parseFloat(maxDrawdown as string);
    if (sortBy) filters.sortBy = sortBy;

    const listings = marketplaceEngine.getListings(filters);
    res.json({ listings, count: listings.length });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get single listing
router.get("/api/marketplace/listings/:listingId", (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const listing = marketplaceEngine.getListing(listingId);

    if (!listing) {
      return res.status(404).json({ error: "Listing not found" });
    }

    res.json(listing);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Review listing
router.patch("/api/marketplace/listings/:listingId/review", (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const { decision, reviewerNotes } = req.body;

    const success = marketplaceEngine.reviewListing(listingId, decision, reviewerNotes);

    if (!success) {
      return res.status(404).json({ error: "Listing not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Unpublish listing
router.delete("/api/marketplace/listings/:listingId", (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const success = marketplaceEngine.unpublishListing(listingId);

    if (!success) {
      return res.status(404).json({ error: "Listing not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get marketplace stats
router.get("/api/marketplace/stats", (req: Request, res: Response) => {
  try {
    const stats = marketplaceEngine.getMarketplaceStats();
    res.json(stats);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Subscribe to strategy
router.post("/api/marketplace/subscribe", (req: Request, res: Response) => {
  try {
    const { userId, listingId } = req.body;

    const result = subscriptionManager.subscribe(userId, listingId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Unsubscribe
router.delete("/api/marketplace/subscriptions/:subId", (req: Request, res: Response) => {
  try {
    const { subId } = req.params;
    const success = subscriptionManager.unsubscribe(subId);

    if (!success) {
      return res.status(404).json({ error: "Subscription not found" });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get user subscriptions
router.get("/api/marketplace/subscriptions/:userId", (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const subscriptions = subscriptionManager.getSubscriptions(userId);
    res.json({ subscriptions, count: subscriptions.length });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get listing subscribers
router.get("/api/marketplace/subscribers/:listingId", (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const subscribers = subscriptionManager.getSubscribers(listingId);
    res.json({ subscribers, count: subscribers.length });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get author subscription stats
router.get("/api/marketplace/author/:authorId/stats", (req: Request, res: Response) => {
  try {
    const { authorId } = req.params;
    const stats = subscriptionManager.getSubscriptionStats(authorId);
    res.json(stats);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Rate strategy
router.post("/api/marketplace/ratings", (req: Request, res: Response) => {
  try {
    const { userId, listingId, rating, review } = req.body;

    const ratingId = reputationEngine.rateStrategy(userId, listingId, rating, review);
    res.json({ ratingId, status: "created" });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get strategy ratings
router.get("/api/marketplace/ratings/:listingId", (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const result = reputationEngine.getStrategyRatings(listingId);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get author reputation
router.get("/api/marketplace/reputation/:authorId", (req: Request, res: Response) => {
  try {
    const { authorId } = req.params;
    const reputation = reputationEngine.getAuthorReputation(authorId);
    res.json(reputation);
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get leaderboard
router.get("/api/marketplace/leaderboard", (req: Request, res: Response) => {
  try {
    const { limit } = req.query;
    const leaderboard = reputationEngine.getLeaderboard(
      limit ? parseInt(limit as string) : 10
    );
    res.json({ leaderboard, count: leaderboard.length });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Fork strategy
router.post("/api/marketplace/fork", (req: Request, res: Response) => {
  try {
    const { userId, listingId, newName } = req.body;

    const forkId = strategyForkEngine.forkStrategy(userId, listingId, newName);
    res.json({ forkId, status: "created" });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get forks of a listing
router.get("/api/marketplace/forks/:listingId", (req: Request, res: Response) => {
  try {
    const { listingId } = req.params;
    const forks = strategyForkEngine.getForks(listingId);
    res.json({ forks, count: forks.length });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

// Get user's forks
router.get("/api/marketplace/user-forks/:userId", (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const forks = strategyForkEngine.getUserForks(userId);
    res.json({ forks, count: forks.length });
  } catch (error) {
    res.status(400).json({ error: String(error) });
  }
});

export default router;
