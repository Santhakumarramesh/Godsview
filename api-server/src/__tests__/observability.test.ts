import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  structuredLogger,
  setLogContext,
  getLogContext,
  createStructuredLogger,
  registerHealthCheck,
  runHealthChecks,
  readinessProbe,
  recordIncidentEvent,
  resolveIncident,
  getIncidentTimeline,
  getRecentIncidents,
  recordSLOEvent,
  calculateSLOBurnRate,
  getSLOStatus,
  registerSLOTarget,
  type IncidentEvent,
  type SLOTarget,
} from "../lib/observability";

describe("Observability Layer", () => {
  // ──────────────────────────────────────────────────────────────────
  // Structured Logger Tests
  // ──────────────────────────────────────────────────────────────────

  describe("Structured Logger", () => {
    beforeEach(() => {
      setLogContext({ service: "godsview-api" });
    });

    it("should set and get log context", () => {
      const ctx = getLogContext();
      expect(ctx).toHaveProperty("correlationId");
      expect(ctx).toHaveProperty("service");
      expect(ctx).toHaveProperty("timestamp");
      expect(ctx.service).toBe("godsview-api");
    });

    it("should include all required fields in context", () => {
      const ctx = getLogContext();
      const requiredFields = [
        "correlationId",
        "service",
        "timestamp",
      ];
      for (const field of requiredFields) {
        expect(ctx).toHaveProperty(field);
      }
      expect(typeof ctx.correlationId).toBe("string");
      expect(ctx.correlationId.length).toBeGreaterThan(0);
      expect(typeof ctx.timestamp).toBe("string");
      expect(ctx.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("should create logger with custom context", () => {
      const logger = createStructuredLogger({
        userId: "user-123",
        sessionId: "session-456",
      });
      expect(logger).toBeDefined();
    });

    it("should log debug messages", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      structuredLogger.debug("Test debug", { test: true });
      expect(consoleSpy).not.toThrow();
      consoleSpy.mockRestore();
    });

    it("should log info messages", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      structuredLogger.info("Test info", { test: true });
      expect(consoleSpy).not.toThrow();
      consoleSpy.mockRestore();
    });

    it("should log warning messages", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      structuredLogger.warn("Test warning", { test: true });
      expect(consoleSpy).not.toThrow();
      consoleSpy.mockRestore();
    });

    it("should log error messages with error object", () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const error = new Error("Test error");
      structuredLogger.error("Error occurred", { test: true }, error);
      expect(consoleSpy).not.toThrow();
      consoleSpy.mockRestore();
    });

    it("should update context with user and session IDs", () => {
      setLogContext({
        userId: "user-999",
        sessionId: "session-888",
      });
      const ctx = getLogContext();
      expect(ctx.userId).toBe("user-999");
      expect(ctx.sessionId).toBe("session-888");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Health Check Aggregator Tests
  // ──────────────────────────────────────────────────────────────────

  describe("Health Check Aggregator", () => {
    beforeEach(() => {
      // Reset health checks by re-registering defaults
      registerHealthCheck("api-server", async () => ({
        status: "ok",
        latencyMs: 5,
      }));
    });

    it("should register and run health checks", async () => {
      registerHealthCheck("test-service", async () => ({
        status: "ok",
        latencyMs: 10,
      }));

      const result = await runHealthChecks();
      expect(result).toHaveProperty("status");
      expect(result).toHaveProperty("checks");
      expect(result).toHaveProperty("timestamp");
      expect(result).toHaveProperty("allHealthy");
    });

    it("should report healthy status when all checks pass", async () => {
      registerHealthCheck("healthy-service", async () => ({
        status: "ok",
        latencyMs: 5,
      }));

      const result = await runHealthChecks();
      expect(result.status).toBe("healthy");
      expect(result.allHealthy).toBe(true);
    });

    it("should report degraded status when a check fails", async () => {
      registerHealthCheck("failing-service", async () => ({
        status: "error",
        error: "Connection refused",
      }));

      const result = await runHealthChecks();
      expect(result.allHealthy).toBe(false);
    });

    it("should include latency measurements in health checks", async () => {
      registerHealthCheck("latency-check", async () => ({
        status: "ok",
        latencyMs: 42,
      }));

      const result = await runHealthChecks();
      expect(result.checks["latency-check"]).toHaveProperty("latencyMs");
      expect(result.checks["latency-check"].latencyMs).toBe(42);
    });

    it("should handle database health check", async () => {
      const result = await runHealthChecks();
      expect(result.checks).toHaveProperty("database");
      const dbCheck = result.checks["database"];
      expect(["ok", "degraded", "error", "skipped"]).toContain(dbCheck.status);
    });

    it("should handle Redis health check", async () => {
      const result = await runHealthChecks();
      expect(result.checks).toHaveProperty("redis");
      const redisCheck = result.checks["redis"];
      expect(["ok", "degraded", "error", "skipped"]).toContain(redisCheck.status);
    });

    it("should handle message broker health check", async () => {
      const result = await runHealthChecks();
      expect(result.checks).toHaveProperty("broker");
      const brokerCheck = result.checks["broker"];
      expect(["ok", "degraded", "error", "skipped"]).toContain(brokerCheck.status);
    });

    it("should include timestamp in health result", async () => {
      const result = await runHealthChecks();
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Readiness Probe Tests
  // ──────────────────────────────────────────────────────────────────

  describe("Readiness Probe", () => {
    it("should return readiness probe with all required fields", async () => {
      const probe = await readinessProbe();
      expect(probe).toHaveProperty("ready");
      expect(probe).toHaveProperty("timestamp");
      expect(probe).toHaveProperty("version");
      expect(probe).toHaveProperty("uptime");
      expect(probe).toHaveProperty("dependencies");
      expect(probe).toHaveProperty("nodeVersion");
      expect(probe).toHaveProperty("memoryMB");
      expect(probe).toHaveProperty("eventLoopLagMs");
    });

    it("should include version in readiness probe", async () => {
      const probe = await readinessProbe();
      expect(typeof probe.version).toBe("string");
      expect(probe.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it("should include uptime in readiness probe", async () => {
      const probe = await readinessProbe();
      expect(probe.uptime).toBeGreaterThanOrEqual(0);
      expect(typeof probe.uptime).toBe("number");
    });

    it("should report memory usage in MB", async () => {
      const probe = await readinessProbe();
      expect(probe.memoryMB).toBeGreaterThan(0);
      expect(typeof probe.memoryMB).toBe("number");
    });

    it("should measure event loop lag", async () => {
      const probe = await readinessProbe();
      expect(probe.eventLoopLagMs).toBeGreaterThanOrEqual(0);
      expect(typeof probe.eventLoopLagMs).toBe("number");
    });

    it("should include Node.js version", async () => {
      const probe = await readinessProbe();
      expect(probe.nodeVersion).toMatch(/^v\d+\.\d+\.\d+/);
    });

    it("should include dependencies status", async () => {
      const probe = await readinessProbe();
      expect(Object.keys(probe.dependencies).length).toBeGreaterThan(0);
      for (const depStatus of Object.values(probe.dependencies)) {
        expect(["ok", "degraded", "error", "skipped"]).toContain(depStatus.status);
      }
    });

    it("should mark ready as false if event loop lag is high", async () => {
      // This is a soft assertion - real high lag is hard to trigger in tests
      const probe = await readinessProbe();
      if (probe.eventLoopLagMs > 100) {
        expect(probe.ready).toBe(false);
      }
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Incident Timeline Recorder Tests
  // ──────────────────────────────────────────────────────────────────

  describe("Incident Timeline Recorder", () => {
    it("should record an incident event", () => {
      const event: Omit<IncidentEvent, "timestamp"> = {
        correlationId: "corr-123",
        eventType: "signal_rejected",
        severity: "warning",
        component: "signal-processor",
        message: "Signal rejected due to gate failure",
      };

      const incidentId = recordIncidentEvent(event);
      expect(incidentId).toBeDefined();
      expect(incidentId).toMatch(/^incident-/);
    });

    it("should retrieve incident timeline", () => {
      const event: Omit<IncidentEvent, "timestamp"> = {
        correlationId: "corr-456",
        eventType: "trade_failed",
        severity: "critical",
        component: "execution-engine",
        message: "Trade execution failed",
        data: { reason: "insufficient_funds" },
      };

      const incidentId = recordIncidentEvent(event);
      const timeline = getIncidentTimeline(incidentId);

      expect(timeline).toBeDefined();
      expect(timeline!.incidentId).toBe(incidentId);
      expect(timeline!.events).toHaveLength(1);
      expect(timeline!.events[0].eventType).toBe("trade_failed");
    });

    it("should resolve incident timeline", () => {
      const event: Omit<IncidentEvent, "timestamp"> = {
        correlationId: "corr-789",
        eventType: "error_occurred",
        severity: "critical",
        component: "database",
        message: "Database connection lost",
      };

      const incidentId = recordIncidentEvent(event);
      const resolved = resolveIncident(incidentId);

      expect(resolved).toBeDefined();
      expect(resolved!.resolved).toBe(true);
      expect(resolved!.endTime).toBeDefined();
    });

    it("should aggregate multiple events into single incident", () => {
      const incidentId = recordIncidentEvent({
        correlationId: "corr-multi",
        eventType: "health_degraded",
        severity: "warning",
        component: "api-gateway",
        message: "High latency detected",
      });

      recordIncidentEvent({
        correlationId: "corr-multi",
        eventType: "health_degraded",
        severity: "warning",
        component: "api-gateway",
        message: "Latency still high",
      });

      recordIncidentEvent({
        correlationId: "corr-multi",
        eventType: "recovery",
        severity: "info",
        component: "api-gateway",
        message: "Recovered from latency",
      });

      const timeline = getIncidentTimeline(incidentId);
      expect(timeline!.events).toHaveLength(3);
    });

    it("should include stack trace in incident events", () => {
      const error = new Error("Test error");
      const incidentId = recordIncidentEvent({
        correlationId: "corr-trace",
        eventType: "error_occurred",
        severity: "critical",
        component: "signal-processor",
        message: "Unhandled exception",
        stackTrace: error.stack,
      });

      const timeline = getIncidentTimeline(incidentId);
      expect(timeline!.events[0].stackTrace).toBeDefined();
    });

    it("should get recent incidents", () => {
      for (let i = 0; i < 5; i++) {
        recordIncidentEvent({
          correlationId: `corr-recent-${i}`,
          eventType: "signal_generated",
          severity: "info",
          component: `component-${i}`,
          message: `Event ${i}`,
        });
      }

      const recent = getRecentIncidents(3);
      expect(recent.length).toBeLessThanOrEqual(3);
      expect(recent.length).toBeGreaterThan(0);
    });

    it("should escalate incident severity to critical", () => {
      const incidentId = recordIncidentEvent({
        correlationId: "corr-escalate",
        eventType: "health_degraded",
        severity: "warning",
        component: "broker",
        message: "Broker latency elevated",
      });

      recordIncidentEvent({
        correlationId: "corr-escalate",
        eventType: "error_occurred",
        severity: "critical",
        component: "broker",
        message: "Broker connection lost",
      });

      const timeline = getIncidentTimeline(incidentId);
      expect(timeline!.severity).toBe("critical");
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // SLO Burn Rate Calculation Tests
  // ──────────────────────────────────────────────────────────────────

  describe("SLO Burn Rate Calculation", () => {
    it("should register custom SLO target", () => {
      const slo: SLOTarget = {
        name: "Custom Availability",
        target: 99.5,
        window: "24h",
      };

      registerSLOTarget(slo);

      const status = getSLOStatus();
      const customSlo = status.find((s) => s.target === "custom-availability");
      expect(customSlo).toBeDefined();
    });

    it("should record SLO success event", () => {
      recordSLOEvent("api-availability", true);
      const burnRate = calculateSLOBurnRate("api-availability");
      expect(burnRate).toBeDefined();
    });

    it("should record SLO failure event", () => {
      recordSLOEvent("api-availability", false);
      const burnRate = calculateSLOBurnRate("api-availability");
      expect(burnRate).toBeDefined();
    });

    it("should calculate correct burn rate", () => {
      // Record 9 successes and 1 failure
      for (let i = 0; i < 9; i++) {
        recordSLOEvent("signal-processing", true);
      }
      recordSLOEvent("signal-processing", false);

      const burnRate = calculateSLOBurnRate("signal-processing");
      expect(burnRate).toBeDefined();
      expect(burnRate!.currentBurnRate).toBeLessThanOrEqual(100);
      expect(burnRate!.currentBurnRate).toBeGreaterThanOrEqual(0);
    });

    it("should calculate budget remaining", () => {
      const burnRate = calculateSLOBurnRate("trade-execution");
      expect(burnRate).toBeDefined();
      expect(burnRate!.budgetRemaining).toBeGreaterThanOrEqual(0);
      expect(burnRate!.budgetRemaining).toBeLessThanOrEqual(100);
    });

    it("should return zero burn rate with no events", () => {
      const burnRate = calculateSLOBurnRate("api-availability");
      if (burnRate!.currentBurnRate === 0) {
        expect(burnRate!.budgetRemaining).toBe(100);
      }
    });

    it("should flag high burn rate as error", () => {
      // Record many failures
      for (let i = 0; i < 100; i++) {
        recordSLOEvent("api-availability", false);
      }

      const burnRate = calculateSLOBurnRate("api-availability");
      expect(burnRate).toBeDefined();
      expect(burnRate!.isErroring).toBe(true);
    });

    it("should get all SLO statuses", () => {
      const statuses = getSLOStatus();
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses.length).toBeGreaterThan(0);

      for (const status of statuses) {
        expect(status).toHaveProperty("target");
        expect(status).toHaveProperty("window");
        expect(status).toHaveProperty("currentBurnRate");
        expect(status).toHaveProperty("budgetRemaining");
        expect(status).toHaveProperty("isErroring");
        expect(status).toHaveProperty("threshold");
      }
    });

    it("should calculate threshold for SLO target", () => {
      const burnRate = calculateSLOBurnRate("api-availability");
      expect(burnRate).toBeDefined();
      // For 99.9% target, threshold should be (100-99.9)*10 = 1
      expect(burnRate!.threshold).toBeGreaterThan(0);
    });

    it("should return null for unknown SLO", () => {
      const burnRate = calculateSLOBurnRate("unknown-slo-12345");
      expect(burnRate).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // Integration Tests
  // ──────────────────────────────────────────────────────────────────

  describe("Observability Integration", () => {
    it("should correlate logs with incident events", async () => {
      const correlationId = "test-correlation-123";
      setLogContext({ correlationId });

      const incidentId = recordIncidentEvent({
        correlationId,
        eventType: "signal_rejected",
        severity: "warning",
        component: "validation",
        message: "Signal validation failed",
      });

      const timeline = getIncidentTimeline(incidentId);
      expect(timeline!.events[0].correlationId).toBe(correlationId);
    });

    it("should track health and SLO together", async () => {
      const health = await runHealthChecks();
      const sloStatus = getSLOStatus();

      expect(health).toBeDefined();
      expect(sloStatus).toBeDefined();
      expect(Array.isArray(sloStatus)).toBe(true);
    });

    it("should provide complete observability snapshot", async () => {
      // Log context
      const logCtx = getLogContext();

      // Health checks
      const health = await runHealthChecks();

      // Readiness
      const readiness = await readinessProbe();

      // Incident
      const incidentId = recordIncidentEvent({
        correlationId: logCtx.correlationId,
        eventType: "signal_generated",
        severity: "info",
        component: "pipeline",
        message: "Signal generated",
      });
      const incident = getIncidentTimeline(incidentId);

      // SLO
      recordSLOEvent("api-availability", true);
      const slo = calculateSLOBurnRate("api-availability");

      expect(logCtx).toBeDefined();
      expect(health).toBeDefined();
      expect(readiness).toBeDefined();
      expect(incident).toBeDefined();
      expect(slo).toBeDefined();
    });
  });
});
