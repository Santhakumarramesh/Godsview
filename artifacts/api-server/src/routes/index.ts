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
import deploymentReadinessRouter from "./deployment_readiness";import autonomyDebuggerRouter from "./autonomy_debugger";
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
import marketStructureRouter from "./market_structure";import persistenceRouter from "./persistence";
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
import certificationRunRouter from "./certification_run";
import opsV2Router from "./ops_v2";

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
router.use(researchRouter);router.use(brainRouter);
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
router.use(brainNodesRouter);router.use(portfolioAllocatorRouter);
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
router.use("/api/deployment", deploymentTruthRouter);
router.use("/api/data-truth", dataTruthRouter);
router.use("/api/execution-validation", executionValidationRouter);
router.use("/api/certification-run", certificationRunRouter); // Phase 20 — One strategy certification run
router.use("/api/ops/v2", opsV2Router); // Operator brief, kill switch, exposure, drift, startup

// Python v2 microservices proxy — shadow routes at /v2/*
router.use(pythonV2Router);

// ── Phase 129: Finnhub Alt-Data + S3 Cloud Storage ───────────────────────
import finnhubAltRouter from "./finnhub_alt";
router.use("/api/finnhub", finnhubAltRouter);

import seedRouter from "./seed";
router.use("/api", seedRouter);

import s3StorageRouter from "./s3_storage";
router.use("/api/storage", s3StorageRouter);

// ── Phase 77-85: Quant Super-Intelligence Subsystems ─────────────────────
import labRouter from "./lab";
import quantRouter from "./quant";
import memoryRouter from "./memory";
import uxRouter from "./ux";
import explainRouter from "./explain";
import backtestEnhancedRouter from "./backtest_enhanced";
import marketRouter from "./market";

router.use("/api/lab", labRouter);
router.use("/api/quant", quantRouter);router.use("/api/memory", memoryRouter);
router.use("/api/ux", uxRouter);
router.use("/api/explain", explainRouter);
router.use("/api/backtest", backtestEnhancedRouter);
router.use("/api/market", marketRouter);

// ── Phase 87: Quant Decision Loop ────────────────────────────────────────
import decisionLoopRouter from "./decision_loop";
router.use("/api/decision-loop", decisionLoopRouter);

// ── Phase 88: Evaluation & Proof Layer ───────────────────────────────────
import evalRouter from "./eval";
import trustRouter from "./trust";
router.use("/api/eval", evalRouter);
router.use("/api/trust", trustRouter);

// ── Phase 91: System Integration & Operations ────────────────────────────
import systemBridgeRouter from "./system_bridge";
import opsQuantRouter from "./ops_quant";
router.use("/api/bridge", systemBridgeRouter);
router.use("/api/ops-quant", opsQuantRouter);

// ── Phase 97-98: TradingView MCP Integration ────────────────────────────
import tradingviewMcpRouter from "./tradingview_mcp";
import mcpBacktestRouter from "./mcp_backtest";
router.use("/api/tradingview", tradingviewMcpRouter);
router.use("/api", mcpBacktestRouter);

// ── Phase 99: Pipeline Orchestrator ─────────────────────────────────────
import pipelineStatusRouter from "./pipeline_status";router.use("/api", pipelineStatusRouter);

// ── MCP Streaming Events ────────────────────────────────────────────────
import mcpStreamRouter from "./mcp_stream";
router.use("/api", mcpStreamRouter);

// ── Phase 101: Regime-Adaptive Intelligence ─────────────────────────────
import intelligenceRouter from "./intelligence";
router.use("/api/intelligence", intelligenceRouter);

// ── Phase 102: Correlation & Portfolio Heat Map ─────────────────────────
import correlationRouter from "./correlation";
router.use("/api/correlation", correlationRouter);

// ── Phase 103: Execution Control ────────────────────────────────────────
import executionControlRouter from "./execution_control";
router.use("/api/execution-control", executionControlRouter);

// ── Phase 104: Sentiment & News Intelligence ────────────────────────────
import sentimentRouter from "./sentiment";
router.use("/api/sentiment", sentimentRouter);

