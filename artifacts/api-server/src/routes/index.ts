import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalsRouter from "./signals";
import tradesRouter from "./trades";
import performanceRouter from "./performance";
import systemRouter from "./system";
import alpacaRouter from "./alpaca";
import orderbookRouter from "./orderbook";
import strictSetupRouter from "./strict_setup";
import researchRouter from "./research";
import brainRouter from "./brain";
import superIntelligenceRouter from "./super_intelligence";
import backtestRouter from "./backtest";
import paperValidationRouter from "./paper_validation";
import alertsRouter from "./alerts";
import checklistRouter from "./checklist";
import warRoomRouter from "./war_room";
import proofRouter from "./proof";
import macroRouter from "./macro";
import journalRouter from "./journal";
import watchlistRouter from "./watchlist";
import analyticsRouter from "./analytics";
import portfolioRouter from "./portfolio";
import opsRouter from "./ops";
import featuresRouter from "./features";
import engineHealthRouter from "./engine_health";
import executionRouter from "./execution";
import sessionsRouter from "./sessions";
import streamingRouter from "./streaming";
import deploymentReadinessRouter from "./deployment_readiness";
import autonomyDebuggerRouter from "./autonomy_debugger";
import autonomyDebugSchedulerRouter from "./autonomy_debug_scheduler";
import autonomySupervisorRouter from "./autonomy_supervisor";
import strategyGovernorRouter from "./strategy_governor";
import strategyAllocatorRouter from "./strategy_allocator";
import strategyEvolutionRouter from "./strategy_evolution";
import productionWatchdogRouter from "./production_watchdog";
import executionSafetySupervisorRouter from "./execution_safety_supervisor";
import leaderboardRouter from "./leaderboard";
import pythonV2Router from "./python_v2";
import brainNodesRouter from "./brain_nodes";
import portfolioAllocatorRouter from "./portfolio_allocator";
import decisionReplayRouter from "./decision_replay";
import microstructureRouter from "./microstructure";
import contextFusionRouter from "./context_fusion";
import adaptiveLearningRouter from "./adaptive_learning";
import executionIntelligenceRouter from "./execution_intelligence";
import strategyRegistryRouter from "./strategy_registry";
import godsviewLabRouter from "./godsview_lab";
import walkForwardStressRouter from "./walk_forward_stress";
import tradingviewOverlayRouter from "./tradingview_overlay";
import liveIntelligenceMonitorRouter from "./live_intelligence_monitor";
import circuitBreakerRouter from "./circuit_breaker";
import positionSizingRouter from "./position_sizing";
import tradeJournalRouter from "./trade_journal";
import systemOrchestratorRouter from "./system_orchestrator";
import apiGatewayRouter from "./api_gateway";
import dailyReviewRouter from "./daily_review";
import sideBySideRouter from "./side_by_side";
import marketStructureRouter from "./market_structure";
import persistenceRouter from "./persistence";
import siSupervisorRouter from "./si_supervisor";
import observabilityRouter from "./observability";
import governanceRouter from "./governance";
import paperTradingRouter from "./paper_trading";
import liveLaunchRouter from "./live_launch";
import autonomousRouter from "./autonomous";
import executionTruthRouter from "./execution_truth";
import alignmentRouter from "./alignment";
import mlOperationsRouter from "./ml_operations";
import productionHealthRouter from "./production_health";
import certificationRouter from "./certification";
import deploymentTruthRouter from "./deployment_truth";
import dataTruthRouter from "./data_truth";
import executionValidationRouter from "./execution_validation";

const router: IRouter = Router();

