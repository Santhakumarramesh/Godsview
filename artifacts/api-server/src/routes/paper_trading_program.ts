import { Router, type IRouter } from "express";
import {
  startProgram,
  advanceDay,
  pauseProgram,
  resumeProgram,
  getProgramStatus,
  getPhaseReport,
  getSignalLog,
  getExecutionLog,
  getRiskComplianceReport,
  getStrategyComparisonReport,
  getCertificationStatus,
  generateCertificate,
  getFullReport,
} from "../lib/paper_trading_program";

const router: IRouter = Router();

// ─── Utility ──────────────────────────────────────────────────────────────────

function parseNum(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseArray(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value.split(",").map((s: any) => s.trim());
    }
  }
  if (Array.isArray(value)) return value;
  return [];
}

// ─── Endpoints ────────────────────────────────────────────────────────────────

/**
 * GET /paper-program/status
 * Get current program status
 */
router.get("/status", (_req: any, res: any): void => {
  try {
    const status = getProgramStatus();
    res.json(status);
  } catch (err) {
    console.error("Failed to get program status", err);
    res.status(503).json({ error: "status_failed", message: String(err) });
  }
});

/**
 * POST /paper-program/start
 * Start a new validation program
 */
router.post("/start", (req: any, res: any): void => {
  try {
    const { strategies, symbols, capitalAllocation } = req.body;

    if (!strategies || !symbols) {
      res.status(400).json({
        error: "missing_params",
        message: "strategies and symbols are required",
      });
      return;
    }

    const strategiesList = Array.isArray(strategies) ? strategies : parseArray(strategies);
    const symbolsList = Array.isArray(symbols) ? symbols : parseArray(symbols);
    const capital = capitalAllocation || 100000;

    if (strategiesList.length === 0 || symbolsList.length === 0) {
      res.status(400).json({
        error: "invalid_params",
        message: "strategies and symbols must not be empty",
      });
      return;
    }

    const result = startProgram({
      strategies: strategiesList,
      symbols: symbolsList,
      capitalAllocation: capital,
    });

    res.json(result);
  } catch (err) {
    (req as any).log.error({ err }, "Failed to start paper program");
    res.status(503).json({ error: "start_failed", message: String(err) });
  }
});

/**
 * POST /paper-program/advance
 * Advance program by one day
 */
router.post("/advance", (_req: any, res: any): void => {
  try {
    const result = advanceDay();
    res.json(result);
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to advance paper program day");
    res.status(503).json({ error: "advance_failed", message: String(err) });
  }
});

/**
 * POST /paper-program/pause
 * Pause the program
 */
router.post("/pause", (_req: any, res: any): void => {
  try {
    const result = pauseProgram();
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to pause paper program");
    res.status(503).json({ error: "pause_failed", message: String(err) });
  }
});

/**
 * POST /paper-program/resume
 * Resume a paused program
 */
router.post("/resume", (_req: any, res: any): void => {
  try {
    const result = resumeProgram();
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to resume paper program");
    res.status(503).json({ error: "resume_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/phase/:phase
 * Get report for a specific phase (1-4)
 */
router.get("/phase/:phase", (req: any, res: any): void => {
  try {
    const phase = parseInt(req.params.phase, 10) as 1 | 2 | 3 | 4;

    if (![1, 2, 3, 4].includes(phase)) {
      res.status(400).json({ error: "invalid_phase", message: "Phase must be 1-4" });
      return;
    }

    const report = getPhaseReport(phase);
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to get phase report");
    res.status(503).json({ error: "phase_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/signals
 * Get signal verification log
 */
router.get("/signals", (req: any, res: any): void => {
  try {
    const limit = parseNum(req.query.limit) ?? 50;
    const signals = getSignalLog(Math.min(500, Math.max(1, limit)));
    res.json({ count: signals.length, signals });
  } catch (err) {
    req.log.error({ err }, "Failed to get signal log");
    res.status(503).json({ error: "signals_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/executions
 * Get execution simulation log
 */
router.get("/executions", (req: any, res: any): void => {
  try {
    const limit = parseNum(req.query.limit) ?? 50;
    const executions = getExecutionLog(Math.min(500, Math.max(1, limit)));
    res.json({ count: executions.length, executions });
  } catch (err) {
    req.log.error({ err }, "Failed to get execution log");
    res.status(503).json({ error: "executions_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/risk-compliance
 * Get risk compliance test results
 */
router.get("/risk-compliance", (_req: any, res: any): void => {
  try {
    const report = getRiskComplianceReport();
    res.json(report);
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to get risk compliance report");
    res.status(503).json({ error: "risk_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/strategy-comparison
 * Get paper vs backtest strategy comparison
 */
router.get("/strategy-comparison", (_req: any, res: any): void => {
  try {
    const report = getStrategyComparisonReport();
    res.json(report);
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to get strategy comparison report");
    res.status(503).json({ error: "comparison_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/certification
 * Get current certification status
 */
router.get("/certification", (_req: any, res: any): void => {
  try {
    const status = getCertificationStatus();
    res.json(status);
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to get certification status");
    res.status(503).json({ error: "certification_failed", message: String(err) });
  }
});

/**
 * POST /paper-program/certify
 * Generate a certificate if all phases pass
 */
router.post("/certify", (_req: any, res: any): void => {
  try {
    const result = generateCertificate();
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to generate certificate");
    res.status(503).json({ error: "certify_failed", message: String(err) });
  }
});

/**
 * GET /paper-program/report
 * Get complete program report
 */
router.get("/report", (_req: any, res: any): void => {
  try {
    const report = getFullReport();
    res.json(report);
  } catch (err) {
    (_req as any).log.error({ err }, "Failed to get full report");
    res.status(503).json({ error: "report_failed", message: String(err) });
  }
});

export default router;
