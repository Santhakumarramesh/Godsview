/**
 * Phase 17: Deployment Truth Tests
 *
 * Comprehensive test suite for boot validation, smoke testing, and startup resilience
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BootValidator,
  DeploySmokeTest,
  StartupResilience,
  maskSecrets,
  DepCheckResult,
} from "../lib/deployment_truth";

describe("BootValidator", () => {
  let validator: BootValidator;

  beforeEach(() => {
    validator = new BootValidator();
    // Save original env
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgres://test";
  });

  afterEach(() => {
    // Cleanup
    delete process.env.TEST_VAR;
  });

  describe("Environment variable checks", () => {
    it("should detect missing required environment variables", async () => {
      // Remove required var
      const originalDbUrl = process.env.DATABASE_URL;
      delete process.env.DATABASE_URL;

      const report = await validator.validate({});

      expect(report.success).toBe(false);
      expect(report.checks.environment.pass).toBe(false);
      expect(report.checks.environment.message).toContain(
        "Missing required environment variables"
      );
      expect(report.checks.environment.missing).toContain("DATABASE_URL");

      // Restore
      process.env.DATABASE_URL = originalDbUrl;
    });

    it("should pass when all required environment variables are present", async () => {
      const report = await validator.validate({});

      expect(report.checks.environment.pass).toBe(true);
      expect(report.checks.environment.message).toContain("All required");
      expect(report.checks.environment.missing).toHaveLength(0);
    });

    it("should allow registering custom env var specs", async () => {
      validator.registerEnvVar({
        name: "CUSTOM_VAR",
        required: true,
        secret: false,
      });

      const report = await validator.validate({});

      expect(report.checks.environment.pass).toBe(false);
      expect(report.checks.environment.missing).toContain("CUSTOM_VAR");
    });
  });

  describe("Database connectivity check", () => {
    it("should detect database connection failures", async () => {
      const mockDbCheck = vi.fn(async () => false);

      const report = await validator.validate({
        dbCheck: mockDbCheck,
      });

      expect(report.checks.database.pass).toBe(false);
      expect(report.checks.database.message).toContain("failed");
      expect(mockDbCheck).toHaveBeenCalled();
    });

    it("should pass when database is healthy", async () => {
      const mockDbCheck = vi.fn(async () => true);

      const report = await validator.validate({
        dbCheck: mockDbCheck,
      });

      expect(report.checks.database.pass).toBe(true);
      expect(report.checks.database.message).toContain("connected");
    });

    it("should timeout database check after 5 seconds", async () => {
      const mockDbCheck = vi.fn(
        () => new Promise(() => {
          // Never resolves
        })
      );

      const startTime = Date.now();
      const report = await validator.validate({
        dbCheck: mockDbCheck,
      });
      const elapsed = Date.now() - startTime;

      expect(report.checks.database.pass).toBe(false);
      expect(elapsed).toBeGreaterThanOrEqual(5000);
    });
  });

  describe("Route registration validation", () => {
    it("should detect missing required routes", async () => {
      const mockRouteCheck = vi.fn(async () => ["/healthz"]);

      const report = await validator.validate({
        routeCheck: mockRouteCheck,
      });

      expect(report.checks.routes.pass).toBe(false);
      expect(report.checks.routes.message).toContain("Missing required routes");
      expect(report.checks.routes.message).toContain("readyz");
    });

    it("should pass when all required routes are registered", async () => {
      const mockRouteCheck = vi.fn(async () => [
        "/healthz",
        "/readyz",
        "/api/deployment/boot-report",
        "/api/deployment/smoke-test",
      ]);

      const report = await validator.validate({
        routeCheck: mockRouteCheck,
      });

      expect(report.checks.routes.pass).toBe(true);
      expect(report.checks.routes.message).toContain("All");
      expect(report.checks.routes.routes).toContain("/healthz");
    });
  });

  describe("Memory baseline capture", () => {
    it("should capture memory metrics at boot", async () => {
      const report = await validator.validate({});

      expect(report.checks.memory.baseline).toBeDefined();
      expect(report.checks.memory.baseline.heapUsedMb).toBeGreaterThan(0);
      expect(report.checks.memory.baseline.heapTotalMb).toBeGreaterThan(0);
      expect(report.checks.memory.baseline.rssMb).toBeGreaterThan(0);
      expect(report.checks.memory.baseline.timestamp).toBeDefined();
    });

    it("should mark memory check as pass when heap usage is reasonable", async () => {
      const report = await validator.validate({});

      expect(report.checks.memory.pass).toBe(true);
    });

    it("should include memory metrics in boot report", async () => {
      const report = await validator.validate({});

      expect(report.checks.memory.baseline.heapUsedMb).toBeLessThan(500);
    });
  });

  describe("Event loop responsiveness", () => {
    it("should measure event loop latency", async () => {
      const report = await validator.validate({});

      expect(report.checks.eventLoop.duration).toBeGreaterThanOrEqual(0);
      expect(report.checks.eventLoop.duration).toBeLessThan(1000);
      expect(report.checks.eventLoop.message).toContain("latency");
    });

    it("should pass event loop check when responsive", async () => {
      const report = await validator.validate({});

      expect(report.checks.eventLoop.pass).toBe(true);
    });
  });

  describe("External dependency checks", () => {
    it("should check external dependencies when provided", async () => {
      const mockAlpacaCheck = vi.fn(async (): Promise<DepCheckResult> => ({
        name: "alpaca",
        healthy: true,
        latency: 100,
      }));

      const report = await validator.validate({
        dependencyChecks: {
          alpaca: mockAlpacaCheck,
        },
      });

      expect(report.checks.dependencies.results.alpaca).toBeDefined();
      expect(report.checks.dependencies.results.alpaca.healthy).toBe(true);
      expect(mockAlpacaCheck).toHaveBeenCalled();
    });

    it("should handle dependency check failures gracefully", async () => {
      const mockAlpacaCheck = vi.fn(async (): Promise<DepCheckResult> => ({
        name: "alpaca",
        healthy: false,
        latency: 5000,
        error: "Connection timeout",
      }));

      const report = await validator.validate({
        dependencyChecks: {
          alpaca: mockAlpacaCheck,
        },
      });

      expect(report.checks.dependencies.results.alpaca.healthy).toBe(false);
      expect(report.checks.dependencies.results.alpaca.error).toBeDefined();
      // Boot should not fail due to dependency issues
      expect(report.checks.dependencies.pass).toBe(true);
    });

    it("should timeout dependency checks after 5 seconds", async () => {
      const mockSlowCheck = vi.fn(
        () => new Promise(() => {
          // Never resolves
        })
      );

      const report = await validator.validate({
        dependencyChecks: {
          slow: mockSlowCheck,
        },
      });

      expect(report.checks.dependencies.results.slow.healthy).toBe(false);
      expect(report.checks.dependencies.results.slow.latency).toBe(5000);
    });
  });

  describe("Full boot validation", () => {
    it("should generate complete boot report when all checks pass", async () => {
      const mockDbCheck = vi.fn(async () => true);
      const mockRouteCheck = vi.fn(async () => [
        "/healthz",
        "/readyz",
        "/api/deployment/boot-report",
        "/api/deployment/smoke-test",
      ]);

      const report = await validator.validate({
        dbCheck: mockDbCheck,
        routeCheck: mockRouteCheck,
      });

      expect(report.success).toBe(true);
      expect(report.bootId).toBeDefined();
      expect(report.bootId).toMatch(/^boot-/);
      expect(report.duration).toBeGreaterThan(0);
      expect(report.timestamp).toBeDefined();
      expect(report.errors).toHaveLength(0);
    });

    it("should mark boot as failed when checks fail", async () => {
      const mockDbCheck = vi.fn(async () => false);

      const report = await validator.validate({
        dbCheck: mockDbCheck,
      });

      expect(report.success).toBe(false);
      expect(report.errors.length).toBeGreaterThan(0);
    });

    it("should include all check results in report", async () => {
      const report = await validator.validate({});

      expect(report.checks.database).toBeDefined();
      expect(report.checks.routes).toBeDefined();
      expect(report.checks.environment).toBeDefined();
      expect(report.checks.memory).toBeDefined();
      expect(report.checks.eventLoop).toBeDefined();
      expect(report.checks.dependencies).toBeDefined();
    });
  });

  describe("Boot ID generation", () => {
    it("should generate unique boot IDs", () => {
      const validator1 = new BootValidator();
      const validator2 = new BootValidator();

      const id1 = validator1.getBootId();
      const id2 = validator2.getBootId();

      expect(id1).not.toEqual(id2);
    });

    it("should include boot ID in report", async () => {
      const report = await validator.validate({});

      expect(report.bootId).toEqual(validator.getBootId());
    });
  });
});

describe("DeploySmokeTest", () => {
  let smokeTest: DeploySmokeTest;

  beforeEach(() => {
    smokeTest = new DeploySmokeTest("http://localhost:3000");
    // Mock fetch
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Endpoint testing", () => {
    it("should test health check endpoint", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      });
      (global.fetch as any).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ready: true }),
      });
      // Mock key route tests
      for (let i = 0; i < 5; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      }

      const result = await smokeTest.run();

      expect(result.tests.healthz).toBeDefined();
      expect(result.tests.healthz.path).toContain("/healthz");
    });

    it("should test readiness endpoint", async () => {
      // Mock all fetch calls
      for (let i = 0; i < 7; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      }

      const result = await smokeTest.run();

      expect(result.tests.readyz).toBeDefined();
      expect(result.tests.readyz.path).toContain("/readyz");
      expect(result.tests.readyz.pass).toBe(true);
    });

    it("should test key API routes", async () => {
      // Mock all fetch calls
      for (let i = 0; i < 7; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ data: "test" }),
        });
      }

      const result = await smokeTest.run();

      expect(result.tests.keyRoutes).toBeDefined();
      expect(result.tests.keyRoutes.length).toBeGreaterThan(0);
      expect(result.tests.keyRoutes[0].pass).toBe(true);
    });
  });

  describe("Smoke test results", () => {
    it("should generate structured smoke test report", async () => {
      // Mock all fetch calls
      for (let i = 0; i < 7; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      }

      const result = await smokeTest.run();

      expect(result.timestamp).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.duration).toBeGreaterThan(0);
      expect(result.tests).toBeDefined();
      expect(result.errors).toHaveLength(0);
    });

    it("should mark test as failed when endpoints fail", async () => {
      (global.fetch as any).mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: "Service unavailable" }),
      });
      // Mock remaining calls
      for (let i = 0; i < 6; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      }

      const result = await smokeTest.run();

      expect(result.tests.healthz.pass).toBe(false);
      expect(result.tests.healthz.statusCode).toBe(503);
    });

    it("should measure endpoint latencies", async () => {
      // Mock all fetch calls with delays
      for (let i = 0; i < 7; i++) {
        (global.fetch as any).mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              setTimeout(() => {
                resolve({
                  ok: true,
                  status: 200,
                  json: async () => ({}),
                });
              }, 10);
            })
        );
      }

      const result = await smokeTest.run();

      expect(result.tests.latency.p50).toBeGreaterThan(0);
      expect(result.tests.latency.p95).toBeGreaterThanOrEqual(
        result.tests.latency.p50
      );
      expect(result.tests.latency.p99).toBeGreaterThanOrEqual(
        result.tests.latency.p95
      );
    });

    it("should handle request failures gracefully", async () => {
      (global.fetch as any).mockRejectedValueOnce(
        new Error("Network error")
      );
      // Mock remaining calls
      for (let i = 0; i < 6; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      }

      const result = await smokeTest.run();

      expect(result.tests.healthz.pass).toBe(false);
      expect(result.tests.healthz.message).toContain("Network error");
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Custom base URL", () => {
    it("should use custom base URL when provided", async () => {
      const customSmoke = new DeploySmokeTest("http://custom:8000");
      // Mock all fetch calls
      for (let i = 0; i < 7; i++) {
        (global.fetch as any).mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({}),
        });
      }

      await customSmoke.run();

      const calls = (global.fetch as any).mock.calls;
      expect(calls[0][0]).toContain("http://custom:8000");
    });
  });
});

describe("StartupResilience", () => {
  let resilience: StartupResilience;

  beforeEach(() => {
    resilience = new StartupResilience();
  });

  describe("Boot attempt tracking", () => {
    it("should record successful boot attempts", () => {
      resilience.recordBootAttempt("boot-1", true, 1500);

      const history = resilience.getBootHistory(10);
      expect(history).toHaveLength(1);
      expect(history[0].success).toBe(true);
      expect(history[0].duration).toBe(1500);
    });

    it("should record failed boot attempts with error", () => {
      resilience.recordBootAttempt(
        "boot-1",
        false,
        500,
        "Database connection failed"
      );

      const history = resilience.getBootHistory(10);
      expect(history[0].success).toBe(false);
      expect(history[0].error).toBe("Database connection failed");
    });

    it("should maintain boot history limit", () => {
      // Record more than max attempts
      for (let i = 0; i < 60; i++) {
        resilience.recordBootAttempt(`boot-${i}`, i % 2 === 0, 1000);
      }

      const history = resilience.getBootHistory(100);
      expect(history.length).toBeLessThanOrEqual(50);
    });
  });

  describe("Boot loop detection", () => {
    it("should detect boot loop with 3+ failures in 10 minutes", () => {
      const now = Date.now();
      const twoMinutesAgo = new Date(now - 2 * 60 * 1000).toISOString();

      // Record 3 failures within 10 minutes
      vi.useFakeTimers({ now });
      try {
        resilience.recordBootAttempt("boot-1", false, 500, "Error 1");

        vi.advanceTimersByTime(2 * 60 * 1000); // 2 minutes
        resilience.recordBootAttempt("boot-2", false, 500, "Error 2");

        vi.advanceTimersByTime(2 * 60 * 1000); // 2 more minutes (4 total)
        resilience.recordBootAttempt("boot-3", false, 500, "Error 3");

        const bootLoop = resilience.detectBootLoop();
        expect(bootLoop.detected).toBe(true);
        expect(bootLoop.failureCount).toBe(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not detect boot loop with less than 3 failures", () => {
      vi.useFakeTimers();
      try {
        resilience.recordBootAttempt("boot-1", false, 500, "Error");
        resilience.recordBootAttempt("boot-2", false, 500, "Error");

        const bootLoop = resilience.detectBootLoop();
        expect(bootLoop.detected).toBe(false);
        expect(bootLoop.failureCount).toBe(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not detect boot loop if failures are older than 10 minutes", () => {
      vi.useFakeTimers();
      try {
        resilience.recordBootAttempt("boot-1", false, 500, "Error 1");

        vi.advanceTimersByTime(11 * 60 * 1000); // 11 minutes
        resilience.recordBootAttempt("boot-2", false, 500, "Error 2");

        const bootLoop = resilience.detectBootLoop();
        expect(bootLoop.detected).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("Startup events", () => {
    it("should record startup phase events", () => {
      resilience.recordStartupEvent("boot_start", 0);
      resilience.recordStartupEvent("db_ready", 500);
      resilience.recordStartupEvent("healthy", 1200);

      const timeline = resilience.getStartupTimeline();
      expect(timeline.length).toBeGreaterThanOrEqual(3);
      expect(timeline.some((e) => e.phase === "boot_start")).toBe(true);
    });

    it("should record startup events with metadata", () => {
      resilience.recordStartupEvent("test_phase", 100, undefined, {
        bootId: "boot-123",
        details: "test",
      });

      const timeline = resilience.getStartupTimeline();
      expect(timeline[timeline.length - 1].metadata?.bootId).toBe("boot-123");
    });

    it("should filter timeline by boot ID", () => {
      resilience.recordStartupEvent("event1", 100, undefined, {
        bootId: "boot-1",
      });
      resilience.recordStartupEvent("event2", 100, undefined, {
        bootId: "boot-2",
      });

      const timeline = resilience.getStartupTimeline("boot-1");
      expect(timeline.every((e) => e.metadata?.bootId === "boot-1")).toBe(true);
    });
  });

  describe("Metrics calculation", () => {
    it("should calculate success rate", () => {
      resilience.recordBootAttempt("boot-1", true, 1000);
      resilience.recordBootAttempt("boot-2", true, 1000);
      resilience.recordBootAttempt("boot-3", false, 1000);

      const metrics = resilience.getMetrics();
      expect(metrics.successRate).toBe(66.67);
      expect(metrics.successCount).toBe(2);
      expect(metrics.failureCount).toBe(1);
    });

    it("should calculate average boot time", () => {
      resilience.recordBootAttempt("boot-1", true, 1000);
      resilience.recordBootAttempt("boot-2", true, 2000);

      const metrics = resilience.getMetrics();
      expect(metrics.averageBootTime).toBe(1500);
    });

    it("should return last boot result", () => {
      resilience.recordBootAttempt("boot-1", true, 1000);
      resilience.recordBootAttempt("boot-2", false, 500, "Failed");

      const metrics = resilience.getMetrics();
      expect(metrics.lastBootResult?.bootId).toBe("boot-2");
      expect(metrics.lastBootResult?.success).toBe(false);
    });
  });
});

describe("maskSecrets utility", () => {
  it("should mask secret environment variables", () => {
    const env = {
      NODE_ENV: "production",
      DATABASE_URL: "postgres://user:pass@localhost",
      API_KEY: "secret123",
      SECRET_TOKEN: "token456",
    };

    const masked = maskSecrets(env);

    expect(masked.NODE_ENV).toBe("production");
    expect(masked.DATABASE_URL).toBe("***REDACTED***");
    expect(masked.API_KEY).toBe("***REDACTED***");
    expect(masked.SECRET_TOKEN).toBe("***REDACTED***");
  });

  it("should not mask non-secret variables", () => {
    const env = {
      PORT: "3000",
      LOG_LEVEL: "info",
      HOSTNAME: "localhost",
    };

    const masked = maskSecrets(env);

    expect(masked.PORT).toBe("3000");
    expect(masked.LOG_LEVEL).toBe("info");
    expect(masked.HOSTNAME).toBe("localhost");
  });

  it("should mask variables with secret patterns", () => {
    const env = {
      PRIVATE_KEY: "key123",
      PASSWORD: "pass456",
      URL: "https://example.com",
    };

    const masked = maskSecrets(env);

    expect(masked.PRIVATE_KEY).toBe("***REDACTED***");
    expect(masked.PASSWORD).toBe("***REDACTED***");
    expect(masked.URL).toBe("***REDACTED***");
  });

  it("should handle empty values", () => {
    const env = {
      EMPTY_SECRET: "",
      EMPTY_PUBLIC: "",
    };

    const masked = maskSecrets(env);

    expect(masked.EMPTY_SECRET).toBe("");
    expect(masked.EMPTY_PUBLIC).toBe("");
  });
});
