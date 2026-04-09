import express, { Router, Request, Response } from "express";
import {
  feedValidator,
  type FeedSource,
  type TickValidation,
  type CrossFeedCheck,
  type DecisionTimestampAudit,
  type FeedHealthReport,
} from "../lib/data_validator";

const router = Router();

// POST /feeds — register feed
router.post("/feeds", (req: Request, res: Response) => {
  try {
    const {
      name,
      type,
      status,
      last_tick_at,
      staleness_threshold_ms,
    }: Omit<
      FeedSource,
      "id" | "registered_at" | "tick_count" | "avg_latency_ms" | "max_latency_ms"
    > = req.body;

    const feed = feedValidator.registerFeed({
      name,
      type,
      status,
      last_tick_at,
      staleness_threshold_ms,
    });

    res.status(201).json({ success: true, data: feed });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /feeds — list all feeds
router.get("/feeds", (req: Request, res: Response) => {
  try {
    const feeds = feedValidator.getAllFeeds();
    res.status(200).json({ success: true, data: feeds });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /feeds/:id — single feed
router.get("/feeds/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const feed = feedValidator.getFeed(id);

    if (!feed) {
      res.status(404).json({
        success: false,
        error: `Feed ${id} not found`,
      });
      return;
    }

    res.status(200).json({ success: true, data: feed });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// PATCH /feeds/:id/status — update status
router.patch("/feeds/:id/status", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const result = feedValidator.updateFeedStatus(id, status);

    if (!result.success) {
      res.status(404).json(result);
      return;
    }

    const feed = feedValidator.getFeed(id);
    res.status(200).json({ success: true, data: feed });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /ticks — record tick
router.post("/ticks", (req: Request, res: Response) => {
  try {
    const { feed_id, symbol, price, volume, latency_ms } = req.body;

    const validation = feedValidator.recordTick(
      feed_id,
      symbol,
      price,
      volume,
      latency_ms
    );

    res.status(201).json({ success: true, data: validation });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /cross-validate — cross validate feeds
router.post("/cross-validate", (req: Request, res: Response) => {
  try {
    const { symbol, prices, max_divergence_pct } = req.body;

    const check = feedValidator.crossValidateFeeds(
      symbol,
      prices,
      max_divergence_pct
    );

    res.status(200).json({ success: true, data: check });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /decision-audit — audit decision timestamp
router.post("/decision-audit", (req: Request, res: Response) => {
  try {
    const {
      decision_id,
      strategy_id,
      data_timestamp,
      decision_timestamp,
      order_timestamp,
      fill_timestamp,
      threshold_ms,
    } = req.body;

    const audit = feedValidator.auditDecisionTimestamp({
      decision_id,
      strategy_id,
      data_timestamp,
      decision_timestamp,
      order_timestamp,
      fill_timestamp,
      threshold_ms,
    });

    res.status(201).json({ success: true, data: audit });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /decision-audits — list audits (query: strategy_id)
router.get("/decision-audits", (req: Request, res: Response) => {
  try {
    const { strategy_id } = req.query;

    const audits = feedValidator.getDecisionAudits(
      strategy_id as string | undefined
    );

    res.status(200).json({ success: true, data: audits });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /decision-audits/stale — stale decisions
router.get("/decision-audits/stale", (req: Request, res: Response) => {
  try {
    const { max_age_ms } = req.query;

    const stale = feedValidator.getStaleDecisions(
      max_age_ms ? parseInt(max_age_ms as string, 10) : undefined
    );

    res.status(200).json({ success: true, data: stale });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// POST /reports — generate feed health report
router.post("/reports", (req: Request, res: Response) => {
  try {
    const report = feedValidator.generateFeedHealthReport();

    res.status(201).json({ success: true, data: report });
  } catch (error) {
    res.status(400).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /reports — list reports
router.get("/reports", (req: Request, res: Response) => {
  try {
    const { limit } = req.query;

    const reports = feedValidator.getAllFeedReports(
      limit ? parseInt(limit as string, 10) : undefined
    );

    res.status(200).json({ success: true, data: reports });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// GET /reports/:id — single report
router.get("/reports/:id", (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const report = feedValidator.getFeedHealthReport(id);

    if (!report) {
      res.status(404).json({
        success: false,
        error: `Report ${id} not found`,
      });
      return;
    }

    res.status(200).json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

export default router;
