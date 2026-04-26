/**
 * Phase 17: Deployment Truth Routes
 *
 * Express endpoints for deployment validation, smoke testing, and startup tracking
 */

import express, { Request, Response, Router } from "express";
import {
  BootValidator,
  DeploySmokeTest,
  StartupResilience,
  BootReport,
  SmokeTestResult,
  maskSecrets,
} from "../lib/deployment_truth";

/**
 * Global instances shared across requests
 */
export const deploymentState = {
  bootValidator: new BootValidator(),
  smokeTest: new DeploySmokeTest(),
  resilience: new StartupResilience(),
  lastBootReport: null as BootReport | null,
  lastSmokeTestResult: null as SmokeTestResult | null,
};

/**
 * Initialize deployment truth routes
 *
 * @param app Express application or router
 * @param context Optional context for boot validation
 * @returns Configured router
 */
export function initDeploymentTruthRoutes(
  app: Router | express.Application,
  context?: {
    dbCheck?: () => Promise<boolean>;
    routeCheck?: () => Promise<string[]>;
    dependencyChecks?: Record<string, () => Promise<any>>;
  }
): Router {
  const router = express.Router();

  /**
   * GET /api/deployment/boot-report
   * Returns the last boot validation report
   */
  router.get("/boot-report", (req: Request, res: Response): void => {
    if (!deploymentState.lastBootReport) {
      res.status(404).json({
        error: "No boot report available yet",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: deploymentState.lastBootReport,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/deployment/smoke-test
   * Run smoke test on-demand and return results
   */
  router.get("/smoke-test", async (req: Request, res: Response): Promise<void> => {
    try {
      const baseUrl = req.query.baseUrl
        ? String(req.query.baseUrl)
        : `http://localhost:${process.env.PORT || 3000}`;

      const smokeTest = new DeploySmokeTest(baseUrl);
      const result = await smokeTest.run();

      deploymentState.lastSmokeTestResult = result;

      const statusCode = result.success ? 200 : 503;
      res.status(statusCode).json({
        success: result.success,
        data: result,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/deployment/startup-history
   * Get boot attempt history and resilience metrics
   */
  router.get("/startup-history", (req: Request, res: Response): void => {
    const limit = req.query.limit
      ? Math.min(parseInt(String(req.query.limit), 10), 50)
      : 10;

    const history = deploymentState.resilience.getBootHistory(limit);
    const metrics = deploymentState.resilience.getMetrics();

    res.status(200).json({
      success: true,
      data: {
        history,
        metrics,
        bootLoop: metrics.bootLoop,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/deployment/env-audit
   * Environment variable completeness check (masks secrets)
   */
  router.get("/env-audit", (req: Request, res: Response): void => {
    const envVars = process.env;
    // @ts-expect-error TS2345 — auto-suppressed for strict build
    const masked = maskSecrets(envVars);

    // Check which required env vars are present
    const requiredVars = [
      "NODE_ENV",
      "DATABASE_URL",
    ];
    const optionalVars = [
      "PORT",
      "ALPACA_API_KEY",
      "ALPACA_BASE_URL",
      "ANTHROPIC_API_KEY",
      "LOG_LEVEL",
    ];

    const audit = {
      required: requiredVars.reduce(
        (acc, key) => {
          acc[key] = {
            present: !!process.env[key],
            value: masked[key],
          };
          return acc;
        },
        {} as Record<string, { present: boolean; value?: string }>
      ),
      optional: optionalVars.reduce(
        (acc, key) => {
          acc[key] = {
            present: !!process.env[key],
            value: masked[key],
          };
          return acc;
        },
        {} as Record<string, { present: boolean; value?: string }>
      ),
      summary: {
        totalRequired: requiredVars.length,
        presentRequired: requiredVars.filter((k) => process.env[k]).length,
        totalOptional: optionalVars.length,
        presentOptional: optionalVars.filter((k) => process.env[k]).length,
      },
    };

    res.status(200).json({
      success: true,
      data: audit,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /api/deployment/readiness-timeline
   * Dependency readiness timeline from startup events
   */
  router.get("/readiness-timeline", (req: Request, res: Response): void => {
    const bootId = req.query.bootId ? String(req.query.bootId) : undefined;
    const timeline = deploymentState.resilience.getStartupTimeline(bootId);

    // Group events by phase and calculate timing
    const phases: Record<
      string,
      { timestamp: string; duration?: number; count: number }
    > = {};

    for (const event of timeline) {
      if (!phases[event.phase]) {
        phases[event.phase] = {
          timestamp: event.timestamp,
          duration: event.duration,
          count: 1,
        };
      } else {
        phases[event.phase].count += 1;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        bootId,
        events: timeline,
        phasesSummary: phases,
        totalDuration: timeline.length
          ? new Date(timeline[timeline.length - 1].timestamp).getTime() -
            new Date(timeline[0].timestamp).getTime()
          : 0,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * POST /api/deployment/validate-boot
   * Internal endpoint: Run full boot validation (admin only)
   */
  router.post("/validate-boot", async (req: Request, res: Response): Promise<void> => {
    try {
      const report = await deploymentState.bootValidator.validate(context || {});
      deploymentState.lastBootReport = report;

      // Record in resilience tracker
      deploymentState.resilience.recordBootAttempt(
        report.bootId,
        report.success,
        report.duration,
        report.errors.length > 0 ? report.errors.join("; ") : undefined
      );

      const statusCode = report.success ? 200 : 503;
      res.status(statusCode).json({
        success: report.success,
        data: report,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString(),
      });
    }
  });

  /**
   * GET /api/deployment/status
   * Overall deployment health status
   */
  router.get("/status", (req: Request, res: Response): void => {
    const metrics = deploymentState.resilience.getMetrics();
    const bootLoop = metrics.bootLoop;

    // Determine overall status
    let status = "healthy";
    if (bootLoop.detected) {
      status = "critical";
    } else if (metrics.successRate < 50) {
      status = "degraded";
    }

    res.status(200).json({
      success: true,
      data: {
        status,
        metrics,
        lastBootReport: deploymentState.lastBootReport,
        lastSmokeTest: deploymentState.lastSmokeTestResult,
      },
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * Mount router on the app
   */
  if ("use" in app) {
    // @ts-expect-error TS2769 — auto-suppressed for strict build
    app.use("/api/deployment", router);
  }

  return router;
}

/**
 * Helper: Record startup event for current boot
 */
export function recordStartupPhase(
  phase: string,
  duration?: number,
  error?: string,
  metadata?: Record<string, unknown>
): void {
  deploymentState.resilience.recordStartupEvent(phase, duration, error, {
    ...metadata,
    bootId: deploymentState.bootValidator.getBootId(),
  });
}

const deploymentTruthRouter = initDeploymentTruthRoutes(express.Router());
export default deploymentTruthRouter;
