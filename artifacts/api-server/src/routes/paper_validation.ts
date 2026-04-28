import { Router, type IRouter } from "express";
import {
  getLatestPaperValidationReport,
  getPaperValidationHistory,
  getPaperValidationStatus,
  runPaperValidationCycle,
  startPaperValidationLoop,
  stopPaperValidationLoop,
} from "../lib/paper_validation_loop";

const router: IRouter = Router();

function parseNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

router.get("/paper/validation/status", (_req, res) => {
  try {
    res.json(getPaperValidationStatus());
  } catch (err) {
    res.json({ running: false, error: "status_unavailable", message: String(err) });
  }
});

router.get("/brain/paper/validation/status", (_req, res) => {
  try {
    res.json(getPaperValidationStatus());
  } catch (err) {
    res.json({ running: false, error: "status_unavailable", message: String(err) });
  }
});

router.get("/paper/validation/latest", (_req, res) => {
  try {
    const latest = getLatestPaperValidationReport();
    if (!latest) {
      // Never 404 — dashboards consume this with useQuery and 404 trips
      // their error boundary. Return a structured 200 with no-data flag.
      res.json({ available: false, message: "No validation report has been generated yet" });
      return;
    }
    res.json(latest);
  } catch (err) {
    res.json({ available: false, error: "latest_unavailable", message: String(err) });
  }
});

router.get("/brain/paper/validation/latest", (_req, res) => {
  try {
    const latest = getLatestPaperValidationReport();
    if (!latest) {
      res.json({ available: false, message: "No validation report has been generated yet" });
      return;
    }
    res.json(latest);
  } catch (err) {
    res.json({ available: false, error: "latest_unavailable", message: String(err) });
  }
});

router.get("/paper/validation/history", (req, res) => {
  const limit = parseNum(req.query.limit) ?? 20;
  const reports = getPaperValidationHistory(limit);
  res.json({ count: reports.length, reports });
});

router.get("/brain/paper/validation/history", (req, res) => {
  const limit = parseNum(req.query.limit) ?? 20;
  const reports = getPaperValidationHistory(limit);
  res.json({ count: reports.length, reports });
});

router.post("/paper/validation/run-once", async (req, res) => {
  try {
    const days = parseNum(req.body?.days);
    const threshold = parseNum(req.body?.threshold);
    const enableAutoOptimization =
      req.body?.enable_auto_optimization === undefined
        ? true
        : Boolean(req.body.enable_auto_optimization);
    const report = await runPaperValidationCycle({
      days,
      threshold,
      enableAutoOptimization,
    });
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Paper validation run-once failed");
    res.status(503).json({ error: "paper_validation_failed", message: String(err) });
  }
});

router.post("/brain/paper/validation/run-once", async (req, res) => {
  try {
    const days = parseNum(req.body?.days);
    const threshold = parseNum(req.body?.threshold);
    const enableAutoOptimization =
      req.body?.enable_auto_optimization === undefined
        ? true
        : Boolean(req.body.enable_auto_optimization);
    const report = await runPaperValidationCycle({
      days,
      threshold,
      enableAutoOptimization,
    });
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Brain paper validation run-once failed");
    res.status(503).json({ error: "paper_validation_failed", message: String(err) });
  }
});

router.post("/paper/validation/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate =
      req.body?.run_immediate === undefined
        ? true
        : Boolean(req.body.run_immediate);
    const result = await startPaperValidationLoop({ intervalMs, runImmediate });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Paper validation start failed");
    res.status(503).json({ error: "paper_validation_start_failed", message: String(err) });
  }
});

router.post("/brain/paper/validation/start", async (req, res) => {
  try {
    const intervalMs = parseNum(req.body?.interval_ms);
    const runImmediate =
      req.body?.run_immediate === undefined
        ? true
        : Boolean(req.body.run_immediate);
    const result = await startPaperValidationLoop({ intervalMs, runImmediate });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Brain paper validation start failed");
    res.status(503).json({ error: "paper_validation_start_failed", message: String(err) });
  }
});

router.post("/paper/validation/stop", (_req, res) => {
  const result = stopPaperValidationLoop();
  res.json(result);
});

router.post("/brain/paper/validation/stop", (_req, res) => {
  const result = stopPaperValidationLoop();
  res.json(result);
});

export default router;
