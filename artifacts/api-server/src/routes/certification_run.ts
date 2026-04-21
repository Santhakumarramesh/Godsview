import { Router, type Request, type Response } from "express";
import {
  certificationRunner,
  TIER_REQUIREMENTS,
  type CertificationGateStepName,
  type CertificationRunStatusType,
  type StepMetricsInput,
  type TargetTier,
} from "../lib/certification_run";
import { logger } from "../lib/logger";

const router = Router();

const STEP_NAMES = new Set<CertificationGateStepName>([
  "backtest",
  "walkforward",
  "stress_test",
  "shadow",
  "alignment",
  "slippage",
  "execution_quality",
]);

const TIER_NAMES = new Set<TargetTier>([
  "paper_approved",
  "live_assisted",
  "autonomous_candidate",
]);

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function errorStatusFrom(message: string): number {
  if (message.includes("Unknown runId")) return 404;
  if (message.includes("Active run already exists")) return 409;
  if (
    message.includes("required") ||
    message.includes("Unsupported") ||
    message.includes("Unknown step") ||
    message.includes("Cannot run step")
  ) {
    return 400;
  }
  return 500;
}

function parseStepInput(body: unknown): StepMetricsInput {
  const source =
    typeof body === "object" && body && "input" in body
      ? (body as { input?: unknown }).input
      : body;
  const payload = (source ?? {}) as Record<string, unknown>;

  const out: StepMetricsInput = {};
  const sharpe = asNumber(payload.sharpe);
  const winRate = asNumber(payload.winRate);
  const tradeCount = asNumber(payload.tradeCount);
  const passRate = asNumber(payload.passRate);
  const survivalRate = asNumber(payload.survivalRate);
  const paperTrades = asNumber(payload.paperTrades);
  const paperWinRate = asNumber(payload.paperWinRate);
  const paperPnl = asNumber(payload.paperPnl);
  const alignmentScore = asNumber(payload.alignmentScore);
  const slippageBps = asNumber(payload.slippageBps);
  const avgLatencyMs = asNumber(payload.avgLatencyMs);
  const fillRate = asNumber(payload.fillRate);

  if (sharpe !== undefined) out.sharpe = sharpe;
  if (winRate !== undefined) out.winRate = winRate;
  if (tradeCount !== undefined) out.tradeCount = tradeCount;
  if (passRate !== undefined) out.passRate = passRate;
  if (survivalRate !== undefined) out.survivalRate = survivalRate;
  if (paperTrades !== undefined) out.paperTrades = paperTrades;
  if (paperWinRate !== undefined) out.paperWinRate = paperWinRate;
  if (paperPnl !== undefined) out.paperPnl = paperPnl;
  if (alignmentScore !== undefined) out.alignmentScore = alignmentScore;
  if (slippageBps !== undefined) out.slippageBps = slippageBps;
  if (avgLatencyMs !== undefined) out.avgLatencyMs = avgLatencyMs;
  if (fillRate !== undefined) out.fillRate = fillRate;

  return out;
}

router.get("/active", async (_req: Request, res: Response) => {
  try {
    const runs = await certificationRunner.getActiveRuns();
    res.json({ runs, count: runs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.get("/history", async (req: Request, res: Response) => {
  try {
    const strategyId = asString(req.query.strategyId);
    const targetTier = asString(req.query.targetTier);
    const status = asString(req.query.status);
    const limit = asNumber(req.query.limit);

    const runs = await certificationRunner.getHistory({
      strategyId,
      targetTier: TIER_NAMES.has(targetTier as TargetTier)
        ? (targetTier as TargetTier)
        : undefined,
      status: status as CertificationRunStatusType | undefined,
      limit,
    });

    res.json({ runs, count: runs.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.post("/initiate", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const strategyId = asString(body.strategyId);
    const strategyName = asString(body.strategyName);
    const targetTier = asString(body.targetTier);

    if (!strategyId || !strategyName || !targetTier || !TIER_NAMES.has(targetTier as TargetTier)) {
      res.status(400).json({
        error: "Invalid request",
        message:
          "strategyId, strategyName, and targetTier are required (targetTier: paper_approved | live_assisted | autonomous_candidate)",
      });
      return;
    }

    const symbols = asStringArray(body.symbols) ?? ["SPY"];
    const timeframe = asString(body.timeframe) ?? "5m";
    const start = asString((body.backtestDateRange as Record<string, unknown> | undefined)?.start) ?? "2025-01-01";
    const end = asString((body.backtestDateRange as Record<string, unknown> | undefined)?.end) ?? "2025-12-31";

    const runId = await certificationRunner.initiate({
      strategyId,
      strategyName,
      targetTier: targetTier as TargetTier,
      symbols,
      timeframe,
      backtestDateRange: { start, end },
      walkforwardFolds: asNumber(body.walkforwardFolds),
      stressScenarios: asStringArray(body.stressScenarios),
      shadowDurationMinutes: asNumber(body.shadowDurationMinutes),
      paperTradeMinCount: asNumber(body.paperTradeMinCount),
      capitalAllocation: asNumber(body.capitalAllocation),
      operatorId: asString(body.operatorId),
      expiresAt: asString(body.expiresAt),
    });

    res.status(201).json({ runId, status: "initiated" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.post("/:runId/step/:stepName", async (req: Request, res: Response) => {
  try {
    const runId = req.params.runId;
    const rawStep = req.params.stepName as CertificationGateStepName;
    if (!STEP_NAMES.has(rawStep)) {
      res.status(400).json({ error: `Unknown step '${req.params.stepName}'` });
      return;
    }

    const result = await certificationRunner.executeStep(runId, rawStep, parseStepInput(req.body));
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.post("/:runId/run-full", async (req: Request, res: Response) => {
  try {
    const result = await certificationRunner.runFull(req.params.runId);
    res.json({ success: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.post("/:runId/abort", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reason = asString(body.reason) ?? "Operator requested abort";
    await certificationRunner.abort(req.params.runId, reason);
    res.json({ success: true, status: "aborted", reason });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.post("/:runId/incident", async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const incidentType = asString(body.type) ?? "incident";
    const severity = asString(body.severity) ?? "warning";
    const message = asString(body.message) ?? "Incident recorded";

    await certificationRunner.recordIncident(req.params.runId, {
      type: incidentType,
      severity:
        severity === "info" || severity === "warning" || severity === "critical"
          ? severity
          : "warning",
      message,
      occurredAt: asString(body.occurredAt) ?? new Date().toISOString(),
      details:
        typeof body.details === "object" && body.details
          ? (body.details as Record<string, unknown>)
          : undefined,
    });

    res.status(201).json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.get("/:runId/status", async (req: Request, res: Response) => {
  try {
    const status = await certificationRunner.getRunStatus(req.params.runId);
    res.json(status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.get("/:runId/evidence", async (req: Request, res: Response) => {
  try {
    const packet = await certificationRunner.getEvidence(req.params.runId);
    res.json(packet);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.get("/:runId/steps", async (req: Request, res: Response) => {
  try {
    const steps = await certificationRunner.getSteps(req.params.runId);
    res.json({ runId: req.params.runId, steps, count: steps.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(errorStatusFrom(message)).json({ error: message });
  }
});

router.get("/requirements/reference", (_req: Request, res: Response) => {
  res.json({ requirements: TIER_REQUIREMENTS });
});

router.use((err: unknown, _req: Request, res: Response, _next: () => void) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, "Certification run route error");
  res.status(errorStatusFrom(message)).json({ error: message });
});

export default router;
