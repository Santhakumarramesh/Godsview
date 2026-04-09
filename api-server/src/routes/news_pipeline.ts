import { Router, Request, Response } from "express";
import { newsService } from "../lib/news_pipeline";

const router = Router();

// POST /news - Ingest news
router.post("/", (req: Request, res: Response) => {
  const { source, headline, symbols, categories, sentiment, impact, published_at, body, url, ai_summary } = req.body;
  if (!source || !headline || !symbols || !categories || !sentiment || !impact || !published_at) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = newsService.ingestNews(source, headline, symbols, categories, sentiment, impact, published_at, body, url, ai_summary);
  res.status(result.success ? 201 : 400).json(result);
});

// GET /news - Get all news
router.get("/", (_req: Request, res: Response) => {
  const result = newsService.getRecentNews(24);
  res.status(200).json(result);
});

// GET /news/:id - Get single news item
router.get("/:id", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = newsService.getNewsItem(id);
  res.status(result.success ? 200 : 404).json(result);
});

// GET /news/symbol/:symbol - Get news by symbol
router.get("/symbol/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const result = newsService.getNewsBySymbol(symbol);
  res.status(200).json(result);
});

// GET /news/category/:category - Get news by category
router.get("/category/:category", (req: Request, res: Response) => {
  const { category } = req.params;
  const result = newsService.getNewsByCategory(category as any);
  res.status(200).json(result);
});

// GET /news/recent - Get recent news
router.get("/recent", (req: Request, res: Response) => {
  const hours = parseInt((req.query.hours as string) ?? "24");
  const result = newsService.getRecentNews(hours);
  res.status(200).json(result);
});

// GET /news/search - Search news
router.get("/search", (req: Request, res: Response) => {
  const query = (req.query.q as string) ?? "";
  if (!query) {
    return res.status(400).json({ success: false, error: "Missing search query" });
  }
  const result = newsService.searchNews(query);
  res.status(200).json(result);
});

// POST /news/:id/summarize - Summarize news
router.post("/:id/summarize", (req: Request, res: Response) => {
  const { id } = req.params;
  const result = newsService.summarizeNews(id);
  res.status(result.success ? 200 : 404).json(result);
});

// POST /signals - Map news to signal
router.post("/signals", (req: Request, res: Response) => {
  const { news_id, symbol, signal_type, confidence, suggested_action, rationale, expires_at } = req.body;
  if (!news_id || !symbol || !signal_type || confidence === undefined || !suggested_action || !rationale || !expires_at) {
    return res.status(400).json({ success: false, error: "Missing required fields" });
  }
  const result = newsService.mapNewsToSignal(news_id, symbol, signal_type, confidence, suggested_action, rationale, expires_at);
  res.status(result.success ? 201 : 400).json(result);
});

// GET /signals/:symbol - Get signals for symbol
router.get("/signals/:symbol", (req: Request, res: Response) => {
  const { symbol } = req.params;
  const result = newsService.getSignalsForSymbol(symbol);
  res.status(200).json(result);
});

// GET /signals - Get all active signals
router.get("/signals", (_req: Request, res: Response) => {
  const result = newsService.getActiveSignals();
  res.status(200).json(result);
});

// GET /sentiment/snapshot - Generate sentiment snapshot
router.get("/sentiment/snapshot", (_req: Request, res: Response) => {
  const result = newsService.generateSentimentSnapshot();
  res.status(result.success ? 200 : 400).json(result);
});

export default router;
