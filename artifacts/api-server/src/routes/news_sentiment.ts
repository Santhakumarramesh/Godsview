/**
 * routes/news_sentiment.ts — Phase 89 HTTP surface.
 */

import { Router, Request, Response } from "express";
import {
  newsStore,
  sentimentScorer,
  symbolExtractor,
  eventCategorizer,
  type NewsCategory,
} from "../lib/news_sentiment";

const router = Router();

router.post("/api/news/ingest", (req: Request, res: Response) => {
  const { source, headline, body, url, publishedAt, symbols, categories, metadata } = req.body ?? {};
  if (!source || !headline) return res.status(400).json({ error: "Missing source or headline" });
  const text = `${headline} ${body ?? ""}`;
  const detectedSymbols = Array.isArray(symbols) && symbols.length > 0 ? symbols : symbolExtractor.extract(text);
  const detectedCategories = Array.isArray(categories) && categories.length > 0
    ? categories
    : eventCategorizer.categorize(text);
  const sentiment = sentimentScorer.score(text);
  const item = newsStore.ingest({
    source: String(source),
    headline: String(headline),
    body,
    url,
    publishedAt: publishedAt ? Number(publishedAt) : Date.now(),
    symbols: detectedSymbols,
    categories: detectedCategories as NewsCategory[],
    sentiment: sentiment.score,
    confidence: sentiment.confidence,
    metadata: metadata ?? {},
  });
  return res.status(201).json({ item, sentiment });
});

router.get("/api/news", (req: Request, res: Response) => {
  res.json({
    items: newsStore.query({
      symbol: req.query.symbol ? String(req.query.symbol) : undefined,
      category: req.query.category ? (String(req.query.category) as NewsCategory) : undefined,
      since: req.query.since ? Number(req.query.since) : undefined,
      until: req.query.until ? Number(req.query.until) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
    size: newsStore.size(),
  });
});

router.get("/api/news/symbol/:symbol", (req: Request, res: Response) => {
  const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : 24 * 60 * 60 * 1000;
  res.json({ items: newsStore.bySymbol(String(req.params.symbol), sinceMs) });
});

router.post("/api/news/sentiment", (req: Request, res: Response) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "Missing text" });
  return res.json(sentimentScorer.score(String(text)));
});

router.post("/api/news/extract-symbols", (req: Request, res: Response) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "Missing text" });
  return res.json({ symbols: symbolExtractor.extract(String(text)) });
});

router.post("/api/news/categorize", (req: Request, res: Response) => {
  const { text } = req.body ?? {};
  if (!text) return res.status(400).json({ error: "Missing text" });
  return res.json({ categories: eventCategorizer.categorize(String(text)) });
});

router.post("/api/news/symbols/register", (req: Request, res: Response) => {
  const { symbol, companyName } = req.body ?? {};
  if (!symbol) return res.status(400).json({ error: "Missing symbol" });
  symbolExtractor.registerSymbol(String(symbol), companyName);
  return res.status(201).json({ ok: true });
});

export default router;
