/**
 * Phase 97 — TradingView MCP Routes
 *
 * Express router for TradingView webhook ingestion and MCP pipeline status.
 */
import { Router, type Request, type Response } from "express";
import { SignalIngestion } from "../lib/tradingview_mcp/signal_ingestion.js";
import { MCPProcessor } from "../lib/tradingview_mcp/mcp_processor.js";
import { MCPPipelineConfigSchema, type MCPPipelineConfig } from "../lib/tradingview_mcp/types.js";

const router = Router();

// Initialize with default config (in production, load from env/db)
const defaultConfig: MCPPipelineConfig = MCPPipelineConfigSchema.parse({});
const ingestion = new SignalIngestion(defaultConfig);
const processor = new MCPProcessor(defaultConfig);

// ── POST /tradingview/webhook — Receive TradingView alert ─────────────────

router.post("/webhook", async (req: Request, res: Response) => {
  try {
    const signal = ingestion.ingestTradingView(req.body);
    if (!signal) {
      res.status(400).json({
        ok: false,
        error: "Signal rejected during ingestion",
        stats: ingestion.getStats(),
      });
      return;
    }

    // Process through MCP pipeline
    const decision = await processor.processSignal(signal);

    res.status(200).json({
      ok: true,
      signalId: signal.id,
      action: decision.action,
      direction: decision.direction,
      confidence: decision.confidence,
      grade: decision.score.grade,
      overallScore: decision.score.overallScore,
      thesis: decision.thesis,
      rejectionReasons: decision.rejectionReasons,
      processingMs: decision.processingMs,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

// ── POST /tradingview/signal/internal — Manual / internal signal ──────────

router.post("/signal/internal", async (req: Request, res: Response) => {
  try {
    const { symbol, direction, signalType, timeframe, price, stopLoss, takeProfit, strategyName } = req.body;

    if (!symbol || !direction || !signalType || !timeframe || !price) {
      res.status(400).json({ ok: false, error: "Missing required fields" });
      return;
    }

    const signal = ingestion.ingestInternal(
      symbol, direction, signalType, timeframe, price, stopLoss, takeProfit, strategyName
    );

    const decision = await processor.processSignal(signal);

    res.status(200).json({
      ok: true,
      signalId: signal.id,
      action: decision.action,
      direction: decision.direction,
      confidence: decision.confidence,
      grade: decision.score.grade,
      overallScore: decision.score.overallScore,
      thesis: decision.thesis,
      processingMs: decision.processingMs,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// ── GET /tradingview/stats — Ingestion statistics ──────────────────────────

router.get("/stats", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    ingestion: ingestion.getStats(),
    approvalRate: processor.getApprovalRate(),
    recentDecisions: processor.getRecentDecisions(10).map((d) => ({
      signalId: d.signalId,
      symbol: d.symbol,
      action: d.action,
      grade: d.score.grade,
      overallScore: d.score.overallScore,
      timestamp: d.timestamp,
    })),
  });
});

// ── GET /tradingview/decisions — Recent MCP decisions ──────────────────────

router.get("/decisions", (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const decisions = processor.getRecentDecisions(limit);

  res.json({
    ok: true,
    count: decisions.length,
    decisions: decisions.map((d) => ({
      signalId: d.signalId,
      symbol: d.symbol,
      action: d.action,
      direction: d.direction,
      confidence: d.confidence,
      grade: d.score.grade,
      overallScore: d.score.overallScore,
      entryPrice: d.entryPrice,
      stopLoss: d.stopLoss,
      takeProfit: d.takeProfit,
      positionSize: d.positionSize,
      thesis: d.thesis,
      rejectionReasons: d.rejectionReasons,
      processingMs: d.processingMs,
      timestamp: d.timestamp,
    })),
  });
});

// ── GET /tradingview/decision/:signalId — Single decision detail ──────────

router.get("/decision/:signalId", (req: Request, res: Response) => {
  const decision = processor.getDecision(req.params.signalId as string);
  if (!decision) {
    res.status(404).json({ ok: false, error: "Decision not found" });
    return;
  }
  res.json({ ok: true, decision });
});

// ── POST /tradingview/config — Update pipeline config ──────────────────────

router.post("/config", (req: Request, res: Response) => {
  try {
    const parsed = MCPPipelineConfigSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: parsed.error.issues });
      return;
    }
    ingestion.updateConfig(parsed.data as Partial<MCPPipelineConfig>);
    processor.updateConfig(parsed.data as Partial<MCPPipelineConfig>);
    res.json({ ok: true, message: "Config updated" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
});

// ── GET /tradingview/health — Pipeline health check ───────────────────────

router.get("/health", (_req: Request, res: Response) => {
  const stats = ingestion.getStats();
  const approvalRate = processor.getApprovalRate();

  res.json({
    ok: true,
    status: "operational",
    pipeline: {
      totalProcessed: stats.totalReceived,
      accepted: stats.totalAccepted,
      rejected: stats.totalRejected,
      approvalRate: (approvalRate * 100).toFixed(1) + "%",
      avgProcessingMs: stats.avgProcessingMs.toFixed(1),
    },
    recentErrors: stats.recentErrors.slice(-5),
  });
});

export default router;