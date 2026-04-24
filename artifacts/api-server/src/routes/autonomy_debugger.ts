import { Router, type IRouter } from "express";
import {
  getAutonomyDebugSnapshot,
  parseAutonomyDebugQuery,
  runAutonomyDebugAutoFix,
} from "../lib/autonomy_debugger";

const router: IRouter = Router();

router.get("/brain/autonomy/debug", async (req, res) => {
  try {
    const { includePreflight, forceReadiness } = parseAutonomyDebugQuery(req.query as Record<string, unknown>);
    const snapshot = await getAutonomyDebugSnapshot({
      includePreflight,
      forceReadiness,
    });
    const statusCode = snapshot.overall_status === "CRITICAL" ? 503 : 200;
    res.status(statusCode).json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Autonomy debug snapshot failed");
    res.status(503).json({ error: "autonomy_debug_failed", message: String(err) });
  }
});

router.get("/ops/autonomy/debug", async (req, res) => {
  try {
    const { includePreflight, forceReadiness } = parseAutonomyDebugQuery(req.query as Record<string, unknown>);
    const snapshot = await getAutonomyDebugSnapshot({
      includePreflight,
      forceReadiness,
    });
    const statusCode = snapshot.overall_status === "CRITICAL" ? 503 : 200;
    res.status(statusCode).json(snapshot);
  } catch (err) {
    req.log.error({ err }, "Ops autonomy debug snapshot failed");
    res.status(503).json({ error: "autonomy_debug_failed", message: String(err) });
  }
});

router.post("/brain/autonomy/debug/fix", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const includePreflight = String(body.include_preflight ?? "").trim().length > 0
      ? ["1", "true", "yes", "on"].includes(String(body.include_preflight).trim().toLowerCase())
      : false;
    const forceReadiness = String(body.force_refresh ?? "").trim().length > 0
      ? ["1", "true", "yes", "on"].includes(String(body.force_refresh).trim().toLowerCase())
      : false;
    const result = await runAutonomyDebugAutoFix({
      includePreflight,
      forceReadiness,
    });
    res.json({
      ok: true,
      fixes: result.fixes,
      snapshot: result.snapshot,
    });
  } catch (err) {
    req.log.error({ err }, "Autonomy debug auto-fix failed");
    res.status(503).json({ error: "autonomy_debug_fix_failed", message: String(err) });
  }
});

export default router;

