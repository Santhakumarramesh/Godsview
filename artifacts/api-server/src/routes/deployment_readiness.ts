import { Router, type IRouter } from "express";
import { getDeploymentReadinessReport, parseReadinessQuery, resetDeploymentReadinessCache } from "../lib/deployment_readiness";

const router: IRouter = Router();

router.get("/system/deployment/readiness", async (req, res) => {
  try {
    const { forceRefresh, includePreflight } = parseReadinessQuery(req.query as Record<string, unknown>);
    const report = await getDeploymentReadinessReport({
      forceRefresh,
      includePreflight,
    });
    const statusCode = report.status === "NOT_READY" ? 503 : 200;
    res.status(statusCode).json(report);
  } catch (err) {
    req.log.error({ err }, "Deployment readiness check failed");
    res.status(503).json({ error: "deployment_readiness_failed", message: String(err) });
  }
});

router.get("/ops/deployment/readiness", async (req, res) => {
  try {
    const { forceRefresh, includePreflight } = parseReadinessQuery(req.query as Record<string, unknown>);
    const report = await getDeploymentReadinessReport({
      forceRefresh,
      includePreflight,
    });
    const statusCode = report.status === "NOT_READY" ? 503 : 200;
    res.status(statusCode).json(report);
  } catch (err) {
    req.log.error({ err }, "Ops deployment readiness check failed");
    res.status(503).json({ error: "deployment_readiness_failed", message: String(err) });
  }
});

router.post("/system/deployment/readiness/reset-cache", (_req, res) => {
  resetDeploymentReadinessCache();
  res.json({ ok: true, reset: true });
});

export default router;
