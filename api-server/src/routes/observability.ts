import { Router, Request, Response } from "express";
import {
  traceEngine,
  metricsPipeline,
  alertRulesEngine,
  correlationMiddleware,
} from "../lib/observability/index.js";

const router = Router();

// Trace endpoints
router.post(
  "/api/observability/traces",
  (req: Request, res: Response) => {
    try {
      const { operation, metadata } = req.body;
      if (!operation) {
        res.status(400).json({ ok: false, error: "operation required" });
        return;
      }

      const result = traceEngine.startTrace(operation, metadata);
      res.json({ ok: true, data: result });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/traces/:traceId",
  (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;
      const trace = traceEngine.getTrace(traceId);

      if (!trace) {
        res.status(404).json({ ok: false, error: "Trace not found" });
        return;
      }

      res.json({ ok: true, data: trace });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/observability/traces/:traceId/spans",
  (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;
      const { spanName, data } = req.body;

      if (!spanName) {
        res.status(400).json({ ok: false, error: "spanName required" });
        return;
      }

      const spanId = traceEngine.addSpan(traceId, spanName, data);

      if (!spanId) {
        res.status(404).json({ ok: false, error: "Trace not found" });
        return;
      }

      res.json({ ok: true, data: { spanId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.patch(
  "/api/observability/traces/:traceId/spans/:spanId",
  (req: Request, res: Response) => {
    try {
      const { traceId, spanId } = req.params;
      const { result } = req.body;

      const success = traceEngine.endSpan(traceId, spanId, result);

      if (!success) {
        res.status(404).json({ ok: false, error: "Trace or span not found" });
        return;
      }

      res.json({ ok: true, data: { spanId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.patch(
  "/api/observability/traces/:traceId/end",
  (req: Request, res: Response) => {
    try {
      const { traceId } = req.params;
      const { status } = req.body;

      if (!status || !["success", "error", "timeout"].includes(status)) {
        res.status(400).json({ ok: false, error: "Valid status required" });
        return;
      }

      const success = traceEngine.endTrace(
        traceId,
        status as "success" | "error" | "timeout"
      );

      if (!success) {
        res.status(404).json({ ok: false, error: "Trace not found" });
        return;
      }

      res.json({ ok: true, data: { traceId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/traces",
  (req: Request, res: Response) => {
    try {
      const { operation, status, minDuration, since } = req.query;

      const filters: any = {};
      if (operation) filters.operation = operation;
      if (status) filters.status = status;
      if (minDuration) filters.minDuration = parseInt(minDuration as string);
      if (since) filters.since = parseInt(since as string);

      const traces = traceEngine.searchTraces(filters);
      res.json({ ok: true, data: traces });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/trace-metrics",
  (req: Request, res: Response) => {
    try {
      const metrics = traceEngine.getTraceMetrics();
      res.json({ ok: true, data: metrics });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Metrics endpoints
router.post(
  "/api/observability/metrics",
  (req: Request, res: Response) => {
    try {
      const { name, value, tags } = req.body;

      if (!name || value === undefined) {
        res
          .status(400)
          .json({ ok: false, error: "name and value required" });
        return;
      }

      const metricId = metricsPipeline.recordMetric(name, value, tags);
      res.json({ ok: true, data: { metricId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/observability/metrics/counter",
  (req: Request, res: Response) => {
    try {
      const { name, increment, tags } = req.body;

      if (!name || increment === undefined) {
        res
          .status(400)
          .json({ ok: false, error: "name and increment required" });
        return;
      }

      const metricId = metricsPipeline.recordCounter(
        name,
        increment,
        tags
      );
      res.json({ ok: true, data: { metricId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/observability/metrics/gauge",
  (req: Request, res: Response) => {
    try {
      const { name, value, tags } = req.body;

      if (!name || value === undefined) {
        res
          .status(400)
          .json({ ok: false, error: "name and value required" });
        return;
      }

      const metricId = metricsPipeline.recordGauge(name, value, tags);
      res.json({ ok: true, data: { metricId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/observability/metrics/histogram",
  (req: Request, res: Response) => {
    try {
      const { name, value, tags } = req.body;

      if (!name || value === undefined) {
        res
          .status(400)
          .json({ ok: false, error: "name and value required" });
        return;
      }

      const metricId = metricsPipeline.recordHistogram(name, value, tags);
      res.json({ ok: true, data: { metricId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/metrics",
  (req: Request, res: Response) => {
    try {
      const { name, since } = req.query;

      const metrics = metricsPipeline.getMetrics(
        name as string | undefined,
        since ? parseInt(since as string) : undefined
      );
      res.json({ ok: true, data: metrics });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/metrics/summary",
  (req: Request, res: Response) => {
    try {
      const summary = metricsPipeline.getMetricsSummary();
      res.json({ ok: true, data: summary });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/metrics/dashboard",
  (req: Request, res: Response) => {
    try {
      const dashboard = metricsPipeline.getDashboard();
      res.json({ ok: true, data: dashboard });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Alert Rules endpoints
router.post(
  "/api/observability/alert-rules",
  (req: Request, res: Response) => {
    try {
      const { name, metric, condition, threshold, window, severity, actions } = req.body;

      if (
        !name ||
        !metric ||
        !condition ||
        threshold === undefined ||
        !window ||
        !severity ||
        !actions
      ) {
        res.status(400).json({ ok: false, error: "Missing required fields" });
        return;
      }

      const ruleId = alertRulesEngine.createRule({
        name,
        metric,
        condition,
        threshold,
        window,
        severity,
        actions,
      });

      res.json({ ok: true, data: { ruleId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/alert-rules",
  (req: Request, res: Response) => {
    try {
      const rules = alertRulesEngine.getRules();
      res.json({ ok: true, data: rules });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.delete(
  "/api/observability/alert-rules/:ruleId",
  (req: Request, res: Response) => {
    try {
      const { ruleId } = req.params;
      const success = alertRulesEngine.deleteRule(ruleId);

      if (!success) {
        res.status(404).json({ ok: false, error: "Rule not found" });
        return;
      }

      res.json({ ok: true, data: { ruleId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.post(
  "/api/observability/alert-rules/evaluate",
  (req: Request, res: Response) => {
    try {
      const { metrics } = req.body;

      if (!metrics || typeof metrics !== "object") {
        res.status(400).json({ ok: false, error: "metrics object required" });
        return;
      }

      const metricsMap = new Map(Object.entries(metrics));
      const alerts = alertRulesEngine.evaluateRules(metricsMap);
      res.json({ ok: true, data: alerts });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Alerts endpoints
router.get(
  "/api/observability/alerts",
  (req: Request, res: Response) => {
    try {
      const { severity, acknowledged, since } = req.query;

      const filters: any = {};
      if (severity) filters.severity = severity;
      if (acknowledged !== undefined) filters.acknowledged = acknowledged === "true";
      if (since) filters.since = parseInt(since as string);

      const alerts = alertRulesEngine.getAlerts(filters);
      res.json({ ok: true, data: alerts });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.patch(
  "/api/observability/alerts/:alertId/ack",
  (req: Request, res: Response) => {
    try {
      const { alertId } = req.params;
      const success = alertRulesEngine.acknowledgeAlert(alertId);

      if (!success) {
        res.status(404).json({ ok: false, error: "Alert not found" });
        return;
      }

      res.json({ ok: true, data: { alertId } });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/alert-stats",
  (req: Request, res: Response) => {
    try {
      const stats = alertRulesEngine.getAlertStats();
      res.json({ ok: true, data: stats });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

// Correlation ID endpoints
router.get(
  "/api/observability/correlation/:correlationId",
  (req: Request, res: Response) => {
    try {
      const { correlationId } = req.params;
      const log = correlationMiddleware.getRequestLog(correlationId);

      if (!log) {
        res.status(404).json({ ok: false, error: "Request log not found" });
        return;
      }

      res.json({ ok: true, data: log });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

router.get(
  "/api/observability/correlation",
  (req: Request, res: Response) => {
    try {
      const { limit } = req.query;
      const requests = correlationMiddleware.getRecentRequests(
        limit ? parseInt(limit as string) : 20
      );
      res.json({ ok: true, data: requests });
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  }
);

export default router;
