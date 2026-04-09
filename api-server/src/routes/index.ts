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
import strategyParamsRouter from "./strategy_params";
import positionSizingRouter from "./position_sizing";
import brainHealthRouter from "./brain_health";

const router: IRouter = Router();

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
router.use(opsRouter);
router.use("/api/features", featuresRouter);
router.use(engineHealthRouter);
router.use("/api/execution", executionRouter);
router.use("/api", sessionsRouter);
router.use(streamingRouter);
router.use(deploymentReadinessRouter);
router.use(strategyParamsRouter);    // Phase 11B — /brain/strategy/params
router.use(positionSizingRouter);    // Phase 11C — /brain/positions/sizing, /brain/account/equity
router.use(brainHealthRouter);       // Phase 12D — /brain/health/*

// ── Phase 77-85: Quant Super-Intelligence Subsystems ─────────────────────
import labRouter from "./lab";
import quantRouter from "./quant";
import memoryRouter from "./memory";
import governanceRouter from "./governance";
import uxRouter from "./ux";
import explainRouter from "./explain";
import autonomousRouter from "./autonomous";
import backtestEnhancedRouter from "./backtest_enhanced";
import marketRouter from "./market";

router.use("/api/lab", labRouter);               // Phase 1 — Strategy Lab
router.use("/api/quant", quantRouter);           // Phase 3 — Quant reasoning
router.use("/api/memory", memoryRouter);         // Phase 4 — Memory system
router.use("/api/governance", governanceRouter); // Phase 6 — Governance
router.use("/api/ux", uxRouter);                 // Phase 7 — UX workflow
router.use("/api/explain", explainRouter);       // Phase 8 — Explainability
router.use("/api/autonomous", autonomousRouter); // Phase 9 — Autonomous ops
router.use("/api/backtest", backtestEnhancedRouter); // Phase 2 — Enhanced backtest
router.use("/api/market", marketRouter);         // Phase 5 — Market data

// ── Phase 87: Quant Decision Loop ────────────────────────────────────────
import decisionLoopRouter from "./decision_loop";
router.use("/api/decision-loop", decisionLoopRouter); // Phase 87 — Unified pipeline

// ── Phase 88: Evaluation & Proof Layer ───────────────────────────────────
import evalRouter from "./eval";
import trustRouter from "./trust";
router.use("/api/eval", evalRouter);             // Phase 88 — Eval harness + benchmarks
router.use("/api/trust", trustRouter);           // Phase 88 — Trust surface + promotion gates

// ── Phase 91: System Integration & Operations ────────────────────────────
import systemBridgeRouter from "./system_bridge";
import opsQuantRouter from "./ops_quant";
router.use("/api/bridge", systemBridgeRouter);   // Phase 91 — Unified system bridge
router.use("/api/ops", opsQuantRouter);          // Phase 91 — Operational runbook + briefs

// ── Phase 97-98: TradingView MCP Integration ────────────────────────────
import tradingviewMcpRouter from "./tradingview_mcp";
import mcpBacktestRouter from "./mcp_backtest";
router.use("/api/tradingview", tradingviewMcpRouter); // Phase 97 — MCP signal pipeline
router.use("/api", mcpBacktestRouter);                // Phase 98 — MCP backtesting

// ── Phase 99: Pipeline Orchestrator ─────────────────────────────────────
import pipelineStatusRouter from "./pipeline_status";
router.use("/api", pipelineStatusRouter);             // Phase 99 — Live pipeline status & control

// ── MCP Streaming Events ────────────────────────────────────────────────────
import mcpStreamRouter from "./mcp_stream";
router.use("/api", mcpStreamRouter);                  // MCP SSE streaming endpoints

// ── Phase 101: Regime-Adaptive Intelligence ─────────────────────────────────
import intelligenceRouter from "./intelligence";
router.use("/api/intelligence", intelligenceRouter);  // Phase 101 — Regime router, MTF, optimizer

