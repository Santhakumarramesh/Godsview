import { Router, type IRouter } from "express";
import healthRouter from "./health";
import signalsRouter from "./signals";
import tradesRouter from "./trades";
import performanceRouter from "./performance";
import systemRouter from "./system";

const router: IRouter = Router();

router.use(healthRouter);
router.use(signalsRouter);
router.use(tradesRouter);
router.use(performanceRouter);
router.use(systemRouter);

export default router;
