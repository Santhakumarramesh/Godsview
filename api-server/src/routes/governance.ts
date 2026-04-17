/**
 * governance.ts — API Routes for Governance System
 *
 * Endpoints for strategy promotion, demotion, evidence review, and operator decisions.
 */

import { Router, type IRouter } from "express";
import { getGovernanceSystem } from "../lib/governance";
import { getBrainPersistence } from "../lib/brain_persistence";

const router: IRouter = Router();

// ── Promotion Endpoints ────────────────────────────────────────────────────

/**
 * GET /api/governance/promote/:strategyId
 * Evaluate if a strategy is ready for promotion.
 */
router.get("/promote/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { currentTier } = req.query as any;

    // In a real system, would fetch metrics from database
    const mockMetrics = {
      strategyId,
      name: `Strategy_${strategyId}`,
      currentTier: currentTier || "LEARNING",
      totalTrades: 75,
      winRate: 0.58,
      sharpeRatio: 1.15,
      sortinoRatio: 1.3,
      calmarRatio: 0.9,
      profitFactor: 1.8,
      maxDrawdown: 0.12,
      avgReturn: 0.015,
      consistency: 0.82,
      equityCurve: Array(50).fill(0).map((_, i) => 1000 + i * 50),
      walkForwardPassed: true,
      outOfSampleSharpe: 0.95,
      regimeStability: 0.85,
      parameterSensitivity: 0.75,
      monteCarloWorstCase: 0.11,
    };

    const governance = getGovernanceSystem();
    const decision = governance.evaluateStrategyForPromotion(strategyId, currentTier || "LEARNING", mockMetrics);

    res.json(decision);
  } catch (err) {
    req.log.error({ err }, "Promotion evaluation failed");
    res.status(500).json({ error: "promotion_evaluation_failed", message: String(err) });
  }
});

/**
 * GET /api/governance/evidence/:strategyId
 * Get evidence packet for promotion review.
 */
router.get("/evidence/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    const mockMetrics = {
      strategyId,
      name: `Strategy_${strategyId}`,
      currentTier: "PROVEN",
      totalTrades: 120,
      winRate: 0.59,
      sharpeRatio: 1.25,
      sortinoRatio: 1.4,
      calmarRatio: 1.0,
      profitFactor: 1.9,
      maxDrawdown: 0.11,
      avgReturn: 0.016,
      consistency: 0.85,
      equityCurve: Array(100).fill(0).map((_, i) => 1000 + i * 40),
      walkForwardPassed: true,
      outOfSampleSharpe: 1.0,
      regimeStability: 0.88,
      parameterSensitivity: 0.78,
      monteCarloWorstCase: 0.1,
      tailRisk: 0.04,
      correlationWithPortfolio: 0.25,
    };

    const governance = getGovernanceSystem();
    const evidence = governance.generatePromotionEvidence(strategyId, mockMetrics);

    res.json(evidence);
  } catch (err) {
    req.log.error({ err }, "Evidence generation failed");
    res.status(500).json({ error: "evidence_generation_failed", message: String(err) });
  }
});

/**
 * POST /api/governance/promote
 * Request promotion (creates a review item for operator).
 */
router.post("/promote", async (req, res) => {
  try {
    const { strategyId, targetTier } = req.body;

    if (!strategyId || !targetTier) {
      return res.status(400).json({ error: "missing_fields", message: "strategyId and targetTier required" });
    }

    const governance = getGovernanceSystem();
    const result = governance.approvePromotion(strategyId, targetTier, req.user?.id || "unknown");

    const persistence = getBrainPersistence();
    persistence.savePromotionRecord(result);

    res.json({ ok: true, result });
  } catch (err) {
    req.log.error({ err }, "Promotion request failed");
    res.status(500).json({ error: "promotion_request_failed", message: String(err) });
  }
});

// ── Demotion Endpoints ─────────────────────────────────────────────────────

/**
 * POST /api/governance/demote
 * Request demotion of a degrading strategy.
 */