// ── Phase 102: Correlation & Portfolio Heat Map ─────────────────────────────
import correlationRouter from "./correlation";
router.use("/api/correlation", correlationRouter);    // Phase 102 — Strategy correlation, heatmap, drawdown

// ── Phase 103: Execution Control ────────────────────────────────────────────
import executionControlRouter from "./execution_control";
router.use("/api/execution", executionControlRouter); // Phase 103 — Order lifecycle, positions, venue routing

// ── Phase 104: Sentiment & News Intelligence ────────────────────────────────
import sentimentRouter from "./sentiment";
router.use("/api/sentiment", sentimentRouter);        // Phase 104 — Sentiment aggregation, news, social

// ── Phase 105: Performance Analytics ────────────────────────────────────────
import perfAnalyticsRouter from "./perf_analytics";
router.use("/api/perf", perfAnalyticsRouter);         // Phase 105 — Trade journal, leaderboard, risk metrics

// ── Phase 106: Alert Engine & Anomaly Detection ─────────────────────────────
import alertCenterRouter from "./alert_center";
router.use("/api/alert-center", alertCenterRouter);   // Phase 106 — Alert rules, notifications, anomalies

// ── Phase 107: Market Microstructure ────────────────────────────────────────
import microstructureRouter from "./microstructure";
router.use("/api/microstructure", microstructureRouter); // Phase 107 — Order flow, book depth, liquidity

// ── Phase 108: Truth Phase — System Integrity Audit ────────────────────────
import truthAuditRouter from "./truth_audit";
router.use("/api/truth-audit", truthAuditRouter);        // Phase 108 — Capability matrix, endpoint audit, code health

// ── Phase 109: Market Data Integrity Layer ─────────────────────────────────
import dataIntegrityRouter from "./data_integrity";
router.use("/api/data-integrity", dataIntegrityRouter);  // Phase 109 — Feed health, tick validation, replay store

// ── Phase 110: Backtest Credibility Upgrade ────────────────────────────────
import backtestV2Router from "./backtest_v2";
router.use("/api/backtest-v2", backtestV2Router);        // Phase 110 — Event-driven backtest, overfit, credibility

// ── Phase 111: Execution Reliability Layer ─────────────────────────────────
import execReliabilityRouter from "./exec_reliability";
router.use("/api/exec-reliability", execReliabilityRouter); // Phase 111 — Order state machine, reconciliation, failsafe

// ── Phase 112: Risk Engine v2 — Capital Protection ─────────────────────────
import riskV2Router from "./risk_v2";
router.use("/api/risk-v2", riskV2Router);                // Phase 112 — Portfolio VaR, exposure, macro lockouts

// ── Phase 113: Model Governance & Learning Discipline ──────────────────────
import modelGovRouter from "./model_gov";
router.use("/api/model-gov", modelGovRouter);            // Phase 113 — Model registry, drift, shadow deploy

// ── Phase 114: Decision Explainability & Replay Gold Standard ──────────────
import explainabilityRouter from "./explainability";
router.use("/api/explainability", explainabilityRouter);    // Phase 114 — Decision packets, replay, post-mortems

// ── Phase 115: Ops, Security & Failure Testing ─────────────────────────────
import opsSecurityRouter from "./ops_security";
router.use("/api", opsSecurityRouter);                        // Phase 115 — Security audit, chaos, ops health, deploy gate
// ── Phase 116: Paper Program Validation & Certification ───────────────────
import paperProgramRouter from "./paper_trading_program";
router.use("/api/paper-program", paperProgramRouter);        // Phase 116 — Paper trading cert, phases, risk compliance

// ── Phase 117: Capital Gating & Controlled Launch ───────────────────────
import capitalGatingRouter from "./capital_gating";
router.use("/api/capital-gating", capitalGatingRouter);      // Phase 117 — Tier system, launch control, protection