// ── Phase 105: Performance Analytics ────────────────────────────────────
import perfAnalyticsRouter from "./perf_analytics";
router.use("/api/perf", perfAnalyticsRouter);

// ── Phase 106: Alert Engine & Anomaly Detection ─────────────────────────
import alertCenterRouter from "./alert_center";
router.use("/api/alert-center", alertCenterRouter);
// ── Phase 108: Truth Phase — System Integrity Audit ─────────────────────
import truthAuditRouter from "./truth_audit";
router.use("/api/truth-audit", truthAuditRouter);

// ── Phase 109: Market Data Integrity Layer ──────────────────────────────
import dataIntegrityRouter from "./data_integrity";
router.use("/api/data-integrity", dataIntegrityRouter);

// ── Phase 110: Backtest Credibility Upgrade ─────────────────────────────
import backtestV2Router from "./backtest_v2";
router.use("/api/backtest-v2", backtestV2Router);

// ── Phase 111: Execution Reliability Layer ──────────────────────────────
import execReliabilityRouter from "./exec_reliability";
router.use("/api/exec-reliability", execReliabilityRouter);

// ── Phase 112: Risk Engine v2 — Capital Protection ──────────────────────
import riskV2Router from "./risk_v2";
router.use("/api/risk-v2", riskV2Router);

// ── Phase 113: Model Governance & Learning Discipline ───────────────────
import modelGovRouter from "./model_gov";
router.use("/api/model-gov", modelGovRouter);

// ── Phase 114: Decision Explainability & Replay ─────────────────────────
import explainabilityRouter from "./explainability";
router.use("/api/explainability", explainabilityRouter);

// ── Phase 115: Ops, Security & Failure Testing ──────────────────────────
import opsSecurityRouter from "./ops_security";router.use("/api", opsSecurityRouter);

// ── Phase 116: Paper Program Validation & Certification ─────────────────
import paperProgramRouter from "./paper_trading_program";
router.use("/api/paper-program", paperProgramRouter);

// ── Phase 117: Capital Gating & Controlled Launch ───────────────────────
import capitalGatingRouter from "./capital_gating";
router.use("/api/capital-gating", capitalGatingRouter);

// ── Phase 120: Python v2 Service Bridge ─────────────────────────────────
import pyBridgeRouter from "./py_bridge";
router.use("/api/v2", pyBridgeRouter);

// ── Phase 123: OpenAPI Documentation ────────────────────────────────────
import openapiRouter from "./openapi";
router.use("/api/docs", openapiRouter);

// ── Strategy Params & Brain Health ──────────────────────────────────────
import strategyParamsRouter from "./strategy_params";
import brainHealthRouter from "./brain_health";
router.use(strategyParamsRouter);
router.use(brainHealthRouter);

// ── Phase 147: Autonomous Brain Engine ─────────────────────────────────
import autonomousBrainRouter from "./autonomous_brain";
router.use("/api/autonomous", autonomousBrainRouter);

// ── Bloomberg-style Market Data ────────────────────────────────────────
import bloombergDataRouter from "./bloomberg_data";router.use("/api/bloomberg", bloombergDataRouter);

// ── Phase 142: Brain Nodes WebSocket & REST ────────────────────────────
import brainNodesWsRouter from "./brain_nodes_ws";
router.use("/api", brainNodesWsRouter);

// ── Phase 5: Calibration Scheduler ─────────────────────────────────────
import calibrationSchedulerRouter from "./calibration_scheduler";
router.use(calibrationSchedulerRouter);

// ── Phase 5: Governance Scheduler ──────────────────────────────────────
import governanceSchedulerRouter from "./governance_scheduler";
router.use(governanceSchedulerRouter);

// ── Phase 140: News Monitor Feed ───────────────────────────────────────
import newsMonitorFeedRouter from "./news_monitor_feed";
router.use("/api", newsMonitorFeedRouter);

// ── Phase 6: SLO Tracking ──────────────────────────────────────────────
import sloRouter from "./slo";
router.use(sloRouter);

// ── Phase 149: Strategy Prompt Engine ──────────────────────────────────
import strategyPromptRouter from "./strategy_prompt";
router.use("/api/strategy-prompt", strategyPromptRouter);

export default router;
