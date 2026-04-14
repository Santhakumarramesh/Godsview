/**
 * routes/strategy_marketplace.ts — Phase 58 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  marketplaceEngine,
  subscriptionManager,
  reputationEngine,
  strategyForkEngine,
  type ListingStatus,
} from "../lib/strategy_marketplace";
import { logger } from "../lib/logger";

const router = Router();

// ── Listings ────────────────────────────────────────────────────────────────

router.post("/api/marketplace/listings", (req: Request, res: Response) => {
  try {
    const { strategyId, authorUserId, title, description, tags, pricePerMonth } = req.body ?? {};
    if (!strategyId || !authorUserId || !title) {
      return res.status(400).json({ error: "Missing strategyId, authorUserId, or title" });
    }
    const listing = marketplaceEngine.publish({
      strategyId,
      authorUserId,
      title,
      description: description ?? "",
      tags: Array.isArray(tags) ? tags : [],
      pricePerMonth,
    });
    return res.status(201).json(listing);
  } catch (err) {
    logger.error({ err }, "Failed to publish listing");
    return res.status(500).json({ error: (err as Error).message });
  }
});

router.get("/api/marketplace/listings", (req: Request, res: Response) => {
  const tag = req.query.tag ? String(req.query.tag) : undefined;
  const author = req.query.author ? String(req.query.author) : undefined;
  const status = req.query.status ? (String(req.query.status) as ListingStatus) : undefined;
  res.json({ listings: marketplaceEngine.list({ tag, author, status }) });
});

router.get("/api/marketplace/listings/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const listing = marketplaceEngine.get(id);
  if (!listing) return res.status(404).json({ error: "Not found" });
  const reviews = reputationEngine.forListing(id);
  const reputation = reputationEngine.aggregate(id);
  return res.json({ listing, reviews, reputation });
});

router.patch("/api/marketplace/listings/:id", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const listing = marketplaceEngine.update(id, req.body ?? {});
  if (!listing) return res.status(404).json({ error: "Not found" });
  return res.json(listing);
});

router.post("/api/marketplace/listings/:id/unpublish", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ok = marketplaceEngine.unpublish(id);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

// ── Subscriptions ──────────────────────────────────────────────────────────

router.post("/api/marketplace/subscriptions", (req: Request, res: Response) => {
  const { userId, listingId } = req.body ?? {};
  if (!userId || !listingId) return res.status(400).json({ error: "Missing userId or listingId" });
  const sub = subscriptionManager.subscribe(userId, listingId);
  marketplaceEngine.updateMetrics(listingId, { subscribers: subscriptionManager.subscriberCount(listingId) });
  return res.status(201).json(sub);
});

router.post("/api/marketplace/subscriptions/:id/cancel", (req: Request, res: Response) => {
  const id = String(req.params.id);
  const ok = subscriptionManager.cancel(id);
  return ok ? res.json({ ok: true }) : res.status(404).json({ error: "Not found" });
});

router.get("/api/marketplace/subscriptions", (req: Request, res: Response) => {
  const userId = String(req.query.userId ?? "");
  if (!userId) return res.status(400).json({ error: "Missing userId" });
  return res.json({ subscriptions: subscriptionManager.listForUser(userId) });
});

// ── Reviews ────────────────────────────────────────────────────────────────

router.post("/api/marketplace/listings/:id/reviews", (req: Request, res: Response) => {
  const listingId = String(req.params.id);
  const { userId, rating, title, body } = req.body ?? {};
  if (!userId || rating === undefined || !title) {
    return res.status(400).json({ error: "Missing userId, rating, or title" });
  }
  const rev = reputationEngine.review({ listingId, userId, rating: Number(rating), title, body: body ?? "" });
  const agg = reputationEngine.aggregate(listingId);
  marketplaceEngine.updateMetrics(listingId, { avgRating: agg.avg, reviewCount: agg.count });
  return res.status(201).json(rev);
});

router.get("/api/marketplace/listings/:id/reviews", (req: Request, res: Response) => {
  const listingId = String(req.params.id);
  return res.json({
    reviews: reputationEngine.forListing(listingId),
    aggregate: reputationEngine.aggregate(listingId),
  });
});

// ── Forks ──────────────────────────────────────────────────────────────────

router.post("/api/marketplace/forks", (req: Request, res: Response) => {
  const { sourceStrategyId, forkedStrategyId, forkedByUserId, note } = req.body ?? {};
  if (!sourceStrategyId || !forkedStrategyId || !forkedByUserId) {
    return res.status(400).json({ error: "Missing sourceStrategyId, forkedStrategyId, or forkedByUserId" });
  }
  const rec = strategyForkEngine.record({ sourceStrategyId, forkedStrategyId, forkedByUserId, note });
  return res.status(201).json(rec);
});

router.get("/api/marketplace/forks/:strategyId/lineage", (req: Request, res: Response) => {
  const id = String(req.params.strategyId);
  return res.json({
    lineage: strategyForkEngine.lineage(id),
    descendants: strategyForkEngine.descendants(id),
  });
});

export default router;