// ── Phase 120: Python v2 Service Bridge ─────────────────────────────────
import pyBridgeRouter from "./py_bridge";
router.use("/api/v2", pyBridgeRouter);                        // Phase 120 — Proxy to Python microservices

// ── Phase 21: Assisted Live Mode ───────────────────────────────────────
import assistedLiveRouter from "./assisted_live";
router.use("/api/assisted-live", assistedLiveRouter);          // Phase 21 — Supervised live trading

// ── Phase 22: Autonomous Candidate Mode ────────────────────────────────
import autonomyRouter from "./autonomy";
router.use("/api/autonomy", autonomyRouter);                   // Phase 22 — Autonomous candidates

// ── Phase 23: Portfolio Intelligence ───────────────────────────────────
import portfolioIntelligenceRouter from "./portfolio_intelligence";
router.use("/api/portfolio-intelligence", portfolioIntelligenceRouter); // Phase 23

// ── Phase 24: Enterprise Production ────────────────────────────────────
import enterpriseAdminRouter from "./enterprise_admin";
router.use("/api/admin", enterpriseAdminRouter);               // Phase 24

// ── Phase 25: God Brain / Quanta Terminal ──────────────────────────────
import godBrainRouter from "./god_brain";
router.use("/api/god-brain", godBrainRouter);                  // Phase 25

// ── Phase 26: Terminal + MCP Polish ────────────────────────────────────
import terminalRouter from "./terminal";
router.use("/api/terminal", terminalRouter);                   // Phase 26

// ── Phase 27: Production Validation Backbone ──────────────────────────
import validationRouter from "./production_validation";
router.use("/api/validation", validationRouter);               // Phase 27 — Validation sessions, comparison, readiness

// ── Phase 28: Execution Ledger + Broker Reconciliation ────────────────
import executionLedgerRouter from "./execution_ledger";
router.use("/api/execution-ledger", executionLedgerRouter);    // Phase 28 — Order lifecycle, reconciliation, mismatches

// ── Phase 29: Market Data Truth + Latency Observability ───────────────
import dataTruthRouter from "./data_truth";
router.use("/api/data-truth", dataTruthRouter);                // Phase 29 — Timestamp chains, quality checks, truth scores

// ── Phase 30: Shadow Mode + Canary Autonomy ───────────────────────────
import shadowCanaryRouter from "./shadow_canary";
router.use("/api/shadow-canary", shadowCanaryRouter);          // Phase 30 — Shadow sessions, canary deployments

// ── Phase 31: Secrets, Auth & Control-Plane Hardening ─────────────────
import securityAdminRouter from "./security_admin";
router.use("/api/security", securityAdminRouter);              // Phase 31 — Secrets, operator auth, env validation

// ── Phase 32: Natural Language Strategy Compiler v2 ───────────────────
import strategyCompilerRouter from "./strategy_compiler";
router.use("/api/strategy-compiler", strategyCompilerRouter);  // Phase 32 — NL to DSL compilation

// ── Phase 33: Macro / News / Event Risk Intelligence ──────────────────
import macroIntelligenceRouter from "./macro_intelligence";
router.use("/api/macro-intelligence", macroIntelligenceRouter); // Phase 33 — Economic events, lockouts, risk scoring

// ── Phase 34: Portfolio + Capital Allocation Live Control ─────────────
import capitalControlRouter from "./capital_control";
router.use("/api/capital-control", capitalControlRouter);      // Phase 34 — Capital buckets, guardrails, allocation

// ── Phase 35: Failure Recovery + Disaster Readiness ───────────────────
import recoveryRouter from "./recovery";
router.use("/api/recovery", recoveryRouter);                   // Phase 35 — Recovery plans, incident drills, readiness

// ── Phase 36: Go-Live Certification Gate ──────────────────────────────
import certificationGateRouter from "./certification_gate";
router.use("/api/certification-gate", certificationGateRouter); // Phase 36 — Pre-production certification audit

export default router;
