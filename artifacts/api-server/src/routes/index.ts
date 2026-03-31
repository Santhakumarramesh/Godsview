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
import alertsRouter from "./alerts";

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
router.use(alertsRouter);

export default router;