router.use(governanceRouter);
router.use(healthRouter);
router.use(signalsRouter);
router.use(tradesRouter);
router.use(performanceRouter);
router.use(systemRouter);
router.use(alpacaRouter);
router.use(orderbookRouter);
router.use(strictSetupRouter);
router.use(researchRouter);
router.use(brainRouter);
router.use(superIntelligenceRouter);
router.use(backtestRouter);
router.use(paperValidationRouter);
router.use(alertsRouter);
router.use("/api/checklist", checklistRouter);
router.use("/api/war-room", warRoomRouter);
router.use("/api/proof", proofRouter);
router.use("/api/macro", macroRouter);
router.use("/api/journal", journalRouter);
router.use("/api", watchlistRouter);
router.use("/api", analyticsRouter);
router.use("/api/portfolio", portfolioRouter);
router.use("/api/ops", opsRouter);
router.use("/api/features", featuresRouter);
router.use(engineHealthRouter);
router.use("/api/execution", executionRouter);
router.use("/api", sessionsRouter);
router.use("/api", leaderboardRouter);
router.use(streamingRouter);
router.use(deploymentReadinessRouter);
router.use(autonomyDebuggerRouter);
router.use(autonomyDebugSchedulerRouter);
router.use(autonomySupervisorRouter);
router.use(strategyGovernorRouter);
router.use(strategyAllocatorRouter);
router.use(strategyEvolutionRouter);
router.use(productionWatchdogRouter);
router.use(executionSafetySupervisorRouter);
router.use(brainNodesRouter);
router.use(portfolioAllocatorRouter);
router.use(decisionReplayRouter);
router.use(microstructureRouter);
router.use(contextFusionRouter);
router.use(adaptiveLearningRouter);
router.use(executionIntelligenceRouter);
router.use(strategyRegistryRouter);
router.use(godsviewLabRouter);
router.use(walkForwardStressRouter);
router.use(tradingviewOverlayRouter);
router.use(liveIntelligenceMonitorRouter);
router.use(circuitBreakerRouter);
router.use(positionSizingRouter);
router.use(tradeJournalRouter);
router.use(systemOrchestratorRouter);
router.use(apiGatewayRouter);
router.use("/api", dailyReviewRouter);
router.use("/api", sideBySideRouter);
router.use(persistenceRouter);
router.use("/api", marketStructureRouter);
router.use(siSupervisorRouter);
router.use(observabilityRouter);
router.use(paperTradingRouter);
router.use(liveLaunchRouter);
router.use(autonomousRouter);
router.use("/api/execution-truth", executionTruthRouter);
router.use("/api/alignment", alignmentRouter);
router.use("/api/ml-ops", mlOperationsRouter);
router.use("/api/production-health", productionHealthRouter);
router.use("/api/certification", certificationRouter);

deploymentTruthRouter(router);
router.use("/api/data-truth", dataTruthRouter);
router.use("/api/execution-validation", executionValidationRouter);

// Python v2 microservices proxy — shadow routes at /v2/*
router.use(pythonV2Router);

// ── Phase 150+: Production Hardening export default router; Observability ────────────────────────
import opsV2Router from "./ops_v2";
router.use("/api/ops/v2", opsV2Router);              // Operator brief, kill switch, exposure, drift, startup

// ── Phase 57-60: Multi-Tenant, Marketplace, Chaos, Launch Readiness ───────
import multiTenantRouter from "./multi_tenant";
import strategyMarketplaceRouter from "./strategy_marketplace";
import chaosEngineeringRouter from "./chaos_engineering";
import launchReadinessRouter from "./launch_readiness";
router.use(multiTenantRouter);
router.use(strategyMarketplaceRouter);
router.use(chaosEngineeringRouter);
router.use(launchReadinessRouter);

// ── Phase 61: SLO Monitoring + Dashboards ─────────────────────────────────
import sloMonitoringRouter from "./slo_monitoring";
router.use(sloMonitoringRouter);

// ── Phase 62: Audit Trail + Compliance ────────────────────────────────────
import auditTrailRouter from "./audit_trail";
router.use(auditTrailRouter);

// ── Phase 63: Feature Flags + Progressive Rollout ─────────────────────────
import featureFlagsRouter from "./feature_flags";
router.use(featureFlagsRouter);

// ── Phase 64: Data Lineage + Quality ──────────────────────────────────────
import dataLineageRouter from "./data_lineage";
router.use(dataLineageRouter);

// ── Phase 65: Capacity Planning + Auto-Scaling ────────────────────────────
import capacityPlanningRouter from "./capacity_planning";
router.use(capacityPlanningRouter);

// ── Phase 66: Disaster Recovery ───────────────────────────────────────────
import disasterRecoveryRouter from "./disaster_recovery";
router.use(disasterRecoveryRouter);

// ── Phase 67: Cost Observability ──────────────────────────────────────────
import costObservabilityRouter from "./cost_observability";
router.use(costObservabilityRouter);

// ── Phase 68: Incident Management ─────────────────────────────────────────
import incidentManagementRouter from "./incident_management";
router.use(incidentManagementRouter);

// ── Phase 69: Release Management ──────────────────────────────────────────
import releaseManagementRouter from "./release_management";
router.use(releaseManagementRouter);

// ── Phase 70: Developer Platform ──────────────────────────────────────────
import developerPlatformRouter from "./developer_platform";
router.use(developerPlatformRouter);

// ── Phase 71: Notifications & Communication Hub ───────────────────────────
import notificationsRouter from "./notifications";
router.use(notificationsRouter);

// ── Phase 72: Privacy & PII Protection ────────────────────────────────────
import privacyProtectionRouter from "./privacy_protection";
router.use(privacyProtectionRouter);

// ── Phase 73: Advanced Risk Analytics ─────────────────────────────────────
import riskAnalyticsRouter from "./risk_analytics";
router.use(riskAnalyticsRouter);

