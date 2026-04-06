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

export default router;
