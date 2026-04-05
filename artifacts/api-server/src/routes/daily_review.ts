/**
 * routes/daily_review.ts — Daily Review REST API
 *
 * Endpoints:
 *   GET    /api/daily-review/:symbol/:date — Get review for symbol on date
 *   GET    /api/daily-review/:symbol — Get all reviews for symbol (query: from, to)
 *   GET    /api/daily-review — Get all reviews (query: from, to)
 *   POST   /api/daily-review/generate — Generate review for symbol + date
 *   POST   /api/daily-review/generate-all — Generate reviews for watchlist
 */

import { Router } from "express";
import {
  generateDailyReview,
  saveDailyReview,
  getDailyReview,
  getDailyReviews,
  getAllReviews,
  clearReviews,
  type DailyReview,
} from "../engines/daily_review_engine";

const router = Router();

/**
 * GET /api/daily-review
 * Get all reviews (optionally filtered by date range)
 */
router.get("/api/daily-review", (_req, res) => {
  const { from, to } = _req.query;
  const reviews = getAllReviews(from as string | undefined, to as string | undefined);
  res.json({ reviews, count: reviews.length });
});

/**
 * GET /api/daily-review/:symbol
 * Get all reviews for a specific symbol (optionally filtered by date range)
 */
router.get("/api/daily-review/:symbol", (req, res) => {
  const { symbol } = req.params;
  const { from, to } = req.query;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "missing_symbol" });
    return;
  }

  const reviews = getDailyReviews(symbol, from as string | undefined, to as string | undefined);
  res.json({ symbol, reviews, count: reviews.length });
});

/**
 * GET /api/daily-review/:symbol/:date
 * Get review for specific symbol and date
 */
router.get("/api/daily-review/:symbol/:date", (req, res) => {
  const { symbol, date } = req.params;

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "missing_symbol" });
    return;
  }

  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "invalid_date", message: "date must be YYYY-MM-DD format" });
    return;
  }

  const review = getDailyReview(symbol, date);
  if (!review) {
    res.status(404).json({ error: "not_found" });
    return;
  }

  res.json(review);
});

/**
 * POST /api/daily-review/generate
 * Generate a new review for symbol + date
 * Body: { symbol, date, signals?, trades?, structureData? }
 */
router.post("/api/daily-review/generate", (req, res) => {
  const { symbol, date, signals = [], trades = [], structureData = {} } = req.body ?? {};

  if (!symbol || typeof symbol !== "string") {
    res.status(400).json({ error: "missing_symbol" });
    return;
  }

  if (!date || typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    res.status(400).json({ error: "invalid_date", message: "date must be YYYY-MM-DD format" });
    return;
  }

  try {
    const review = generateDailyReview(symbol, date, signals, trades, structureData);
    saveDailyReview(review);
    res.json(review);
  } catch (err: any) {
    res.status(500).json({ error: "generation_failed", message: err.message });
  }
});

/**
 * POST /api/daily-review/generate-all
 * Generate reviews for all watchlist symbols for today
 * Body: { symbols, structureData?, signals?, trades? }
 */
router.post("/api/daily-review/generate-all", (req, res) => {
  const { symbols = [], structureData = {}, signals = [], trades = [] } = req.body ?? {};

  if (!Array.isArray(symbols) || symbols.length === 0) {
    res.status(400).json({ error: "missing_symbols", message: "symbols array is required" });
    return;
  }

  const today = new Date().toISOString().split("T")[0];
  const generated: DailyReview[] = [];

  try {
    for (const symbol of symbols) {
      if (typeof symbol !== "string") continue;
      const review = generateDailyReview(symbol, today, signals, trades, structureData);
      saveDailyReview(review);
      generated.push(review);
    }

    res.json({ generated, count: generated.length });
  } catch (err: any) {
    res.status(500).json({ error: "generation_failed", message: err.message });
  }
});

export default router;
