/**
 * Unified Observability Routes
 *
 * Endpoints:
 * - /api/v1/health — Comprehensive health check with unified observability
 * - /api/v1/ready — Readiness probe using observability module
 * - /api/v1/observability/incidents — Incident timeline query
 * - /api/v1/observability/slo-status — SLO burn rate tracking
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  readinessProbe,
  runHealthChecks,
  getRecentIncidents,
  getSLOStatus,
  recordSLOEvent,
  setLogContext,
  getLogContext,
} from "../lib/observability";

const router: IRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ── Middleware: Attach context to each request ──────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.use((req: Request, res: Response, next) => {
  const correlationId = (req.headers["x-correlation-id"] as string) ||
    (req.headers["x-request-id"] as string) ||
    (req as any).id ||
    getLogContext().correlationId;

  setLogContext({
    correlationId,
    requestPath: req.path,
    method: req.method,
  });

  // Attach correlation ID to response
  res.setHeader("x-correlation-id", correlationId);

  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// ── /api/v1/health — Comprehensive Health Check ───────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get("/api/v1/health", async (_req: Request, res: Response) => {
  try {
    const health = await runHealthChecks();
    const probe = await readinessProbe();

    const statusCode = health.allHealthy ? 200 : 503;

    res.status(statusCode).json({
      status: health.status,
      ready: probe.ready,
      timestamp: health.timestamp,
      version: probe.version,
      uptime: probe.uptime,
      dependencies: health.checks,
      memory: {
        rss_mb: probe.memoryMB,
      },
      eventLoopLag: {
        ms: probe.eventLoopLagMs,
        healthy: probe.eventLoopLagMs < 100,
      },
      node: probe.nodeVersion,
      correlationId: getLogContext().correlationId,
    });

    // Track health check success as SLO event
    recordSLOEvent("api-availability", statusCode === 200);
  } catch (err: any) {
    recordSLOEvent("api-availability", false);
    res.status(503).json({
      status: "unhealthy",
      error: err.message,
      correlationId: getLogContext().correlationId,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── /api/v1/ready — Readiness Probe ────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get("/api/v1/ready", async (_req: Request, res: Response) => {
  try {
    const probe = await readinessProbe();

    const statusCode = probe.ready ? 200 : 503;

    res.status(statusCode).json({
      ready: probe.ready,
      timestamp: probe.timestamp,
      version: probe.version,
      uptime: probe.uptime,
      nodeVersion: probe.nodeVersion,
      memory: {
        rss_mb: probe.memoryMB,
      },
      eventLoop: {
        lag_ms: probe.eventLoopLagMs,
        threshold_ms: 100,
        healthy: probe.eventLoopLagMs < 100,
      },
      dependencies: Object.entries(probe.dependencies).map(([name, status]) => ({
        name,
        status: status.status,
        latency_ms: status.latencyMs,
        error: status.error,
      })),
      correlationId: getLogContext().correlationId,
    });

    recordSLOEvent("api-availability", statusCode === 200);
  } catch (err: any) {
    recordSLOEvent("api-availability", false);
    res.status(503).json({
      ready: false,
      error: err.message,
      correlationId: getLogContext().correlationId,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ── /api/v1/observability/incidents — Incident Timeline ────────────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  "/api/v1/observability/incidents",
  (_req: Request, res: Response) => {
    try {
      const limit = Math.min(
        Number(_req.query.limit) || 20,
        100, // Max 100
      );
      const incidents = getRecentIncidents(limit);

      res.json({
        incidents: incidents.map((incident) => ({
          incidentId: incident.incidentId,
          severity: incident.severity,
          startTime: incident.startTime,
          endTime: incident.endTime,
          resolved: incident.resolved,
          eventCount: incident.events.length,
          events: incident.events.map((evt) => ({
            timestamp: evt.timestamp,
            type: evt.eventType,
            severity: evt.severity,
            component: evt.component,
            message: evt.message,
          })),
        })),
        count: incidents.length,
        correlationId: getLogContext().correlationId,
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
        correlationId: getLogContext().correlationId,
      });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════
// ── /api/v1/observability/slo-status — SLO Burn Rate Tracking ──────────────
// ═══════════════════════════════════════════════════════════════════════════

router.get(
  "/api/v1/observability/slo-status",
  (_req: Request, res: Response) => {
    try {
      const sloStatus = getSLOStatus();

      res.json({
        slos: sloStatus.map((slo) => ({
          target: slo.target,
          window: slo.window,
          currentBurnRate: `${slo.currentBurnRate.toFixed(2)}%`,
          budgetRemaining: `${slo.budgetRemaining.toFixed(2)}%`,
          isErroring: slo.isErroring,
          threshold: `${slo.threshold.toFixed(2)}%`,
        })),
        count: sloStatus.length,
        timestamp: new Date().toISOString(),
        correlationId: getLogContext().correlationId,
      });
    } catch (err: any) {
      res.status(500).json({
        error: err.message,
        correlationId: getLogContext().correlationId,
      });
    }
  },
);

export default router;