router.post("/demote", async (req, res) => {
  try {
    const { strategyId, targetTier, reason } = req.body;

    if (!strategyId || !targetTier) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const governance = getGovernanceSystem();
    const result = {
      id: `demote_${Date.now()}`,
      strategyId,
      targetTier,
      reason: reason || "Performance degradation",
      timestamp: new Date().toISOString(),
      operator: req.user?.id || "system",
    };

    const persistence = getBrainPersistence();
    persistence.saveDegradationRecord(result);

    res.json({ ok: true, result });
  } catch (err) {
    req.log.error({ err }, "Demotion request failed");
    res.status(500).json({ error: "demotion_request_failed", message: String(err) });
  }
});

// ── Health & Monitoring Endpoints ──────────────────────────────────────────

/**
 * GET /api/governance/health
 * Get overall system health and degradation overview.
 */
router.get("/health", async (req, res) => {
  try {
    const governance = getGovernanceSystem();
    const health = governance.getSystemHealth();

    res.json(health);
  } catch (err) {
    req.log.error({ err }, "Health check failed");
    res.status(500).json({ error: "health_check_failed", message: String(err) });
  }
});

/**
 * GET /api/governance/pending
 * Get pending reviews requiring operator action.
 */
router.get("/pending", async (req, res) => {
  try {
    const governance = getGovernanceSystem();
    const pending = governance.getPendingReviews();

    res.json({ count: pending.length, reviews: pending });
  } catch (err) {
    req.log.error({ err }, "Pending reviews fetch failed");
    res.status(500).json({ error: "pending_fetch_failed", message: String(err) });
  }
});

/**
 * GET /api/governance/alerts
 * Get current system alerts.
 */
router.get("/alerts", async (req, res) => {
  try {
    const governance = getGovernanceSystem();
    const alerts = governance.getAlerts();

    const critical = alerts.filter((a) => a.severity === "critical");
    const warning = alerts.filter((a) => a.severity === "warning");

    res.json({
      totalAlerts: alerts.length,
      critical: critical.length,
      warning: warning.length,
      alerts: alerts.slice(0, 20),
    });
  } catch (err) {
    req.log.error({ err }, "Alerts fetch failed");
    res.status(500).json({ error: "alerts_fetch_failed", message: String(err) });
  }
});

// ── Dashboard Endpoints ────────────────────────────────────────────────────

/**
 * GET /api/governance/report
 * Get daily operator report.
 */
router.get("/report", async (req, res) => {
  try {
    const governance = getGovernanceSystem();
    const report = governance.generateDailyReport();

    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Report generation failed");
    res.status(500).json({ error: "report_generation_failed", message: String(err) });
  }
});

/**
 * GET /api/governance/portfolio
 * Get portfolio overview.
 */
router.get("/portfolio", async (req, res) => {
  try {
    const governance = getGovernanceSystem();
    const portfolio = governance.getPortfolioOverview();

    res.json(portfolio);
  } catch (err) {
    req.log.error({ err }, "Portfolio overview failed");
    res.status(500).json({ error: "portfolio_overview_failed", message: String(err) });
  }
});

// ── Operator Decision Endpoints ────────────────────────────────────────────

/**
 * POST /api/governance/decision
 * Record operator decision on a review.
 */
router.post("/decision", async (req, res) => {
  try {
    const { reviewId, decision, notes } = req.body;

    if (!reviewId || !decision) {
      return res.status(400).json({ error: "missing_fields" });
    }

    const governance = getGovernanceSystem();
    governance.recordOperatorDecision(reviewId, decision, notes || "");

    const persistence = getBrainPersistence();
    persistence.saveOperatorDecision({
      id: `decision_${Date.now()}`,
      reviewId,
      decision,
      notes,
      operator: req.user?.id || "unknown",
      timestamp: new Date().toISOString(),
    });

    res.json({ ok: true, recorded: true });
  } catch (err) {
    req.log.error({ err }, "Decision recording failed");
    res.status(500).json({ error: "decision_recording_failed", message: String(err) });
  }
});