// ── Phase 74: ML Model Lifecycle ──────────────────────────────────────────
import mlLifecycleRouter from "./ml_lifecycle";
router.use(mlLifecycleRouter);

// ── Phase 75: Workflow Engine ─────────────────────────────────────────────
import workflowEngineRouter from "./workflow_engine";
router.use(workflowEngineRouter);

// ── Phase 76: Service Mesh ────────────────────────────────────────────────
import serviceMeshRouter from "./service_mesh";
router.use(serviceMeshRouter);

// ── Phase 77: Event Sourcing + Time Travel ────────────────────────────────
import eventSourcingRouter from "./event_sourcing";
router.use(eventSourcingRouter);

// ── Phase 78: Search + Indexing ───────────────────────────────────────────
import searchRouter from "./search";
router.use(searchRouter);

// ── Phase 79: Real-Time Pub/Sub Bus ───────────────────────────────────────
import pubsubRouter from "./pubsub";
router.use(pubsubRouter);

// ── Phase 80: Job Scheduler + Background Tasks ────────────────────────────
import jobSchedulerRouter from "./job_scheduler";
router.use(jobSchedulerRouter);

// ── Phase 81: Cache Layer ─────────────────────────────────────────────────
import cacheLayerRouter from "./cache_layer";
router.use(cacheLayerRouter);

// ── Phase 82: Knowledge Base + Embeddings ─────────────────────────────────
import knowledgeBaseRouter from "./knowledge_base";
router.use(knowledgeBaseRouter);

// ── Phase 83: Strategy Bandit + Significance Testing ──────────────────────
import strategyBanditRouter from "./strategy_bandit";
router.use(strategyBanditRouter);

// ── Phase 84: Reporting Engine ────────────────────────────────────────────
import reportingRouter from "./reporting";
router.use(reportingRouter);

// ── Phase 85: Anomaly Detection ───────────────────────────────────────────
import anomalyDetectionRouter from "./anomaly_detection";
router.use(anomalyDetectionRouter);

// ── Phase 86: Portfolio Optimizer ─────────────────────────────────────────
import portfolioOptimizerRouter from "./portfolio_optimizer";
router.use(portfolioOptimizerRouter);

// ── Phase 87: Tax Lot Tracking + Wash Sale ────────────────────────────────
import taxTrackingRouter from "./tax_tracking";
router.use(taxTrackingRouter);

// ── Phase 88: Order Book L2 + Imbalance + Spread ──────────────────────────
import orderbookL2Router from "./orderbook_l2";
router.use(orderbookL2Router);

// ── Phase 89: News + Sentiment ────────────────────────────────────────────
import newsSentimentRouter from "./news_sentiment";
router.use(newsSentimentRouter);

// ── Phase 90: Self-Heal Diagnostics + Recommender ─────────────────────────
import selfHealRouter from "./self_heal";
router.use(selfHealRouter);

// ── Phase 97: Unified risk-breakers summary at /api/risk/breakers ──
import riskBreakersSummaryRouter from "./risk_breakers_summary";
router.use(riskBreakersSummaryRouter);

// ── Phase 99: MCP backtest router — previously defined but not mounted ──
//   POST /api/mcp-backtest/run  → full backtest with synthetic bars
//   GET  /api/mcp-backtest/compare/:runId
//   GET  /api/mcp-backtest/signal-log/:runId
//   GET  /api/mcp-backtest/history
import mcpBacktestRouter from "./mcp_backtest";
router.use(mcpBacktestRouter);

// ── Phase 92: TradingView MCP webhook (/tradingview/webhook, aliased as /tv-webhook) ──
import tradingviewMcpRouter from "./tradingview_mcp";
router.use("/tradingview", tradingviewMcpRouter);
// Alias routers so external tools (Chrome extension, TradingView alerts) can POST
// to /api/tv-webhook directly. We mount the same router at /tv-webhook so
// POST /api/tv-webhook/webhook works, and also register a root-path alias.
import { Router as ExpressRouter } from "express";
const tvAliasRouter = ExpressRouter();
tvAliasRouter.post("/", (req, res, next) => {
  // Re-route root POST to the /webhook handler inside tradingviewMcpRouter
  req.url = "/webhook";
  return (tradingviewMcpRouter as unknown as (req: unknown, res: unknown, next: unknown) => void)(req, res, next);
});
router.use("/tv-webhook", tvAliasRouter);

// ── Phase 103: Market-Ready Completion Suite (ported into artifacts/) ─
import phase103Router from "./phase103/index";
router.use("/api/phase103", phase103Router);                   // broker reality, recall, agents, quant lab, fusion+explain, L2 flow, E2E, gates

// ── P1-12: Unified Quant Lab route backed by Phase 103 QuantLabUnified ─
import quantLabRouter from "./quant_lab";
router.use("/api/quant-lab", quantLabRouter);

export default router;