/**
 * POST /api/governance/pause/:strategyId
 * Pause a strategy.
 */
router.post("/pause/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;
    const { reason } = req.body;

    const governance = getGovernanceSystem();
    governance.pauseStrategy(strategyId, reason || "Manual pause");

    res.json({ ok: true, paused: true, strategyId });
  } catch (err) {
    req.log.error({ err }, "Strategy pause failed");
    res.status(500).json({ error: "pause_failed", message: String(err) });
  }
});

/**
 * POST /api/governance/resume/:strategyId
 * Resume a paused strategy.
 */
router.post("/resume/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    const governance = getGovernanceSystem();
    governance.resumeStrategy(strategyId);

    res.json({ ok: true, resumed: true, strategyId });
  } catch (err) {
    req.log.error({ err }, "Strategy resume failed");
    res.status(500).json({ error: "resume_failed", message: String(err) });
  }
});

// ── Family Management Endpoints ────────────────────────────────────────────

/**
 * GET /api/governance/families
 * Get strategy families and their composition.
 */
router.get("/families", async (req, res) => {
  try {
    const governance = getGovernanceSystem();

    // Would fetch strategies from DB
    const mockStrategies = [
      { strategyId: "s1", name: "Scalper_V1", tier: "PROVEN", sharpeRatio: 1.1, winRate: 0.56, maxDrawdown: 0.12, totalTrades: 100 },
      { strategyId: "s2", name: "Scalper_V2", tier: "LEARNING", sharpeRatio: 0.9, winRate: 0.52, maxDrawdown: 0.15, totalTrades: 50 },
      { strategyId: "s3", name: "Trend_V1", tier: "PROVEN", sharpeRatio: 1.3, winRate: 0.58, maxDrawdown: 0.1, totalTrades: 120 },
    ];

    const families = governance.organizeStrategyFamilies(mockStrategies);

    res.json({ count: families.length, families });
  } catch (err) {
    req.log.error({ err }, "Families fetch failed");
    res.status(500).json({ error: "families_fetch_failed", message: String(err) });
  }
});

/**
 * GET /api/governance/lineage/:strategyId
 * Get strategy lineage and version history.
 */
router.get("/lineage/:strategyId", async (req, res) => {
  try {
    const { strategyId } = req.params;

    const governance = getGovernanceSystem();

    // Mock lineage
    const lineage = {
      strategyId,
      name: `Strategy_${strategyId}`,
      variant: "V3",
      parentId: `${strategyId}_parent`,
      children: [],
      createdAt: new Date(Date.now() - 90 * 86400000).toISOString(),
      baselineMetrics: { sharpe: 0.8, winRate: 0.50, maxDrawdown: 0.18 },
      modifications: [
        {
          timestamp: new Date(Date.now() - 60 * 86400000).toISOString(),
          change: "Increased confirmation threshold",
          beforeMetrics: { sharpe: 0.8, winRate: 0.50 },
          afterMetrics: { sharpe: 0.95, winRate: 0.52 },
        },
      ],
    };

    res.json(lineage);
  } catch (err) {
    req.log.error({ err }, "Lineage fetch failed");
    res.status(500).json({ error: "lineage_fetch_failed", message: String(err) });
  }
});

// ── Persistence & Export Endpoints ─────────────────────────────────────────

/**
 * GET /api/governance/export
 * Export all governance data for analysis.
 */
router.get("/export", async (req, res) => {
  try {
    const persistence = getBrainPersistence();
    const data = persistence.exportAllData();

    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Export failed");
    res.status(500).json({ error: "export_failed", message: String(err) });
  }
});

/**
 * GET /api/governance/status
 * Get governance system status.
 */
router.get("/status", async (req, res) => {
  try {
    const governance = getGovernanceSystem();
    const status = governance.getGovernanceStatus();

    res.json(status);
  } catch (err) {
    req.log.error({ err }, "Status check failed");
    res.status(500).json({ error: "status_check_failed", message: String(err) });
  }
});

export default router;
